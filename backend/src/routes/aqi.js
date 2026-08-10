import express from 'express';
import { fetchAndCacheStations, generateHeatmapGrid, interpolateAqi } from '../services/aqiService.js';

export const aqiRouter = express.Router();

aqiRouter.get('/heatmap', async (req, res) => {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const gridRadiusKm = req.query.gridRadiusKm !== undefined ? parseFloat(req.query.gridRadiusKm) : undefined;
    const step = req.query.step !== undefined ? parseFloat(req.query.step) : undefined;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
        return res.status(400).json({ error: 'lat va lng la bat buoc va phai la so' });
    }

    try {
        await fetchAndCacheStations();

        const points = await generateHeatmapGrid(
            lat,
            lng,
            Number.isNaN(gridRadiusKm) ? undefined : gridRadiusKm,
            Number.isNaN(step) ? undefined : step,
        );
        const currentAqi = await interpolateAqi(lat, lng);

        res.json({
            center: { lat, lng },
            points,
            currentAqi,
            noStationsNearby: currentAqi === null,
        });
    } catch (err) {
        console.error('[GET /aqi/heatmap] Error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});