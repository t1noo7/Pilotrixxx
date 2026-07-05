import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/';

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        try {
            await login(username, password);
            navigate(from, { replace: true });
        } catch (err) {
            setError(err.response?.data?.error || 'Đăng nhập thất bại. Kiểm tra lại kết nối backend.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div style={styles.page}>
            <form style={styles.card} onSubmit={handleSubmit}>
                <div style={styles.brandRow}>
                    <span className="live-dot" />
                    <span style={styles.brand}>PILOTRIX</span>
                </div>
                <p style={styles.subtitle}>Đăng nhập để giám sát đội xe</p>

                <label style={styles.label} htmlFor="username">
                    Username
                </label>
                <input
                    id="username"
                    style={styles.input}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                />

                <label style={styles.label} htmlFor="password">
                    Password
                </label>
                <input
                    id="password"
                    type="password"
                    style={styles.input}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                />

                {error && <p style={styles.error}>{error}</p>}

                <button type="submit" style={styles.button} disabled={isSubmitting}>
                    {isSubmitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
                </button>
            </form>
        </div>
    );
}

const styles = {
    page: {
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background:
            'radial-gradient(circle at 20% 20%, rgba(61,214,196,0.08), transparent 40%), var(--bg-app)',
    },
    card: {
        width: 340,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius)',
        padding: 32,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
    },
    brandRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    brand: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        fontSize: 15,
    },
    subtitle: {
        color: 'var(--text-secondary)',
        fontSize: 13,
        marginTop: 0,
        marginBottom: 20,
    },
    label: {
        fontSize: 12,
        color: 'var(--text-secondary)',
        marginTop: 12,
        marginBottom: 6,
    },
    input: {
        background: 'var(--bg-surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-sm)',
        padding: '10px 12px',
        color: 'var(--text-primary)',
        fontSize: 14,
    },
    error: {
        color: 'var(--risk-dangerous)',
        fontSize: 13,
        marginTop: 12,
        marginBottom: 0,
    },
    button: {
        marginTop: 20,
        background: 'var(--accent)',
        color: '#08201c',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        padding: '11px 0',
        fontWeight: 600,
        fontSize: 14,
        cursor: 'pointer',
    },
};
