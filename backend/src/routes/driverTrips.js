import express from 'express';
import { pool } from '../db.js';
import { generateTripSummary } from '../services/tripSummaryService.js';
import { runMlPredict } from './trips.js';
import { handleTelemetryMessage } from '../services/telemetryService.js';
import { fleetControlNamespace, driverNamespace } from '../server.js';

export const driverTripsRouter = express.Router();

/**
 * GET /api/driver/vehicles
 * Trả TOÀN BỘ xe kèm status tính toán ('available'/'incoming'/'renting')
 * - không ẩn xe nào, để mobile tự hiện badge + khoảng cách, driver tự
 * quyết định chọn xe nào (kể cả xe đang mô phỏng nền safe/moderate/
 * dangerous vẫn tính là 'available', vì driver book được ngay).
 */
driverTripsRouter.get('/vehicles', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.vehicle_id, v.license_plate, v.model, v.vehicle_type,
                   v.last_latitude, v.last_longitude,
                   CASE
                       WHEN m.status = 'ongoing' THEN 'renting'
                       WHEN m.status = 'pending' THEN 'incoming'
                       ELSE 'available'
                   END AS status
            FROM vehicles v
            LEFT JOIN LATERAL (
                SELECT status FROM trips
                WHERE vehicle_id = v.vehicle_id AND scenario = 'manual' AND status IN ('ongoing', 'pending')
                ORDER BY trip_id DESC LIMIT 1
            ) m ON true
            ORDER BY v.vehicle_id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /driver/vehicles] Error:', err.message);
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
            `SELECT t.trip_id, t.vehicle_id, t.started_at, t.scenario, t.status,
                    v.license_plate, v.model, v.vehicle_type
             FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
             WHERE t.driver_id = $1 AND t.status IN ('ongoing', 'pending')`,
            [req.driver.driverId]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error('[GET /driver/trips/current] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver/trips/reserve
 * Body: { vehicleId }
 * Tạo trip status='pending' - driver đã "đặt" xe nhưng CHƯA thật sự lái.
 * Nếu xe đang bị simulator giả lập, fleet controller sẽ tự đưa xe về
 * depot trước, báo sẵn sàng qua Socket.IO ('vehicle:ready' -> /driver ns).
 */
driverTripsRouter.post('/trips/reserve', async (req, res) => {
    const { vehicleId, pickupLatitude, pickupLongitude } = req.body;
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId là bắt buộc' });
    if (typeof pickupLatitude !== 'number' || typeof pickupLongitude !== 'number') {
        return res.status(400).json({ error: 'pickupLatitude/pickupLongitude là bắt buộc' });
    }

    const driverId = req.driver.driverId;
    const client = await pool.connect();
    try {
        const existing = await client.query(
            `SELECT trip_id FROM trips WHERE driver_id = $1 AND scenario = 'manual' AND status IN ('ongoing', 'pending')`,
            [driverId]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: `Bạn đang có chuyến #${existing.rows[0].trip_id} chưa kết thúc` });
        }

        const vehicleBusy = await client.query(
            `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND scenario = 'manual' AND status IN ('ongoing', 'pending')`,
            [vehicleId]
        );
        if (vehicleBusy.rows.length > 0) {
            return res.status(409).json({ error: 'Xe này vừa có người khác đặt, chọn xe khác nhé' });
        }

        const tripRes = await client.query(
            `INSERT INTO trips (driver_id, vehicle_id, scenario, status, started_at, pickup_latitude, pickup_longitude)
             VALUES ($1, $2, 'manual', 'pending', now(), $3, $4)
             RETURNING trip_id`,
            [driverId, vehicleId, pickupLatitude, pickupLongitude]
        );
        const tripId = tripRes.rows[0].trip_id;

        fleetControlNamespace.emit('vehicle:requested', {
            vehicleId, tripId, pickupLat: pickupLatitude, pickupLng: pickupLongitude,
        });

        res.status(201).json({ tripId, vehicleId, driverId, status: 'pending' });
    } catch (err) {
        console.error('[POST /driver/trips/reserve] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/driver/trips/:id/activate
 * Chuyển trip pending -> ongoing, set started_at = now() = thời điểm
 * driver THẬT SỰ bắt đầu lái (bấm nút sau khi nhận xe tại depot).
 * Từ lúc này trip/[id].tsx mới bắt đầu watchPositionAsync/gửi telemetry.
 */
driverTripsRouter.post('/trips/:id/activate', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    try {
        const result = await pool.query(
            `UPDATE trips SET status = 'ongoing', started_at = now()
             WHERE trip_id = $1 AND driver_id = $2 AND status = 'pending'
             RETURNING trip_id, vehicle_id, started_at`,
            [tripId, req.driver.driverId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc chưa ở trạng thái chờ` });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[POST /driver/trips/:id/activate] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
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

    const { latitude, longitude, speed, heading, accuracy, timestamp, accelX, accelY, brakeIntensity } = req.body;
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
                latitude, longitude, valid: true, satellites: null,
                speed: speed ?? null, speedLimit: null, heading: heading ?? null,
            },
            acceleration: { x: accelX ?? null, y: accelY ?? null, z: null },
            brakeIntensity: brakeIntensity ?? null,
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
             RETURNING trip_id, vehicle_id`,
            [tripId, req.driver.driverId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc đã kết thúc` });
        }
        fleetControlNamespace.emit('vehicle:returned', { vehicleId: result.rows[0].vehicle_id, tripId });

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
 * POST /api/driver/trips/:id/rate
 * Body: { rating } (số nguyên 1-5) - driver đánh giá chuyến vừa xong,
 * kiểu Grab/Google Maps. Chỉ cho rate trip đã 'completed' và thuộc
 * đúng driver đó (không cho rate hộ/rate trip người khác).
 */
driverTripsRouter.post('/trips/:id/rate', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    const { rating } = req.body;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating phải là số nguyên 1-5' });
    }

    try {
        const result = await pool.query(
            `UPDATE trips SET driver_rating = $1
             WHERE trip_id = $2 AND driver_id = $3 AND status = 'completed'
             RETURNING trip_id, driver_rating`,
            [rating, tripId, req.driver.driverId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc chưa kết thúc` });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[POST /driver/trips/:id/rate] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
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
                   v.license_plate, v.model, v.vehicle_type,
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

/**
 * Nhận từ fleet-control namespace khi simulator báo xe đã về tới depot.
 * Tra pending trip tương ứng, báo tiếp cho đúng driver qua /driver namespace.
 */
export async function handleVehicleReady({ vehicleId }) {
    try {
        const result = await pool.query(
            `SELECT trip_id, driver_id FROM trips
             WHERE vehicle_id = $1 AND status = 'pending'
             ORDER BY created_at DESC LIMIT 1`,
            [vehicleId]
        );
        if (result.rows.length === 0) {
            console.log(`[vehicle:ready] Không tìm thấy trip pending cho vehicle ${vehicleId}`);
            return;
        }
        const { trip_id, driver_id } = result.rows[0];
        driverNamespace.to(`driver:${driver_id}`).emit('vehicle:ready', { vehicleId, tripId: trip_id });
    } catch (err) {
        console.error('[handleVehicleReady] Error:', err.message);
    }
}

/**
 * Nhan tu fleet-control khi simulator loi giua chung luc dua xe ve depot.
 * Huy pending trip, bao driver biet de chon xe khac - tranh ket man cho.
 */
export async function handleVehicleFailed({ vehicleId, reason }) {
    try {
        const result = await pool.query(
            `UPDATE trips SET status = 'aborted', ended_at = now()
             WHERE vehicle_id = $1 AND status = 'pending'
             RETURNING trip_id, driver_id`,
            [vehicleId]
        );
        if (result.rows.length === 0) return;
        const { trip_id, driver_id } = result.rows[0];
        driverNamespace.to(`driver:${driver_id}`).emit('vehicle:failed', { vehicleId, tripId: trip_id, reason });
    } catch (err) {
        console.error('[handleVehicleFailed] Error:', err.message);
    }
}