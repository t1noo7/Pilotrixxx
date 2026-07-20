// Goi truc tiep OSRM demo server tu mobile de lay tuyen duong THAT (bam
// theo duong, khong phai duong thang) cho che do demo - cung dich vu ma
// route_generator.py (simulator) dang dung, chi khac la goi tu client
// thay vi tu Python backend simulator.
export interface RoutePoint {
  latitude: number;
  longitude: number;
}

const OSRM_BASE_URL = "https://router.project-osrm.org/route/v1/driving";
const OSRM_TIMEOUT_MS = 8000;

export async function fetchOsrmRoute(
  start: RoutePoint,
  end: RoutePoint,
): Promise<RoutePoint[] | null> {
  const url = `${OSRM_BASE_URL}/${start.longitude},${start.latitude};${end.longitude},${end.latitude}?overview=full&geometries=geojson`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) return null;
    const coords = data.routes[0].geometry.coordinates as [number, number][];
    // GeoJSON tra ve [lng, lat] - dao lai (lat, lng) cho de dung trong app
    return coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  } catch {
    // Timeout, mat mang, OSRM loi... - man goi (destination.tsx / hook) tu
    // xu ly status='error' thay vi crash app.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
