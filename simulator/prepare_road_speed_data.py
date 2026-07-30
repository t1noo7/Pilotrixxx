"""
Chay 1 LAN DUY NHAT (khong phai phan chay luc demo) de tai du lieu
duong + maxspeed tu Overpass API cho khu vuc trung tam Ha Noi -> san bay
Noi Bai, luu ra file JSON local. simulator doc file nay lup offline,
KHONG goi Overpass luc chay/demo (Overpass public hay timeout/rate-limit,
khong on dinh bang OSRM demo server).

Chay: python prepare_road_speed_data.py
Output: data/hanoi_road_speeds.json
"""

import json
import re
import time
from pathlib import Path

import requests

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
OVERPASS_TIMEOUT_SECONDS = 240

# south, west, north, east - hanh lang trung tam Ha Noi -> san bay Noi Bai
BBOX = (20.97, 105.75, 21.27, 105.91)

# Chi lay cac loai duong xe hoi thuc su di duoc - loai bo via he, duong
# danh cho xe dap, duong mon...
DRIVABLE_HIGHWAY_TYPES = [
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "motorway_link",
    "trunk_link",
    "primary_link",
    "secondary_link",
    "tertiary_link",
]

# Fallback maxspeed (km/h) theo highway type khi way khong co tag maxspeed
# (rat pho bien o VN - da so duong KHONG duoc tag maxspeed tren OSM).
DEFAULT_SPEED_BY_HIGHWAY = {
    "motorway": 90,
    "motorway_link": 60,
    "trunk": 80,
    "trunk_link": 50,
    "primary": 60,
    "primary_link": 40,
    "secondary": 50,
    "secondary_link": 35,
    "tertiary": 40,
    "tertiary_link": 30,
    "unclassified": 40,
    "residential": 30,
    "living_street": 20,
    "road": 40,
}
DEFAULT_FALLBACK_SPEED = 40  # neu highway type la khac, khong co trong bang tren


def _parse_maxspeed(raw: str | None):
    """OSM maxspeed tag co the la '50', '50 mph', 'signals', 'VN:urban'...
    Chi lay so nguyen dau tien tim duoc, bo qua neu khong parse duoc."""
    if not raw:
        return None
    match = re.search(r"\d+", raw)
    if match:
        return int(match.group())
    return None


def fetch_ways():
    highway_regex = "|".join(DRIVABLE_HIGHWAY_TYPES)
    # 2 nhanh OR:
    # 1. Duong lon (motorway...tertiary) - lay het, maxspeed thuc te da dang
    # 2. Duong bat ky loai gi NHUNG co tag maxspeed - vet cac truong hop
    #    dac biet (khu dan cu/truong hoc co bien bao rieng) ma khong keo
    #    theo toan bo ngo hem vo danh (khong co tag, se ve fallback co dinh
    #    theo type nen tai ve cung vo ich, chi ton dung luong).
    query = f"""
    [out:json][timeout:{OVERPASS_TIMEOUT_SECONDS}];
    (
      way["highway"~"^({highway_regex})$"]
        ({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
      way["highway"]["maxspeed"]
        ({BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]});
    );
    out geom;
    """
    print("[prepare] Dang goi Overpass API, co the mat 30-90s...")
    headers = {
        "User-Agent": "Pilotrix-DATN-simulator/1.0 (thesis project, non-commercial)"
    }
    resp = requests.post(
        OVERPASS_URL,
        data={"data": query},
        headers=headers,
        timeout=OVERPASS_TIMEOUT_SECONDS,
    )
    if not resp.ok:
        print(f"[prepare] Overpass tra loi {resp.status_code}:\n{resp.text[:500]}")
    resp.raise_for_status()
    return resp.json()["elements"]


def main():
    elements = fetch_ways()
    print(f"[prepare] Nhan duoc {len(elements)} way tu Overpass.")

    ways_out = []
    missing_tag_count = 0
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        tags = el.get("tags", {})
        highway_type = tags.get("highway", "unclassified")
        maxspeed = _parse_maxspeed(tags.get("maxspeed"))
        if maxspeed is None:
            missing_tag_count += 1
            maxspeed = DEFAULT_SPEED_BY_HIGHWAY.get(
                highway_type, DEFAULT_FALLBACK_SPEED
            )

        coords = [(pt["lat"], pt["lon"]) for pt in el["geometry"]]
        if len(coords) < 2:
            continue

        ways_out.append(
            {
                "way_id": el["id"],
                "highway": highway_type,
                "maxspeed": maxspeed,
                "coords": coords,
            }
        )

    print(
        f"[prepare] {len(ways_out)} way hop le, "
        f"{missing_tag_count} way dung fallback (khong co tag maxspeed)."
    )

    out_path = Path(__file__).parent / "data" / "hanoi_road_speeds.json"
    out_path.parent.mkdir(exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"bbox": BBOX, "ways": ways_out}, f, ensure_ascii=False)

    print(f"[prepare] Da luu {out_path} ({out_path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
