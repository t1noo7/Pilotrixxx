import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { verifyDriverToken } from '../middleware/authMiddleware.js';
import { generateOtp, sendOtpEmail, sendAlreadyRegisteredEmail } from '../services/mailer.js';

export const driverAuthRouter = express.Router();

const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_OTP_ATTEMPTS = 5;
const MAX_OTP_SENDS_PER_WINDOW = 2;
const OTP_WINDOW_HOURS = 24;

// Message CHUNG dung cho moi nhanh cua /register va /resend-otp (email
// khong ton tai / da verify / dang cho verify / dang cooldown / dang bi
// chan do vuot gioi han 2 lan/24h) - de KHONG tiet lo trang thai that cua
// email do (chong user enumeration).
const GENERIC_OTP_SENT_MESSAGE =
    'Nếu email hợp lệ và cần xác thực, một mã OTP đã được gửi.';

/**
 * Kiem tra cooldown resend OTP dua vao otp_expires_at hien co (suy nguoc
 * ra thoi diem gui lan truoc). Chi dung de UOC LUONG so giay con lai -
 * viec CHAN thuc su nam trong withOtpCooldownLock() (atomic).
 */
function getResendCooldownRemaining(otpExpiresAt) {
    if (!otpExpiresAt) return 0;
    const lastSentAt = new Date(new Date(otpExpiresAt).getTime() - OTP_TTL_MINUTES * 60_000);
    const secondsSinceLastSent = (Date.now() - lastSentAt.getTime()) / 1000;
    return Math.max(0, RESEND_COOLDOWN_SECONDS - secondsSinceLastSent);
}

/**
 * Gui/resend OTP mot cach ATOMIC bang row lock (SELECT ... FOR UPDATE
 * trong 1 transaction) - tranh race condition khi 2 request gan nhu dong
 * thoi cung luot qua duoc check truoc khi cai nao kip UPDATE xong.
 *
 * Ap dung 2 tang gioi han:
 *  1. Cooldown 60s giua 2 lan gui lien tiep (nhu cu)
 *  2. Toi da MAX_OTP_SENDS_PER_WINDOW (2) lan gui trong 1 rolling window
 *     OTP_WINDOW_HOURS (24h) - qua thi bi chan im lang cho toi khi het
 *     window (khong tiet lo qua API response, xem GENERIC_OTP_SENT_MESSAGE)
 *
 * buildUpdateQuery(otp, otpExpiresAt, sendCount, windowStartedAt) -> { text, values }
 * - cho phep caller tuy chinh UPDATE query.
 *
 * Tra ve:
 *   { ok: true, otp }
 *   { ok: false, reason: 'verified' }
 *   { ok: false, reason: 'cooldown', remaining }
 *   { ok: false, reason: 'daily_limit', retryAfterMs }
 */
async function withOtpCooldownLock(driverId, buildUpdateQuery) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const lockRes = await client.query(
            `SELECT otp_expires_at, email_verified, otp_send_count, otp_window_started_at
             FROM drivers WHERE driver_id = $1 FOR UPDATE`,
            [driverId]
        );
        const row = lockRes.rows[0];

        if (row.email_verified) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'verified' };
        }

        const cooldownRemaining = getResendCooldownRemaining(row.otp_expires_at);
        if (cooldownRemaining > 0) {
            await client.query('ROLLBACK');
            return { ok: false, reason: 'cooldown', remaining: cooldownRemaining };
        }

        const now = Date.now();
        const windowStartedAtMs = row.otp_window_started_at
            ? new Date(row.otp_window_started_at).getTime()
            : null;
        const windowExpired = !windowStartedAtMs || (now - windowStartedAtMs) > OTP_WINDOW_HOURS * 3_600_000;

        let newSendCount;
        let newWindowStartedAt;

        if (windowExpired) {
            // Window moi (lan dau, hoac window cu da qua 24h) - reset dem.
            newSendCount = 1;
            newWindowStartedAt = new Date(now);
        } else {
            if (row.otp_send_count >= MAX_OTP_SENDS_PER_WINDOW) {
                await client.query('ROLLBACK');
                const retryAfterMs = OTP_WINDOW_HOURS * 3_600_000 - (now - windowStartedAtMs);
                return { ok: false, reason: 'daily_limit', retryAfterMs };
            }
            newSendCount = row.otp_send_count + 1;
            newWindowStartedAt = new Date(windowStartedAtMs);
        }

        const otp = generateOtp();
        const otpExpiresAt = new Date(now + OTP_TTL_MINUTES * 60_000);
        const { text, values } = buildUpdateQuery(otp, otpExpiresAt, newSendCount, newWindowStartedAt);
        await client.query(text, values);

        await client.query('COMMIT');
        return { ok: true, otp };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

/**
 * Gui email bao "email nay da co tai khoan" - best-effort, KHONG duoc
 * lam fail response chinh neu gui loi (chi la thong bao phu).
 */
async function notifyAlreadyRegistered(email) {
    try {
        await sendAlreadyRegisteredEmail(email);
    } catch (err) {
        console.error('[notifyAlreadyRegistered] Gui email that bai:', err.message);
    }
}

/**
 * POST /api/driver-auth/register
 * Tạo driver với email_verified = false, gửi OTP, KHÔNG trả token
 * (phải verify OTP xong mới có token - xem POST /verify-otp)
 *
 * CHONG USER ENUMERATION: ca 3 truong hop (email moi / email da verify /
 * email dang cho verify, du dang cooldown hay da het luot gui trong ngay)
 * deu tra ve CUNG 1 message qua API - khong tiet lo trang thai that.
 * Rieng email DA VERIFY thi nhan duoc 1 email báo khac (khong phai OTP) -
 * day la kenh chi chu tai khoan doc duoc nen khong lam lo gi ra ngoai.
 *
 * KHONG GHI DE DATA KHI PENDING: neu email dang cho verify, request nay
 * CHI duoc phep resend OTP, KHONG duoc ghi de password_hash/full_name/...
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
        const existing = await pool.query(
            'SELECT driver_id, email_verified FROM drivers WHERE email = $1',
            [email]
        );

        if (existing.rows.length > 0) {
            const driver = existing.rows[0];

            if (driver.email_verified) {
                await notifyAlreadyRegistered(email);
                return res.status(201).json({ email, message: GENERIC_OTP_SENT_MESSAGE });
            }

            const otpResult = await withOtpCooldownLock(driver.driver_id, (otp, otpExpiresAt, sendCount, windowStartedAt) => ({
                text: `UPDATE drivers SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0,
                              otp_send_count = $3, otp_window_started_at = $4
                       WHERE driver_id = $5`,
                values: [otp, otpExpiresAt, sendCount, windowStartedAt, driver.driver_id],
            }));

            if (otpResult.ok) {
                await sendOtpEmail(email, otpResult.otp);
            }
            // Du gui duoc, dang cooldown, hay het luot trong ngay - tra ve
            // CUNG 1 message, khong tiet lo trang thai that.
            return res.status(201).json({ email, message: GENERIC_OTP_SENT_MESSAGE });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

        await pool.query(
            `INSERT INTO drivers (email, password_hash, full_name, phone_number, license_number, email_verified, otp_code, otp_expires_at, otp_attempts, otp_send_count, otp_window_started_at)
             VALUES ($1, $2, $3, $4, $5, false, $6, $7, 0, 1, now())`,
            [email, passwordHash, fullName, phoneNumber || null, licenseNumber || null, otp, otpExpiresAt]
        );
        await sendOtpEmail(email, otp);

        res.status(201).json({ email, message: GENERIC_OTP_SENT_MESSAGE });
    } catch (err) {
        console.error('[POST /driver-auth/register] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/driver-auth/verify-otp
 * Body: { email, otp }
 * Verify đúng -> email_verified = true, xoá otp, trả token (login luôn)
 *
 * GIOI HAN SO LAN NHAP SAI: sau MAX_OTP_ATTEMPTS lan sai, huy OTP hien
 * tai (bat nguoi dung bam "gui lai ma") - chong brute-force 6 chu so.
 */
driverAuthRouter.post('/verify-otp', async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'email và otp là bắt buộc' });

    try {
        const result = await pool.query(
            `SELECT driver_id, email, full_name, otp_code, otp_expires_at, otp_attempts, email_verified
             FROM drivers WHERE email = $1`,
            [email]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

        const driver = result.rows[0];
        if (driver.email_verified) {
            return res.status(400).json({ error: 'Email đã được xác thực trước đó' });
        }
        if (!driver.otp_code || new Date() > new Date(driver.otp_expires_at)) {
            return res.status(401).json({ error: 'Mã OTP không đúng hoặc đã hết hạn' });
        }

        if (driver.otp_code !== otp) {
            const newAttempts = (driver.otp_attempts || 0) + 1;

            if (newAttempts >= MAX_OTP_ATTEMPTS) {
                await pool.query(
                    `UPDATE drivers SET otp_code = NULL, otp_expires_at = NULL, otp_attempts = 0
                     WHERE driver_id = $1`,
                    [driver.driver_id]
                );
                return res.status(429).json({
                    error: 'Nhập sai mã quá nhiều lần. Vui lòng bấm "Gửi lại mã OTP" để lấy mã mới.',
                });
            }

            await pool.query(
                `UPDATE drivers SET otp_attempts = $1 WHERE driver_id = $2`,
                [newAttempts, driver.driver_id]
            );
            return res.status(401).json({
                error: `Mã OTP không đúng (còn ${MAX_OTP_ATTEMPTS - newAttempts} lần thử)`,
            });
        }

        await pool.query(
            `UPDATE drivers SET email_verified = true, otp_code = NULL, otp_expires_at = NULL,
                    otp_attempts = 0, otp_send_count = 0, otp_window_started_at = NULL
             WHERE driver_id = $1`,
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
 * Cooldown 60s + toi da 2 lan gui/24h (xem withOtpCooldownLock).
 *
 * CHONG USER ENUMERATION: moi truong hop deu tra ve CUNG 1 message.
 */
driverAuthRouter.post('/resend-otp', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email là bắt buộc' });

    try {
        const result = await pool.query(
            `SELECT driver_id, email_verified FROM drivers WHERE email = $1`,
            [email]
        );

        if (result.rows.length === 0) {
            return res.json({ message: GENERIC_OTP_SENT_MESSAGE });
        }

        const driver = result.rows[0];
        if (driver.email_verified) {
            await notifyAlreadyRegistered(email);
            return res.json({ message: GENERIC_OTP_SENT_MESSAGE });
        }

        const otpResult = await withOtpCooldownLock(driver.driver_id, (otp, otpExpiresAt, sendCount, windowStartedAt) => ({
            text: `UPDATE drivers SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0,
                          otp_send_count = $3, otp_window_started_at = $4
                   WHERE driver_id = $5`,
            values: [otp, otpExpiresAt, sendCount, windowStartedAt, driver.driver_id],
        }));

        if (otpResult.ok) {
            await sendOtpEmail(email, otpResult.otp);
        }
        return res.json({ message: GENERIC_OTP_SENT_MESSAGE });
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
