const fs = require('fs');
const path = require('path');

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
                inMemoryLogs = parsed;
                global.serverlessOpsLogs = parsed;
                return parsed;
            }
        }
    } catch (e) {
        console.error('Error reading operations log file:', e);
    }
    return inMemoryLogs;
}

function saveLogs(logs) {
    inMemoryLogs = logs;
    global.serverlessOpsLogs = logs;
    try {
        const filePath = getLogFilePath();
        fs.writeFileSync(filePath, JSON.stringify(logs, null, 2), 'utf8');
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

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

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
