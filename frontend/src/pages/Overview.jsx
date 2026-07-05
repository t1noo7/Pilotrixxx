import { useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';

export default function Overview() {
    const [stats, setStats] = useState(null);
    const [fleet, setFleet] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        Promise.all([apiClient.get('/api/dashboard/stats'), apiClient.get('/api/dashboard/fleet-status')])
            .then(([statsRes, fleetRes]) => {
                setStats(statsRes.data);
                setFleet(fleetRes.data);
            })
            .catch((err) => setError(err.response?.data?.error || 'Không tải được dữ liệu từ backend'));
    }, []);

    return (
        <div>
            <header style={{ marginBottom: 24 }}>
                <h1 style={{ margin: 0, fontSize: 20 }}>Tổng quan đội xe</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                    <span className="live-dot" style={{ marginRight: 6 }} />
                    Dữ liệu realtime từ backend
                </p>
            </header>

            {error && (
                <div className="card" style={{ borderColor: 'var(--risk-dangerous)', color: 'var(--risk-dangerous)' }}>
                    {error}
                </div>
            )}

            {!error && !stats && <p style={{ color: 'var(--text-secondary)' }}>Đang tải…</p>}

            {stats && (
                <pre
                    className="card"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, overflowX: 'auto', marginBottom: 20 }}
                >
                    {JSON.stringify(stats, null, 2)}
                </pre>
            )}

            {fleet && (
                <pre className="card" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, overflowX: 'auto' }}>
                    {JSON.stringify(fleet, null, 2)}
                </pre>
            )}

            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 20 }}>
                (Đây là dữ liệu thô để verify kết nối API — sẽ thay bằng biểu đồ/thẻ số liệu ở bước tiếp theo)
            </p>
        </div>
    );
}
