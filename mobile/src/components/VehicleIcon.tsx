import { View } from "react-native";
import { SvgXml } from "react-native-svg";
import type { VehicleType } from "../types";

// Port 1:1 từ web/src/components/FleetMap.jsx (sedanSvg/truckSvg/.../duckSvg)
// - GIỮ NGUYÊN markup gốc để 2 bên luôn khớp hình khi cần đối chiếu.
// Nếu sau này bên web đổi hình dáng xe, nhớ đồng bộ lại object này.
type VehicleSvgDef = { viewBox: string; body: string };

const VEHICLE_SVG: Record<VehicleType, VehicleSvgDef> = {
  sedan: {
    viewBox: "0 0 100 150",
    body: `
      <rect x="10" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
      <rect x="79" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
      <rect x="10" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
      <rect x="79" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
      <rect x="20" y="8" width="60" height="134" rx="27" fill="#e6483d" stroke="#0b1220" stroke-width="2.2" />
      <rect x="43" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
      <rect x="25" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="66" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="15" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
      <rect x="79" y="30" width="6" height="4" rx="1.5" fill="#15181f" />
      <path d="M32 32 L68 32 L64 53 L36 53 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
      <path d="M37 34 L47 34 L40 48 L35 48 Z" fill="#c9ecfb" opacity="0.6" />
      <rect x="19" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
      <rect x="70" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
      <path d="M35 98 L65 98 L69 118 L31 118 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
      <rect x="25" y="128" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="66" y="128" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="43" y="135" width="14" height="6" rx="3" fill="#c9ccd1" />
    `,
  },
  truck: {
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
      <line x1="34" y1="38" x2="34" y2="46" stroke="#c98a10" stroke-width="1.4" />
      <line x1="40" y1="38" x2="40" y2="46" stroke="#c98a10" stroke-width="1.4" />
      <line x1="46" y1="38" x2="46" y2="46" stroke="#c98a10" stroke-width="1.4" />
      <rect x="27" y="42" width="8" height="5" rx="2" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="65" y="42" width="8" height="5" rx="2" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="16" y="50" width="68" height="102" rx="8" fill="#f0a020" stroke="#0b1220" stroke-width="2.2" />
      <line x1="16" y1="76" x2="84" y2="76" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
      <line x1="16" y1="102" x2="84" y2="102" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
      <line x1="16" y1="128" x2="84" y2="128" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
      <rect x="25" y="140" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="66" y="140" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="43" y="147" width="14" height="6" rx="3" fill="#c9ccd1" />
    `,
  },
  racecar: {
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
      <path d="M37 12 C40 9 44 8 47 8 L46 16 L38 17 Z" fill="#eaf6ff" stroke="#b8dcf0" stroke-width="0.6" />
      <path d="M63 12 C60 9 56 8 53 8 L54 16 L62 17 Z" fill="#eaf6ff" stroke="#b8dcf0" stroke-width="0.6" />
      <ellipse cx="50" cy="38" rx="15" ry="18" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
      <path d="M42 26 C45 24 48 23 50 23 L48 40 L41 38 Z" fill="#c9ecfb" opacity="0.6" />
      <circle cx="50" cy="78" r="12" fill="#f7f7f7" stroke="#0b1220" stroke-width="1.4" />
      <text x="50" y="83" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2230" font-family="Arial">7</text>
      <rect x="35" y="100" width="8" height="5" rx="2" fill="#e6483d" />
      <rect x="57" y="100" width="8" height="5" rx="2" fill="#e6483d" />
    `,
  },
  limousine: {
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
      <rect x="21" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="60" y="16" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
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
      <rect x="21" y="172" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="60" y="172" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="38" y="177" width="14" height="6" rx="3" fill="#c9ccd1" />
    `,
  },
  bus: {
    viewBox: "0 0 90 190",
    body: `
      <rect x="6" y="24" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="74" y="24" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="6" y="80" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="74" y="80" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="6" y="136" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="74" y="136" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="15" y="8" width="60" height="174" rx="14" fill="#f5c518" stroke="#0b1220" stroke-width="2.2" />
      <rect x="30" y="11" width="30" height="8" rx="2" fill="#1c1c1c" />
      <text x="45" y="17.5" font-size="6" font-weight="700" text-anchor="middle" fill="#f5c518" font-family="Arial">09A</text>
      <rect x="20" y="21" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
      <rect x="61" y="21" width="9" height="5.5" rx="2.5" fill="#fff6d8" stroke="#e0c060" stroke-width="0.5" />
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
      <rect x="20" y="178" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="61" y="178" width="9" height="5.5" rx="2.5" fill="#ff3b30" />
      <rect x="36" y="183" width="18" height="6" rx="3" fill="#c9ccd1" />
    `,
  },
  tractor: {
    viewBox: "0 0 100 175",
    body: `
      <rect x="12" y="120" width="12" height="24" rx="4" fill="#15181f" />
      <rect x="76" y="120" width="12" height="24" rx="4" fill="#15181f" />
      <rect x="14" y="95" width="72" height="66" rx="6" fill="#8a6d3b" stroke="#0b1220" stroke-width="2.2" />
      <line x1="14" y1="112" x2="86" y2="112" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
      <line x1="14" y1="129" x2="86" y2="129" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
      <line x1="14" y1="146" x2="86" y2="146" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
      <rect x="38" y="58" width="24" height="42" rx="3" fill="#6b6b6b" stroke="#0b1220" stroke-width="1.4" />
      <path d="M28 80 A22 22 0 0 1 72 80" fill="none" stroke="#3a3a3a" stroke-width="4" opacity="0.6" />
      <circle cx="50" cy="80" r="17" fill="#15181f" stroke="#3a3a3a" stroke-width="2" />
      <circle cx="50" cy="80" r="7" fill="#6b6b6b" />
      <rect x="28" y="16" width="44" height="48" rx="6" fill="#a35b3a" stroke="#0b1220" stroke-width="2.2" />
      <rect x="34" y="22" width="32" height="16" rx="3" fill="#3a3a3a" />
      <line x1="37" y1="24" x2="37" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
      <line x1="43" y1="24" x2="43" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
      <line x1="49" y1="24" x2="49" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
      <line x1="55" y1="24" x2="55" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
      <line x1="61" y1="24" x2="61" y2="36" stroke="#5c5c5c" stroke-width="1.2" />
      <rect x="64" y="4" width="10" height="16" rx="2" fill="#3a3a3a" stroke="#0b1220" stroke-width="1.2" />
      <rect x="62" y="18" width="14" height="5" rx="1.5" fill="#2a2a2a" />
      <ellipse cx="69" cy="4" rx="6" ry="2.8" fill="#1c1c1c" />
      <rect x="40" y="42" width="20" height="16" rx="3" fill="#5c4326" />
      <circle cx="34" cy="44" r="4" fill="#3a3a3a" stroke="#0b1220" stroke-width="1" />
    `,
  },
  duck: {
    viewBox: "0 0 100 140",
    body: `
      <rect x="10" y="70" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="80" y="70" width="10" height="20" rx="4" fill="#15181f" />
      <rect x="14" y="100" width="10" height="18" rx="4" fill="#15181f" />
      <rect x="76" y="100" width="10" height="18" rx="4" fill="#15181f" />
      <path d="M50 4
                C68 4 75 15 73 29
                C84 35 90 48 90 66
                C90 100 74 128 50 132
                C26 128 10 100 10 66
                C10 48 16 35 27 29
                C25 15 32 4 50 4 Z"
          fill="#ffd23f" stroke="#e0a800" stroke-width="2.2" />
      <path d="M46 6 C44 0 50 -3 54 2 C51 3 49 5 48 8 Z" fill="#ffd23f" stroke="#e0a800" stroke-width="1.6" />
      <ellipse cx="25" cy="44" rx="8" ry="5.5" fill="#ff9aa2" opacity="0.9" />
      <ellipse cx="75" cy="44" rx="8" ry="5.5" fill="#ff9aa2" opacity="0.9" />
      <circle cx="41" cy="32" r="7" fill="#1c1c1c" />
      <circle cx="59" cy="32" r="7" fill="#1c1c1c" />
      <circle cx="43.5" cy="29" r="2.4" fill="#ffffff" />
      <circle cx="61.5" cy="29" r="2.4" fill="#ffffff" />
      <circle cx="39" cy="35" r="1.1" fill="#ffffff" opacity="0.8" />
      <circle cx="57" cy="35" r="1.1" fill="#ffffff" opacity="0.8" />
      <path d="M40 22 C43 14 57 14 60 22 C58 27 42 27 40 22 Z" fill="#ff8c42" stroke="#e0a800" stroke-width="1.6" />
      <path d="M44 27 Q50 30 56 27" stroke="#c97a1a" stroke-width="1.3" fill="none" stroke-linecap="round" />
      <path d="M42 52 L50 57 L42 62 Z" fill="#ff5d73" stroke="#c93a4f" stroke-width="1" />
      <path d="M58 52 L50 57 L58 62 Z" fill="#ff5d73" stroke="#c93a4f" stroke-width="1" />
      <circle cx="50" cy="57" r="3" fill="#ff3b52" />
      <path d="M14 66 C8 76 8 92 16 102 C20 92 20 78 22 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
      <path d="M86 66 C92 76 92 92 84 102 C80 92 80 78 78 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
      <rect x="41" y="122" width="18" height="7" rx="3" fill="#f7f7f7" stroke="#0b1220" stroke-width="1" />
    `,
  },
};

// Kích thước hiển thị mặc định cho từng loại - port từ VEHICLE_DISPLAY_SIZE
// bên web, giữ đúng tỉ lệ khung hình riêng của từng mẫu xe.
const VEHICLE_DISPLAY_SIZE: Record<VehicleType, [number, number]> = {
  sedan: [26, 39],
  truck: [26, 42],
  racecar: [26, 41],
  limousine: [22, 46],
  bus: [22, 46],
  tractor: [26, 44],
  duck: [26, 36],
};

type VehicleIconProps = {
  type: VehicleType;
  /** Chiều cao mong muốn (px) - width tự tính theo đúng tỉ lệ khung hình gốc. */
  height?: number;
  /** Góc xoay (độ) - dùng khi cần tự xoay icon (vd không dùng rotation của Marker). */
  rotation?: number;
};

export default function VehicleIcon({
  type,
  height = 40,
  rotation = 0,
}: VehicleIconProps) {
  const def = VEHICLE_SVG[type] ?? VEHICLE_SVG.sedan;
  const [baseW, baseH] =
    VEHICLE_DISPLAY_SIZE[type] ?? VEHICLE_DISPLAY_SIZE.sedan;
  const scale = height / baseH;
  const w = baseW * scale;
  const h = height;
  const xml = `<svg viewBox="${def.viewBox}" xmlns="http://www.w3.org/2000/svg">${def.body}</svg>`;

  return (
    <View
      style={{
        width: w,
        height: h,
        transform: rotation ? [{ rotate: `${rotation}deg` }] : undefined,
      }}
    >
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}
