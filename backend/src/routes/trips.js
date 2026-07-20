import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import { pool } from '../db.js';
import { generateTripSummary } from '../services/tripSummaryService.js';

// Đường dẫn tới predict.py: backend/src/routes/ -> lên 3 cấp -> ml/predict.py
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREDICT_PY = path.resolve(__dirname, '..', '..', '..', 'ml', 'predict.py');
// Python interpreter: dùng venv chung ở Pilotrix/venv/ (cùng cấp với backend/, ml/)
const PYTHON = path.resolve(__dirname, '..', '..', '..', 'venv', 'bin', 'python');

/**
 * Gọi ML Risk Scoring qua child process Python.
 * Luôn resolve (không bao giờ reject) - lỗi được log, caller nhận null.
 * Timeout 30s phòng predict.py treo vì DB chậm / model lớn.
 */
export function runMlPredict(tripId) {
    return new Promise((resolve) => {
        execFile(PYTHON, [PREDICT_PY, String(tripId)], { timeout: 30_000 }, (err, stdout, stderr) => {
            if (err) {
                // predict.py in loi JSON ra STDOUT (khong phai stderr) truoc khi
                // sys.exit(1/2) - phai doc ca stdout thi moi thay duoc loi that.
                let predictError = null;
                if (stdout) {
                    try { predictError = JSON.parse(stdout.trim()).error; } catch { /* stdout khong phai JSON */ }
                }
                console.error(
                    `[ml-predict] Trip ${tripId} exit ${err.code} (signal=${err.signal || 'none'}):`,
                    predictError || stderr || err.message
                );
                resolve(null);
                return;
            }
            try {
                const result = JSON.parse(stdout.trim());
                if (result.error) {
                    console.error(`[ml-predict] Trip ${tripId} script error:`, result.error);
                    resolve(null);
                } else {
                    console.log(`[ml-predict] Trip ${tripId} scored: ${result.final.risk_level} (${result.final.risk_score})`);
                    resolve(result);
                }
            } catch {
                console.error(`[ml-predict] Trip ${tripId} JSON parse fail:`, stdout);
                resolve(null);
            }
        });
    });
}

export const tripsRouter = express.Router();

/**
 * POST /api/trips/start
 * Body: { deviceIdent: string, scenario: 'safe'|'moderate'|'dangerous' }
 * Response: { tripId, vehicleId, driverId }
 *
 * Quy trinh (xem mqtt_payload_schema.md, Cach A):
 * 1. Tra device_ident -> vehicle_id
 * 2. Kiem tra xe nay co trip 'ongoing' chua ket thuc khong (validate
 *    theo TUNG XE - khong gioi han toan he thong, xem giai thich
 *    trong mqtt_payload_schema.md muc "Luu y")
 * 3. Gan driver_id cho trip (don gian: lay driver dau tien trong DB -
 *    co the mo rong sau de chon ngau nhien / theo lich)
 * 4. INSERT vao trips, tra ve trip_id thuc
 */
tripsRouter.post('/start', async (req, res) => {
    const { deviceIdent, scenario } = req.body;

    if (!deviceIdent || !scenario) {
        return res.status(400).json({ error: 'deviceIdent va scenario la bat buoc' });
    }
    if (!['safe', 'moderate', 'dangerous', 'reposition'].includes(scenario)) {
        return res.status(400).json({ error: 'scenario phai la safe | moderate | dangerous | reposition' });
    }

    const client = await pool.connect();
    try {
        // 1. Tra vehicle theo device_ident - lay luon assigned_driver_id
        //    (moi xe gan co dinh 1 tai xe, xem migration 002_assign_driver_to_vehicle.sql)
        const vehicleRes = await client.query(
            'SELECT vehicle_id, assigned_driver_id FROM vehicles WHERE device_ident = $1',
            [deviceIdent]
        );
        if (vehicleRes.rows.length === 0) {
            return res.status(404).json({ error: `Khong tim thay vehicle voi device_ident = ${deviceIdent}` });
        }
        const vehicleId = vehicleRes.rows[0].vehicle_id;
        const assignedDriverId = vehicleRes.rows[0].assigned_driver_id;
        if (!assignedDriverId) {
            return res.status(400).json({
                error: `Vehicle ${vehicleId} chua duoc gan driver (assigned_driver_id NULL). Chay migration seed truoc.`,
            });
        }

        // 2. Validate: xe nay dang co trip 'ongoing' chua?
        const ongoingRes = await client.query(
            `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND status = 'ongoing'`,
            [vehicleId]
        );
        if (ongoingRes.rows.length > 0) {
            return res.status(409).json({
                error: `Vehicle ${vehicleId} dang co trip #${ongoingRes.rows[0].trip_id} chua ket thuc`,
            });
        }

        // 3. Driver = assigned_driver_id cua chinh xe nay (da lay o buoc 1)
        const driverId = assignedDriverId;

        // 4. INSERT trip moi
        const tripRes = await client.query(
            `INSERT INTO trips (driver_id, vehicle_id, scenario, status, started_at)
       VALUES ($1, $2, $3, 'ongoing', now())
       RETURNING trip_id`,
            [driverId, vehicleId, scenario]
        );
        const tripId = tripRes.rows[0].trip_id;

        res.status(201).json({ tripId, vehicleId, driverId });
    } catch (err) {
        console.error('[POST /trips/start] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/trips/:id/end
 * Response: { tripId, status: 'completed' }
 *
 * Buoc nay chi cap nhat trang thai trip. Trip Summary Generator va
 * ML Risk Scoring se duoc trigger o day - se them code goi 2 buoc
 * nay sau khi viet xong cac module tuong ung.
 */
tripsRouter.post('/:id/end', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) {
        return res.status(400).json({ error: 'tripId khong hop le' });
    }

    const client = await pool.connect();
    try {
        const result = await client.query(
            `UPDATE trips SET status = 'completed', ended_at = now()
       WHERE trip_id = $1 AND status = 'ongoing'
       RETURNING trip_id`,
            [tripId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Trip #${tripId} khong ton tai hoac da ket thuc` });
        }

        // Trigger Trip Summary Generator ngay sau khi trip chuyen 'completed'.
        // Chay TACH RIENG transaction voi UPDATE phia tren (da COMMIT ngam dinh
        // boi pg Pool moi query doc lap khi khong dung client/BEGIN rieng) -
        // neu buoc nay loi, trip van duoc danh dau 'completed' dung, chi
        // thieu summary (co the goi lai sau, vi da dung ON CONFLICT UPSERT).
        let summary = null;
        try {
            summary = await generateTripSummary(tripId);
        } catch (summaryErr) {
            console.error(`[POST /trips/:id/end] Loi tinh trip_summary cho trip ${tripId}:`, summaryErr.message);
            // Khong throw tiep - van tra ve thanh cong cho viec "ket thuc trip",
            // vi trang thai trip da duoc cap nhat dung. Loi summary se duoc
            // log lai de debug, co the goi lai generateTripSummary(tripId)
            // thu cong sau.
        }

        // Trigger ML Risk Scoring (chạy sau khi trip_summary đã có dữ liệu).
        // Cùng pattern với generateTripSummary: lỗi KHÔNG làm fail request /end.
        // Backend chỉ log lỗi - trip vẫn được đánh dấu completed.
        // risk_scores sẽ thiếu cho trip này nhưng có thể trigger lại thủ công.
        let riskScore = null;
        if (summary) {
            // Chỉ predict nếu summary tính thành công (predict.py cần trip_summary trong DB)
            try {
                riskScore = await runMlPredict(tripId);
            } catch (mlErr) {
                // runMlPredict không bao giờ throw, catch này chỉ là safety net
                console.error(`[POST /trips/:id/end] Unexpected ML error trip ${tripId}:`, mlErr.message);
            }
        }

        res.json({ tripId, status: 'completed', summary, riskScore });
    } catch (err) {
        console.error('[POST /trips/:id/end] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

/**
 * POST /api/trips/:id/abort
 * Dung khi simulation loi giua chung (vd MQTT khong ket noi duoc) -
 * dong trip o trang thai 'aborted' thay vi de ket mai o 'ongoing',
 * tranh chan 409 Conflict cho lan chay sau cua chinh xe do.
 * Khac /:id/end: KHONG trigger Trip Summary / ML Risk Scoring, vi day
 * la trip loi/khong hoan chinh, khong co du lieu de tinh toan y nghia.
 */
tripsRouter.post('/:id/abort', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) {
        return res.status(400).json({ error: 'tripId khong hop le' });
    }

    try {
        const result = await pool.query(
            `UPDATE trips SET status = 'aborted', ended_at = now()
             WHERE trip_id = $1 AND status = 'ongoing'
             RETURNING trip_id`,
            [tripId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Trip #${tripId} khong ton tai hoac da ket thuc` });
        }

        res.json({ tripId, status: 'aborted' });
    } catch (err) {
        console.error('[POST /trips/:id/abort] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/trips
 * Danh sách chuyến đi, filter theo driverId/vehicleId/status
 * Query params: driverId, vehicleId, status, limit (default 20)
 */
tripsRouter.get('/', async (req, res) => {
    const { driverId, vehicleId, status, limit } = req.query;
    const _limit = Math.min(parseInt(limit) || 20, 100);

    const conditions = [];
    const values = [];
    let idx = 1;

    if (driverId) { conditions.push(`t.driver_id = $${idx++}`); values.push(parseInt(driverId)); }
    if (vehicleId) { conditions.push(`t.vehicle_id = $${idx++}`); values.push(parseInt(vehicleId)); }
    if (status) { conditions.push(`t.status = $${idx++}`); values.push(status); }
    values.push(_limit);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const result = await pool.query(`
            SELECT
                t.trip_id, t.status, t.scenario,
                t.started_at, t.ended_at,
                d.driver_id, d.full_name AS driver_name,
                v.vehicle_id, v.license_plate,
                rs.final_risk_score, rs.final_risk_level
            FROM trips t
            JOIN drivers  d ON d.driver_id  = t.driver_id
            JOIN vehicles v ON v.vehicle_id = t.vehicle_id
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            ${whereClause}
            ORDER BY t.started_at DESC
            LIMIT $${idx}
        `, values);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /trips] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/trips/:id
 * Chi tiết 1 chuyến đi
 */
tripsRouter.get('/:id', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    try {
        const result = await pool.query(`
            SELECT
                t.*,
                d.full_name AS driver_name, d.license_number,
                v.license_plate, v.model,
                rs.final_risk_score, rs.final_risk_level,
                rs.lr_risk_score, rs.rf_risk_score
            FROM trips t
            JOIN drivers  d ON d.driver_id  = t.driver_id
            JOIN vehicles v ON v.vehicle_id = t.vehicle_id
            LEFT JOIN risk_scores rs ON rs.trip_id = t.trip_id
            WHERE t.trip_id = $1
        `, [tripId]);

        if (result.rows.length === 0) return res.status(404).json({ error: `Trip ${tripId} không tồn tại` });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[GET /trips/:id] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/trips/:id/summary
 * Tổng hợp hành vi theo chuyến đi (nghiệp vụ)
 */
tripsRouter.get('/:id/summary', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });

    try {
        const result = await pool.query(
            'SELECT * FROM trip_summary WHERE trip_id = $1',
            [tripId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: `Trip ${tripId} chưa có summary (chưa kết thúc hoặc lỗi tính toán)` });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('[GET /trips/:id/summary] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/trips/:id/telemetry
 * Dữ liệu cảm biến theo chuyến đi (nghiệp vụ)
 * Query param: limit (default 200, tối đa 1000)
 */
tripsRouter.get('/:id/telemetry', async (req, res) => {
    const tripId = parseInt(req.params.id, 10);
    if (Number.isNaN(tripId)) return res.status(400).json({ error: 'tripId không hợp lệ' });
    const limit = Math.min(parseInt(req.query.limit) || 200, 1000);

    try {
        const result = await pool.query(`
            SELECT
                id AS telemetry_id, ts, latitude AS lat, longitude AS lng, speed, speed_limit,
                accel_x, accel_y, accel_z, brake_intensity,
                heading, position_valid, satellites
            FROM telemetry_raw
            WHERE trip_id = $1
            ORDER BY ts ASC
            LIMIT $2
        `, [tripId, limit]);
        res.json({ tripId, count: result.rows.length, points: result.rows });
    } catch (err) {
        console.error('[GET /trips/:id/telemetry] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});
