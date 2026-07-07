import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import { testConnection } from './db.js';
import { connectMqtt } from './mqtt.js';
import { tripsRouter } from './routes/trips.js';
import { vehiclesRouter } from './routes/vehicles.js';
import { driversRouter } from './routes/drivers.js';
import { alertsRouter } from './routes/alerts.js';
import { dashboardRouter, riskScoresRouter, telemetryLiveRouter } from './routes/dashboard.js';
import { authRouter } from './routes/auth.js';
import { verifyToken } from './middleware/authMiddleware.js';
import { driverAuthRouter } from './routes/driverAuth.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Tạo HTTP server wrap Express để Socket.IO dùng chung port
const httpServer = createServer(app);

// Khởi tạo Socket.IO - export để ruleEngine.js và các module khác emit event
export const io = new Server(httpServer, {
    cors: {
        origin: '*', // Dev: cho phép mọi origin. Production: đổi thành domain cụ thể
        methods: ['GET', 'POST'],
    },
});

// Middleware xác thực JWT ngay lúc client thiết lập kết nối Socket.IO.
// Client phải connect kèm: io(url, { auth: { token: '<jwt>' } })
// Không hợp lệ -> reject kết nối trước khi vào 'connection' handler.
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Thiếu token xác thực'));

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        socket.admin = { adminId: payload.adminId, username: payload.username };
        next();
    } catch (err) {
        next(new Error('Token không hợp lệ hoặc đã hết hạn'));
    }
});

io.on('connection', (socket) => {
    console.log(`[socket.io] Client connected: ${socket.id} (admin: ${socket.admin?.username})`);
    socket.on('disconnect', () => {
        console.log(`[socket.io] Client disconnected: ${socket.id}`);
    });
});

// Health check - dung de kiem tra server con song (vd khi deploy Render)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// /api/auth không cần token (chính nó là nơi cấp token)
app.use('/api/auth', authRouter);
app.use('/api/driver-auth', driverAuthRouter);

// /api/trips KHÔNG yêu cầu admin token: đây là route được IoT Simulator /
// thiết bị trên xe gọi trực tiếp (start/end trip), không phải người dùng
// đăng nhập qua dashboard. Nếu sau này cần bảo mật hơn, nên xác thực bằng
// device_ident/API key riêng cho thiết bị, không dùng chung JWT admin.
app.use('/api/trips', tripsRouter);

// Các route còn lại là nghiệp vụ CHỈ dashboard admin dùng -> yêu cầu verifyToken
app.use('/api/vehicles',  verifyToken, vehiclesRouter);
app.use('/api/drivers',   verifyToken, driversRouter);
app.use('/api/alerts',    verifyToken, alertsRouter);
app.use('/api/dashboard', verifyToken, dashboardRouter);
app.use('/api/risk-scores',    verifyToken, riskScoresRouter);
app.use('/api/telemetry/live', verifyToken, telemetryLiveRouter);

const PORT = process.env.PORT || 3000;

async function start() {
    try {
        await testConnection();
    } catch (err) {
        console.error('[server] Khong the ket noi Postgres:', err.message);
        console.error('[server] Kiem tra lai DATABASE_URL trong .env');
        process.exit(1);
    }

    connectMqtt();

    // Dùng httpServer.listen thay vì app.listen để Socket.IO hoạt động
    httpServer.listen(PORT, () => {
        console.log(`[server] Listening on http://localhost:${PORT}`);
    });
}

start();