"""
Tra cuu maxspeed theo vi tri (lat, lng), dua tren du lieu OSM da tai san
tu prepare_road_speed_data.py. Load 1 lan luc import, KHONG goi network.
"""

import json
import math
from pathlib import Path

_DATA_PATH = Path(__file__).parent / "data" / "hanoi_road_speeds.json"

EARTH_RADIUS_KM = 6371.0

# Danh sach segment: (lat1, lng1, lat2, lng2, maxspeed) - dung cho tra cuu
_segments: list[tuple[float, float, float, float, int]] = []


def _load():
    global _segments
    if not _DATA_PATH.exists():
        print(
            f"[speed_limit_lookup] KHONG tim thay {_DATA_PATH} - "
            f"chay prepare_road_speed_data.py truoc. Fallback ve maxspeed=40 cho toan bo."
        )
        return
    with open(_DATA_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    segs = []
    for way in data["ways"]:
        coords = way["coords"]
        for i in range(len(coords) - 1):
            lat1, lng1 = coords[i]
            lat2, lng2 = coords[i + 1]
            segs.append((lat1, lng1, lat2, lng2, way["maxspeed"]))
    _segments = segs
    print(f"[speed_limit_lookup] Da load {len(_segments)} segment duong.")


def _point_to_segment_km(lat, lng, lat1, lng1, lat2, lng2, ref_lat) -> float:
    """Khoang cach xap xi (km) tu diem den doan thang, dung phep chieu
    phang (equirectangular) - du chinh xac cho pham vi bbox nho (~35km),
    nhanh hon nhieu so voi tinh haversine chinh xac cho tung diem tren doan."""
    km_per_deg_lat = 111.0
    km_per_deg_lng = 111.0 * math.cos(math.radians(ref_lat))

    x, y = lng * km_per_deg_lng, lat * km_per_deg_lat
    x1, y1 = lng1 * km_per_deg_lng, lat1 * km_per_deg_lat
    x2, y2 = lng2 * km_per_deg_lng, lat2 * km_per_deg_lat

    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)

    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    proj_x, proj_y = x1 + t * dx, y1 + t * dy
    return math.hypot(x - proj_x, y - proj_y)


MAX_MATCH_DISTANCE_KM = 0.05  # 50m - qua nguong nay coi nhu khong co duong lon nao gan
RESIDENTIAL_FALLBACK_SPEED = 30


def get_speed_limit(lat: float, lng: float) -> int:
    if not _segments:
        return 40

    best_dist = float("inf")
    best_speed = RESIDENTIAL_FALLBACK_SPEED
    for lat1, lng1, lat2, lng2, speed in _segments:
        d = _point_to_segment_km(lat, lng, lat1, lng1, lat2, lng2, lat)
        if d < best_dist:
            best_dist = d
            best_speed = speed

    if best_dist > MAX_MATCH_DISTANCE_KM:
        return RESIDENTIAL_FALLBACK_SPEED
    return best_speed


_load()
