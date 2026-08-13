"""
Export 3 lớp chất khí (NO2, CO, SO2) từ Sentinel-5P/TROPOMI qua Google
Earth Engine cho khu vực Hà Nội - dùng cho các lớp overlay viễn thám
môi trường trên dashboard Pilotrix (kết hợp với lớp Driving Risk).

Cài đặt (dùng lại venv-gis cũ là đủ, không cần cài lại):
    pip install earthengine-api
    earthengine authenticate   # chỉ cần 1 lần

Chạy:
    python gee_export_pollutants.py --project pilotrix-airquality
"""

import argparse
import json
import ee


# Fallback bbox CHỈ dùng khi không tìm được ranh giới hành chính thật
# (xem get_hanoi_boundary). Bbox thật sự dùng để export sẽ được TÍNH TỰ
# ĐỘNG từ polygon Hà Nội thật, không dùng giá trị hardcode này nữa - lần
# trước dùng cứng giá trị này đã lỡ cắt cụt mất phần đuôi phía Nam của
# Hà Nội (khu vực sáp nhập từ Hà Tây cũ, kéo dài tới giáp Hoà Bình).
FALLBACK_BBOX = {
    "min_lon": 105.70,
    "min_lat": 20.90,
    "max_lon": 105.95,
    "max_lat": 21.15,
}

POLLUTANTS = {
    "NO2": {
        "collection": "COPERNICUS/S5P/OFFL/L3_NO2",
        "band": "tropospheric_NO2_column_number_density",
        "vis_min": 0,
        "vis_max": 0.0002,
        "unit": "mol/m^2",
    },
    "CO": {
        "collection": "COPERNICUS/S5P/OFFL/L3_CO",
        "band": "CO_column_number_density",
        "vis_min": 0,
        "vis_max": 0.05,
        "unit": "mol/m^2",
    },
    "SO2": {
        "collection": "COPERNICUS/S5P/OFFL/L3_SO2",
        "band": "SO2_column_number_density",
        "vis_min": -0.001,
        "vis_max": 0.005,
        "unit": "mol/m^2",
    },
}

VIS_PALETTE = ["blue", "cyan", "green", "yellow", "red"]


def get_hanoi_boundary() -> ee.Geometry:
    """Lấy ranh giới hành chính THẬT của Hà Nội từ FAO GAUL, lọc theo
    TOẠ ĐỘ điểm trung tâm (không lọc theo tên - tránh lỗi chính tả/dấu)."""
    gaul = ee.FeatureCollection("FAO/GAUL/2015/level1")
    hanoi_center = ee.Geometry.Point([105.8542, 21.0285])
    matched = gaul.filterBounds(hanoi_center)

    if matched.size().getInfo() == 0:
        print(
            "[CẢNH BÁO] Không tìm thấy ranh giới Hà Nội trong FAO GAUL "
            "- dùng tạm bbox chữ nhật fallback."
        )
        return ee.Geometry.Rectangle(
            [
                FALLBACK_BBOX["min_lon"],
                FALLBACK_BBOX["min_lat"],
                FALLBACK_BBOX["max_lon"],
                FALLBACK_BBOX["max_lat"],
            ]
        )

    matched_name = matched.first().get("ADM1_NAME").getInfo()
    print(f"[OK] Tìm thấy ranh giới: '{matched_name}'")
    return matched.geometry()


def compute_region_and_bounds(boundary: ee.Geometry):
    """
    Tính bbox export TỰ ĐỘNG từ chính polygon ranh giới thật, thay vì
    hardcode - đảm bảo bao trọn toàn bộ hình dạng Hà Nội (kể cả phần
    đuôi phía Nam), không bị cắt cụt như lần trước.
    Trả về (ee.Geometry.Rectangle để export, bounds dạng Leaflet).
    """
    coords = boundary.bounds().coordinates().getInfo()[0]
    lons = [pt[0] for pt in coords]
    lats = [pt[1] for pt in coords]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)

    region = ee.Geometry.Rectangle([min_lon, min_lat, max_lon, max_lat])
    leaflet_bounds = [[min_lat, min_lon], [max_lat, max_lon]]
    print(
        f"[bbox thật, tự tính] lon: {min_lon:.4f}..{max_lon:.4f}, "
        f"lat: {min_lat:.4f}..{max_lat:.4f}"
    )
    return region, leaflet_bounds


def compute_data_driven_vis_range(image: ee.Image, boundary: ee.Geometry, band: str):
    """
    Tính lại vis_min/vis_max theo PHÂN VỊ 2%-98% của dữ liệu THẬT trong
    vùng Hà Nội (kỹ thuật "min-max stretch" chuẩn trong viễn thám) -
    thay vì dùng khoảng giá trị cố định "điển hình sách vở". Lý do:
    debug cho thấy CO/SO2 có biến thiên không gian thật RẤT HẸP so với
    khoảng "điển hình" toàn cầu -> dùng thang cố định làm ảnh gần như 1
    màu đặc, không phải bug, chỉ là thang hiển thị không khớp dữ liệu.
    KHÔNG thay đổi dữ liệu gốc, chỉ đổi cách TÔ MÀU để lộ rõ biến thiên
    thật đang có - phải ghi rõ điều này trong báo cáo nếu so sánh giá
    trị màu giữa các chất khí (vì mỗi chất giờ có thang màu riêng, không
    dùng chung 1 thang tuyệt đối).
    """
    stats = image.reduceRegion(
        reducer=ee.Reducer.percentile([2, 98]),
        geometry=boundary,
        scale=1113,
        maxPixels=1e9,
    ).getInfo()

    vis_min = stats.get(f"{band}_p2")
    vis_max = stats.get(f"{band}_p98")

    if vis_min is None or vis_max is None or vis_min >= vis_max:
        return None  # bao hieu goi cho dung fallback co dinh
    return vis_min, vis_max


def debug_print_mean_value(name: str, image: ee.Image, boundary: ee.Geometry):
    band_name = image.bandNames().get(0)
    stats = image.reduceRegion(
        reducer=ee.Reducer.mean().combine(ee.Reducer.count(), sharedInputs=True),
        geometry=boundary,
        scale=1113,
        maxPixels=1e9,
    ).getInfo()
    print(f"[{name}] debug reduceRegion: {stats}")


def export_pollutant(
    name: str,
    cfg: dict,
    start_date: str,
    end_date: str,
    boundary: ee.Geometry,
    region: ee.Geometry,
) -> str:
    collection = (
        ee.ImageCollection(cfg["collection"])
        .select(cfg["band"])
        .filterDate(start_date, end_date)
        .filterBounds(region)
    )
    mean_image = collection.mean().clip(boundary)

    debug_print_mean_value(name, mean_image, boundary)

    dynamic_range = compute_data_driven_vis_range(mean_image, boundary, cfg["band"])
    if dynamic_range:
        vis_min, vis_max = dynamic_range
        print(
            f"[{name}] Thang màu ĐỘNG (phân vị 2-98% dữ liệu thật): "
            f"{vis_min:.6g} .. {vis_max:.6g} "
            f"(thang cố định gốc: {cfg['vis_min']:.6g} .. {cfg['vis_max']:.6g})"
        )
    else:
        vis_min, vis_max = cfg["vis_min"], cfg["vis_max"]
        print(f"[{name}] Không tính được thang động, dùng thang cố định gốc.")

    vis_params = {"min": vis_min, "max": vis_max, "palette": VIS_PALETTE}
    url = mean_image.visualize(**vis_params).getThumbURL(
        {
            "region": region,
            "dimensions": 1024,
            "format": "png",
        }
    )
    print(f"[{name}] Ảnh PNG: {url}")
    return url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--start", default="2026-06-01")
    parser.add_argument("--end", default="2026-08-01")
    parser.add_argument("--out", default="pollutants_hanoi_meta.json")
    args = parser.parse_args()

    ee.Initialize(project=args.project)

    boundary = get_hanoi_boundary()
    region, leaflet_bounds = compute_region_and_bounds(boundary)

    result = {"bounds_leaflet": leaflet_bounds, "layers": {}}

    for name, cfg in POLLUTANTS.items():
        url = export_pollutant(name, cfg, args.start, args.end, boundary, region)
        result["layers"][name] = {"image_url": url, "unit": cfg["unit"]}

    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nĐã lưu metadata cả 3 lớp vào: {args.out}")


if __name__ == "__main__":
    main()
