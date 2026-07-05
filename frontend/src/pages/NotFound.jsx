import { Link } from 'react-router-dom';

export default function NotFound() {
    return (
        <div style={{ display: 'grid', placeItems: 'center', height: '100vh', textAlign: 'center' }}>
            <div>
                <h1 style={{ fontSize: 48, margin: 0, color: 'var(--text-muted)' }}>404</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Trang không tồn tại</p>
                <Link to="/" style={{ color: 'var(--accent)' }}>
                    Quay về Tổng quan
                </Link>
            </div>
        </div>
    );
}
