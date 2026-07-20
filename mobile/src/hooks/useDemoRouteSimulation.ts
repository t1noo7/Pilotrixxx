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
const ARRIVAL_THRESHOLD_M = 30;

export interface DemoTickData {
  latitude: number;
  longitude: number;
  speedMps: number;
  headingDeg: number;
}

export type DemoStatus = "idle" | "loading" | "running" | "arrived" | "error";

export function useDemoRouteSimulation(
  start: RoutePoint | null,
  destination: RoutePoint | null,
  onTick: (data: DemoTickData) => void,
  onArrived: () => void,
) {
  const [status, setStatus] = useState<DemoStatus>("idle");
  const [distanceRemainingKm, setDistanceRemainingKm] = useState<
    number | null
  >(null);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);

  const routeRef = useRef<RoutePoint[]>([]);
  const cumDistRef = useRef<number[]>([]);
  const distIntoRouteRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const arrivedRef = useRef(false);

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

        let speed = BASE_SPEED_MPS;
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
          if (angleDiff(prevBearing, nextBearing) > TURN_ANGLE_THRESHOLD_DEG) {
            speed = TURN_SPEED_MPS;
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

        onTick({ latitude, longitude, speedMps: speed, headingDeg });

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

  return { status, distanceRemainingKm, etaSeconds };
}
