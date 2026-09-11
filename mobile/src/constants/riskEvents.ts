// Nguồn DUY NHẤT cho màu + nhãn sự kiện nguy hiểm bên mobile.
// LƯU Ý: file riêng với dashboard/src/constants/riskEvents.js (2 codebase
// tách biệt, không share qua workspace hiện tại) - đổi màu 1 bên nhớ đổi
// bên kia cho khớp.
export const RISK_EVENT_STYLE: Record<
  string,
  { color: string; label: string }
> = {
  hard_brake: { color: "#f87171", label: "Phanh gấp" },
  overspeed: { color: "#fb923c", label: "Vượt tốc độ" },
  rapid_accel: { color: "#c084fc", label: "Tăng tốc đột ngột" },
  sharp_turn: { color: "#fbbf24", label: "Cua gắt" },
  lane_drift: { color: "#38bdf8", label: "Lấn làn" },
};
export const DEFAULT_EVENT_STYLE = { color: "#9ca3af", label: "Sự kiện khác" };
