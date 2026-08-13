// Các lớp phủ chất khí (Sentinel-5P/TROPOMI, qua Google Earth Engine),
// đã CLIP theo ranh giới hành chính thật của Hà Nội (không phải bbox
// chữ nhật thô) - export từ script `gee_export_pollutants.py`.
// Ảnh THUMBNAIL TĨNH - không realtime, đại diện trung bình mỗi chất khí
// trong khoảng thời gian đã fetch. Muốn cập nhật: chạy lại script, thay
// giá trị imageUrl tương ứng dưới đây.

const SHARED_BOUNDS = [
  [20.8959, 105.7180],
  [21.3847, 106.0200],
];

export const SATELLITE_LAYERS = {
  NO2: {
    label: "NO₂ (khí thải giao thông/công nghiệp)",
    unit: "mol/m²",
    visMin: 4.11437e-5,
    visMax: 8.37344e-5,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/9f4fc0365d42b44c909836a7f5ee076c-fc1dd5a26e0f5e396331d922e6f5b531:getPixels",
    bounds: SHARED_BOUNDS,
  },
  CO: {
    label: "CO (khí thải đốt cháy không hoàn toàn)",
    unit: "mol/m²",
    visMin: 0.0329755,
    visMax: 0.0380538,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/777130d99369c44b9ac0552456b726a4-55f6d45e84e57027b8d02fecfa598da6:getPixels",
    bounds: SHARED_BOUNDS,
  },
  SO2: {
    label: "SO₂ (khí thải công nghiệp/nhiên liệu hoá thạch)",
    unit: "mol/m²",
    visMin: -0.000100459,
    visMax: 0.000125321,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/22a6d03bb181de686ba1570677392fe7-8c8a188739e83320e92731590776dd32:getPixels",
    bounds: SHARED_BOUNDS,
  },
};

// Phải khớp đúng VIS_PALETTE trong gee_export_pollutants.py
export const VIS_PALETTE = ["blue", "cyan", "green", "yellow", "red"];

