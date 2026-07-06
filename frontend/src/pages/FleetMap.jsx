import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { apiClient } from '../api/client.js';
import { socket } from '../api/socket.js';

const HANOI_CENTER = [21.0285, 105.8542];

// Màu marker theo trạng thái/risk — dùng đúng token trong index.css
const COLOR_BY_STATE = {
    offline: '#5b6478', // var(--text-muted)
    online_unknown: '#3dd6c4', // var(--accent) - đang chạy, chưa có risk gần nhất
    safe: '#34d399',
    medium: '#fbbf24',
    dangerous: '#f87171',
};

function markerColor(vehicle) {
    if (vehicle.status !== 'online') return COLOR_BY_STATE.offline;
    if (vehicle.last_risk_level) return COLOR_BY_STATE[vehicle.last_risk_level] || COLOR_BY_STATE.online_unknown;
    return COLOR_BY_STATE.online_unknown;
}

// divIcon vẽ 1 chiếc xe kiểu "cute/đồ chơi" nhìn từ trên xuống (theo mẫu
// tham khảo): thân bo tròn, kính xanh (kính trước/sau + 2 kính hông), đèn
// báo rẽ màu cam ở 4 góc, bánh xe đen lồi ra 2 bên, bảng số/cảm biến xám
// ở đầu và đuôi xe. Xoay theo `heading` thật (0° = hướng Bắc).
function buildIcon(color, pulsing, heading = 0) {
    const glow = pulsing ? `filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)) drop-shadow(0 0 5px ${color}99);` : 'filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));';
    return L.divIcon({
        className: '',
        html: `
            <div style="width: 26px; height: 39px; transform: rotate(${heading}deg); transition: transform 0.4s linear; ${glow}">
                <svg width="26" height="39" viewBox="0 0 100 150" xmlns="http://www.w3.org/2000/svg">
                    <!-- Banh xe (den, lo ra 2 ben, ve truoc de nam duoi than xe) -->
                    <rect x="10" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
                    <rect x="79" y="28" width="11" height="24" rx="4.5" fill="#15181f" />
                    <rect x="10" y="98" width="11" height="24" rx="4.5" fill="#15181f" />
                    <rect x="79" y="98" width="11" height="24" rx="4.5" fill="#15181f" />

                    <!-- Than xe: hinh chu nhat bo tron manh -->
                    <rect x="20" y="8" width="60" height="134" rx="27" fill="${color}" stroke="#0b1220" stroke-width="2.2" />

                    <!-- Bang cam bien / bien so o dau xe -->
                    <rect x="43" y="9" width="14" height="6" rx="3" fill="#c9ccd1" />
                    <!-- Den bao re truoc (cam) -->
                    <rect x="25" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />
                    <rect x="66" y="16" width="9" height="5.5" rx="2.5" fill="#ffb020" />

                    <!-- Kinh chan gio truoc -->
                    <path d="M32 32 L68 32 L64 53 L36 53 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
                    <!-- Anh sang phan chieu tren kinh truoc -->
                    <path d="M37 34 L47 34 L40 48 L35 48 Z" fill="#c9ecfb" opacity="0.6" />

                    <!-- Kinh hong trai/phai -->
                    <rect x="19" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />
                    <rect x="70" y="60" width="11" height="30" rx="4" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />

                    <!-- Kinh chan gio sau -->
                    <path d="M35 98 L65 98 L69 118 L31 118 Z" fill="#8fd0f4" stroke="#5aa8d6" stroke-width="0.8" />

                    <!-- Den hau (cam) -->
                    <rect x="25" y="128" width="9" height="5.5" rx="2.5" fill="#ffb020" />
                    <rect x="66" y="128" width="9" height="5.5" rx="2.5" fill="#ffb020" />
                    <!-- Bien so sau -->
                    <rect x="43" y="135" width="14" height="6" rx="3" fill="#c9ccd1" />
                </svg>
            </div>`,
        iconSize: [26, 39],
        iconAnchor: [13, 19.5],
        popupAnchor: [0, -21],
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
                            const color = markerColor(v);
                            return (
                                <Marker
                                    key={v.vehicle_id}
                                    position={[v.last_latitude, v.last_longitude]}
                                    icon={buildIcon(color, v.status === 'online', v.heading || 0)}
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
