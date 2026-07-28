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

    // Validate co ban - tranh insert du lieu thieu field bat buoc
    if (!vehicleId || !tripId || !ts) {
        console.warn('[telemetry] Missing required fields, skip message:', payload);
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

        // 2b. Emit realtime vi tri xe len tat ca client dang connect (Dashboard map)
        io.emit('vehicle:position', {
            vehicleId,
            tripId,
            latitude: position?.latitude,
            longitude: position?.longitude,
            positionValid: position?.valid,
            speed: position?.speed,
            heading: position?.heading,
            ignitionStatus: engine?.ignitionStatus,
            ts,
        });

        // 2c. Emit rieng cho driver dang cho xe (waiting.tsx). QUAN TRONG:
        // KHONG dung driverId/tripId cua payload (patrol trip dang publish
        // telemetry) - phai tra CHINH XAC theo vehicle_id, tim trip 'manual'
        // dang 'pending' cua no (neu co). Ly do: luc xe dang duoc dieu huong
        // di don driver, no VAN dang publish telemetry duoi trip_id patrol
        // goc (simulator khong doi trip_id giua chung), khac hoan toan voi
        // trip_id 'manual' ma mobile app dang theo doi. Neu dung nham
        // payload.tripId, driver_id tra ve luon NULL (patrol trip khong co
        // driver) - day chinh la nguyen nhan xe "dung yen" tren map.
        const pendingRes = await client.query(
            `SELECT trip_id, driver_id FROM trips
             WHERE vehicle_id = $1 AND scenario = 'manual' AND status = 'pending'
             LIMIT 1`,
            [vehicleId]
        );
        const pendingTrip = pendingRes.rows[0];
        if (pendingTrip) {
            driverNamespace.to(`driver:${pendingTrip.driver_id}`).emit('vehicle:position', {
                vehicleId,
                tripId: pendingTrip.trip_id, // gui dung tripId 'manual' de client filter khop
                latitude: position?.latitude,
                longitude: position?.longitude,
                positionValid: position?.valid,
                speed: position?.speed,
                heading: position?.heading,
                etaSeconds: payload.etaSeconds ?? null,
                ts,
            });
        }

        // 4. Goi Rule Engine - cung transaction, neu loi se rollback chung
        await runRuleEngine(client, {
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
    } catch (err) {
        await client.query('ROLLBACK');
        throw err; // de mqtt.js bat va log, khong crash server
    } finally {
        client.release();
    }
}