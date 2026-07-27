import type { CurrentTrip } from "../types";

/**
 * Params dung chung khi dieu huong vao trip/[id].tsx tu 1 trip 'ongoing'
 * da co san (resume sau kill app) - gom demoMode/destination (luu ben
 * vung qua route-mode API) + vi tri xe cuoi cung (resume_latitude/
 * longitude, dung de noi tiep route demo dung mach thay vi bat dau lai
 * tu GPS that cua dien thoai luc mo lai app).
 */
export function buildTripScreenParams(current: CurrentTrip) {
  const base = {
    id: current.trip_id,
    vehicleType: current.vehicle_type,
    startedAt: current.started_at,
  };

  if (
    !current.demo_mode ||
    current.dest_latitude == null ||
    current.dest_longitude == null
  ) {
    return base;
  }

  return {
    ...base,
    demoMode: "1",
    destLat: String(current.dest_latitude),
    destLng: String(current.dest_longitude),
    ...(current.resume_latitude != null && current.resume_longitude != null
      ? {
          resumeLat: String(current.resume_latitude),
          resumeLng: String(current.resume_longitude),
        }
      : {}),
  };
}
