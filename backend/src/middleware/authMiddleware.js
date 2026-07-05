import jwt from 'jsonwebtoken';

/**
 * Middleware bảo vệ route: yêu cầu header
 *   Authorization: Bearer <token>
 * Nếu hợp lệ, gắn req.admin = { adminId, username } rồi next().
 * Nếu không hợp lệ/thiếu, trả 401.
 */
export function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Thiếu token xác thực' });
    }

    const token = authHeader.slice('Bearer '.length);

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = { adminId: payload.adminId, username: payload.username };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }
}
