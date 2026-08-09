import { pool } from '../db.js';

// Khung toa do bao quanh khu vuc Ha Noi (noi thanh + ngoai thanh du rong
// de bao het vung xe simulator chay) - dung cho WAQI map/bounds.
// Giong kieu HANOI_FALLBACK / config.START_LATITUDE ben Python: hardcode
// co chu dich, khong doi theo tung request.
const HANOI_BOUNDS = { south: 20.85, west: 105.55, north: 21.15, east: 105.95 };

// Cache con "moi" trong 30 phut - qua khoang nay moi goi lai WAQI.
// Khong dung cron/polling nen - chi check ngay luc co request can du lieu
// (lazy refresh), tranh chay ngam ton tai nguyen may dev.
const CACHE_FRESH_MS = 30 * 60 * 1000;

// Trạm được coi là "chết" (không dùng để nội suy) nếu station_time cũ hơn mốc này.
// WAQI vẫn trả về trạm trong response dù không update aqi mới - cần tự lọc.
const STATION_STALE_MS = 24 * 60 * 60 * 1000;

// Dọn rác: xoá trạm không xuất hiện lại trong response fetch gần đây
// (fetched_at không được refresh) sau ngần này ngày.
const CACHE_ROT_DAYS = 3;

// Bán kính tối đa để 1 trạm được tính vào nội suy IDW cho 1 điểm (km).
const IDW_RADIUS_KM = 20;

/**
 * Khoang cach xap xi giua 2 toa do (km), dung equirectangular projection -
 * du chinh xac cho pham vi nho (~30km quanh Ha Noi), cung cach tiep can
 * voi speedLimitLookup.js.
 */
function haversineApprox(lat1, lng1, lat2, lng2) {
    const R = 6371; // ban kinh Trai Dat (km)
    const toRad = (deg) => (deg * Math.PI) / 180;
    const x = toRad(lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
    const y = toRad(lat2 - lat1);
    return Math.sqrt(x * x + y * y) * R;
}

/**
 * Goi WAQI map/bounds neu cache da cu (>30 phut), upsert vao
 * aqi_station_cache, don rac ban ghi khong duoc refresh qua CACHE_ROT_DAYS.
 * Neu cache con moi -> khong goi API, return luon.
 */
export async function fetchAndCacheStations() {
    const freshRes = await pool.query(
        'SELECT MAX(fetched_at) AS latest FROM aqi_station_cache'
    );
    const latest = freshRes.rows[0].latest;
    if (latest && Date.now() - new Date(latest).getTime() < CACHE_FRESH_MS) {
        return { refreshed: false };
    }

    const token = process.env.WAQI_TOKEN;
    if (!token) {
        console.error('[aqiService] Thieu WAQI_TOKEN trong .env');
        return { refreshed: false, error: 'missing_token' };
    }

    const { south, west, north, east } = HANOI_BOUNDS;
    const url = `https://api.waqi.info/map/bounds/?latlng=${south},${west},${north},${east}&token=${token}`;

    let stations;
    try {
        const response = await fetch(url);
        const json = await response.json();
        if (json.status !== 'ok') {
            console.error('[aqiService] WAQI tra ve loi:', json.data);
            return { refreshed: false, error: 'waqi_error' };
        }
        stations = json.data;
    } catch (err) {
        console.error('[aqiService] Loi goi WAQI:', err.message);
        return { refreshed: false, error: 'fetch_failed' };
    }

    const client = await pool.connect();
    try {
        for (const s of stations) {
            const aqiValue = s.aqi === '-' || s.aqi === undefined ? null : parseInt(s.aqi, 10);
            const aqiParsed = Number.isNaN(aqiValue) ? null : aqiValue;
            await client.query(
                `INSERT INTO aqi_station_cache
                    (station_uid, name, latitude, longitude, aqi, station_time, fetched_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now())
                 ON CONFLICT (station_uid) DO UPDATE SET
                    name = EXCLUDED.name,
                    latitude = EXCLUDED.latitude,
                    longitude = EXCLUDED.longitude,
                    aqi = EXCLUDED.aqi,
                    station_time = EXCLUDED.station_time,
                    fetched_at = now()`,
                [s.uid, s.station?.name || null, s.lat, s.lon, aqiParsed, s.station?.time || null]
            );
        }

        await client.query(
            `DELETE FROM aqi_station_cache WHERE fetched_at < now() - interval '${CACHE_ROT_DAYS} days'`
        );
    } finally {
        client.release();
    }

    return { refreshed: true, count: stations.length };
}

/**
 * Lay danh sach tram con "song" tu cache - dung chung cho ca interpolateAqi
 * (1 diem) va generateHeatmapGrid (nhieu diem), tranh query DB lap lai.
 */
async function getValidStations() {
    const result = await pool.query(
        `SELECT latitude, longitude, aqi, station_time
         FROM aqi_station_cache
         WHERE aqi IS NOT NULL
           AND station_time > now() - interval '${STATION_STALE_MS / 3600000} hours'`
    );
    return result.rows;
}

/**
 * Noi suy PM2.5 (thuc chat dang dung truong 'aqi' cua WAQI, coi nhu
 * proxy cho muc do o nhiem chung tai diem do) tai 1 toa do, dung IDW
 * (Inverse Distance Weighting) tu danh sach tram da lay san (khong tu
 * query DB - goi getValidStations() 1 lan roi truyen vao day).
 * Tra ve null neu khong co tram hop le nao trong ban kinh IDW_RADIUS_KM.
 */
function interpolateFromStations(lat, lng, stations) {
    const candidates = [];
    for (const row of stations) {
        const dist = haversineApprox(lat, lng, row.latitude, row.longitude);
        if (dist <= IDW_RADIUS_KM) {
            candidates.push({ dist, aqi: row.aqi });
        }
    }

    if (candidates.length === 0) return null;

    // Neu co tram gan sat (<200m), tra thang gia tri tram do - tranh chia
    // gan cho 0 va phan anh dung du lieu thuc te khi xe dung sat tram.
    const nearest = candidates.reduce((a, b) => (a.dist < b.dist ? a : b));
    if (nearest.dist < 0.2) return nearest.aqi;

    let weightedSum = 0;
    let weightTotal = 0;
    for (const c of candidates) {
        const weight = 1 / (c.dist * c.dist);
        weightedSum += weight * c.aqi;
        weightTotal += weight;
    }

    return weightedSum / weightTotal;
}

/**
 * Ban cong khai: noi suy PM2.5 tai dung 1 toa do (vd dung cho avg_pm25
 * cua trip_summary). Tu query DB 1 lan - dung khi chi can 1 diem, KHONG
 * dung ben trong vong lap (dung generateHeatmapGrid cho truong hop nhieu diem).
 */
export async function interpolateAqi(lat, lng) {
    const stations = await getValidStations();
    return interpolateFromStations(lat, lng, stations);
}

/**
 * Sinh luoi diem [lat, lng, intensity] quanh 1 tam (vi tri xe) cho
 * Leaflet.heat ve. Chi query DB DUNG 1 LAN (lay tram) roi tinh IDW
 * thuan trong bo nho cho tung diem luoi - tranh N query cho N diem.
 * gridRadiusKm: ban kinh luoi quanh xe. step: khoang cach giua cac diem
 * luoi (km) - cang nho cang muot nhung cang nhieu diem.
 */
export async function generateHeatmapGrid(centerLat, centerLng, gridRadiusKm = 5, step = 1) {
    const stations = await getValidStations();
    if (stations.length === 0) return [];

    const points = [];
    const latStep = step / 111; // ~111km / 1 do vi do
    const lngStep = step / (111 * Math.cos((centerLat * Math.PI) / 180));
    const stepsCount = Math.round(gridRadiusKm / step);

    for (let i = -stepsCount; i <= stepsCount; i++) {
        for (let j = -stepsCount; j <= stepsCount; j++) {
            const lat = centerLat + i * latStep;
            const lng = centerLng + j * lngStep;
            if (haversineApprox(centerLat, centerLng, lat, lng) > gridRadiusKm) continue;

            const aqi = interpolateFromStations(lat, lng, stations);
            if (aqi !== null) points.push([lat, lng, aqi]);
        }
    }

    return points;
}