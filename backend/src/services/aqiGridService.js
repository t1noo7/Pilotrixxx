import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// backend/src/services/ -> len 3 cap -> simulator/gee_fetch_grid_daily.py
const GEE_FETCH_GRID_PY = path.resolve(__dirname, '..', '..', '..', 'simulator', 'gee_fetch_grid_daily.py');
// venv-gis (KHONG phai venv chung) - dung dung venv rieng cho GEE, xem learnings
const PYTHON = path.resolve(__dirname, '..', '..', '..', 'venv-gis', 'bin', 'python');

function todayDateStr() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function runGeeFetchGrid(dateStr) {
    return new Promise((resolve, reject) => {
        execFile(
            PYTHON,
            [GEE_FETCH_GRID_PY, '--date', dateStr],
            { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
            (err, stdout, stderr) => {
                if (err) {
                    let parsedErr = null;
                    if (stdout) {
                        try { parsedErr = JSON.parse(stdout.trim()).error; } catch { /* stdout khong phai JSON */ }
                    }
                    reject(new Error(parsedErr || stderr || err.message));
                    return;
                }
                try {
                    const result = JSON.parse(stdout.trim());
                    if (result.error) { reject(new Error(result.error)); return; }
                    resolve(result);
                } catch {
                    reject(new Error(`Khong parse duoc JSON tu gee_fetch_grid_daily.py: ${stdout}`));
                }
            }
        );
    });
}

/**
 * Dam bao aqi_daily_grid + aqi_daily_threshold co du lieu gan ngay hom nay
 * (lazy-cache: request dau tien trong ngay can den se tu trigger fetch GEE,
 * cac lan sau doc lai tu DB, khong goi GEE nua). Tra ve dateStr THUC TE co
 * du lieu (co the lui vai ngay neu Sentinel-5P chua co anh moi).
 */
export async function ensureAqiGridForToday() {
    const requestedDate = todayDateStr();

    const existing = await pool.query(
        `SELECT DISTINCT grid_date FROM aqi_daily_grid
         WHERE grid_date >= $1::date - interval '4 days'
         ORDER BY grid_date DESC LIMIT 1`,
        [requestedDate]
    );
    if (existing.rows.length > 0) {
        return existing.rows[0].grid_date.toISOString().slice(0, 10);
    }

    console.log(`[aqi-grid] Chua co du lieu grid gan ${requestedDate}, dang fetch tu GEE...`);
    const result = await runGeeFetchGrid(requestedDate);
    const { date, pollutant, cells, high_threshold } = result;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const cell of cells) {
            await client.query(
                `INSERT INTO aqi_daily_grid (grid_date, cell_lat, cell_lng, aqi_value, pollutant)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (grid_date, cell_lat, cell_lng, pollutant) DO NOTHING`,
                [date, cell.cell_lat, cell.cell_lng, cell.aqi_value, pollutant]
            );
        }
        await client.query(
            `INSERT INTO aqi_daily_threshold (grid_date, pollutant, high_threshold)
             VALUES ($1, $2, $3)
             ON CONFLICT (grid_date, pollutant) DO UPDATE SET high_threshold = EXCLUDED.high_threshold`,
            [date, pollutant, high_threshold]
        );
        await client.query('COMMIT');
        console.log(`[aqi-grid] Da luu ${cells.length} cells cho ngay ${date}`);
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }

    return date;
}