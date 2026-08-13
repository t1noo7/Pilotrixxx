// Lớp phủ NO2 (Sentinel-5P/TROPOMI, qua Google Earth Engine).
// URL và bounds được export từ script `gee_export_no2.py` (xem
// no2_hanoi_meta.json). Ảnh THUMBNAIL TĨNH - không realtime, đại diện
// trung bình NO2 tầng đối lưu trong khoảng thời gian đã fetch.
// Muốn cập nhật ảnh mới: chạy lại script GEE, thay 2 giá trị dưới đây.

export const NO2_LAYER = {
  imageUrl:
    "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/ba06a34bb547850742004e69f61fa5eb-74b53e796f983c340adae9f44821cffb:getPixels",
  // Leaflet bounds: [[south, west], [north, east]]
  bounds: [
    [20.9, 105.7],
    [21.15, 105.95],
  ],
};
