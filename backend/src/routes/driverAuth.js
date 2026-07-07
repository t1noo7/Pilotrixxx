import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { verifyDriverToken } from '../middleware/authMiddleware.js';

export const driverAuthRouter = express.Router();

/**
 * POST /api/driver-auth/register
 * Body: { email, password, fullName, phoneNumber?, licenseNumber? }
 * Trả về: { token, driver: { driverId, email, fullName } }
 *
 * Lưu ý: hiện chưa validate driver có "được phép" tự đăng ký hay
 * phải do admin tạo trước rồi mới gắn email/password - đang cho tự
 * đăng ký tự do (đơn giản nhất cho scope đồ án). Có thể siết lại sau
 * (vd chỉ cho set password cho driver_id đã tồn tại sẵn trong DB).
 */
driverAuthRouter.post('/register', async (req, res) => {
    const { email, password, fullName, phoneNumber, licenseNumber } = req.body;
    if (!email || !password || !fullName) {
        return res.status(400).json({ error: 'email, password và fullName là bắt buộc' });
    }

    try {
        const existing = await pool.query('SELECT driver_id FROM drivers WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email đã được đăng ký' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO drivers (email, password_hash, full_name, phone_number, license_number)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING driver_id, email, full_name`,
            [email, passwordHash, fullName, phoneNumber || null, licenseNumber || null]
        );
        const driver = result.rows[0];

        const token = jwt.sign(
            { role: 'driver', driverId: driver.driver_id, email: driver.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            token,
            driver: { driverId: driver.driver_id, email: driver.email, fullName: driver.full_name },
        });
    } catch (err) {
        console.error('[POST /driver-auth/register] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver-auth/login
 * Body: { email, password }
 * Trả về: { token, driver: { driverId, email, fullName } }
 */
driverAuthRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email và password là bắt buộc' });
    }

    try {
        const result = await pool.query(
            `SELECT driver_id, email, password_hash, full_name FROM drivers WHERE email = $1`,
            [email]
        );

        if (result.rows.length === 0 || !result.rows[0].password_hash) {
            return res.status(401).json({ error: 'Sai email hoặc password' });
        }

        const driver = result.rows[0];
        const match = await bcrypt.compare(password, driver.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Sai email hoặc password' });
        }

        const token = jwt.sign(
            { role: 'driver', driverId: driver.driver_id, email: driver.email },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            driver: { driverId: driver.driver_id, email: driver.email, fullName: driver.full_name },
        });
    } catch (err) {
        console.error('[POST /driver-auth/login] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/driver-auth/me
 */
driverAuthRouter.get('/me', verifyDriverToken, (req, res) => {
    res.json({ driver: req.driver });
});