import { pool } from '../db.js';

/**
 * TRIP SUMMARY GENERATOR
 * Goi ngay sau khi 1 trip chuyen sang status 'completed' (trong route
 * /api/trips/:id/end). Doc toan bo telemetry_raw + driver_events cua
 * trip nay, tinh cac feature tong hop, ghi vao trip_summary.
 *
 * Day la INPUT truc tiep cho ML Risk Scoring (doc trip_summary, khong
 * doc lai telemetry_raw/driver_events).
 */

const EARTH_RADIUS_KM = 6371.0;

/** Khoang cach Haversine giua 2 diem GPS (km). */
function haversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
}

/**
 * Tinh tong distance_km tu danh sach diem telemetry (da sap xep theo ts).
 * CHI tinh giua 2 diem lien tiep deu co position_valid = true - tranh
 * cong khoang cach "ao" do toa do loi khi GPS mat tin hieu.
 */
function computeDistance(telemetryRows) {
    let total = 0;
    for (let i = 1; i < telemetryRows.length; i++) {
        const prev = telemetryRows[i - 1];
        const curr = telemetryRows[i];
        if (prev.position_valid && curr.position_valid) {
            total += haversineDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        }
    }
    return total;
}

/**
 * Entry point - goi tu route /api/trips/:id/end SAU KHI UPDATE
 * trips.status = 'completed' thanh cong.
 */
export async function generateTripSummary(tripId) {
    const client = await pool.connect();
    try {
        // 1. Lay thong tin trip (can started_at/ended_at de tinh duration)
        const tripRes = await client.query(
            'SELECT started_at, ended_at FROM trips WHERE trip_id = $1',
            [tripId]
        );
        if (tripRes.rows.length === 0) {
            throw new Error(`Trip ${tripId} khong ton tai`);
        }
        const { started_at, ended_at } = tripRes.rows[0];
        const durationSeconds = Math.round((new Date(ended_at) - new Date(started_at)) / 1000);
        const durationMinutes = durationSeconds / 60;

        // 2. Lay toan bo telemetry cua trip, sap xep theo thoi gian
        const telemetryRes = await client.query(
            `SELECT latitude, longitude, position_valid, speed,
              accel_x, accel_y, accel_z, brake_intensity
       FROM telemetry_raw
       WHERE trip_id = $1
       ORDER BY ts ASC`,
            [tripId]
        );
        const telemetryRows = telemetryRes.rows;

        // 3. Lay so dem su kien theo event_type, tu driver_events
        const eventCountRes = await client.query(
            `SELECT event_type, COUNT(*) AS count
       FROM driver_events
       WHERE trip_id = $1
       GROUP BY event_type`,
            [tripId]
        );
        const eventCounts = {};
        for (const row of eventCountRes.rows) {
            eventCounts[row.event_type] = parseInt(row.count, 10);
        }

        // 4. Tinh overspeed_duration_seconds - so diem co event overspeed
        //    nhan voi khoang thoi gian lay mau (5s/diem, dung TELEMETRY_INTERVAL
        //    nhung de don gian va tranh import config tu simulator, hardcode
        //    5s o day - dung gia tri da chot trong mqtt_payload_schema.md)
        const TELEMETRY_INTERVAL_SECONDS = 5;
        const overspeedCount = eventCounts['overspeed'] || 0;
        const overspeedDurationSeconds = overspeedCount * TELEMETRY_INTERVAL_SECONDS;

        // 5. Tinh thong ke speed / accel / brake tu telemetry_raw
        let sumSpeed = 0;
        let maxSpeed = 0;
        let maxAccel = 0;
        let maxBrake = 0;
        let validSpeedCount = 0;

        for (const row of telemetryRows) {
            if (row.speed != null) {
                sumSpeed += row.speed;
                validSpeedCount++;
                if (row.speed > maxSpeed) maxSpeed = row.speed;
            }
            // "Gia toc" tong hop = magnitude vector 3 truc, tru thanh phan
            // trong luc (~1g o accel_z khi xe nam ngang) - lay gia tri tuyet
            // doi lon nhat tren tung truc ngang (x, y) la du cho muc dich
            // "gia toc manh nhat ghi nhan duoc"
            const accelMagnitude = Math.max(Math.abs(row.accel_x || 0), Math.abs(row.accel_y || 0));
            if (accelMagnitude > maxAccel) maxAccel = accelMagnitude;

            if (row.brake_intensity != null && row.brake_intensity > maxBrake) {
                maxBrake = row.brake_intensity;
            }
        }

        const avgSpeed = validSpeedCount > 0 ? sumSpeed / validSpeedCount : 0;
        const distanceKm = computeDistance(telemetryRows);

        const hardBrakeCount = eventCounts['hard_brake'] || 0;
        const rapidAccelCount = eventCounts['rapid_accel'] || 0;
        const sharpTurnCount = eventCounts['sharp_turn'] || 0;
        const gpsInvalidCount = eventCounts['gps_invalid'] || 0;

        // 6. Chuan hoa theo thoi gian (per-minute) - xem giai thich trong
        //    05_summary_risk.sql ve ly do can chuan hoa
        const safeDivMinutes = durationMinutes > 0 ? durationMinutes : 1; // tranh chia 0

        const summary = {
            duration_seconds: durationSeconds,
            distance_km: Math.round(distanceKm * 1000) / 1000,
            avg_speed: Math.round(avgSpeed * 100) / 100,
            max_speed: maxSpeed,
            max_accel: Math.round(maxAccel * 1000) / 1000,
            max_brake_intensity: Math.round(maxBrake * 100) / 100,
            hard_brake_count: hardBrakeCount,
            rapid_accel_count: rapidAccelCount,
            sharp_turn_count: sharpTurnCount,
            overspeed_count: overspeedCount,
            overspeed_duration_seconds: overspeedDurationSeconds,
            hard_brake_per_min: Math.round((hardBrakeCount / safeDivMinutes) * 100) / 100,
            rapid_accel_per_min: Math.round((rapidAccelCount / safeDivMinutes) * 100) / 100,
            sharp_turn_per_min: Math.round((sharpTurnCount / safeDivMinutes) * 100) / 100,
            overspeed_ratio:
                durationSeconds > 0 ? Math.round((overspeedDurationSeconds / durationSeconds) * 1000) / 1000 : 0,
            gps_invalid_count: gpsInvalidCount,
        };

        // 7. UPSERT vao trip_summary (INSERT, hoac UPDATE neu da ton tai -
        //    phong truong hop can tinh lai sau nay)
        await client.query(
            `INSERT INTO trip_summary (
        trip_id, duration_seconds, distance_km, avg_speed, max_speed,
        max_accel, max_brake_intensity,
        hard_brake_count, rapid_accel_count, sharp_turn_count,
        overspeed_count, overspeed_duration_seconds,
        hard_brake_per_min, rapid_accel_per_min, sharp_turn_per_min,
        overspeed_ratio, gps_invalid_count
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      )
      ON CONFLICT (trip_id) DO UPDATE SET
        duration_seconds = EXCLUDED.duration_seconds,
        distance_km = EXCLUDED.distance_km,
        avg_speed = EXCLUDED.avg_speed,
        max_speed = EXCLUDED.max_speed,
        max_accel = EXCLUDED.max_accel,
        max_brake_intensity = EXCLUDED.max_brake_intensity,
        hard_brake_count = EXCLUDED.hard_brake_count,
        rapid_accel_count = EXCLUDED.rapid_accel_count,
        sharp_turn_count = EXCLUDED.sharp_turn_count,
        overspeed_count = EXCLUDED.overspeed_count,
        overspeed_duration_seconds = EXCLUDED.overspeed_duration_seconds,
        hard_brake_per_min = EXCLUDED.hard_brake_per_min,
        rapid_accel_per_min = EXCLUDED.rapid_accel_per_min,
        sharp_turn_per_min = EXCLUDED.sharp_turn_per_min,
        overspeed_ratio = EXCLUDED.overspeed_ratio,
        gps_invalid_count = EXCLUDED.gps_invalid_count,
        computed_at = now()`,
            [
                tripId,
                summary.duration_seconds,
                summary.distance_km,
                summary.avg_speed,
                summary.max_speed,
                summary.max_accel,
                summary.max_brake_intensity,
                summary.hard_brake_count,
                summary.rapid_accel_count,
                summary.sharp_turn_count,
                summary.overspeed_count,
                summary.overspeed_duration_seconds,
                summary.hard_brake_per_min,
                summary.rapid_accel_per_min,
                summary.sharp_turn_per_min,
                summary.overspeed_ratio,
                summary.gps_invalid_count,
            ]
        );

        console.log(`[trip-summary] Trip ${tripId} summary computed:`, summary);
        return summary;
    } finally {
        client.release();
    }
}