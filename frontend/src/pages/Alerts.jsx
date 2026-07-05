import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';
import { socket } from '../api/socket.js';

const EVENT_LABELS = {
    hard_brake: 'Phanh gấp',
    rapid_accel: 'Tăng tốc đột ngột',
    sharp_turn: 'Đánh lái gấp',
    overspeed: 'Vượt tốc độ',
    gps_invalid: 'Mất tín hiệu GPS',
};

// severity trong DB chỉ có medium/high — map sang class màu risk có sẵn
// (high dùng màu 'dangerous' để nổi bật, vì alert high là mức nghiêm trọng nhất)
const SEVERITY_CLASS = {
    medium: 'medium',
    high: 'dangerous',
};

function formatTime(isoString) {
    return new Date(isoString).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export default function Alerts() {
    const [alerts, setAlerts] = useState([]);
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [justArrivedId, setJustArrivedId] = useState(null); // để tạo hiệu ứng nhấp nháy alert mới

    const fetchAlerts = useCallback((showLoading = false) => {
        if (showLoading) setLoading(true);
        const params = { limit: 50 };
        if (unreadOnly) params.isRead = 'false';

        apiClient
            .get('/api/alerts', { params })
            .then((res) => setAlerts(res.data))
            .catch((err) => setError(err.response?.data?.error || 'Không tải được danh sách cảnh báo'))
            .finally(() => setLoading(false));
    }, [unreadOnly]);

    // Load lại mỗi khi đổi filter
    useEffect(() => {
        fetchAlerts(true);
    }, [fetchAlerts]);

    // Có alert mới từ Socket.IO -> gọi lại API để lấy đúng alert_id thật từ DB
    useEffect(() => {
        function handleNewAlert(payload) {
            fetchAlerts(false);
            // Đánh dấu tạm để làm hiệu ứng nhấp nháy dòng đầu (dùng vehicleId+occurredAt
            // làm khoá tạm vì chưa có alert_id thật lúc này)
            const tempKey = `${payload.vehicleId}-${payload.occurredAt}`;
            setJustArrivedId(tempKey);
            setTimeout(() => setJustArrivedId(null), 3000);
        }
        socket.on('alert', handleNewAlert);
        return () => socket.off('alert', handleNewAlert);
    }, [fetchAlerts]);

    function markAsRead(alertId) {
        // Cập nhật lạc quan (optimistic) trước, rollback nếu API lỗi
        setAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? { ...a, is_read: true } : a)));
        apiClient.put(`/api/alerts/${alertId}/read`).catch(() => {
            setAlerts((prev) => prev.map((a) => (a.alert_id === alertId ? { ...a, is_read: false } : a)));
        });
    }

    const unreadCount = alerts.filter((a) => !a.is_read).length;

    return (
        <div>
            <header style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 20 }}>Cảnh báo</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                        <span className="live-dot" style={{ marginRight: 6 }} />
                        {unreadCount} cảnh báo chưa đọc
                    </p>
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <FilterTab label="Tất cả" active={!unreadOnly} onClick={() => setUnreadOnly(false)} />
                    <FilterTab label="Chưa đọc" active={unreadOnly} onClick={() => setUnreadOnly(true)} />
                </div>
            </header>

            {error && (
                <div className="card" style={{ borderColor: 'var(--risk-dangerous)', color: 'var(--risk-dangerous)', marginBottom: 16 }}>
                    {error}
                </div>
            )}

            {loading && <p style={{ color: 'var(--text-secondary)' }}>Đang tải…</p>}

            {!loading && alerts.length === 0 && (
                <div className="card" style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Không có cảnh báo nào{unreadOnly ? ' chưa đọc' : ''}.
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {alerts.map((alert) => {
                    const tempKey = `${alert.vehicle_id}-${alert.occurred_at}`;
                    const isFlashing = tempKey === justArrivedId;
                    const severityClass = SEVERITY_CLASS[alert.severity] || 'medium';

                    return (
                        <div
                            key={alert.alert_id}
                            className={`card card--risk-left is-${severityClass}`}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                opacity: alert.is_read ? 0.6 : 1,
                                transition: 'background 0.4s',
                                background: isFlashing ? 'var(--bg-surface-raised)' : 'var(--bg-surface)',
                            }}
                        >
                            <div>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                                    <span className={`risk-badge risk-badge--${severityClass === 'dangerous' ? 'dangerous' : 'medium'}`}>
                                        {alert.severity}
                                    </span>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                                        {EVENT_LABELS[alert.event_type] || alert.event_type}
                                    </span>
                                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                        {formatTime(alert.occurred_at)}
                                    </span>
                                </div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{alert.message}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                    {alert.license_plate} — {alert.driver_name} · Trip #{alert.trip_id}
                                </div>
                            </div>

                            {!alert.is_read && (
                                <button
                                    onClick={() => markAsRead(alert.alert_id)}
                                    style={{
                                        background: 'transparent',
                                        border: '1px solid var(--border-strong)',
                                        color: 'var(--text-secondary)',
                                        borderRadius: 'var(--radius-sm)',
                                        padding: '6px 12px',
                                        fontSize: 12,
                                        cursor: 'pointer',
                                        flexShrink: 0,
                                    }}
                                >
                                    Đánh dấu đã đọc
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function FilterTab({ label, active, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                background: active ? 'var(--bg-surface-raised)' : 'transparent',
                border: '1px solid var(--border-subtle)',
                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 14px',
                fontSize: 13,
                cursor: 'pointer',
            }}
        >
            {label}
        </button>
    );
}
