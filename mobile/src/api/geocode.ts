// Goi truc tiep Nominatim (OpenStreetMap) tu mobile, khong qua backend -
// dung cach ma generate_demo_gpx.py dang dung o phia simulator, chi
// khac la goi tu client. Free, khong can API key, giup driver nhap dia
// chi bat ky de test/demo thay vi phai doi vi tri GPS Simulator.
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export async function geocodeAddress(
  query: string,
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "1",
    countrycodes: "vn",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { "User-Agent": "Pilotrix-DoAnTotNghiep/1.0" },
  });
  if (!res.ok) throw new Error("Không kết nối được dịch vụ tìm địa chỉ");
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  const { lat, lon, display_name } = data[0];
  return {
    latitude: parseFloat(lat),
    longitude: parseFloat(lon),
    displayName: display_name,
  };
}
