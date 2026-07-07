import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiClient } from '../api/client.js';
import { socket } from '../api/socket.js';

const HANOI_CENTER = [21.0285, 105.8542];

// Màu QUẦNG SÁNG (glow) theo trạng thái/risk — KHÔNG còn nhuộm màu thân xe,
// chỉ là viền sáng bao quanh, để phân biệt với màu sơn cố định của từng loại xe.
const GLOW_BY_STATE = {
    offline: '#5b6478', // var(--text-muted)
    online_unknown: '#3dd6c4', // var(--accent) - đang chạy, chưa có risk gần nhất
    safe: '#34d399',
    medium: '#fbbf24',
    dangerous: '#f87171',
};

function riskGlowColor(vehicle) {
    if (vehicle.status !== 'online') return GLOW_BY_STATE.offline;
    if (vehicle.last_risk_level) return GLOW_BY_STATE[vehicle.last_risk_level] || GLOW_BY_STATE.online_unknown;
    return GLOW_BY_STATE.online_unknown;
}

// Mỗi xe được gán 1 "loại xe" cố định theo vehicle_id (chỉ để tạo sự đa
// dạng hình ảnh trên map - không liên quan nghiệp vụ) - luân phiên qua 4 mẫu.
const VEHICLE_TYPES = ['sedan', 'truck', 'racecar', 'limousine', 'bus', 'congnong', 'duck'];
function vehicleTypeFor(vehicleId) {
    return VEHICLE_TYPES[(vehicleId - 1) % VEHICLE_TYPES.length] || 'sedan';
}

// --- 4 mẫu xe, mỗi mẫu có màu sơn + hình dáng riêng, kính/đèn/bánh vẽ tay ---

function sedanSvg() {
    return {
        viewBox: '0 0 100 150',
        body: `
            <rect x="10" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="79" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="10" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="79" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
            <rect x="20" y="8" width="60" height="134" rx="27" fill="#e6483d" stroke="#0b1220" stroke-width="2.2" />
            <rect x="43" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
            <rect x="25" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="66" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <path d="M32 32 L68 32 L64 53 L36 53 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M37 34 L47 34 L40 48 L35 48 Z" fill="#c9ecfb" opacity="0.6" />
            <rect x="19" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="70" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M35 98 L65 98 L69 118 L31 118 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="25" y="128" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="66" y="128" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="43" y="135" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
    };
}

function truckSvg() {
    return {
        viewBox: '0 0 100 160',
        body: `
            <!-- Banh xe (2 cap, banh sau to hon vi cho hang) -->
            <rect x="8" y="24" width="11" height="20" rx="4" fill="#15181f" />
            <rect x="81" y="24" width="11" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="90" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="81" y="90" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="6" y="120" width="13" height="26" rx="4.5" fill="#15181f" />
            <rect x="81" y="120" width="13" height="26" rx="4.5" fill="#15181f" />
            <!-- Ca-bin (dau xe, ngan + vuong) -->
            <rect x="22" y="6" width="56" height="46" rx="14" fill="#f0a020" stroke="#0b1220" stroke-width="2.2" />
            <path d="M30 16 C31 14 33 13 50 13 C67 13 69 14 70 16 L71 34 L29 34 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="43" y="7" width="14" height="5" rx="2.5" fill="#c9ccd1" />
            <rect x="27" y="42" width="8" height="5" rx="2" fill="#ffb020" />
            <rect x="65" y="42" width="8" height="5" rx="2" fill="#ffb020" />
            <!-- Thung hang (hinh chu nhat lon, co gach ngan tuong trung tam container) -->
            <rect x="16" y="50" width="68" height="102" rx="8" fill="#f0a020" stroke="#0b1220" stroke-width="2.2" />
            <line x1="16" y1="76" x2="84" y2="76" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <line x1="16" y1="102" x2="84" y2="102" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <line x1="16" y1="128" x2="84" y2="128" stroke="#0b1220" stroke-width="1.4" opacity="0.35" />
            <rect x="25" y="140" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="66" y="140" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="43" y="147" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
    };
}

function racecarSvg() {
    return {
        viewBox: '0 0 100 158',
        body: `
            <!-- Canh gio sau (spoiler) -->
            <rect x="12" y="132" width="76" height="8" rx="3" fill="#1c2230" stroke="#0b1220" stroke-width="1.4" />
            <rect x="20" y="122" width="8" height="14" fill="#1c2230" />
            <rect x="72" y="122" width="8" height="14" fill="#1c2230" />
            <!-- Banh xe (lo ra ngoai nhieu hon - xe dua ban rong) -->
            <rect x="4" y="30" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="84" y="30" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="4" y="96" width="12" height="26" rx="5" fill="#15181f" />
            <rect x="84" y="96" width="12" height="26" rx="5" fill="#15181f" />
            <!-- Than xe: mui nhon, than thon dai kieu khi dong hoc -->
            <path d="M50 4
                     C58 4 64 10 66 20
                     L70 60 C71 80 71 100 68 118
                     C66 128 60 133 50 133
                     C40 133 34 128 32 118
                     C29 100 29 80 30 60
                     L34 20
                     C36 10 42 4 50 4 Z"
                fill="#f5d90a" stroke="#0b1220" stroke-width="2.2" />
            <!-- Soc dua (racing stripe) -->
            <rect x="46" y="6" width="8" height="124" fill="#1c2230" opacity="0.85" />
            <!-- Kinh buong lai (nho, o giua) -->
            <ellipse cx="50" cy="38" rx="15" ry="18" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <path d="M42 26 C45 24 48 23 50 23 L48 40 L41 38 Z" fill="#c9ecfb" opacity="0.6" />
            <!-- So xe (decal tron) -->
            <circle cx="50" cy="78" r="12" fill="#f7f7f7" stroke="#0b1220" stroke-width="1.4" />
            <text x="50" y="83" font-size="14" font-weight="700" text-anchor="middle" fill="#1c2230" font-family="Arial">7</text>
            <rect x="35" y="100" width="8" height="5" rx="2" fill="#e6483d" />
            <rect x="57" y="100" width="8" height="5" rx="2" fill="#e6483d" />
        `,
    };
}

function limousineSvg() {
    return {
        viewBox: '0 0 90 190',
        body: `
            <!-- Banh xe (4 cap vi than xe rat dai) -->
            <rect x="6" y="26" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="26" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="76" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="76" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="126" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="126" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="152" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="152" width="10" height="20" rx="4" fill="#15181f" />
            <!-- Than xe dai, bong bay (den/xam dam kieu limousine) -->
            <rect x="16" y="8" width="58" height="174" rx="24" fill="#2d3436" stroke="#0b1220" stroke-width="2.2" />
            <rect x="38" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
            <rect x="21" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="60" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <!-- Kinh chan gio truoc -->
            <path d="M27 30 L63 30 L59 48 L31 48 Z" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <!-- 3 kinh hong doc than xe (tuong trung xe dai) -->
            <rect x="15" y="55" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="55" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="15" y="84" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="84" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="15" y="113" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="66" y="113" width="9" height="24" rx="3" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <!-- Kinh chan gio sau -->
            <path d="M31 148 L59 148 L63 166 L27 166 Z" fill="#40484f" stroke="#1c2230" stroke-width="0.8" />
            <rect x="21" y="172" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="60" y="172" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="38" y="177" width="14" height="6" rx="3" fill="#c9ccd1" />
        `,
    };
}

function busSvg() {
    return {
        viewBox: '0 0 90 190',
        body: `
            <rect x="6" y="24" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="24" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="80" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="80" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="6" y="136" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="74" y="136" width="10" height="20" rx="4" fill="#15181f" />
            <!-- Than xe: hop dai, vuong vuc kieu xe buyt -->
            <rect x="15" y="8" width="60" height="174" rx="14" fill="#f5c518" stroke="#0b1220" stroke-width="2.2" />
            <rect x="36" y="9" width="18" height="6" rx="3" fill="#c9ccd1" />
            <rect x="20" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="61" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <!-- Kinh chan gio truoc -->
            <path d="M25 28 L65 28 L62 42 L28 42 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <!-- Day cua so doc than xe (dac trung xe buyt) -->
            <rect x="19" y="48" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="48" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="70" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="70" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="92" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="92" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="19" y="114" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <rect x="61" y="114" width="10" height="18" rx="2.5" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.6" />
            <!-- Vach soc trang than xe -->
            <rect x="15" y="136" width="60" height="6" fill="#ffffff" opacity="0.85" />
            <!-- Kinh chan gio sau -->
            <path d="M28 156 L62 156 L65 174 L25 174 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
            <rect x="20" y="178" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="61" y="178" width="9" height="5.5" rx="2.5" fill="#ffb020" />
            <rect x="36" y="183" width="18" height="6" rx="3" fill="#c9ccd1" />
        `,
    };
}

function congnongSvg() {
    return {
        viewBox: '0 0 100 175',
        body: `
            <!-- Banh sau (thung hang - 2 banh nho) -->
            <rect x="12" y="120" width="12" height="24" rx="4" fill="#15181f" />
            <rect x="76" y="120" width="12" height="24" rx="4" fill="#15181f" />
            <!-- Thung hang phang phia sau (go, mau nau) -->
            <rect x="14" y="95" width="72" height="66" rx="6" fill="#8a6d3b" stroke="#0b1220" stroke-width="2.2" />
            <line x1="14" y1="112" x2="86" y2="112" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <line x1="14" y1="129" x2="86" y2="129" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <line x1="14" y1="146" x2="86" y2="146" stroke="#0b1220" stroke-width="1.3" opacity="0.4" />
            <!-- Khung noi dau may voi thung (thanh sat mong) -->
            <rect x="42" y="60" width="16" height="40" fill="#6b6b6b" stroke="#0b1220" stroke-width="1.4" />
            <!-- Banh truoc (1 banh to duy nhat - dac trung cong nong keo bang dau may keo tay) -->
            <rect x="34" y="66" width="32" height="30" rx="8" fill="#15181f" opacity="0" />
            <circle cx="50" cy="80" r="17" fill="#15181f" stroke="#3a3a3a" stroke-width="2" />
            <circle cx="50" cy="80" r="7" fill="#6b6b6b" />
            <!-- Dau may no (khoi vuong nho, mau gi set) -->
            <rect x="30" y="18" width="40" height="46" rx="6" fill="#a35b3a" stroke="#0b1220" stroke-width="2.2" />
            <rect x="36" y="24" width="28" height="14" rx="3" fill="#3a3a3a" />
            <!-- Ong po dung (dac trung cong nong) -->
            <rect x="60" y="2" width="8" height="22" rx="2" fill="#3a3a3a" stroke="#0b1220" stroke-width="1.2" />
            <ellipse cx="64" cy="2" rx="5" ry="2.5" fill="#1c1c1c" />
            <!-- Ghe/tay lai don gian -->
            <rect x="40" y="42" width="20" height="16" rx="3" fill="#5c4326" />
            <circle cx="34" cy="44" r="4" fill="#3a3a3a" stroke="#0b1220" stroke-width="1" />
        `,
    };
}

function duckSvg() {
    return {
        viewBox: '0 0 100 140',
        body: `
            <!-- Banh xe (nho, an duoi than vit) -->
            <rect x="10" y="70" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="80" y="70" width="10" height="20" rx="4" fill="#15181f" />
            <rect x="14" y="100" width="10" height="18" rx="4" fill="#15181f" />
            <rect x="76" y="100" width="10" height="18" rx="4" fill="#15181f" />
            <!-- Than vit: bau tron phinh o duoi, thon lai o dau -->
            <path d="M50 6
                     C66 6 72 16 71 28
                     C82 34 90 48 90 66
                     C90 100 74 128 50 132
                     C26 128 10 100 10 66
                     C10 48 18 34 29 28
                     C28 16 34 6 50 6 Z"
                fill="#ffd23f" stroke="#e0a800" stroke-width="2.2" />
            <!-- Ma hong -->
            <ellipse cx="27" cy="46" rx="7" ry="5" fill="#ff9aa2" opacity="0.8" />
            <ellipse cx="73" cy="46" rx="7" ry="5" fill="#ff9aa2" opacity="0.8" />
            <!-- Mat -->
            <circle cx="38" cy="34" r="5.5" fill="#1c1c1c" />
            <circle cx="62" cy="34" r="5.5" fill="#1c1c1c" />
            <circle cx="40" cy="32" r="1.6" fill="#ffffff" />
            <circle cx="64" cy="32" r="1.6" fill="#ffffff" />
            <!-- Mo vit (mau cam, nhon ra phia truoc) -->
            <path d="M38 20 C42 10 58 10 62 20 C60 26 40 26 38 20 Z" fill="#ff8c42" stroke="#e0a800" stroke-width="1.6" />
            <!-- Canh (2 ben than) -->
            <path d="M14 66 C8 76 8 92 16 102 C20 92 20 78 22 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
            <path d="M86 66 C92 76 92 92 84 102 C80 92 80 78 78 68 Z" fill="#ffe27a" stroke="#e0a800" stroke-width="1.4" />
            <!-- Bien so nho o duoi cho dung 'xe' -->
            <rect x="41" y="122" width="18" height="7" rx="3" fill="#f7f7f7" stroke="#0b1220" stroke-width="1" />
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
};

// divIcon: chọn đúng mẫu xe theo `vehicleType`, xoay theo `heading` thật,
// quầng sáng (glow) đổi màu theo risk-level - màu sơn xe thì giữ cố định
// theo loại xe, không đổi theo risk nữa.
function buildIcon(vehicleType, glowColor, pulsing, heading = 0) {
    const { viewBox, body } = (VEHICLE_SVG_BUILDERS[vehicleType] || sedanSvg)();
    const [w, h] = VEHICLE_DISPLAY_SIZE[vehicleType] || [26, 39];
    const glow = pulsing
        ? `filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 6px ${glowColor}) drop-shadow(0 0 6px ${glowColor}aa);`
        : `filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)) drop-shadow(0 0 3px ${glowColor}88);`;

    return L.divIcon({
        className: '',
        html: `
            <div style="width: ${w}px; height: ${h}px; transform: rotate(${heading}deg); transition: transform 0.4s linear; ${glow}">
                <svg width="${w}" height="${h}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg">
                    ${body}
                </svg>
            </div>`,
        iconSize: [w, h],
        iconAnchor: [w / 2, h / 2],
        popupAnchor: [0, -(h / 2) - 2],
    });
}

// Component con: tự fit bounds khi danh sách vị trí xe thay đổi lần đầu
function FitBoundsOnLoad({ positions }) {
    const map = useMap();
    const hasFitted = useRef(false);

    useEffect(() => {
        if (hasFitted.current || positions.length === 0) return;
        const bounds = L.latLngBounds(positions);
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 });
        hasFitted.current = true;
    }, [positions, map]);

    return null;
}

export default function FleetMap() {
    const [vehicles, setVehicles] = useState({}); // keyed by vehicle_id
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    // 1. Load trạng thái ban đầu qua REST
    useEffect(() => {
        apiClient
            .get('/api/dashboard/fleet-status')
            .then((res) => {
                const byId = {};
                for (const v of res.data) byId[v.vehicle_id] = v;
                setVehicles(byId);
            })
            .catch((err) => setError(err.response?.data?.error || 'Không tải được trạng thái đội xe'))
            .finally(() => setLoading(false));
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
                        status: 'online',
                    },
                };
            });
        }

        socket.on('vehicle:position', handlePosition);
        return () => socket.off('vehicle:position', handlePosition);
    }, []);

    const vehicleList = useMemo(() => Object.values(vehicles), [vehicles]);

    const validPositions = useMemo(
        () =>
            vehicleList
                .filter((v) => v.last_latitude != null && v.last_longitude != null)
                .map((v) => [v.last_latitude, v.last_longitude]),
        [vehicleList]
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <header style={{ marginBottom: 16 }}>
                <h1 style={{ margin: 0, fontSize: 20 }}>Bản đồ realtime</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                    <span className="live-dot" style={{ marginRight: 6 }} />
                    {vehicleList.filter((v) => v.status === 'online').length} / {vehicleList.length} xe đang chạy
                </p>
            </header>

            {error && (
                <div className="card" style={{ borderColor: 'var(--risk-dangerous)', color: 'var(--risk-dangerous)', marginBottom: 16 }}>
                    {error}
                </div>
            )}

            <div style={{ flex: 1, minHeight: 480, borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                {!loading && (
                    <MapContainer center={HANOI_CENTER} zoom={12} style={{ width: '100%', height: '100%' }}>
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; OpenStreetMap contributors'
                        />
                        <FitBoundsOnLoad positions={validPositions} />

                        {vehicleList.map((v) => {
                            if (v.last_latitude == null || v.last_longitude == null) return null;
                            const glowColor = riskGlowColor(v);
                            const vehicleType = vehicleTypeFor(v.vehicle_id);
                            return (
                                <Marker
                                    key={v.vehicle_id}
                                    position={[v.last_latitude, v.last_longitude]}
                                    icon={buildIcon(vehicleType, glowColor, v.status === 'online', v.heading || 0)}
                                >
                                    <Popup>
                                        <div style={{ fontFamily: 'var(--font-ui)', minWidth: 160 }}>
                                            <strong>{v.license_plate}</strong> — {v.model}
                                            <br />
                                            {v.status === 'online' ? (
                                                <>
                                                    Tài xế: {v.driver_name || '—'}
                                                    <br />
                                                    Tốc độ: {v.last_speed ?? '—'} km/h
                                                </>
                                            ) : (
                                                <span style={{ color: '#888' }}>Đang không chạy chuyến nào</span>
                                            )}
                                            {v.last_risk_level && (
                                                <>
                                                    <br />
                                                    Risk gần nhất:{' '}
                                                    <span className={`risk-badge risk-badge--${v.last_risk_level}`}>
                                                        {v.last_risk_level}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </Popup>
                                </Marker>
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
            `}</style>
        </div>
    );
}
