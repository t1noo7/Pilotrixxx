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

// divIcon vẽ 1 chiếc xe nhìn từ trên xuống (top-view), xoay theo `heading`
// thật của xe (0° = hướng Bắc, đúng chuẩn la bàn GPS) — thay cho chấm tròn
// tĩnh, nhìn trực quan và sống động hơn khi xe di chuyển trên map.
function buildIcon(color, pulsing, heading = 0) {
    const glow = pulsing ? `filter: drop-shadow(0 0 4px ${color}aa);` : '';
    return L.divIcon({
        className: '',
        html: `
            <div style="width: 26px; height: 26px; transform: rotate(${heading}deg); transition: transform 0.4s linear; ${glow}">
                <svg width="26" height="26" viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">
                    <!-- Than xe (nhin tu tren xuong), dau xe huong len tren = 0 do -->
                    <path d="M13 2.5
                             C15.8 2.5 17 5.2 17.4 8
                             L18.2 15
                             C18.5 17.5 17.8 19 16.6 20.2
                             L16.6 22
                             C16.6 22.9 15.9 23.5 15 23.5
                             L11 23.5
                             C10.1 23.5 9.4 22.9 9.4 22
                             L9.4 20.2
                             C8.2 19 7.5 17.5 7.8 15
                             L8.6 8
                             C9 5.2 10.2 2.5 13 2.5 Z"
                        fill="${color}" stroke="#0b1220" stroke-width="1.1" />
                    <!-- Kinh chan gio truoc -->
                    <rect x="9.6" y="6.2" width="6.8" height="4.2" rx="1.2" fill="#0b1220" opacity="0.4" />
                    <!-- Kinh chan gio sau -->
                    <rect x="9.9" y="15.8" width="6.2" height="3.4" rx="1.1" fill="#0b1220" opacity="0.3" />
                </svg>
            </div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -14],
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
