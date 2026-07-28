import { useEffect, useState } from "react";
import { driverSocket } from "../api/socket";

type VehiclePosition = {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
  etaSeconds: number | null;
};

// Chi lo phan "nghe socket + giu vi tri xe moi nhat" - KHONG tu connect/
// disconnect driverSocket (waiting.tsx da lam roi o effect rieng, tranh
// 2 noi cung quan ly 1 vong doi ket noi).
export function useVehicleLiveTracking(
  tripId: string | number | undefined,
  initial: { latitude: number | null; longitude: number | null } | null,
) {
  const [position, setPosition] = useState<VehiclePosition | null>(
    initial?.latitude != null && initial?.longitude != null
      ? {
          latitude: initial.latitude,
          longitude: initial.longitude,
          heading: null,
          speed: null,
          etaSeconds: null,
        }
      : null,
  );

  // Cap nhat lai gia tri khoi tao neu hydrate xong SAU khi hook nay da
  // mount voi initial=null (dung getCurrentTrip la async).
  useEffect(() => {
    if (
      position == null &&
      initial?.latitude != null &&
      initial?.longitude != null
    ) {
      setPosition({
        latitude: initial.latitude,
        longitude: initial.longitude,
        heading: null,
        speed: null,
        etaSeconds: null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.latitude, initial?.longitude]);

  useEffect(() => {
    if (!tripId) return;
    const onPosition = (data: {
      tripId: number;
      latitude: number | null;
      longitude: number | null;
      heading: number | null;
      speed: number | null;
      etaSeconds: number | null;
    }) => {
      if (String(data.tripId) !== String(tripId)) return;
      if (data.latitude == null || data.longitude == null) return;
      setPosition({
        latitude: data.latitude,
        longitude: data.longitude,
        heading: data.heading,
        speed: data.speed,
        etaSeconds: data.etaSeconds,
      });
    };
    driverSocket.on("vehicle:position", onPosition);
    return () => {
      driverSocket.off("vehicle:position", onPosition);
    };
  }, [tripId]);

  return position;
}
