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
        clientId: `datn-backend-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 2000, // tu reconnect sau 2s neu mat ket noi
    });

    client.on('connect', () => {
        console.log('[mqtt] Connected to broker');
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