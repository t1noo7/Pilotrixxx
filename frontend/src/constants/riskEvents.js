// Nguồn DUY NHẤT cho màu + nhãn các loại sự kiện nguy hiểm, dùng
// chung giữa FleetMap.jsx (bản đồ realtime) và TripReplay.jsx (trip replay).
// event_type phải khớp đúng enum trong DB (bảng driver_events).
export const RISK_EVENT_STYLE = {
    hard_brake: { color: "#f87171", label: "Phanh gấp" },
    overspeed: { color: "#fb923c", label: "Vượt tốc độ" },
    rapid_accel: { color: "#c084fc", label: "Tăng tốc đột ngột" },
    sharp_turn: { color: "#fbbf24", label: "Cua gắt" },
    lane_drift: { color: "#38bdf8", label: "Lấn làn" },
};
export const DEFAULT_EVENT_STYLE = { color: "#94a3b8", label: "Sự kiện khác" };