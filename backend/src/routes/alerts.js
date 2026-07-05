import express from 'express';
import { pool } from '../db.js';

export const alertsRouter = express.Router();

/**
 * GET /api/alerts
 * Danh sách cảnh báo, có filter theo vehicleId, driverId, event_type, is_read
 * Query params: vehicleId, driverId, eventType, isRead, limit (default 50)
 */
alertsRouter.get('/', async (req, res) => {
    const { vehicleId, driverId, eventType, isRead, limit } = req.query;
    const _limit = Math.min(parseInt(limit) || 50, 200);

    // Build WHERE động
    const conditions = [];
    const values = [];
    let idx = 1;

    if (vehicleId) { conditions.push(`a.vehicle_id = $${idx++}`);  values.push(parseInt(vehicleId)); }
    if (driverId)  { conditions.push(`a.driver_id = $${idx++}`);   values.push(parseInt(driverId)); }
    if (eventType) { conditions.push(`a.event_type = $${idx++}`);  values.push(eventType); }
    if (isRead !== undefined) {
        conditions.push(`a.is_read = $${idx++}`);
        values.push(isRead === 'true');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(_limit);

    try {
        const result = await pool.query(`
            SELECT
                a.alert_id, a.trip_id, a.vehicle_id, a.driver_id,
                a.event_type, a.severity, a.message, a.is_read,
                a.occurred_at,
                v.license_plate,
                d.full_name AS driver_name
            FROM alerts a
            JOIN vehicles v ON v.vehicle_id = a.vehicle_id
            JOIN drivers  d ON d.driver_id  = a.driver_id
            ${whereClause}
            ORDER BY a.occurred_at DESC
            LIMIT $${idx}
        `, values);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /alerts] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/alerts/:id/read
 * Đánh dấu cảnh báo đã đọc (nghiệp vụ)
 */
alertsRouter.put('/:id/read', async (req, res) => {
    const alertId = parseInt(req.params.id, 10);
    if (Number.isNaN(alertId)) return res.status(400).json({ error: 'alertId không hợp lệ' });

    try {
        const result = await pool.query(`
            UPDATE alerts SET is_read = true
            WHERE alert_id = $1
            RETURNING alert_id, is_read
        `, [alertId]);

        if (result.rows.length === 0) return res.status(404).json({ error: `Alert ${alertId} không tồn tại` });
        res.json(result.rows[0]);
    } catch (err) {
        // is_read column có thể chưa có - thông báo rõ ràng
        if (err.message.includes('is_read')) {
            return res.status(500).json({ error: 'Cột is_read chưa có trong bảng alerts. Chạy: ALTER TABLE alerts ADD COLUMN is_read BOOLEAN DEFAULT false;' });
        }
        console.error('[PUT /alerts/:id/read] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
