import express from 'express';
import { pool } from '../db.js';

export const driversRouter = express.Router();

/**
 * GET /api/drivers
 * Danh sách tài xế kèm avg risk score tính từ risk_scores
 */
driversRouter.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                d.driver_id, d.full_name, d.phone_number, d.license_number,
                COUNT(t.trip_id)                            AS total_trips,
                ROUND(AVG(rs.final_risk_score)::numeric, 3) AS avg_risk_score,
                -- Trip đang chạy hiện tại (nếu có)
                MAX(CASE WHEN t.status = 'ongoing' THEN t.trip_id END) AS ongoing_trip_id
            FROM drivers d
            LEFT JOIN trips t       ON t.driver_id = d.driver_id
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            GROUP BY d.driver_id
            ORDER BY avg_risk_score DESC NULLS LAST
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /drivers] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/drivers/ranking
 * Bảng xếp hạng tài xế theo điểm rủi ro (nghiệp vụ)
 * Query param: limit (default 10)
 */
driversRouter.get('/ranking', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    try {
        const result = await pool.query(`
            SELECT
                d.driver_id, d.full_name, d.license_number,
                COUNT(t.trip_id)                            AS total_trips,
                ROUND(AVG(rs.final_risk_score)::numeric, 3) AS avg_risk_score,
                -- Phân loại risk level phổ biến nhất
                MODE() WITHIN GROUP (ORDER BY rs.final_risk_level) AS dominant_risk_level,
                -- Số trip theo từng level
                COUNT(CASE WHEN rs.final_risk_level = 'dangerous' THEN 1 END) AS dangerous_trips,
                COUNT(CASE WHEN rs.final_risk_level = 'medium'    THEN 1 END) AS medium_trips,
                COUNT(CASE WHEN rs.final_risk_level = 'safe'      THEN 1 END) AS safe_trips
            FROM drivers d
            LEFT JOIN trips t        ON t.driver_id = d.driver_id AND t.status = 'completed'
            LEFT JOIN risk_scores rs ON rs.trip_id  = t.trip_id
            GROUP BY d.driver_id
            ORDER BY avg_risk_score DESC NULLS LAST
            LIMIT $1
        `, [limit]);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /drivers/ranking] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/drivers/:id
 * Chi tiết tài xế + 10 trip gần nhất
 */
driversRouter.get('/:id', async (req, res) => {
    const driverId = parseInt(req.params.id, 10);
    if (Number.isNaN(driverId)) return res.status(400).json({ error: 'driverId không hợp lệ' });

    try {
        const driverRes = await pool.query(
            'SELECT * FROM drivers WHERE driver_id = $1',
            [driverId]
        );
        if (driverRes.rows.length === 0) return res.status(404).json({ error: `Driver ${driverId} không tồn tại` });

        const tripsRes = await pool.query(`
            SELECT
                t.trip_id, t.status, t.scenario,
                t.started_at, t.ended_at,
                v.license_plate,
                rs.final_risk_score, rs.final_risk_level
            FROM trips t
            JOIN vehicles v     ON v.vehicle_id = t.vehicle_id
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            WHERE t.driver_id = $1
            ORDER BY t.started_at DESC
            LIMIT 10
        `, [driverId]);

        const statsRes = await pool.query(`
            SELECT
                COUNT(t.trip_id)                            AS total_trips,
                ROUND(AVG(rs.final_risk_score)::numeric, 3) AS avg_risk_score
            FROM trips t
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            WHERE t.driver_id = $1
        `, [driverId]);

        res.json({
            ...driverRes.rows[0],
            ...statsRes.rows[0],
            recent_trips: tripsRes.rows,
        });
    } catch (err) {
        console.error('[GET /drivers/:id] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/drivers/:id/risk-history
 * Lịch sử risk score của tài xế theo thời gian (nghiệp vụ)
 * Query param: limit (default 20)
 */
driversRouter.get('/:id/risk-history', async (req, res) => {
    const driverId = parseInt(req.params.id, 10);
    if (Number.isNaN(driverId)) return res.status(400).json({ error: 'driverId không hợp lệ' });
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    try {
        const result = await pool.query(`
            SELECT
                t.trip_id, t.started_at, t.ended_at, t.scenario,
                v.license_plate,
                rs.lr_risk_score,  rs.lr_risk_level,
                rs.rf_risk_score,  rs.rf_risk_level,
                rs.final_risk_score, rs.final_risk_level,
                rs.model_version,  rs.computed_at
            FROM trips t
            JOIN vehicles v      ON v.vehicle_id = t.vehicle_id
            JOIN risk_scores rs  ON rs.trip_id   = t.trip_id
            WHERE t.driver_id = $1 AND t.status = 'completed'
            ORDER BY t.started_at DESC
            LIMIT $2
        `, [driverId, limit]);

        res.json(result.rows);
    } catch (err) {
        console.error('[GET /drivers/:id/risk-history] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/drivers
 * Thêm tài xế mới
 * Body: { full_name, phone_number, license_number }
 */
driversRouter.post('/', async (req, res) => {
    const { full_name, phone_number, license_number } = req.body;
    if (!full_name || !license_number) {
        return res.status(400).json({ error: 'full_name và license_number là bắt buộc' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO drivers (full_name, phone_number, license_number)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [full_name, phone_number || null, license_number]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'license_number đã tồn tại' });
        console.error('[POST /drivers] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
