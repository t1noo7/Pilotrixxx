import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Bọc quanh route cần đăng nhập. Nếu chưa auth -> redirect về /login
 * và nhớ lại trang đích (location.state.from) để login xong quay lại đúng chỗ.
 */
export function ProtectedRoute({ children }) {
    const { isAuthenticated, isChecking } = useAuth();
    const location = useLocation();

    if (isChecking) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', height: '100vh', color: 'var(--text-secondary)' }}>
                Đang kiểm tra đăng nhập…
            </div>
        );
    }

    if (!isAuthenticated) {
        return <Navigate to="/login" state={{ from: location }} replace />;
    }

    return children;
}
