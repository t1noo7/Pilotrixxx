import express from 'express';
import { pool } from '../db.js';
import { generateTripSummary } from '../services/tripSummaryService.js';
import { runMlPredict } from './trips.js';
import { handleTelemetryMessage } from '../services/telemetryService.js';
import { getSpeedLimit } from '../services/speedLimitLookup.js';
import { io, fleetControlNamespace, driverNamespace } from '../server.js';

export const driverTripsRouter = express.Router();

// Neu trip 'pending' qua thoi gian nay ma van chua co vehicle_ready_at
// (khong ai bao xe toi/that bai ca) - coi nhu "mo coi": rat co the do
// run_fleet.py bi kill/crash giua chung, khong con ai dieu xe hay bao
// tin hieu gi nua. KHONG dung chung voi ETA (ETA la thoi gian xe DANG DI
// CHUYEN toi driver, con cai nay la nguong xe DUNG YEN khong nhuc nhich
// tu dau toi gio) - 10 phut la muc hop ly thuc te (tac duong lau thi
// driver thuong chu dong doi xe khac, khong doi qua 10 phut).
const PENDING_TRIP_TIMEOUT_MINUTES = 10;
// Khac han nhanh tren: xe DA toi noi (vehicle_ready_at da set) nhung
// driver CHUA bam "Bat dau chuyen di". Khong lien quan gi toi run_fleet.py
// song/chet nua (xe da dung yen san roi) - chi la driver cho qua lau.
// Threshold tinh tu vehicle_ready_at, KHONG phai created_at.
const PICKUP_WAIT_TIMEOUT_MINUTES = 10;

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
                    t.vehicle_ready_at, t.created_at,
                    t.demo_mode, t.dest_latitude, t.dest_longitude,
                    t.pickup_latitude, t.pickup_longitude,
                    v.license_plate, v.model, v.vehicle_type,
                    v.last_latitude AS vehicle_latitude,
                    v.last_longitude AS vehicle_longitude,
                    CASE WHEN v.last_telemetry_at > t.started_at THEN v.last_latitude ELSE NULL END AS resume_latitude,
                    CASE WHEN v.last_telemetry_at > t.started_at THEN v.last_longitude ELSE NULL END AS resume_longitude
             FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
             WHERE t.driver_id = $1 AND t.status IN ('ongoing', 'pending')`,
            [req.driver.driverId]
        );
        const trip = result.rows[0];

        // Trip 'pending' mo coi - qua PENDING_TRIP_TIMEOUT_MINUTES ma van
        // chua co vehicle_ready_at, kha nang run_fleet.py da chet/bi kill
        // giua chung (khong con ai dieu xe/bao tin hieu gi nua). Tu abort
        // luon o day - GET /trips/current la noi app CHAC CHAN se goi lai
        // moi lan mo/mount lai man hinh waiting, khong can them cron rieng.
        if (trip && trip.status === 'pending' && !trip.vehicle_ready_at) {
            const ageMinutes = (Date.now() - new Date(trip.created_at).getTime()) / 60000;
            if (ageMinutes > PENDING_TRIP_TIMEOUT_MINUTES) {
                await pool.query(
                    `UPDATE trips SET status = 'aborted', ended_at = now()
                     WHERE trip_id = $1 AND status = 'pending'`,
                    [trip.trip_id]
                );
                // Xe co the da dang reposition (tu lai toi diem don) luc
                // pending -> da tung ban vehicle:position, dashboard dang
                // hien "online". Bao ngay ve offline, khong doi refetch 30s.
                io.emit('trip:completed', { tripId: trip.trip_id, vehicleId: trip.vehicle_id, status: 'aborted' });
                console.log(
                    `[GET /driver/trips/current] Trip #${trip.trip_id} pending qua ` +
                    `${PENDING_TRIP_TIMEOUT_MINUTES} phut khong co vehicle_ready_at - ` +
                    `tu abort (nghi ngo run_fleet.py da chet).`
                );
                return res.json(null);
            }
        }

        if (trip && trip.status === 'pending' && trip.vehicle_ready_at) {
            const waitMinutes = (Date.now() - new Date(trip.vehicle_ready_at).getTime()) / 60000;
            if (waitMinutes > PICKUP_WAIT_TIMEOUT_MINUTES) {
                await pool.query(
                    `UPDATE trips SET status = 'aborted', ended_at = now()
             WHERE trip_id = $1 AND status = 'pending'`,
                    [trip.trip_id]
                );
                // Xe da toi noi (vehicle_ready_at) tuc chac chan da chay
                // reposition that -> dang "online" tren dashboard. Bao
                // ngay ve offline.
                io.emit('trip:completed', { tripId: trip.trip_id, vehicleId: trip.vehicle_id, status: 'aborted' });
                console.log(
                    `[GET /driver/trips/current] Trip #${trip.trip_id} - xe da toi ` +
                    `nhung driver khong nhan qua ${PICKUP_WAIT_TIMEOUT_MINUTES} phut - tu abort.`
                );
                return res.json(null);
            }
        }

        res.json(trip || null);
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
        if (err.code === '23505') {
            if (err.constraint === 'uq_driver_active_trip') {
                return res.status(409).json({ error: 'Bạn đang có chuyến khác chưa kết thúc' });
            }
            if (err.constraint === 'uq_vehicle_active_trip') {
                return res.status(409).json({ error: 'Xe này vừa có người khác đặt, chọn xe khác nhé' });
            }
        }
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
 * POST /api/driver/trips/:id/cancel
 * Driver chủ động huỷ trip đang 'pending' - dùng khi xe đang tới nhưng
 * driver đổi ý muốn chọn xe khác, KHÔNG cần đợi hết
 * PENDING_TRIP_TIMEOUT_MINUTES/PICKUP_WAIT_TIMEOUT_MINUTES như 2 nhánh
 * tự động ở GET /trips/current.
 *
 * QUAN TRỌNG: khi xe đang trên đường tới đón (đã kích hoạt reposition bên
 * Python qua 'vehicle:requested'), có 1 trip RIÊNG với scenario='reposition'
 * đang chạy song song trên CÙNG vehicle_id (khác trip_id với trip 'manual'
 * này - xem comment trips.js dòng ~100-107 về constraint miễn trừ). Route
 * này abort CẢ 2 - không chỉ trip 'manual' - để DB không còn hiện
 * reposition 'ongoing' treo mãi. LƯU Ý: đây chỉ là dọn dẹp phía DB; CHƯA
 * chắc dừng được xe đang chạy thật bên Python (xem ghi chú fleetControl
 * bên dưới, giống lỗ hổng có sẵn ở 2 nhánh auto-abort trong GET
 * /trips/current - không phải bug riêng của route này).
 */
driverTripsRouter.post('/trips/:id/cancel', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    const client = await pool.connect();
    try {
        const manualRes = await client.query(
            `UPDATE trips SET status = 'aborted', ended_at = now()
             WHERE trip_id = $1 AND driver_id = $2 AND status = 'pending'
             RETURNING trip_id, vehicle_id`,
            [tripId, req.driver.driverId]
        );
        if (manualRes.rows.length === 0) {
            return res.status(404).json({
                error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc không còn ở trạng thái chờ`,
            });
        }
        const { vehicle_id: vehicleId } = manualRes.rows[0];

        // Abort luon reposition trip dang chay song song tren cung xe (neu co)
        const repoRes = await client.query(
            `UPDATE trips SET status = 'aborted', ended_at = now()
             WHERE vehicle_id = $1 AND scenario = 'reposition' AND status IN ('ongoing', 'pending')
             RETURNING trip_id`,
            [vehicleId]
        );

        io.emit('trip:completed', { tripId, vehicleId, status: 'aborted' });

        // Da xac nhan qua run_fleet.py: on_returned() gio DA THUC SU set()
        // dung stop_event (truoc day chi print log, khong lam gi ca - xem
        // fix rieng trong run_fleet.py + simulator.py). Chi can vehicleId
        // la du, Python khong dung tripId trong payload nay.
        if (repoRes.rows.length > 0) {
            const repoTripId = repoRes.rows[0].trip_id;
            fleetControlNamespace.emit('vehicle:returned', { vehicleId, tripId: repoTripId });
            console.log(
                `[POST /driver/trips/:id/cancel] Also aborted reposition trip #${repoTripId} for vehicle ${vehicleId}`
            );
        }

        res.json({ tripId, status: 'aborted' });
    } catch (err) {
        console.error('[POST /driver/trips/:id/cancel] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * PATCH /api/driver/trips/:id/route-mode
 * Body: { demoMode, destLatitude?, destLongitude? }
 * Luu lai che do (GPS that/demo) + toa do dich driver chon o
 * destination.tsx - truoc day chi ton tai duoi dang route params thoang
 * qua giua destination.tsx -> trip/[id].tsx, mat sach neu app bi kill
 * giua trip roi mo lai (dung nguyen tac fire-and-forget da biet tu
 * vehicle_ready_at, lan nay o cho khac).
 */
driverTripsRouter.patch('/trips/:id/route-mode', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    const { demoMode, destLatitude, destLongitude } = req.body;
    if (typeof demoMode !== 'boolean') {
        return res.status(400).json({ error: 'demoMode (boolean) là bắt buộc' });
    }
    if (demoMode && (typeof destLatitude !== 'number' || typeof destLongitude !== 'number')) {
        return res.status(400).json({ error: 'destLatitude/destLongitude là bắt buộc khi demoMode=true' });
    }

    try {
        const result = await pool.query(
            `UPDATE trips SET demo_mode = $1, dest_latitude = $2, dest_longitude = $3
             WHERE trip_id = $4 AND driver_id = $5 AND status = 'ongoing'
             RETURNING trip_id, demo_mode, dest_latitude, dest_longitude`,
            [demoMode, demoMode ? destLatitude : null, demoMode ? destLongitude : null, tripId, req.driver.driverId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Chuyến #${tripId} không tồn tại, không thuộc về bạn, hoặc chưa ở trạng thái đang chạy` });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[PATCH /driver/trips/:id/route-mode] Error:', err.message);
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

        // Tra cuu gioi han toc do thuc te (OSM) theo toa do hien tai -
        // truoc day chi hoat dong ben simulator/Python (scenario patrol/
        // reposition), gio noi them cho trip 'manual' de mobile hien
        // canh bao vuot toc do (SOS overspeed). Brute-force ~46.7k segment,
        // ~5ms/lan, du nhe cho tan suat goi 1 lan/8s.
        const speedLimit = getSpeedLimit(latitude, longitude);

        await handleTelemetryMessage('http', {
            vehicleId,
            tripId,
            ts: timestamp || new Date().toISOString(),
            position: {
                latitude, longitude, valid: true, satellites: null,
                speed: speed ?? null, speedLimit, heading: heading ?? null,
            },
            acceleration: { x: accelX ?? null, y: accelY ?? null, z: null },
            brakeIntensity: brakeIntensity ?? null,
            engine: undefined,
            device: { batteryLevel: null, gsmSignal: null, accuracy: accuracy ?? null },
        });

        res.status(202).json({ received: true, speedLimit });
    } catch (err) {
        console.error('[POST /driver/trips/:id/telemetry] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver/trips/:id/simulate-lane-drift
 *
 * DEV-ONLY debug route - ghi thẳng 1 event 'lane_drift' vào driver_events,
 * KHÔNG qua ruleEngine.js. Lý do khác hẳn 4 event kia (hard_brake/
 * rapid_accel/sharp_turn/overspeed): những event đó có 1 giá trị số đo
 * được tại 1 thời điểm (brake_intensity, accel_x/y, speed ratio) nên rule
 * engine tự so ngưỡng được. "Lấn làn" không có đại lượng số nào tương ứng
 * (cần lane-level geometry, ngoài scope đồ án - đã thống nhất từ đầu) nên
 * phải ghi nhận trực tiếp qua route riêng này khi người dùng bấm nút debug.
 *
 * Dùng telemetry_id GẦN NHẤT của trip để JOIN toạ độ - đúng cơ chế mà
 * /api/trips/:id/risk-events và /api/dashboard/risk-events (checkpoint v25)
 * đang dùng để vẽ CircleMarker trên FleetMap, nên event lane_drift giả lập
 * này sẽ tự động hiện đúng vị trí trên dashboard admin luôn, không cần sửa
 * gì thêm bên đó.
 */
driverTripsRouter.post('/trips/:id/simulate-lane-drift', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) {
        return res.status(400).json({ error: 'tripId khong hop le' });
    }

    const client = await pool.connect();
    try {
        const tripRes = await client.query(
            `SELECT vehicle_id, driver_id FROM trips WHERE trip_id = $1`,
            [tripId]
        );
        if (tripRes.rows.length === 0) {
            return res.status(404).json({ error: `Trip ${tripId} khong ton tai` });
        }
        const { vehicle_id: vehicleId, driver_id: driverId } = tripRes.rows[0];

        const telemetryRes = await client.query(
            `SELECT id
             FROM telemetry_raw
             WHERE trip_id = $1
             ORDER BY ts DESC
             LIMIT 1`,
            [tripId]
        );
        if (telemetryRes.rows.length === 0) {
            return res.status(400).json({
                error: 'Chua co telemetry nao cho trip nay - doi vai giay roi thu lai',
            });
        }
        const telemetryId = telemetryRes.rows[0].telemetry_id;

        // severity 'high' co chu dich (khong phai mac dinh) - vi day la
        // event dang demo chu dong bam, muon no hien alert realtime tren
        // Dashboard giong cac event high khac, khong bi chim lan.
        const eventRes = await client.query(
            `INSERT INTO driver_events (trip_id, telemetry_id, event_type, severity, metric_value, occurred_at)
             VALUES ($1, $2, 'lane_drift', 'high', $3, now())
             RETURNING event_id`,
            [tripId, telemetryId, JSON.stringify({ simulated: true })]
        );
        const eventId = eventRes.rows[0].event_id;

        const message = `Lan lan luc ${new Date().toLocaleTimeString('vi-VN')} (gia lap)`;
        await client.query(
            `INSERT INTO alerts (trip_id, vehicle_id, driver_id, event_id, event_type, severity, message, occurred_at)
             VALUES ($1, $2, $3, $4, 'lane_drift', 'high', $5, now())`,
            [tripId, vehicleId, driverId, eventId, message]
        );

        io.emit('alert', {
            tripId,
            vehicleId,
            driverId,
            eventType: 'lane_drift',
            severity: 'high',
            message,
            occurredAt: new Date().toISOString(),
            metricValue: { simulated: true },
        });
        console.log(`[lane-drift-debug] ALERT emitted: ${message} (trip ${tripId})`);

        res.status(201).json({ ok: true, eventId });
    } catch (e) {
        console.error(`[driver/trips/:id/simulate-lane-drift] error trip ${tripId}:`, e.message);
        res.status(500).json({ error: 'Khong the ghi nhan su kien lan lan' });
    } finally {
        client.release();
    }
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const AI_ROAST_TIMEOUT_MS = 5000; // qua 5s coi như fail, chuyển fallback -
// KHÔNG để driver chờ AI chậm quá lâu, breakdown UI phải mượt.

// Câu dự phòng NẾU CẢ Gemini lẫn Groq đều fail (mất mạng, het quota, sai
// key...) - đảm bảo route này KHÔNG BAO GIỜ trả lỗi trắng cho driver.
const STATIC_ROAST_FALLBACK = {
    safe: [
        'Đi kiểu này chán vãi, an toàn quá hoá nhạt 🙄',
        'Ối giồi ôi lái đẹp thế, chắc chưa từng biết đạp ga mạnh tay là gì 😌',
    ],
    medium: [
        'Cũng tạm, nhưng chưa đủ trình để khoe hội đồng đâu nha 😏',
        'Nửa nạc nửa mỡ, hôm nào hứng lên hẵng lái cho tử tế đi cưng 🤏',
    ],
    dangerous: [
        'Chuyến này mà chấm thật chắc hội đồng phải mời phụ huynh vào 😭',
        'Lái kiểu này xe nào cũng khiếp vía, kể cả xe mô hình 🙃',
    ],
};

function pickStaticRoast(riskLevel) {
    const pool = STATIC_ROAST_FALLBACK[riskLevel] || STATIC_ROAST_FALLBACK.safe;
    return pool[Math.floor(Math.random() * pool.length)];
}

function buildRoastPrompt(summary, riskLevel) {
    return (
        `Bạn là một AI cà khịa, đanh đá, chua ngoa, nói chuyện kiểu bạn thân ` +
        `mất dạy hay trêu nhau - được phép chửi thề nhẹ (kiểu "vãi", "ối giồi ` +
        `ôi", "thánh") nhưng TUYỆT ĐỐI không chửi tục nặng, không xúc phạm ` +
        `nhân phẩm, không nói về ngoại hình/gia đình người khác. Bạn đang ` +
        `chấm điểm 1 chuyến đi của tài xế app cho thuê xe ở Việt Nam.\n\n` +
        `Dữ liệu chuyến:\n` +
        `- Phanh gấp: ${summary.hard_brake_per_min} lần/phút\n` +
        `- Tăng tốc đột ngột: ${summary.rapid_accel_per_min} lần/phút\n` +
        `- Cua gắt: ${summary.sharp_turn_per_min} lần/phút\n` +
        `- Vượt tốc: ${Math.round((summary.overspeed_ratio || 0) * 100)}% thời gian\n` +
        `- Mức rủi ro tổng: ${riskLevel}\n\n` +
        `Viết ĐÚNG 1 câu tiếng Việt CÓ DẤU ĐẦY ĐỦ (dưới 30 từ), giọng cà khịa ` +
        `chua ngoa thật sự sắc, chèn 1-2 emoji hợp ngữ cảnh cho sinh động. ` +
        `CHỈ trả về đúng câu đó, không thích, không giải thích thêm, không ` +
        `để trong ngoặc kép.`
    );
}

async function callGemini(prompt) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY chua duoc cau hinh');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_ROAST_TIMEOUT_MS);
    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
                signal: controller.signal,
            }
        );
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text || !text.trim()) throw new Error('Gemini tra ve rong');
        return text.trim();
    } finally {
        clearTimeout(timeout);
    }
}

async function callGroq(prompt) {
    if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY chua duoc cau hinh');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_ROAST_TIMEOUT_MS);
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 80,
                temperature: 0.9,
            }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (!text || !text.trim()) throw new Error('Groq tra ve rong');
        return text.trim();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * GET /api/driver/trips/:id/roast
 * Sinh 1 câu nhận xét châm biếm cho chuyến vừa xong - thử Gemini trước,
 * fail thì Groq, fail nốt thì rơi về câu tĩnh có sẵn (KHÔNG BAO GIỜ trả
 * lỗi 500 cho driver vì đây chỉ là chi tiết vui, không phải core feature -
 * risk_score/risk_level thật vẫn tính bằng ML model như cũ, route này
 * không ảnh hưởng gì tới đó).
 */
driverTripsRouter.get('/trips/:id/roast', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) {
        return res.status(400).json({ error: 'tripId khong hop le' });
    }

    try {
        const summaryRes = await pool.query(
            `SELECT hard_brake_per_min, rapid_accel_per_min, sharp_turn_per_min, overspeed_ratio
             FROM trip_summary WHERE trip_id = $1`,
            [tripId]
        );
        if (summaryRes.rows.length === 0) {
            return res.status(404).json({ error: `Chua co trip_summary cho trip ${tripId}` });
        }
        const summary = summaryRes.rows[0];

        const riskRes = await pool.query(
            `SELECT final_risk_level FROM risk_scores WHERE trip_id = $1`,
            [tripId]
        );
        const riskLevel = riskRes.rows[0]?.final_risk_level || 'safe';

        const prompt = buildRoastPrompt(summary, riskLevel);

        let comment;
        let source;
        try {
            comment = await callGemini(prompt);
            source = 'gemini';
        } catch (e1) {
            console.error(`[roast] Gemini failed trip ${tripId}:`, e1.message);
            try {
                comment = await callGroq(prompt);
                source = 'groq';
            } catch (e2) {
                console.error(`[roast] Groq failed trip ${tripId}:`, e2.message);
                comment = pickStaticRoast(riskLevel);
                source = 'static-fallback';
            }
        }

        res.json({ comment, source });
    } catch (err) {
        console.error(`[GET /driver/trips/:id/roast] Error trip ${tripId}:`, err.message);
        // Ngay ca loi DB cung khong duoc de driver thay man hinh trang -
        // van tra ve 1 cau tinh cho chac, kem code loi de debug rieng.
        res.json({ comment: pickStaticRoast('safe'), source: 'error-fallback' });
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
        const vehicleId = result.rows[0].vehicle_id;

        // Bao fleet-control (Python) biet xe da tra ve - giu nguyen, khac
        // muc dich voi dong ben duoi.
        fleetControlNamespace.emit('vehicle:returned', { vehicleId, tripId });

        // Bao ngay admin dashboard (namespace mac dinh, FleetMap.jsx dang
        // nghe) - dung 1 ten su kien voi trips.js (/:id/end, /:id/abort)
        // de FE chi can 1 listener duy nhat cho ca patrol lan manual.
        io.emit('trip:completed', { tripId, vehicleId, status: 'completed' });

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
        // Ghi lai xuong DB TRUOC khi emit - "xe da toi" phai la trang thai
        // ben vung (query lai duoc bat cu luc nao), khong chi ton tai
        // thoang qua tren socket. Neu chi emit ma khong ghi DB, mobile app
        // bi kill/mo lai dung luc nay se mat tin hieu vinh vien (dung
        // nguyen tac "fire-and-forget Socket.IO" da ghi nhan o checkpoint -
        // ap dung ca cho chieu backend -> mobile, khong chi Python -> backend).
        const result = await pool.query(
            `UPDATE trips SET vehicle_ready_at = now()
             WHERE trip_id = (
                 SELECT trip_id FROM trips
                 WHERE vehicle_id = $1 AND status = 'pending'
                 ORDER BY created_at DESC LIMIT 1
             )
             RETURNING trip_id, driver_id`,
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
        // Loi giua luc dang reposition = xe chac chan dang "online" tren
        // dashboard (dang tu lai that). Bao ngay ve offline.
        io.emit('trip:completed', { tripId: trip_id, vehicleId, status: 'aborted' });
        driverNamespace.to(`driver:${driver_id}`).emit('vehicle:failed', { vehicleId, tripId: trip_id, reason });
    } catch (err) {
        console.error('[handleVehicleFailed] Error:', err.message);
    }
}