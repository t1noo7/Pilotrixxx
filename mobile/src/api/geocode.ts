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

// Tra ve NHIEU goi y (thay vi 1) - dung cho o nhap dia chi co dropdown
// autocomplete o man "chon diem den" (che do demo). Nominatim free-tier:
// ~1 request/giay, luon kem User-Agent rieng - du dung cho demo/bao ve,
// khong dung cho traffic lon (ghi chu han che nay trong bao cao).
export async function searchAddresses(
  query: string,
  limit: number = 5,
): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: String(limit),
    countrycodes: "vn",
  });
  const res = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
    headers: { "User-Agent": "Pilotrix-DoAnTotNghiep/1.0" },
  });
  if (!res.ok) throw new Error("Không kết nối được dịch vụ tìm địa chỉ");
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item: any) => ({
    latitude: parseFloat(item.lat),
    longitude: parseFloat(item.lon),
    displayName: item.display_name as string,
  }));
}
