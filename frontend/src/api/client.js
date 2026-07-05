import axios from 'axios';

const TOKEN_KEY = 'pilotrix_token';

export function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

export const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL,
});

// Tự gắn Authorization header vào mọi request nếu có token
apiClient.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Nếu backend trả 401 (token hết hạn/không hợp lệ) -> tự xoá token và
// đá về trang login. Dùng window.location thay vì useNavigate vì
// interceptor này nằm ngoài React component tree.
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            clearToken();
            if (window.location.pathname !== '/login') {
                window.location.href = '/login';
            }
        }
        return Promise.reject(error);
    }
);
