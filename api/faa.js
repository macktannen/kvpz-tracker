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

    return cleanModel.replace(/[^A-Z0-9]/g, '').substring(0, 4);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const tail = req.query.tail || req.query.reg || '';
    if (!tail) {
        return res.status(400).json({ error: 'Missing tail parameter' });
    }

    try {
        const stripped = tail.replace(/^N/i, '');
        const targetUrl = `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${stripped}`;
        
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        if (!response.ok) throw new Error(`FAA HTTP Status ${response.status}`);

        const html = await response.text();
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

        return res.status(200).json({
            tail: `N${stripped.toUpperCase()}`,
            type: icaoType,
            mfr: mfr,
            model: model,
            desc: desc,
            owner: owner,
            source: 'FAA Registry'
        });
    } catch (err) {
        return res.status(404).json({ error: err.message, tail });
    }
};
