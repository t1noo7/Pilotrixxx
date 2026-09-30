import { CircleMarker, Tooltip } from "react-leaflet";

// Toa do dai dien (khong phai ranh gioi hanh chinh chinh xac tung pixel)
// cho 2 quan dao thuoc chu quyen Viet Nam. OSM/nhieu tile provider AN
// nhan/hinh dao o zoom thap do generalization cartographic (dao qua nho
// so voi ty le hien thi) - KHONG phai do du lieu bi xoa co chu dich.
// Lop nay ve THEM, doc lap voi style tile nen, Leaflet tu clip theo vung
// nhin nen khong can tinh nguong zoom rieng - marker se tu hien khi
// nguoi dung pan/zoom tram khu vuc do.
const HOANG_SA = {
  name: "Quần đảo Hoàng Sa — Đà Nẵng, Việt Nam",
  labelAt: [16.832, 112.338], // Dao Phu Lam - dao lon nhat, dat nhan o day
  islands: [
    [16.832, 112.338], // Dao Phu Lam
    [16.502, 111.617], // Nhom dao Luoi Liem (Dao Hoang Sa)
    [16.965, 112.309], // Dao Cay
    [16.556, 111.706], // Dao Quang Anh
  ],
};

const TRUONG_SA = {
  name: "Quần đảo Trường Sa — Khánh Hòa, Việt Nam",
  labelAt: [8.645, 111.917], // Dao Truong Sa Lon - dat nhan o day
  islands: [
    [8.645, 111.917], // Dao Truong Sa Lon
    [10.383, 114.367], // Dao Nam Yet
    [8.817, 112.958], // Dao Sinh Ton
    [8.962, 113.865], // Dao Song Tu Tay
    [9.878, 114.334], // Dao Sinh Ton Dong khu vuc
  ],
};

function ArchipelagoMarkers({ data }) {
  return (
    <>
      {data.islands.map((pos, i) => (
        <CircleMarker
          key={i}
          center={pos}
          radius={3}
          pathOptions={{
            color: "#ffcd00",
            fillColor: "#da251d",
            fillOpacity: 1,
            weight: 1.5,
          }}
        />
      ))}
      <CircleMarker
        center={data.labelAt}
        radius={0}
        pathOptions={{ opacity: 0, fillOpacity: 0 }}
      >
        <Tooltip
          permanent
          direction="right"
          offset={[6, 0]}
          className="sovereignty-label"
        >
          {data.name}
        </Tooltip>
      </CircleMarker>
    </>
  );
}

export default function SovereigntyOverlay() {
  return (
    <>
      <style>{`
                .sovereignty-label {
                    background: rgba(11, 18, 32, 0.85) !important;
                    border: 1px solid #ffcd00 !important;
                    color: #ffcd00 !important;
                    font-size: 11px !important;
                    font-weight: 600 !important;
                    padding: 2px 6px !important;
                    box-shadow: none !important;
                }
                .sovereignty-label::before {
                    border-right-color: #ffcd00 !important;
                }
            `}</style>
      <ArchipelagoMarkers data={HOANG_SA} />
      <ArchipelagoMarkers data={TRUONG_SA} />
    </>
  );
}
