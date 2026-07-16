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
let aircraftInfoDb = {}; // hex -> persistent cached aircraft info (Type, Operator, etc.)
let selectedHex = null;
let currentFilter = 'all';
let searchFilter = '';
let operationsLog = [];
let powerlineGroup = null;
let lastBboxStr = "";
let arrivalCount = 0;
let departureCount = 0;
let transitCount = 0;

// Map Toggle States
let showRings = true;
let showLabels = true;
let showTrails = true;
let showPowerlines = true;
let showLow = true;
let showMed = true;
let showHigh = true;
let showCommJet = true;
let showAirplane = true;
let showBizJet = true;
let showHelo = true;
let showMil = true;
let showOther = true;
let controlsCollapsed = false;
let rangeRingLayers = []; // Stores range rings and labels

// Map Base Tile Layers & State
let baseTileLayers = {};
let darkMatter, osm, voyager, satellite;

// Initialize the Application
document.addEventListener('DOMContentLoaded', () => {
    // 1. Load map toggles, settings, and aircraft cache from localStorage first
    loadMapSettings();
    loadAircraftDb();
    
    // Set checkbox inputs to their corresponding state values
    document.getElementById('toggle-rings').checked = showRings;
    document.getElementById('toggle-labels').checked = showLabels;
    document.getElementById('toggle-trails').checked = showTrails;
    document.getElementById('toggle-powerlines').checked = showPowerlines;
    document.getElementById('toggle-low').checked = showLow;
    document.getElementById('toggle-med').checked = showMed;
    document.getElementById('toggle-high').checked = showHigh;
    document.getElementById('filter-comm-jet').checked = showCommJet;
    document.getElementById('filter-airplane').checked = showAirplane;
    document.getElementById('filter-biz-jet').checked = showBizJet;
    document.getElementById('filter-helo').checked = showHelo;
    document.getElementById('filter-mil').checked = showMil;
    document.getElementById('filter-other').checked = showOther;
    
    // Set initial active map style tab
    const savedStyle = safeGetItem('kvpz_map_base_layer', 'light');
    document.querySelectorAll('.map-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-map') === savedStyle) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
        
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.map-tab-btn').forEach(b => b.classList.remove('active'));
            const targetBtn = e.currentTarget;
            targetBtn.classList.add('active');
            
            const mapStyle = targetBtn.getAttribute('data-map');
            setBaseLayer(mapStyle);
            
            document.getElementById('map-settings-container').classList.remove('open');
        });
    });
    
    // Map Settings Dropdown Toggle Listener
    document.getElementById('settings-toggle-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('map-settings-container').classList.toggle('open');
    });
    
    // Click outside to close dropdown
    document.addEventListener('click', (e) => {
        const container = document.getElementById('map-settings-container');
        if (container && !container.contains(e.target)) {
            container.classList.remove('open');
        }
    });
    
    // Sync initial plane labels display state
    const mapContainer = document.getElementById('map-panel-container');
    if (showLabels) {
        mapContainer.classList.remove('hide-plane-labels');
    } else {
        mapContainer.classList.add('hide-plane-labels');
    }
    
    // Set initial collapsible state of map controls
    const controlsPanel = document.getElementById('map-controls-panel');
    if (controlsPanel && controlsCollapsed) {
        controlsPanel.classList.add('collapsed');
    }
    
    // Collapsible Menu Event Listener (click header to collapse/expand)
    document.getElementById('controls-header').addEventListener('click', () => {
        controlsCollapsed = !controlsCollapsed;
        controlsPanel.classList.toggle('collapsed', controlsCollapsed);
        saveMapSettings();
    });
    
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
    
    document.getElementById('toggle-powerlines').addEventListener('change', (e) => {
        showPowerlines = e.target.checked;
        saveMapSettings();
        if (showPowerlines) {
            updatePowerlines();
        } else {
            if (powerlineGroup) {
                powerlineGroup.clearLayers();
            }
            lastBboxStr = "";
        }
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

    document.getElementById('filter-comm-jet').addEventListener('change', (e) => {
        showCommJet = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    document.getElementById('filter-airplane').addEventListener('change', (e) => {
        showAirplane = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    document.getElementById('filter-biz-jet').addEventListener('change', (e) => {
        showBizJet = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    document.getElementById('filter-helo').addEventListener('change', (e) => {
        showHelo = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    document.getElementById('filter-mil').addEventListener('change', (e) => {
        showMil = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    document.getElementById('filter-other').addEventListener('change', (e) => {
        showOther = e.target.checked;
        saveMapSettings();
        refreshAllAircraftLayers();
    });

    // Google Search UI Listeners
    const sendBtn = document.getElementById('chat-send-btn');
    const chatInput = document.getElementById('chat-input');
    
    const collapseSearchBtn = document.getElementById('btn-collapse-search');
    const searchPanel = document.getElementById('chat-panel');
    
    // Read search panel collapse state from local storage on startup
    let searchPanelCollapsed = safeGetItem('kvpz_search_panel_collapsed') === 'true';
    if (searchPanelCollapsed && searchPanel && collapseSearchBtn) {
        searchPanel.classList.add('collapsed');
        collapseSearchBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
    }
    
    if (collapseSearchBtn && searchPanel) {
        collapseSearchBtn.addEventListener('click', () => {
            const isCollapsed = searchPanel.classList.toggle('collapsed');
            safeSetItem('kvpz_search_panel_collapsed', isCollapsed);
            collapseSearchBtn.innerHTML = isCollapsed 
                ? '<i class="fa-solid fa-chevron-left"></i>' 
                : '<i class="fa-solid fa-chevron-right"></i>';
            
            // Trigger Leaflet map container recalculation after width animation finishes
            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 320);
        });
    }

    if (sendBtn && chatInput) {
        sendBtn.addEventListener('click', submitStandardSearch);
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                submitStandardSearch();
            }
        });
        chatInput.addEventListener('input', (e) => {
            updateSearchPortalLinks(e.target.value);
        });
    }
});

function refreshAllAircraftLayers() {
    // Clear and redraw all markers based on new altitude & type toggles
    Object.keys(aircraftCache).forEach(hex => {
        removeAircraftLayers(hex);
        const ac = aircraftCache[hex];
        // Only redraw if both altitude and type filters match
        if (ac && ac.lat && ac.lon && isAltitudeVisible(ac.alt) && isTypeVisible(ac)) {
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

function isTypeVisible(ac) {
    const typeClass = ac.categoryClass || 'other';
    if (typeClass === 'commercial-jet') return showCommJet;
    if (typeClass === 'airplane') return showAirplane;
    if (typeClass === 'business-jet') return showBizJet;
    if (typeClass === 'helicopter') return showHelo;
    if (typeClass === 'military') return showMil;
    return showOther;
}

function getAircraftCategory(ac) {
    // 1. Military (check mil flag from feed)
    if (ac.mil === 1 || ac.mil === true || ac.mil === '1' || String(ac.mil).toLowerCase() === 'true') {
        return 'military';
    }

    const callsign = (ac.flight || ac.r || '').trim().toUpperCase();
    const tail = (ac.r || '').trim().toUpperCase();
    const desc = (ac.desc || '').toLowerCase();
    const type = (ac.t || ac.type || '').toLowerCase();
    const cat = (ac.category || '');
    const op = (ac.ownOp || '').toLowerCase();

    // 2. Identify military callsign patterns (common prefixes and names)
    const milCallsignPrefixes = [
        'RCH', 'PAT', 'VV', 'NAVY', 'ARMY', 'MC', 'USAF', 'USN', 'USMC', 
        'GUARD', 'ANG', 'ADF', 'SPAR', 'RSC', 'SAM', 'MARNE', 'FORCE',
        'EVAC', 'MEDEVAC', 'RESC', 'RESCUE', 'DUST', 'SHOC', 'VIPER',
        'SABR', 'SABER', 'TALN', 'TALON', 'RHIN', 'RHINO', 'HAWK', 
        'COBR', 'COBRA', 'WARN', 'WARG', 'HORNET', 'RAPTOR', 'C130',
        'C17', 'KC13', 'KC10', 'KC46', 'T38', 'T6'
    ];
    
    const isMilCallsign = milCallsignPrefixes.some(p => callsign.startsWith(p)) || 
                          op.includes('military') || op.includes('navy') || 
                          op.includes('air force') || op.includes('marines') || 
                          op.includes('army') || op.includes('coast guard');

    // 3. Identify military tail number pattern (purely numeric, no letters, at least 3 digits)
    const cleanTail = tail.replace(/[\s\-\/]/g, '');
    const isPurelyNumericTail = cleanTail.length >= 3 && /^\d+$/.test(cleanTail);

    // 4. Combine callsign / tail heuristic
    const isCallsignDiffFromTail = callsign.length > 0 && tail.length > 0 && callsign !== tail;
    
    if (isMilCallsign || (isPurelyNumericTail && isCallsignDiffFromTail)) {
        return 'military';
    }
    
    // 2. Helicopters
    const isHelo = desc.includes('helicopter') || desc.includes('rotorcraft') || desc.includes('copter') || 
                   type.startsWith('r22') || type.startsWith('r44') || type.startsWith('r66') || 
                   type.startsWith('b206') || type.startsWith('b505') || type.startsWith('b407') || 
                   type.startsWith('as50') || type.startsWith('as35') || type.startsWith('ec30') || 
                   type.startsWith('ec20') || type.startsWith('uh60') || type.startsWith('uh1') || 
                   type.startsWith('ah64') || type.startsWith('ch47') || type.includes('h60') || 
                   type.includes('ec35') || cat === 'A7';
    if (isHelo) return 'helicopter';

    // 3. Business Jets (common corporate jet types and manufacturers)
    const isBizJet = desc.includes('gulfstream') || desc.includes('citation') || 
                     desc.includes('challenger') || desc.includes('falcon') || 
                     desc.includes('learjet') || desc.includes('hawker') || 
                     desc.includes('phenom') || desc.includes('global express') || 
                     desc.includes('sovereign') || desc.includes('premier') ||
                     type.startsWith('cl30') || type.startsWith('cl60') || type.startsWith('cl35') ||
                     type.startsWith('glf') || type.startsWith('glex') || type.startsWith('gl5t') ||
                     type.startsWith('gl6t') || type.startsWith('c25a') || type.startsWith('c25b') ||
                     type.startsWith('c510') || type.startsWith('c525') || type.startsWith('c560') ||
                     type.startsWith('c56x') || type.startsWith('c680') || type.startsWith('c750') ||
                     type.startsWith('c700') || type.startsWith('lr35') || type.startsWith('lr45') ||
                     type.startsWith('lr60') || type.startsWith('fa20') || type.startsWith('fa50') ||
                     type.startsWith('fa7x') || type.startsWith('fa8x') || type.startsWith('e55p') ||
                     type.startsWith('e50p') || type.startsWith('pc24') || type.startsWith('h25b') ||
                     type.includes('cl30') || type.includes('cl60') || type.includes('glf') ||
                     type.includes('c510') || type.includes('c525') || type.includes('c560') ||
                     type.includes('c680') || type.includes('c750') || type.includes('lr35') ||
                     type.includes('lr45') || type.includes('lr60') || type.includes('fa20') ||
                     type.includes('fa50') || type.includes('e55p') || type.includes('e50p');
    if (isBizJet) return 'business-jet';

    // 4. Commercial Jets (large airline passenger/cargo jets)
    const isCommJet = desc.includes('boeing') || desc.includes('airbus') || 
                      desc.includes('embraer') || desc.includes('bombardier') ||
                      desc.includes('md-8') || desc.includes('md-11') || desc.includes('dc-10') ||
                      type.startsWith('b73') || type.startsWith('b74') || type.startsWith('b75') ||
                      type.startsWith('b76') || type.startsWith('b77') || type.startsWith('b78') ||
                      type.startsWith('a31') || type.startsWith('a32') || type.startsWith('a33') ||
                      type.startsWith('a34') || type.startsWith('a35') || type.startsWith('a38') ||
                      type.startsWith('b38m') || type.startsWith('b39m') ||
                      type.startsWith('crj') || type.startsWith('erj') ||
                      type.startsWith('e17') || type.startsWith('e19') || type.startsWith('e14') ||
                      op.includes('airline') || op.includes('airways') || op.includes('cargo') ||
                      op.includes('delta') || op.includes('united') || op.includes('american') ||
                      op.includes('southwest') || op.includes('fedex') || op.includes('ups') ||
                      op.includes('dhl') || op.includes('spirit') || op.includes('frontier') ||
                      op.includes('alaska') || op.includes('jetblue');
    if (isCommJet) return 'commercial-jet';

    // 5. Airplane (general aviation, single/multi engine props, turboprops)
    const isAirplane = desc.includes('single-engine') || desc.includes('multi-engine') ||
                       desc.includes('cessna') || desc.includes('piper') || 
                       desc.includes('beech') || desc.includes('cirrus') || 
                       desc.includes('diamond') || desc.includes('mooney') ||
                       desc.includes('prop') || desc.includes('piston') ||
                       type.startsWith('c15') || type.startsWith('c17') || type.startsWith('c18') ||
                       type.startsWith('c20') || type.startsWith('c21') || type.startsWith('pa2') ||
                       type.startsWith('pa3') || type.startsWith('pa4') || type.startsWith('be3') ||
                       type.startsWith('be5') || type.startsWith('sr2') || type.startsWith('moo') ||
                       type.startsWith('da4') || type.startsWith('da2');
    if (isAirplane) return 'airplane';

    return 'other';
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
    darkMatter = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
    });
    
    voyager = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    });
    
    satellite = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles courtesy of the U.S. Geological Survey',
        maxZoom: 16
    });

    baseTileLayers = {
        "dark": darkMatter,
        "light": osm,
        "vector": voyager,
        "satellite": satellite
    };

    // Retrieve saved base layer from memory (default to OpenStreetMap Light)
    const savedStyle = safeGetItem('kvpz_map_base_layer', "light");
    const initialBaseLayer = baseTileLayers[savedStyle] || osm;

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

    // Listen to map movement/zoom to dynamically fetch flight data
    map.on('moveend', () => {
        fetchAircraftData();
    });
    
    initPowerlines();
}

// Set base map layer programmatically
function setBaseLayer(layerKey) {
    if (!map || !baseTileLayers) return;
    
    // Remove all base layers
    Object.values(baseTileLayers).forEach(layer => {
        if (map.hasLayer(layer)) {
            map.removeLayer(layer);
        }
    });
    
    // Add the selected layer
    const selectedLayer = baseTileLayers[layerKey];
    if (selectedLayer) {
        selectedLayer.addTo(map);
        safeSetItem('kvpz_map_base_layer', layerKey);
    }
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

// Geodesic distance calculation in Nautical Miles (Haversine formula)
function getDistanceNM(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 3440.065; // Earth radius in nautical miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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
        
        const response = await fetch(urlAirplanesLive);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        
        let mergedAircraft = {};
        if (data && Array.isArray(data.ac)) {
            data.ac.forEach(ac => {
                if (ac.hex) {
                    mergedAircraft[ac.hex] = ac;
                }
            });
        }
        
        const mergedList = Object.values(mergedAircraft);
        
        pulseIndicator.className = "pulse-indicator status-live";
        statusText.textContent = `Airplanes.live Active (${radiusNM} NM Coverage) • Updated ${new Date().toLocaleTimeString([], {hour12:false})}`;
        
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
        const lat = ac.lat;
        const lon = ac.lon;
        // Always calculate geodesic distance relative to KVPZ coordinates to prevent map panning from affecting operations logging
        const dist = (lat && lon) ? getDistanceNM(lat, lon, KVPZ_COORDS[0], KVPZ_COORDS[1]) : 999.0;
        const operator = ac.ownOp || 'Private';
        const category = ac.category || '';
        const categoryClass = getAircraftCategory(ac);
        
        const currentState = {
            hex, callsign, tail, type, desc, alt, speed, vspeed, heading, dist, operator, lat, lon, category, categoryClass,
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
                logOperation(callsign, type, 'arrival', `Landed KVPZ (Speed: ${speed} KT, Alt: ${alt} FT)`, tail);
                currentState.logged = true;
            }
            
            // 2. KVPZ DEPARTURE TRIGGER (Ground to Air takeoff transition)
            if (prevState.dist < 2.5 && prevState.alt < 1500 && vspeed > 200 && !prevState.logged && !currentState.logged) {
                logOperation(callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`, tail);
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
                logOperation(callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`, tail);
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
                logOperation(callsign, type, 'arrival', `Geofence Landing KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`, tail);
            } else {
                logOperation(callsign, type, 'departure', `Geofence Departure KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`, tail);
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
                logOperation(lastState.callsign, lastState.type, 'arrival', `Landed KVPZ (Last seen ${lastState.dist.toFixed(1)} NM out, ${lastState.alt} FT)`, lastState.tail);
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
            if (inBounds && isAltitudeVisible(ac.alt) && isTypeVisible(ac)) {
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

// 6. Map Marker Graphics & Rotation
function updateMapMarker(ac) {
    // Choose color based on altitude: gradated by 1,000 feet steps from ground (0 FT) all the way up to 60,000 FT
    const clampedAlt = Math.max(0, Math.min(60000, ac.alt));
    const step = Math.floor(clampedAlt / 1000); // 0 to 60
    
    // Calculate hue: start at 140 (emerald green) and descend by 5 degrees per 1,000 ft (covering 300 degrees down to 200/sky blue)
    let hue = (140 - step * 5) % 360;
    if (hue < 0) hue += 360;
    
    const color = `hsl(${hue}, 85%, 50%)`;
    
    // Determine aircraft type icon from precomputed categoryClass
    const iconType = ac.categoryClass || 'other';
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
    } else if (iconType === 'military') {
        // Directional delta wedge triangle inside a tactical radar circle to signify military
        iconHtml = `
            <svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <!-- Outer tactical circle -->
                <circle cx="256" cy="256" r="222" fill="none" stroke="${color}" stroke-width="20" />
                <!-- Directional triangle pointer -->
                <path fill="${color}" stroke="#090d16" stroke-width="16" stroke-linejoin="round" d="M256 95L150 395l106-65l106 65z"/>
            </svg>
        `;
    } else if (iconType === 'commercial-jet') {
        // Large passenger swept-wing airliner profile
        iconHtml = `
            <svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 16c-12 0-22 10-22 22v140L24 280v40l210-48v112l-64 48v24l86-20 86 20v-24l-64-48V272l210 48v-40L278 178V38c0-12-10-22-22-22z"/>
            </svg>
        `;
    } else if (iconType === 'business-jet') {
        // Sleek corporate business jet with twin rear-mounted engine cylinders
        iconHtml = `
            <svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="13" d="M256 20c-8 0-14 8-14 18v150L60 290v30l182-45v80c-15 4-26 12-26 25v65l38-12 38 12v-65c0-13-11-21-26-25v-80l182 45v-30L270 188V38c0-10-6-18-14-18z"/>
                <rect x="208" y="335" width="16" height="40" rx="6" fill="${color}" stroke="#090d16" stroke-width="5" />
                <rect x="288" y="335" width="16" height="40" rx="6" fill="${color}" stroke="#090d16" stroke-width="5" />
            </svg>
        `;
    } else if (iconType === 'airplane') {
        // Straight-wing general aviation light propeller aircraft with prop line spinner
        iconHtml = `
            <svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 40c-10 0-18 8-18 18v134L32 192v36l206 12v120l-48 30v24l66-16 66 16v-24l-48-30V240l206-12v-36L274 192V58c0-10-8-18-18-18z"/>
                <line x1="210" y1="42" x2="302" y2="42" stroke="#090d16" stroke-width="12" stroke-linecap="round" />
                <line x1="210" y1="42" x2="302" y2="42" stroke="${color}" stroke-width="5" stroke-linecap="round" />
            </svg>
        `;
    } else {
        // Default "Other": Sleek glider profile with extra long narrow wings
        iconHtml = `
            <svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${ac.heading}deg);">
                <path fill="${color}" stroke="#090d16" stroke-width="13" d="M256 60c-8 0-14 8-14 16v120L16 204v20l226 8v140l-30 20v14l44-10 44 10v-14l-30-20V232l226-8v-20L270 196V76c0-8-6-16-14-16z"/>
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
    
    const categoryNames = {
        'commercial-jet': 'Commercial Jet',
        'business-jet': 'Business Jet',
        'airplane': 'GA Airplane',
        'helicopter': 'Helicopter',
        'military': 'Military Aircraft',
        'other': 'Other / Glider'
    };
    const categoryLabel = categoryNames[ac.categoryClass] || 'Other / Glider';
    const vspeedText = ac.vspeed > 0 ? `+${ac.vspeed.toLocaleString()} FPM` : (ac.vspeed < 0 ? `${ac.vspeed.toLocaleString()} FPM` : 'Level');
    const altText = ac.alt === 0 ? 'Ground' : `${ac.alt.toLocaleString()} FT`;

    const tooltipContent = `
        <div class="map-tooltip-content">
            <div class="tooltip-header">
                <strong>${ac.callsign}</strong>
                <span class="tooltip-tail">${ac.tail !== 'N/A' ? ac.tail : ''}</span>
            </div>
            <div class="tooltip-body">
                <div><strong>Category:</strong> ${categoryLabel}</div>
                <div><strong>Type:</strong> ${ac.type} (${ac.desc !== 'N/A' ? ac.desc : 'No Desc'})</div>
                <div><strong>Altitude:</strong> ${altText}</div>
                <div><strong>Speed:</strong> ${ac.speed} KT | <strong>Heading:</strong> ${ac.heading}°</div>
                <div><strong>V-Speed:</strong> ${vspeedText}</div>
                <div><strong>Distance:</strong> ${ac.dist.toFixed(1)} NM from KVPZ</div>
                <div><strong>Operator:</strong> ${ac.operator}</div>
            </div>
        </div>
    `;
    
    if (aircraftMarkers[ac.hex]) {
        // Update existing marker position & rotation
        aircraftMarkers[ac.hex].setLatLng([ac.lat, ac.lon]);
        aircraftMarkers[ac.hex].setIcon(customIcon);
        aircraftMarkers[ac.hex].setTooltipContent(tooltipContent);
    } else {
        // Create new marker
        const marker = L.marker([ac.lat, ac.lon], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
            selectAircraft(ac.hex);
        });
        marker.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, -15],
            className: 'custom-map-tooltip',
            sticky: false
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
function logOperation(callsign, type, opType, description, tail) {
    const now = new Date();
    const logItem = {
        timestamp: now.getTime(), // Miliseconds for 30-day age filtering
        dateStr: now.toLocaleDateString(),
        timeStr: now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        callsign,
        type,
        opType,
        description,
        tail: tail || 'N/A'
    };
    
    operationsLog.unshift(logItem); // Add to beginning of array
    
    // Prune entries older than 30 days (1 month), keeping legacy entries that have no timestamp
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    operationsLog = operationsLog.filter(log => !log || log.timestamp === undefined || log.timestamp >= oneMonthAgo);
    
    saveAndSyncOperations();
}

function saveAndSyncOperations() {
    // Save to localStorage
    safeSetItem('kvpz_operations_log', JSON.stringify(operationsLog));
    
    // Recalculate counters
    arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
    departureCount = operationsLog.filter(log => log.opType === 'departure').length;
    
    updateOpsLog();
    updateCounters();
}

function deleteOperationsByTail(tail) {
    operationsLog = operationsLog.filter(log => {
        const key = (log.tail && log.tail !== 'N/A') ? log.tail : (log.callsign || 'Unknown');
        return key !== tail;
    });
    saveAndSyncOperations();
}

function deleteOperationEvent(timestamp, dateStr, timeStr, callsign) {
    operationsLog = operationsLog.filter(log => {
        if (timestamp && log.timestamp === timestamp) return false;
        if (!timestamp && log.dateStr === dateStr && (log.timeStr === timeStr || log.time === timeStr) && log.callsign === callsign) return false;
        return true;
    });
    saveAndSyncOperations();
}

function updateOpsLog() {
    const logList = document.getElementById('ops-log-list');
    logList.innerHTML = '';
    
    if (operationsLog.length === 0) {
        logList.innerHTML = '<li class="empty-log">Listening for KVPZ arrivals and departures...</li>';
        return;
    }
    
    // Group operations by tail number (fallback to callsign if tail is missing/N/A)
    const groups = {};
    operationsLog.forEach(log => {
        const key = (log.tail && log.tail !== 'N/A') ? log.tail : (log.callsign || 'Unknown');
        if (!groups[key]) {
            groups[key] = {
                tail: key,
                callsign: log.callsign || key,
                type: log.type || 'N/A',
                arrivals: 0,
                departures: 0,
                newestTimestamp: 0,
                events: []
            };
        }
        groups[key].events.push(log);
        if (log.opType === 'arrival') {
            groups[key].arrivals++;
        } else if (log.opType === 'departure') {
            groups[key].departures++;
        }
        const logTime = log.timestamp || 0;
        if (logTime > groups[key].newestTimestamp) {
            groups[key].newestTimestamp = logTime;
        }
    });
    
    // Sort groups so that the tail with the most recent operation appears first
    const sortedGroups = Object.values(groups).sort((a, b) => b.newestTimestamp - a.newestTimestamp);
    
    sortedGroups.forEach(group => {
        const item = document.createElement('li');
        item.className = 'ops-group-card';
        
        // Header
        const header = document.createElement('div');
        header.className = 'ops-group-header';
        header.innerHTML = `
            <div class="ops-group-left">
                <span class="ops-group-tail"><i class="fa-solid fa-plane"></i> ${group.tail}</span>
                <span class="ops-group-type">(${group.type})</span>
            </div>
            <div class="ops-group-badges">
                <span class="badge inbound">ARR: ${group.arrivals}</span>
                <span class="badge outbound" style="background-color: #ef4444; color: white;">DEP: ${group.departures}</span>
                <span class="chevron-indicator"><i class="fa-solid fa-chevron-down"></i></span>
            </div>
        `;
        
        // Add group delete button before the chevron
        const deleteGroupBtn = document.createElement('button');
        deleteGroupBtn.className = 'btn-delete-group';
        deleteGroupBtn.title = `Delete all logs for ${group.tail}`;
        deleteGroupBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteGroupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`Delete all operations logged for ${group.tail}?`)) {
                deleteOperationsByTail(group.tail);
            }
        });
        
        const badgesContainer = header.querySelector('.ops-group-badges');
        if (badgesContainer) {
            badgesContainer.insertBefore(deleteGroupBtn, badgesContainer.querySelector('.chevron-indicator'));
        }
        
        // Details list (stacked events)
        const details = document.createElement('div');
        details.className = 'ops-group-details';
        details.style.display = 'none'; // Collapsed by default
        
        group.events.forEach(log => {
            const eventDiv = document.createElement('div');
            eventDiv.className = `ops-event-item ${log.opType}`;
            
            const meta = document.createElement('div');
            meta.className = 'ops-event-meta';
            const dateText = log.dateStr || '';
            const timeText = log.timeStr || log.time || '---';
            meta.innerHTML = `
                <span class="ops-event-time">${dateText ? dateText + ' ' : ''}${timeText}</span>
                <div style="display: flex; align-items: center; gap: 0.4rem;">
                    <span class="ops-event-type-badge">${log.opType === 'arrival' ? 'Arrival' : 'Departure'}</span>
                </div>
            `;
            
            // Add individual event delete button next to type badge
            const deleteEventBtn = document.createElement('button');
            deleteEventBtn.className = 'btn-delete-event';
            deleteEventBtn.title = 'Delete this event';
            deleteEventBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
            deleteEventBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Delete this ${log.opType} event at ${timeText}?`)) {
                    deleteOperationEvent(log.timestamp, log.dateStr, timeText, log.callsign);
                }
            });
            meta.querySelector('div').appendChild(deleteEventBtn);
            
            const desc = document.createElement('div');
            desc.className = 'ops-event-desc';
            desc.textContent = log.description;
            
            eventDiv.appendChild(meta);
            eventDiv.appendChild(desc);
            details.appendChild(eventDiv);
        });
        
        // Toggle interaction
        header.addEventListener('click', () => {
            const isHidden = details.style.display === 'none';
            details.style.display = isHidden ? 'flex' : 'none';
            const chevron = header.querySelector('.chevron-indicator i');
            if (chevron) {
                chevron.className = isHidden ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
            }
            
            // Autopopulate the Google Search input field and update aviation link portals
            const searchField = document.getElementById('chat-input');
            if (searchField && group.tail && group.tail !== 'Unknown') {
                searchField.value = group.tail;
                updateSearchPortalLinks(group.tail);
            }
        });
        
        item.appendChild(header);
        item.appendChild(details);
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
// Internet Search for missing aircraft mission information
async function fetchMissingAircraftInfo(hex, ac) {
    if (ac._infoRequested) return;
    ac._infoRequested = true;
    
    const hexKey = hex.toLowerCase();
    
    // 1. Check local cache first
    if (aircraftInfoDb[hexKey]) {
        let updatedFromCache = false;
        const cached = aircraftInfoDb[hexKey];
        if ((!ac.type || ac.type === 'N/A' || ac.type === 'Unknown' || ac.type === '') && cached.type) {
            ac.type = cached.type;
            updatedFromCache = true;
        }
        if ((!ac.desc || ac.desc === 'N/A' || ac.desc === 'Unknown' || ac.desc === '') && cached.desc) {
            ac.desc = cached.desc;
            updatedFromCache = true;
        }
        if ((!ac.operator || ac.operator === 'N/A' || ac.operator === 'Unknown' || ac.operator === '') && cached.operator) {
            ac.operator = cached.operator;
            updatedFromCache = true;
        }
        if ((!ac.tail || ac.tail === 'N/A' || ac.tail === 'Unknown' || ac.tail === '') && cached.tail) {
            ac.tail = cached.tail;
            updatedFromCache = true;
        }
        
        if (updatedFromCache) {
            updateUI();
        }
        return;
    }
    
    // 2. Fetch from HexDB if not cached
    try {
        const response = await fetch(`https://hexdb.io/api/v1/aircraft/${hexKey}`);
        if (!response.ok) return;
        const data = await response.json();
        
        if (data && !data.error && data.status !== "404") {
            let updated = false;
            
            // Fill missing Type
            if ((!ac.type || ac.type === 'N/A' || ac.type === 'Unknown' || ac.type === '') && data.ICAOTypeCode) {
                ac.type = data.ICAOTypeCode;
                updated = true;
            }
            // Fill missing Description
            if ((!ac.desc || ac.desc === 'N/A' || ac.desc === 'Unknown' || ac.desc === '') && data.Type) {
                ac.desc = data.Manufacturer ? `${data.Manufacturer} ${data.Type}` : data.Type;
                updated = true;
            }
            // Fill missing Operator
            if ((!ac.operator || ac.operator === 'N/A' || ac.operator === 'Unknown' || ac.operator === '') && data.OperatorFlagCode) {
                ac.operator = data.OperatorFlagCode;
                updated = true;
            }
            // Fill missing Tail
            if ((!ac.tail || ac.tail === 'N/A' || ac.tail === 'Unknown' || ac.tail === '') && data.Registration) {
                ac.tail = data.Registration;
                updated = true;
            }
            
            if (updated) {
                // Save to local cache
                aircraftInfoDb[hexKey] = {
                    type: data.ICAOTypeCode || '',
                    desc: data.Manufacturer ? `${data.Manufacturer} ${data.Type}` : (data.Type || ''),
                    operator: data.OperatorFlagCode || '',
                    tail: data.Registration || ''
                };
                saveAircraftDb();
                
                updateUI(); // Real-time block update
            }
        }
    } catch (e) {
        console.warn("Internet search lookup failed for", hex, e);
    }
}

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
        
        // Map visibility toggle filters (altitude & type)
        if (!isAltitudeVisible(ac.alt)) return false;
        if (!isTypeVisible(ac)) return false;
        
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
    
    // Sort strictly by distance to KVPZ ascending
    filteredAircraft.sort((a, b) => a.dist - b.dist);
    
    if (filteredAircraft.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="loading-row">No active aircraft match criteria.</td></tr>';
        return;
    }
    
    let selectedRow = null;
    
    filteredAircraft.forEach(ac => {
        // Trigger background internet search if mission info is missing
        if (!ac._infoRequested && 
            (!ac.type || ac.type === 'N/A' || ac.type === 'Unknown' || ac.type === '' ||
             !ac.operator || ac.operator === 'N/A' || ac.operator === 'Unknown' || ac.operator === '' ||
             !ac.desc || ac.desc === 'N/A' || ac.desc === 'Unknown' || ac.desc === '')) {
            fetchMissingAircraftInfo(ac.hex, ac);
        }
        
        const tr = document.createElement('tr');
        if (selectedHex === ac.hex) {
            tr.className = 'selected';
            selectedRow = tr;
        }
        
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
    
    // Smoothly scroll the selected row into view if it exists
    if (selectedRow) {
        setTimeout(() => {
            selectedRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 50);
    }
}

async function selectAircraft(hex) {
    if (selectedHex === hex) {
        // Unselect
        selectedHex = null;
    } else {
        selectedHex = hex;
        // Pan map to aircraft
        const ac = aircraftCache[hex];
        if (ac && ac.lat && ac.lon) {
            map.panTo([ac.lat, ac.lon]);
            
            // Try to fetch full historical trace from the ADS-B API online
            const apiTrace = await fetchDetailedTrace(hex);
            if (apiTrace && apiTrace.length > 0) {
                ac.trail = apiTrace;
            }
            
            // Populate Google Search Input and Database Link portals
            const searchField = document.getElementById('chat-input');
            if (searchField) {
                const targetQuery = (ac.tail && ac.tail !== 'N/A') ? ac.tail : ac.callsign;
                searchField.value = targetQuery;
                updateSearchPortalLinks(targetQuery);
            }
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
function loadAircraftDb() {
    try {
        const stored = safeGetItem('kvpz_aircraft_db');
        if (stored) {
            aircraftInfoDb = JSON.parse(stored);
        }
    } catch(e) {}
}

function saveAircraftDb() {
    try {
        // limit cache size to ~2000 entries to prevent localstorage overflow
        const keys = Object.keys(aircraftInfoDb);
        if (keys.length > 2000) {
            const oldKeys = keys.slice(0, keys.length - 1000);
            oldKeys.forEach(k => delete aircraftInfoDb[k]);
        }
        safeSetItem('kvpz_aircraft_db', JSON.stringify(aircraftInfoDb));
    } catch(e) {}
}

function loadMapSettings() {
    try {
        const stored = safeGetItem('kvpz_map_settings');
        if (stored) {
            const settings = JSON.parse(stored);
            showRings = settings.showRings !== undefined ? settings.showRings : true;
            showLabels = settings.showLabels !== undefined ? settings.showLabels : true;
            showTrails = settings.showTrails !== undefined ? settings.showTrails : true;
            showPowerlines = settings.showPowerlines !== undefined ? settings.showPowerlines : true;
            showLow = settings.showLow !== undefined ? settings.showLow : true;
            showMed = settings.showMed !== undefined ? settings.showMed : true;
            showHigh = settings.showHigh !== undefined ? settings.showHigh : true;
            showCommJet = settings.showCommJet !== undefined ? settings.showCommJet : true;
            showAirplane = settings.showAirplane !== undefined ? settings.showAirplane : true;
            showBizJet = settings.showBizJet !== undefined ? settings.showBizJet : true;
            showHelo = settings.showHelo !== undefined ? settings.showHelo : true;
            showMil = settings.showMil !== undefined ? settings.showMil : true;
            showOther = settings.showOther !== undefined ? settings.showOther : true;
            controlsCollapsed = settings.controlsCollapsed !== undefined ? settings.controlsCollapsed : false;
        }
    } catch (e) {
        console.error("Error loading map settings from localStorage:", e);
    }
}

function saveMapSettings() {
    try {
        const settings = { 
            showRings, showLabels, showTrails, showPowerlines, showLow, showMed, showHigh, 
            showCommJet, showAirplane, showBizJet, showHelo, showMil, showOther,
            controlsCollapsed 
        };
        safeSetItem('kvpz_map_settings', JSON.stringify(settings));
    } catch (e) {
        console.error("Error saving map settings to localStorage:", e);
    }
}

// Online Flight Track History (Trace) Fetcher
async function fetchDetailedTrace(hex) {
    const urlAirplanesLive = `https://api.airplanes.live/v2/trace/${hex}`;
    
    try {
        const response = await fetch(urlAirplanesLive);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        if (data && Array.isArray(data.trace)) {
            // readsb trace array format: [seconds_offset, lat, lon, alt, speed, heading, flags]
            const path = data.trace
                .filter(pt => pt[1] && pt[2])
                .map(pt => [pt[1], pt[2]]);
            return path;
        }
    } catch (e) {
        console.warn(`Could not fetch online historical trace for hex ${hex}:`, e);
    }
    return null;
}

// 11. Google Search & Portal Database Links
function submitStandardSearch() {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    
    // Open standard Google Search in a new tab
    window.open(`https://www.google.com/search?q=${encodeURIComponent(text)}`, '_blank');
    
    // Update portal links
    updateSearchPortalLinks(text);
}

function updateSearchPortalLinks(query) {
    const container = document.getElementById('portal-links-container');
    if (!container) return;
    
    const cleanQuery = query.trim().toUpperCase();
    if (!cleanQuery) {
        container.innerHTML = `<p style="margin: 0; color: var(--color-text-muted); font-size: 0.65rem; font-style: italic;">Enter a tail number or select an aircraft to generate direct database links.</p>`;
        return;
    }
    
    // Strip leading N for FAA Registry Lookups
    let faaTxt = cleanQuery;
    if (cleanQuery.startsWith('N')) {
        faaTxt = cleanQuery.substring(1);
    }
    
    container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.4rem;">
            <a href="https://www.google.com/search?q=${encodeURIComponent(cleanQuery)}" target="_blank" class="portal-link">
                <i class="fa-brands fa-google"></i> Google Search: "${cleanQuery}"
            </a>
            <a href="https://registry.faa.gov/aircraftinquiry/Search/NNumberResult?nNumberTxt=${encodeURIComponent(faaTxt)}" target="_blank" class="portal-link">
                <i class="fa-solid fa-building"></i> FAA Registry Lookup
            </a>
            <a href="https://www.flightaware.com/resources/registration/${encodeURIComponent(cleanQuery)}" target="_blank" class="portal-link">
                <i class="fa-solid fa-plane-departure"></i> FlightAware Registry
            </a>
            <a href="https://www.flightradar24.com/data/aircraft/${encodeURIComponent(cleanQuery)}" target="_blank" class="portal-link">
                <i class="fa-solid fa-clock-rotate-left"></i> Flightradar24 History
            </a>
        </div>
    `;
}

// 12. OSM Powerlines Renderer (Overpass API)
function initPowerlines() {
    powerlineGroup = L.layerGroup().addTo(map);
    
    // Refresh powerlines whenever map movement finishes
    map.on('moveend', () => {
        updatePowerlines();
    });
    
    // Initial load
    updatePowerlines();
}

async function updatePowerlines() {
    if (!map || !powerlineGroup) return;
    
    if (!showPowerlines) {
        powerlineGroup.clearLayers();
        lastBboxStr = "";
        return;
    }
    
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const south = bounds.getSouth().toFixed(4);
    const west = bounds.getWest().toFixed(4);
    const north = bounds.getNorth().toFixed(4);
    const east = bounds.getEast().toFixed(4);
    
    const bboxStr = `${south},${west},${north},${east}`;
    if (bboxStr === lastBboxStr) return; // Map viewport did not change
    lastBboxStr = bboxStr;
    
    // Build query to strictly pull powerlines inside the state of Indiana area intersecting the viewport
    let overpassQuery;
    if (zoom >= 13) {
        // Pull major and minor lines inside Indiana when zoomed in close
        overpassQuery = `[out:json][timeout:25];area["ISO3166-2"="US-IN"]->.indiana;(way["power"="line"](area.indiana)(${bboxStr});way["power"="minor_line"](area.indiana)(${bboxStr}););out geom;`;
    } else {
        // Only pull major transmission lines inside Indiana when zoomed out to prevent payload lag
        overpassQuery = `[out:json][timeout:25];area["ISO3166-2"="US-IN"]->.indiana;(way["power"="line"](area.indiana)(${bboxStr}););out geom;`;
    }
    
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        
        // Clear old powerline paths
        powerlineGroup.clearLayers();
        
        let activeCount = 0;
        let skippedCount = 0;
        
        if (data && Array.isArray(data.elements)) {
            data.elements.forEach(el => {
                if (el.type === 'way' && Array.isArray(el.geometry)) {
                    const tags = el.tags || {};
                    
                    // Do not pull power lines that are labeled for Duke and AEP (or subsidiaries)
                    const operator = (tags.operator || '').toLowerCase();
                    const owner = (tags.owner || '').toLowerCase();
                    const name = (tags.name || '').toLowerCase();
                    
                    const skipKeywords = [
                        'duke', 'aep', 'american electric power', 
                        'indiana michigan power', 'indiana & michigan', 
                        'indiana michigan', 'i&m'
                    ];
                    
                    const shouldSkip = skipKeywords.some(kw => 
                        operator.includes(kw) || owner.includes(kw) || name.includes(kw)
                    );
                    
                    if (shouldSkip) {
                        skippedCount++;
                        return;
                    }
                    
                    activeCount++;
                    const latlngs = el.geometry.map(pt => [pt.lat, pt.lon]);
                    
                    // Double-stroke neon glow technique
                    // 1. Semi-transparent thick background pink line for glow
                    L.polyline(latlngs, {
                        color: '#ff007f',
                        weight: 6,
                        opacity: 0.35,
                        dashArray: 'none',
                        interactive: false
                    }).addTo(powerlineGroup);
                    
                    // 2. High-brightness thin solid pink line on top
                    const mainLine = L.polyline(latlngs, {
                        color: '#ff1493', // Deep Pink / Highlighter Pink
                        weight: 2.2,
                        opacity: 0.95,
                        dashArray: 'none'
                    }).addTo(powerlineGroup);
                    
                    // Add tooltips with power line attributes if present
                    let tooltipContent = 'Power Line';
                    if (tags.voltage) {
                        const kv = parseInt(tags.voltage) / 1000;
                        tooltipContent = `Transmission Line (${kv} kV)`;
                    } else if (tags.cables) {
                        tooltipContent = `Power Line (${tags.cables} cables)`;
                    }
                    
                    if (tags.operator) {
                        tooltipContent += ` - ${tags.operator}`;
                    }
                    
                    mainLine.bindTooltip(tooltipContent, { sticky: true });
                }
            });
        }
        console.log(`OSM Powerlines Loaded: ${activeCount} active, ${skippedCount} skipped (Duke/AEP exclusion)`);
    } catch (error) {
        console.warn("Error fetching OSM powerline data from Overpass API:", error);
    }
}

