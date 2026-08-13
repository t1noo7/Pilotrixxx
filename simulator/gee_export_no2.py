"""
Export lớp NO2 tầng đối lưu (Sentinel-5P/TROPOMI) cho khu vực Hà Nội
qua Google Earth Engine — dùng cho lớp dữ liệu viễn thám môi trường
overlay trên bản đồ tuyến đường của Pilotrix.

Cài đặt (chạy 1 lần trên máy):
    pip install earthengine-api --break-system-packages
    earthengine authenticate   # mở trình duyệt, đăng nhập Google 1 lần

Chạy:
    python gee_export_no2.py --project YOUR_PROJECT_ID
"""

import argparse
import json
import ee


# Bounding box Hà Nội (đủ rộng để bao các quận trung tâm + khu vực demo route)
HANOI_BBOX = {
    "min_lon": 105.70,
    "min_lat": 20.90,
    "max_lon": 105.95,
    "max_lat": 21.15,
}


def build_no2_image(start_date: str, end_date: str) -> ee.Image:
    """Tạo ảnh trung bình NO2 tầng đối lưu trong khoảng thời gian, đã lọc mây/chất lượng thấp."""
    collection = (
        ee.ImageCollection("COPERNICUS/S5P/OFFL/L3_NO2")
        .select("tropospheric_NO2_column_number_density")
        .filterDate(start_date, end_date)
        .filterBounds(ee.Geometry.Rectangle(
            [HANOI_BBOX["min_lon"], HANOI_BBOX["min_lat"],
             HANOI_BBOX["max_lon"], HANOI_BBOX["max_lat"]]
        ))
    )
    # Trung bình theo thời gian để loại nhiễu/mây của từng lần bay qua đơn lẻ
    mean_image = collection.mean()

    # ĐÃ THỬ resample("bilinear") + reproject() để làm mượt hiển thị,
    # nhưng cả 2 lần test thực tế đều làm PHẲNG LÌ mất luôn tín hiệu thật
    # (vùng NO2 cao ở trung tâm biến mất) - rủi ro cao hơn lợi ích trước
    # hội đồng. QUYẾT ĐỊNH: giữ nguyên ảnh gốc, chấp nhận vỡ khối - đây là
    # đặc trưng độ phân giải thật của cảm biến TROPOMI (~5.5km x 3.5km/
    # pixel), giải thích được rõ ràng bằng lý do khoa học nếu bị hỏi.
    return mean_image


def export_thumbnail(image: ee.Image, out_path_json: str):
    """
    Lấy URL ảnh PNG trực tiếp qua getThumbURL — KHÔNG cần export qua
    Google Drive/Cloud Storage, tải về ngay lập tức. Phù hợp cho demo,
    không cần độ phân giải khoa học cao.
    """
    vis_params = {
        "min": 0,
        "max": 0.0002,  # mol/m^2, khoảng giá trị điển hình NO2 đô thị
        "palette": ["blue", "cyan", "green", "yellow", "red"],
    }

    region = ee.Geometry.Rectangle(
        [HANOI_BBOX["min_lon"], HANOI_BBOX["min_lat"],
         HANOI_BBOX["max_lon"], HANOI_BBOX["max_lat"]]
    )

    url = image.visualize(**vis_params).getThumbURL({
        "region": region,
        "dimensions": 1024,
        "format": "png",
    })

    print("Ảnh NO2 (PNG) - tải trực tiếp từ URL này:")
    print(url)

    # Lưu lại bbox + url để dùng làm Leaflet ImageOverlay bounds bên dashboard
    meta = {
        "image_url": url,
        "bounds_leaflet": [
            [HANOI_BBOX["min_lat"], HANOI_BBOX["min_lon"]],
            [HANOI_BBOX["max_lat"], HANOI_BBOX["max_lon"]],
        ],
    }
    with open(out_path_json, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nĐã lưu metadata (bbox cho Leaflet) vào: {out_path_json}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True, help="Google Cloud / Earth Engine project ID")
    parser.add_argument("--start", default="2026-06-01", help="Ngày bắt đầu (YYYY-MM-DD)")
    parser.add_argument("--end", default="2026-08-01", help="Ngày kết thúc (YYYY-MM-DD)")
    parser.add_argument("--out", default="no2_hanoi_meta.json")
    args = parser.parse_args()

    ee.Initialize(project=args.project)

    image = build_no2_image(args.start, args.end)
    export_thumbnail(image, args.out)


if __name__ == "__main__":
    main()
