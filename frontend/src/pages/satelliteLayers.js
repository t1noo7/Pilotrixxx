// Các lớp phủ chất khí (Sentinel-5P/TROPOMI, qua Google Earth Engine),
// đã CLIP theo ranh giới hành chính thật của Hà Nội (không phải bbox
// chữ nhật thô) - GHI TỰ ĐỘNG bởi `gee_export_pollutants.py`, KHÔNG sửa
// tay file này - chạy lại script để cập nhật ảnh mới.

const SHARED_BOUNDS = [[20.89586924725857, 105.71804887563736], [21.384720480627312, 106.01999691361425]];

export const SATELLITE_LAYERS = {
  NO2: {
    label: "NO₂ (khí thải giao thông/công nghiệp)",
    unit: "mol/m²",
    visMin: 4.1143714946004785e-05,
    visMax: 8.373443210998123e-05,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/9f4fc0365d42b44c909836a7f5ee076c-017c99c928224af12a3340daf02f10a3:getPixels",
    bounds: SHARED_BOUNDS,
  },
  CO: {
    label: "CO (khí thải đốt cháy không hoàn toàn)",
    unit: "mol/m²",
    visMin: 0.032975541116403634,
    visMax: 0.03805375274574642,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/777130d99369c44b9ac0552456b726a4-5964aced0cdbb0bcaaaeea5e8d37c9f5:getPixels",
    bounds: SHARED_BOUNDS,
  },
  SO2: {
    label: "SO₂ (khí thải công nghiệp/nhiên liệu hoá thạch)",
    unit: "mol/m²",
    visMin: -0.00010045941471163921,
    visMax: 0.00012532109619622768,
    imageUrl:
      "https://earthengine.googleapis.com/v1/projects/pilotrix-airquality/thumbnails/22a6d03bb181de686ba1570677392fe7-136f768bffe4d92770edcc070f5b20f5:getPixels",
    bounds: SHARED_BOUNDS,
  },
};

// Phải khớp đúng VIS_PALETTE trong gee_export_pollutants.py
export const VIS_PALETTE = ["blue", "cyan", "green", "yellow", "red"];
