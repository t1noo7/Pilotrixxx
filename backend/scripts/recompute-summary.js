import 'dotenv/config';
import { pool } from '../src/db.js';
import { generateTripSummary } from '../src/services/tripSummaryService.js';

const tripIds = process.argv.slice(2).map(Number);
if (tripIds.length === 0) {
    console.error('Dùng: node scripts/recompute-summary.js <tripId> [tripId...]');
    process.exit(1);
}

for (const tripId of tripIds) {
    try {
        const summary = await generateTripSummary(tripId);
        console.log(`Trip ${tripId}: OK`, summary ? '' : '(no summary returned)');
    } catch (err) {
        console.error(`Trip ${tripId}: FAIL -`, err.message);
    }
}

await pool.end();