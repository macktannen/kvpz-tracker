const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

let ICAO_CATEGORIES = {};
try {
    ICAO_CATEGORIES = require('./icao_categories.js');
} catch(e) {}

function isCommercialJet(ac) {
    if (!ac) return false;
    const type = (ac.type || ac.t || '').trim().toUpperCase();
    const callsign = (ac.callsign || ac.flight || '').trim().toUpperCase();
    const op = (ac.op || ac.operator || '').toLowerCase();
    const desc = (ac.desc || ac.description || '').toLowerCase();

    if (ICAO_CATEGORIES && ICAO_CATEGORIES[type]) {
        if (ICAO_CATEGORIES[type] === 'commercial-jet') return true;
        if (ICAO_CATEGORIES[type] === 'business-jet' || ICAO_CATEGORIES[type] === 'business-prop' || ICAO_CATEGORIES[type] === 'helicopter' || ICAO_CATEGORIES[type] === 'military') {
            return false;
        }
    }

    if (type.startsWith('E5') || type.startsWith('EMB5') || type.startsWith('EP1') || type.startsWith('EP3') || type.startsWith('E35L') ||
        type.startsWith('CL30') || type.startsWith('CL60') || type.startsWith('CL35') || type.startsWith('CL6') || type.startsWith('CL3') ||
        type.startsWith('GLF') || type.startsWith('GLEX') || type.startsWith('GL5') || type.startsWith('GL6') || type.startsWith('GL7') ||
        type.startsWith('G1') || type.startsWith('G2') || type.startsWith('G3') || type.startsWith('G4') || type.startsWith('G5') || type.startsWith('G6') || type.startsWith('G7') || type.startsWith('G8') ||
        type.startsWith('C25') || type.startsWith('C50') || type.startsWith('C51') || type.startsWith('C52') || type.startsWith('C55') ||
        type.startsWith('C56') || type.startsWith('C65') || type.startsWith('C68') || type.startsWith('C70') || type.startsWith('C75') ||
        type.startsWith('LR3') || type.startsWith('LR4') || type.startsWith('LR5') || type.startsWith('LR6') || type.startsWith('LR7') || type.startsWith('LJ') ||
        type.startsWith('FA1') || type.startsWith('FA2') || type.startsWith('FA5') || type.startsWith('FA7') || type.startsWith('FA8') || type.startsWith('F90') || type.startsWith('F7X') || type.startsWith('F8X') ||
        type.startsWith('PC24') || type.startsWith('H25') || type.startsWith('BE40') || type.startsWith('BE4W') || type === 'HDJT' || type === 'SF50' || type === 'EA50' || type === 'SJ30' || type === 'GALX' || type === 'HF20') {
        return false;
    }

    const isCommJet = desc.includes('boeing') || desc.includes('airbus') || 
                      desc.includes('embraer 17') || desc.includes('embraer 19') || desc.includes('bombardier crj') ||
                      desc.includes('md-8') || desc.includes('md-11') || desc.includes('dc-10') ||
                      type.startsWith('B73') || type.startsWith('B74') || type.startsWith('B75') ||
                      type.startsWith('B76') || type.startsWith('B77') || type.startsWith('B78') ||
                      type.startsWith('A31') || type.startsWith('A32') || type.startsWith('A33') ||
                      type.startsWith('A34') || type.startsWith('A35') || type.startsWith('A38') ||
                      type.startsWith('B38M') || type.startsWith('B39M') || type.startsWith('A20') ||
                      type.startsWith('CRJ') || type.startsWith('ERJ') ||
                      type.startsWith('E17') || type.startsWith('E19') ||
                      op.includes('airline') || op.includes('airways') || op.includes('cargo') ||
                      op.includes('delta') || op.includes('united') || op.includes('american') ||
                      op.includes('southwest') || op.includes('fedex') || op.includes('ups') ||
                      op.includes('dhl') || op.includes('spirit') || op.includes('frontier') ||
                      op.includes('alaska') || op.includes('jetblue') || op.includes('allegiant');
    return isCommJet;
}

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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

    if (reqUrl.pathname === '/api/sync' || reqUrl.pathname === '/sync') {
        const syncFile = path.join(__dirname, 'sync.json');
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
                    const tail = (data.tail || data.registration || data.id || data.callsign || 'SYNC1').toUpperCase().trim();
                    const store = loadSyncStore();
                    store[tail] = {
                        hex: data.hex || `SYNC_${tail.replace(/[^A-Z0-9]/g, '')}`,
                        tail: tail,
                        callsign: data.callsign || tail,
                        lat: parseFloat(data.lat || data.latitude || 0),
                        lon: parseFloat(data.lon || data.longitude || 0),
                        alt: parseInt(data.alt || data.altitude || 2500),
                        speed: parseInt(data.speed || data.groundspeed || 0),
                        heading: parseInt(data.heading || data.track || 0),
                        timestamp: Date.now(),
                        type: data.type || 'SYNC',
                        desc: data.desc || 'External Sync Aircraft',
                        source: 'External Sync'
                    };
                    saveSyncStore(store);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', updated: tail, data: store[tail] }));
                } catch(e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(loadSyncStore()));
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
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        const filtered = parsed.filter(l => !isCommercialJet(l));
                        inMemServerLogs = filtered;
                        return filtered;
                    }
                }
            } catch(e) {}
            return (inMemServerLogs || []).filter(l => !isCommercialJet(l));
        };
        const saveLogs = (logs) => {
            const filtered = (logs || []).filter(l => !isCommercialJet(l));
            inMemServerLogs = filtered;
            try {
                const f = getOpsFile();
                fs.writeFileSync(f, JSON.stringify(filtered, null, 2), 'utf8');
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
                    const { tail, timestamp, dateStr, timeStr, callsign, opType, clearAll } = data || {};
                    if (clearAll) {
                        logs = [];
                    } else if (timestamp) {
                        logs = logs.filter(l => l.timestamp !== timestamp);
                    } else if (tail) {
                        const tTail = tail.trim().toUpperCase();
                        logs = logs.filter(l => {
                            const lTail = (l.tail && l.tail !== 'N/A' && l.tail !== 'Unknown') ? l.tail.trim().toUpperCase() : (l.callsign || '').trim().toUpperCase();
                            if (lTail === tTail) {
                                if (opType && l.opType !== opType) return true;
                                return false;
                            }
                            return true;
                        });
                    } else if (callsign && dateStr && timeStr) {
                        logs = logs.filter(l => !(l.dateStr === dateStr && (l.timeStr === timeStr || l.time === timeStr) && l.callsign === callsign));
                    } else if (callsign) {
                        logs = logs.filter(l => l.callsign !== callsign);
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
const KVPZ_ELEVATION_MSL = 770;

function getAGL(altMSL) {
    if (altMSL === undefined || altMSL === null || isNaN(altMSL)) return 0;
    return Math.max(0, parseInt(altMSL) - KVPZ_ELEVATION_MSL);
}

function getRunwayAlignment(heading) {
    if (heading === undefined || heading === null || isNaN(heading)) return null;
    const h = (parseFloat(heading) % 360 + 360) % 360;
    if ((h >= 72 && h <= 108) || (h >= 252 && h <= 288)) {
        return '09/27';
    }
    if ((h >= 162 && h <= 198) || (h >= 342 || h <= 18)) {
        return '18/36';
    }
    return null;
}

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
        const activeHexes = new Set();

        const appendLog = (logItem) => {
            if (isCommercialJet(logItem)) return;
            const isDup = currentLogs.some(l => l.hex === logItem.hex && l.opType === logItem.opType && Math.abs((l.timestamp || 0) - now) < 180000);
            if (!isDup) {
                currentLogs.unshift(logItem);
                updated = true;
                console.log(`[24/7 Server Operations Tracker] Logged ${logItem.opType.toUpperCase()}: ${logItem.tail} (${logItem.type}) - ${logItem.description}`);
            }
        };

        aircraft.forEach(ac => {
            if (!ac.hex || ac.lat === undefined || ac.lon === undefined) return;
            const hex = ac.hex.toLowerCase();
            activeHexes.add(hex);

            const lat = parseFloat(ac.lat);
            const lon = parseFloat(ac.lon);
            const alt = ac.alt_baro !== undefined ? parseInt(ac.alt_baro) : (ac.alt_geom !== undefined ? parseInt(ac.alt_geom) : 0);
            const speed = ac.gs !== undefined ? Math.round(parseFloat(ac.gs)) : 0;
            const vspeed = ac.baro_rate !== undefined ? parseInt(ac.baro_rate) : (ac.geom_rate !== undefined ? parseInt(ac.geom_rate) : 0);
            const heading = ac.track !== undefined ? parseFloat(ac.track) : null;
            const dist = getGeodesicDistanceNm(lat, lon, KVPZ_LAT, KVPZ_LON);

            const tail = ac.r || ac.flight || ac.hex.toUpperCase();
            const callsign = ac.flight ? ac.flight.trim() : tail;
            const type = ac.t || ac.type || 'Unknown';
            const category = ac.category || '';

            const agl = getAGL(alt);
            const rwy = getRunwayAlignment(heading);
            const isHeli = (category === 'A7' || type.startsWith('H') || type.startsWith('R44') || type.startsWith('EC') || type.startsWith('UH') || type.startsWith('CH') || type.startsWith('B06') || type.startsWith('B412') || (ICAO_CATEGORIES && ICAO_CATEGORIES[type] === 'helicopter'));

            const prevState = serverGeofenceState[hex];

            const currentState = {
                hex, tail, callsign, type, dist, alt, speed, vspeed, heading, lat, lon,
                lastSeen: now,
                opType: prevState ? prevState.opType : null,
                logged: prevState ? prevState.logged : false
            };

            if (prevState) {
                if (isHeli) {
                    if (dist <= 2.0 && agl <= 500) {
                        if ((speed < 35 || vspeed < -150) && agl <= 300 && !currentState.logged) {
                            appendLog({
                                id: `op_${now}_${hex}_arr`,
                                hex, tail, callsign, type, opType: 'arrival', timestamp: now,
                                dist: Math.round(dist * 10) / 10, alt,
                                description: `Helicopter Landing KVPZ (${Math.round(dist * 10) / 10} NM, ${speed} KT, ${agl} FT AGL)`,
                                source: '24/7 Server Engine'
                            });
                            currentState.logged = true;
                            currentState.opType = 'arrival';
                        } else if (vspeed > 150 && (prevState.speed < 30 || getAGL(prevState.alt) <= 200) && !currentState.logged) {
                            appendLog({
                                id: `op_${now}_${hex}_dep`,
                                hex, tail, callsign, type, opType: 'departure', timestamp: now,
                                dist: Math.round(dist * 10) / 10, alt,
                                description: `Helicopter Departure KVPZ (${Math.round(dist * 10) / 10} NM, climbing ${agl} FT AGL)`,
                                source: '24/7 Server Engine'
                            });
                            currentState.logged = true;
                            currentState.opType = 'departure';
                        }
                    }
                } else {
                    if (prevState.logged && (prevState.opType === 'arrival' || getAGL(prevState.alt) < 150) && vspeed > 200 && dist <= 2.5) {
                        if (!currentState.touchAndGoLogged) {
                            appendLog({
                                id: `op_${now}_${hex}_tg`,
                                hex, tail, callsign, type, opType: 'arrival', timestamp: now,
                                dist: Math.round(dist * 10) / 10, alt,
                                description: `Touch-and-Go / Pattern KVPZ Rwy ${rwy || '09/27'} (${speed} KT, ${agl} FT AGL)`,
                                source: '24/7 Server Engine'
                            });
                            currentState.touchAndGoLogged = true;
                        }
                    } else if (dist <= 3.0 && agl <= 500 && rwy !== null && (vspeed < -100 || speed < 55 || agl < 150) && !currentState.logged) {
                        appendLog({
                            id: `op_${now}_${hex}_arr`,
                            hex, tail, callsign, type, opType: 'arrival', timestamp: now,
                            dist: Math.round(dist * 10) / 10, alt,
                            description: `Landed KVPZ Rwy ${rwy} (${speed} KT, ${agl} FT AGL)`,
                            source: '24/7 Server Engine'
                        });
                        currentState.logged = true;
                        currentState.opType = 'arrival';
                    } else if (dist <= 3.0 && agl <= 600 && (rwy !== null || prevState.dist < 1.5) && vspeed > 150 && !currentState.logged) {
                        appendLog({
                            id: `op_${now}_${hex}_dep`,
                            hex, tail, callsign, type, opType: 'departure', timestamp: now,
                            dist: Math.round(dist * 10) / 10, alt,
                            description: `Departed KVPZ Rwy ${rwy || '18/36'} (climbing ${agl} FT AGL)`,
                            source: '24/7 Server Engine'
                        });
                        currentState.logged = true;
                        currentState.opType = 'departure';
                    }
                }
            } else {
                if (isHeli) {
                    if (dist <= 2.0 && agl <= 500 && vspeed > 100) {
                        appendLog({
                            id: `op_${now}_${hex}_dep`,
                            hex, tail, callsign, type, opType: 'departure', timestamp: now,
                            dist: Math.round(dist * 10) / 10, alt,
                            description: `Helicopter Departure KVPZ (${Math.round(dist * 10) / 10} NM, climbing ${agl} FT AGL)`,
                            source: '24/7 Server Engine'
                        });
                        currentState.logged = true;
                        currentState.opType = 'departure';
                    }
                } else {
                    if (dist <= 3.0 && agl <= 600 && vspeed > 150) {
                        appendLog({
                            id: `op_${now}_${hex}_dep`,
                            hex, tail, callsign, type, opType: 'departure', timestamp: now,
                            dist: Math.round(dist * 10) / 10, alt,
                            description: `Departed KVPZ Rwy ${rwy || '18/36'} (climbing ${agl} FT AGL)`,
                            source: '24/7 Server Engine'
                        });
                        currentState.logged = true;
                        currentState.opType = 'departure';
                    }
                }
            }

            if (dist < 1.0 && agl < 600 && !currentState.logged) {
                const isOutbound = prevState ? dist > prevState.dist : true;
                const direction = isOutbound ? 'departure' : 'arrival';
                currentState.logged = true;
                currentState.opType = direction;
                appendLog({
                    id: `op_${now}_${hex}_${direction.substring(0, 3)}`,
                    hex, tail, callsign, type, opType: direction, timestamp: now,
                    dist: Math.round(dist * 10) / 10, alt,
                    description: `Geofence ${direction === 'arrival' ? 'Landing' : 'Departure'} KVPZ (${agl} FT AGL, ${dist.toFixed(2)} NM)`,
                    source: '24/7 Server Engine'
                });
            }

            serverGeofenceState[hex] = currentState;
        });

        // 6. LOW-ALTITUDE RADAR DROP-OFF CLASSIFICATION (Aircraft disappearing near KVPZ)
        Object.keys(serverGeofenceState).forEach(hex => {
            if (!activeHexes.has(hex)) {
                const lastState = serverGeofenceState[hex];
                const timeSinceLastSeen = now - (lastState.lastSeen || 0);

                if (timeSinceLastSeen < 45000 && !lastState.logged) {
                    const isTargetedArrival = lastState.opType === 'arrival' && lastState.dist < 6.0 && lastState.alt < 2500;
                    const isAnyDisappearingClose = lastState.dist < 5.0;

                    if (isTargetedArrival || isAnyDisappearingClose) {
                        appendLog({
                            id: `op_${now}_${hex}_arr`,
                            hex,
                            tail: lastState.tail,
                            callsign: lastState.callsign,
                            type: lastState.type,
                            opType: 'arrival',
                            timestamp: now,
                            dist: Math.round(lastState.dist * 10) / 10,
                            alt: lastState.alt,
                            description: `Landed KVPZ (Radar Dropoff ${Math.round(lastState.dist * 10) / 10} NM out, ${lastState.alt} FT)`,
                            source: '24/7 Server Engine'
                        });
                        lastState.logged = true;
                    }
                }
                
                // Clean up stale entries after 10 minutes
                if (timeSinceLastSeen > 600000) {
                    delete serverGeofenceState[hex];
                }
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
