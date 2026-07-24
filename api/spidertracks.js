let spidertracksStore = {};

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method === 'POST') {
        try {
            let body = req.body;
            if (typeof body === 'string') {
                body = JSON.parse(body);
            }
            if (body && (body.tail || body.registration || body.id)) {
                const tail = (body.tail || body.registration || body.id || 'SPIDER1').toUpperCase().trim();
                spidertracksStore[tail] = {
                    hex: body.hex || `SPIDER_${tail.replace(/[^A-Z0-9]/g, '')}`,
                    tail: tail,
                    callsign: body.callsign || tail,
                    lat: parseFloat(body.lat || body.latitude || 0),
                    lon: parseFloat(body.lon || body.longitude || 0),
                    alt: parseInt(body.alt || body.altitude || 0),
                    speed: parseInt(body.speed || body.groundspeed || 0),
                    heading: parseInt(body.heading || body.track || 0),
                    timestamp: Date.now(),
                    type: body.type || 'SPDR',
                    desc: body.desc || 'Spidertracks Satellite Aircraft',
                    source: 'Spidertracks Satellite'
                };
                return res.status(200).json({ status: 'ok', updated: tail, data: spidertracksStore[tail] });
            }
        } catch(e) {
            return res.status(400).json({ error: e.message });
        }
    }

    // GET request: Return all active spidertracks positions
    const now = Date.now();
    const active = {};
    for (const [k, v] of Object.entries(spidertracksStore)) {
        if (now - v.timestamp < 15 * 60 * 1000) {
            active[k] = v;
        }
    }
    return res.status(200).json(active);
};
