import express from 'express';
import { pool } from '../db.js';

export const vehiclesRouter = express.Router();

/**
 * GET /api/vehicles
 * Danh sách tất cả xe kèm trạng thái realtime (last_* fields)
 */
vehiclesRouter.get('/', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                v.vehicle_id, v.license_plate, v.model, v.device_ident,
                v.last_speed, v.last_latitude, v.last_longitude, v.last_telemetry_at,
                -- Kiểm tra xe có đang chạy không
                t.trip_id AS ongoing_trip_id,
                t.driver_id AS ongoing_driver_id,
                d.full_name AS ongoing_driver_name
            FROM vehicles v
            LEFT JOIN trips t ON t.vehicle_id = v.vehicle_id AND t.status = 'ongoing'
            LEFT JOIN drivers d ON d.driver_id = t.driver_id
            ORDER BY v.vehicle_id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /vehicles] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/vehicles/:id
 * Chi tiết 1 xe
 */
vehiclesRouter.get('/:id', async (req, res) => {
    const vehicleId = parseInt(req.params.id, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: 'vehicleId không hợp lệ' });

    try {
        const result = await pool.query(`
            SELECT
                v.*,
                t.trip_id AS ongoing_trip_id,
                d.full_name AS ongoing_driver_name
            FROM vehicles v
            LEFT JOIN trips t ON t.vehicle_id = v.vehicle_id AND t.status = 'ongoing'
            LEFT JOIN drivers d ON d.driver_id = t.driver_id
            WHERE v.vehicle_id = $1
        `, [vehicleId]);

        if (result.rows.length === 0) return res.status(404).json({ error: `Vehicle ${vehicleId} không tồn tại` });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[GET /vehicles/:id] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/vehicles
 * Thêm xe mới
 * Body: { license_plate, model, device_ident }
 */
vehiclesRouter.post('/', async (req, res) => {
    const { license_plate, model, device_ident } = req.body;
    if (!license_plate || !model || !device_ident) {
        return res.status(400).json({ error: 'license_plate, model, device_ident là bắt buộc' });
    }

    try {
        const result = await pool.query(`
            INSERT INTO vehicles (license_plate, model, device_ident)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [license_plate, model, device_ident]);
        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'license_plate hoặc device_ident đã tồn tại' });
        console.error('[POST /vehicles] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * PUT /api/vehicles/:id
 * Cập nhật thông tin xe
 * Body: { license_plate?, model?, device_ident? }
 */
vehiclesRouter.put('/:id', async (req, res) => {
    const vehicleId = parseInt(req.params.id, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: 'vehicleId không hợp lệ' });

    const { license_plate, model, device_ident } = req.body;
    if (!license_plate && !model && !device_ident) {
        return res.status(400).json({ error: 'Cần ít nhất 1 field để cập nhật' });
    }

    // Build dynamic SET clause chỉ update các field được gửi lên
    const fields = [];
    const values = [];
    let idx = 1;
    if (license_plate) { fields.push(`license_plate = $${idx++}`); values.push(license_plate); }
    if (model)         { fields.push(`model = $${idx++}`);         values.push(model); }
    if (device_ident)  { fields.push(`device_ident = $${idx++}`);  values.push(device_ident); }
    values.push(vehicleId);

    try {
        const result = await pool.query(
            `UPDATE vehicles SET ${fields.join(', ')} WHERE vehicle_id = $${idx} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: `Vehicle ${vehicleId} không tồn tại` });
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'license_plate hoặc device_ident đã tồn tại' });
        console.error('[PUT /vehicles/:id] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/vehicles/:id
 * Xóa xe (chỉ cho phép nếu không có trip ongoing)
 */
vehiclesRouter.delete('/:id', async (req, res) => {
    const vehicleId = parseInt(req.params.id, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: 'vehicleId không hợp lệ' });

    try {
        // Kiểm tra xe có đang chạy không
        const ongoingRes = await pool.query(
            `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND status = 'ongoing'`,
            [vehicleId]
        );
        if (ongoingRes.rows.length > 0) {
            return res.status(409).json({ error: `Vehicle ${vehicleId} đang có trip #${ongoingRes.rows[0].trip_id} chưa kết thúc` });
        }

        const result = await pool.query(
            `DELETE FROM vehicles WHERE vehicle_id = $1 RETURNING vehicle_id`,
            [vehicleId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: `Vehicle ${vehicleId} không tồn tại` });
        res.json({ deleted: true, vehicleId });
    } catch (err) {
        console.error('[DELETE /vehicles/:id] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
