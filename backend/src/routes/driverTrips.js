import express from 'express';
import { pool } from '../db.js';
import { generateTripSummary } from '../services/tripSummaryService.js';
import { runMlPredict } from './trips.js';
import { handleTelemetryMessage } from '../services/telemetryService.js';

export const driverTripsRouter = express.Router();

/**
 * GET /api/driver/vehicles/available
 * Danh sách xe hiện KHÔNG có trip 'ongoing' - driver chọn xe từ đây.
 */
driverTripsRouter.get('/vehicles/available', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.vehicle_id, v.license_plate, v.model,
                   v.last_latitude, v.last_longitude
            FROM vehicles v
            WHERE NOT EXISTS (
                SELECT 1 FROM trips t
                WHERE t.vehicle_id = v.vehicle_id AND t.status = 'ongoing'
            )
            ORDER BY v.vehicle_id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /driver/vehicles/available] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/driver/trips/current
 * Trip đang chạy của CHÍNH driver này (nếu có) - dùng để app resume state
 * khi mở lại app giữa chuyến (vd bị tắt app, mất mạng).
 */
driverTripsRouter.get('/trips/current', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT t.trip_id, t.vehicle_id, t.started_at, t.scenario,
                    v.license_plate, v.model
             FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
             WHERE t.driver_id = $1 AND t.status = 'ongoing'`,
            [req.driver.driverId]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error('[GET /driver/trips/current] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver/trips/start
 * Body: { vehicleId }
 * driver_id LẤY TỪ TOKEN, không nhận từ body (tránh driver giả mạo driver khác).
 */
driverTripsRouter.post('/trips/start', async (req, res) => {
    const { vehicleId } = req.body;
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId là bắt buộc' });

    const driverId = req.driver.driverId;
    const client = await pool.connect();
    try {
        // Driver không được có 2 trip ongoing cùng lúc
        const existing = await client.query(
            `SELECT trip_id FROM trips WHERE driver_id = $1 AND status = 'ongoing'`,
            [driverId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: `Bạn đang có chuyến #${existing.rows[0].trip_id} chưa kết thúc` });
        }

        // Xe được chọn phải còn trống (double-check, phòng race condition
        // giữa lúc GET /available và lúc bấm start)
        const vehicleOngoing = await client.query(
            `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND status = 'ongoing'`,
            [vehicleId]
        );
        if (vehicleOngoing.rows.length > 0) {
            return res.status(409).json({ error: 'Xe này vừa có người khác đặt, chọn xe khác nhé' });
        }

        const tripRes = await client.query(
            `INSERT INTO trips (driver_id, vehicle_id, scenario, status, started_at)
             VALUES ($1, $2, 'manual', 'ongoing', now())
             RETURNING trip_id`,
            [driverId, vehicleId]
        );
        res.status(201).json({ tripId: tripRes.rows[0].trip_id, vehicleId, driverId });
    } catch (err) {
        console.error('[POST /driver/trips/start] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/driver/trips/:id/telemetry
 * Body: { latitude, longitude, speed, heading, accuracy?, timestamp? }
 * App di động gọi định kỳ (vd mỗi 5-10s) trong lúc chạy trip để cập nhật
 * vị trí realtime lên bản đồ - dùng lại NGUYÊN VẸN logic xử lý telemetry
 * hiện có (insert telemetry_raw, update vehicles.last_*, emit Socket.IO,
 * chạy Rule Engine) thay vì viết lại, chỉ khác nguồn vào là HTTP thay vì MQTT.
 *
 * Không nhận vehicleId từ body - tự tra theo tripId + driver token để
 * đảm bảo driver không thể giả mạo gửi telemetry cho trip không phải của mình.
 */
driverTripsRouter.post('/trips/:id/telemetry', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    const { latitude, longitude, speed, heading, accuracy, timestamp } = req.body;
    if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'latitude và longitude là bắt buộc' });
    }

    try {
        const tripRes = await pool.query(
            `SELECT vehicle_id FROM trips
             WHERE trip_id = $1 AND driver_id = $2 AND status = 'ongoing'`,
            [tripId, req.driver.driverId]
        );
        if (tripRes.rows.length === 0) {
            return res.status(404).json({ error: `Trip #${tripId} không tồn tại, không thuộc về bạn, hoặc đã kết thúc` });
        }
        const vehicleId = tripRes.rows[0].vehicle_id;

        await handleTelemetryMessage('http', {
            vehicleId,
            tripId,
            ts: timestamp || new Date().toISOString(),
            position: {
                latitude,
                longitude,
                valid: true,
                satellites: null,
                speed: speed ?? null,
                speedLimit: null,
                heading: heading ?? null,
            },
            // GPS điện thoại không đo được gia tốc/phanh như thiết bị IoT chuyên
            // dụng - để undefined, handleTelemetryMessage tự ghi null cho các
            // cột này (không lỗi, chỉ thiếu tín hiệu cho Rule Engine hard-brake/
            // rapid-accel; overspeed vẫn phát hiện được nhờ có speed).
            acceleration: undefined,
            brakeIntensity: undefined,
            engine: undefined,
            device: { batteryLevel: null, gsmSignal: null, accuracy: accuracy ?? null },
        });

        res.status(202).json({ received: true });
    } catch (err) {
        console.error('[POST /driver/trips/:id/telemetry] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver/trips/:id/end
 * Chỉ kết thúc được trip CỦA CHÍNH driver này (check driver_id khớp token).
 */
driverTripsRouter.post('/trips/:id/end', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    const client = await pool.connect();
    try {
        const result = await client.query(
            `UPDATE trips SET status = 'completed', ended_at = now()
             WHERE trip_id = $1 AND driver_id = $2 AND status = 'ongoing'
             RETURNING trip_id`,
            [tripId, req.driver.driverId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc đã kết thúc` });
        }

        let summary = null;
        try { summary = await generateTripSummary(tripId); }
        catch (e) { console.error(`[driver/trips/:id/end] summary error trip ${tripId}:`, e.message); }

        let riskScore = null;
        if (summary) {
            try { riskScore = await runMlPredict(tripId); }
            catch (e) { console.error(`[driver/trips/:id/end] ML error trip ${tripId}:`, e.message); }
        }

        res.json({ tripId, status: 'completed', summary, riskScore });
    } catch (err) {
        console.error('[POST /driver/trips/:id/end] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * GET /api/driver/trips/history
 * Lịch sử chuyến của CHÍNH driver này (không nhận driverId từ query -
 * tránh xem được lịch sử tài xế khác).
 */
driverTripsRouter.get('/trips/history', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    try {
        const result = await pool.query(`
            SELECT t.trip_id, t.status, t.scenario, t.started_at, t.ended_at,
                   v.license_plate, v.model,
                   rs.final_risk_score, rs.final_risk_level
            FROM trips t
            JOIN vehicles v ON v.vehicle_id = t.vehicle_id
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            WHERE t.driver_id = $1
            ORDER BY t.started_at DESC
            LIMIT $2
        `, [req.driver.driverId, limit]);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /driver/trips/history] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});