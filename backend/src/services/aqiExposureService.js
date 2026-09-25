import { pool } from '../db.js';
import { ensureAqiGridForToday } from './aqiGridService.js';

/**
 * Query dung chung: join telemetry cua 1 trip voi luoi AQI ngay tuong
 * ung. CHI DOC DB (khong goi GEE) - dung cho ca tinh exposure luc trip
 * end (khong limit) lan hien thi Trip Replay (co limit, giong /telemetry).
 * Neu chua co grid cho ngay do (vd trip cu truoc khi co tinh nang nay)
 * thi aqi_value/is_high tra ve null/false het, khong loi.
 */
async function queryTripAqiPoints(tripId, gridDate, limit) {
    const params = [tripId, gridDate];
    let sql = `SELECT tr.ts, tr.latitude AS lat, tr.longitude AS lng, g.aqi_value,
                CASE
                    WHEN g.aqi_value IS NULL THEN NULL
                    WHEN g.aqi_value >= t.high_threshold THEN 'high'
                    WHEN g.aqi_value >= t.medium_threshold THEN 'medium'
                    ELSE 'normal'
                END AS aqi_level
         FROM telemetry_raw tr
         LEFT JOIN aqi_daily_grid g
           ON g.grid_date = $2::date AND g.pollutant = 'NO2'
          AND g.cell_lat = ROUND(tr.latitude::numeric, 2)
          AND g.cell_lng = ROUND(tr.longitude::numeric, 2)
         LEFT JOIN aqi_daily_threshold t
           ON t.grid_date = $2::date AND t.pollutant = 'NO2'
         WHERE tr.trip_id = $1
         ORDER BY tr.ts ASC`;
    if (limit) {
        sql += ` LIMIT $3`;
        params.push(limit);
    }
    const result = await pool.query(sql, params);
    return result.rows;
}

/**
 * Tinh + luu exposure AQI (NO2) cho 1 trip da completed - goi luc trip
 * end, cung pattern voi generateTripSummary/runMlPredict (loi khong lam
 * fail request /end, chi thieu du lieu exposure cho trip nay).
 */
export async function computeTripAqiExposure(tripId) {
    const tripRes = await pool.query(`SELECT driver_id FROM trips WHERE trip_id = $1`, [tripId]);
    if (tripRes.rows.length === 0) throw new Error(`Trip ${tripId} khong ton tai`);
    const driverId = tripRes.rows[0].driver_id;

    const gridDate = await ensureAqiGridForToday();
    const points = await queryTripAqiPoints(tripId, gridDate);

    if (points.length < 2) {
        await upsertExposure(tripId, driverId, { avgAqi: null, highMinutes: 0, totalMinutes: 0, episodes: 0 });
        return { tripId, driverId, avgAqi: null, highAqiMinutes: 0, totalMinutes: 0, episodeCount: 0 };
    }

    let totalMs = 0, highMs = 0, episodeCount = 0, wasHigh = false;
    const aqiValues = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.aqi_value !== null) aqiValues.push(Number(p.aqi_value));
        const isHigh = p.aqi_level === 'high';
        if (isHigh && !wasHigh) episodeCount++;
        wasHigh = isHigh;
        if (i > 0) {
            const deltaMs = new Date(p.ts) - new Date(points[i - 1].ts);
            totalMs += deltaMs;
            if (points[i - 1].aqi_level === 'high') highMs += deltaMs;
        }
    }

    const totalMinutes = totalMs / 60000;
    const highAqiMinutes = highMs / 60000;
    const avgAqi = aqiValues.length > 0 ? aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length : null;

    await upsertExposure(tripId, driverId, { avgAqi, highMinutes: highAqiMinutes, totalMinutes, episodes: episodeCount });
    return { tripId, driverId, avgAqi, highAqiMinutes, totalMinutes, episodeCount };
}

async function upsertExposure(tripId, driverId, { avgAqi, highMinutes, totalMinutes, episodes }) {
    await pool.query(
        `INSERT INTO trip_aqi_exposure
            (trip_id, driver_id, avg_aqi_value, high_aqi_minutes, total_minutes, high_aqi_episode_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (trip_id) DO UPDATE SET
            avg_aqi_value = EXCLUDED.avg_aqi_value,
            high_aqi_minutes = EXCLUDED.high_aqi_minutes,
            total_minutes = EXCLUDED.total_minutes,
            high_aqi_episode_count = EXCLUDED.high_aqi_episode_count,
            computed_at = now()`,
        [tripId, driverId, avgAqi, highMinutes, totalMinutes, episodes]
    );
}

/**
 * Lay du lieu AQI theo tung diem cho 1 trip - dung ve polyline mau trong
 * Trip Replay. gridDate = ngay trip ket thuc (khop dung ngay
 * ensureAqiGridForToday() da dung luc computeTripAqiExposure chay luc do).
 */
export async function getTripAqiRoute(tripId, limit = 1000) {
    const tripRes = await pool.query(
        `SELECT COALESCE(ended_at, now())::date AS grid_date FROM trips WHERE trip_id = $1`,
        [tripId]
    );
    if (tripRes.rows.length === 0) throw new Error(`Trip ${tripId} khong ton tai`);
    const gridDate = tripRes.rows[0].grid_date;

    const thresholdRes = await pool.query(
        `SELECT high_threshold FROM aqi_daily_threshold WHERE grid_date = $1 AND pollutant = 'NO2'`,
        [gridDate]
    );
    const highThreshold = thresholdRes.rows[0]?.high_threshold ?? null;

    const rows = await queryTripAqiPoints(tripId, gridDate, limit);

    return {
        gridDate,
        highThreshold,
        points: rows.map((p) => ({
            lat: p.lat,
            lng: p.lng,
            aqiValue: p.aqi_value !== null ? Number(p.aqi_value) : null,
            aqiLevel: p.aqi_level || 'normal',
        })),
    };
}