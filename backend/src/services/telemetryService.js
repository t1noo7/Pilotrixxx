import { pool } from '../db.js';
import { runRuleEngine } from './ruleEngine.js';
import { io, driverNamespace } from '../server.js';

/**
 * Xu ly 1 message telemetry tu MQTT:
 * 1. INSERT vao telemetry_raw
 * 2. UPDATE vehicles.last_* (cache cho Dashboard realtime)
 * 3. Goi Rule Engine (cung transaction) - phat hien hanh vi bat thuong
 *
 * Topic: vehicles/{vehicleId}/telemetry
 * Payload: xem mqtt_payload_schema.md
 */
export async function handleTelemetryMessage(topic, payload) {
    const { vehicleId, tripId, ts, position, acceleration, brakeIntensity, engine, device } = payload;

    if (!vehicleId || !tripId || !ts) {
        console.warn('[telemetry] Missing required fields, skip message:', payload);
        return;
    }

    // Doi chieu vehicleId trong topic voi vehicleId trong payload -
    // tranh truong hop payload gia mao hoac simulator publish sai topic
    const topicMatch = topic.match(/^vehicles\/([^/]+)\/telemetry$/);
    const topicVehicleId = topicMatch?.[1];
    if (topicVehicleId && String(topicVehicleId) !== String(vehicleId)) {
        console.warn(
            `[telemetry] Mismatch vehicleId: topic="${topicVehicleId}" payload="${vehicleId}", skip message`
        );
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. INSERT vao telemetry_raw - RETURNING id de Rule Engine dung lai
        const insertRes = await client.query(
            `INSERT INTO telemetry_raw (
        trip_id, vehicle_id, ts,
        latitude, longitude, position_valid, satellites,
        speed, speed_limit, heading,
        accel_x, accel_y, accel_z, brake_intensity,
        ignition_status, engine_rpm,
        battery_level, gsm_signal,
        raw_payload
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16,
        $17, $18,
        $19
      )
      RETURNING id`,
            [
                tripId, vehicleId, ts,
                position?.latitude, position?.longitude, position?.valid, position?.satellites,
                position?.speed, position?.speedLimit, position?.heading,
                acceleration?.x, acceleration?.y, acceleration?.z, brakeIntensity,
                engine?.ignitionStatus, engine?.rpm,
                device?.batteryLevel, device?.gsmSignal,
                JSON.stringify(payload),
            ]
        );
        const telemetryId = insertRes.rows[0].id;

        // 2. UPDATE vehicles - cache vi tri/trang thai moi nhat
        await client.query(
            `UPDATE vehicles SET
        last_latitude = $1,
        last_longitude = $2,
        last_speed = $3,
        last_position_valid = $4,
        last_ignition_status = $5,
        last_telemetry_at = $6,
        updated_at = now()
      WHERE vehicle_id = $7`,
            [
                position?.latitude, position?.longitude, position?.speed,
                position?.valid, engine?.ignitionStatus, ts,
                vehicleId,
            ]
        );

        // 3. Lay driver_id cua trip nay (Rule Engine can de ghi alerts)
        const tripRes = await client.query(
            'SELECT driver_id FROM trips WHERE trip_id = $1',
            [tripId]
        );
        const driverId = tripRes.rows[0]?.driver_id;

        // 2b. Chuan bi payload de emit SAU KHI commit (khong emit o day)
        const vehiclePositionPayload = {
            vehicleId,
            tripId,
            latitude: position?.latitude,
            longitude: position?.longitude,
            positionValid: position?.valid,
            speed: position?.speed,
            heading: position?.heading,
            ignitionStatus: engine?.ignitionStatus,
            ts,
        };

        const pendingRes = await client.query(
            `SELECT trip_id, driver_id FROM trips
             WHERE vehicle_id = $1 AND scenario = 'manual' AND status = 'pending'
             LIMIT 1`,
            [vehicleId]
        );
        const pendingTrip = pendingRes.rows[0];
        const driverPositionPayload = pendingTrip
            ? {
                vehicleId,
                tripId: pendingTrip.trip_id,
                latitude: position?.latitude,
                longitude: position?.longitude,
                positionValid: position?.valid,
                speed: position?.speed,
                heading: position?.heading,
                etaSeconds: payload.etaSeconds ?? null,
                ts,
            }
            : null;

        // 4. Rule Engine - tra ve list alert can emit, chua emit voi gi ca
        const alertsToEmit = await runRuleEngine(client, {
            telemetry_id: telemetryId,
            trip_id: tripId,
            vehicle_id: vehicleId,
            driver_id: driverId,
            ts,
            position_valid: position?.valid,
            satellites: position?.satellites,
            speed: position?.speed,
            speed_limit: position?.speedLimit,
            brake_intensity: brakeIntensity,
            accel_x: acceleration?.x,
            accel_y: acceleration?.y,
            accel_z: acceleration?.z,
        });

        await client.query('COMMIT');

        try {
            io.emit('vehicle:position', vehiclePositionPayload);
            if (pendingTrip && driverPositionPayload) {
                driverNamespace.to(`driver:${pendingTrip.driver_id}`).emit('vehicle:position', driverPositionPayload);
            }
            for (const alert of alertsToEmit) {
                io.emit('alert', alert);
                console.log(`[rule-engine] ALERT emitted: ${alert.message} (trip ${alert.tripId})`);
            }
        } catch (emitErr) {
            // DB da commit thanh cong - loi o day chi la loi broadcast,
            // khong duoc rollback (khong con gi de rollback) va khong nen
            // lam fail toan bo message xu ly
            console.error('[telemetry] Emit error (data already committed):', emitErr.message);
        }
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}