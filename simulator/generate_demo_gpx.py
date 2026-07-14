"""
generate_demo_gpx.py - Sinh file GPX cho route demo Ha Noi (dung cho Xcode
Simulator: Debug -> Simulate Location -> Add GPX File to Project).

Cach dung:
    python generate_demo_gpx.py

Flow:
  1. Geocode tung dia chi trong WAYPOINTS qua Nominatim (OpenStreetMap) -> lat/lon
  2. Goi OSRM demo server /route voi tat ca waypoint theo dung thu tu -> duong
     di THAT (bam theo duong xa that, giong cach run_fleet.py dang dung)
  3. Resample toa do theo AVG_SPEED_KMH de tinh <time> tang dan hop ly
  4. Xuat ra file .gpx - import vao Xcode: Debug > Simulate Location >
     Add GPX File to Project... roi chon no khi chay Simulator.

Luu y: Nominatim yeu cau delay >=1s/request va User-Agent hop le (dieu
khoan su dung), OSRM demo server la public/free (dung 1 lan de chuan bi
demo la on, dung lap lai qua nhieu de tranh vi pham usage policy).
"""

import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

# ---------------------------------------------------------------------------
# Cau hinh
# ---------------------------------------------------------------------------

# Thu tu diem tren tuyen - sua lai neu muon doi diem dau/cuoi/trung gian.
# Moi phan tu co the la:
#   - chuoi dia chi (str)          -> tu dong geocode qua Nominatim
#   - tuple toa do (lat, lon)      -> dung thang, KHONG geocode (dung khi
#     Nominatim khong tim ra dia chi nho nhu ngo/hem - lay toa do bang cach
#     long-press dung vi tri tren Google Maps roi copy so hien ra ben duoi)
WAYPOINTS = [
    "18 Pho Vien, Duc Thang, Bac Tu Liem, Ha Noi, Vietnam",       # DH Mo - Dia chat
    "Ho Tay, Tay Ho, Ha Noi, Vietnam",                             # Ho Tay
    "Ho Hoan Kiem, Hoan Kiem, Ha Noi, Vietnam",                    # Ho Guom
    (21.006378, 105.860872),                                      # Diem den - THAY BANG TOA DO THAT lay tu Google Maps (so nay chi la vi du gan dung khu Kim Nguu, kiem tra lai truoc khi chay)
]

MAX_SPEED_KMH = 35.0        # toc do o doan duong thang - chinh de nhanh/cham hon
MIN_TURN_SPEED_KMH = 12.0   # toc do toi thieu luc vao cua gap (>=60 do doi huong)
POINT_SPACING_METERS = 15   # khoang cach giua 2 diem GPX lien tiep
OUTPUT_FILE = "hanoi_demo_route.gpx"
OUTPUT_SPEED_CSV = "hanoi_demo_route_speeds.csv"  # dung cho run_demo_route.py

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
OSRM_URL = "https://router.project-osrm.org/route/v1/driving/"
USER_AGENT = "Pilotrix-ThesisDemo/1.0 (student project, non-commercial)"


def geocode(address: str) -> tuple[float, float]:
    """Tra ve (lat, lon) cho 1 dia chi qua Nominatim."""
    params = urllib.parse.urlencode({"q": address, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if not data:
        raise RuntimeError(f"Khong tim thay toa do cho dia chi: {address}")
    return float(data[0]["lat"]), float(data[0]["lon"])


def get_route(coords: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Goi OSRM, tra ve list (lat, lon) doc theo duong di that."""
    # OSRM can lon,lat (nguoc voi thu tu thong thuong lat,lon)
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in coords)
    url = f"{OSRM_URL}{coord_str}?overview=full&geometries=geojson"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read())
    if data.get("code") != "Ok":
        raise RuntimeError(f"OSRM loi: {data.get('message', data.get('code'))}")
    # GeoJSON tra ve [lon, lat] - dao lai thanh (lat, lon)
    geometry = data["routes"][0]["geometry"]["coordinates"]
    return [(lat, lon) for lon, lat in geometry]


def haversine_m(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    from math import radians, sin, cos, sqrt, atan2

    R = 6371000
    lat1, lon1 = radians(p1[0]), radians(p1[1])
    lat2, lon2 = radians(p2[0]), radians(p2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * atan2(sqrt(a), sqrt(1 - a))


def resample(points: list[tuple[float, float]], spacing_m: float) -> list[tuple[float, float]]:
    """OSRM tra ve diem khong deu khoang cach - chen them diem cho deu hon,
    de toc do gia lap on dinh thay vi giat cuc khi 2 diem goc cach xa nhau."""
    if not points:
        return []
    out = [points[0]]
    for i in range(1, len(points)):
        prev = out[-1]
        cur = points[i]
        dist = haversine_m(prev, cur)
        if dist <= spacing_m:
            out.append(cur)
            continue
        steps = int(dist // spacing_m)
        for s in range(1, steps + 1):
            frac = (s * spacing_m) / dist
            lat = prev[0] + (cur[0] - prev[0]) * frac
            lon = prev[1] + (cur[1] - prev[1]) * frac
            out.append((lat, lon))
        out.append(cur)
    return out


def bearing_deg(p1: tuple[float, float], p2: tuple[float, float]) -> float:
    from math import radians, degrees, sin, cos, atan2

    lat1, lon1 = radians(p1[0]), radians(p1[1])
    lat2, lon2 = radians(p2[0]), radians(p2[1])
    dlon = lon2 - lon1
    y = sin(dlon) * cos(lat2)
    x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dlon)
    return (degrees(atan2(y, x)) + 360) % 360


def compute_speed_profile(
    points: list[tuple[float, float]], max_speed_kmh: float, min_turn_speed_kmh: float
) -> list[float]:
    """Tinh toc do muc tieu (km/h) cho tung diem, dua theo do doi huong
    (bearing) giua doan truoc va doan sau - doi huong cang nhieu (cua cang
    gap) thi toc do cang giam, gan 0 do doi huong (duong thang) thi giu
    max_speed_kmh."""
    n = len(points)
    speeds = [max_speed_kmh] * n
    for i in range(1, n - 1):
        b1 = bearing_deg(points[i - 1], points[i])
        b2 = bearing_deg(points[i], points[i + 1])
        turn = abs((b2 - b1 + 180) % 360 - 180)  # 0-180 do, 0 = di thang
        # turn >= 60 do -> giam ve toc do toi thieu; noi suy tuyen tinh o giua
        factor = max(0.0, 1 - turn / 60)
        speeds[i] = min_turn_speed_kmh + (max_speed_kmh - min_turn_speed_kmh) * factor
    return speeds


def write_speed_csv(points: list[tuple[float, float]], speeds: list[float], path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write("lat,lon,speed_kmh\n")
        for (lat, lon), spd in zip(points, speeds):
            f.write(f"{lat:.6f},{lon:.6f},{spd:.1f}\n")


def write_gpx(points: list[tuple[float, float]], speeds: list[float], path: str) -> None:
    start = datetime.now(timezone.utc)
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="Pilotrix">',
        "  <trk><name>Hanoi Demo Route</name><trkseg>",
    ]
    t = start
    for i, (lat, lon) in enumerate(points):
        if i > 0:
            dist = haversine_m(points[i - 1], points[i])
            speed_mps = max(speeds[i], 3.0) * 1000 / 3600  # toi thieu 3km/h tranh chia ~0
            t += timedelta(seconds=dist / speed_mps)
        iso = t.strftime("%Y-%m-%dT%H:%M:%SZ")
        lines.append(f'    <trkpt lat="{lat:.6f}" lon="{lon:.6f}"><time>{iso}</time></trkpt>')
    lines.append("  </trkseg></trk>")
    lines.append("</gpx>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    print("1/3 - Geocode cac diem qua Nominatim (bo qua neu da la toa do)...")
    coords = []
    for wp in WAYPOINTS:
        if isinstance(wp, tuple):
            lat, lon = wp
            print(f"    (toa do co san) -> ({lat:.6f}, {lon:.6f})")
        else:
            lat, lon = geocode(wp)
            print(f"    {wp} -> ({lat:.6f}, {lon:.6f})")
            time.sleep(1.1)  # ton trong ratelimit 1 req/s cua Nominatim
        coords.append((lat, lon))

    print("2/3 - Lay duong di that tu OSRM...")
    route_points = get_route(coords)
    print(f"    OSRM tra ve {len(route_points)} diem goc")

    print("3/3 - Resample + tinh toc do theo do cong + xuat file...")
    resampled = resample(route_points, POINT_SPACING_METERS)
    speeds = compute_speed_profile(resampled, MAX_SPEED_KMH, MIN_TURN_SPEED_KMH)
    write_gpx(resampled, speeds, OUTPUT_FILE)
    write_speed_csv(resampled, speeds, OUTPUT_SPEED_CSV)
    total_dist_km = sum(
        haversine_m(resampled[i - 1], resampled[i]) for i in range(1, len(resampled))
    ) / 1000
    print(f"    Da tao {OUTPUT_FILE} va {OUTPUT_SPEED_CSV} voi {len(resampled)} diem "
          f"(~{total_dist_km:.1f}km, toc do {MIN_TURN_SPEED_KMH}-{MAX_SPEED_KMH}km/h tuy khuc cua)")


if __name__ == "__main__":
    main()
