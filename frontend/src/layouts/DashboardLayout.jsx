import { useState } from 'react';
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
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div style={styles.shell}>
            {/* Nut toggle dat CO DINH ngoai <aside> - de van bam duoc du
                sidebar dang thu gon hay khong. Vi tri doi theo trang thai
                collapsed de luon bam sat canh sidebar. */}
            <button
                onClick={() => setCollapsed((c) => !c)}
                style={{
                    ...styles.toggleBtn,
                    left: collapsed ? 8 : 'calc(var(--sidebar-width) - 14px)',
                }}
                title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
            >
                {collapsed ? '›' : '‹'}
            </button>

            <aside
                onTransitionEnd={(e) => {
                    // Chi bat su kien khi property "width" (cai gay thay doi
                    // kich thuoc map) transition xong - tranh ban trung 2
                    // lan neu "padding" cung dang transition cung luc.
                    if (e.propertyName === 'width') {
                        window.dispatchEvent(new Event('pilotrix:layout-resize'));
                    }
                }}
                style={{
                    ...styles.sidebar,
                    width: collapsed ? 0 : 'var(--sidebar-width)',
                    padding: collapsed ? '20px 0' : '20px 16px',
                }}
            >
                {/* sidebarInner giu nguyen chieu rong that (khong bop chu),
                    de khi truot ra chu khong bi vo dong dot ngot - chi bi
                    <aside> ben ngoai clip (overflow: hidden) che di. */}
                <div style={styles.sidebarInner}>
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
        position: 'relative',
    },
    toggleBtn: {
        position: 'fixed',
        top: 20,
        zIndex: 50,
        width: 28,
        height: 28,
        borderRadius: '50%',
        border: '1px solid var(--border-strong)',
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        fontSize: 14,
        lineHeight: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'left 0.25s ease',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    },
    sidebar: {
        flexShrink: 0,
        background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-subtle)',
        overflow: 'hidden',
        transition: 'width 0.25s ease, padding 0.25s ease',
    },
    sidebarInner: {
        width: 'calc(var(--sidebar-width) - 32px)', // tru padding ngang (16px x2)
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
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
        whiteSpace: 'nowrap',
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
        whiteSpace: 'nowrap',
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
        whiteSpace: 'nowrap',
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
        whiteSpace: 'nowrap',
    },
    content: {
        flex: 1,
        padding: '28px 32px',
        overflowY: 'auto',
    },
};
