import { useEffect, useState } from 'react';
import { apiClient } from '../api/client.js';

export default function Drivers() {
    const [ranking, setRanking] = useState([]);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        apiClient
            .get('/api/drivers/ranking', { params: { limit: 20 } })
            .then((res) => setRanking(res.data))
            .catch((err) => setError(err.response?.data?.error || 'Không tải được bảng xếp hạng'))
            .finally(() => setLoading(false));
    }, []);

    return (
        <div>
            <header style={{ marginBottom: 20 }}>
                <h1 style={{ margin: 0, fontSize: 20 }}>Xếp hạng tài xế</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                    Sắp xếp theo điểm rủi ro trung bình (final_risk_score) — cao nhất lên trước
                </p>
            </header>

            {error && (
                <div className="card" style={{ borderColor: 'var(--risk-dangerous)', color: 'var(--risk-dangerous)', marginBottom: 16 }}>
                    {error}
                </div>
            )}

            {loading && <p style={{ color: 'var(--text-secondary)' }}>Đang tải…</p>}

            {!loading && ranking.length === 0 && !error && (
                <div className="card" style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>
                    Chưa có dữ liệu risk score nào để xếp hạng.
                </div>
            )}

            {!loading && ranking.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <Th style={{ width: 40 }}>#</Th>
                                <Th>Tài xế</Th>
                                <Th align="center">Số chuyến</Th>
                                <Th align="center">Điểm rủi ro TB</Th>
                                <Th align="center">Mức phổ biến</Th>
                                <Th>Phân bố chuyến</Th>
                            </tr>
                        </thead>
                        <tbody>
                            {ranking.map((d, i) => (
                                <DriverRow key={d.driver_id} driver={d} rank={i + 1} />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function DriverRow({ driver, rank }) {
    const total = driver.safe_trips + driver.medium_trips + driver.dangerous_trips || 1;
    const safePct = (driver.safe_trips / total) * 100;
    const mediumPct = (driver.medium_trips / total) * 100;
    const dangerousPct = (driver.dangerous_trips / total) * 100;

    return (
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <Td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{rank}</Td>
            <Td>
                <div style={{ fontWeight: 600 }}>{driver.full_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{driver.license_number}</div>
            </Td>
            <Td align="center">{driver.total_trips}</Td>
            <Td align="center" style={{ fontFamily: 'var(--font-mono)' }}>
                {driver.avg_risk_score != null ? Number(driver.avg_risk_score).toFixed(3) : '—'}
            </Td>
            <Td align="center">
                {driver.dominant_risk_level ? (
                    <span className={`risk-badge risk-badge--${driver.dominant_risk_level}`}>
                        {driver.dominant_risk_level}
                    </span>
                ) : (
                    <span style={{ color: 'var(--text-muted)' }}>—</span>
                )}
            </Td>
            <Td style={{ minWidth: 160 }}>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface-raised)' }}>
                    {safePct > 0 && <div style={{ width: `${safePct}%`, background: 'var(--risk-safe)' }} />}
                    {mediumPct > 0 && <div style={{ width: `${mediumPct}%`, background: 'var(--risk-medium)' }} />}
                    {dangerousPct > 0 && <div style={{ width: `${dangerousPct}%`, background: 'var(--risk-dangerous)' }} />}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    {driver.safe_trips} an toàn · {driver.medium_trips} trung bình · {driver.dangerous_trips} nguy hiểm
                </div>
            </Td>
        </tr>
    );
}

function Th({ children, align = 'left', style }) {
    return (
        <th
            style={{
                textAlign: align,
                fontSize: 12,
                color: 'var(--text-muted)',
                fontWeight: 500,
                padding: '12px 16px',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
                ...style,
            }}
        >
            {children}
        </th>
    );
}

function Td({ children, align = 'left', style }) {
    return (
        <td style={{ textAlign: align, padding: '12px 16px', fontSize: 13, ...style }}>
            {children}
        </td>
    );
}
