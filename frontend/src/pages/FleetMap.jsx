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

// divIcon thay vì ảnh marker mặc định của Leaflet (hay lỗi path khi bundle) —
// vẽ 1 chấm tròn màu + viền, đồng bộ với phong cách "control room" của app.
function buildIcon(color, pulsing) {
    return L.divIcon({
        className: '',
        html: `<div style="
            width: 16px; height: 16px; border-radius: 50%;
            background: ${color}; border: 2px solid #0b1220;
            box-shadow: 0 0 0 2px ${color}55;
            ${pulsing ? 'animation: fleet-pulse 1.6s infinite;' : ''}
        "></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -10],
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
                                    icon={buildIcon(color, v.status === 'online')}
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
