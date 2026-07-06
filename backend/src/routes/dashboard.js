import express from 'express';
import { pool } from '../db.js';

// Tach thanh 3 router rieng (thay vi 1 router dung chung mount o 3 tien to
// khac nhau) - fix bug path bi lap doi (vd /api/risk-scores/risk-scores/compute)
// do route ben trong da co san tien to trung voi mount prefix.
export const dashboardRouter = express.Router();
export const riskScoresRouter = express.Router();
export const telemetryLiveRouter = express.Router();

/**
 * GET /api/dashboard/fleet-status
 * Trạng thái realtime toàn bộ đội xe (nghiệp vụ)
 * Dùng cho Leaflet map - trả về vị trí + trạng thái mỗi xe
 */
dashboardRouter.get('/fleet-status', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                v.vehicle_id, v.license_plate, v.model,
                v.last_latitude, v.last_longitude, v.last_speed, v.last_telemetry_at,
                -- Trip đang chạy
                t.trip_id, t.started_at AS trip_started_at,
                d.driver_id, d.full_name AS driver_name,
                -- Risk score gần nhất của tài xế này
                (
                    SELECT rs.final_risk_level
                    FROM trips t2
                    JOIN risk_scores rs ON rs.trip_id = t2.trip_id
                    WHERE t2.driver_id = d.driver_id AND t2.status = 'completed'
                    ORDER BY t2.ended_at DESC
                    LIMIT 1
                ) AS last_risk_level,
                CASE WHEN t.trip_id IS NOT NULL THEN 'online' ELSE 'offline' END AS status
            FROM vehicles v
            LEFT JOIN trips t   ON t.vehicle_id = v.vehicle_id AND t.status = 'ongoing'
            LEFT JOIN drivers d ON d.driver_id  = t.driver_id
            ORDER BY v.vehicle_id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /dashboard/fleet-status] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/dashboard/stats
 * Thống kê tổng quan (nghiệp vụ)
 */
dashboardRouter.get('/stats', async (req, res) => {
    try {
        const [tripsRes, alertsRes, riskRes, vehiclesRes] = await Promise.all([
            pool.query(`
                SELECT
                    COUNT(*)                                              AS total_trips,
                    COUNT(CASE WHEN status = 'ongoing'   THEN 1 END)     AS ongoing_trips,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END)     AS completed_trips
                FROM trips
            `),
            pool.query(`
                SELECT
                    COUNT(*)                                          AS total_alerts,
                    COUNT(CASE WHEN is_read = false THEN 1 END)       AS unread_alerts,
                    COUNT(CASE WHEN event_type = 'hard_brake'   THEN 1 END) AS hard_brake_count,
                    COUNT(CASE WHEN event_type = 'overspeed'    THEN 1 END) AS overspeed_count,
                    COUNT(CASE WHEN event_type = 'rapid_accel'  THEN 1 END) AS rapid_accel_count,
                    COUNT(CASE WHEN event_type = 'sharp_turn'   THEN 1 END) AS sharp_turn_count
                FROM alerts
            `),
            pool.query(`
                SELECT
                    COUNT(CASE WHEN final_risk_level = 'safe'      THEN 1 END) AS safe_count,
                    COUNT(CASE WHEN final_risk_level = 'medium'    THEN 1 END) AS medium_count,
                    COUNT(CASE WHEN final_risk_level = 'dangerous' THEN 1 END) AS dangerous_count,
                    ROUND(AVG(final_risk_score)::numeric, 3)                   AS avg_risk_score
                FROM risk_scores
            `),
            pool.query(`
                SELECT COUNT(DISTINCT vehicle_id) AS online_vehicles
                FROM trips WHERE status = 'ongoing'
            `),
        ]);

        res.json({
            trips:    tripsRes.rows[0],
            alerts:   alertsRes.rows[0],
            risk:     riskRes.rows[0],
            vehicles: vehiclesRes.rows[0],
        });
    } catch (err) {
        console.error('[GET /dashboard/stats] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/telemetry/live/:vehicleId
 * 20 điểm telemetry gần nhất của xe đang chạy (nghiệp vụ)
 */
telemetryLiveRouter.get('/:vehicleId', async (req, res) => {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (Number.isNaN(vehicleId)) return res.status(400).json({ error: 'vehicleId không hợp lệ' });

    try {
        const tripRes = await pool.query(
            `SELECT trip_id FROM trips WHERE vehicle_id = $1 AND status = 'ongoing' LIMIT 1`,
            [vehicleId]
        );
        if (tripRes.rows.length === 0) {
            return res.status(404).json({ error: `Vehicle ${vehicleId} không có trip đang chạy` });
        }
        const tripId = tripRes.rows[0].trip_id;

        const result = await pool.query(`
            SELECT
                id AS telemetry_id, ts, latitude AS lat, longitude AS lng, speed, speed_limit,
                accel_x, accel_y, accel_z, brake_intensity,
                position_valid, satellites
            FROM telemetry_raw
            WHERE trip_id = $1
            ORDER BY ts DESC
            LIMIT 20
        `, [tripId]);

        res.json({
            vehicleId,
            tripId,
            points: result.rows.reverse(),
        });
    } catch (err) {
        console.error('[GET /telemetry/live/:vehicleId] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/risk-scores
 * Danh sách risk scores, filter theo driverId/vehicleId (nghiệp vụ)
 */
riskScoresRouter.get('/', async (req, res) => {
    const { driverId, vehicleId, limit } = req.query;
    const _limit = Math.min(parseInt(limit) || 20, 100);

    const conditions = ['t.status = \'completed\''];
    const values = [];
    let idx = 1;

    if (driverId)  { conditions.push(`t.driver_id = $${idx++}`);  values.push(parseInt(driverId)); }
    if (vehicleId) { conditions.push(`t.vehicle_id = $${idx++}`); values.push(parseInt(vehicleId)); }
    values.push(_limit);

    try {
        const result = await pool.query(`
            SELECT
                rs.trip_id,
                rs.lr_risk_score, rs.lr_risk_level,
                rs.rf_risk_score, rs.rf_risk_level,
                rs.final_risk_score, rs.final_risk_level,
                rs.model_version, rs.computed_at,
                t.started_at, t.ended_at, t.scenario,
                d.full_name AS driver_name,
                v.license_plate
            FROM risk_scores rs
            JOIN trips    t ON t.trip_id    = rs.trip_id
            JOIN drivers  d ON d.driver_id  = t.driver_id
            JOIN vehicles v ON v.vehicle_id = t.vehicle_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY rs.computed_at DESC
            LIMIT $${idx}
        `, values);
        res.json(result.rows);
    } catch (err) {
        console.error('[GET /risk-scores] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/risk-scores/compute
 * Trigger tính risk score thủ công cho 1 trip (nghiệp vụ)
 * Body: { tripId }
 */
riskScoresRouter.post('/compute', async (req, res) => {
    const { tripId } = req.body;
    if (!tripId) return res.status(400).json({ error: 'tripId là bắt buộc' });

    const { execFile } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const path = await import('path');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const PREDICT_PY = path.resolve(__dirname, '..', '..', '..', 'ml', 'predict.py');
    const PYTHON     = path.resolve(__dirname, '..', '..', '..', 'venv', 'bin', 'python');

    try {
        const result = await new Promise((resolve, reject) => {
            execFile(PYTHON, [PREDICT_PY, String(tripId)], { timeout: 30_000 }, (err, stdout, stderr) => {
                if (err) {
                    err.stderrOutput = stderr; // giu lai stderr day du de tra ve cho client debug
                    return reject(err);
                }
                try { resolve(JSON.parse(stdout.trim())); }
                catch { reject(new Error('JSON parse fail: ' + stdout)); }
            });
        });

        if (result.error) return res.status(400).json({ error: result.error });
        res.json(result);
    } catch (err) {
        console.error('[POST /risk-scores/compute] Error:', err.stderrOutput || err.message);
        res.status(500).json({ error: err.message, stderr: err.stderrOutput || null });
    }
});
