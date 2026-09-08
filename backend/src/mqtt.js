import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { handleTelemetryMessage } from './services/telemetryService.js';
dotenv.config();

const TELEMETRY_TOPIC = 'vehicles/+/telemetry'; // '+' = wildcard 1 cap

let client;

export function connectMqtt() {
    const url = `mqtts://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`;

    client = mqtt.connect(url, {
        username: process.env.MQTT_USERNAME,
        password: process.env.MQTT_PASSWORD,
        // clientId CO DINH theo tung MOI TRUONG (qua env, KHONG hardcode
        // 1 gia tri duy nhat) + clean: false -> persistent session.
        //
        // TAI SAO PHAI TACH THEO ENV: neu hardcode 1 clientId duy nhat,
        // chay "pnpm dev" local trong luc ban Render dang chay se khien
        // 2 process cung dung 1 clientId - MQTT spec KHONG cho phep 2
        // ket noi trung clientId, broker se DA VAN ket noi cu (tuc la
        // chay local vo tinh lam rot MQTT cua ban production dang chay
        // that). Dat MQTT_CLIENT_ID rieng cho moi moi truong (vd
        // "datn-backend-render" tren Render, "datn-backend-local" trong
        // .env local) de tranh dung nhau.
        clientId: process.env.MQTT_CLIENT_ID || 'datn-backend-local',
        clean: false,
        reconnectPeriod: 2000, // tu reconnect sau 2s neu mat ket noi
    });

    client.on('connect', (connack) => {
        console.log('[mqtt] Connected to broker. Session present:', connack.sessionPresent);
        client.subscribe(TELEMETRY_TOPIC, { qos: 1 }, (err) => {
            if (err) {
                console.error('[mqtt] Subscribe error:', err.message);
            } else {
                console.log(`[mqtt] Subscribed to "${TELEMETRY_TOPIC}" (QoS 1)`);
            }
        });
    });

    client.on('message', async (topic, payloadBuffer) => {
        try {
            const payload = JSON.parse(payloadBuffer.toString());
            await handleTelemetryMessage(topic, payload);
        } catch (err) {
            // Loi parse JSON hoac loi xu ly DB - log lai, KHONG crash server.
            // 1 message loi khong nen lam dung toan bo luong telemetry.
            console.error(`[mqtt] Error handling message on "${topic}":`, err.message);
        }
    });

    client.on('error', (err) => {
        console.error('[mqtt] Connection error:', err.message);
    });

    client.on('reconnect', () => {
        console.log('[mqtt] Reconnecting...');
    });

    return client;
}
