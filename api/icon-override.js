const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(process.cwd(), 'custom_icons.json');

function loadDb() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const raw = fs.readFileSync(DB_PATH, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('Error reading custom_icons.json:', e);
    }
    return { typeOverrides: {}, tailOverrides: {}, hexOverrides: {} };
}

function saveDb(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Error writing custom_icons.json:', e);
        return false;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'GET') {
        const db = loadDb();
        return res.status(200).json(db);
    }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }

            const { targetType, targetKey, shapeKey, targetCategory } = body || {};
            if (!shapeKey) {
                return res.status(400).json({ error: 'Missing shapeKey' });
            }

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

            saveDb(db);
            return res.status(200).json({ status: 'ok', db });
        } catch (e) {
            console.error('Error updating icon overrides:', e);
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
};
