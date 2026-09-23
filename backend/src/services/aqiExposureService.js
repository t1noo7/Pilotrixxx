import { pool } from '../db.js';
import { ensureAqiGridForToday } from './aqiGridService.js';

/**
 * Tinh + luu exposure AQI (NO2) cho 1 trip da completed - goi luc trip
 * end, cung pattern voi generateTripSummary/runMlPredict (loi khong lam
 * fail request /end, chi thieu du lieu exposure cho trip nay).
 */
export async function computeTripAqiExposure(tripId) {
    const tripRes = await pool.query(
        `SELECT driver_id FROM trips WHERE trip_id = $1`,
        [tripId]
    );
    if (tripRes.rows.length === 0) {
        throw new Error(`Trip ${tripId} khong ton tai`);
    }
    const driverId = tripRes.rows[0].driver_id;

    // Dam bao co luoi AQI gan ngay hom nay (lazy-fetch neu chua co) -
    // tra ve dung ngay THUC TE dang co du lieu (co the lui do may che/OFFL tre).
    const gridDate = await ensureAqiGridForToday();

    const result = await pool.query(
        `SELECT tr.ts, g.aqi_value,
                (g.aqi_value >= t.high_threshold) AS is_high
         FROM telemetry_raw tr
         LEFT JOIN aqi_daily_grid g
           ON g.grid_date = $2::date AND g.pollutant = 'NO2'
          AND g.cell_lat = ROUND(tr.latitude::numeric, 2)
          AND g.cell_lng = ROUND(tr.longitude::numeric, 2)
         LEFT JOIN aqi_daily_threshold t
           ON t.grid_date = $2::date AND t.pollutant = 'NO2'
         WHERE tr.trip_id = $1
         ORDER BY tr.ts ASC`,
        [tripId, gridDate]
    );
    const points = result.rows;

    if (points.length < 2) {
        // Chua du diem de tinh khoang thoi gian - luu exposure rong,
        // khong throw (trip qua ngan van hop le, khong phai loi).
        await upsertExposure(tripId, driverId, { avgAqi: null, highMinutes: 0, totalMinutes: 0, episodes: 0 });
        return { tripId, driverId, avgAqi: null, highAqiMinutes: 0, totalMinutes: 0, episodeCount: 0 };
    }

    let totalMs = 0;
    let highMs = 0;
    let episodeCount = 0;
    let wasHigh = false;
    const aqiValues = [];

    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.aqi_value !== null) aqiValues.push(Number(p.aqi_value));

        const isHigh = p.is_high === true;
        if (isHigh && !wasHigh) episodeCount++;
        wasHigh = isHigh;

        if (i > 0) {
            const deltaMs = new Date(p.ts) - new Date(points[i - 1].ts);
            totalMs += deltaMs;
            // Quy uoc: khoang [i-1, i] tinh la "high" neu diem BAT DAU
            // khoang do dang high - xap xi hop ly vi telemetry lay mau
            // deu (~1-2s/lan), sai so khong dang ke.
            if (points[i - 1].is_high === true) highMs += deltaMs;
        }
    }

    const totalMinutes = totalMs / 60000;
    const highAqiMinutes = highMs / 60000;
    const avgAqi = aqiValues.length > 0
        ? aqiValues.reduce((a, b) => a + b, 0) / aqiValues.length
        : null;

    await upsertExposure(tripId, driverId, {
        avgAqi, highMinutes: highAqiMinutes, totalMinutes, episodes: episodeCount,
    });

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