const fs = require('fs');

async function main() {
    console.log("Downloading ICAO database...");
    const res = await fetch('https://raw.githubusercontent.com/ColtJD45/icao-aircraft-designator-list/main/icao_aircraft_data.csv');
    const text = await res.text();
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    
    // manufacturer,model,type_designator,description,engine_type,engine_count,wtc
    const categories = {};
    
    for (let i = 1; i < lines.length; i++) {
        // Handle CSV split correctly (split by comma, ignoring quotes for simplicity since this file doesn't have nested commas in the first 4 columns)
        // Or just use a simple regex for CSV:
        const cols = [];
        let cur = '', inQuote = false;
        for (const char of lines[i]) {
            if (char === '"') inQuote = !inQuote;
            else if (char === ',' && !inQuote) { cols.push(cur); cur = ''; }
            else cur += char;
        }
        cols.push(cur);
        
        if (cols.length < 7) continue;
        
        let mfr = (cols[0] || '').replace(/"/g, '').trim().toUpperCase();
        let model = (cols[1] || '').replace(/"/g, '').trim().toUpperCase();
        let icao = (cols[2] || '').replace(/"/g, '').trim().toUpperCase();
        let desc = (cols[3] || '').replace(/"/g, '').trim().toUpperCase(); // LandPlane, Helicopter, etc
        let eng = (cols[4] || '').replace(/"/g, '').trim().toUpperCase();  // Jet, Piston, Turboprop
        let wtc = (cols[6] || '').replace(/"/g, '').trim().toUpperCase();  // L, M, H
        
        if (!icao || icao.length < 2 || icao === 'N/A') continue;
        
        let cat = 'airplane'; // default
        
        // 1. Helicopter
        if (desc.includes('HELICOPTER') || desc.includes('GYROCOPTER')) {
            cat = 'helicopter';
        }
        // 1.5 Farm (Air Tractor)
        else if (mfr.includes('AIR TRACTOR')) {
            cat = 'farm';
        }
        // 2. Military
        else if (
            model.includes('F-16') || model.includes('F-35') || model.includes('F-15') || 
            model.includes('F-22') || model.includes('F/A-18') || model.includes('A-10') || 
            model.includes('B-1') || model.includes('B-2') || model.includes('B-52') || 
            model.includes('C-17 ') || model.includes('C-5 ') || model.includes('C-130') || 
            model.includes('KC-135') || model.includes('KC-10') || model.includes('KC-46') || 
            mfr.includes('SUKHOI') || mfr.includes('MIKOYAN') || model.includes('TORNADO') || 
            model.includes('EUROFIGHTER') || model.includes('T-38') || model.includes('T-6')
        ) {
            cat = 'military';
        }
        // 3. Commercial Jets
        else if (eng === 'JET' && (wtc === 'H' || wtc === 'J')) {
            // Almost all heavy jets are commercial
            cat = 'commercial-jet';
        }
        else if (eng === 'JET' && wtc === 'M' && (mfr.includes('BOEING') || mfr.includes('AIRBUS') || mfr.includes('MCDONNELL DOUGLAS') || mfr.includes('ANTONOV') || mfr.includes('EMBRAER') || mfr.includes('BOMBARDIER') || mfr.includes('BAE SYSTEMS') || mfr.includes('FOKKER') || mfr.includes('TUPOLEV') || mfr.includes('ILYUSHIN'))) {
            // Filter Embraer and Bombardier for BizJets
            if (model.includes('GLOBAL') || model.includes('CHALLENGER') || model.includes('LEARJET') || model.includes('PRAETOR') || model.includes('LEGACY') || model.includes('LINEAGE')) {
                cat = 'business-jet';
            } else {
                cat = 'commercial-jet';
            }
        }
        else if (eng === 'TURBOPROP' && wtc === 'M' && (mfr.includes('ATR') || mfr.includes('DE HAVILLAND') || mfr.includes('BOMBARDIER') || mfr.includes('SAAB') || mfr.includes('FOKKER'))) {
            // Large regional turboprops
            cat = 'commercial-jet'; // Group them visually with airliners
        }
        // 4. Business Jets
        else if (eng === 'JET' && (wtc === 'L' || wtc === 'M')) {
            if (mfr.includes('GULFSTREAM') || mfr.includes('CESSNA') || mfr.includes('DASSAULT') || mfr.includes('LEARJET') || mfr.includes('HONDA') || mfr.includes('PILATUS') || mfr.includes('BOMBARDIER') || mfr.includes('EMBRAER') || mfr.includes('HAWKER') || mfr.includes('RAYTHEON') || mfr.includes('BEECH') || model.includes('CITATION') || model.includes('FALCON') || model.includes('ECLIPSE')) {
                cat = 'business-jet';
            } else {
                // Some small military trainers or unknown light jets. Default to bizjet if light jet and not obviously GA
                if (wtc === 'L') cat = 'business-jet';
                else cat = 'commercial-jet'; 
            }
        }
        // 5. Airplane
        else {
            cat = 'airplane';
        }
        
        // Final overrides
        if (cat !== 'farm') {
            if (icao.startsWith('B7') || icao.startsWith('A3') || ['B38M', 'B39M', 'A20N', 'A21N', 'BCS1', 'BCS3', 'E135', 'E145', 'E170', 'E190'].includes(icao)) {
                cat = 'commercial-jet';
            }
            if (icao.startsWith('C5') || icao.startsWith('C6') || icao.startsWith('C7') || icao.startsWith('LJ') || icao.startsWith('FA') || icao.startsWith('GLF') || icao.startsWith('GLEX')) {
                if (!['C5', 'C130'].includes(icao)) {
                    cat = 'business-jet';
                }
            }
            if (['F15', 'F16', 'F18', 'F22', 'F35', 'A10', 'B1', 'B2', 'B52', 'C17', 'C5', 'C130', 'K35R', 'KC46', 'T38', 'T6'].includes(icao)) {
                cat = 'military';
            }
        }
        
        categories[icao] = cat;
    }
    
    // Ensure all ICAO keys are unique and output the file
    const jsContent = `// Auto-generated comprehensive ICAO aircraft category lookup table (8000+ codes)
const ICAO_CATEGORIES = ${JSON.stringify(categories, null, 2)};
`;

    fs.writeFileSync('icao_categories.js', jsContent);
    console.log('Saved icao_categories.js with ' + Object.keys(categories).length + ' unique ICAO entries.');
}

main().catch(console.error);
