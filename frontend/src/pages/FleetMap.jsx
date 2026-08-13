import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  ImageOverlay,
  CircleMarker,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { apiClient } from "../api/client.js";
import { socket } from "../api/socket.js";
import { NO2_LAYER } from "./no2Layer.js";

// Màu + nhãn cho lớp "Driving Risk" - marker sự kiện nguy hiểm trên bản đồ.
// event_type phải khớp đúng giá trị enum trong DB (bảng driver_events).
const RISK_EVENT_STYLE = {
  hard_brake: { color: "#f87171", label: "Phanh gấp" },
  overspeed: { color: "#fb923c", label: "Vượt tốc độ" },
  rapid_accel: { color: "#c084fc", label: "Tăng tốc đột ngột" },
  sharp_turn: { color: "#fbbf24", label: "Cua gắt" },
};
const DEFAULT_EVENT_STYLE = { color: "#94a3b8", label: "Sự kiện khác" };

const HANOI_CENTER = [21.0285, 105.8542];

// Màu QUẦNG SÁNG (glow) theo trạng thái/risk — KHÔNG còn nhuộm màu thân xe,
// chỉ là viền sáng bao quanh, để phân biệt với màu sơn cố định của từng loại xe.
const GLOW_BY_STATE = {
  offline: "#5b6478", // var(--text-muted)
  online_unknown: "#3dd6c4", // var(--accent) - đang chạy, chưa có risk gần nhất
  stale: "#f59e0b", // vàng cam - DB vẫn báo đang chạy nhưng lâu rồi không có telemetry mới (nghi run_fleet.py chết/bị kill)
  safe: "#34d399",
  medium: "#fbbf24",
  dangerous: "#f87171",
};

// Qua ngưỡng này (ms) mà không có telemetry mới trong khi DB vẫn báo trip
// đang 'ongoing' -> coi là mất tín hiệu (nghi run_fleet.py chết/bị kill
// giữa chừng, hoặc mobile app driver bị đóng lâu không gửi HTTP nữa).
// TELEMETRY_INTERVAL_SECONDS bên simulator là 5s -> 45s ~ bỏ lỡ 9 lần gửi
// liên tiếp mới báo, đủ dư để không báo nhầm do độ trễ mạng thoáng qua.
const STALE_THRESHOLD_MS = 45_000;

function isVehicleStale(vehicle, now) {
  if (vehicle.status !== "online" || !vehicle.last_telemetry_at) return false;
  return (
    now - new Date(vehicle.last_telemetry_at).getTime() > STALE_THRESHOLD_MS
  );
}

function riskGlowColor(vehicle, stale) {
  if (stale) return GLOW_BY_STATE.stale;
  if (vehicle.status !== "online") return GLOW_BY_STATE.offline;
  if (vehicle.last_risk_level)
    return (
      GLOW_BY_STATE[vehicle.last_risk_level] || GLOW_BY_STATE.online_unknown
    );
  return GLOW_BY_STATE.online_unknown;
}

// Mỗi xe được gán 1 "loại xe" cố định theo vehicle_id (chỉ để tạo sự đa
// dạng hình ảnh trên map - không liên quan nghiệp vụ) - luân phiên qua 4 mẫu.
// Mỗi xe được gán 1 "loại xe" cố định theo vehicle_id (chỉ để tạo sự đa
// dạng hình ảnh trên map - không liên quan nghiệp vụ) - luân phiên qua 4 mẫu.
const VEHICLE_TYPES = [
  "sedan",
  "truck",
  "racecar",
  "limousine",
  "bus",
  "congnong",
  "duck",
];
function vehicleTypeFor(vehicle) {
  // Ưu tiên vehicle_type thật từ DB (cột đã được backend trả về ở
  // /api/dashboard/fleet-status). Chỉ fallback về modulo id khi thiếu
  // cột (dữ liệu cũ) hoặc giá trị không khớp SVG nào đã vẽ.
  if (vehicle.vehicle_type && VEHICLE_SVG_BUILDERS[vehicle.vehicle_type]) {
    return vehicle.vehicle_type;
  }
  return (
    VEHICLE_TYPES[(vehicle.vehicle_id - 1) % VEHICLE_TYPES.length] || "sedan"
  );
}

// --- 4 mẫu xe, mỗi mẫu có màu sơn + hình dáng riêng, kính/đèn/bánh vẽ tay ---

function sedanSvg() {
  return {
    viewBox: "0 0 100 150",
    body: `
            <rect x="10" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="79" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="10" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="79" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="20" y="8" width="60" height="134" rx="27" fill="#e6483d" stroke="#0b1220" stroke-width="2.2" />
            <rect x="43" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
            <!-- Đèn pha trước: trắng/kem -->
            <rect x="25" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <rect x="66" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <!-- Gương chiếu hậu - chỉ có ở đầu xe -->
            <rect x="15" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
            <rect x="79" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
            <path d="M32 32 L68 32 L64 53 L36 53 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M37 34 L47 34 L40 48 L35 48 Z" fill="#c9ecfb" opacity="0.6" />
            <rect x="19" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="70" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M35 98 L65 98 L69 118 L31 118 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <!-- Đèn hậu sau: đỏ -->
            <rect x="25" y="128" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="66" y="128" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="43" y="135" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
  };
}

function truckSvg() {
  return {
    viewBox: "0 0 100 160",
    body: `
            <rect x="8" y="24" width="11" height="20" rx="4" fill="#15181f" />
            <rect x="81" y="24" width="11" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="90" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="81" y="90" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="6" y="120" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="81" y="120" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="22" y="6" width="56" height="46" rx="14" fill="#f0a020" stroke="#0b1220" stroke-width="2.2" />
            <path d="M30 16 C31 14 33 13 50 13 C67 13 69 14 70 16 L71 34 L29 34 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="43" y="7" width="14" height="5" rx="2.5" fill="#c9ccd1" />
            <!-- Lưới tản nhiệt trước ca-bin -->
            <line x1="34" y1="38" x2="34" y2="46" stroke="#c98a10" stroke-width="1.4" />
            <line x1="40" y1="38" x2="40" y2="46" stroke="#c98a10" stroke-width="1.4" />
            <line x1="46" y1="38" x2="46" y2="46" stroke="#c98a10" stroke-width="1.4" />
            <!-- Đèn pha: trắng/kem -->
            <rect x="27" y="42" width="8" height="5" rx="2" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <rect x="65" y="42" width="8" height="5" rx="2" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <rect x="16" y="50" width="68" height="102" rx="8" fill="#f0a020" stroke="#0b1220" stroke-width="2.2" />
            <line x1="16" y1="76" x2="84" y2="76" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <line x1="16" y1="102" x2="84" y2="102" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <line x1="16" y1="128" x2="84" y2="128" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <!-- Đèn hậu: đỏ (trước đó nhầm cam) -->
            <rect x="25" y="140" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="66" y="140" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="43" y="147" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
  };
}

function racecarSvg() {
  return {
    viewBox: "0 0 100 158",
    body: `
            <rect x="12" y="132" width="76" height="8" rx="3" fill="#1c2230" stroke="#0b1220" stroke-width="1.4" />
            <rect x="20" y="122" width="8" height="14" fill="#1c2230" />
            <rect x="72" y="122" width="8" height="14" fill="#1c2230" />
            <rect x="4" y="30" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="84" y="30" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="4" y="96" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="84" y="96" width="12" height="26" rx="5" fill="#15181f" />
            <path d="M50 4
                     C58 4 64 10 66 20
                     L70 60 C71 80 71 100 68 118
                     C66 128 60 133 50 133
                     C40 133 34 128 32 118
                     C29 100 29 80 30 60
                     L34 20
                     C36 10 42 4 50 4 Z"
                fill="#f5d90a" stroke="#0b1220" stroke-width="2.2" />
            <rect x="46" y="6" width="8" height="124" fill="#1c2230" opacity="0.85" />
            <!-- Dải đèn pha LED mảnh ở mũi xe -->
            <path d="M37 12 C40 9 44 8 47 8 L46 16 L38 17 Z" fill="#eaf6ff" stroke="#b8dcf0" stroke-width="0.6" />
            <path d="M63 12 C60 9 56 8 53 8 L54 16 L62 17 Z" fill="#eaf6ff" stroke="#b8dcf0" stroke-width="0.6" />
            <ellipse cx="50" cy="38" rx="15" ry="18" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M42 26 C45 24 48 23 50 23 L48 40 L41 38 Z" fill="#c9ecfb" opacity="0.6" />
            <circle cx="50" cy="78" r="12" fill="#f7f7f7" stroke="#0b1220" stroke-width="1.4" />
            <text x="50" y="83" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2230" font-family="Arial">7</text>
            <rect x="35" y="100" width="8" height="5" rx="2" fill="#e6483d" />
            <rect x="57" y="100" width="8" height="5" rx="2" fill="#e6483d" />
        `,
  };
}

function limousineSvg() {
  return {
    viewBox: "0 0 90 190",
    body: `
            <rect x="6" y="26" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="26" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="76" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="76" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="126" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="126" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="152" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="152" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="16" y="8" width="58" height="174" rx="24" fill="#2d3436" stroke="#0b1220" stroke-width="2.2" />
            <rect x="38" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
            <!-- Đèn pha trước: trắng/kem -->
            <rect x="21" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <rect x="60" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <!-- Gương chiếu hậu - chỉ có ở đầu xe -->
            <rect x="11" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
            <rect x="73" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
            <path d="M27 30 L63 30 L59 48 L31 48 Z" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="15" y="55" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="55" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="15" y="84" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="84" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="15" y="113" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="113" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <path d="M31 148 L59 148 L63 166 L27 166 Z" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <!-- Đèn hậu sau: đỏ -->
            <rect x="21" y="172" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="60" y="172" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="38" y="177" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
  };
}

function busSvg() {
  return {
    viewBox: "0 0 90 190",
    body: `
            <rect x="6" y="24" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="24" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="80" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="80" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="136" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="136" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="15" y="8" width="60" height="174" rx="14" fill="#f5c518" stroke="#0b1220" stroke-width="2.2" />
            <!-- Bảng số tuyến phía trước -->
            <rect x="30" y="11" width="30" height="8" rx="2" fill="#1c1c1c" />
            <text x="45" y="17.5" font-size="6" font-weight="700" text-anchor="middle" fill="#f5c518" font-family="Arial">09A</text>
            <!-- Đèn pha: trắng/kem -->
            <rect x="20" y="21" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <rect x="61" y="21" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
            <!-- Gương chiếu hậu - chỉ có ở đầu xe -->
            <rect x="10" y="34" width="6" height="4" rx="1.5" fill="#15181f" />
            <rect x="74" y="34" width="6" height="4" rx="1.5" fill="#15181f" />
            <path d="M25 28 L65 28 L62 42 L28 42 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="19" y="48" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="48" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="70" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="70" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="92" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="92" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="114" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="114" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="15" y="136" width="60" height="6" fill="#ffffff" opacity="0.85" />
            <path d="M28 156 L62 156 L65 174 L25 174 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <!-- Đèn hậu: đỏ -->
            <rect x="20" y="178" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="61" y="178" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
            <rect x="36" y="183" width="18" height="6" rx="3" fill="#c9ccd1" />
        `,
  };
}

function congnongSvg() {
  return {
    viewBox: "0 0 100 175",
    body: `
            <rect x="12" y="120" width="12" height="24" rx="4" fill="#15181f" />
            <rect x="76" y="120" width="12" height="24" rx="4" fill="#15181f" />
            <rect x="14" y="95" width="72" height="66" rx="6" fill="#8a6d3b" stroke="#0b1220" stroke-width="2.2" />
            <line x1="14" y1="112" x2="86" y2="112" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <line x1="14" y1="129" x2="86" y2="129" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <line x1="14" y1="146" x2="86" y2="146" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <!-- Khung nối dày hơn (24 thay vì 16) - tạo khối lượng, bớt cảm giác "que" -->
            <rect x="38" y="58" width="24" height="42" rx="3" fill="#6b6b6b" stroke="#0b1220" stroke-width="1.4" />
            <!-- Chắn bùn quanh bánh - bánh không còn lơ lửng trơ trọi -->
            <path d="M28 80 A22 22 0 0 1 72 80" fill="none" stroke="#3a3a3a" stroke-width="4" opacity="0.6" />
            <circle cx="50" cy="80" r="17" fill="#15181f" stroke="#3a3a3a" stroke-width="2" />
            <circle cx="50" cy="80" r="7" fill="#6b6b6b" />
            <!-- Đầu máy nổ - to hơn 1 chút, thêm lưới tản nhiệt cho có khối -->
            <rect x="28" y="16" width="44" height="48" rx="6" fill="#a35b3a" stroke="#0b1220" stroke-width="2.2" />
            <rect x="34" y="22" width="32" height="16" rx="3" fill="#3a3a3a" />
            <line x1="37" y1="24" x2="37" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
            <line x1="43" y1="24" x2="43" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
            <line x1="49" y1="24" x2="49" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
            <line x1="55" y1="24" x2="55" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
            <line x1="61" y1="24" x2="61" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
            <!-- Ống pô: rút ngắn + dày hơn, thêm loe ở đáy để bám đất, bớt cảm giác que mảnh -->
            <rect x="64" y="4" width="10" height="16" rx="2" fill="#3a3a3a" stroke="#0b1220" stroke-width="1.2" />
            <rect x="62" y="18" width="14" height="5" rx="1.5" fill="#2a2a2a" />
            <ellipse cx="69" cy="4" rx="6" ry="2.8" fill="#1c1c1c" />
            <rect x="40" y="42" width="20" height="16" rx="3" fill="#5c4326" />
            <circle cx="34" cy="44" r="4" fill="#3a3a3a" stroke="#0b1220" stroke-width="1" />
        `,
  };
}

function duckSvg() {
  return {
    viewBox: "0 0 100 140",
    body: `
            <!-- Bánh xe -->
            <rect x="10" y="70" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="80" y="70" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="14" y="100" width="10" height="18" rx="4" fill="#15181f" />
            <rect x="76" y="100" width="10" height="18" rx="4" fill="#15181f" />
            <!-- Thân vịt: bầu tròn hơn, đầu to hơn (tỉ lệ chibi cho dễ thương) -->
            <path d="M50 4
                     C68 4 75 15 73 29
                     C84 35 90 48 90 66
                     C90 100 74 128 50 132
                     C26 128 10 100 10 66
                     C10 48 16 35 27 29
                     C25 15 32 4 50 4 Z"
                fill="#ffd23f" stroke="#e0a800" stroke-width="2.2" />
            <!-- Cọng lông xoăn trên đầu -->
            <path d="M46 6 C44 0 50 -3 54 2 C51 3 49 5 48 8 Z" fill="#ffd23f" stroke="#e0a800" stroke-width="1.6" />
            <!-- Má hồng -->
            <ellipse cx="25" cy="44" rx="8" ry="5.5" fill="#ff9aa2" opacity="0.9" />
            <ellipse cx="75" cy="44" rx="8" ry="5.5" fill="#ff9aa2" opacity="0.9" />
            <!-- Mắt to, gần nhau hơn, thêm ánh sáng đôi -->
            <circle cx="41" cy="32" r="7" fill="#1c1c1c" />
            <circle cx="59" cy="32" r="7" fill="#1c1c1c" />
            <circle cx="43.5" cy="29" r="2.4" fill="#ffffff" />
            <circle cx="61.5" cy="29" r="2.4" fill="#ffffff" />
            <circle cx="39" cy="35" r="1.1" fill="#ffffff" opacity="0.8" />
            <circle cx="57" cy="35" r="1.1" fill="#ffffff" opacity="0.8" />
            <!-- Mỏ nhỏ, bo tròn hơn -->
            <path d="M40 22 C43 14 57 14 60 22 C58 27 42 27 40 22 Z" fill="#ff8c42" stroke="#e0a800" stroke-width="1.6" />
            <!-- Miệng cười nhỏ dưới mỏ -->
            <path d="M44 27 Q50 30 56 27" stroke="#c97a1a" stroke-width="1.3" fill="none" stroke-linecap="round" />
            <!-- Nơ nhỏ ở cổ -->
            <path d="M42 52 L50 57 L42 62 Z" fill="#ff5d73" stroke="#c93a4f" stroke-width="1" />
            <path d="M58 52 L50 57 L58 62 Z" fill="#ff5d73" stroke="#c93a4f" stroke-width="1" />
            <circle cx="50" cy="57" r="3" fill="#ff3b52" />
            <!-- Cánh -->
            <path d="M14 66 C8 76 8 92 16 102 C20 92 20 78 22 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
            <path d="M86 66 C92 76 92 92 84 102 C80 92 80 78 78 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
            <!-- Biển số nhỏ -->
            <rect x="41" y="122" width="18" height="7" rx="3" fill="#f7f7f7" stroke="#0b1220" stroke-width="1" />
        `,
  };
}

function tankSvg() {
  return {
    viewBox: "0 0 100 170",
    body: `
            <rect x="2" y="8" width="20" height="154" rx="9" fill="#1c1f10" stroke="#0b1220" stroke-width="2.2" />
            <circle cx="12" cy="20" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="42" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="64" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="86" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="108" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="130" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="12" cy="150" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <path d="M3,28 L0,31 L3,34 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M3,50 L0,53 L3,56 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M3,72 L0,75 L3,78 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M3,94 L0,97 L3,100 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M3,116 L0,119 L3,122 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M3,137 L0,140 L3,143 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <rect x="78" y="8" width="20" height="154" rx="9" fill="#1c1f10" stroke="#0b1220" stroke-width="2.2" />
            <circle cx="88" cy="20" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="42" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="64" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="86" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="108" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="130" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="88" cy="150" r="7.5" fill="#3a4020" stroke="#0b1220" stroke-width="1.2" />
            <path d="M97,28 L100,31 L97,34 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M97,50 L100,53 L97,56 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M97,72 L100,75 L97,78 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M97,94 L100,97 L97,100 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M97,116 L100,119 L97,122 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <path d="M97,137 L100,140 L97,143 Z" fill="#1c1f10" stroke="#0b1220" stroke-width="0.6" />
            <rect x="24" y="20" width="52" height="140" rx="10" fill="#5a6b2f" stroke="#0b1220" stroke-width="2.4" />
            <path d="M28 22 L72 22 L68 40 L32 40 Z" fill="#4b5320" stroke="#0b1220" stroke-width="1.2" />
            <rect x="26" y="134" width="48" height="24" rx="5" fill="#3d451f" stroke="#0b1220" stroke-width="1.8" />
            <line x1="33" y1="140" x2="37" y2="152" stroke="#2a2f16" stroke-width="2" />
            <line x1="42" y1="140" x2="46" y2="152" stroke="#2a2f16" stroke-width="2" />
            <line x1="54" y1="140" x2="58" y2="152" stroke="#2a2f16" stroke-width="2" />
            <line x1="63" y1="140" x2="67" y2="152" stroke="#2a2f16" stroke-width="2" />
            <circle cx="50" cy="78" r="27" fill="#4b5320" stroke="#0b1220" stroke-width="2.2" />
            <circle cx="50" cy="78" r="22" fill="#5a6b2f" stroke="#3d451f" stroke-width="1.4" />
            <rect x="41" y="52" width="18" height="16" rx="3" fill="#3d451f" stroke="#0b1220" stroke-width="1.6" />
            <rect x="44" y="0" width="12" height="56" rx="2" fill="#3d451f" stroke="#0b1220" stroke-width="1.8" />
            <rect x="42" y="0" width="16" height="9" rx="1.5" fill="#2a2f16" stroke="#0b1220" stroke-width="1.4" />
            <rect x="44" y="2" width="3" height="5" fill="#0b1220" />
            <rect x="53" y="2" width="3" height="5" fill="#0b1220" />
            <circle cx="62" cy="70" r="6" fill="#2a2f16" stroke="#0b1220" stroke-width="1.2" />
            <circle cx="37" cy="88" r="5" fill="#2a2f16" stroke="#0b1220" stroke-width="1.2" />
            <rect x="47" y="60" width="6" height="4" rx="1" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.5" />
            <rect x="58" y="66" width="5" height="4" rx="1" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.5" />
            <line x1="70" y1="60" x2="78" y2="26" stroke="#2a2f16" stroke-width="1.4" />
            <circle cx="78" cy="24" r="1.8" fill="#2a2f16" />
            <circle cx="50" cy="96" r="8" fill="#f7f7f7" stroke="#0b1220" stroke-width="1.2" />
            <path d="M50 90 L52.5 95 L58 95.5 L54 99 L55.5 104.5 L50 101.5 L44.5 104.5 L46 99 L42 95.5 L47.5 95 Z" fill="#c9a24b" />
            <rect x="26" y="118" width="14" height="10" rx="2" fill="#3d451f" stroke="#0b1220" stroke-width="1.2" />
            <rect x="60" y="118" width="14" height="10" rx="2" fill="#3d451f" stroke="#0b1220" stroke-width="1.2" />
            <rect x="30" y="158" width="7" height="5" rx="1.5" fill="#2a2f16" stroke="#0b1220" stroke-width="1" />
            <rect x="63" y="158" width="7" height="5" rx="1.5" fill="#2a2f16" stroke="#0b1220" stroke-width="1" />
        `,
  };
}

const VEHICLE_SVG_BUILDERS = {
  sedan: sedanSvg,
  truck: truckSvg,
  racecar: racecarSvg,
  limousine: limousineSvg,
  bus: busSvg,
  congnong: congnongSvg,
  duck: duckSvg,
  tank: tankSvg,
};

// Kích thước hiển thị trên map cho từng loại (giữ đúng tỉ lệ viewBox riêng)
const VEHICLE_DISPLAY_SIZE = {
  sedan: [26, 39],
  truck: [26, 42],
  racecar: [26, 41],
  limousine: [22, 46],
  bus: [22, 46],
  congnong: [26, 44],
  duck: [26, 36],
  tank: [25, 42],
};

// divIcon: chọn đúng mẫu xe theo `vehicleType`, xoay theo `heading` thật,
// quầng sáng (glow) đổi màu theo risk-level - màu sơn xe thì giữ cố định
// theo loại xe, không đổi theo risk nữa.
// online (pulsing=true): glow màu nhấp nháy nhẹ qua CSS animation (rẻ,
//   chỉ áp cho vài marker trên bản đồ, browser tự chạy trên GPU).
// offline: BỎ HẲN glow màu (dễ bị tưởng nhầm là shadow đổ bóng của icon,
//   đúng phản hồi thực tế) - thay bằng xám hoá toàn thân xe (grayscale)
//   + giảm opacity + 1 khối tròn xám đậm làm nền phía sau, tạo cảm giác
//   "dày" rõ ràng, tương phản mạnh với xe online có màu.
// divIcon: chọn đúng mẫu xe theo `vehicleType`, quầng sáng (glow) đổi màu
// theo risk-level - màu sơn xe thì giữ cố định theo loại xe, không đổi
// theo risk nữa.
// QUAN TRỌNG: icon KHÔNG còn nhúng heading/rotate trực tiếp vào HTML nữa
// (khác bản cũ) - heading đổi mỗi lần có telemetry mới (~5s/lần), nếu
// nhúng vào icon thì mỗi lần đổi heading Leaflet phải setIcon() (xoá +
// tạo lại toàn bộ DOM node) -> @keyframes vehicle-glow-pulse bị reset về
// 0% liên tục, chưa kịp chạy hết 1 vòng (2.4s) đã bị thay icon mới, nhìn
// như không hề nhấp nháy. Heading giờ xử lý bằng cách xoay 1 div con
// (class "vehicle-rotate-wrap") qua DOM trực tiếp (xem VehicleMarker bên
// dưới) - icon chỉ đổi khi vehicleType/glowColor/isOffline/pulsing đổi
// (hiếm hơn nhiều), animation không còn bị ngắt giữa chừng.
// online (pulsing=true): glow màu nhấp nháy nhẹ qua CSS animation (rẻ,
//   chỉ áp cho vài marker trên bản đồ, browser tự chạy trên GPU).
// offline: BỎ HẲN glow màu (dễ bị tưởng nhầm là shadow đổ bóng của icon,
//   đúng phản hồi thực tế) - thay bằng xám hoá toàn thân xe (grayscale)
//   + giảm opacity + 1 khối tròn xám đậm làm nền phía sau, tạo cảm giác
//   "dày" rõ ràng, tương phản mạnh với xe online có màu.
function buildIcon(vehicleType, glowColor, isOffline, pulsing) {
  const { viewBox, body } = (VEHICLE_SVG_BUILDERS[vehicleType] || sedanSvg)();
  const [w, h] = VEHICLE_DISPLAY_SIZE[vehicleType] || [26, 39];
  const rotateWrapOpen = `<div class="vehicle-rotate-wrap" style="width: 100%; height: 100%; transform: rotate(0deg); transition: transform 0.4s linear;">`;

  if (isOffline) {
    // offline that - xam dam, khong dung glow mau nua tranh nham voi shadow.
    return L.divIcon({
      className: "",
      html: `
            <div style="width: ${w}px; height: ${h}px; position: relative;">
                <div style="position: absolute; inset: -6px; border-radius: 999px; background: ${GLOW_BY_STATE.offline}55; border: 2px solid ${GLOW_BY_STATE.offline}; box-sizing: border-box;"></div>
                ${rotateWrapOpen}
                    <svg width="${w}" height="${h}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" style="position: relative; filter: grayscale(0.9) drop-shadow(0 1px 2px rgba(0,0,0,0.4)); opacity: 0.65;">
                        ${body}
                    </svg>
                </div>
            </div>`,
      iconSize: [w, h],
      iconAnchor: [w / 2, h / 2],
      popupAnchor: [0, -(h / 2) - 2],
    });
  }

  // online: pulsing=true (binh thuong) -> glow mau nhap nhay nhe.
  // pulsing=false (stale - mat tin hieu nhung DB van bao dang chay) -> giu
  // mau canh bao (cam) nhung KHONG animate, de phan biet voi "dang chay binh thuong".
  const style = pulsing
    ? `--glow-c: ${glowColor}; --glow-c-a: ${glowColor}aa; animation: vehicle-glow-pulse 2.4s ease-in-out infinite;`
    : `filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 6px ${glowColor}) drop-shadow(0 0 6px ${glowColor}aa);`;

  return L.divIcon({
    className: "",
    html: `
            <div style="width: ${w}px; height: ${h}px; ${style}">
                ${rotateWrapOpen}
                    <svg width="${w}" height="${h}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
                        ${body}
                    </svg>
                </div>
            </div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
    popupAnchor: [0, -(h / 2) - 2],
  });
}

// Component con: 1 marker xe. Icon được useMemo theo (vehicleType,
// glowColor, isOffline, pulsing) - KHÔNG phụ thuộc heading, nên khi xe
// chỉ đổi vị trí/heading (mỗi ~5s, không đổi trạng thái/màu), icon giữ
// nguyên object reference -> Leaflet KHÔNG setIcon() lại -> DOM node cũ
// (đang chạy animation nhấp nháy) được giữ nguyên, không bị reset.
// Heading áp trực tiếp lên DOM qua ref (marker.getElement()) mỗi khi đổi,
// tách biệt hoàn toàn khỏi vòng đời icon.
function VehicleMarker({
  vehicle: v,
  stale,
  glowColor,
  vehicleType,
  isOffline,
  pulsing,
  heading,
}) {
  const markerRef = useRef(null);

  const icon = useMemo(
    () => buildIcon(vehicleType, glowColor, isOffline, pulsing),
    [vehicleType, glowColor, isOffline, pulsing],
  );

  useEffect(() => {
    const marker = markerRef.current;
    const el = marker && marker.getElement ? marker.getElement() : null;
    const rotWrap = el ? el.querySelector(".vehicle-rotate-wrap") : null;
    if (rotWrap) rotWrap.style.transform = `rotate(${heading}deg)`;
  }, [heading]);

  return (
    <Marker
      ref={markerRef}
      position={[v.last_latitude, v.last_longitude]}
      icon={icon}
    >
      <Popup>
        <div style={{ fontFamily: "var(--font-ui)", minWidth: 160 }}>
          <strong>{v.license_plate}</strong> — {v.model}
          <br />
          {stale ? (
            <span style={{ color: GLOW_BY_STATE.stale, fontWeight: 600 }}>
              ⚠ Mất tín hiệu
              {v.last_telemetry_at && (
                <>
                  <br />
                  <span style={{ fontWeight: 400 }}>
                    Cập nhật lần cuối:{" "}
                    {new Date(v.last_telemetry_at).toLocaleTimeString("vi-VN")}
                  </span>
                </>
              )}
            </span>
          ) : v.status === "online" ? (
            <>
              Tài xế: {v.driver_name || "—"}
              <br />
              Tốc độ: {v.last_speed ?? "—"} km/h
            </>
          ) : (
            <span style={{ color: "#888" }}>Đang không chạy chuyến nào</span>
          )}
          {v.last_risk_level && (
            <>
              <br />
              Risk gần nhất:{" "}
              <span className={`risk-badge risk-badge--${v.last_risk_level}`}>
                {v.last_risk_level}
              </span>
            </>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// Component con: tự fit bounds khi danh sách vị trí xe thay đổi lần đầu
function FitBoundsOnLoad({ positions }) {
  const map = useMap();
  const hasFitted = useRef(false);

  useEffect(() => {
    if (hasFitted.current || positions.length === 0) return;
    const bounds = L.latLngBounds(positions);
    // Nếu điểm xa nhau quá ngưỡng hợp lý cho 1 đội xe nội thành (~200km),
    // khả năng cao là dữ liệu rác (vd lẫn toạ độ test Simulator) -> giữ
    // nguyên center mặc định Hà Nội thay vì zoom ra cả thế giới.
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (sw.distanceTo(ne) > 200_000) {
      hasFitted.current = true;
      return;
    }
    map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
    hasFitted.current = true;
  }, [positions, map]);

  return null;
}

export default function FleetMap() {
  const [vehicles, setVehicles] = useState({}); // keyed by vehicle_id
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showNo2Layer, setShowNo2Layer] = useState(true);
  const [riskEvents, setRiskEvents] = useState([]);

  // Su kien nguy hiem tong hop 7 ngay gan nhat - du lieu tinh, khong can
  // poll realtime nhu vi tri xe, chi fetch 1 lan luc mount la du.
  useEffect(() => {
    apiClient
      .get("/api/dashboard/risk-events?days=7")
      .then((res) => setRiskEvents(res.data?.events || []))
      .catch((err) => {
        // Khong chan UI neu loi - day chi la lop bo sung, khong phai core
        console.error("[FleetMap] Lỗi tải risk-events:", err.message);
      });
  }, []);

  // Tu tick moi 5s de ep re-render tinh lai staleness - last_telemetry_at
  // khong tu doi nhung thoi gian troi qua thi 1 xe co the tu "binh thuong"
  // chuyen thanh "mat tin hieu" ngay ca khi khong co event Socket.IO nao
  // moi toi (vd run_fleet.py bi kill dot ngot, khong con gi de emit nua).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(interval);
  }, []);

  // 1. Load + đồng bộ định kỳ trạng thái từ REST (DB là nguồn sự thật).
  //    Không chỉ load 1 lần: Socket.IO (vehicle:position) chỉ CỘNG DỒN
  //    status "online", chưa có sự kiện nào báo xe quay lại "offline" khi
  //    trip completed/aborted -> xe xong chuyến bị kẹt "online" mãi, sau
  //    45s không telemetry thì hiện nhầm "mất tín hiệu" dù đã về bãi từ
  //    lâu. Refetch định kỳ là lưới an toàn để tự sửa lại state lệch,
  //    KHÔNG thay thế socket (vẫn ưu tiên realtime cho vị trí/heading).
  function fetchFleetStatus() {
    return apiClient
      .get("/api/dashboard/fleet-status")
      .then((res) => {
        const byId = {};
        for (const v of res.data) byId[v.vehicle_id] = v;
        setVehicles(byId);
      })
      .catch((err) =>
        setError(
          err.response?.data?.error || "Không tải được trạng thái đội xe",
        ),
      );
  }

  useEffect(() => {
    fetchFleetStatus().finally(() => setLoading(false));
    const interval = setInterval(fetchFleetStatus, 30_000);
    return () => clearInterval(interval);
  }, []);

  // 2. Lắng nghe vị trí realtime qua Socket.IO, merge vào state hiện có
  useEffect(() => {
    function handlePosition(payload) {
      setVehicles((prev) => {
        const existing = prev[payload.vehicleId];
        if (!existing) return prev; // xe lạ không nằm trong danh sách -> bỏ qua
        return {
          ...prev,
          [payload.vehicleId]: {
            ...existing,
            last_latitude: payload.latitude,
            last_longitude: payload.longitude,
            last_speed: payload.speed,
            last_telemetry_at: payload.ts,
            heading: payload.heading,
            status: "online",
          },
        };
      });
    }

    // Trip completed/aborted -> xe về offline ngay, không chờ refetch
    // định kỳ hay hết ngưỡng stale mới cập nhật đúng.
    function handleTripCompleted(payload) {
      setVehicles((prev) => {
        const existing = prev[payload.vehicleId];
        if (!existing) return prev;
        return {
          ...prev,
          [payload.vehicleId]: {
            ...existing,
            status: "offline",
            trip_id: null,
          },
        };
      });
    }

    socket.on("vehicle:position", handlePosition);
    socket.on("trip:completed", handleTripCompleted);
    return () => {
      socket.off("vehicle:position", handlePosition);
      socket.off("trip:completed", handleTripCompleted);
    };
  }, []);

  const vehicleList = useMemo(() => Object.values(vehicles), [vehicles]);

  const staleVehicleIds = useMemo(
    () =>
      new Set(
        vehicleList
          .filter((v) => isVehicleStale(v, now))
          .map((v) => v.vehicle_id),
      ),
    [vehicleList, now],
  );

  const validPositions = useMemo(
    () =>
      vehicleList
        .filter((v) => v.last_latitude != null && v.last_longitude != null)
        .map((v) => [v.last_latitude, v.last_longitude]),
    [vehicleList],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Bản đồ realtime</h1>
        <p
          style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}
        >
          <span className="live-dot" style={{ marginRight: 6 }} />
          {vehicleList.filter((v) => v.status === "online").length} /{" "}
          {vehicleList.length} xe đang chạy
          {staleVehicleIds.size > 0 && (
            <span
              style={{
                color: GLOW_BY_STATE.stale,
                fontWeight: 600,
                marginLeft: 8,
              }}
            >
              ⚠ {staleVehicleIds.size} xe mất tín hiệu
            </span>
          )}
        </p>
        {(() => {
          const idleCount = vehicleList.filter(
            (v) => v.status !== "online",
          ).length;
          if (idleCount === 0) return null;
          return (
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 12,
                marginTop: 2,
                fontStyle: "italic",
              }}
            >
              💺 {idleCount} xe vừa xong chặng, đang ngồi chơi xơi nước chờ cuốc
              mới...
            </p>
          );
        })()}
      </header>

      <div
        className="layer-control"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--text-secondary)",
          marginBottom: 12,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showNo2Layer}
            onChange={(e) => setShowNo2Layer(e.target.checked)}
          />
          🛰️ Lớp NO₂ (Sentinel-5P/TROPOMI)
        </label>
        {riskEvents.length > 0 && (
          <span>• {riskEvents.length} sự kiện nguy hiểm (7 ngày qua)</span>
        )}
      </div>

      <div
        className="fleet-legend"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "12px 20px",
          fontSize: 12,
          color: "var(--text-secondary)",
          marginBottom: 16,
        }}
      >
        {[
          {
            color: GLOW_BY_STATE.offline,
            label: "Không chạy chuyến (offline)",
          },
          {
            color: GLOW_BY_STATE.online_unknown,
            label: "Đang chạy, chưa có risk gần nhất",
          },
          { color: GLOW_BY_STATE.safe, label: "Risk: an toàn" },
          { color: GLOW_BY_STATE.medium, label: "Risk: trung bình" },
          { color: GLOW_BY_STATE.dangerous, label: "Risk: nguy hiểm" },
          {
            color: GLOW_BY_STATE.stale,
            label:
              "Mất tín hiệu (>45s không có dữ liệu mới trong lúc đang chạy)",
          },
        ].map((item) => (
          <span
            key={item.label}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: item.color,
                boxShadow: `0 0 4px ${item.color}`,
                flexShrink: 0,
              }}
            />
            {item.label}
          </span>
        ))}
      </div>

      {error && (
        <div
          className="card"
          style={{
            borderColor: "var(--risk-dangerous)",
            color: "var(--risk-dangerous)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          minHeight: 480,
          borderRadius: "var(--radius)",
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {!loading && (
          <MapContainer
            center={HANOI_CENTER}
            zoom={12}
            style={{ width: "100%", height: "100%" }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            {showNo2Layer && (
              <ImageOverlay
                url={NO2_LAYER.imageUrl}
                bounds={NO2_LAYER.bounds}
                opacity={0.45}
              />
            )}
            {riskEvents.map((ev) => {
              const style =
                RISK_EVENT_STYLE[ev.event_type] || DEFAULT_EVENT_STYLE;
              return (
                <CircleMarker
                  key={ev.event_id}
                  center={[ev.lat, ev.lng]}
                  radius={5}
                  pathOptions={{
                    color: style.color,
                    fillColor: style.color,
                    fillOpacity: 0.75,
                    weight: 1,
                  }}
                >
                  <Tooltip direction="top">
                    {style.label} —{" "}
                    {new Date(ev.occurred_at).toLocaleString("vi-VN")}
                  </Tooltip>
                </CircleMarker>
              );
            })}
            <FitBoundsOnLoad positions={validPositions} />

            {vehicleList.map((v) => {
              if (v.last_latitude == null || v.last_longitude == null)
                return null;
              const stale = isVehicleStale(v, now);
              const glowColor = riskGlowColor(v, stale);
              const vehicleType = vehicleTypeFor(v);
              return (
                <VehicleMarker
                  key={v.vehicle_id}
                  vehicle={v}
                  stale={stale}
                  glowColor={glowColor}
                  vehicleType={vehicleType}
                  isOffline={v.status !== "online"}
                  pulsing={v.status === "online" && !stale}
                  heading={v.heading || 0}
                />
              );
            })}
          </MapContainer>
        )}
      </div>

      <style>{`
                @keyframes fleet-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(61,214,196,0.5); }
                    70% { box-shadow: 0 0 0 8px rgba(61,214,196,0); }
                    100% { box-shadow: 0 0 0 0 rgba(61,214,196,0); }
                }
                @keyframes vehicle-glow-pulse {
                    0%, 100% { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 4px var(--glow-c)) drop-shadow(0 0 4px var(--glow-c-a)); }
                    50% { filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 9px var(--glow-c)) drop-shadow(0 0 9px var(--glow-c-a)); }
                }
            `}</style>
    </div>
  );
}
