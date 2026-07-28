// api/sync.js
// Vercel Serverless Function for Generic Aircraft Sync
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    const tmpDir = os.tmpdir();
    const syncFile = path.join(tmpDir, 'sync.json');

    const loadSyncStore = () => {
        try {
            if (fs.existsSync(syncFile)) return JSON.parse(fs.readFileSync(syncFile, 'utf8'));
        } catch(e) {}
        return {};
    };

    const saveSyncStore = (data) => {
        try { fs.writeFileSync(syncFile, JSON.stringify(data, null, 2), 'utf8'); } catch(e) {}
    };

    if (req.method === 'DELETE') {
        saveSyncStore({});
        res.status(200).json({ status: 'ok', cleared: true });
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const tail = (data.tail || data.registration || data.id || data.callsign || 'SYNC1').toUpperCase().trim();
                const store = loadSyncStore();
                const prevEntry = store[tail] || {};
                let history = Array.isArray(prevEntry.history) ? prevEntry.history : [];
                
                const newLat = parseFloat(data.lat || data.latitude || 0);
                const newLon = parseFloat(data.lon || data.longitude || 0);
                
                if (newLat !== 0 && newLon !== 0) {
                    const lastPt = history.length > 0 ? history[history.length - 1] : null;
                    if (!lastPt || Math.abs(lastPt[0] - newLat) > 0.00003 || Math.abs(lastPt[1] - newLon) > 0.00003) {
                        history.push([newLat, newLon]);
                    }
                }
                
                if (history.length > 2000) {
                    history = history.slice(-2000);
                }
                
                store[tail] = {
                    hex: data.hex || `SYNC_${tail.replace(/[^A-Z0-9]/g, '')}`,
                    tail: tail,
                    callsign: data.callsign || tail,
                    lat: newLat,
                    lon: newLon,
                    alt: parseInt(data.alt || data.altitude || 2500),
                    speed: parseInt(data.speed || data.groundspeed || 0),
                    heading: parseInt(data.heading || data.track || 0),
                    timestamp: Date.now(),
                    type: data.type || 'SYNC',
                    desc: data.desc || 'External Sync Aircraft',
                    source: 'External Sync',
                    history: history
                };
                
                saveSyncStore(store);
                res.status(200).json({ status: 'ok', updated: tail, points: history.length, data: store[tail] });
            } catch(e) {
                res.status(400).json({ error: e.message });
            }
        });
        return;
    }

    // Default to GET
    res.status(200).json(loadSyncStore());
};
