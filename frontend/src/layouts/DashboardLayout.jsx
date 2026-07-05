import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
    { to: '/', label: 'Tổng quan', end: true },
    { to: '/map', label: 'Bản đồ realtime' },
    { to: '/alerts', label: 'Cảnh báo' },
    { to: '/drivers', label: 'Xếp hạng tài xế' },
];

export default function DashboardLayout() {
    const { admin, logout } = useAuth();

    return (
        <div style={styles.shell}>
            <aside style={styles.sidebar}>
                <div style={styles.brandRow}>
                    <span className="live-dot" />
                    <span style={styles.brand}>PILOTRIX</span>
                </div>

                <nav style={styles.nav}>
                    {NAV_ITEMS.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            style={({ isActive }) => ({
                                ...styles.navLink,
                                ...(isActive ? styles.navLinkActive : {}),
                            })}
                        >
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <div style={styles.sidebarFooter}>
                    <div>
                        <div style={styles.adminName}>{admin?.fullName || admin?.username}</div>
                        <div style={styles.adminRole}>Admin</div>
                    </div>
                    <button style={styles.logoutBtn} onClick={logout}>
                        Đăng xuất
                    </button>
                </div>
            </aside>

            <main style={styles.content}>
                <Outlet />
            </main>
        </div>
    );
}

const styles = {
    shell: {
        display: 'flex',
        minHeight: '100vh',
    },
    sidebar: {
        width: 'var(--sidebar-width)',
        flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
    },
    brandRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 8px',
        marginBottom: 28,
    },
    brand: {
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        letterSpacing: '0.08em',
        fontSize: 14,
    },
    nav: {
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        flex: 1,
    },
    navLink: {
        textDecoration: 'none',
        color: 'var(--text-secondary)',
        fontSize: 14,
        padding: '10px 12px',
        borderRadius: 'var(--radius-sm)',
    },
    navLinkActive: {
        color: 'var(--text-primary)',
        background: 'var(--bg-surface)',
    },
    sidebarFooter: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderTop: '1px solid var(--border-subtle)',
        paddingTop: 16,
        padding: '16px 8px 4px',
    },
    adminName: {
        fontSize: 13,
        fontWeight: 500,
    },
    adminRole: {
        fontSize: 11,
        color: 'var(--text-muted)',
    },
    logoutBtn: {
        background: 'transparent',
        border: '1px solid var(--border-strong)',
        color: 'var(--text-secondary)',
        borderRadius: 'var(--radius-sm)',
        padding: '6px 10px',
        fontSize: 12,
        cursor: 'pointer',
    },
    content: {
        flex: 1,
        padding: '28px 32px',
        overflowY: 'auto',
    },
};
