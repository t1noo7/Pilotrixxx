import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Su dung connection pool (khong tao connection moi cho moi query).
// Voi Supabase Transaction Pooler (port 6543), pool size nen nho
// vi pooler ben Supabase da quan ly connection thuc su toi Postgres.
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,                      // toi da 10 connection dong thoi tu Backend
    idleTimeoutMillis: 30000,
    ssl: { rejectUnauthorized: false }, // Supabase yeu cau SSL
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