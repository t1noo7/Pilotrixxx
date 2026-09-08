import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// CA cert cua Supabase Transaction Pooler - tai tu:
// Supabase Dashboard -> Project Settings -> Database -> SSL Configuration
// -> Download certificate. File nay la PUBLIC (khong phai secret), an
// toan de commit vao git (khong can .gitignore).
const caCertPath = path.join(__dirname, 'certs', 'supabase-ca.crt');

let sslConfig;
try {
    const ca = fs.readFileSync(caCertPath).toString();
    // rejectUnauthorized: true - xac minh CHAIN chung chi thuc su, chong
    // man-in-the-middle. Truoc day de false (bo qua xac minh) do thieu
    // dung CA cert nay, dan toi loi "self-signed certificate in
    // certificate chain" khi bat verify.
    sslConfig = { rejectUnauthorized: true, ca };
    console.log('[db] Da nap CA cert - SSL verify day du (rejectUnauthorized: true)');
} catch (err) {
    // Fallback AN TOAN neu quen dat file cert (vd may moi clone repo) -
    // KHONG crash server ngay, chi log canh bao va chay o che do cu
    // (van ma hoa, chi bo qua xac minh danh tinh server).
    console.warn(`[db] Khong tim thay CA cert tai ${caCertPath} - fallback ve rejectUnauthorized: false. Xem huong dan tai cert trong db.js.`);
    sslConfig = { rejectUnauthorized: false };
}

// Su dung connection pool (khong tao connection moi cho moi query).
// Voi Supabase Transaction Pooler (port 6543), pool size nen nho
// vi pooler ben Supabase da quan ly connection thuc su toi Postgres.
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,                      // toi da 10 connection dong thoi tu Backend
    idleTimeoutMillis: 30000,
    ssl: sslConfig,
});

pool.on('error', (err) => {
    console.error('[db] Unexpected error on idle client:', err.message);
});

// Helper: test connection khi server khoi dong
export async function testConnection() {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT now()');
        console.log('[db] Connected. Server time:', res.rows[0].now);
    } finally {
        client.release();
    }
}
