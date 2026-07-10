// KVPZ ADS-B Aircraft Tracker App Logic

// Configurations
const KVPZ_COORDS = [41.4542, -87.0068];
const UPDATE_INTERVAL = 5000; // 5 seconds for aircraft (faster polling)
const WEATHER_INTERVAL = 5 * 60 * 1000; // 5 minutes for weather
const RANGE_RINGS_NM = [5, 15, 30];
const NM_TO_METERS = 1852;

// Safe localStorage wrappers to prevent SecurityError crash on iOS/Safari/Edge Private Browsing
function safeGetItem(key, fallback = null) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (e) {
        console.warn(`localStorage read blocked for key "${key}":`, e);
        return fallback;
    }
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn(`localStorage write blocked for key "${key}":`, e);
    }
}

function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn(`localStorage remove blocked for key "${key}":`, e);
    }
}

// App State
let map;
let airfieldGroup; // Leaflet LayerGroup for KVPZ beacons/rings
let aircraftMarkers = {}; // hex -> L.marker
let aircraftTrails = {}; // hex -> L.polyline
let aircraftCache = {}; // hex -> aircraft state data
let selectedHex = null;
let currentFilter = 'all';
let searchFilter = '';
let operationsLog = [];
let arrivalCount = 0;
let departureCount = 0;
let transitCount = 0;

// Map Toggle States
let showRings = true;
let showLabels = true;
let showTrails = true;
let showLow = true;
let showMed = true;
let showHigh = true;
let rangeRingLayers = []; // Stores range rings and labels

// Initialize the Application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Load map toggles & settings memory from localStorage first
    loadMapSettings();
    
    // Set checkbox inputs to their corresponding state values
    document.getElementById('toggle-rings').checked = showRings;
    document.getElementById('toggle-labels').checked = showLabels;
    document.getElementById('toggle-trails').checked = showTrails;
    document.getElementById('toggle-low').checked = showLow;
    document.getElementById('toggle-med').checked = showMed;
    document.getElementById('toggle-high').checked = showHigh;
    
    // Sync initial plane labels display state
    const mapContainer = document.getElementById('map-panel-container');
    if (showLabels) {
        mapContainer.classList.remove('hide-plane-labels');
    } else {
        mapContainer.classList.add('hide-plane-labels');
    }
    
    initClock();
    initMap();
    
    // Load KVPZ operations log memory from localStorage & clean up 1-month-old logs
    loadOperationsLogMemory();
    updateOpsLog();
    updateCounters();
    
    fetchWeather();
    fetchAircraftData();
    
    // Set up polling intervals
    setInterval(fetchAircraftData, UPDATE_INTERVAL);
    setInterval(fetchWeather, WEATHER_INTERVAL);
    
    // Set up UI Event Listeners
    document.getElementById('flight-search').addEventListener('input', handleSearch);
    
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.getAttribute('data-filter');
            updateUI();
        });
    });
    
    document.getElementById('btn-clear-logs').addEventListener('click', () => {
        operationsLog = [];
        safeRemoveItem('kvpz_operations_log');
        arrivalCount = 0;
        departureCount = 0;
        updateOpsLog();
        updateCounters();
    });

    // Map Controls Event Listeners
    document.getElementById('toggle-rings').addEventListener('change', (e) => {
        showRings = e.target.checked;
        saveMapSettings();
        if (showRings) {
            map.addLayer(airfieldGroup);
        } else {
            map.removeLayer(airfieldGroup);
        }
    });
    
    document.getElementById('toggle-labels').addEventListener('change', (e) => {
        showLabels = e.target.checked;
        saveMapSettings();
        const mapContainer = document.getElementById('map-panel-container');
        if (showLabels) {
            mapContainer.classList.remove('hide-plane-labels');
        } else {
            mapContainer.classList.add('hide-plane-labels');
        }
    });
    
    document.getElementById('toggle-trails').addEventListener('change', (e) => {
        showTrails = e.target.checked;
        saveMapSettings();
        // Redraw all markers to toggle active trails
        Object.keys(aircraftMarkers).forEach(hex => {
            const ac = aircraftCache[hex];
            if (ac) updateMapMarker(ac);
        });
    });
    
    document.getElementById('toggle-low').addEventListener('change', (e) => {
        showLow = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });
    
    document.getElementById('toggle-med').addEventListener('change', (e) => {
        showMed = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });
    
    document.getElementById('toggle-high').addEventListener('change', (e) => {
        showHigh = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });
});

function refreshAllAircraftLayers() {
    // Clear and redraw all markers based on new altitude toggles
    Object.keys(aircraftCache).forEach(hex => {
        removeAircraftLayers(hex);
        const ac = aircraftCache[hex];
        // Only redraw if altitude filter matches
        if (ac && ac.lat && ac.lon && isAltitudeVisible(ac.alt)) {
            updateMapMarker(ac);
        }
    });
    updateUI();
}

function isAltitudeVisible(alt) {
    if (alt < 3000) return showLow;
    if (alt < 12000) return showMed;
    return showHigh;
}

// airfieldGroup visibility synced directly via listener

// 1. Header Clock Utility
function initClock() {
    const clockElement = document.getElementById('local-clock');
    const updateTime = () => {
        const now = new Date();
        clockElement.textContent = now.toLocaleTimeString([], { hour12: false });
    };
    updateTime();
    setInterval(updateTime, 1000);
}

// 2. Map Initialization
function initMap() {
    // 1. Create Tile Layers
    const darkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
    });
    
    const voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    const satellite = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles courtesy of the U.S. Geological Survey',
        maxZoom: 16
    });

    // 2. Define Layer Controls (Base & Overlays)
    const baseMaps = {
        "Dark Matter (Radar)": darkMatter,
        "OpenStreetMap (Light)": osm,
        "Voyager (Vector)": voyager,
        "USGS Satellite": satellite
    };

    // Retrieve saved base layer from memory (default to Dark Matter)
    const savedBaseLayerName = safeGetItem('kvpz_map_base_layer', "Dark Matter (Radar)");
    const initialBaseLayer = baseMaps[savedBaseLayerName] || darkMatter;

    // Center map around KVPZ, adding selected base layer
    map = L.map('map', {
        center: KVPZ_COORDS,
        zoom: 10,
        layers: [initialBaseLayer],
        zoomControl: true
    });
    
    // Create layer group for KVPZ reference elements (rings/beacons)
    airfieldGroup = L.layerGroup();
    if (showRings) {
        airfieldGroup.addTo(map);
    }

    // Custom Glow Style for KVPZ Airport Marker
    const kvpzIcon = L.divIcon({
        className: 'airport-beacon-container',
        html: `
            <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                <div style="position: absolute; width: 20px; height: 20px; border-radius: 50%; background-color: #06b6d4; opacity: 0.2; animation: beacon-pulse 2s infinite ease-out;"></div>
                <div style="position: absolute; width: 8px; height: 8px; border-radius: 50%; background-color: #06b6d4; border: 2px solid #fff; box-shadow: 0 0 8px #06b6d4;"></div>
            </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });
    
    const airportMarker = L.marker(KVPZ_COORDS, { icon: kvpzIcon }).addTo(airfieldGroup);
    airportMarker.bindTooltip("KVPZ Airport (Valparaiso)", {
        permanent: false,
        direction: 'top',
        className: 'airport-tooltip'
    });
    
    // Add Range Rings to airfieldGroup and rangeRingLayers
    RANGE_RINGS_NM.forEach(nm => {
        const radiusMeters = nm * NM_TO_METERS;
        const ring = L.circle(KVPZ_COORDS, {
            radius: radiusMeters,
            color: '#4b5563',
            weight: 1,
            opacity: 0.4,
            dashArray: '4, 8',
            fillColor: 'transparent',
            interactive: false
        }).addTo(airfieldGroup);
        rangeRingLayers.push(ring);
        
        // Add label near the ring boundary (East of airport)
        const labelCoords = calculateOffsetCoords(KVPZ_COORDS[0], KVPZ_COORDS[1], radiusMeters, 90);
        const label = L.marker(labelCoords, {
            icon: L.divIcon({
                className: 'ring-label',
                html: `<div style="color: #6b7280; font-size: 0.65rem; font-family: var(--font-mono); white-space: nowrap;">${nm} NM</div>`,
                iconSize: [40, 15],
                iconAnchor: [0, 7]
            })
        }).addTo(airfieldGroup);
        rangeRingLayers.push(label);
    });

    const overlayMaps = {
        "KVPZ Range Rings & Beacon": airfieldGroup
    };
    
    L.control.layers(baseMaps, overlayMaps, { collapsed: false }).addTo(map);

    // 3. Sync events to save configuration selections to localStorage
    map.on('baselayerchange', (e) => {
        safeSetItem('kvpz_map_base_layer', e.name);
    });

    map.on('overlayadd', (e) => {
        if (e.name === "KVPZ Range Rings & Beacon") {
            showRings = true;
            document.getElementById('toggle-rings').checked = true;
            saveMapSettings();
        }
    });

    map.on('overlayremove', (e) => {
        if (e.name === "KVPZ Range Rings & Beacon") {
            showRings = false;
            document.getElementById('toggle-rings').checked = false;
            saveMapSettings();
        }
    });

    // 4. Listen to map movement/zoom to dynamically fetch flight data
    map.on('moveend', () => {
        fetchAircraftData();
    });
}

// Coordinate calculation utility
function calculateOffsetCoords(lat, lon, distanceMeters, bearingDegrees) {
    const R = 6378137; // Earth Radius in meters
    const d = distanceMeters;
    const brng = bearingDegrees * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d / R) + Math.cos(lat1) * Math.sin(d / R) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d / R) * Math.cos(lat1), Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2));
    
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

// 3. METAR Weather Handling
async function fetchWeather() {
    const weatherText = document.getElementById('weather-raw-text');
    const weatherCat = document.getElementById('weather-flight-cat');
    const wWind = document.getElementById('weather-wind');
    const wVis = document.getElementById('weather-vis');
    const wTemp = document.getElementById('weather-temp');
    const wAltim = document.getElementById('weather-altim');
    
    try {
        const response = await fetch('https://api.weather.gov/stations/KVPZ/observations/latest');
        if (!response.ok) throw new Error('Weather API returned status ' + response.status);
        
        const data = await response.json();
        if (!data || !data.properties) {
            weatherText.textContent = "Weather report temporarily unavailable.";
            return;
        }
        
        const props = data.properties;
        
        // 1. Wind Parsing
        let windDirText = 'VRB';
        if (props.windDirection && props.windDirection.value !== null) {
            windDirText = String(Math.round(props.windDirection.value)).padStart(3, '0') + '°';
        }
        
        let windSpeedKnots = 0;
        if (props.windSpeed && props.windSpeed.value !== null) {
            // Convert km/h to KT
            windSpeedKnots = Math.round(props.windSpeed.value * 0.539957);
        }
        
        let gustText = '';
        if (props.windGust && props.windGust.value !== null) {
            gustText = ' G ' + Math.round(props.windGust.value * 0.539957) + ' KT';
        }
        
        const windString = (windDirText === '000°' && windSpeedKnots === 0) ? 'Calm' : `${windDirText} @ ${windSpeedKnots} KT${gustText}`;
        wWind.textContent = windString;
        
        // 2. Visibility Parsing
        let visSM = 10;
        if (props.visibility && props.visibility.value !== null) {
            // Convert meters to SM
            visSM = props.visibility.value / 1609.344;
            wVis.textContent = visSM.toFixed(1) + ' SM';
        } else {
            wVis.textContent = '---';
        }
        
        // 3. Temp / Dew Point
        const tempC = props.temperature && props.temperature.value !== null ? props.temperature.value.toFixed(1) + '°C' : '--';
        const dewC = props.dewpoint && props.dewpoint.value !== null ? props.dewpoint.value.toFixed(1) + '°C' : '--';
        wTemp.textContent = `${tempC} / ${dewC}`;
        
        // 4. Altimeter (converting Pa to inHg)
        let altimInHg = 29.92;
        if (props.barometricPressure && props.barometricPressure.value !== null) {
            altimInHg = props.barometricPressure.value * 0.0002953;
            wAltim.textContent = altimInHg.toFixed(2) + ' inHg';
        } else {
            wAltim.textContent = '---';
        }
        
        // 5. Cloud layers / Ceiling -> Calculate Flight Category
        let ceilingFt = Infinity;
        if (props.cloudLayers && Array.isArray(props.cloudLayers)) {
            props.cloudLayers.forEach(layer => {
                const amt = layer.amount;
                if ((amt === 'BKN' || amt === 'OVC') && layer.base && layer.base.value !== null) {
                    const baseFt = layer.base.value * 3.28084;
                    if (baseFt < ceilingFt) {
                        ceilingFt = baseFt;
                    }
                }
            });
        }
        
        let flightCat = 'VFR';
        if (ceilingFt < 500 || visSM < 1) {
            flightCat = 'LIFR';
        } else if (ceilingFt < 1000 || visSM < 3) {
            flightCat = 'IFR';
        } else if (ceilingFt <= 3000 || visSM <= 5) {
            flightCat = 'MVFR';
        }
        
        weatherCat.textContent = flightCat;
        weatherCat.className = `badge ${flightCat.toLowerCase()}`;
        
        // 6. Raw Weather Message or Generated Description
        if (props.rawMessage) {
            weatherText.textContent = props.rawMessage;
        } else {
            const timeStr = new Date(props.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            weatherText.textContent = `METAR KVPZ ${timeStr}Z: Wind ${windString}, Vis ${visSM.toFixed(1)} SM, Sky ${props.textDescription || 'Clear'}, Temp ${tempC}/${dewC}, Altimeter ${altimInHg.toFixed(2)} inHg.`;
        }
        
    } catch (error) {
        console.error("Error loading weather:", error);
        weatherText.textContent = "Failed to load live weather reports.";
    }
}

// 4. Fetch Aircraft Data (Dual Feed Redundancy)
async function fetchAircraftData() {
    if (!map) return;
    const statusText = document.getElementById('feed-status-text');
    const pulseIndicator = document.getElementById('pulse-indicator');
    
    try {
        // Get current map center and radius matching screen width
        const center = map.getCenter();
        const ne = map.getBounds().getNorthEast();
        const radiusMeters = center.distanceTo(ne);
        // Convert meters to nautical miles and cap between 5 and 250 NM
        const radiusNM = Math.min(250, Math.max(5, Math.ceil(radiusMeters / 1852)));
        
        const latStr = center.lat.toFixed(4);
        const lonStr = center.lng.toFixed(4);
        
        const urlAirplanesLive = `https://api.airplanes.live/v2/point/${latStr}/${lonStr}/${radiusNM}`;
        const urlAdsbOne = `https://api.adsb.one/v2/point/${latStr}/${lonStr}/${radiusNM}`;
        
        // Fetch from both sources in parallel
        const results = await Promise.allSettled([
            fetch(urlAirplanesLive).then(r => { if (!r.ok) throw r; return r.json(); }),
            fetch(urlAdsbOne).then(r => { if (!r.ok) throw r; return r.json(); })
        ]);
        
        let mergedAircraft = {};
        let successCount = 0;
        
        results.forEach((res, index) => {
            if (res.status === 'fulfilled' && res.value && Array.isArray(res.value.ac)) {
                successCount++;
                res.value.ac.forEach(ac => {
                    if (ac.hex) {
                        // Merge by hex. Keep the one with callsign or coords if conflicting
                        const existing = mergedAircraft[ac.hex];
                        if (!existing || (!existing.flight && ac.flight) || (!existing.lat && ac.lat)) {
                            mergedAircraft[ac.hex] = ac;
                        }
                    }
                });
            } else {
                console.warn(`Feed ${index === 0 ? 'Airplanes.live' : 'ADSB.one'} failed:`, res.reason);
            }
        });
        
        if (successCount === 0) {
            throw new Error('All redundant tracking feeds failed.');
        }
        
        const mergedList = Object.values(mergedAircraft);
        
        pulseIndicator.className = "pulse-indicator status-live";
        const sourcesText = successCount === 2 ? "Dual Feeds Active" : (results[0].status === 'fulfilled' ? "Airplanes.live Active" : "ADSB.one Active");
        statusText.textContent = `${sourcesText} (${radiusNM} NM Coverage) &bull; Updated ${new Date().toLocaleTimeString([], {hour12:false})}`;
        
        processAircraft(mergedList);
        
    } catch (error) {
        console.error("Error loading ADS-B data:", error);
        pulseIndicator.className = "pulse-indicator status-error";
        statusText.textContent = "Live Feeds offline - Retrying...";
    }
}

// 5. Operations Detection & State Engine
function processAircraft(aircraftList) {
    const activeHexes = new Set();
    const now = new Date();
    
    // Sort feed entries by distance
    aircraftList.forEach(ac => {
        const hex = ac.hex;
        if (!hex) return;
        
        activeHexes.add(hex);
        
        // Parse fields
        const callsign = (ac.flight || ac.r || 'N/A').trim();
        const tail = ac.r || 'N/A';
        const type = ac.t || 'N/A';
        const desc = ac.desc || 'N/A';
        const alt = ac.alt_baro === 'ground' ? 0 : (parseInt(ac.alt_baro) || 0);
        const speed = parseInt(ac.gs) || 0;
        const vspeed = parseInt(ac.baro_rate) || 0;
        const heading = parseInt(ac.track) || 0;
        const dist = parseFloat(ac.dst) || 0;
        const operator = ac.ownOp || 'Private';
        const lat = ac.lat;
        const lon = ac.lon;
        const category = ac.category || '';
        
        const currentState = {
            hex, callsign, tail, type, desc, alt, speed, vspeed, heading, dist, operator, lat, lon, category,
            lastSeen: now
        };
        
        // Operations State Logic (Check KVPZ-exclusive transitions from cache)
        const prevState = aircraftCache[hex];
        
        if (prevState) {
            // Existing aircraft: update logs & stats
            currentState.trail = prevState.trail ? [...prevState.trail, [lat, lon]].slice(-30) : [[lat, lon]];
            
            // 1. KVPZ INBOUND TRAJECTORY TRIGGER
            // Must be within 5 miles, below 2500 ft, descending, and distance to KVPZ is decreasing (heading towards it)
            const isDescending = vspeed < -100 || alt < prevState.alt;
            const isHeadingTowardsKVPZ = dist < prevState.dist;
            
            if (dist < 5.0 && alt < 2500 && isDescending && isHeadingTowardsKVPZ) {
                currentState.opType = 'arrival';
            } else if (prevState.opType) {
                currentState.opType = prevState.opType; // Keep state
            } else {
                currentState.opType = 'transit';
            }
            
            // Check for active landing roll (within 2.5 miles of runway, low altitude, and ground speed/vspeed drop)
            if (currentState.opType === 'arrival' && dist < 2.5 && alt < 1200 && (speed < 45 || vspeed < -300) && !prevState.logged && !currentState.logged) {
                logOperation(callsign, type, 'arrival', `Landed KVPZ (Speed: ${speed} KT, Alt: ${alt} FT)`);
                currentState.logged = true;
            }
            
            // 2. KVPZ DEPARTURE TRIGGER (Ground to Air takeoff transition)
            if (prevState.dist < 2.5 && prevState.alt < 1500 && vspeed > 200 && !prevState.logged && !currentState.logged) {
                logOperation(callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`);
                currentState.logged = true;
                currentState.opType = 'departure';
            }
            
            if (prevState.logged) {
                currentState.logged = prevState.logged;
            }
            if (prevState.opType === 'departure') {
                currentState.opType = 'departure';
            }
        } else {
            // New aircraft appearing
            currentState.trail = [[lat, lon]];
            
            // KVPZ DEPARTURE TRIGGER (First appearing from KVPZ)
            // Option 1 Optimized: First appear close (< 5.0 NM) and at low altitude (< 3000 ft) while climbing (> 100 FPM)
            if (dist < 5.0 && alt < 3000 && vspeed > 100) {
                logOperation(callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`);
                currentState.logged = true;
                currentState.opType = 'departure';
            } else {
                currentState.opType = 'transit';
            }
        }
        
        // 3. KVPZ GEOFENCE TRIGGER (Any aircraft under 1200 ft within 1 mile of KVPZ)
        if (dist < 1.0 && alt < 1200 && !currentState.logged) {
            let direction = null;
            if (prevState) {
                // Outbound if distance is increasing (moving away from airfield)
                const isOutbound = dist > prevState.dist;
                direction = isOutbound ? 'departure' : 'arrival';
            } else {
                // First appearance inside the tight 1-mile geofence: classify as departure
                direction = 'departure';
            }
            
            currentState.logged = true;
            currentState.opType = direction;
            if (direction === 'arrival') {
                logOperation(callsign, type, 'arrival', `Geofence Landing KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`);
            } else {
                logOperation(callsign, type, 'departure', `Geofence Departure KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`);
            }
        }
        
        aircraftCache[hex] = currentState;
    });
    
    // Check for landing triggers: aircraft that were previously in 'arrival' state but are now missing
    // or disappeared from the feed while close to KVPZ (covers low-altitude radar dropoffs)
    Object.keys(aircraftCache).forEach(hex => {
        if (!activeHexes.has(hex)) {
            const lastState = aircraftCache[hex];
            const timeSinceLastSeen = now - lastState.lastSeen;
            
            // Disappeared and met landing criteria (Option 1 / Last-Seen Filter):
            const isTargetedArrival = lastState.opType === 'arrival' && lastState.dist < 6.0 && lastState.alt < 2500;
            const isAnyDisappearingClose = lastState.dist < 5.0; // Any aircraft last seen within 5 NM
            
            if (timeSinceLastSeen < 45000 && (isTargetedArrival || isAnyDisappearingClose) && !lastState.logged) {
                logOperation(lastState.callsign, lastState.type, 'arrival', `Landed KVPZ (Last seen ${lastState.dist.toFixed(1)} NM out, ${lastState.alt} FT)`);
                lastState.logged = true;
            }
            
            // Clean up old cache entries (older than 2 minutes to allow for brief signal drops)
            if (timeSinceLastSeen > 120000) {
                removeAircraftLayers(hex);
                delete aircraftCache[hex];
            }
        }
    });
    
    // Remove markers of flights that disappeared
    Object.keys(aircraftMarkers).forEach(hex => {
        if (!activeHexes.has(hex)) {
            removeAircraftLayers(hex);
        }
    });
    
    // Redraw markers
    activeHexes.forEach(hex => {
        const ac = aircraftCache[hex];
        // Only draw if inside visible map bounds and matches altitude checkbox settings
        if (ac.lat && ac.lon) {
            const inBounds = map.getBounds().contains([ac.lat, ac.lon]);
            if (inBounds && isAltitudeVisible(ac.alt)) {
                updateMapMarker(ac);
            } else {
                removeAircraftLayers(hex);
            }
        }
    });
    
    // Update dashboard elements
    updateCounters();
    updateUI();
}

function removeAircraftLayers(hex) {
    if (aircraftMarkers[hex]) {
        map.removeLayer(aircraftMarkers[hex]);
        delete aircraftMarkers[hex];
    }
    if (aircraftTrails[hex]) {
        map.removeLayer(aircraftTrails[hex]);
        delete aircraftTrails[hex];
    }
}

// Get Icon Class based on Aircraft details
function getAircraftIconClass(ac) {
    const desc = (ac.desc || '').toLowerCase();
    const type = (ac.type || '').toLowerCase();
    const cat = (ac.category || '');
    
    // Helicopters
    if (desc.includes('helicopter') || desc.includes('rotorcraft') || desc.includes('copter') || type.includes('h60') || type.includes('ec35') || cat === 'A7') {
        return 'helicopter';
    }
    // Jets
    if (desc.includes('jet') || desc.includes('boeing') || desc.includes('airbus') || desc.includes('embraer') || desc.includes('bombardier') || desc.includes('gulfstream') || desc.includes('citation') || desc.includes('challenger') || desc.includes('falcon') || desc.includes('learjet')) {
        return 'jet';
    }
    // Default general/prop plane
    return 'prop';
}

// 6. Map Marker Graphics & Rotation
function updateMapMarker(ac) {
    // Choose color based on altitude
    let color = '#a855f7'; // Purple (High >12k)
    if (ac.alt < 3000) {
        color = '#10b981'; // Green (Low <3k)
    } else if (ac.alt < 12000) {
        color = '#f59e0b'; // Amber (Med 3k-12k)
    }
    
    // Determine aircraft type icon
    const iconType = getAircraftIconClass(ac);
    let iconHtml = '';
    
    if (iconType === 'helicopter') {
        // Redesigned top-down heavy-lift helicopter (matching reference shape)
        const bodyPath = `
            M 256,160 
            C 236,160 220,175 220,205 
            C 220,205 185,215 185,230
            C 185,245 220,255 220,255
            L 220,290 
            C 220,315 242,330 244,360 
            L 248,440 
            L 242,445
            L 242,455
            L 270,455
            L 270,445
            L 264,440
            L 268,360
            C 270,330 292,315 292,290
            L 292,255
            C 292,255 327,245 327,230
            C 327,215 292,205 292,205
            C 292,175 276,160 256,160 Z
        `;
        const tailRotor = `
            <g transform="translate(272, 448)">
                <rect x="-3" y="-20" width="6" height="40" fill="${color}" stroke="#090d16" stroke-width="2" transform="rotate(30)" />
                <rect x="-3" y="-20" width="6" height="40" fill="${color}" stroke="#090d16" stroke-width="2" transform="rotate(120)" />
                <circle cx="0" cy="0" r="5" fill="#fff" stroke="#090d16" stroke-width="2" />
            </g>
        `;
        iconHtml = `
            <svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <!-- Nose Probe -->
                <line x1="256" y1="160" x2="256" y2="105" stroke="${color}" stroke-width="6" stroke-linecap="round" />
                
                <!-- Fuselage / Tail Boom / Sponsons -->
                <path d="${bodyPath}" fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" />
                
                <!-- Windshield Glass -->
                <path d="M 256,170 C 242,170 234,185 234,200 C 234,215 256,225 256,225 C 256,225 278,215 278,200 C 278,185 270,170 256,170 Z" fill="#090d16" opacity="0.75" />
                
                <!-- Tail Rotor -->
                ${tailRotor}
                
                <!-- Main Rotor Hub -->
                <circle cx="256" cy="256" r="28" fill="#fff" stroke="#090d16" stroke-width="8" />
                
                <!-- Main Rotor Blades (6 blades rotated in star pattern) -->
                ${[0, 60, 120, 180, 240, 300].map(angle => `
                    <rect x="246" y="30" width="20" height="226" rx="8" fill="${color}" stroke="#090d16" stroke-width="5" transform="rotate(${angle + 20}, 256, 256)" />
                `).join('')}
                
                <!-- Center Cap -->
                <circle cx="256" cy="256" r="14" fill="${color}" stroke="#090d16" stroke-width="4" />
            </svg>
        `;
    } else if (iconType === 'jet') {
        // High fidelity geometric top-down jet SVG
        iconHtml = `
            <svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="15" d="M256 16c-11.05 0-20 8.95-20 20v140L48 272v44l188-56v112l-48 36v28l80-24 80 24v-28l-48-36V260l188 56v-44L276 176V36c0-11.05-8.95-20-20-20z"/>
            </svg>
        `;
    } else {
        // High fidelity geometric top-down prop plane SVG
        iconHtml = `
            <svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="15" d="M448 336v-40L288 192V79.2c0-26-21.8-47.2-48-47.2S192 53.2 192 79.2V192L32 296v40l160-48v117.8l-48 35.4v30.8l96-28.6 96 28.6v-30.8l-48-35.4V328l160 48z"/>
            </svg>
        `;
    }
    
    // Custom DivIcon containing SVG plane icon and label
    const customIcon = L.divIcon({
        className: 'custom-plane-icon',
        html: `
            <div class="plane-marker-container">
                ${iconHtml}
                <div class="plane-label" style="border-color: ${color};">${ac.callsign}</div>
            </div>
        `,
        iconSize: [60, 45],
        iconAnchor: [30, 14]
    });
    
    if (aircraftMarkers[ac.hex]) {
        // Update existing marker position & rotation
        aircraftMarkers[ac.hex].setLatLng([ac.lat, ac.lon]);
        aircraftMarkers[ac.hex].setIcon(customIcon);
    } else {
        // Create new marker
        const marker = L.marker([ac.lat, ac.lon], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
            selectAircraft(ac.hex);
        });
        aircraftMarkers[ac.hex] = marker;
    }
    
    // Draw trail breadcrumbs if this aircraft is selected and trails are toggled ON
    if (selectedHex === ac.hex && showTrails) {
        if (aircraftTrails[ac.hex]) {
            aircraftTrails[ac.hex].setLatLngs(ac.trail);
        } else {
            aircraftTrails[ac.hex] = L.polyline(ac.trail, {
                color: color,
                weight: 2,
                opacity: 0.7,
                dashArray: '5, 5'
            }).addTo(map);
        }
    } else {
        // Remove trail for non-selected aircraft or if trails are toggled OFF
        if (aircraftTrails[ac.hex]) {
            map.removeLayer(aircraftTrails[ac.hex]);
            delete aircraftTrails[ac.hex];
        }
    }
}

// 7. Operations Logger
function logOperation(callsign, type, opType, description) {
    const now = new Date();
    const logItem = {
        timestamp: now.getTime(), // Miliseconds for 30-day age filtering
        dateStr: now.toLocaleDateString(),
        timeStr: now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        callsign,
        type,
        opType,
        description
    };
    
    operationsLog.unshift(logItem); // Add to beginning of array
    
    // Prune entries older than 30 days (1 month), keeping legacy entries that have no timestamp
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    operationsLog = operationsLog.filter(log => !log || log.timestamp === undefined || log.timestamp >= oneMonthAgo);
    
    // Save to localStorage
    safeSetItem('kvpz_operations_log', JSON.stringify(operationsLog));
    
    // Recalculate counters
    arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
    departureCount = operationsLog.filter(log => log.opType === 'departure').length;
    
    updateOpsLog();
    updateCounters();
}

function updateOpsLog() {
    const logList = document.getElementById('ops-log-list');
    logList.innerHTML = '';
    
    if (operationsLog.length === 0) {
        logList.innerHTML = '<li class="empty-log">Listening for KVPZ arrivals and departures...</li>';
        return;
    }
    
    operationsLog.forEach(log => {
        const item = document.createElement('li');
        item.className = `ops-item ${log.opType}`;
        
        const details = document.createElement('div');
        details.className = 'ops-details';
        
        const header = document.createElement('span');
        header.className = 'ops-callsign';
        header.innerHTML = `<i class="fa-solid ${log.opType === 'arrival' ? 'fa-plane-arrival' : 'fa-plane-departure'}"></i> ${log.callsign} <span style="font-weight: normal; font-size: 0.75rem; color: var(--color-text-muted);">(${log.type})</span>`;
        
        const desc = document.createElement('span');
        desc.className = 'ops-desc';
        desc.textContent = log.description;
        
        details.appendChild(header);
        details.appendChild(desc);
        
        const time = document.createElement('span');
        time.className = 'ops-time';
        // Show Date and Time since logs persist across multiple days; fallback to legacy 'time' field if needed
        const dateText = log.dateStr || '';
        const timeText = log.timeStr || log.time || '---';
        time.textContent = dateText ? `${dateText} ${timeText}` : timeText;
        
        item.appendChild(details);
        item.appendChild(time);
        
        logList.appendChild(item);
    });
}

// 7b. Persistent Memory Operations Loader
function loadOperationsLogMemory() {
    try {
        const stored = safeGetItem('kvpz_operations_log');
        if (stored) {
            const allLogs = JSON.parse(stored);
            const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            
            // Filter out logs older than 30 days, preserving legacy logs with undefined timestamps
            operationsLog = allLogs.filter(log => !log || log.timestamp === undefined || log.timestamp >= oneMonthAgo);
            
            // Re-save pruned list
            safeSetItem('kvpz_operations_log', JSON.stringify(operationsLog));
            
            // Calculate persistent counters
            arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
            departureCount = operationsLog.filter(log => log.opType === 'departure').length;
        } else {
            operationsLog = [];
            arrivalCount = 0;
            departureCount = 0;
        }
    } catch (e) {
        console.error("Error loading operations log memory:", e);
        operationsLog = [];
        arrivalCount = 0;
        departureCount = 0;
    }
}

// Update Header Stats counters
function updateCounters() {
    // Total count currently tracked
    document.getElementById('count-total').textContent = Object.keys(aircraftMarkers).length;
    document.getElementById('count-arrivals').textContent = arrivalCount;
    document.getElementById('count-departures').textContent = departureCount;
    
    // Count overflights / transits currently on screen
    let overflights = 0;
    Object.keys(aircraftCache).forEach(hex => {
        if (aircraftCache[hex].alt >= 12000) {
            overflights++;
        }
    });
    document.getElementById('count-overflights').textContent = overflights;
}

// 8. Flight List spreadsheet & filtering
function updateUI() {
    const tbody = document.getElementById('flight-table-body');
    tbody.innerHTML = '';
    
    // Filter aircraft cache
    const filteredAircraft = Object.values(aircraftCache).filter(ac => {
        // Filter out flights that are not currently in the visible map bounds
        if (!ac.lat || !ac.lon || !map || !map.getBounds().contains([ac.lat, ac.lon])) {
            return false;
        }

        // Search Filter
        const query = searchFilter.toLowerCase();
        const matchesSearch = ac.callsign.toLowerCase().includes(query) ||
                              ac.tail.toLowerCase().includes(query) ||
                              ac.hex.toLowerCase().includes(query) ||
                              ac.type.toLowerCase().includes(query) ||
                              ac.operator.toLowerCase().includes(query) ||
                              ac.desc.toLowerCase().includes(query);
                              
        if (!matchesSearch) return false;
        
        // Category Filter
        if (currentFilter === 'low') {
            return ac.alt < 3000;
        } else if (currentFilter === 'inbound') {
            return ac.opType === 'arrival';
        } else if (currentFilter === 'outbound') {
            return ac.opType === 'departure';
        }
        
        return true;
    });
    
    // Sort by distance ascending
    filteredAircraft.sort((a, b) => a.dist - b.dist);
    
    if (filteredAircraft.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="loading-row">No active aircraft match criteria.</td></tr>';
        return;
    }
    
    filteredAircraft.forEach(ac => {
        const tr = document.createElement('tr');
        if (selectedHex === ac.hex) tr.className = 'selected';
        
        tr.addEventListener('click', () => {
            selectAircraft(ac.hex);
        });
        
        const vspeedText = ac.vspeed > 0 ? `+${ac.vspeed}` : ac.vspeed;
        
        tr.innerHTML = `
            <td><strong>${ac.callsign}</strong></td>
            <td>${ac.tail}</td>
            <td>${ac.hex.toUpperCase()}</td>
            <td>${ac.type}</td>
            <td>${ac.desc}</td>
            <td>${ac.alt.toLocaleString()} FT</td>
            <td>${ac.speed} KT</td>
            <td style="color: ${ac.vspeed > 0 ? '#10b981' : (ac.vspeed < 0 ? '#ef4444' : '#fff')};">${vspeedText} FPM</td>
            <td>${ac.heading}°</td>
            <td>${ac.dist.toFixed(1)} NM</td>
            <td>${ac.operator}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function selectAircraft(hex) {
    if (selectedHex === hex) {
        // Unselect
        selectedHex = null;
    } else {
        selectedHex = hex;
        // Pan map to aircraft
        const ac = aircraftCache[hex];
        if (ac && ac.lat && ac.lon) {
            map.panTo([ac.lat, ac.lon]);
        }
    }
    
    // Update map overlays
    Object.keys(aircraftMarkers).forEach(h => {
        const ac = aircraftCache[h];
        if (ac) updateMapMarker(ac);
    });
    
    updateUI();
}

function handleSearch(e) {
    searchFilter = e.target.value;
    updateUI();
}

// 9. Map Configurations Storage Utilities
function loadMapSettings() {
    try {
        const stored = safeGetItem('kvpz_map_settings');
        if (stored) {
            const settings = JSON.parse(stored);
            showRings = settings.showRings !== undefined ? settings.showRings : true;
            showLabels = settings.showLabels !== undefined ? settings.showLabels : true;
            showTrails = settings.showTrails !== undefined ? settings.showTrails : true;
            showLow = settings.showLow !== undefined ? settings.showLow : true;
            showMed = settings.showMed !== undefined ? settings.showMed : true;
            showHigh = settings.showHigh !== undefined ? settings.showHigh : true;
        }
    } catch (e) {
        console.error("Error loading map settings from localStorage:", e);
    }
}

function saveMapSettings() {
    try {
        const settings = { showRings, showLabels, showTrails, showLow, showMed, showHigh };
        safeSetItem('kvpz_map_settings', JSON.stringify(settings));
    } catch (e) {
        console.error("Error saving map settings to localStorage:", e);
    }
}

