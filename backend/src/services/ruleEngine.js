import { pool } from '../db.js';
import { io } from '../server.js';

/**
 * RULE ENGINE
 * Nhan 1 dong telemetry vua duoc insert (kem telemetry_id), kiem tra
 * 5 loai rule, ghi nhan vao driver_events. Cac event muc 'high' duoc
 * ghi them vao alerts (de Socket.IO day realtime cho Dashboard sau).
 *
 * Nguong duoc chon doi chieu voi simulator/scenario.py:
 * - hard_brake: scenario.py sinh brake_intensity trong (0.6, 1.0) cho
 *   MOI kich ban (chi khac tan suat xay ra) -> nguong high dat o giua
 *   khoang do (0.75) de phan hoa muc do nghiem trong cua TUNG lan phanh,
 *   khong phu thuoc kich ban.
 * - overspeed: scenario.py gioi han max_overspeed_ratio theo kich ban
 *   (safe 1.05 / moderate 1.20 / dangerous 1.50) -> nguong high dat o
 *   20% de "moderate" hiem khi cham high, "dangerous" thuong xuyen cham -
 *   tao su phan hoa ro net giua 3 kich ban khi xem du lieu thuc te.
 */

const THRESHOLDS = {
    hard_brake: { medium: 0.6, high: 0.75 },          // brake_intensity
    rapid_accel: { medium: 0.25, high: 0.4 },          // accel_y (g)
    sharp_turn: { medium: 0.3, high: 0.5 },            // |accel_x| (g)
    overspeed: { medium: 1.05, high: 1.2 },            // speed / speed_limit
};

/**
 * Kiem tra 1 dong telemetry, tra ve danh sach su kien phat hien duoc.
 * Co the co NHIEU su kien tu 1 dong telemetry (vd vua phanh gap vua
 * vuot toc do), hoac KHONG co su kien nao.
 */
function detectEvents(row) {
    const events = [];

    // --- Rule: gps_invalid (kiem tra truoc, doc lap voi cac rule khac) ---
    if (row.position_valid === false) {
        events.push({
            event_type: 'gps_invalid',
            severity: 'medium',
            metric_value: { satellites: row.satellites },
        });
        // Khi GPS invalid, KHONG kiem tra tiep cac rule lien quan toc do/vi tri
        // vi du lieu khong dang tin (vd speed doc duoc co the sai)
        return events;
    }

    // --- Rule: hard_brake ---
    const brake = row.brake_intensity ?? 0;
    if (brake >= THRESHOLDS.hard_brake.high) {
        events.push({ event_type: 'hard_brake', severity: 'high', metric_value: { brake_intensity: brake } });
    } else if (brake >= THRESHOLDS.hard_brake.medium) {
        events.push({ event_type: 'hard_brake', severity: 'medium', metric_value: { brake_intensity: brake } });
    }

    // --- Rule: rapid_accel ---
    const accelY = row.accel_y ?? 0;
    if (accelY >= THRESHOLDS.rapid_accel.high) {
        events.push({ event_type: 'rapid_accel', severity: 'high', metric_value: { accel_y: accelY } });
    } else if (accelY >= THRESHOLDS.rapid_accel.medium) {
        events.push({ event_type: 'rapid_accel', severity: 'medium', metric_value: { accel_y: accelY } });
    }

    // --- Rule: sharp_turn ---
    const accelX = Math.abs(row.accel_x ?? 0);
    if (accelX >= THRESHOLDS.sharp_turn.high) {
        events.push({ event_type: 'sharp_turn', severity: 'high', metric_value: { accel_x: row.accel_x } });
    } else if (accelX >= THRESHOLDS.sharp_turn.medium) {
        events.push({ event_type: 'sharp_turn', severity: 'medium', metric_value: { accel_x: row.accel_x } });
    }

    // --- Rule: overspeed ---
    if (row.speed_limit && row.speed_limit > 0) {
        const ratio = row.speed / row.speed_limit;
        if (ratio >= THRESHOLDS.overspeed.high) {
            events.push({
                event_type: 'overspeed',
                severity: 'high',
                metric_value: { speed: row.speed, speed_limit: row.speed_limit, ratio: Math.round(ratio * 100) / 100 },
            });
        } else if (ratio >= THRESHOLDS.overspeed.medium) {
            events.push({
                event_type: 'overspeed',
                severity: 'medium',
                metric_value: { speed: row.speed, speed_limit: row.speed_limit, ratio: Math.round(ratio * 100) / 100 },
            });
        }
    }

    return events;
}

/**
 * Sinh noi dung hien thi cho alert (chi goi khi severity = 'high').
 */
function buildAlertMessage(event, row) {
    const time = new Date(row.ts).toLocaleTimeString('vi-VN');
    switch (event.event_type) {
        case 'hard_brake':
            return `Phanh gap luc ${time} - cuong do ${(event.metric_value.brake_intensity * 100).toFixed(0)}%`;
        case 'rapid_accel':
            return `Tang toc dot ngot luc ${time}`;
        case 'sharp_turn':
            return `Danh lai gap luc ${time}`;
        case 'overspeed':
            return `Vuot toc do luc ${time} - ${event.metric_value.speed}km/h (gioi han ${event.metric_value.speed_limit}km/h)`;
        case 'gps_invalid':
            return `Mat tin hieu GPS luc ${time}`;
        default:
            return `Phat hien su kien luc ${time}`;
    }
}

/**
 * Entry point - goi tu telemetryService.js ngay sau khi insert
 * telemetry_raw thanh cong.
 *
 * @param {object} client - pg client dang trong transaction (dung lai
 *   connection da co, khong tao moi - de cung 1 transaction voi INSERT
 *   telemetry_raw ben ngoai)
 * @param {object} row - du lieu vua insert, BAO GOM telemetry_id, trip_id,
 *   vehicle_id, driver_id (truy ra tu trips), va cac field can cho rule
 */
export async function runRuleEngine(client, row) {
    const events = detectEvents(row);
    if (events.length === 0) return;

    for (const event of events) {
        // 1. Ghi vao driver_events (luon ghi, du muc do nao)
        const eventRes = await client.query(
            `INSERT INTO driver_events (trip_id, telemetry_id, event_type, severity, metric_value, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING event_id`,
            [row.trip_id, row.telemetry_id, event.event_type, event.severity, JSON.stringify(event.metric_value), row.ts]
        );
        const eventId = eventRes.rows[0].event_id;

        // 2. Neu severity = 'high' -> ghi them vao alerts
        if (event.severity === 'high') {
            const message = buildAlertMessage(event, row);
            await client.query(
                `INSERT INTO alerts (trip_id, vehicle_id, driver_id, event_id, event_type, severity, message, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [row.trip_id, row.vehicle_id, row.driver_id, eventId, event.event_type, event.severity, message, row.ts]
            );
            // Emit realtime alert lên tất cả client Dashboard/Mobile đang connect
            io.emit('alert', {
                tripId: row.trip_id,
                vehicleId: row.vehicle_id,
                driverId: row.driver_id,
                eventType: event.event_type,
                severity: event.severity,
                message,
                occurredAt: row.ts,
                metricValue: event.metric_value,
            });
            console.log(`[rule-engine] ALERT emitted: ${message} (trip ${row.trip_id})`);
        }
    }
}