import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Port 1:1 tu simulator/speed_limit_lookup.py (Python) sang JS, dung
// chung file du lieu hanoi_road_speeds.json (khong lien network, load
// 1 lan luc module duoc import). Ly do port lai thay vi goi qua
// child_process: route nay bi goi moi lan telemetry (~8s/lan/trip dang
// chay) - spawn process moi lan se cong don latency khong dang.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'data', 'hanoi_road_speeds.json');

const MAX_MATCH_DISTANCE_KM = 0.05; // 50m - qua nguong nay coi nhu khong co duong lon nao gan
const RESIDENTIAL_FALLBACK_SPEED = 30;

// Danh sach segment dang [lat1, lng1, lat2, lng2, maxspeed]
let segments = [];

function load() {
    try {
        const raw = readFileSync(DATA_PATH, 'utf-8');
        const data = JSON.parse(raw);
        const segs = [];
        for (const way of data.ways) {
            const coords = way.coords;
            for (let i = 0; i < coords.length - 1; i++) {
                const [lat1, lng1] = coords[i];
                const [lat2, lng2] = coords[i + 1];
                segs.push([lat1, lng1, lat2, lng2, way.maxspeed]);
            }
        }
        segments = segs;
        console.log(`[speedLimitLookup] Da load ${segments.length} segment duong.`);
    } catch (err) {
        console.error(
            `[speedLimitLookup] KHONG doc duoc ${DATA_PATH} - fallback maxspeed=40 cho toan bo.`,
            err.message,
        );
    }
}

// Khoang cach xap xi (km) tu diem den doan thang, dung phep chieu phang
// (equirectangular) - du chinh xac cho pham vi bbox nho (~35km), y het
// cong thuc ben Python de dam bao 2 phia cho ra cung ket qua.
function pointToSegmentKm(lat, lng, lat1, lng1, lat2, lng2, refLat) {
    const kmPerDegLat = 111.0;
    const kmPerDegLng = 111.0 * Math.cos((refLat * Math.PI) / 180);

    const x = lng * kmPerDegLng;
    const y = lat * kmPerDegLat;
    const x1 = lng1 * kmPerDegLng;
    const y1 = lat1 * kmPerDegLat;
    const x2 = lng2 * kmPerDegLng;
    const y2 = lat2 * kmPerDegLat;

    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) {
        return Math.hypot(x - x1, y - y1);
    }

    let t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(x - projX, y - projY);
}

/**
 * Tra cuu maxspeed (km/h) gan vi tri (lat, lng) nhat. Brute-force qua
 * ~46.7k segment (~7965 way) - da do thu tren Node, du nhanh cho tan
 * suat goi 1 lan/8s/trip (khong can spatial index cho scope do an).
 */
export function getSpeedLimit(lat, lng) {
    if (segments.length === 0) return 40;

    let bestDist = Infinity;
    let bestSpeed = RESIDENTIAL_FALLBACK_SPEED;
    for (const [lat1, lng1, lat2, lng2, speed] of segments) {
        const d = pointToSegmentKm(lat, lng, lat1, lng1, lat2, lng2, lat);
        if (d < bestDist) {
            bestDist = d;
            bestSpeed = speed;
        }
    }

    if (bestDist > MAX_MATCH_DISTANCE_KM) return RESIDENTIAL_FALLBACK_SPEED;
    return bestSpeed;
}

load();
