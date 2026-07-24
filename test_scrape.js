async function testScrapeFAA(tail) {
    const stripped = tail.replace(/^N/i, '');
    const url = `https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt=${stripped}`;
    console.log(`\n=== Testing Direct FAA Registry Scrape for ${tail} ===`);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        console.log(`FAA HTTP Status: ${res.status}`);
        if (res.ok) {
            const html = await res.text();
            
            // Extract MFR Name, Model, Type Aircraft, Registrant
            let mfr = 'N/A';
            let model = 'N/A';
            let owner = 'N/A';
            
            let m = html.match(/data-label="MFR Name"[^>]*>([^<]+)/i) || html.match(/Manufacturer Name[\s\S]*?<td[^>]*>([^<]+)/i);
            if (m) mfr = m[1].trim();
            
            m = html.match(/data-label="Model"[^>]*>([^<]+)/i) || html.match(/Model[\s\S]*?<td[^>]*>([^<]+)/i);
            if (m) model = m[1].trim();

            m = html.match(/data-label="Name"[^>]*>([^<]+)/i) || html.match(/Name[\s\S]*?<td[^>]*>([^<]+)/i);
            if (m) owner = m[1].trim();

            console.log(`  Manufacturer: ${mfr}`);
            console.log(`  Model: ${model}`);
            console.log(`  Owner: ${owner}`);
        }
    } catch (e) {
        console.error(`FAA Scrape error for ${tail}:`, e.message);
    }
}

async function testScrapeFlightAware(tail) {
    const url = `https://www.flightaware.com/resources/registration/${tail}`;
    console.log(`\n=== Testing Direct FlightAware Scrape for ${tail} ===`);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });
        console.log(`FlightAware HTTP Status: ${res.status}`);
        if (res.ok) {
            const html = await res.text();
            console.log(`FlightAware HTML length: ${html.length}`);
            const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) console.log(`  Title: ${titleMatch[1].trim()}`);
        }
    } catch (e) {
        console.error(`FlightAware Scrape error:`, e.message);
    }
}

async function main() {
    await testScrapeFAA('N91BL');
    await testScrapeFAA('N82KF');
    await testScrapeFAA('N83HS');
    await testScrapeFlightAware('N83HS');
}

main();
