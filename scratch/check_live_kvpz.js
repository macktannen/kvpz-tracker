async function checkKvpzLive() {
    try {
        const res = await fetch('https://api.airplanes.live/v2/point/41.5367/-87.0070/25');
        const data = await res.json();
        const acs = data.ac || [];
        console.log(`Active aircraft within 25 NM of KVPZ: ${acs.length}`);
        acs.forEach(ac => {
            const lat = ac.lat;
            const lon = ac.lon;
            const R = 3440.065;
            const dLat = (lat - 41.5367) * Math.PI / 180;
            const dLon = (lon - (-87.0070)) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                      Math.cos(41.5367 * Math.PI / 180) * Math.cos(lat * Math.PI / 180) *
                      Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const alt = ac.alt_baro !== undefined ? ac.alt_baro : ac.alt_geom;
            console.log(`- ${ac.r || ac.flight || ac.hex}: Type=${ac.t || 'Unkn'}, Dist=${dist.toFixed(1)} NM, Alt=${alt} FT, Speed=${ac.gs} KT`);
        });
    } catch(e) {
        console.error('Error:', e.message);
    }
}
checkKvpzLive();
