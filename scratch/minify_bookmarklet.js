const code = `javascript:(function(){
    if(window.extSyncTimer){
        clearInterval(window.extSyncTimer);
        window.extSyncTimer=null;
        var t=document.createElement('div');
        t.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;padding:12px 18px;background:#ef4444;color:#fff;font-weight:bold;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-size:13px;';
        t.innerHTML='🛑 Location Sync Stopped';
        document.body.appendChild(t);
        setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},3000);
        return;
    }
    
    var url='TARGET_URL_PLACEHOLDER';
    var t=document.createElement('div');
    t.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;padding:12px 18px;background:#3b82f6;color:#fff;font-weight:bold;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-size:13px;';
    t.innerHTML='📡 Location Sync Active!<br><span style="font-weight:normal;font-size:11px;">Click bookmark again anytime to STOP.</span>';
    document.body.appendChild(t);
    setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},4000);
    
    function showErr(msg) {
        var e=document.createElement('div');
        e.style.cssText='position:fixed;bottom:20px;right:20px;z-index:99999;padding:10px 15px;background:#f97316;color:#fff;font-weight:bold;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-size:12px;';
        e.innerHTML='⚠️ Sync Error: ' + msg;
        document.body.appendChild(e);
        setTimeout(function(){if(e.parentNode)e.parentNode.removeChild(e);},3500);
    }
    
    function s(){
        try {
            var txt = document.body.innerText || '';
            console.log("[Sync] Scanning " + txt.length + " characters of page text...");
            
            // Look for any numbers that look like coordinates
            var tailMatch = txt.match(/(?:tail|reg|registration|callsign|aircraft)[\s:=-]+([A-Z0-9\-]+)/i);
            var tail = tailMatch ? tailMatch[1].toUpperCase() : 'SYNC1';
            
            // More forgiving regex for coordinates: handles degree symbols, N/S/E/W, and raw numbers
            var latMatch = txt.match(/(?:lat|latitude)[\s:=-]*(-?\d+\.\d+)/i) || txt.match(/(-?\d+\.\d+)[\s°]*(?:N|S)/i);
            var lonMatch = txt.match(/(?:lng|lon|longitude)[\s:=-]*(-?\d+\.\d+)/i) || txt.match(/(-?\d+\.\d+)[\s°]*(?:E|W)/i);
            
            var altMatch = txt.match(/(?:alt|altitude)[\s:=-]*(\d+)/i) || [null, 2500];
            var spdMatch = txt.match(/(?:speed|gs|groundspeed)[\s:=-]*(\d+)/i) || [null, 110];
            var hdgMatch = txt.match(/(?:heading|track|hdg)[\s:=-]*(\d+)/i) || [null, 0];
            
            console.log("[Sync] Parsed Data:", { tail: tail, lat: latMatch, lon: lonMatch });
            
            if (latMatch && lonMatch) {
                var lat = parseFloat(latMatch[1]);
                var lon = parseFloat(lonMatch[1]);
                // Handle South/West negatives if parsed from N/S/E/W
                if (latMatch[0].toUpperCase().includes('S')) lat = -Math.abs(lat);
                if (lonMatch[0].toUpperCase().includes('W')) lon = -Math.abs(lon);
                
                fetch(url, {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({
                        tail: tail,
                        lat: lat,
                        lon: lon,
                        alt: parseInt(altMatch[1]),
                        speed: parseInt(spdMatch[1]),
                        heading: parseInt(hdgMatch[1])
                    })
                }).then(r => console.log("[Sync] Push success:", r.status))
                  .catch(e => { console.warn('[Sync] Push error:', e); showErr('Network push failed.'); });
            } else {
                console.warn("[Sync] Could not find Lat/Lon on the page!");
                showErr('Could not find Lat/Lon on the page.');
            }
        } catch(e) {
            console.error("[Sync] Exception:", e);
        }
    }
    s();
    window.extSyncTimer=setInterval(s,5000);
})();`;

// minify code
const minified = code.replace(/\n/g, '').replace(/\s{2,}/g, ' ');
console.log(minified);
