const fs = require('fs');
const path = require('path');

let inMemoryStore = global.serverlessSpiderStore || {};

function getStoreFilePath() {
    const primaryPath = path.join(process.cwd(), 'spidertracks.json');
    try {
        fs.accessSync(process.cwd(), fs.constants.W_OK);
        return primaryPath;
    } catch (e) {
        return path.join('/tmp', 'spidertracks.json');
    }
}

function loadStore() {
    try {
        const filePath = getStoreFilePath();
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                inMemoryStore = parsed;
                global.serverlessSpiderStore = parsed;
                return parsed;
            }
        }
    } catch (e) {}
    return inMemoryStore;
}

function saveStore(store) {
    inMemoryStore = store;
    global.serverlessSpiderStore = store;
    try {
        const filePath = getStoreFilePath();
        fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    let store = loadStore();

    if (req.method === 'DELETE') {
        store = {};
        saveStore(store);
        return res.status(200).json({ status: 'ok', cleared: true });
    }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }
            if (body && typeof body === 'object') {
                const tail = (body.tail || body.registration || body.id || body.callsign || 'SPIDER1').toUpperCase().trim();
                store[tail] = {
                    hex: body.hex || `SPIDER_${tail.replace(/[^A-Z0-9]/g, '')}`,
                    tail: tail,
                    callsign: body.callsign || tail,
                    lat: parseFloat(body.lat || body.latitude || 0),
                    lon: parseFloat(body.lon || body.longitude || 0),
                    alt: parseInt(body.alt || body.altitude || 2500),
                    speed: parseInt(body.speed || body.groundspeed || 110),
                    heading: parseInt(body.heading || body.track || 180),
                    timestamp: Date.now(),
                    type: body.type || 'SPDR',
                    desc: body.desc || 'Spidertracks Satellite Aircraft',
                    source: 'Spidertracks Satellite'
                };
                saveStore(store);
                return res.status(200).json({ status: 'ok', updated: tail, data: store[tail] });
            }
        } catch(e) {
            return res.status(400).json({ error: e.message });
        }
    }

    // GET request: Return all active spidertracks positions (active within last 30 mins)
    const now = Date.now();
    const active = {};
    for (const [k, v] of Object.entries(store)) {
        if (v && v.timestamp && (now - v.timestamp < 30 * 60 * 1000)) {
            active[k] = v;
        }
    }
    return res.status(200).json(active);
};
