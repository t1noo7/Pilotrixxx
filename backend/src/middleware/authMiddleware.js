import jwt from 'jsonwebtoken';

/**
 * Middleware bảo vệ route ADMIN: yêu cầu header
 *   Authorization: Bearer <token>
 * Token phải có role = 'admin'. Gắn req.admin = { adminId, username } rồi next().
 */
export function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Thiếu token xác thực' });
    }

    const token = authHeader.slice('Bearer '.length);

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.role !== 'admin') {
            return res.status(403).json({ error: 'Token không có quyền admin' });
        }
        req.admin = { adminId: payload.adminId, username: payload.username };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
}

/**
 * Middleware bảo vệ route DRIVER (mobile app): yêu cầu header
 *   Authorization: Bearer <token>
 * Token phải có role = 'driver'. Gắn req.driver = { driverId, email } rồi next().
 */
export function verifyDriverToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Thiếu token xác thực' });
    }

    const token = authHeader.slice('Bearer '.length);

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.role !== 'driver') {
            return res.status(403).json({ error: 'Token không có quyền driver' });
        }
        req.driver = { driverId: payload.driverId, email: payload.email };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
}