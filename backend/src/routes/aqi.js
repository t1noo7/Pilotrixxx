import express from 'express';
import { fetchAndCacheStations, generateHeatmapGrid, interpolateAqi } from '../services/aqiService.js';

export const aqiRouter = express.Router();

/**
 * GET /api/aqi/heatmap?lat=..&lng=..
 * Tra ve luoi diem [lat, lng, aqi] quanh vi tri xe, cho WebView (Leaflet.heat)
 * ve heatmap. Chi goi khi driver mo modal "Xem chat luong khong khi" trong
 * trip/[id].tsx - khong phai polling lien tuc.
 */
aqiRouter.get('/heatmap', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'lat va lng la bat buoc va phai la so' });
    }

    try {
        await fetchAndCacheStations();

        const points = await generateHeatmapGrid(lat, lng);
        // AQI tai dung vi tri xe (khong phai trung binh luoi) - dung
        // interpolateAqi da co san, chinh xac hon avg ca luoi vi diem
        // giua luoi (vi tri xe) la thu nguoi dung quan tam nhat.
        const currentAqi = await interpolateAqi(lat, lng);

        res.json({
            center: { lat, lng },
            points,
            currentAqi, // null neu khong co tram nao trong ban kinh IDW_RADIUS_KM
            noStationsNearby: currentAqi === null,
        });
    } catch (err) {
        console.error('[GET /aqi/heatmap] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});