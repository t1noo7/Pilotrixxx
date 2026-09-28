import express from 'express';
import { pool } from '../db.js';

export const aqiExposureRouter = express.Router();

/**
 * GET /api/aqi-exposure/summary?weeks=8
 * - drivers: xep hang tai xe theo so episode phoi nhiem NO2 cao
 *   (trung binh/tuan tren cua so `weeks` tuan gan nhat)
 * - trend: chuoi theo tuan cua ca fleet
 * Chi doc trip_aqi_exposure (da tinh san luc trip end), khong goi GEE.
 */
aqiExposureRouter.get('/summary', async (req, res) => {
    const weeks = Math.min(Math.max(parseInt(req.query.weeks) || 8, 1), 26);

    try {
        const rankingRes = await pool.query(`
            SELECT
                d.driver_id, d.full_name,
                COUNT(e.trip_id)                              AS trips,
                COALESCE(SUM(e.high_aqi_episode_count), 0)    AS total_episodes,
                COALESCE(SUM(e.high_aqi_minutes), 0)          AS high_minutes
            FROM drivers d
            JOIN trip_aqi_exposure e ON e.driver_id = d.driver_id
            JOIN trips t ON t.trip_id = e.trip_id
                        AND t.status = 'completed'
                        AND t.ended_at >= now() - ($1::int * interval '7 days')
            GROUP BY d.driver_id, d.full_name
            ORDER BY total_episodes DESC, high_minutes DESC
            LIMIT 15
        `, [weeks]);

        const trendRes = await pool.query(`
            SELECT
                date_trunc('week', t.ended_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS week_start,
                COUNT(*)                                   AS trips,
                COALESCE(SUM(e.high_aqi_episode_count), 0) AS total_episodes,
                COALESCE(SUM(e.high_aqi_minutes), 0)       AS high_minutes
            FROM trip_aqi_exposure e
            JOIN trips t ON t.trip_id = e.trip_id
                        AND t.status = 'completed'
                        AND t.ended_at >= now() - ($1::int * interval '7 days')
            GROUP BY 1
            ORDER BY 1
        `, [weeks]);

        res.json({
            weeks,
            drivers: rankingRes.rows.map((r) => ({
                driverId: Number(r.driver_id),
                fullName: r.full_name,
                trips: Number(r.trips),
                totalEpisodes: Number(r.total_episodes),
                episodesPerWeek: Number((Number(r.total_episodes) / weeks).toFixed(2)),
                highMinutes: Number(Number(r.high_minutes).toFixed(1)),
            })),
            trend: trendRes.rows.map((r) => ({
                weekStart: r.week_start,
                trips: Number(r.trips),
                totalEpisodes: Number(r.total_episodes),
                episodesPerTrip: Number((Number(r.total_episodes) / Number(r.trips)).toFixed(2)),
                highMinutes: Number(Number(r.high_minutes).toFixed(1)),
            })),
        });
    } catch (err) {
        console.error('[GET /aqi-exposure/summary] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});