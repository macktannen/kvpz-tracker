const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Comprehensive FAA Model -> ICAO Type Designator lookup table
const MODEL_TO_ICAO = {
    'F260D': 'F260',
    'PA 46-350P': 'P46T',
    'PA-46-350P': 'P46T',
    'GVIII-G800': 'GLF8',
    'G800': 'GLF8',
    '172S': 'C172',
    '172N': 'C172',
    '172M': 'C172',
    '172P': 'C172',
    '182P': 'C182',
    '182T': 'C182',
    'SR22': 'SR22',
    'SR20': 'SR20',
    'PA-28-181': 'P28A',
    'PA-28-161': 'P28A',
    'PC-12/47E': 'PC12',
    'PC-12/45': 'PC12',
    'B200': 'BE20',
    'B300': 'BE30',
    'FA-50': 'FA50',
    'A320-232': 'A320',
    '737-800': 'B738'
};

function inferIcaoType(mfr, model) {
    if (!model) return 'UNKN';
    const cleanModel = model.trim().toUpperCase();
    if (MODEL_TO_ICAO[cleanModel]) return MODEL_TO_ICAO[cleanModel];

    // Common pattern matching for FAA models
    if (cleanModel.startsWith('172')) return 'C172';
    if (cleanModel.startsWith('182')) return 'C182';
    if (cleanModel.startsWith('150') || cleanModel.startsWith('152')) return 'C150';
    if (cleanModel.startsWith('206')) return 'C206';
    if (cleanModel.startsWith('208') || cleanModel.startsWith('CARAVAN')) return 'C208';
    if (cleanModel.startsWith('210')) return 'C210';
    if (cleanModel.includes('PA-28') || cleanModel.includes('PA 28')) return 'P28A';
    if (cleanModel.includes('PA-46') || cleanModel.includes('PA 46')) return 'P46T';
    if (cleanModel.includes('PA-31') || cleanModel.includes('PA 31')) return 'PA31';
    if (cleanModel.includes('SR22') || cleanModel.includes('SR-22')) return 'SR22';
    if (cleanModel.includes('SR20') || cleanModel.includes('SR-20')) return 'SR20';
    if (cleanModel.includes('PC-12') || cleanModel.includes('PC12')) return 'PC12';
    if (cleanModel.includes('PC-24') || cleanModel.includes('PC24')) return 'PC24';
    if (cleanModel.includes('KING AIR') || cleanModel.includes('BE20') || cleanModel.includes('B200')) return 'BE20';
    if (cleanModel.includes('G800') || cleanModel.includes('GVIII')) return 'GLF8';
    if (cleanModel.includes('G650') || cleanModel.includes('GVI')) return 'GLF6';
    if (cleanModel.includes('G550') || cleanModel.includes('GV')) return 'GLF5';
    if (cleanModel.includes('G450') || cleanModel.includes('GIV')) return 'GLF4';

    // Fallback: Return first 4 chars of model string
    return cleanModel.replace(/[^A-Z0-9]/g, '').substring(0, 4);
}

async function scrapeFAA(tail) {
    const stripped = tail.replace(/^N/i, '');
    const targetUrl = `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${stripped}`;
    
    const res = await fetch(targetUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    if (!res.ok) throw new Error(`FAA HTTP Status ${res.status}`);

    const html = await res.text();
    let mfr = '';
    let model = '';
    let owner = '';

    let m = html.match(/data-label="MFR Name"[^>]*>([^<]+)/i) || html.match(/Manufacturer Name[\s\S]*?<td[^>]*>([^<]+)/i);
    if (m) mfr = m[1].trim();

    m = html.match(/data-label="Model"[^>]*>([^<]+)/i) || html.match(/Model[\s\S]*?<td[^>]*>([^<]+)/i);
    if (m) model = m[1].trim();

    m = html.match(/data-label="Name"[^>]*>([^<]+)/i) || html.match(/Name[\s\S]*?<td[^>]*>([^<]+)/i);
    if (m) owner = m[1].trim();

    if (!mfr && !model) throw new Error('Aircraft registration not found in FAA database');

    const icaoType = inferIcaoType(mfr, model);
    const desc = mfr ? `${mfr} ${model}`.trim() : model;

    return {
        tail: `N${stripped.toUpperCase()}`,
        type: icaoType,
        mfr: mfr,
        model: model,
        desc: desc,
        owner: owner,
        source: 'FAA Registry'
    };
}

const PORT = 3001;
const server = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const reqUrl = url.parse(req.url, true);
    if (reqUrl.pathname === '/health' || reqUrl.pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'FAA Scraper' }));
        return;
    }

let spidertracksStore = {};

    if (reqUrl.pathname === '/spidertracks') {
        if (req.method === 'DELETE') {
            spidertracksStore = {};
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', cleared: true }));
            return;
        }
        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const tail = (data.tail || data.registration || data.id || 'SPIDER1').toUpperCase().trim();
                    spidertracksStore[tail] = {
                        hex: data.hex || `SPIDER_${tail.replace(/[^A-Z0-9]/g, '')}`,
                        tail: tail,
                        callsign: data.callsign || tail,
                        lat: parseFloat(data.lat || data.latitude || 0),
                        lon: parseFloat(data.lon || data.longitude || 0),
                        alt: parseInt(data.alt || data.altitude || 0),
                        speed: parseInt(data.speed || data.groundspeed || 0),
                        heading: parseInt(data.heading || data.track || 0),
                        timestamp: Date.now(),
                        type: data.type || 'SPDR',
                        desc: data.desc || 'Spidertracks Satellite Aircraft',
                        source: 'Spidertracks Satellite'
                    };
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', updated: tail, data: spidertracksStore[tail] }));
                } catch(e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(spidertracksStore));
            return;
        }
    }

    if (reqUrl.pathname === '/icon-override' || reqUrl.pathname === '/api/icon-override') {
        const customIconFile = path.join(__dirname, 'custom_icons.json');
        
        const loadDb = () => {
            try {
                if (fs.existsSync(customIconFile)) {
                    return JSON.parse(fs.readFileSync(customIconFile, 'utf8'));
                }
            } catch(e) {}
            return { typeOverrides: {}, tailOverrides: {}, hexOverrides: {} };
        };

        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(loadDb()));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    const { targetType, targetKey, shapeKey } = data || {};
                    const db = loadDb();
                    if (!db.typeOverrides) db.typeOverrides = {};
                    if (!db.tailOverrides) db.tailOverrides = {};
                    if (!db.hexOverrides) db.hexOverrides = {};

                    const cleanKey = (targetKey || '').toUpperCase().trim();
                    if (targetType === 'type' || (!targetType && cleanKey)) {
                        if (shapeKey === 'default' || shapeKey === 'reset') {
                            delete db.typeOverrides[cleanKey];
                        } else {
                            db.typeOverrides[cleanKey] = shapeKey;
                        }
                    } else if (targetType === 'tail') {
                        if (shapeKey === 'default' || shapeKey === 'reset') {
                            delete db.tailOverrides[cleanKey];
                        } else {
                            db.tailOverrides[cleanKey] = shapeKey;
                        }
                    } else if (targetType === 'hex') {
                        const hexKey = cleanKey.toLowerCase();
                        if (shapeKey === 'default' || shapeKey === 'reset') {
                            delete db.hexOverrides[hexKey];
                        } else {
                            db.hexOverrides[hexKey] = shapeKey;
                        }
                    }

                    fs.writeFileSync(customIconFile, JSON.stringify(db, null, 2), 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', db }));
                } catch(e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    if (reqUrl.pathname === '/operations-log' || reqUrl.pathname === '/api/operations-log') {
        let inMemServerLogs = [];
        const getOpsFile = () => {
            const p = path.join(__dirname, 'operations_log.json');
            try { fs.accessSync(__dirname, fs.constants.W_OK); return p; } catch(e) { return path.join('/tmp', 'operations_log.json'); }
        };
        const loadLogs = () => {
            try {
                const f = getOpsFile();
                if (fs.existsSync(f)) {
                    const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
                    if (Array.isArray(parsed) && parsed.length > 0) { inMemServerLogs = parsed; return parsed; }
                }
            } catch(e) {}
            return inMemServerLogs;
        };
        const saveLogs = (logs) => {
            inMemServerLogs = logs;
            try {
                const f = getOpsFile();
                fs.writeFileSync(f, JSON.stringify(logs, null, 2), 'utf8');
                return true;
            } catch(e) { return false; }
        };

        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(loadLogs()));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    let logs = loadLogs();
                    if (Array.isArray(data)) {
                        const map = new Map();
                        logs.forEach(l => { if (l) map.set(l.id || `${l.timestamp}_${l.hex}_${l.opType}`, l); });
                        data.forEach(l => { if (l) map.set(l.id || `${l.timestamp}_${l.hex}_${l.opType}`, l); });
                        logs = Array.from(map.values());
                        logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                    } else if (data && data.hex && data.opType) {
                        const isDup = logs.some(l => l.hex === data.hex && l.opType === data.opType && Math.abs((l.timestamp||0) - (data.timestamp||Date.now())) < 60000);
                        if (!isDup) logs.unshift(data);
                    }
                    saveLogs(logs);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', logs }));
                } catch(e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        if (req.method === 'DELETE') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    let data = {};
                    if (body) try { data = JSON.parse(body); } catch(e) {}
                    let logs = loadLogs();
                    const { tail, timestamp, opType } = data || {};
                    if (tail) {
                        const tTail = tail.trim().toUpperCase();
                        logs = logs.filter(l => {
                            const lTail = (l.tail && l.tail !== 'N/A' && l.tail !== 'Unknown') ? l.tail.trim().toUpperCase() : (l.callsign || '').trim().toUpperCase();
                            if (lTail === tTail) {
                                if (opType && l.opType !== opType) return true;
                                if (timestamp && l.timestamp !== timestamp) return true;
                                return false;
                            }
                            return true;
                        });
                    } else {
                        logs = [];
                    }
                    saveLogs(logs);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', logs }));
                } catch(e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }
    }

    if (reqUrl.pathname === '/faa' || reqUrl.pathname === '/scrape') {
        const tail = reqUrl.query.tail || reqUrl.query.reg || '';
        if (!tail) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing tail parameter. Usage: /faa?tail=N83HS' }));
            return;
        }

        try {
            console.log(`[FAA Server] Scraping FAA Registry for ${tail}...`);
            const data = await scrapeFAA(tail);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
        } catch (err) {
            console.warn(`[FAA Server] Error scraping ${tail}:`, err.message);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, tail }));
        }
    } else {
        let filePath = path.join(__dirname, reqUrl.pathname === '/' ? 'index.html' : reqUrl.pathname);
        fs.readFile(filePath, (err, data) => {
            if (err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                const ext = path.extname(filePath).toLowerCase();
                const mimeTypes = {
                    '.html': 'text/html',
                    '.js': 'text/javascript',
                    '.css': 'text/css',
                    '.json': 'application/json',
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.svg': 'image/svg+xml'
                };
                res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
                res.end(data);
            }
        });
    }
});

// Server 24/7 Background Operations Tracking Loop around KVPZ (41.5367 N, -87.0070 W)
const KVPZ_LAT = 41.5367;
const KVPZ_LON = -87.0070;
const serverGeofenceState = {};

function getGeodesicDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Earth radius in NM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runServerOperationsTracker() {
    try {
        const res = await fetch('https://api.airplanes.live/v2/point/41.5367/-87.0070/15');
        if (!res.ok) return;
        const data = await res.json();
        const aircraft = data.ac || data.aircraft || [];
        if (!Array.isArray(aircraft)) return;

        const opsLogFile = path.join(__dirname, 'operations_log.json');
        let currentLogs = [];
        try {
            if (fs.existsSync(opsLogFile)) {
                currentLogs = JSON.parse(fs.readFileSync(opsLogFile, 'utf8'));
            }
        } catch(e) {}

        const now = Date.now();
        let updated = false;

        aircraft.forEach(ac => {
            if (!ac.hex || ac.lat === undefined || ac.lon === undefined) return;
            const hex = ac.hex.toLowerCase();
            const lat = parseFloat(ac.lat);
            const lon = parseFloat(ac.lon);
            const alt = ac.alt_baro !== undefined ? parseInt(ac.alt_baro) : (ac.alt_geom !== undefined ? parseInt(ac.alt_geom) : 0);
            const dist = getGeodesicDistanceNm(lat, lon, KVPZ_LAT, KVPZ_LON);

            const tail = ac.r || ac.flight || ac.hex.toUpperCase();
            const callsign = ac.flight ? ac.flight.trim() : tail;
            const type = ac.t || ac.type || 'Unknown';

            const isInside = dist <= 5.0 && alt <= 3500;
            const prevState = serverGeofenceState[hex];

            if (!prevState) {
                serverGeofenceState[hex] = { inside: isInside, dist, alt, lastSeen: now, tail, callsign, type };
                if (isInside) {
                    // Log arrival if first detected inside 5.0NM KVPZ boundary
                    const logItem = {
                        id: `op_${now}_${hex}_arr`,
                        hex: hex,
                        tail: tail,
                        callsign: callsign,
                        type: type,
                        opType: 'arrival',
                        timestamp: now,
                        dist: Math.round(dist * 10) / 10,
                        alt: alt,
                        source: 'Server 24/7 Tracker'
                    };
                    const isDup = currentLogs.some(l => l.hex === hex && l.opType === 'arrival' && Math.abs((l.timestamp||0) - now) < 180000);
                    if (!isDup) {
                        currentLogs.unshift(logItem);
                        updated = true;
                        console.log(`[24/7 Server Operations] Logged ARRIVAL: ${tail} (${type}) at KVPZ (${logItem.dist} NM, ${alt} ft)`);
                    }
                }
            } else {
                if (isInside && !prevState.inside) {
                    // Transition: Outside -> Inside (Arrival)
                    const logItem = {
                        id: `op_${now}_${hex}_arr`,
                        hex: hex,
                        tail: tail,
                        callsign: callsign,
                        type: type,
                        opType: 'arrival',
                        timestamp: now,
                        dist: Math.round(dist * 10) / 10,
                        alt: alt,
                        source: 'Server 24/7 Tracker'
                    };
                    const isDup = currentLogs.some(l => l.hex === hex && l.opType === 'arrival' && Math.abs((l.timestamp||0) - now) < 180000);
                    if (!isDup) {
                        currentLogs.unshift(logItem);
                        updated = true;
                        console.log(`[24/7 Server Operations] Logged ARRIVAL: ${tail} (${type}) at KVPZ (${logItem.dist} NM, ${alt} ft)`);
                    }
                } else if (!isInside && prevState.inside && dist > 6.0) {
                    // Transition: Inside -> Outside (Departure)
                    const logItem = {
                        id: `op_${now}_${hex}_dep`,
                        hex: hex,
                        tail: tail,
                        callsign: callsign,
                        type: type,
                        opType: 'departure',
                        timestamp: now,
                        dist: Math.round(dist * 10) / 10,
                        alt: alt,
                        source: 'Server 24/7 Tracker'
                    };
                    const isDup = currentLogs.some(l => l.hex === hex && l.opType === 'departure' && Math.abs((l.timestamp||0) - now) < 180000);
                    if (!isDup) {
                        currentLogs.unshift(logItem);
                        updated = true;
                        console.log(`[24/7 Server Operations] Logged DEPARTURE: ${tail} (${type}) from KVPZ (${logItem.dist} NM, ${alt} ft)`);
                    }
                }
                serverGeofenceState[hex].inside = isInside;
                serverGeofenceState[hex].dist = dist;
                serverGeofenceState[hex].alt = alt;
                serverGeofenceState[hex].lastSeen = now;
            }
        });

        if (updated) {
            // Prune older than 30 days
            const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);
            currentLogs = currentLogs.filter(l => !l || l.timestamp === undefined || l.timestamp >= oneMonthAgo);
            fs.writeFileSync(opsLogFile, JSON.stringify(currentLogs, null, 2), 'utf8');
        }
    } catch(e) {
        // Silent background catch
    }
}

// Run 24/7 Server Operations Tracking loop every 5 seconds
setInterval(runServerOperationsTracker, 5000);
setTimeout(runServerOperationsTracker, 1000);

server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 Local FAA Registry Scraper Server running at http://127.0.0.1:${PORT}`);
    console.log(`Example: http://127.0.0.1:${PORT}/faa?tail=N83HS`);
    console.log(`======================================================\n`);
});
