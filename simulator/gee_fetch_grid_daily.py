"""
Fetch luoi gia tri NO2 theo NGAY (khac gee_fetch_live.py - anh live theo
khoang thoi gian, dung cho heatmap hien thi) - dung cho tinh nang "Phoi
nhiem o nhiem theo tuyen duong". Fetch 1 LAN cho ca luoi bang
image.reduceRegions() tren 1 FeatureCollection diem luoi (KHONG loop
reduceRegion tung cell rieng le) - GEE tinh song song server-side,
nhanh hon nhieu va it round-trip hon.

Goi boi Node (aqiGridService.js) theo kieu lazy-cache: request dau tien
trong ngay can den du lieu se tu trigger script nay.

QUAN TRONG: chi in JSON ra stdout (Node parse), moi log day qua stderr -
dung pattern voi gee_fetch_live.py / predict.py.

Chay thu tay:
    export GEE_SERVICE_ACCOUNT_KEY='<noi dung file JSON key>'
    python gee_fetch_grid_daily.py --date 2026-09-23
"""

import argparse
import json
import sys
from datetime import datetime, timedelta

import ee

from gee_fetch_live import authenticate, get_hanoi_boundary_and_region, POLLUTANTS, log

GRID_STEP_DEG = 0.01  # ~1.1km
POLLUTANT = "NO2"  # co dinh NO2 cho tinh nang exposure (khi thai giao thong)
MEDIUM_PERCENTILE = 50  # nguong "AQI vua" = percentile p50
HIGH_PERCENTILE = 75  # nguong "AQI cao" = percentile p75 cua chinh luoi ngay do


def build_grid_points(bounds_leaflet):
    """
    Sinh danh sach diem luoi (lat, lng) phu kin bounding box, buoc GRID_STEP_DEG.
    bounds_leaflet: [[min_lat, min_lng], [max_lat, max_lng]].
    """
    (min_lat, min_lng), (max_lat, max_lng) = bounds_leaflet
    points = []
    lat = min_lat
    while lat <= max_lat:
        lng = min_lng
        while lng <= max_lng:
            points.append((round(lat, 2), round(lng, 2)))
            lng += GRID_STEP_DEG
        lat += GRID_STEP_DEG
    return points


def fetch_grid(date_str: str) -> dict:
    cfg = POLLUTANTS[POLLUTANT]
    boundary, region, bounds_leaflet = get_hanoi_boundary_and_region()
    points = build_grid_points(bounds_leaflet)
    features = [
        ee.Feature(ee.Geometry.Point([lng, lat]), {"cell_lat": lat, "cell_lng": lng})
        for lat, lng in points
    ]
    grid_fc = ee.FeatureCollection(features)
    log(f"[grid] {len(points)} diem luoi")

    # Anh S5P OFFL 1 NGAY DON co the bi may che kin TOAN BO vung (dac biet
    # mua mua He mien Bac, thang 6-8) - khien reduceRegions tra ve RONG cho
    # MOI diem (thieu du lieu that, khong phai loi code). Dung cua so trung
    # binh nhieu ngay lui ve truoc (giong tinh than gee_fetch_live.py dang
    # mean() ca 2 thang) de lap khoang trong do may che, kiem tra THAT bang
    # reduceRegions (khong chi dua vao collection.size() > 0, vi co anh
    # khong co nghia anh do co pixel hop le).
    WINDOW_DAYS = 3
    target_date = datetime.strptime(date_str, "%Y-%m-%d")
    cells, values, actual_range = [], [], None

    for days_back in range(0, 15):
        try_end = target_date - timedelta(days=days_back) + timedelta(days=1)
        try_start = try_end - timedelta(days=WINDOW_DAYS)
        start, end = try_start.strftime("%Y-%m-%d"), try_end.strftime("%Y-%m-%d")

        collection = (
            ee.ImageCollection(cfg["collection"])
            .select(cfg["band"])
            .filterDate(start, end)
            .filterBounds(region)
        )
        if collection.size().getInfo() == 0:
            continue

        mean_image = collection.mean().clip(boundary)
        sampled = mean_image.reduceRegions(
            collection=grid_fc,
            reducer=ee.Reducer.mean(),
            scale=1113,
        ).getInfo()

        cells, values = [], []
        for feat in sampled["features"]:
            props = feat["properties"]
            val = props.get(cfg["band"], props.get("mean"))
            if val is None:
                continue
            cells.append(
                {
                    "cell_lat": props["cell_lat"],
                    "cell_lng": props["cell_lng"],
                    "aqi_value": val,
                }
            )
            values.append(val)

        if cells:
            actual_range = f"{start}..{end}"
            if days_back > 0:
                log(
                    f"[grid] Ngay {date_str} khong du du lieu, lui {days_back} ngay -> cua so {actual_range}"
                )
            break
        log(
            f"[grid] Cua so {actual_range or f'{start}..{end}'} co anh nhung 0 pixel hop le (may che), thu lui tiep..."
        )

    if not cells:
        raise RuntimeError(
            f"Khong tim thay pixel NO2 hop le nao trong 15 lan thu lui tu {date_str}"
        )

    values.sort()
    high_idx = min(int(len(values) * HIGH_PERCENTILE / 100), len(values) - 1)
    medium_idx = min(int(len(values) * MEDIUM_PERCENTILE / 100), len(values) - 1)
    high_threshold = values[high_idx]
    medium_threshold = values[medium_idx]

    return {
        "date": target_date.strftime("%Y-%m-%d"),
        "actual_range": actual_range,
        "pollutant": POLLUTANT,
        "cell_count": len(cells),
        "cells": cells,
        "high_threshold": high_threshold,
        "medium_threshold": medium_threshold,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="YYYY-MM-DD")
    args = parser.parse_args()

    try:
        authenticate()
        result = fetch_grid(args.date)
        log(
            f"[grid] {result['cell_count']} cells, threshold p{MEDIUM_PERCENTILE}={result['medium_threshold']:.6g} p{HIGH_PERCENTILE}={result['high_threshold']:.6g}"
        )
        print(json.dumps(result))  # DUY NHAT dong nay in ra stdout
    except Exception as e:
        log(f"[LOI] {e}")
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
