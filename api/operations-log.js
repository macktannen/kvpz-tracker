const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(process.cwd(), 'operations_log.json');

function loadLogs() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            const raw = fs.readFileSync(LOG_FILE, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('Error reading operations_log.json:', e);
    }
    return [];
}

function saveLogs(logs) {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error writing operations_log.json:', e);
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

    if (req.method === 'GET') {
        const logs = loadLogs();
        return res.status(200).json(logs);
    }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }

            let logs = loadLogs();

            if (Array.isArray(body)) {
                // Bulk replace / update
                logs = body;
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
            let body = req.body;
            if (typeof body === 'string' && body) {
                try { body = JSON.parse(body); } catch(e) {}
            }

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
