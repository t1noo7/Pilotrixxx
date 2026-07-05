import { io } from 'socket.io-client';
import { getToken } from './client.js';

// autoConnect: false — không tự kết nối lúc load module, vì lúc đó có thể
// chưa đăng nhập (chưa có token). AuthContext sẽ gọi connectSocket()/
// disconnectSocket() đúng lúc login/logout thành công.
export const socket = io(import.meta.env.VITE_SOCKET_URL, {
    autoConnect: false,
    transports: ['websocket'],
});

export function connectSocket() {
    const token = getToken();
    if (!token) return;
    socket.auth = { token };
    if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
    if (socket.connected) socket.disconnect();
}

// Log để debug khi cần - có thể xoá sau khi ổn định
socket.on('connect', () => console.log('[socket] connected:', socket.id));
socket.on('disconnect', (reason) => console.log('[socket] disconnected:', reason));
socket.on('connect_error', (err) => console.error('[socket] connect_error:', err.message));

