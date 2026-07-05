import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiClient, getToken, setToken, clearToken } from '../api/client.js';
import { connectSocket, disconnectSocket } from '../api/socket.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [admin, setAdmin] = useState(null);
    // isChecking: true trong lúc verify token có sẵn khi load lại trang
    const [isChecking, setIsChecking] = useState(true);

    // Khi app load lần đầu (vd F5 lại trang), kiểm tra token có sẵn trong
    // localStorage còn hợp lệ không bằng cách gọi GET /api/auth/me
    useEffect(() => {
        const token = getToken();
        if (!token) {
            setIsChecking(false);
            return;
        }
        apiClient
            .get('/api/auth/me')
            .then((res) => {
                setAdmin(res.data.admin);
                connectSocket(); // token còn hợp lệ -> kết nối realtime luôn
            })
            .catch(() => clearToken())
            .finally(() => setIsChecking(false));
    }, []);

    const login = useCallback(async (username, password) => {
        const res = await apiClient.post('/api/auth/login', { username, password });
        setToken(res.data.token);
        setAdmin(res.data.admin);
        connectSocket();
        return res.data.admin;
    }, []);

    const logout = useCallback(() => {
        clearToken();
        setAdmin(null);
        disconnectSocket();
    }, []);

    return (
        <AuthContext.Provider value={{ admin, isChecking, isAuthenticated: !!admin, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth phải dùng bên trong AuthProvider');
    return ctx;
}
