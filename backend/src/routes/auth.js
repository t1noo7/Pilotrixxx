import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { verifyToken } from '../middleware/authMiddleware.js';

export const authRouter = express.Router();

/**
 * POST /api/auth/login
 * Body: { username, password }
 * Trả về: { token, admin: { adminId, username, fullName } }
 */
authRouter.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'username và password là bắt buộc' });
    }

    try {
        const result = await pool.query(
            `SELECT admin_id, username, password_hash, full_name FROM admins WHERE username = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }

        const admin = result.rows[0];
        const match = await bcrypt.compare(password, admin.password_hash);
        if (!match) {
            return res.status(401).json({ error: 'Sai username hoặc password' });
        }

        const token = jwt.sign(
            { adminId: admin.admin_id, username: admin.username },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        pool.query(`UPDATE admins SET last_login_at = now() WHERE admin_id = $1`, [admin.admin_id])
            .catch((err) => console.error('[POST /auth/login] Update last_login_at failed:', err.message));

        res.json({
            token,
            admin: { adminId: admin.admin_id, username: admin.username, fullName: admin.full_name },
        });
    } catch (err) {
        console.error('[POST /auth/login] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', verifyToken, (req, res) => {
    res.json({ admin: req.admin });
});
