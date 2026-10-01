import AsyncStorage from "@react-native-async-storage/async-storage";
import { sendTelemetry } from "./driverTrips";

type TelemetryData = Parameters<typeof sendTelemetry>[1];
export type QueuedPoint = TelemetryData & { timestamp: string };

const QUEUE_KEY_PREFIX = "telemetryQueue:";
const queueKey = (tripId: string) => `${QUEUE_KEY_PREFIX}${tripId}`;
// ~2.2 gio o nhip 8s; vuot qua thi bo diem cu nhat truoc.
const MAX_QUEUE_SIZE = 1000;
// apiClient khong co timeout mac dinh -> 1 request treo se ket ca queue.
const SEND_TIMEOUT_MS = 15000;
// Diem cu hon nguong nay (replay sau khi mat mang) khong duoc dung de
// dieu khien canh bao vuot toc do tren UI.
const FRESH_WINDOW_MS = 20000;

type FlushResult = { speedLimit: number | null } | null;

const queues = new Map<string, Promise<QueuedPoint[]>>();
const inflight = new Map<string, Promise<FlushResult>>();

function loadQueue(tripId: string): Promise<QueuedPoint[]> {
  let p = queues.get(tripId);
  if (!p) {
    p = AsyncStorage.getItem(queueKey(tripId))
      .then((raw) => (raw ? (JSON.parse(raw) as QueuedPoint[]) : []))
      .catch(() => []);
    queues.set(tripId, p);
  }
  return p;
}

async function persist(tripId: string, q: QueuedPoint[]) {
  try {
    await AsyncStorage.setItem(queueKey(tripId), JSON.stringify(q));
  } catch {}
}

export async function enqueueTelemetry(tripId: string, point: QueuedPoint) {
  const q = await loadQueue(tripId);
  q.push(point);
  if (q.length > MAX_QUEUE_SIZE) q.splice(0, q.length - MAX_QUEUE_SIZE);
  await persist(tripId, q);
}

async function drain(tripId: string): Promise<FlushResult> {
  const q = await loadQueue(tripId);
  let fresh: FlushResult = null;
  while (q.length > 0) {
    const point = q[0];
    try {
      // sentAt = gio dien thoai luc gui (khong phai luc ghi diem) - backend
      // dung de phat hien dong ho dien thoai lech so voi server.
      const res = await sendTelemetry(
        tripId,
        { ...point, sentAt: new Date().toISOString() },
        { timeout: SEND_TIMEOUT_MS },
      );
      q.shift();
      fresh =
        Date.now() - new Date(point.timestamp).getTime() <= FRESH_WINDOW_MS
          ? { speedLimit: res.speedLimit }
          : null;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 404) {
        // Trip khong con ongoing / khong thuoc ve driver -> bo ca queue.
        q.length = 0;
        break;
      }
      if (status === 400) {
        q.shift(); // payload hong, bo rieng diem nay
        continue;
      }
      break; // mat mang / timeout / 5xx / 401 -> giu lai, thu lai tick sau
    }
  }
  if (q.length === 0) {
    // Queue rong -> xoa han key, tranh tich luy key "[]" cua cac trip cu.
    try {
      await AsyncStorage.removeItem(queueKey(tripId));
    } catch {}
  } else {
    await persist(tripId, q);
  }
  return fresh;
}

// Chi 1 luot drain chay tai 1 thoi diem cho moi trip (dam bao gui dung
// thu tu cu -> moi). Goi sau khi luot truoc xong de khong bo sot diem
// vua enqueue luc luot truoc sap ket thuc.
export async function flushTelemetry(tripId: string): Promise<FlushResult> {
  while (inflight.has(tripId)) await inflight.get(tripId);
  const p = drain(tripId).finally(() => inflight.delete(tripId));
  inflight.set(tripId, p);
  return p;
}

export async function clearTelemetryQueue(tripId: string) {
  queues.delete(tripId);
  try {
    await AsyncStorage.removeItem(queueKey(tripId));
  } catch {}
}

// Day het queue con ton cua MOI trip (queue luu ben vung trong AsyncStorage
// theo tripId) - goi truoc getCurrentTrip, vi backend tu ket thuc trip neu
// last_telemetry_at im lang > 10 phut. Khong can biet tripId truoc.
export async function flushAllTelemetryQueues(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    for (const key of keys) {
      if (key.startsWith(QUEUE_KEY_PREFIX)) {
        await flushTelemetry(key.slice(QUEUE_KEY_PREFIX.length));
      }
    }
  } catch {}
}
