import { useEffect, useRef, useState } from "react";
import { fetchOsrmRoute, RoutePoint } from "../api/osrm";
import { computeBearing, computeDistanceMeters, angleDiff } from "../utils/geo";

// Cung tinh than voi RouteState (route_generator.py ben simulator):
// noi suy vi tri doc theo polyline OSRM dua tren khoang cach da di duoc,
// nhung don gian hon vi day la 1 chang duy nhat (diem xuat phat -> diem
// den co dinh, khong can xin chang moi lien tuc nhu simulator nen chay).
const STEP_INTERVAL_MS = 1000;
const BASE_SPEED_MPS = 9; // ~32 km/h - toc do trung binh trong pho
const TURN_SPEED_MPS = 3.5; // ~12 km/h - toc do luc vao cua gap
const TURN_ANGLE_THRESHOLD_DEG = 35;
const SHARP_TURN_ANGLE_DEG = 90;
const MIN_TURN_SPEED_MPS = 2.0;
const ARRIVAL_THRESHOLD_M = 30;
// Dao dong nhe cho toc do "di thang" - random walk muot (khong nhay so
// dot ngot tung tick) de tranh vo tinh cham nguong OVERSPEED_TOLERANCE
// ben trip/[id].tsx (gioi han duong dan cu thap nhat hay gap la 30km/h,
// nguong canh bao = 33km/h) - bien do +-15% quanh BASE_SPEED_MPS toi da
// van con cach xa nguong do.
const SPEED_JITTER_RATIO = 0.15;
const SPEED_SMOOTHING = 0.25; // he so muot - cang thap cang tron, doi tu tu

// --- Debug event simulation (nut giả lập trên trip/[id].tsx) ---------------
// Moi loai deu tac dong THAT len vi tri/toc do noi suy (khong phai fake
// so gui rieng) - de marker demo hien dung hanh vi khi hoi dong xem, dung
// tinh than "lam tu te" da chot thay vi overlay/rung gia.
export type DemoEventType =
  | "hard_brake"
  | "rapid_accel"
  | "sharp_turn"
  | "lane_drift"
  | "overspeed";

interface DemoEventConfig {
  durationMs: number;
}

const EVENT_CONFIGS: Record<DemoEventType, DemoEventConfig> = {
  hard_brake: { durationMs: 1500 },
  rapid_accel: { durationMs: 1500 },
  sharp_turn: { durationMs: 1200 },
  lane_drift: { durationMs: 2500 },
  // Dai hon cac event kia mot chut - "vuot toc do" thuong keo dai ca doan
  // duong chu khong phai 1 khoanh khac ngan nhu phanh/tang toc dot ngot.
  overspeed: { durationMs: 3000 },
};

const LANE_DRIFT_OFFSET_M = 3.2; // ~1 lan duong pho o VN, du de thay ro
const SHARP_TURN_OFFSET_M = 2.2; // dao dong nhe hon lane_drift - "lang lach"
const EARTH_RADIUS_M = 6371000;

// Dich 1 diem GPS theo huong bearingDeg, khoang cach distanceM - xap xi
// phang (equirectangular), du chinh xac cho offset vai met, khong can
// cong thuc great-circle day du cho quy mo nay.
function offsetPoint(
  lat: number,
  lng: number,
  bearingDeg: number,
  distanceM: number,
): { latitude: number; longitude: number } {
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const dLat = (distanceM * Math.cos(bearingRad)) / EARTH_RADIUS_M;
  const dLng =
    (distanceM * Math.sin(bearingRad)) /
    (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180));
  return {
    latitude: lat + (dLat * 180) / Math.PI,
    longitude: lng + (dLng * 180) / Math.PI,
  };
}

export interface DemoTickData {
  latitude: number;
  longitude: number;
  speedMps: number;
  headingDeg: number;
}

export type DemoStatus = "idle" | "loading" | "running" | "arrived" | "error";

// Noi suy tuyen tinh: goc cang gan SHARP_TURN_ANGLE_DEG, toc do cang
// gan MIN_TURN_SPEED_MPS. Duoi TURN_ANGLE_THRESHOLD_DEG khong goi ham
// nay (khong tinh la cua, giu jitter binh thuong).
function speedForTurnAngle(angleDeg: number): number {
  const clamped = Math.min(angleDeg, SHARP_TURN_ANGLE_DEG);
  const ratio =
    (clamped - TURN_ANGLE_THRESHOLD_DEG) /
    (SHARP_TURN_ANGLE_DEG - TURN_ANGLE_THRESHOLD_DEG);
  return TURN_SPEED_MPS - ratio * (TURN_SPEED_MPS - MIN_TURN_SPEED_MPS);
}

export function useDemoRouteSimulation(
  start: RoutePoint | null,
  destination: RoutePoint | null,
  onTick: (data: DemoTickData) => void,
  onArrived: () => void,
) {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [distanceRemainingKm, setDistanceRemainingKm] = useState<number | null>(
    null,
  );
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const routeRef = useRef<RoutePoint[]>([]);
  const cumDistRef = useRef<number[]>([]);
  const currentSpeedRef = useRef(BASE_SPEED_MPS);
  const distIntoRouteRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivedRef = useRef(false);
  // Event dang mo phong (null = khong co gi dang chay). Doc/ghi tu ca
  // tick loop (setInterval) lan ham triggerEvent goi tu ben ngoai - dung
  // ref (khong phai state) vi khong can re-render khi doi, chi can gia
  // tri moi nhat luc tick tiep theo chay.
  const activeEventRef = useRef<{
    type: DemoEventType;
    startedAt: number;
  } | null>(null);

  useEffect(() => {
    if (!start || !destination) return;
    let cancelled = false;
    arrivedRef.current = false;
    setStatus("loading");

    (async () => {
      const coords = await fetchOsrmRoute(start, destination);
      if (cancelled) return;
      if (!coords || coords.length < 2) {
        setStatus("error");
        return;
      }

      const cumDist = [0];
      for (let i = 1; i < coords.length; i++) {
        cumDist.push(
          cumDist[i - 1] +
            computeDistanceMeters(
              coords[i - 1].latitude,
              coords[i - 1].longitude,
              coords[i].latitude,
              coords[i].longitude,
            ),
        );
      }
      routeRef.current = coords;
      cumDistRef.current = cumDist;
      distIntoRouteRef.current = 0;
      setStatus("running");

      timerRef.current = setInterval(() => {
        const route = routeRef.current;
        const cumDist = cumDistRef.current;
        const total = cumDist[cumDist.length - 1];

        // Tim doan hien tai (theo vi tri DA di duoc tu buoc truoc) de xet
        // co dang o khuc cua khong -> quyet dinh toc do buoc nay.
        let idx = 1;
        while (
          idx < cumDist.length &&
          cumDist[idx] < distIntoRouteRef.current
        ) {
          idx++;
        }
        idx = Math.min(idx, route.length - 1);

        let turnAngleDeg = 0;
        if (idx < route.length - 1) {
          const prevBearing = computeBearing(
            route[idx - 1].latitude,
            route[idx - 1].longitude,
            route[idx].latitude,
            route[idx].longitude,
          );
          const nextBearing = computeBearing(
            route[idx].latitude,
            route[idx].longitude,
            route[idx + 1].latitude,
            route[idx + 1].longitude,
          );
          turnAngleDeg = angleDiff(prevBearing, nextBearing);
        }
        const isTurning = turnAngleDeg > TURN_ANGLE_THRESHOLD_DEG;

        let speed: number;
        if (isTurning) {
          speed = speedForTurnAngle(turnAngleDeg);
          currentSpeedRef.current = speed;
        } else {
          const jitterTarget =
            BASE_SPEED_MPS * (1 + (Math.random() * 2 - 1) * SPEED_JITTER_RATIO);
          currentSpeedRef.current +=
            (jitterTarget - currentSpeedRef.current) * SPEED_SMOOTHING;
          speed = currentSpeedRef.current;
        }

        // --- Debug event override (nut gia lap) ---------------------------
        // Kiem tra/don dep event het han truoc, roi ap dung len speed neu
        // con dang active. Chi 3 loai anh huong TOC DO (hard_brake giam
        // manh, rapid_accel/overspeed tang manh) - sharp_turn/lane_drift
        // anh huong VI TRI NGANG, xu ly rieng ben duoi sau khi noi suy toa
        // do tam thoi (offset khong duoc lam sai lech distIntoRouteRef -
        // quang duong "thuc" doc theo tim duong van phai tinh dung, chi
        // diem hien thi cuoi cung moi bi lech).
        let eventElapsedMs = 0;
        const activeEvent = activeEventRef.current;
        if (activeEvent) {
          eventElapsedMs = Date.now() - activeEvent.startedAt;
          if (eventElapsedMs >= EVENT_CONFIGS[activeEvent.type].durationMs) {
            activeEventRef.current = null; // het han, don dep
          } else if (activeEvent.type === "hard_brake") {
            // Giam nhanh ve gan 0 - khong tra ve tu dong trong event, de
            // SPEED_SMOOTHING tick thuong sau do tu keo dan len lai (nhin
            // giong "tha ga tu tu sau khi phanh" hon la bat len ngay lap tuc).
            speed = Math.max(0.3, speed * 0.08);
            currentSpeedRef.current = speed;
          } else if (
            activeEvent.type === "rapid_accel" ||
            activeEvent.type === "overspeed"
          ) {
            speed = speed * 3;
            currentSpeedRef.current = speed;
          }
        }

        distIntoRouteRef.current += speed * (STEP_INTERVAL_MS / 1000);
        const clampedDist = Math.min(distIntoRouteRef.current, total);

        // Noi suy vi tri tai clampedDist doc theo polyline.
        let segIdx = 1;
        while (segIdx < cumDist.length && cumDist[segIdx] < clampedDist) {
          segIdx++;
        }
        segIdx = Math.min(segIdx, route.length - 1);
        const segStart = cumDist[segIdx - 1];
        const segEnd = cumDist[segIdx];
        const segLen = segEnd - segStart;
        const ratio = segLen > 1e-6 ? (clampedDist - segStart) / segLen : 0;
        const p1 = route[segIdx - 1];
        const p2 = route[segIdx];
        const latitude = p1.latitude + (p2.latitude - p1.latitude) * ratio;
        const longitude = p1.longitude + (p2.longitude - p1.longitude) * ratio;
        const headingDeg = computeBearing(
          p1.latitude,
          p1.longitude,
          p2.latitude,
          p2.longitude,
        );

        // --- Debug event override: lech ngang (sharp_turn/lane_drift) -----
        // Chi doi diem HIEN THI cuoi cung, khong dung distIntoRouteRef -
        // xem giai thich o khoi override toc do phia tren.
        let displayLatitude = latitude;
        let displayLongitude = longitude;
        if (
          activeEventRef.current &&
          (activeEventRef.current.type === "lane_drift" ||
            activeEventRef.current.type === "sharp_turn")
        ) {
          const cfg = EVENT_CONFIGS[activeEventRef.current.type];
          const t = Math.min(1, eventElapsedMs / cfg.durationMs);
          let offsetM = 0;
          if (activeEventRef.current.type === "lane_drift") {
            // Hinh thang: lech dan sang trong 30% dau, giu nguyen giua,
            // tra ve dan trong 30% cuoi - nhin muot, khong giat cuc.
            const RAMP = 0.3;
            if (t < RAMP) offsetM = (t / RAMP) * LANE_DRIFT_OFFSET_M;
            else if (t < 1 - RAMP) offsetM = LANE_DRIFT_OFFSET_M;
            else offsetM = ((1 - t) / RAMP) * LANE_DRIFT_OFFSET_M;
          } else {
            // sharp_turn: dao dong 2 chu ky trai-phai - mo phong lang lach
            // nhanh, khac han kieu lech-giu 1 huong cua lane_drift.
            offsetM = Math.sin(t * Math.PI * 4) * SHARP_TURN_OFFSET_M;
          }
          const offset = offsetPoint(
            latitude,
            longitude,
            headingDeg + 90, // vuong goc ben phai huong di
            offsetM,
          );
          displayLatitude = offset.latitude;
          displayLongitude = offset.longitude;
        }

        onTick({
          latitude: displayLatitude,
          longitude: displayLongitude,
          speedMps: speed,
          headingDeg,
        });

        const remainingM = Math.max(0, total - clampedDist);
        setDistanceRemainingKm(remainingM / 1000);
        setEtaSeconds(speed > 0 ? remainingM / speed : 0);

        if (remainingM <= ARRIVAL_THRESHOLD_M && !arrivedRef.current) {
          arrivedRef.current = true;
          setStatus("arrived");
          if (timerRef.current) clearInterval(timerRef.current);
          onArrived();
        }
      }, STEP_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    start?.latitude,
    start?.longitude,
    destination?.latitude,
    destination?.longitude,
  ]);

  // Ham imperative goi tu ben ngoai (vd onPress nut gia lap) - chi ghi
  // vao ref, tick loop tu doc va xu ly nhu mo ta o tren. Neu dang co event
  // khac chay do, event moi ghi de len (khong queue) - dung cho muc dich
  // demo don gian, khong can hang doi phuc tap.
  function triggerEvent(type: DemoEventType) {
    activeEventRef.current = { type, startedAt: Date.now() };
  }

  return { status, distanceRemainingKm, etaSeconds, triggerEvent };
}
