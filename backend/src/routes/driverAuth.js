import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { verifyDriverToken } from '../middleware/authMiddleware.js';
import { generateOtp, sendOtpEmail } from '../services/mailer.js';

export const driverAuthRouter = express.Router();

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * POST /api/driver-auth/register
 * Tạo driver với email_verified = false, gửi OTP, KHÔNG trả token
 * (phải verify OTP xong mới có token - xem POST /verify-otp)
 */
driverAuthRouter.post('/register', async (req, res) => {
    const { email, password, fullName, phoneNumber, licenseNumber } = req.body;
    if (!email || !password || !fullName) {
        return res.status(400).json({ error: 'email, password và fullName là bắt buộc' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Mật khẩu cần ít nhất 8 ký tự' });
    }

    try {
        const existing = await pool.query('SELECT driver_id FROM drivers WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email đã được đăng ký' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

        await pool.query(
            `INSERT INTO drivers (email, password_hash, full_name, phone_number, license_number, email_verified, otp_code, otp_expires_at)
             VALUES ($1, $2, $3, $4, $5, false, $6, $7)`,
            [email, passwordHash, fullName, phoneNumber || null, licenseNumber || null, otp, otpExpiresAt]
        );

        await sendOtpEmail(email, otp);

        res.status(201).json({ email, message: 'Đã gửi mã OTP tới email, vui lòng xác thực' });
    } catch (err) {
        console.error('[POST /driver-auth/register] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver-auth/verify-otp
 * Body: { email, otp }
 * Verify đúng -> email_verified = true, xoá otp, trả token (login luôn)
 */
driverAuthRouter.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'email và otp là bắt buộc' });

    try {
        const result = await pool.query(
            `SELECT driver_id, email, full_name, otp_code, otp_expires_at, email_verified
             FROM drivers WHERE email = $1`,
            [email]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

        const driver = result.rows[0];
        if (driver.email_verified) {
            return res.status(400).json({ error: 'Email đã được xác thực trước đó' });
        }
        if (!driver.otp_code || driver.otp_code !== otp || new Date() > new Date(driver.otp_expires_at)) {
            return res.status(401).json({ error: 'Mã OTP không đúng hoặc đã hết hạn' });
        }

        await pool.query(
            `UPDATE drivers SET email_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE driver_id = $1`,
            [driver.driver_id]
        );

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
        console.error('[POST /driver-auth/verify-otp] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver-auth/resend-otp
 * Body: { email }
 * Cooldown 60s giữa các lần gửi để tránh spam.
 */
driverAuthRouter.post('/resend-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email là bắt buộc' });

    try {
        const result = await pool.query(
            `SELECT driver_id, email_verified, otp_expires_at FROM drivers WHERE email = $1`,
            [email]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

        const driver = result.rows[0];
        if (driver.email_verified) {
            return res.status(400).json({ error: 'Email đã được xác thực trước đó' });
        }

        if (driver.otp_expires_at) {
            const lastSentAt = new Date(new Date(driver.otp_expires_at).getTime() - OTP_TTL_MINUTES * 60_000);
            const secondsSinceLastSent = (Date.now() - lastSentAt.getTime()) / 1000;
            if (secondsSinceLastSent < RESEND_COOLDOWN_SECONDS) {
                return res.status(429).json({
                    error: `Vui lòng đợi ${Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSent)}s trước khi gửi lại`,
                });
            }
        }

        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
        await pool.query(
            `UPDATE drivers SET otp_code = $1, otp_expires_at = $2 WHERE driver_id = $3`,
            [otp, otpExpiresAt, driver.driver_id]
        );
        await sendOtpEmail(email, otp);

        res.json({ message: 'Đã gửi lại mã OTP' });
    } catch (err) {
        console.error('[POST /driver-auth/resend-otp] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver-auth/login
 * Chặn đăng nhập nếu email_verified = false.
 */
driverAuthRouter.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email và password là bắt buộc' });
    }

    try {
        const result = await pool.query(
            `SELECT driver_id, email, password_hash, full_name, email_verified FROM drivers WHERE email = $1`,
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

        if (!driver.email_verified) {
            return res.status(403).json({
                error: 'Email chưa được xác thực. Vui lòng kiểm tra email hoặc yêu cầu gửi lại mã OTP.',
                emailVerified: false,
                email: driver.email,
            });
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