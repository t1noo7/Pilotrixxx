"""
Fetch LIVE 1 lớp chất khí từ Sentinel-5P/TROPOMI - dùng cho backend gọi
on-demand mỗi khi người dùng chọn lớp vệ tinh trên dashboard (thay vì
ảnh tĩnh cố định). Auth bằng Service Account (đọc từ biến môi trường
GEE_SERVICE_ACCOUNT_KEY), KHÔNG dùng `earthengine authenticate` tương
tác vì server không có trình duyệt để đăng nhập.

QUAN TRỌNG: chỉ in JSON ra stdout (để Node parse), mọi log/debug khác
đẩy qua stderr - đúng pattern đã dùng ở ml/predict.py.

Chạy thử tay (không qua Node):
    export GEE_SERVICE_ACCOUNT_KEY='<noi dung file JSON key>'
    python gee_fetch_live.py --pollutant NO2
"""

import argparse
import json
import os
import sys
import ee


def log(msg: str):
    print(msg, file=sys.stderr)


POLLUTANTS = {
    "NO2": {
        "collection": "COPERNICUS/S5P/OFFL/L3_NO2",
        "band": "tropospheric_NO2_column_number_density",
        "vis_min": 0, "vis_max": 0.0002, "unit": "mol/m²",
        "label": "NO₂ (khí thải giao thông/công nghiệp)",
    },
    "CO": {
        "collection": "COPERNICUS/S5P/OFFL/L3_CO",
        "band": "CO_column_number_density",
        "vis_min": 0, "vis_max": 0.05, "unit": "mol/m²",
        "label": "CO (khí thải đốt cháy không hoàn toàn)",
    },
    "SO2": {
        "collection": "COPERNICUS/S5P/OFFL/L3_SO2",
        "band": "SO2_column_number_density",
        "vis_min": -0.001, "vis_max": 0.005, "unit": "mol/m²",
        "label": "SO₂ (khí thải công nghiệp/nhiên liệu hoá thạch)",
    },
}
VIS_PALETTE = ["blue", "cyan", "green", "yellow", "red"]


def authenticate():
    key_json = os.environ.get("GEE_SERVICE_ACCOUNT_KEY")
    if not key_json:
        raise RuntimeError("Thiếu biến môi trường GEE_SERVICE_ACCOUNT_KEY")
    key_data = json.loads(key_json)
    credentials = ee.ServiceAccountCredentials(
        key_data["client_email"], key_data=key_json
    )
    ee.Initialize(credentials, project=key_data.get("project_id"))
    log(f"[auth] OK - service account: {key_data['client_email']}")


def get_hanoi_boundary_and_region():
    gaul = ee.FeatureCollection("FAO/GAUL/2015/level1")
    hanoi_center = ee.Geometry.Point([105.8542, 21.0285])
    matched = gaul.filterBounds(hanoi_center)
    boundary = matched.geometry()

    coords = boundary.bounds().coordinates().getInfo()[0]
    lons = [pt[0] for pt in coords]
    lats = [pt[1] for pt in coords]
    region = ee.Geometry.Rectangle([min(lons), min(lats), max(lons), max(lats)])
    bounds_leaflet = [[min(lats), min(lons)], [max(lats), max(lons)]]
    return boundary, region, bounds_leaflet


def fetch_pollutant(name: str, start_date: str, end_date: str) -> dict:
    cfg = POLLUTANTS[name]
    boundary, region, bounds_leaflet = get_hanoi_boundary_and_region()

    collection = (
        ee.ImageCollection(cfg["collection"])
        .select(cfg["band"])
        .filterDate(start_date, end_date)
        .filterBounds(region)
    )
    mean_image = collection.mean().clip(boundary)

    stats = mean_image.reduceRegion(
        reducer=ee.Reducer.percentile([2, 98]),
        geometry=boundary, scale=1113, maxPixels=1e9,
    ).getInfo()
    vis_min = stats.get(f"{cfg['band']}_p2")
    vis_max = stats.get(f"{cfg['band']}_p98")
    if vis_min is None or vis_max is None or vis_min >= vis_max:
        vis_min, vis_max = cfg["vis_min"], cfg["vis_max"]
        log(f"[{name}] Dung thang co dinh fallback (khong tinh duoc thang dong)")
    else:
        log(f"[{name}] Thang dong: {vis_min:.6g} .. {vis_max:.6g}")

    url = mean_image.visualize(
        min=vis_min, max=vis_max, palette=VIS_PALETTE
    ).getThumbURL({"region": region, "dimensions": 1024, "format": "png"})

    return {
        "pollutant": name,
        "label": cfg["label"],
        "unit": cfg["unit"],
        "image_url": url,
        "vis_min": vis_min,
        "vis_max": vis_max,
        "bounds": bounds_leaflet,
        "fetched_at_range": f"{start_date}..{end_date}",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pollutant", required=True, choices=list(POLLUTANTS.keys()))
    parser.add_argument("--start", default="2026-06-01")
    parser.add_argument("--end", default="2026-08-01")
    args = parser.parse_args()

    try:
        authenticate()
        result = fetch_pollutant(args.pollutant, args.start, args.end)
        print(json.dumps(result))  # DUY NHAT dong nay in ra stdout
    except Exception as e:
        log(f"[LOI] {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
