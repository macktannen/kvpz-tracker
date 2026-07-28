const fs = require('fs');
const path = require('path');

let ICAO_CATEGORIES = {};
try {
    ICAO_CATEGORIES = require('../icao_categories.js');
} catch(e) {
    try { ICAO_CATEGORIES = require('./icao_categories.js'); } catch(e2) {}
}

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

let inMemoryLogs = global.serverlessOpsLogs || [];

function getLogFilePath() {
    const primaryPath = path.join(process.cwd(), 'operations_log.json');
    try {
        fs.accessSync(process.cwd(), fs.constants.W_OK);
        return primaryPath;
    } catch (e) {
        return path.join('/tmp', 'operations_log.json');
    }
}

function loadLogs() {
    try {
        const filePath = getLogFilePath();
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                const filtered = parsed.filter(l => !isCommercialJet(l));
                inMemoryLogs = filtered;
                global.serverlessOpsLogs = filtered;
                return filtered;
            }
        }
    } catch (e) {
        console.error('Error reading operations log file:', e);
    }
    return (inMemoryLogs || []).filter(l => !isCommercialJet(l));
}

function saveLogs(logs) {
    const filtered = (logs || []).filter(l => !isCommercialJet(l));
    inMemoryLogs = filtered;
    global.serverlessOpsLogs = filtered;
    try {
        const filePath = getLogFilePath();
        fs.writeFileSync(filePath, JSON.stringify(filtered, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error writing operations log file:', e);
        return false;
    }
}

async function parseBody(req) {
    if (req.body) {
        if (typeof req.body === 'string') {
            try { return JSON.parse(req.body); } catch(e) { return {}; }
        }
        if (Buffer.isBuffer(req.body)) {
            try { return JSON.parse(req.body.toString('utf8')); } catch(e) { return {}; }
        }
        return req.body;
    }
    return new Promise((resolve) => {
        let raw = '';
        req.on('data', chunk => raw += chunk);
        req.on('end', () => {
            try { resolve(JSON.parse(raw)); } catch(e) { resolve({}); }
        });
    });
}

const KVPZ_LAT = 41.5367;
const KVPZ_LON = -87.0070;
let cloudGeofenceState = global.serverlessGeofenceState || {};

function getGeodesicDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runCloudOperationsTracker() {
    try {
        const res = await fetch('https://api.airplanes.live/v2/point/41.5367/-87.0070/15');
        if (!res.ok) return;
        const data = await res.json();
        const aircraft = data.ac || data.aircraft || [];
        if (!Array.isArray(aircraft)) return;

        let currentLogs = loadLogs();
        const now = Date.now();
        let updated = false;

        const appendLog = (logItem) => {
            if (isCommercialJet(logItem)) return;
            const isDup = currentLogs.some(l => l.hex === logItem.hex && l.opType === logItem.opType && Math.abs((l.timestamp || 0) - now) < 180000);
            if (!isDup) {
                currentLogs.unshift(logItem);
                updated = true;
            }
        };

        aircraft.forEach(ac => {
            if (!ac.hex || ac.lat === undefined || ac.lon === undefined) return;
            const hex = ac.hex.toLowerCase();
            const lat = parseFloat(ac.lat);
            const lon = parseFloat(ac.lon);
            const alt = ac.alt_baro !== undefined ? parseInt(ac.alt_baro) : (ac.alt_geom !== undefined ? parseInt(ac.alt_geom) : 0);
            const speed = ac.gs !== undefined ? Math.round(parseFloat(ac.gs)) : 0;
            const vspeed = ac.baro_rate !== undefined ? parseInt(ac.baro_rate) : (ac.geom_rate !== undefined ? parseInt(ac.geom_rate) : 0);
            const dist = getGeodesicDistanceNm(lat, lon, KVPZ_LAT, KVPZ_LON);

            const tail = ac.r || ac.flight || ac.hex.toUpperCase();
            const callsign = ac.flight ? ac.flight.trim() : tail;
            const type = ac.t || ac.type || 'Unknown';

            const prevState = cloudGeofenceState[hex];
            const currentState = {
                hex, tail, callsign, type, dist, alt, speed, vspeed, lat, lon,
                lastSeen: now,
                opType: prevState ? prevState.opType : null,
                logged: prevState ? prevState.logged : false
            };

            if (prevState) {
                const isDescending = vspeed < -100 || alt < prevState.alt;
                const isHeadingTowardsKVPZ = dist < prevState.dist;

                if (dist < 5.0 && alt < 2500 && isDescending && isHeadingTowardsKVPZ) {
                    currentState.opType = 'arrival';
                }

                if (currentState.opType === 'arrival' && dist < 2.5 && alt < 1200 && (speed < 45 || vspeed < -300) && !currentState.logged) {
                    appendLog({
                        id: `op_${now}_${hex}_arr`,
                        hex, tail, callsign, type, opType: 'arrival', timestamp: now,
                        dist: Math.round(dist * 10) / 10, alt,
                        description: `Landed KVPZ (Speed: ${speed} KT, Alt: ${alt} FT)`,
                        source: 'Vercel 24/7 Cloud Tracker'
                    });
                    currentState.logged = true;
                }

                if (prevState.dist < 2.5 && prevState.alt < 1500 && vspeed > 200 && !currentState.logged) {
                    appendLog({
                        id: `op_${now}_${hex}_dep`,
                        hex, tail, callsign, type, opType: 'departure', timestamp: now,
                        dist: Math.round(dist * 10) / 10, alt,
                        description: `Departed KVPZ, climbing through ${alt} ft`,
                        source: 'Vercel 24/7 Cloud Tracker'
                    });
                    currentState.logged = true;
                    currentState.opType = 'departure';
                }
            } else {
                if (dist < 5.0 && alt < 3000 && vspeed > 100) {
                    appendLog({
                        id: `op_${now}_${hex}_dep`,
                        hex, tail, callsign, type, opType: 'departure', timestamp: now,
                        dist: Math.round(dist * 10) / 10, alt,
                        description: `Departed KVPZ, climbing through ${alt} ft`,
                        source: 'Vercel 24/7 Cloud Tracker'
                    });
                    currentState.logged = true;
                    currentState.opType = 'departure';
                }
            }

            if (dist < 1.0 && alt < 1200 && !currentState.logged) {
                const isOutbound = prevState ? dist > prevState.dist : true;
                const direction = isOutbound ? 'departure' : 'arrival';
                currentState.logged = true;
                currentState.opType = direction;
                appendLog({
                    id: `op_${now}_${hex}_${direction.substring(0, 3)}`,
                    hex, tail, callsign, type, opType: direction, timestamp: now,
                    dist: Math.round(dist * 10) / 10, alt,
                    description: `Geofence ${direction === 'arrival' ? 'Landing' : 'Departure'} KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`,
                    source: 'Vercel 24/7 Cloud Tracker'
                });
            }

            if (!currentState.logged) {
                if (dist <= 5.0 && alt <= 3500 && (!prevState || prevState.dist > 5.0)) {
                    appendLog({
                        id: `op_${now}_${hex}_arr`,
                        hex, tail, callsign, type, opType: 'arrival', timestamp: now,
                        dist: Math.round(dist * 10) / 10, alt,
                        description: `Inbound Approach KVPZ (${Math.round(dist * 10) / 10} NM, ${alt} FT)`,
                        source: 'Vercel 24/7 Cloud Tracker'
                    });
                    currentState.logged = true;
                } else if (prevState && prevState.dist <= 5.0 && dist > 6.0) {
                    appendLog({
                        id: `op_${now}_${hex}_dep`,
                        hex, tail, callsign, type, opType: 'departure', timestamp: now,
                        dist: Math.round(dist * 10) / 10, alt,
                        description: `Outbound Departure KVPZ (${Math.round(dist * 10) / 10} NM, ${alt} FT)`,
                        source: 'Vercel 24/7 Cloud Tracker'
                    });
                    currentState.logged = true;
                }
            }

            cloudGeofenceState[hex] = currentState;
        });

        global.serverlessGeofenceState = cloudGeofenceState;

        if (updated) {
            saveLogs(currentLogs);
        }
    } catch(e) {}
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Trigger 24/7 Cloud Operations Tracker execution on GET or Cron request
    await runCloudOperationsTracker();

    if (req.method === 'GET') {
        const logs = loadLogs();
        return res.status(200).json(logs);
    }

    if (req.method === 'POST') {
        try {
            const body = await parseBody(req);
            let logs = loadLogs();

            if (Array.isArray(body)) {
                // Merge bulk array with existing server logs by unique key
                const map = new Map();
                logs.forEach(l => {
                    if (l) map.set(l.id || `${l.timestamp}_${l.hex}_${l.opType}`, l);
                });
                body.forEach(l => {
                    if (l) map.set(l.id || `${l.timestamp}_${l.hex}_${l.opType}`, l);
                });
                logs = Array.from(map.values());
                logs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            } else if (body && body.hex && body.opType) {
                // Single new log entry
                // Avoid exact duplicate within 1 minute
                const isDuplicate = logs.some(l => 
                    l.hex === body.hex && 
                    l.opType === body.opType && 
                    Math.abs((l.timestamp || 0) - (body.timestamp || Date.now())) < 60000
                );
                if (!isDuplicate) {
                    logs.unshift(body);
                }
            }

            // Prune logs older than 30 days
            const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            logs = logs.filter(l => !l || l.timestamp === undefined || l.timestamp >= oneMonthAgo);

            saveLogs(logs);
            return res.status(200).json({ status: 'ok', logs });
        } catch (e) {
            console.error('Error updating operations_log.json:', e);
            return res.status(500).json({ error: e.message });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const body = await parseBody(req);
            const { tail, timestamp, opType } = body || {};
            let logs = loadLogs();

            if (tail) {
                const targetTail = tail.trim().toUpperCase();
                logs = logs.filter(l => {
                    const lTail = (l.tail && l.tail !== 'N/A' && l.tail !== 'Unknown') ? l.tail.trim().toUpperCase() : (l.callsign || '').trim().toUpperCase();
                    if (lTail === targetTail) {
                        if (opType && l.opType !== opType) return true;
                        if (timestamp && l.timestamp !== timestamp) return true;
                        return false;
                    }
                    return true;
                });
            } else {
                // Clear all
                logs = [];
            }

            saveLogs(logs);
            return res.status(200).json({ status: 'ok', logs });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};
