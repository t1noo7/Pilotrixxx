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
const debugState = { lastError: "-", lastOkAt: 0 };

// DEV: bat de gia lap mat mang ngay trong app (khong dong vao mang cua may).
let forceOffline = false;
export function setTelemetryForceOffline(v: boolean) {
  forceOffline = v;
}

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

// Dam bao promise LUON ket thuc sau ms, ke ca khi request treo han (axios
// timeout tren RN khong dang tin khi mat mang giua chung). Neu khong,
// single-flight o flushTelemetry se ket vinh vien tren 1 request treo.
// Request bi bo roi co the van hoan thanh ngam - an toan nho dedupe
// ON CONFLICT (vehicle_id, ts) o backend.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("deadline exceeded")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Dem so lan 1 diem bi backend tra 500 (key = tripId|timestamp).
const failCounts = new Map<string, number>();

async function drain(tripId: string): Promise<FlushResult> {
  const q = await loadQueue(tripId);
  let fresh: FlushResult = null;
  while (q.length > 0) {
    const point = q[0];
    try {
      if (forceOffline) throw new Error("simulated offline");
      // sentAt = gio dien thoai luc gui (khong phai luc ghi diem) - backend
      // dung de phat hien dong ho dien thoai lech so voi server.
      const res = await withDeadline(
        sendTelemetry(
          tripId,
          { ...point, sentAt: new Date().toISOString() },
          { timeout: SEND_TIMEOUT_MS },
        ),
        SEND_TIMEOUT_MS + 5000,
      );
      q.shift();
      debugState.lastOkAt = Date.now();
      fresh =
        Date.now() - new Date(point.timestamp).getTime() <= FRESH_WINDOW_MS
          ? { speedLimit: res.speedLimit }
          : null;
    } catch (err: any) {
      const status = err?.response?.status;
      debugState.lastError = String(status ?? err?.code ?? err?.message);
      if (status === 404) {
        // Trip khong con ongoing / khong thuoc ve driver -> bo ca queue.
        q.length = 0;
        break;
      }
      if (status === 400) {
        q.shift(); // payload hong, bo rieng diem nay
        continue;
      }
      if (status === 500) {
        // Loi ung dung phia backend (khong phai mat mang): neu CUNG 1 diem
        // lien tuc 500 thi bo no, tranh chan ca queue (head-of-line blocking).
        const key = `${tripId}|${point.timestamp}`;
        const n = (failCounts.get(key) ?? 0) + 1;
        failCounts.set(key, n);
        if (n >= 3) {
          failCounts.delete(key);
          q.shift();
          continue;
        }
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

// DEV: chuoi trang thai de hien thi tren man hinh (Metro log khong dang tin
// khi mat mang vi Metro nam tren may Mac cung bi mat mang).
export async function getTelemetryDebug(tripId: string): Promise<string> {
  const q = await loadQueue(tripId);
  const ok = debugState.lastOkAt
    ? `${Math.round((Date.now() - debugState.lastOkAt) / 1000)}s`
    : "never";
  return `queue=${q.length} inflight=${inflight.has(tripId) ? "Y" : "N"} lastOk=${ok} lastErr=${debugState.lastError}`;
}
