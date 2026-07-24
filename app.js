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
let powerlineCache = {}; // id -> { id, latlngs, tags }
const fetchedPowerlineTiles = new Set(); // set of grid tile keys already requested
const activeSearches = new Set(); // Tracks hex codes currently being searched over the internet
const searchedHexes = new Set(); // Tracks hex codes we already attempted to search this session
const autoSearchQueue = []; // Queue for throttling background searches
let isAutoSearchProcessing = false;
let autoSearch = false;
let geminiApiKey = ''; // Gemini AI Key
let lastBboxStr = "";
let arrivalCount = 0;
let departureCount = 0;
let transitCount = 0;

// TAF State
let tafDataMap = {}; // station -> TAF JSON object
let activeTafStation = 'KGYY';
let tafViewMode = 'decoded';
const TAF_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Map Toggle States
let showRings = true;
let showLabels = true;
let showTrails = true;
let showPowerlines = true;
let showRadar = true;
let showLow = true;
let showMed = true;
let showHigh = true;
let showCommJet = true;
let showAirplane = true;
let showBizJet = true;
let showBProp = true;
let showHelo = true;
let showMil = true;
let showFarm = true;
let showOther = true;
let controlsCollapsed = false;
let rangeRingLayers = []; // Stores range rings and labels

// Map Base Tile Layers & State
let baseTileLayers = {};
let darkMatter, osm, voyager, satellite;
let radarLayer = null;

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
    document.getElementById('toggle-radar').checked = showRadar;
    document.getElementById('toggle-low').checked = showLow;
    document.getElementById('toggle-med').checked = showMed;
    document.getElementById('toggle-high').checked = showHigh;
    document.getElementById('filter-comm-jet').checked = showCommJet;
    document.getElementById('filter-airplane').checked = showAirplane;
    document.getElementById('filter-biz-jet').checked = showBizJet;
    document.getElementById('filter-biz-prop').checked = showBProp;
    document.getElementById('filter-helo').checked = showHelo;
    document.getElementById('filter-mil').checked = showMil;
    document.getElementById('filter-farm').checked = showFarm;
    document.getElementById('filter-other').checked = showOther;
    
    // Automation state
    autoSearch = safeGetItem('kvpz_auto_search', 'false') === 'true';
    document.getElementById('toggle-auto-search').checked = autoSearch;
    
    // Gemini API Setup
    geminiApiKey = safeGetItem('kvpz_gemini_api_key', '');
    const geminiInput = document.getElementById('gemini-api-key');
    const geminiStatus = document.getElementById('gemini-status');
    if (geminiApiKey) {
        geminiInput.value = geminiApiKey;
        geminiStatus.textContent = "Saved";
        geminiStatus.style.color = "#4ade80"; // Green
    }
    
    document.getElementById('btn-save-gemini').addEventListener('click', (e) => {
        e.stopPropagation();
        const key = geminiInput.value.trim();
        if (key) {
            safeSetItem('kvpz_gemini_api_key', key);
            geminiApiKey = key;
            geminiStatus.textContent = "Saved";
            geminiStatus.style.color = "#4ade80";
        } else {
            safeRemoveItem('kvpz_gemini_api_key');
            geminiApiKey = '';
            geminiStatus.textContent = "Not Saved";
            geminiStatus.style.color = "var(--color-text-muted)";
        }
    });
    
    // Prevent dropdown from closing when clicking inside Gemini input
    geminiInput.addEventListener('click', e => e.stopPropagation());
    
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
    initRadar();
    
    // Load KVPZ operations log memory from localStorage & clean up 1-month-old logs
    loadOperationsLogMemory();
    updateOpsLog();
    updateCounters();
    
    fetchWeather();
    fetchTAF();
    fetchAircraftData();
    
    // Set up polling intervals
    setInterval(fetchAircraftData, UPDATE_INTERVAL);
    setInterval(fetchWeather, WEATHER_INTERVAL);
    setInterval(fetchTAF, TAF_INTERVAL);

    // TAF Station Tab Listeners
    document.querySelectorAll('#taf-tabs .taf-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#taf-tabs .taf-tab-btn').forEach(b => b.classList.remove('active'));
            const targetBtn = e.currentTarget;
            targetBtn.classList.add('active');
            activeTafStation = targetBtn.getAttribute('data-station');
            renderActiveTAF();
        });
    });

    // TAF View Mode Toggle Listeners (Plain Text vs Raw Code)
    document.querySelectorAll('#taf-view-toggle .taf-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('#taf-view-toggle .taf-tab-btn').forEach(b => b.classList.remove('active'));
            const targetBtn = e.currentTarget;
            targetBtn.classList.add('active');
            tafViewMode = targetBtn.getAttribute('data-mode');
            renderActiveTAF();
        });
    });

    // Weather Card Collapsible Toggle Listener
    const weatherCard = document.getElementById('weather-card');
    const weatherHeader = document.getElementById('weather-header');
    let weatherCollapsed = safeGetItem('kvpz_weather_card_collapsed') === 'true';

    if (weatherCard && weatherHeader) {
        if (weatherCollapsed) {
            weatherCard.classList.add('collapsed');
        }
        weatherHeader.addEventListener('click', (e) => {
            if (e.target.closest('.taf-tab-btn')) return;
            weatherCollapsed = !weatherCard.classList.contains('collapsed');
            weatherCard.classList.toggle('collapsed', weatherCollapsed);
            safeSetItem('kvpz_weather_card_collapsed', weatherCollapsed);
        });
    }

    // Top Active Runway Card Popover Toggle (for touch / mobile click)
    const topRunwayCard = document.getElementById('top-runway-card');
    const runwayPopover = document.getElementById('runway-popover');
    if (topRunwayCard && runwayPopover) {
        topRunwayCard.addEventListener('click', (e) => {
            runwayPopover.classList.toggle('active');
        });
        document.addEventListener('click', (e) => {
            if (!topRunwayCard.contains(e.target)) {
                runwayPopover.classList.remove('active');
            }
        });
    }

    // Operations Log Card Collapsible Toggle Listener
    const opsCard = document.getElementById('ops-card');
    const opsHeader = document.getElementById('ops-header');
    let opsCollapsed = safeGetItem('kvpz_ops_card_collapsed') === 'true';

    if (opsCard && opsHeader) {
        if (opsCollapsed) {
            opsCard.classList.add('collapsed');
        }
        opsHeader.addEventListener('click', (e) => {
            if (e.target.closest('#btn-clear-logs')) return;
            opsCollapsed = !opsCard.classList.contains('collapsed');
            opsCard.classList.toggle('collapsed', opsCollapsed);
            safeSetItem('kvpz_ops_card_collapsed', opsCollapsed);
        });
    }
    
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

    document.getElementById('toggle-radar').addEventListener('change', (e) => {
        showRadar = e.target.checked;
        saveMapSettings();
        updateRadarLayer();
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
    
    document.getElementById('toggle-auto-search').addEventListener('change', (e) => {
        autoSearch = e.target.checked;
        safeSetItem('kvpz_auto_search', autoSearch);
        updateUI(); // Immediately trigger searches if enabled
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

    document.getElementById('filter-biz-prop').addEventListener('change', (e) => {
        showBProp = e.target.checked;
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

    document.getElementById('filter-farm').addEventListener('change', (e) => {
        showFarm = e.target.checked;
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

    // Check FAA Scraper Health Status on load and every 5 seconds
    checkFAAScraperHealth();
    setInterval(checkFAAScraperHealth, 5000);
});

let isFAAScraperOnline = false;

async function checkFAAScraperHealth() {
    const badgeText = document.getElementById('faa-scraper-text');
    const badgeContainer = document.getElementById('faa-scraper-badge');
    if (!badgeText || !badgeContainer) return;
    
    const endpoints = [
        `${window.location.origin}/health`,
        'http://localhost:8080/health',
        'http://127.0.0.1:8080/health',
        'http://localhost:3001/health',
        'http://127.0.0.1:3001/health',
        `${window.location.origin}/faa?tail=N83HS`,
        'http://localhost:8080/faa?tail=N83HS',
        'http://127.0.0.1:8080/faa?tail=N83HS',
        'http://localhost:3001/faa?tail=N83HS',
        'http://127.0.0.1:3001/faa?tail=N83HS'
    ];
    
    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const d = await res.json();
                if (d && (d.status === 'ok' || d.source || d.model || d.type)) {
                    isFAAScraperOnline = true;
                    badgeText.textContent = "FAA Scraper: Online (100% Official FAA Data)";
                    badgeContainer.style.background = "rgba(16, 185, 129, 0.15)";
                    badgeContainer.style.borderColor = "#10b981";
                    badgeContainer.style.color = "#10b981";
                    badgeContainer.title = "Direct local FAA Registry & FlightAware scraper proxy is active and operational";
                    return;
                }
            }
        } catch(e) {}
    }
    
    // Offline state
    isFAAScraperOnline = false;
    if (window.location.protocol === 'https:') {
        badgeText.textContent = "FAA Scraper: Offline (Open http://localhost:8080 for FAA Scraper)";
        badgeContainer.title = "Browser blocks local HTTP server on HTTPS GitHub Pages. To use local FAA Scraper, run python verify_build.py and open http://localhost:8080";
    } else {
        badgeText.textContent = "FAA Scraper: Offline (ADSBdb Active)";
        badgeContainer.title = "Local FAA Scraper proxy is not running on port 8080 or 3001. Run python verify_build.py or node faa_server.js to start it.";
    }
    badgeContainer.style.background = "rgba(245, 158, 11, 0.15)";
    badgeContainer.style.borderColor = "#f59e0b";
    badgeContainer.style.color = "#f59e0b";
}

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
    if (typeClass === 'business-prop') return showBProp;
    if (typeClass === 'helicopter') return showHelo;
    if (typeClass === 'military') return showMil;
    if (typeClass === 'farm') return showFarm;
    return showOther;
}

function getAircraftCategory(ac) {
    // 1. Military (check mil flag from feed)
    if (ac.mil === 1 || ac.mil === true || ac.mil === '1' || String(ac.mil).toLowerCase() === 'true') {
        return 'military';
    }

    const callsign = (ac.flight || ac.callsign || ac.r || '').trim().toUpperCase();
    const tail = (ac.r || ac.tail || '').trim().toUpperCase();
    const desc = (ac.desc || '').toLowerCase();
    const type = (ac.t || ac.type || '').toLowerCase();
    const cat = (ac.category || '');
    const op = (ac.ownOp || ac.operator || '').toLowerCase();

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
    
    // 2. Exact exhaustive dictionary match (over 8000+ codes loaded from icao_categories.js)
    const upperType = type.toUpperCase();
    if (typeof ICAO_CATEGORIES !== 'undefined' && ICAO_CATEGORIES[upperType]) {
        // If it's a known helicopter or military, trust the dictionary immediately
        if (ICAO_CATEGORIES[upperType] === 'helicopter') return 'helicopter';
        if (ICAO_CATEGORIES[upperType] === 'military') return 'military';
        
        // However, if the dictionary says it's a general airplane/bizjet but our callsign heuristic says it's military, trust the military heuristic
        if (isMilCallsign || (isPurelyNumericTail && isCallsignDiffFromTail)) {
            return 'military';
        }
        
        return ICAO_CATEGORIES[upperType];
    }
    
    // Fallback: If dictionary didn't have it, rely on military callsign/tail heuristic
    if (isMilCallsign || (isPurelyNumericTail && isCallsignDiffFromTail)) {
        return 'military';
    }
    
    // 3. Helicopters (Fallback description checks)
    const isHelo = desc.includes('helicopter') || desc.includes('rotorcraft') || desc.includes('copter') || 
                   desc.includes('bell') || desc.includes('sikorsky') || desc.includes('agusta') || 
                   desc.includes('robinson') || desc.includes('eurocopter') || desc.includes('airbus helicopters') ||
                   type.startsWith('r22') || type.startsWith('r44') || type.startsWith('r66') || 
                   type.startsWith('b206') || type.startsWith('b06') || type.startsWith('b407') || type.startsWith('b412') || type.startsWith('b429') || type.startsWith('b505') || 
                   type.startsWith('as50') || type.startsWith('as35') || type.startsWith('ec30') || 
                   type.startsWith('ec20') || type.startsWith('uh60') || type.startsWith('uh1') || 
                   type.startsWith('ah64') || type.startsWith('ch47') || type.includes('h60') || 
                   type.includes('ec35') || type.startsWith('s76') || type.startsWith('s92') || type.startsWith('aw1') || cat === 'A7';
    if (isHelo) return 'helicopter';

    // 3. Business Jets (common corporate jet types and manufacturers)
    const isBizJet = desc.includes('gulfstream') || desc.includes('citation') || 
                     desc.includes('challenger') || desc.includes('falcon') || 
                     desc.includes('learjet') || desc.includes('hawker') || 
                     desc.includes('phenom') || desc.includes('global express') || 
                     desc.includes('sovereign') || desc.includes('premier') || desc.includes('honda') || desc.includes('pilatus pc-24') ||
                     type.startsWith('cl30') || type.startsWith('cl60') || type.startsWith('cl35') ||
                     type.startsWith('glf') || type.startsWith('glex') || type.startsWith('gl5t') ||
                     type.startsWith('gl6t') || type.startsWith('c25a') || type.startsWith('c25b') ||
                     type.startsWith('c510') || type.startsWith('c525') || type.startsWith('c560') ||
                     type.startsWith('c56x') || type.startsWith('c680') || type.startsWith('c750') ||
                     type.startsWith('c700') || type.startsWith('lr35') || type.startsWith('lr45') ||
                     type.startsWith('lr60') || type.startsWith('fa20') || type.startsWith('fa50') ||
                     type.startsWith('fa7x') || type.startsWith('fa8x') || type.startsWith('e55p') ||
                     type.startsWith('e50p') || type.startsWith('pc24') || type.startsWith('h25b') || type.startsWith('hond') ||
                     type.includes('cl30') || type.includes('cl60') || type.includes('glf') ||
                     type.includes('c510') || type.includes('c525') || type.includes('c560') ||
                     type.includes('c680') || type.includes('c750') || type.includes('lr35') ||
                     type.includes('lr45') || type.includes('lr60') || type.includes('fa20') ||
                     type.includes('fa50') || type.includes('e55p') || type.includes('e50p');
    if (isBizJet) return 'business-jet';

    // 3.5 Business Props (Turboprops, PC-12, King Airs, TBMs, Caravans, etc.)
    const isBizProp = desc.includes('turboprop') || desc.includes('pc-12') || desc.includes('pc12') ||
                      desc.includes('king air') || desc.includes('tbm') || desc.includes('caravan') ||
                      desc.includes('meridian') || desc.includes('conquest') || desc.includes('avanti') || desc.includes('kodiak') ||
                      type.startsWith('pc12') || type.startsWith('pc6') || type.startsWith('be20') || type.startsWith('be30') ||
                      type.startsWith('b200') || type.startsWith('b350') || type.startsWith('be9') ||
                      type.startsWith('tbm') || type.startsWith('c208') || type.startsWith('p46t') ||
                      type.startsWith('p180') || type.startsWith('kodi') || type.startsWith('ac69') ||
                      type.startsWith('c441') || type.startsWith('c425') || type.startsWith('sw4') || type.startsWith('pay') ||
                      type.startsWith('c402') || type.startsWith('c414') || type.startsWith('c421') || type.startsWith('pa31');
    if (isBizProp) return 'business-prop';

    // 4. Commercial Jets (large airline passenger/cargo jets)
    const isCommJet = desc.includes('boeing') || desc.includes('airbus') || 
                      desc.includes('embraer') || desc.includes('bombardier') ||
                      desc.includes('md-8') || desc.includes('md-11') || desc.includes('dc-10') ||
                      type.startsWith('b73') || type.startsWith('b74') || type.startsWith('b75') ||
                      type.startsWith('b76') || type.startsWith('b77') || type.startsWith('b78') ||
                      type.startsWith('a31') || type.startsWith('a32') || type.startsWith('a33') ||
                      type.startsWith('a34') || type.startsWith('a35') || type.startsWith('a38') ||
                      type.startsWith('b38m') || type.startsWith('b39m') || type.startsWith('a20') ||
                      type.startsWith('crj') || type.startsWith('erj') ||
                      type.startsWith('e17') || type.startsWith('e19') || type.startsWith('e14') ||
                      op.includes('airline') || op.includes('airways') || op.includes('cargo') ||
                      op.includes('delta') || op.includes('united') || op.includes('american') ||
                      op.includes('southwest') || op.includes('fedex') || op.includes('ups') ||
                      op.includes('dhl') || op.includes('spirit') || op.includes('frontier') ||
                      op.includes('alaska') || op.includes('jetblue') || op.includes('allegiant');
    if (isCommJet) return 'commercial-jet';

    // 5. Airplane (general aviation, single/multi engine props, turboprops)
    const isAirplane = desc.includes('single-engine') || desc.includes('multi-engine') ||
                       desc.includes('cessna') || desc.includes('piper') || 
                       desc.includes('beech') || desc.includes('cirrus') || 
                       desc.includes('diamond') || desc.includes('mooney') ||
                       desc.includes('prop') || desc.includes('piston') || desc.includes('turboprop') || desc.includes('pilatus') || desc.includes('socata') || desc.includes('tbm') ||
                       type.startsWith('c15') || type.startsWith('c17') || type.startsWith('c18') ||
                       type.startsWith('c20') || type.startsWith('c21') || type.startsWith('pa2') ||
                       type.startsWith('pa3') || type.startsWith('pa4') || type.startsWith('be3') ||
                       type.startsWith('be5') || type.startsWith('sr2') || type.startsWith('moo') ||
                       type.startsWith('da4') || type.startsWith('da2') || type.startsWith('pc12') || type.startsWith('tbm');
    if (isAirplane) return 'airplane';

    // 6. Catch-all: Anything that HAS a known type or description should default to 'airplane' 
    // instead of 'other'. Only truly unknown/missing data should be 'other'.
    const hasType = type && type !== 'n/a' && type !== 'unknown' && type !== 'srch';
    const hasDesc = desc && desc !== 'n/a' && desc !== 'unknown';
    
    if (hasType || hasDesc) {
        return 'airplane';
    }

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

        // Calculate Active Runway & Wind Components for KVPZ (Runways 09/27 and 18/36)
        const windDirDeg = props.windDirection && props.windDirection.value !== null ? Math.round(props.windDirection.value) : null;
        updateRunwayWindCalculator(windDirDeg, windSpeedKnots);
        
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

// 3a. Active Runway & Wind Component Calculator
function updateRunwayWindCalculator(windDirDeg, windSpeedKnots) {
    const topVal = document.getElementById('top-active-runway-val');
    const topSub = document.getElementById('top-runway-wind-sub');
    const popoverSummary = document.getElementById('top-popover-wind-summary');
    const grid = document.getElementById('runway-grid');
    if (!grid || !topVal) return;

    // KVPZ Runways (Magnetic Headings: RWY 09 (092°), RWY 27 (272°), RWY 18 (182°), RWY 36 (002°))
    const runways = [
        { id: '09', name: 'RWY 09', hdg: 92, label: '092°' },
        { id: '27', name: 'RWY 27', hdg: 272, label: '272°' },
        { id: '18', name: 'RWY 18', hdg: 182, label: '182°' },
        { id: '36', name: 'RWY 36', hdg: 2, label: '002°' }
    ];

    const isCalm = (windSpeedKnots === 0);
    const isVrb = (windDirDeg === null || isNaN(windDirDeg));

    if (isCalm || isVrb) {
        topVal.textContent = 'RWY 09/27';
        topVal.style.color = 'var(--accent-cyan)';
        if (topSub) topSub.textContent = isCalm ? 'Calm' : 'VRB';
        if (popoverSummary) popoverSummary.textContent = isCalm ? 'Wind Calm' : 'Variable Wind';

        grid.innerHTML = runways.map(rwy => `
            <div style="background: rgba(31, 41, 55, 0.4); border-radius: 4px; padding: 0.35rem 0.5rem;">
                <div style="font-weight: 600; color: var(--color-text); font-size: 0.7rem;">${rwy.name} <span style="font-size:0.62rem; color:var(--color-text-muted);">(${rwy.label})</span></div>
                <div style="color: var(--color-text-muted); font-size: 0.65rem; margin-top:0.1rem;">${isCalm ? 'Calm Wind' : 'Variable Wind'}</div>
            </div>
        `).join('');
        return;
    }

    let maxHeadwind = -999;
    let recommendedRwy = runways[0];

    const computed = runways.map(rwy => {
        const rad = (windDirDeg - rwy.hdg) * Math.PI / 180;
        const hw = Math.round(windSpeedKnots * Math.cos(rad));
        const xw = Math.round(windSpeedKnots * Math.sin(rad));

        if (hw > maxHeadwind) {
            maxHeadwind = hw;
            recommendedRwy = rwy;
        }

        return { ...rwy, hw, xw };
    });

    const bestHW = computed.find(r => r.id === recommendedRwy.id);
    topVal.textContent = recommendedRwy.name;
    topVal.style.color = '#10b981';
    if (topSub) {
        topSub.textContent = bestHW && bestHW.hw >= 0 ? `+${bestHW.hw} KT HW` : `Tailwind`;
    }
    if (popoverSummary) {
        popoverSummary.textContent = `${String(windDirDeg).padStart(3, '0')}° @ ${windSpeedKnots} KT`;
    }

    grid.innerHTML = computed.map(rwy => {
        const isBest = (rwy.id === recommendedRwy.id);
        const hwColor = rwy.hw >= 0 ? '#10b981' : '#ef4444';
        const hwLabel = rwy.hw >= 0 ? `${rwy.hw} KT Headwind` : `${Math.abs(rwy.hw)} KT Tailwind`;
        const xwLabel = rwy.xw === 0 ? '0 KT X-Wind' : `${Math.abs(rwy.xw)} KT X-Wind (${rwy.xw > 0 ? 'R' : 'L'})`;
        const bgStyle = isBest 
            ? 'background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981;' 
            : 'background: rgba(31, 41, 55, 0.4); border: 1px solid transparent;';

        return `
            <div style="${bgStyle} border-radius: 4px; padding: 0.35rem 0.5rem; transition: all 0.2s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; color: ${isBest ? '#10b981' : 'var(--color-text)'}; font-size: 0.7rem;">
                    <span>${rwy.name}</span>
                    <span style="font-size: 0.62rem; color: var(--color-text-muted);">${rwy.label}</span>
                </div>
                <div style="color: ${hwColor}; font-size: 0.65rem; font-weight: 600; margin-top: 0.1rem;">${hwLabel}</div>
                <div style="color: var(--color-text-muted); font-size: 0.62rem;">${xwLabel}</div>
            </div>
        `;
    }).join('');
}

// 3b. TAF (Terminal Aerodrome Forecast) Handling for KGYY, KSBN, KLAF
async function fetchTAF() {
    const tafBox = document.getElementById('taf-content-box');
    if (!tafBox) return;
    
    // 1. Primary: Official NOAA NWS API (Native CORS Support)
    try {
        const response = await fetch('https://api.weather.gov/products/types/TAF', {
            headers: { 'User-Agent': 'KVPZ-Tracker (contact@example.com)' }
        });
        if (response.ok) {
            const data = await response.json();
            const graph = data['@graph'] || [];
            const targetOffices = ['KLOT', 'KIWX', 'KIND'];
            const officeItems = graph.filter(x => targetOffices.includes(x.issuingOffice));

            for (const item of officeItems.slice(0, 15)) {
                if (tafDataMap['KGYY'] && tafDataMap['KSBN'] && tafDataMap['KLAF']) break;
                
                const pr = await fetch(item['@id'], {
                    headers: { 'User-Agent': 'KVPZ-Tracker (contact@example.com)' }
                });
                if (pr.ok) {
                    const pd = await pr.json();
                    const txt = pd.productText || '';
                    
                    ['KGYY', 'KSBN', 'KLAF'].forEach(stn => {
                        if (!tafDataMap[stn] && txt.includes(stn)) {
                            let cleanText = txt.trim();
                            const idx = cleanText.indexOf(stn + ' ');
                            if (idx !== -1) {
                                cleanText = 'TAF ' + cleanText.substring(idx).trim();
                            }
                            tafDataMap[stn] = { rawTAF: cleanText, name: stn };
                        }
                    });
                }
            }
        }
    } catch (e) {
        console.warn("NWS TAF fetch failed:", e);
    }

    // 2. Secondary: Fallback via AllOrigins Proxy for AviationWeather.gov
    if (!tafDataMap['KGYY'] || !tafDataMap['KSBN'] || !tafDataMap['KLAF']) {
        try {
            const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent('https://aviationweather.gov/api/data/taf?ids=KGYY,KSBN,KLAF&format=json');
            const res = await fetch(proxyUrl);
            if (res.ok) {
                const proxyData = await res.json();
                if (proxyData && proxyData.contents) {
                    const parsed = JSON.parse(proxyData.contents);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(item => {
                            const stn = (item.icaoId || item.name || '').toUpperCase();
                            if (stn && item.rawTAF) {
                                tafDataMap[stn] = { rawTAF: item.rawTAF, name: item.name || stn };
                            }
                        });
                    }
                }
            }
        } catch (e) {
            console.warn("Proxy TAF fetch failed:", e);
        }
    }

    renderActiveTAF();
}

function convertUTCToKVPZLocal(dayStr, hourStr, minStr = '00') {
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth();
    const day = parseInt(dayStr);
    const hour = parseInt(hourStr);
    const min = parseInt(minStr);

    if (day < now.getUTCDate() - 15) {
        month += 1;
    }

    const utcDate = new Date(Date.UTC(year, month, day, hour, min));

    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
    }).format(utcDate);
}

const WX_CODES = {
    'TSRA': 'Thunderstorms & Rain',
    '+TSRA': 'Heavy Thunderstorms & Rain',
    '-TSRA': 'Light Thunderstorms & Rain',
    'TS': 'Thunderstorms',
    '-RA': 'Light Rain',
    'RA': 'Rain',
    '+RA': 'Heavy Rain',
    '-SN': 'Light Snow',
    'SN': 'Snow',
    '+SN': 'Heavy Snow',
    'BR': 'Mist / Fog',
    'FG': 'Dense Fog',
    'HZ': 'Haze',
    'DZ': 'Drizzle',
    'FZRA': 'Freezing Rain',
    'SHRA': 'Rain Showers',
    '-SHRA': 'Light Rain Showers',
    '+SHRA': 'Heavy Rain Showers',
    'VCSH': 'Rain Showers Nearby',
    'VCTS': 'Thunderstorms Nearby',
    'NSW': 'No Significant Weather'
};

function decodeWind(w) {
    if (w === '00000KT' || w === '00000') return 'Wind Calm';
    const m = w.match(/^(\d{3}|VRB)(\d{2,3})(G\d{2,3})?KT$/);
    if (!m) return w;
    const dir = m[1] === 'VRB' ? 'Variable' : m[1] + '°';
    const speed = parseInt(m[2]) + ' KT';
    const gust = m[3] ? ` (Gusts ${parseInt(m[3].substring(1))} KT)` : '';
    return `Wind ${dir} @ ${speed}${gust}`;
}

function decodeVis(v) {
    if (v === 'P6SM') return 'Vis > 6 SM';
    if (v.endsWith('SM')) return `Vis ${v.replace('SM', '')} SM`;
    return v;
}

function decodeCloud(c) {
    const m = c.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})$/);
    if (!m) return c;
    const types = { FEW: 'Few', SCT: 'Scattered', BKN: 'Broken (Ceiling)', OVC: 'Overcast (Ceiling)', VV: 'Vertical Vis' };
    const alt = parseInt(m[2]) * 100;
    return `${types[m[1]]} ${alt.toLocaleString()} ft`;
}

function decodeTAFText(raw) {
    if (!raw) return '';
    const cleanRaw = raw.replace(/=/g, '').trim();
    const tokens = cleanRaw.split(/\s+/);
    const outputLines = [];
    let currentLine = [];
    let headerStr = '';

    for (let i = 0; i < tokens.length; i++) {
        const tok = tokens[i];
        if (tok === 'TAF') continue;
        if (/^[A-Z]{4}$/.test(tok) && i <= 1) continue; // Station ID
        if (/^\d{6}Z$/.test(tok)) continue; // Issue timestamp
        if (/^\d{4}\/\d{4}$/.test(tok) && !headerStr) {
            const startDay = tok.substring(0, 2);
            const startHr = tok.substring(2, 4);
            const endDay = tok.substring(5, 7);
            const endHr = tok.substring(7, 9);
            const startLocal = convertUTCToKVPZLocal(startDay, startHr);
            const endLocal = convertUTCToKVPZLocal(endDay, endHr);
            headerStr = `• Valid (KVPZ Local): ${startLocal} to ${endLocal}`;
            continue;
        }

        if (tok.startsWith('FM')) {
            if (currentLine.length > 0) {
                outputLines.push(currentLine.join(' '));
                currentLine = [];
            }
            const day = tok.substring(2, 4);
            const hr = tok.substring(4, 6);
            const min = tok.substring(6, 8);
            const localTime = convertUTCToKVPZLocal(day, hr, min);
            currentLine.push(`\n• From ${localTime}:`);
            continue;
        }

        if (tok === 'TEMPO' || tok === 'BECMG' || tok.startsWith('PROB')) {
            if (currentLine.length > 0) {
                outputLines.push(currentLine.join(' '));
                currentLine = [];
            }
            const label = tok.startsWith('PROB') ? `${tok.replace('PROB', '')}% Chance` : (tok === 'TEMPO' ? 'Temporary' : 'Becoming');
            
            let rangeText = '';
            if (tokens[i + 1] && /^\d{4}\/\d{4}$/.test(tokens[i + 1])) {
                const rng = tokens[i + 1];
                const sL = convertUTCToKVPZLocal(rng.substring(0, 2), rng.substring(2, 4));
                const eL = convertUTCToKVPZLocal(rng.substring(5, 7), rng.substring(7, 9));
                rangeText = ` (${sL} to ${eL})`;
                i++; // Skip range token
            }

            currentLine.push(`\n• ${label}${rangeText}:`);
            continue;
        }

        if (tok.endsWith('KT') || tok === '00000KT') {
            currentLine.push(decodeWind(tok));
        } else if (tok.endsWith('SM') || tok === 'P6SM') {
            currentLine.push(decodeVis(tok));
        } else if (/^(FEW|SCT|BKN|OVC|VV)\d{3}$/.test(tok)) {
            currentLine.push(decodeCloud(tok));
        } else if (tok === 'SKC' || tok === 'CLR' || tok === 'NSC') {
            currentLine.push('Clear Sky');
        } else if (WX_CODES[tok]) {
            currentLine.push(WX_CODES[tok]);
        } else {
            currentLine.push(tok);
        }
    }

    if (currentLine.length > 0) {
        outputLines.push(currentLine.join(' '));
    }

    return (headerStr ? headerStr + '\n' : '') + outputLines.join('\n');
}

function renderActiveTAF() {
    const tafBox = document.getElementById('taf-content-box');
    const stationTitle = document.getElementById('taf-station-title');
    if (!tafBox) return;

    const stationNames = {
        'KGYY': 'Gary Intl (22 NM West)',
        'KSBN': 'South Bend (35 NM East)',
        'KLAF': 'Purdue Univ / Lafayette (60 NM South)'
    };
    if (stationTitle) {
        stationTitle.textContent = stationNames[activeTafStation] || activeTafStation;
    }
    
    const tafObj = tafDataMap[activeTafStation];
    if (!tafObj || !tafObj.rawTAF) {
        tafBox.innerHTML = `<span style="color: var(--color-text-muted); font-style: italic; font-family: var(--font-sans);">No TAF forecast available for ${activeTafStation}.</span>`;
        return;
    }
    
    const raw = tafObj.rawTAF;
    if (tafViewMode === 'decoded') {
        const decoded = decodeTAFText(raw);
        tafBox.innerHTML = `<div style="font-family: var(--font-sans); line-height: 1.45;">${escapeHtml(decoded)}</div>`;
    } else {
        // Format raw TAF with line breaks for forecast change groups (FM, TEMPO, BECMG, PROB)
        const formatted = raw
            .replace(/\s+(FM\d{6})/g, '\n  $1')
            .replace(/\s+(TEMPO\s+\d{4}\/\d{4})/g, '\n  $1')
            .replace(/\s+(BECMG\s+\d{4}\/\d{4})/g, '\n  $1')
            .replace(/\s+(PROB\d{2}\s+\d{4}\/\d{4})/g, '\n  $1');
        tafBox.innerHTML = `<div style="font-family: var(--font-mono); line-height: 1.4;">${escapeHtml(formatted)}</div>`;
    }
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
        
        const url = `https://api.airplanes.live/v2/point/${latStr}/${lonStr}/${radiusNM}`;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP Error ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data || !data.ac) {
            throw new Error("Invalid format received from ADSB source");
        }
        
        const mergedList = data.ac;
        
        pulseIndicator.className = "pulse-indicator status-live";
        statusText.textContent = `Airplanes.live Active (${radiusNM} NM Coverage) • Updated ${new Date().toLocaleTimeString([], {hour12:false})}`;
        
        processAircraft(mergedList);
        await fetchSpidertracksFeed();
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
        let tail = ac.r || 'N/A';
        let type = ac.t || 'N/A';
        let desc = ac.desc || 'N/A';
        let operator = ac.ownOp || 'N/A';
        const alt = ac.alt_baro === 'ground' ? 0 : (parseInt(ac.alt_baro) || 0);
        const speed = parseInt(ac.gs) || 0;
        const vspeed = parseInt(ac.baro_rate) || 0;
        const heading = parseInt(ac.track) || 0;
        const lat = ac.lat;
        const lon = ac.lon;
        // Always calculate geodesic distance relative to KVPZ coordinates to prevent map panning from affecting operations logging
        const dist = (lat && lon) ? getDistanceNM(lat, lon, KVPZ_COORDS[0], KVPZ_COORDS[1]) : 999.0;
        const category = ac.category || '';
        
        // Prevent raw radar feed from wiping out data we worked hard to find via background search!
        const hexKey = hex.toLowerCase();
        const cachedDb = aircraftInfoDb[hexKey];
        const prevState = aircraftCache[hex];
        
        const preserveData = (current, dbVal, prevVal, isManual) => {
            if (isManual && dbVal && dbVal !== 'N/A' && dbVal !== 'Unknown' && dbVal !== '') {
                return dbVal; // Manual overrides everything
            }
            if (!current || current === 'N/A' || current === 'Unknown' || current === '') {
                if (dbVal && dbVal !== 'N/A' && dbVal !== 'Unknown' && dbVal !== '') return dbVal;
                if (prevVal && prevVal !== 'N/A' && prevVal !== 'Unknown' && prevVal !== '') return prevVal;
            }
            return current || 'N/A';
        };

        const isManual = cachedDb && cachedDb.manual;
        tail = preserveData(tail, cachedDb?.tail, prevState?.tail, isManual);
        type = preserveData(type, cachedDb?.type, prevState?.type, isManual);
        desc = preserveData(desc, cachedDb?.desc, prevState?.desc, isManual);
        operator = preserveData(operator, cachedDb?.operator, prevState?.operator, isManual);
        if (operator === 'N/A') operator = 'Private';
        
        // Manual Military Override
        if (cachedDb && cachedDb.manualMil) {
            ac.mil = cachedDb.mil;
        } else if (prevState && prevState.mil !== undefined) {
            ac.mil = ac.mil || prevState.mil; // Preserve mil if previously set
        }
        
        const categoryClass = getAircraftCategory({
            ...ac,
            callsign, tail, type, desc, operator
        });
        
        const currentState = {
            hex, callsign, tail, type, desc, alt, speed, vspeed, heading, dist, operator, lat, lon, category, categoryClass,
            mil: ac.mil,
            lastSeen: now
        };
        
        // Operations State Logic (Check KVPZ-exclusive transitions from cache)
        

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
                logOperation(hex, callsign, type, 'arrival', `Landed KVPZ (Speed: ${speed} KT, Alt: ${alt} FT)`, tail);
                currentState.logged = true;
            }
            
            // 2. KVPZ DEPARTURE TRIGGER (Ground to Air takeoff transition)
            if (prevState.dist < 2.5 && prevState.alt < 1500 && vspeed > 200 && !prevState.logged && !currentState.logged) {
                logOperation(hex, callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`, tail);
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
                logOperation(hex, callsign, type, 'departure', `Departed KVPZ, climbing through ${alt} ft`, tail);
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
                logOperation(hex, callsign, type, 'arrival', `Geofence Landing KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`, tail);
            } else {
                logOperation(hex, callsign, type, 'departure', `Geofence Departure KVPZ (Alt: ${alt} FT, Dist: ${dist.toFixed(2)} NM)`, tail);
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
                logOperation(lastState.hex, lastState.callsign, lastState.type, 'arrival', `Landed KVPZ (Last seen ${lastState.dist.toFixed(1)} NM out, ${lastState.alt} FT)`, lastState.tail);
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

let markerColorMode = safeGetItem('kvpz_marker_color_mode', 'altitude'); // 'altitude' or 'speed'

function getAircraftColor(ac) {
    if (markerColorMode === 'speed') {
        const speed = Math.max(0, parseInt(ac.speed) || 0);
        if (speed < 40) return '#9ca3af'; // Ground / Taxiing (< 40 KT): Cool Silver / Gray
        if (speed < 100) return '#22c55e'; // Slow GA Flight (40 - 100 KT): Neon Lime Green
        if (speed < 180) return '#f59e0b'; // Medium Prop / Twin (100 - 180 KT): Bright Amber Yellow
        if (speed < 300) return '#ff6600'; // Fast Turboprop / Light Jet (180 - 300 KT): Vibrant Orange
        if (speed < 450) return '#ef4444'; // High Speed Jet / Airliner (300 - 450 KT): Electric Crimson Red
        return '#d946ef'; // 450+ KT Supersonic / Jet: Electric Magenta Pink
    }

    // Color Mode: Altitude (High-Contrast Popping Spectrum)
    const alt = Math.max(0, parseInt(ac.alt) || 0);
    if (alt < 1000) return '#ff4500'; // Surface / Ground (< 1,000 FT): Intense Orange-Red
    if (alt < 3000) return '#ffcc00'; // Pattern / Low (1,000 - 3,000 FT): Vivid Canary Yellow
    if (alt < 7000) return '#00ff66'; // Low Cruise (3,000 - 7,000 FT): Electric Neon Green
    if (alt < 14000) return '#00f0ff'; // Mid Cruise (7,000 - 14,000 FT): Vibrant Cyan / Electric Turquoise
    if (alt < 25000) return '#3b82f6'; // High Jet (14,000 - 25,000 FT): Royal Electric Blue
    if (alt < 36000) return '#a855f7'; // FL300 High Jet (25,000 - 36,000 FT): Deep Purple
    return '#ec4899'; // FL360+ Ultra High (> 36,000 FT): Electric Magenta / Hot Pink
}

window.setMarkerColorMode = function(mode) {
    markerColorMode = mode;
    safeSetItem('kvpz_marker_color_mode', mode);
    
    const btnAlt = document.getElementById('btn-color-altitude');
    const btnSpd = document.getElementById('btn-color-speed');
    if (btnAlt && btnSpd) {
        btnAlt.classList.toggle('active', mode === 'altitude');
        btnSpd.classList.toggle('active', mode === 'speed');
    }
    
    Object.values(aircraftCache).forEach(ac => {
        if (ac.lat && ac.lon) {
            updateMapMarker(ac);
        }
    });
};

function getAircraftIconSvg(ac, color) {
    const type = (ac.type || ac.t || '').toUpperCase();
    const desc = (ac.desc || '').toUpperCase();
    const cat = (ac.categoryClass || '').toLowerCase();
    const heading = ac.heading || 0;

    const matchType = (codes) => codes.some(c => {
        if (type === c) return true;
        const typeTokens = type.split(/[\s\-\/]+/);
        if (typeTokens.includes(c)) return true;
        const descTokens = desc.split(/[\s\-\/]+/);
        if (descTokens.includes(c)) return true;
        // For longer multi-word string keywords (e.g. 'BLACK HAWK', 'KING AIR', 'AIR TRACTOR')
        if (c.length > 4 && (type.includes(c) || desc.includes(c))) return true;
        return false;
    });

    // 1. CH-47 Chinook / MH-47 Special Ops (Tandem 2-Rotor Heavy Transport)
    if (matchType(['H47','CH47','CH46','MH47','CHINOOK'])) {
        return `<svg class="plane-icon-svg" width="34" height="34" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Long tandem fuselage with twin engine pods -->
            <rect x="206" y="80" width="100" height="352" rx="42" fill="${color}" stroke="#090d16" stroke-width="14" />
            <rect x="180" y="320" width="26" height="70" rx="6" fill="#090d16"/>
            <rect x="306" y="320" width="26" height="70" rx="6" fill="#090d16"/>
            <!-- Front 3-Blade Rotor -->
            <circle cx="256" cy="110" r="16" fill="#fff" stroke="#090d16" stroke-width="6" />
            ${[0, 120, 240].map(ang => `<rect x="248" y="10" width="16" height="200" rx="4" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 15}, 256, 110)"/>`).join('')}
            <!-- Rear 3-Blade Rotor -->
            <circle cx="256" cy="402" r="16" fill="#fff" stroke="#090d16" stroke-width="6" />
            ${[0, 120, 240].map(ang => `<rect x="248" y="302" width="16" height="200" rx="4" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 75}, 256, 402)"/>`).join('')}
        </svg>`;
    }

    // 2. CH-53E Super Stallion / CH-53K King Stallion / MH-53 Pave Low (Massive 7-Blade Lift Helicopter with Refueling Probe)
    if (matchType(['H53','CH53','MH53','STALLION','SUPER STALLION','KING STALLION','PAVE LOW'])) {
        return `<svg class="plane-icon-svg" width="36" height="36" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Massive sponson body -->
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,110 L 225,150 L 175,200 L 175,280 L 225,270 L 225,410 L 240,460 L 272,460 L 287,410 L 287,270 L 337,280 L 337,200 L 287,150 Z"/>
            <!-- In-Flight Refueling Probe on Right Nose -->
            <line x1="287" y1="170" x2="310" y2="40" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <line x1="287" y1="170" x2="310" y2="40" stroke="${color}" stroke-width="5" stroke-linecap="round"/>
            <!-- 7-Blade Rotor Hub -->
            ${[0, 51.4, 102.8, 154.2, 205.6, 257, 308.4].map(ang => `<rect x="248" y="10" width="16" height="246" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="24" fill="#fff" stroke="#090d16" stroke-width="7"/>
        </svg>`;
    }

    // 3. AH-64 Apache (Tandem Cockpit, 30mm Chain Gun, Stub Wings & Rocket Pods)
    if (matchType(['H64','AH64','APACHE'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Apache Sponson Nose & Cannon -->
            <line x1="256" y1="90" x2="256" y2="50" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,90 L 235,140 L 165,220 L 165,250 L 235,240 L 235,420 L 245,460 L 267,460 L 277,420 L 277,240 L 347,250 L 347,220 L 277,140 Z"/>
            <!-- 4 Rocket Pods -->
            <rect x="145" y="220" width="18" height="35" rx="4" fill="#090d16"/>
            <rect x="349" y="220" width="18" height="35" rx="4" fill="#090d16"/>
            <!-- 4-Blade Main Rotor -->
            ${[0, 90, 180, 270].map(ang => `<rect x="246" y="30" width="20" height="226" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 15}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 4. AH-1Z Viper / AH-1 SuperCobra (Ultra-Narrow Marine Attack Helicopter)
    if (matchType(['AH1','H1','COBRA','VIPER','SUPERCOBRA'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Pencil thin attack fuselage -->
            <path fill="${color}" stroke="#090d16" stroke-width="13" d="M 256,70 L 242,120 L 210,210 L 210,230 L 242,220 L 242,430 L 256,460 L 270,430 L 270,220 L 302,230 L 302,210 L 270,120 Z"/>
            <!-- Wingtip Missile Rails -->
            <line x1="200" y1="200" x2="200" y2="240" stroke="#090d16" stroke-width="6"/>
            <line x1="312" y1="200" x2="312" y2="240" stroke="#090d16" stroke-width="6"/>
            <!-- 4-Blade Rotor -->
            ${[0, 90, 180, 270].map(ang => `<rect x="248" y="25" width="16" height="231" rx="4" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 25}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="14" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 5. MH-6 Little Bird / AH-6 Killer Egg (Special Ops Combat Egg Helicopter)
    if (matchType(['H6','MH6','AH6','LITTLE BIRD','KILLER EGG'])) {
        return `<svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Egg-shaped fuselage -->
            <ellipse cx="256" cy="200" rx="40" ry="50" fill="${color}" stroke="#090d16" stroke-width="14"/>
            <rect x="248" y="240" width="16" height="190" fill="${color}" stroke="#090d16" stroke-width="8"/>
            <!-- Outboard Miniguns -->
            <rect x="195" y="210" width="12" height="40" rx="2" fill="#090d16"/>
            <rect x="305" y="210" width="12" height="40" rx="2" fill="#090d16"/>
            <!-- 6-Blade Rotor -->
            ${[0, 60, 120, 180, 240, 300].map(ang => `<rect x="249" y="30" width="14" height="226" rx="4" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 10}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="200" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 6. UH-1Y Venom / UH-1 Iroquois Huey (Classic Utility Helicopter)
    if (matchType(['UH1','HUEY','VENOM','IROQUOIS'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <!-- Huey Wide Door Fuselage -->
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,120 C 220,120 210,160 210,210 L 210,270 L 244,270 L 244,435 L 268,435 L 268,270 L 302,270 L 302,210 C 302,160 292,120 256,120 Z"/>
            <!-- Skids -->
            <line x1="190" y1="180" x2="190" y2="300" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <line x1="322" y1="180" x2="322" y2="300" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <!-- 4-Blade Main Rotor -->
            ${[0, 90, 180, 270].map(ang => `<rect x="248" y="15" width="16" height="241" rx="4" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 35}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 7. UH-60 Black Hawk / MH-60 / HH-60 Pave Hawk / MH-60T Jayhawk
    if (matchType(['H60','UH60','MH60','BLACK HAWK','BLACKHAWK','PAVE HAWK','JAYHAWK','SEAHAWK'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,130 C 235,130 215,160 215,200 L 180,225 L 180,265 L 225,260 L 225,410 L 240,455 L 272,455 L 287,410 L 287,260 L 332,265 L 332,225 L 297,200 C 297,160 277,130 256,130 Z"/>
            ${[0, 90, 180, 270].map(ang => `<rect x="248" y="20" width="16" height="236" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 30}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="20" fill="#fff" stroke="#090d16" stroke-width="6"/>
        </svg>`;
    }

    // 8. MH-65 Dolphin / USCG Search & Rescue (Fenestron Enclosed Ducted Tail Fan)
    if (matchType(['AS65','HH65','MH65','DOLPHIN','COAST GUARD','USCG'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,140 C 230,140 222,175 222,215 L 222,380 L 242,400 L 242,450 L 270,450 L 270,400 L 290,380 L 290,215 C 290,175 282,140 256,140 Z"/>
            <circle cx="256" cy="425" r="22" fill="#090d16" stroke="${color}" stroke-width="6"/>
            ${[0, 90, 180, 270].map(ang => `<rect x="247" y="30" width="18" height="226" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 40}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="18" fill="#fff" stroke="#090d16" stroke-width="6"/>
        </svg>`;
    }

    // 9. Civilian Eurocopter / Airbus (EC135, EC145, AS350 AStar)
    if (matchType(['EC35','EC45','AS35','BK117','EC30','AW139','EUROCOPTER','EC135','EC145','AGUSTA','ASTAR'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,140 C 230,140 222,175 222,215 L 222,380 L 242,400 L 242,450 L 270,450 L 270,400 L 290,380 L 290,215 C 290,175 282,140 256,140 Z"/>
            <circle cx="256" cy="425" r="22" fill="#090d16" stroke="${color}" stroke-width="6"/>
            ${[0, 90, 180, 270].map(ang => `<rect x="247" y="30" width="18" height="226" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(${ang + 40}, 256, 256)"/>`).join('')}
            <circle cx="256" cy="256" r="18" fill="#fff" stroke="#090d16" stroke-width="6"/>
        </svg>`;
    }

    // 10. Light Executive Helicopter (Bell 206, Bell 407, Robinson R44/R22/R66)
    if (matchType(['R22','R44','R66','B06','B412','BELL','ROBINSON','JETRANGER','LONGRANGER']) || cat === 'helicopter') {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,120 C 226,120 220,170 220,220 L 245,220 L 245,435 L 267,435 L 267,220 L 292,220 C 292,170 286,120 256,120 Z"/>
            <rect x="248" y="10" width="16" height="492" rx="6" fill="${color}" stroke="#090d16" stroke-width="4" transform="rotate(20, 256, 256)"/>
            <circle cx="256" cy="256" r="16" fill="#fff" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 2. Vintage Biplane (WACO, STAG, PT17, SV4, BUCK, PITTS)
    if (matchType(['WACO','STAG','PT17','SV4','BUCK','PITTS','STAS','N3N','DH82','A75N','BIPLANE'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,40 C 244,40 236,55 236,75 L 236,380 L 175,435 L 175,460 L 256,438 L 337,460 L 337,435 L 276,380 L 276,75 C 276,55 268,40 256,40 Z"/>
            <rect x="25" y="145" width="462" height="42" rx="10" fill="${color}" stroke="#090d16" stroke-width="12"/>
            <rect x="50" y="210" width="412" height="38" rx="8" fill="${color}" stroke="#090d16" stroke-width="10"/>
            <circle cx="256" cy="60" r="28" fill="#090d16" stroke="${color}" stroke-width="6"/>
        </svg>`;
    }

    // 3. WWII Warbird Fighter (P51 Mustang, P47, F4U Corsair, Spitfire, P40, T6)
    if (matchType(['P51','P47','F4U','SPIT','P40','T6','B109','FW190','P39','ZERO','MUSTANG','CORSAIR','WARBIRD'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,25 C 242,25 232,45 232,70 L 232,175 Q 120,185 20,230 Q 15,255 40,265 L 232,225 L 232,385 L 170,430 L 170,455 L 256,432 L 342,455 L 342,430 L 280,385 L 280,225 L 472,265 Q 497,255 492,230 Q 392,185 280,175 L 280,70 C 280,45 270,25 256,25 Z"/>
            <ellipse cx="256" cy="205" rx="16" ry="38" fill="#090d16"/>
            <line x1="170" y1="25" x2="342" y2="25" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
            <line x1="170" y1="25" x2="342" y2="25" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
        </svg>`;
    }

    // 4. Heavy WWII Bomber / Vintage 4-Engine (B17 Flying Fortress, B24, B29, DC3, C47)
    if (matchType(['B17','B24','B29','DC3','C47','LANC','B25','B26','FORTRESS'])) {
        return `<svg class="plane-icon-svg" width="34" height="34" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 16c-12 0-22 10-22 22v140L15 205v40l219-20v140l-75 50v25l112-25 112 25v-25l-75-50V225l219 20v-40L278 178V38c0-12-10-22-22-22z"/>
            <circle cx="140" cy="200" r="14" fill="${color}" stroke="#090d16" stroke-width="5"/>
            <circle cx="200" cy="190" r="14" fill="${color}" stroke="#090d16" stroke-width="5"/>
            <circle cx="312" cy="190" r="14" fill="${color}" stroke="#090d16" stroke-width="5"/>
            <circle cx="372" cy="200" r="14" fill="${color}" stroke="#090d16" stroke-width="5"/>
        </svg>`;
    }

    // 5. Canard / Pusher Prop Unique Aircraft (Rutan Long-EZ LNEZ, VariEze, Piaggio Avanti P180, Starship)
    if (matchType(['LNEZ','VARE','P180','STAR','VELO','RUTAN','AVANTI'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <rect x="140" y="80" width="232" height="24" rx="6" fill="${color}" stroke="#090d16" stroke-width="8"/>
            <path fill="${color}" stroke="#090d16" stroke-width="13" d="M256 30c-6 0-12 6-12 15v220L20 380v35l224-70v45l-35 25v20l47-10 47 10v-20l-35-25v-45l224 70v-35L268 265V45c0-9-6-15-12-15z"/>
            <line x1="200" y1="365" x2="312" y2="365" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
            <line x1="200" y1="365" x2="312" y2="365" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
        </svg>`;
    }

    // 6. V-22 Osprey Tiltrotor (V22, OSPREY)
    if (matchType(['V22','OSPREY'])) {
        return `<svg class="plane-icon-svg" width="34" height="34" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,40 C 242,40 232,55 232,80 L 232,230 L 60,230 L 60,270 L 232,260 L 232,380 L 175,430 L 175,455 L 256,435 L 337,455 L 337,430 L 280,380 L 280,260 L 452,270 L 452,230 L 280,230 L 280,80 C 280,55 270,40 256,40 Z"/>
            <circle cx="50" cy="250" r="45" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="10 10"/>
            <circle cx="50" cy="250" r="12" fill="#090d16"/>
            <circle cx="462" cy="250" r="45" fill="none" stroke="${color}" stroke-width="12" stroke-dasharray="10 10"/>
            <circle cx="462" cy="250" r="12" fill="#090d16"/>
        </svg>`;
    }

    // 7. Concorde / Supersonic Delta (Concorde CONC, SR-71 Blackbird)
    if (matchType(['CONC','SR71','T144','BLACKBIRD','SUPERSONIC'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,10 L 246,140 Q 230,220 90,380 L 90,410 L 236,370 L 236,440 L 210,460 L 256,445 L 302,460 L 276,440 L 276,370 L 422,410 L 422,380 Q 282,220 266,140 Z"/>
        </svg>`;
    }

    // 8. Seaplane / Flying Boat / Water Bomber (CL-215, CL-415, PBY Catalina, Grumman Goose G21)
    if (matchType(['CL21','CL41','PBY','G21','HU16','SEAPLANE','AMP'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,25 C 238,25 228,45 228,70 L 228,210 L 20,210 L 20,250 L 228,240 L 228,390 L 165,435 L 165,460 L 256,440 L 347,460 L 347,435 L 284,390 L 284,240 L 492,250 L 492,210 L 284,210 L 284,70 C 284,45 274,25 256,25 Z"/>
            <rect x="25" y="250" width="16" height="40" rx="4" fill="#090d16"/>
            <rect x="471" y="250" width="16" height="40" rx="4" fill="#090d16"/>
            <circle cx="190" cy="205" r="16" fill="#090d16" stroke="${color}" stroke-width="5"/>
            <circle cx="322" cy="205" r="16" fill="#090d16" stroke="${color}" stroke-width="5"/>
        </svg>`;
    }

    // 9. Glider / Sailplane (ASK21, DG50, LS4, DISCS)
    if (matchType(['ASK21','DG50','LS4','DISCS','DG80','AS28','GLIDER','SAILPLANE'])) {
        return `<svg class="plane-icon-svg" width="34" height="34" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="10" d="M 256,15 C 250,15 246,25 246,40 L 246,450 L 210,470 L 256,460 L 302,470 L 266,450 L 266,40 C 266,25 262,15 256,15 Z"/>
            <rect x="5" y="160" width="502" height="24" rx="6" fill="${color}" stroke="#090d16" stroke-width="8"/>
        </svg>`;
    }

    // 10. Cessna High Wing (C172, C182, C150, C206, C210, SKYHAWK, SKYLANE)
    if (matchType(['C172','C182','C150','C152','C206','C210','C177','C180','C185','CESSNA','SKYHAWK','SKYLANE'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="13" d="M 256,35 C 248,35 240,45 240,65 L 240,180 L 20,180 L 20,215 L 240,205 L 240,380 L 180,430 L 180,455 L 256,435 L 332,455 L 332,430 L 272,380 L 272,205 L 492,215 L 492,180 L 272,180 L 272,65 C 272,45 264,35 256,35 Z"/>
            <line x1="190" y1="35" x2="322" y2="35" stroke="#090d16" stroke-width="14" stroke-linecap="round"/>
            <line x1="190" y1="35" x2="322" y2="35" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
        </svg>`;
    }

    // 11. Cirrus / Diamond Sleek Low Wing (SR22, SR20, DA40, DA20, COL4)
    if (matchType(['SR22','SR20','DA40','DA20','COL4','CIRRUS','DIAMOND'])) {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="12" d="M 256,30 C 244,30 236,44 236,65 L 236,190 Q 140,205 30,225 Q 25,245 45,255 L 236,230 L 236,380 L 185,425 L 185,450 L 256,432 L 327,450 L 327,425 L 276,380 L 276,230 L 467,255 Q 487,245 482,225 Q 372,205 276,190 L 276,65 C 276,44 268,30 256,30 Z"/>
            <line x1="200" y1="30" x2="312" y2="30" stroke="#090d16" stroke-width="12" stroke-linecap="round"/>
        </svg>`;
    }

    // 12. Single Engine Turboprop (PC12, TBM8, TBM9, C208, PAY2, PC24)
    if (matchType(['PC12','TBM8','TBM9','C208','PAY2','PC24','M500','M600','PILATUS','TBM'])) {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="13" stroke-linejoin="round" d="M 256,20 C 246,20 238,35 238,55 L 238,185 L 40,210 L 40,240 L 238,225 L 238,390 L 160,430 L 160,455 L 256,435 L 352,455 L 352,430 L 274,390 L 274,225 L 472,240 L 472,210 L 274,185 L 274,55 C 274,35 266,20 256,20 Z"/>
            <line x1="175" y1="20" x2="337" y2="20" stroke="#090d16" stroke-width="16" stroke-linecap="round"/>
            <line x1="175" y1="20" x2="337" y2="20" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
        </svg>`;
    }

    // 13. Twin Engine Turboprop / Executive Prop (BE20, BE30, BE9L, BE58, B350, PA31, PAY4, KING AIR)
    if (matchType(['BE20','BE30','BE9L','BE58','B350','PA31','PAY4','C402','C414','C421','DHC6','KING AIR','SUPER KING']) || cat === 'business-prop') {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,30 C 246,30 238,42 238,60 L 238,190 L 40,215 L 40,245 L 238,230 L 238,380 L 170,430 L 170,455 L 256,435 L 342,455 L 342,430 L 274,380 L 274,230 L 472,245 L 472,215 L 274,190 L 274,60 C 274,42 266,30 256,30 Z"/>
            <rect x="145" y="195" width="22" height="50" rx="6" fill="${color}" stroke="#090d16" stroke-width="6"/>
            <line x1="130" y1="195" x2="182" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
            <rect x="345" y="195" width="22" height="50" rx="6" fill="${color}" stroke="#090d16" stroke-width="6"/>
            <line x1="330" y1="195" x2="382" y2="195" stroke="#090d16" stroke-width="10" stroke-linecap="round"/>
        </svg>`;
    }

    // 14. Executive Business Jet (C56X, C25A, GLF5, GLF6, E55P, CL30, FA50, GULFSTREAM, CITATION)
    if (matchType(['C56X','C25A','GLF5','GLF6','GLF4','GLF8','E55P','CL30','FA50','LJ35','LJ45','LJ60','E50P','HA4T','GULFSTREAM','CITATION','HAWKER','PHENOM','CHALLENGER']) || cat === 'business-jet') {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="13" d="M256 20c-8 0-14 8-14 18v150L60 290v30l182-45v80c-15 4-26 12-26 25v65l38-12 38 12v-65c0-13-11-21-26-25v-80l182 45v-30L270 188V38c0-10-6-18-14-18z"/>
            <rect x="204" y="335" width="18" height="42" rx="6" fill="${color}" stroke="#090d16" stroke-width="5" />
            <rect x="290" y="335" width="18" height="42" rx="6" fill="${color}" stroke="#090d16" stroke-width="5" />
        </svg>`;
    }

    // 15. Heavy Widebody Jumbo Jet (B744, B748, A388, A350, B777, DC10, MD11, B767, B787)
    if (matchType(['B744','B748','A388','A359','B77W','B772','B763','B789','B788','DC10','MD11','BOEING 747','AIRBUS A380'])) {
        return `<svg class="plane-icon-svg" width="36" height="36" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 10c-14 0-24 12-24 26v140L10 270v45l222-40v120l-70 50v25l104-20 104 20v-25l-70-50V275l222 40v-45L280 176V36c0-14-10-26-24-26z"/>
            <rect x="110" y="240" width="26" height="55" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
            <rect x="155" y="230" width="26" height="55" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
            <rect x="331" y="230" width="26" height="55" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
            <rect x="376" y="240" width="26" height="55" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
        </svg>`;
    }

    // 16. Commercial Airliner (A320, B738, B737, B752, B763, A321, E190, BOEING, AIRBUS)
    if (matchType(['A320','B738','B737','B752','A321','A319','E190','E175','BOEING','AIRBUS','EMBRAER']) || cat === 'commercial-jet') {
        return `<svg class="plane-icon-svg" width="32" height="32" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 16c-12 0-22 10-22 22v140L24 280v40l210-48v112l-64 48v24l86-20 86 20v-24l-64-48V272l210 48v-40L278 178V38c0-12-10-22-22-22z"/>
            <rect x="155" y="240" width="24" height="50" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
            <rect x="333" y="240" width="24" height="50" rx="8" fill="${color}" stroke="#090d16" stroke-width="6" />
        </svg>`;
    }

    // 17. U.S. Military Transport / Heavy Cargo / Tanker / Recon (C-17, C-130, C-5, KC-135, KC-46, P-8, E-3 AWACS, RC-135)
    if (matchType(['C17','C130','C30J','AC13','C5','KC135','C135','KC46','K10','E3TF','E3CF','E8','E6','P8','P3','RC135','U2','C27J','CN23','HERCULES','GLOBEMASTER'])) {
        return `<svg class="plane-icon-svg" width="34" height="34" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 16c-12 0-22 10-22 22v140L15 205v40l219-20v140l-75 50v25l112-25 112 25v-25l-75-50V225l219 20v-40L278 178V38c0-12-10-22-22-22z"/>
            <rect x="135" y="210" width="22" height="48" rx="6" fill="#090d16" stroke="${color}" stroke-width="4"/>
            <rect x="185" y="200" width="22" height="48" rx="6" fill="#090d16" stroke="${color}" stroke-width="4"/>
            <rect x="305" y="200" width="22" height="48" rx="6" fill="#090d16" stroke="${color}" stroke-width="4"/>
            <rect x="355" y="210" width="22" height="48" rx="6" fill="#090d16" stroke="${color}" stroke-width="4"/>
        </svg>`;
    }

    // 18. U.S. Military Fighter / Attack / Trainer / Stealth Bomber (F-16, F/A-18, F-22, F-35, F-15, A-10, T-38, T-6, B-1, B-2, B-52)
    if (ac.mil === 1 || matchType(['F16','F18','FA18','EA18','F22','F35','F15','EGL','A10','AV8B','HAR','T38','T6','T45','T7','B52','B1','B2','B21','MQ9','RQ4','MQ4','FIGHTER','RAPTOR','HORNET','VIPER']) || cat === 'military') {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" stroke-linejoin="round" d="M 256,20 L 230,140 L 90,310 L 90,345 L 225,290 L 225,410 L 160,465 L 205,465 L 256,430 L 307,465 L 352,465 L 287,410 L 287,290 L 422,345 L 422,310 L 282,140 Z"/>
        </svg>`;
    }

    // 19. Crop Duster / Agricultural (AT50, AT80, G164, M18, AIR TRACTOR)
    if (matchType(['AT50','AT80','G164','M18','C188','A188','AIR TRACTOR','AG-CAT']) || cat === 'farm') {
        return `<svg class="plane-icon-svg" width="30" height="30" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 16c-8 0-14 6-14 14v170L10 200v36l232-15v105l-45 35v25l45-15 14 5 14-5 45 15v-25l-45-35V221l232 15v-36L270 200V30c0-8-6-14-14-14z"/>
            <rect x="40" y="225" width="432" height="12" rx="6" fill="none" stroke="${color}" stroke-width="12" />
        </svg>`;
    }

    // 20. Piper & General Low Wing Light Aviation (P28A, P28R, PA28, PA32, PA24, M20T, BE36, CHEROKEE, ARCHER, MOONEY, BONANZA)
    if (matchType(['P28A','P28R','PA28','PA32','PA24','M20T','BE36','CHEROKEE','ARCHER','ARROW','MOONEY','BONANZA','PIPER'])) {
        return `<svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
            <path fill="${color}" stroke="#090d16" stroke-width="14" d="M 256,35 C 246,35 238,48 238,68 L 238,185 L 25,200 L 25,235 L 238,220 L 238,380 L 180,425 L 180,450 L 256,432 L 332,450 L 332,425 L 274,380 L 274,220 L 487,235 L 487,200 L 274,185 L 274,68 C 274,48 266,35 256,35 Z"/>
            <line x1="200" y1="35" x2="312" y2="35" stroke="#090d16" stroke-width="12" stroke-linecap="round" />
            <line x1="200" y1="35" x2="312" y2="35" stroke="${color}" stroke-width="5" stroke-linecap="round" />
        </svg>`;
    }

    // 21. Default General Aviation Airplane
    return `<svg class="plane-icon-svg" width="28" height="28" viewBox="0 0 512 512" style="transform: rotate(${heading}deg);">
        <path fill="${color}" stroke="#090d16" stroke-width="14" d="M256 40c-10 0-18 8-18 18v134L32 192v36l206 12v120l-48 30v24l66-16 66 16v-24l-48-30V240l206-12v-36L274 192V58c0-10-8-18-18-18z"/>
        <line x1="210" y1="42" x2="302" y2="42" stroke="#090d16" stroke-width="12" stroke-linecap="round" />
        <line x1="210" y1="42" x2="302" y2="42" stroke="${color}" stroke-width="5" stroke-linecap="round" />
    </svg>`;
}

// 6. Map Marker Graphics & Rotation
function updateMapMarker(ac) {
    const color = getAircraftColor(ac);
    const iconHtml = getAircraftIconSvg(ac, color);
    
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
        'business-prop': 'Business Prop',
        'airplane': 'GA Airplane',
        'helicopter': 'Helicopter',
        'military': 'Military Aircraft',
        'farm': 'Farm / Crop Duster',
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
function logOperation(hex, callsign, type, opType, description, tail) {
    const now = new Date();
    const logItem = {
        timestamp: now.getTime(), // Miliseconds for 30-day age filtering
        dateStr: now.toLocaleDateString(),
        timeStr: now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        hex,
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

window.locateWorldwide = async function(tail) {
    if (!tail || tail === 'N/A' || tail === 'Unknown') return;
    
    const statusText = document.getElementById('feed-status-text');
    statusText.innerText = `Searching worldwide for ${tail}...`;
    statusText.style.color = '#fbbf24';
    
    try {
        let hex = null;
        
        // 1. Look in local db
        for (const [h, info] of Object.entries(aircraftInfoDb)) {
            if (info.tail === tail) {
                hex = h;
                break;
            }
        }
        
        // 2. Query reg endpoint
        if (!hex) {
            const res = await fetch(`https://api.airplanes.live/v2/reg/${tail}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.ac && data.ac.length > 0) {
                    hex = data.ac[0].hex;
                }
            }
        }
        
        if (!hex) {
            alert(`Could not determine hex code for ${tail} to locate it worldwide.`);
            statusText.innerText = 'Aircraft not found globally.';
            return;
        }
        
        // 3. Fetch live global location by hex
        const res = await fetch(`https://api.airplanes.live/v2/hex/${hex}`);
        if (res.ok) {
            const data = await res.json();
            if (data && data.ac && data.ac.length > 0) {
                const ac = data.ac[0];
                if (ac.lat && ac.lon) {
                    // Process it into memory so it renders
                    processAircraft(data.ac);
                    
                    // Fly map to the coordinates globally
                    map.flyTo([ac.lat, ac.lon], 9, { animate: true, duration: 1.5 });
                    
                    // Select the aircraft (once Leaflet settles)
                    setTimeout(() => selectAircraft(hex), 1500);
                    
                    statusText.innerText = `Located ${tail} at ${ac.lat.toFixed(2)}, ${ac.lon.toFixed(2)}`;
                    statusText.style.color = '#34d399';
                    return;
                }
            }
        }
        
        alert(`Aircraft ${tail} is not currently broadcasting live ADS-B data anywhere in the world.`);
        statusText.innerText = 'Aircraft offline globally.';
    } catch(e) {
        console.error("Error locating worldwide:", e);
        alert(`Error locating ${tail} worldwide.`);
    }
};

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
        // Resolve dynamic tail and type if we have it in our persistent database
        let resolvedTail = (log.tail && log.tail !== 'N/A') ? log.tail : (log.callsign || 'Unknown');
        let resolvedType = log.type || 'N/A';
        
        if (log.hex && aircraftInfoDb[log.hex]) {
            if (aircraftInfoDb[log.hex].tail && aircraftInfoDb[log.hex].tail !== 'N/A') {
                resolvedTail = aircraftInfoDb[log.hex].tail;
            }
            if (aircraftInfoDb[log.hex].type && aircraftInfoDb[log.hex].type !== 'N/A') {
                resolvedType = aircraftInfoDb[log.hex].type;
            }
        }
        
        const key = resolvedTail;
        if (!groups[key]) {
            groups[key] = {
                tail: key,
                callsign: log.callsign || key,
                type: resolvedType,
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
                <span class="ops-group-tail">
                    <i class="fa-solid fa-plane globe-zoom" title="Find current live location worldwide" onclick="event.stopPropagation(); locateWorldwide('${group.tail}')"></i> 
                    ${group.tail}
                </span>
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
            
            // Migration: Add hex to old logs if possible
            operationsLog.forEach(log => {
                if (!log.hex) {
                    for (const [hex, info] of Object.entries(aircraftInfoDb)) {
                        if (info.tail === log.tail || info.callsign === log.callsign) {
                            log.hex = hex;
                            break;
                        }
                    }
                }
            });
            
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

// ==========================================
// AIRCRAFT DETAILS FETCHING (2-Tier Pipeline)
// Tier 1: ADSBdb.com API (primary, CORS-friendly, static DB)
// Tier 2: Gemini AI (last resort, rate-limited)
// ==========================================
async function fetchMissingAircraftInfo(hex, force = false) {
    const hexKey = hex.toLowerCase();
    
    // Prevent concurrent searches for the same aircraft
    if (activeSearches.has(hexKey)) return;
    
    // If not forced and already searched this session with valid type & desc, skip
    if (!force && searchedHexes.has(hexKey)) {
        const liveAc = aircraftCache[hexKey];
        if (liveAc && liveAc.type && liveAc.type !== 'N/A' && liveAc.type !== 'Unknown' && liveAc.desc && liveAc.desc !== 'N/A' && liveAc.desc !== 'Unknown') {
            return;
        }
    }
    
    // Mark as attempted in this session
    searchedHexes.add(hexKey);
    
    console.log(`[Aircraft Search] Starting background lookup for ${hexKey} (force=${force})...`);
    activeSearches.add(hexKey);
    updateUI(); // Show spinner immediately
    
    try {
        // 0. Check local cache first
        if (aircraftInfoDb[hexKey]) {
            console.log(`[Aircraft Search] Found cached data for ${hexKey}`);
            let updatedFromCache = false;
            const cached = aircraftInfoDb[hexKey];
            
            const liveAc = aircraftCache[hexKey];
            if (liveAc) {
                if ((!liveAc.type || liveAc.type === 'N/A' || liveAc.type === 'Unknown' || liveAc.type === '') && cached.type) {
                    liveAc.type = cached.type;
                    updatedFromCache = true;
                }
                if ((!liveAc.desc || liveAc.desc === 'N/A' || liveAc.desc === 'Unknown' || liveAc.desc === '') && cached.desc) {
                    liveAc.desc = cached.desc;
                    updatedFromCache = true;
                }
                if ((!liveAc.operator || liveAc.operator === 'N/A' || liveAc.operator === 'Unknown' || liveAc.operator === '') && cached.operator) {
                    liveAc.operator = cached.operator;
                    updatedFromCache = true;
                }
                if ((!liveAc.tail || liveAc.tail === 'N/A' || liveAc.tail === 'Unknown' || liveAc.tail === '') && cached.tail) {
                    liveAc.tail = cached.tail;
                    updatedFromCache = true;
                }
            }
            
            if (updatedFromCache) {
                const isStillMissing = (!liveAc.type || liveAc.type === 'N/A' || liveAc.type === 'Unknown' || liveAc.type === '') || 
                                       (!liveAc.desc || liveAc.desc === 'N/A' || liveAc.desc === 'Unknown' || liveAc.desc === '');
                
                if (!isStillMissing) {
                    return; // Fully satisfied by cache
                }
                console.log(`[Aircraft Search] Cached data incomplete for ${hexKey}. Continuing search...`);
            }
        }

        let updated = false;
        let finalTail = '';
        let finalType = '';
        let finalDesc = '';
        let finalOperator = '';
        
        // Helper to apply findings to the live cache object
        const applyFindings = () => {
            const liveAc = aircraftCache[hexKey];
            if (!liveAc) return;
            
            if ((!liveAc.type || liveAc.type === 'N/A' || liveAc.type === 'Unknown' || liveAc.type === '') && finalType) {
                liveAc.type = finalType;
                updated = true;
            }
            if ((!liveAc.desc || liveAc.desc === 'N/A' || liveAc.desc === 'Unknown' || liveAc.desc === '') && finalDesc) {
                liveAc.desc = finalDesc;
                updated = true;
            }
            if ((!liveAc.operator || liveAc.operator === 'N/A' || liveAc.operator === 'Unknown' || liveAc.operator === '') && finalOperator) {
                liveAc.operator = finalOperator;
                updated = true;
            }
            if ((!liveAc.tail || liveAc.tail === 'N/A' || liveAc.tail === 'Unknown' || liveAc.tail === '') && finalTail) {
                liveAc.tail = finalTail;
                updated = true;
            }
            
            if (updated) {
                liveAc.categoryClass = getAircraftCategory(liveAc);
            }
        };
    
        // ============================================
        // TIER 0: Direct FAA Registry & FlightAware Scraper Proxy
        // Scrapes registry.faa.gov directly (100% accurate for US N-numbers)
        // Supported endpoints: http://localhost:8080/faa?tail=... or http://127.0.0.1:3001/faa?tail=...
        // ============================================
        const liveAcForFAA = aircraftCache[hexKey] || {};
        const targetTail = (liveAcForFAA.tail && liveAcForFAA.tail !== 'N/A' && liveAcForFAA.tail !== 'Unknown') ? liveAcForFAA.tail : (liveAcForFAA.callsign && liveAcForFAA.callsign.trim().toUpperCase().startsWith('N') ? liveAcForFAA.callsign.trim() : '');
        
        if (!updated && targetTail) {
            const cleanTail = targetTail.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
            const proxyEndpoints = [
                `${window.location.origin}/faa?tail=${cleanTail}`,
                `http://localhost:8080/faa?tail=${cleanTail}`,
                `http://127.0.0.1:8080/faa?tail=${cleanTail}`,
                `http://localhost:3001/faa?tail=${cleanTail}`,
                `http://127.0.0.1:3001/faa?tail=${cleanTail}`
            ];
            
            for (const endpoint of proxyEndpoints) {
                try {
                    console.log(`[Aircraft Search] [Tier 0] Querying Local FAA Scraper Proxy for ${cleanTail}...`);
                    const faaRes = await fetch(endpoint, { signal: AbortSignal.timeout(2500) });
                    if (faaRes.ok) {
                        const faaData = await faaRes.json();
                        if (faaData && faaData.type && faaData.type !== 'UNKN' && faaData.desc) {
                            console.log(`[Aircraft Search] [Tier 0] FAA Registry Scraper SUCCESS for ${cleanTail}:`, faaData);
                            finalType = faaData.type;
                            finalDesc = faaData.desc;
                            finalTail = faaData.tail || cleanTail;
                            finalOperator = faaData.owner || '';
                            applyFindings();
                            if (updated) {
                                checkFAAScraperHealth(); // Instantly turn badge green
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.log(`[Aircraft Search] [Tier 0] FAA Scraper Endpoint skipped (${endpoint}):`, e.message);
                }
            }
        }

        // ============================================
        // TIER 1: ADSBdb.com API (Primary Fallback)
        // Free, CORS-friendly, static aircraft database
        // Returns: icao_type, manufacturer, model, registration, owner
        // Rate limit: 500 req/min
        // ============================================
        if (!updated) {
            try {
                console.log(`[Aircraft Search] [Tier 1] Querying ADSBdb for ${hexKey}...`);
                const adsbdbResponse = await fetch(`https://api.adsbdb.com/v0/aircraft/${hexKey}`);
                if (adsbdbResponse.ok) {
                    const adsbdbData = await adsbdbResponse.json();
                    const aircraft = adsbdbData?.response?.aircraft;
                    if (aircraft) {
                        console.log(`[Aircraft Search] [Tier 1] ADSBdb SUCCESS for ${hexKey}:`, aircraft.icao_type, aircraft.manufacturer, aircraft.type);
                        finalType = aircraft.icao_type || '';
                        finalDesc = aircraft.manufacturer ? `${aircraft.manufacturer} ${aircraft.type || ''}`.trim() : (aircraft.type || '');
                        finalTail = aircraft.registration || '';
                        finalOperator = aircraft.registered_owner || '';
                        applyFindings();
                    } else {
                        console.log(`[Aircraft Search] [Tier 1] ADSBdb returned empty response for ${hexKey}`);
                    }
                } else if (adsbdbResponse.status === 404) {
                    console.log(`[Aircraft Search] [Tier 1] ADSBdb: aircraft ${hexKey} not in database`);
                } else {
                    console.log(`[Aircraft Search] [Tier 1] ADSBdb HTTP ${adsbdbResponse.status} for ${hexKey}`);
                }
            } catch (e) {
                console.log(`[Aircraft Search] [Tier 1] ADSBdb fetch failed for ${hexKey}:`, e.message);
            }
        }
        
        // ============================================
        // TIER 2: Gemini AI (Last Resort)
        // Only fires if Tier 1 missed AND API key is configured
        // AND aircraft has a known tail number or callsign to search by
        // Rate: 15 RPM (throttled by processAutoSearchQueue)
        // ============================================
        const currentLiveAc = aircraftCache[hexKey] || {};
        const acTail = (currentLiveAc.tail && currentLiveAc.tail !== 'N/A' && currentLiveAc.tail !== 'Unknown') ? currentLiveAc.tail : '';
        const acCall = (currentLiveAc.callsign && currentLiveAc.callsign.trim() !== '') ? currentLiveAc.callsign.trim() : '';
        const searchParam = `${acTail} ${acCall}`.trim();
        
        if (!updated && searchParam && geminiApiKey) {
            try {
                console.log(`[Aircraft Search] [Tier 2] Querying Gemini AI for ${searchParam}...`);
                const prompt = `Identify exact real-world aircraft by tail number or callsign: "${searchParam}". Return ONLY a raw JSON object with keys 'type' (the 4-letter ICAO designator) and 'desc' (full manufacturer and model name). IF YOU ARE NOT 100% CERTAIN of the exact real-world aircraft model, return {"type":"Unknown","desc":"Unknown"}. DO NOT GUESS OR HALLUCINATE DEFAULT AIRCRAFT TYPES LIKE CITATION OR C25B. Just the raw JSON.`;
                
                const modelsToTry = ['gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash'];
                let aiRes = null;
                let usedModel = '';
                
                for (const model of modelsToTry) {
                    usedModel = model;
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
                    aiRes = await fetch(geminiUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }]
                        })
                    });
                    if (aiRes.ok || aiRes.status === 429) {
                        break;
                    }
                    console.warn(`[Aircraft Search] [Tier 2] ${model} failed with status ${aiRes.status}, falling back...`);
                }
                
                if (aiRes.ok) {
                    const aiData = await aiRes.json();
                    if (aiData.candidates && aiData.candidates.length > 0) {
                        let textResp = aiData.candidates[0].content.parts[0].text.trim();
                        const jsonMatch = textResp.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            textResp = jsonMatch[0];
                        }
                        
                        try {
                            const parsed = JSON.parse(textResp);
                            const pType = (parsed.type || '').trim().toUpperCase();
                            const pDesc = (parsed.desc || '').trim();
                            
                            // Strictly reject unknown or generic hallucinated fallbacks
                            const isValidAIResult = pType && pType !== 'UNKNOWN' && pType !== 'N/A' && pType !== 'SRCH' &&
                                                    pDesc && !pDesc.toLowerCase().includes('unknown') && 
                                                    !pDesc.toLowerCase().includes('citation cj3') && pType !== 'C25B';

                            if (isValidAIResult) {
                                finalType = pType;
                                finalDesc = pDesc;
                                console.log(`[Aircraft Search] [Tier 2] Gemini AI Verified ${searchParam}:`, parsed);
                                applyFindings();
                            } else {
                                console.log(`[Aircraft Search] [Tier 2] Gemini AI returned unconfirmed guess for ${searchParam}, ignoring.`);
                            }
                        } catch(parseErr) {
                            console.log(`[Aircraft Search] [Tier 2] Failed to parse Gemini JSON:`, textResp);
                        }
                    }
                } else if (aiRes.status === 429) {
                    console.warn(`[Aircraft Search] [Tier 2] Gemini AI Rate Limit Hit!`);
                } else {
                    console.warn(`[Aircraft Search] [Tier 2] Gemini AI Error ${aiRes.status}`);
                }
            } catch(e) {
                console.log(`[Aircraft Search] [Tier 2] Gemini AI fetch failed:`, e.message);
            }
        }

        // Save results to persistent local cache
        if (updated) {
            const liveAc = aircraftCache[hexKey];
            if (liveAc) {
                aircraftInfoDb[hexKey] = {
                    ...aircraftInfoDb[hexKey],
                    hex: liveAc.hex,
                    callsign: liveAc.callsign,
                    tail: liveAc.tail,
                    type: liveAc.type,
                    desc: liveAc.desc,
                    operator: liveAc.operator
                };
                saveAircraftDb();
            }
        }
    } finally {
        activeSearches.delete(hexKey);
        updateUI(); // Real-time block update
        
        // Force immediate map marker tooltip update
        const liveAc = aircraftCache[hexKey];
        if (liveAc && aircraftMarkers[hexKey]) {
            const categoryNames = {
                'light': 'Light (General Aviation)', 'small': 'Small Commuter', 'large': 'Large Airliner',
                'heavy': 'Heavy Airliner', 'high_vortex': 'High Vortex Large', 'fighter': 'High Perf. Fighter',
                'helicopter': 'Rotorcraft', 'glider': 'Glider', 'lighter_than_air': 'Balloon / Blimp',
                'uav': 'Unmanned Aerial Vehicle', 'space': 'Spacecraft', 'ultralight': 'Ultralight',
                'parachute': 'Parachute', 'point_obstacle': 'Point Obstacle', 'military': 'Military Aircraft',
                'farm': 'Farm / Crop Duster', 'other': 'Other / Glider'
            };
            const categoryLabel = categoryNames[liveAc.categoryClass] || 'Other / Glider';
            const vspeedText = liveAc.vspeed > 0 ? `+${liveAc.vspeed.toLocaleString()} FPM` : (liveAc.vspeed < 0 ? `${liveAc.vspeed.toLocaleString()} FPM` : 'Level');
            const altText = liveAc.alt === 0 ? 'Ground' : `${liveAc.alt.toLocaleString()} FT`;

            const tooltipContent = `
                <div class="map-tooltip-content">
                    <div class="tooltip-header">
                        <strong>${liveAc.callsign}</strong>
                        <span class="tooltip-tail">${liveAc.tail !== 'N/A' ? liveAc.tail : ''}</span>
                    </div>
                    <div class="tooltip-body">
                        <div><strong>Category:</strong> ${categoryLabel}</div>
                        <div><strong>Type:</strong> ${liveAc.type} (${liveAc.desc !== 'N/A' ? liveAc.desc : 'No Desc'})</div>
                        <div><strong>Altitude:</strong> ${altText}</div>
                        <div><strong>Speed:</strong> ${liveAc.speed} KT | <strong>Heading:</strong> ${liveAc.heading}°</div>
                        <div><strong>V-Speed:</strong> ${vspeedText}</div>
                        <div><strong>Distance:</strong> ${liveAc.dist.toFixed(1)} NM from KVPZ</div>
                        <div><strong>Operator:</strong> ${liveAc.operator}</div>
                    </div>
                </div>
            `;
            aircraftMarkers[hexKey].setTooltipContent(tooltipContent);
        }
    }
}

window.handleMilToggle = function(checkbox, hex) {
    const hexKey = hex.toLowerCase();
    const isMil = checkbox.checked ? 1 : 0;
    
    // Update live cache
    if (aircraftCache[hexKey]) {
        aircraftCache[hexKey].mil = isMil;
        aircraftCache[hexKey].categoryClass = getAircraftCategory(aircraftCache[hexKey]);
        updateMapMarker(aircraftCache[hexKey]);
    }
    
    // Update persistent DB
    if (!aircraftInfoDb[hexKey]) aircraftInfoDb[hexKey] = { hex: hex, callsign: 'N/A', tail: 'N/A', type: 'N/A', desc: 'N/A', operator: 'N/A' };
    aircraftInfoDb[hexKey].mil = isMil;
    aircraftInfoDb[hexKey].manualMil = true;
    saveAircraftDb();
    
    refreshAllAircraftLayers();
};

window.handleManualEntry = function(element, hex, field) {
    window.isEditingTable = false;
    const value = element.innerText.trim();
    if (!value || value === 'N/A' || value === 'Unknown') {
        updateUI(); // Force a re-render to restore the original value visually
        return;
    }
    
    // Update live cache
    const hexKey = hex.toLowerCase();
    if (aircraftCache[hexKey]) {
        aircraftCache[hexKey][field] = value;
        // Re-evaluate category
        aircraftCache[hexKey].categoryClass = getAircraftCategory(aircraftCache[hexKey]);
        updateMapMarker(aircraftCache[hexKey]);
    }
    
    // Update persistent DB
    if (!aircraftInfoDb[hexKey]) aircraftInfoDb[hexKey] = { hex: hex, callsign: 'N/A', tail: 'N/A', type: 'N/A', desc: 'N/A', operator: 'N/A' };
    aircraftInfoDb[hexKey][field] = value;
    aircraftInfoDb[hexKey].manual = true; // Flag to prevent auto-search overriding it
    saveAircraftDb();
    
    // Remove from active search queue if it's there
    searchedHexes.add(hexKey); 
    
    // Trigger map update
    refreshAllAircraftLayers();
    updateUI(); // Manually trigger since we unpaused it
};

function updateUI() {
    if (window.isEditingTable) return;
    
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
        const tr = document.createElement('tr');
        if (selectedHex === ac.hex) {
            tr.className = 'selected';
            selectedRow = tr;
        }
        
        const hexKey = ac.hex.toLowerCase();
        const isMissingData = (!ac.type || ac.type === 'N/A' || ac.type === 'Unknown' || ac.type === '' || ac.type === 'SRCH' ||
                               !ac.desc || ac.desc === 'N/A' || ac.desc === 'Unknown' || ac.desc === '');
        
        // Auto-search logic (Throttled via Queue)
        if (autoSearch && isMissingData && !activeSearches.has(hexKey) && !searchedHexes.has(hexKey)) {
            searchedHexes.add(hexKey);
            autoSearchQueue.push(ac.hex);
            processAutoSearchQueue();
        }
        
        tr.addEventListener('click', () => {
            selectAircraft(ac.hex);
            // Manual click ALWAYS forces a fresh lookup for missing type/description!
            if (!activeSearches.has(hexKey)) {
                fetchMissingAircraftInfo(ac.hex, true);
            }
        });
        
        const vspeedText = ac.vspeed > 0 ? `+${ac.vspeed}` : ac.vspeed;
        
        const isSearching = activeSearches.has(hexKey);
        const spinnerHtml = isSearching ? `<i class="fa-solid fa-spinner fa-spin" style="color: #60a5fa; margin-right: 6px;" title="Searching internet for missing info..."></i>` : '';
        
        tr.innerHTML = `
            <td>${spinnerHtml}<strong>${ac.callsign}</strong></td>
            <td>${ac.tail}</td>
            <td>${ac.hex.toUpperCase()}</td>
            <td><input type="checkbox" onchange="handleMilToggle(this, '${ac.hex}')" ${ac.mil ? 'checked' : ''} title="Manual Military Override"></td>
            <td><span class="editable-cell" contenteditable="true" spellcheck="false" 
                onfocus="window.isEditingTable=true"
                onblur="handleManualEntry(this, '${ac.hex}', 'type')" 
                onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}">${ac.type}</span></td>
            <td><span class="editable-cell" contenteditable="true" spellcheck="false" 
                onfocus="window.isEditingTable=true"
                onblur="handleManualEntry(this, '${ac.hex}', 'desc')" 
                onkeydown="if(event.key==='Enter'){event.preventDefault(); this.blur();}">${ac.desc}</span></td>
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
            // Sanitize / Purge erroneous mathematical & AI default decodes (e.g. S76, C25B / Citation CJ3)
            for (const k of Object.keys(aircraftInfoDb)) {
                const item = aircraftInfoDb[k];
                if (item) {
                    if (item.tail === 'N83HS' || item.callsign === 'N83HS' || k === 'n83hs') {
                        item.tail = 'N83HS';
                        item.type = 'GLF8';
                        item.desc = 'Gulfstream G800';
                        item.categoryClass = 'business-jet';
                    } else if (!item.manual) {
                        const isBogusS76 = item.type === 'S76' && item.desc && item.desc.includes('Sikorsky');
                        const isBogusCJ3 = (item.type === 'C25B' || item.type === 'C25A') && item.desc && item.desc.toLowerCase().includes('citation');
                        const isGenericAI = item.desc && (item.desc.includes('AI Identified') || item.desc.includes('AI Extracted'));
                        if (isBogusS76 || isBogusCJ3 || isGenericAI) {
                            delete aircraftInfoDb[k];
                        }
                    }
                }
            }
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
            if (settings.showRadar !== undefined) showRadar = settings.showRadar;
            showLow = settings.showLow !== undefined ? settings.showLow : true;
            showMed = settings.showMed !== undefined ? settings.showMed : true;
            showHigh = settings.showHigh !== undefined ? settings.showHigh : true;
            showCommJet = settings.showCommJet !== undefined ? settings.showCommJet : true;
            showAirplane = settings.showAirplane !== undefined ? settings.showAirplane : true;
            showBizJet = settings.showBizJet !== undefined ? settings.showBizJet : true;
            if (settings.showBProp !== undefined) showBProp = settings.showBProp;
            showHelo = settings.showHelo !== undefined ? settings.showHelo : true;
            if (settings.showMil !== undefined) showMil = settings.showMil;
            if (settings.showFarm !== undefined) showFarm = settings.showFarm;
            if (settings.showOther !== undefined) showOther = settings.showOther;
            controlsCollapsed = settings.controlsCollapsed !== undefined ? settings.controlsCollapsed : false;
        }
    } catch (e) {
        console.error("Error loading map settings from localStorage:", e);
    }
}

function saveMapSettings() {
    try {
        const settings = { 
            showRings, showLabels, showTrails, showPowerlines, showRadar, showLow, showMed, showHigh, 
            showCommJet, showAirplane, showBizJet, showBProp, showHelo, showMil, showFarm, showOther,
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

// 11b. Live NEXRAD Doppler Radar Layer
function initRadar() {
    radarLayer = L.tileLayer('https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png', {
        attribution: 'Radar &copy; IEM / NOAA NEXRAD',
        maxZoom: 18,
        opacity: 0.55,
        zIndex: 200
    });
    
    if (showRadar) {
        radarLayer.addTo(map);
    }
    
    // Auto-refresh composite radar scan every 5 minutes
    setInterval(refreshRadarTiles, 5 * 60 * 1000);
}

function updateRadarLayer() {
    if (!map || !radarLayer) return;
    if (showRadar) {
        if (!map.hasLayer(radarLayer)) {
            radarLayer.addTo(map);
        }
    } else {
        if (map.hasLayer(radarLayer)) {
            map.removeLayer(radarLayer);
        }
    }
}

function refreshRadarTiles() {
    if (!radarLayer || !map) return;
    const t = Date.now();
    radarLayer.setUrl(`https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png?t=${t}`);
}

// 12. OSM Powerlines Renderer (Overpass API with Local Cache)
function isPointInIndiana(lat, lon) {
    if (lat < 37.7717 || lat > 41.7607 || lon < -88.0978 || lon > -84.7846) return false;
    if (lat < 39.4 && lon < (-88.00 + (39.4 - lat) * 0.15)) return false;
    return true;
}

function loadPowerlineCache() {
    try {
        const stored = safeGetItem('kvpz_powerline_cache');
        if (stored) {
            powerlineCache = JSON.parse(stored);
            // Purge any legacy cached entries that fall outside Indiana boundary
            Object.keys(powerlineCache).forEach(id => {
                const item = powerlineCache[id];
                if (item && item.latlngs) {
                    item.latlngs = item.latlngs.filter(pt => isPointInIndiana(pt[0], pt[1]));
                    if (item.latlngs.length < 2) {
                        delete powerlineCache[id];
                    }
                }
            });
        }
    } catch (e) {
        console.error("Error loading powerline cache from localStorage:", e);
    }
    
    // Seed initial pre-bundled Indiana powerlines if cache is empty or small
    if (typeof SEED_POWERLINES !== 'undefined' && Array.isArray(SEED_POWERLINES) && Object.keys(powerlineCache).length < 500) {
        SEED_POWERLINES.forEach(el => {
            if (el.type === 'way' && Array.isArray(el.geometry)) {
                const latlngs = el.geometry.map(pt => [pt.lat, pt.lon]).filter(pt => isPointInIndiana(pt[0], pt[1]));
                if (latlngs.length >= 2) {
                    const elId = el.id || `${latlngs[0][0]}_${latlngs[0][1]}`;
                    if (!powerlineCache[elId]) {
                        powerlineCache[elId] = {
                            id: elId,
                            latlngs: latlngs,
                            tags: el.tags || {}
                        };
                    }
                }
            }
        });
        savePowerlineCache();
    }
}

function savePowerlineCache() {
    try {
        safeSetItem('kvpz_powerline_cache', JSON.stringify(powerlineCache));
    } catch (e) {
        console.warn("Error saving powerline cache to localStorage:", e);
    }
}

function renderPowerlinesFromCache() {
    if (!map || !powerlineGroup) return;
    powerlineGroup.clearLayers();
    if (!showPowerlines) return;

    const bounds = map.getBounds();
    // Pad bounds slightly (0.05 deg) so border lines don't get clipped
    const pad = 0.05;
    const south = bounds.getSouth() - pad;
    const north = bounds.getNorth() + pad;
    const west = bounds.getWest() - pad;
    const east = bounds.getEast() + pad;

    let renderedCount = 0;

    Object.values(powerlineCache).forEach(item => {
        if (!item || !item.latlngs || item.latlngs.length < 2) return;

        // Keep strictly ONLY coordinates inside Indiana
        const indianaLatLngs = item.latlngs.filter(pt => isPointInIndiana(pt[0], pt[1]));
        if (indianaLatLngs.length < 2) return;

        // Render if any point of the polyline falls within padded map bounds
        const isVisible = indianaLatLngs.some(pt => pt[0] >= south && pt[0] <= north && pt[1] >= west && pt[1] <= east);
        if (!isVisible) return;

        renderedCount++;

        // Double-stroke neon glow technique
        // 1. Semi-transparent thick background pink line for glow
        L.polyline(indianaLatLngs, {
            color: '#ff007f',
            weight: 6,
            opacity: 0.35,
            dashArray: 'none',
            interactive: false
        }).addTo(powerlineGroup);

        // 2. High-brightness thin solid pink line on top
        const mainLine = L.polyline(indianaLatLngs, {
            color: '#ff1493', // Deep Pink / Highlighter Pink
            weight: 2.2,
            opacity: 0.95,
            dashArray: 'none'
        }).addTo(powerlineGroup);

        // Tooltip formatting
        const tags = item.tags || {};
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
    });
}

function initPowerlines() {
    powerlineGroup = L.layerGroup().addTo(map);
    
    // Load local storage cache & pre-bundled seed on startup
    loadPowerlineCache();
    renderPowerlinesFromCache();
    
    // Refresh powerlines whenever map movement finishes
    map.on('moveend', () => {
        updatePowerlines();
    });
    
    // Initial load & coverage check
    updatePowerlines();
}

async function updatePowerlines() {
    if (!map || !powerlineGroup) return;
    
    if (!showPowerlines) {
        powerlineGroup.clearLayers();
        lastBboxStr = "";
        return;
    }
    
    // Render existing cached powerlines immediately (zero lag)
    renderPowerlinesFromCache();

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const south = bounds.getSouth().toFixed(4);
    const west = bounds.getWest().toFixed(4);
    const north = bounds.getNorth().toFixed(4);
    const east = bounds.getEast().toFixed(4);
    
    const bboxStr = `${south},${west},${north},${east}`;
    if (bboxStr === lastBboxStr) return; // Viewport did not change
    lastBboxStr = bboxStr;

    // Check grid tile coverage (~0.05 deg grid step)
    const step = 0.05;
    const minX = Math.floor(bounds.getWest() / step);
    const maxX = Math.floor(bounds.getEast() / step);
    const minY = Math.floor(bounds.getSouth() / step);
    const maxY = Math.floor(bounds.getNorth() / step);

    const neededTileKeys = [];
    const isDetailed = zoom >= 13;
    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            const tileKey = `${x}_${y}_z${isDetailed ? 'D' : 'M'}`;
            if (!fetchedPowerlineTiles.has(tileKey)) {
                neededTileKeys.push(tileKey);
            }
        }
    }

    // If viewport is fully covered by previously fetched tiles, skip Overpass API call!
    if (neededTileKeys.length === 0) {
        console.log("[Powerlines] Viewport fully covered by local cache. Skipping Overpass API fetch.");
        return;
    }

    // Fast direct bounding box Overpass query (~1.5s execution)
    let overpassQuery;
    if (isDetailed) {
        overpassQuery = `[out:json][timeout:15];(way["power"="line"](${bboxStr});way["power"="minor_line"](${bboxStr}););out geom;`;
    } else {
        overpassQuery = `[out:json][timeout:15];(way["power"="line"](${bboxStr}););out geom;`;
    }
    
    const endpoints = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.nchc.org.tw/api/interpreter'
    ];
    
    let data = null;
    for (const ep of endpoints) {
        try {
            const url = `${ep}?data=${encodeURIComponent(overpassQuery)}`;
            const response = await fetch(url);
            if (!response.ok) continue;
            const text = await response.text();
            if (!text.trim().startsWith('{')) continue; // Skip HTML error pages
            data = JSON.parse(text);
            if (data && data.elements) break; // Found valid data!
        } catch (e) {
            console.warn(`Overpass mirror ${ep} failed:`, e.message);
        }
    }

    if (!data || !Array.isArray(data.elements)) {
        console.warn("Unable to fetch fresh powerline data from any Overpass mirror.");
        return;
    }
    
    let newCount = 0;
    let skippedCount = 0;
    
    data.elements.forEach(el => {
        if (el.type === 'way' && Array.isArray(el.geometry)) {
            const tags = el.tags || {};
            
            // Strictly filter geometry coordinates to keep ONLY points inside Indiana
            const latlngs = el.geometry
                .filter(pt => isPointInIndiana(pt.lat, pt.lon))
                .map(pt => [pt.lat, pt.lon]);

            if (latlngs.length < 2) {
                skippedCount++;
                return;
            }

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
            
            const elId = el.id || `${latlngs[0][0]}_${latlngs[0][1]}`;
            
            if (!powerlineCache[elId]) {
                newCount++;
            }
            
            powerlineCache[elId] = {
                id: elId,
                latlngs: latlngs,
                tags: tags
            };
        }
    });
    
    // Mark tile keys as fetched
    neededTileKeys.forEach(k => fetchedPowerlineTiles.add(k));
    
    if (newCount > 0) {
        savePowerlineCache();
    }
    
    console.log(`OSM Powerlines: ${newCount} new added to local cache (${Object.keys(powerlineCache).length} total cached), ${skippedCount} skipped (Duke/AEP or outside Indiana)`);
    renderPowerlinesFromCache();
}

// Process Auto-Search Queue (500ms fast queue for ADSBdb static DB, 4.2s for Gemini AI fallback)
async function processAutoSearchQueue() {
    if (isAutoSearchProcessing || autoSearchQueue.length === 0) return;
    isAutoSearchProcessing = true;
    
    while (autoSearchQueue.length > 0) {
        if (!autoSearch) {
            autoSearchQueue.length = 0; // Clear queue if auto-search was toggled off
            break;
        }
        const hex = autoSearchQueue.shift();
        
        // Skip if they manually searched it while it was in queue
        if (!activeSearches.has(hex.toLowerCase())) {
            await fetchMissingAircraftInfo(hex);
            // Wait 500ms before next fast ADSBdb request
            await new Promise(r => setTimeout(r, 500));
        }
    }
    
    isAutoSearchProcessing = false;
}

// ----------------------------------------------------
// 13. Spidertracks Satellite Feed & Modal Handlers
// ----------------------------------------------------
async function fetchSpidertracksFeed() {
    const endpoints = [
        `${window.location.origin}/spidertracks`,
        'http://localhost:8080/spidertracks',
        'http://127.0.0.1:8080/spidertracks',
        'http://localhost:3001/spidertracks',
        'http://127.0.0.1:3001/spidertracks'
    ];
    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, { signal: AbortSignal.timeout(1500) });
            if (res.ok) {
                const data = await res.json();
                if (data && typeof data === 'object') {
                    for (const ac of Object.values(data)) {
                        if (ac && ac.lat && ac.lon) {
                            const cleanTail = (ac.tail || 'SPIDER1').toUpperCase().trim();
                            const spiderHex = `spider_${cleanTail.replace(/[^A-Z0-9]/g, '')}`.toLowerCase();
                            
                            // ANTI-HIJACK CHECK: If a real terrestrial ADS-B flight is already active in the air with this tail, DO NOT OVERWRITE IT!
                            const isRealADSBActive = Object.values(aircraftCache).some(existing => 
                                existing.hex !== spiderHex && 
                                existing.source !== 'Spidertracks Satellite' &&
                                (existing.tail === cleanTail || existing.callsign === cleanTail)
                            );

                            if (isRealADSBActive) {
                                continue; // Skip to protect live ADS-B feed data
                            }

                            const dist = getDistanceNM(ac.lat, ac.lon, KVPZ_COORDS[0], KVPZ_COORDS[1]);
                            aircraftCache[spiderHex] = {
                                hex: spiderHex,
                                callsign: cleanTail,
                                tail: cleanTail,
                                type: ac.type || 'SPDR',
                                desc: ac.desc || 'Spidertracks Satellite Aircraft',
                                lat: ac.lat,
                                lon: ac.lon,
                                alt: ac.alt || 0,
                                speed: ac.speed || 0,
                                vspeed: 0,
                                heading: ac.heading || 0,
                                dist: dist,
                                operator: 'Spidertracks Satellite',
                                lastSeen: Date.now(),
                                mil: 0,
                                categoryClass: 'spidertracks',
                                source: 'Spidertracks Satellite'
                            };
                            updateMapMarker(aircraftCache[spiderHex]);
                        }
                    }
                    updateUI();
                    return;
                }
            }
        } catch(e) {}
    }
}

window.openSpidertracksModal = function() {
    const modal = document.getElementById('spidertracks-modal');
    if (modal) {
        modal.style.display = 'flex';
        const link = document.getElementById('spider-bookmarklet-link');
        if (link) {
            let targetUrl = window.location.origin + '/spidertracks';
            if (window.location.protocol === 'file:') {
                targetUrl = 'http://localhost:8080/spidertracks';
            }
            const code = `javascript:(function(){if(window.spiderSyncTimer){clearInterval(window.spiderSyncTimer);window.spiderSyncTimer=null;var t=document.createElement('div');t.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;padding:12px 18px;background:#ef4444;color:#fff;font-weight:bold;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-size:13px;';t.innerHTML='🛑 Spidertracks Live Sync Stopped';document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},3000);return;}var targetTail=window.spiderTargetTail||prompt('Enter your exact Spidertracks Aircraft Tail Number (e.g. N12345):','N12345');if(!targetTail)return;window.spiderTargetTail=targetTail.toUpperCase().trim();var url='${targetUrl}';var t=document.createElement('div');t.style.cssText='position:fixed;top:20px;right:20px;z-index:99999;padding:12px 18px;background:#10b981;color:#000;font-weight:bold;border-radius:8px;box-shadow:0 4px 15px rgba(0,0,0,0.5);font-size:13px;';t.innerHTML='🛰️ Spidertracks Sync Active for '+window.spiderTargetTail+'!<br><span style="font-weight:normal;font-size:11px;">Click bookmark again anytime to STOP.</span>';document.body.appendChild(t);setTimeout(function(){if(t.parentNode)t.parentNode.removeChild(t);},4000);function s(){try{var txt=document.body.innerText||'';var lat=txt.match(/(?:lat|latitude)[:\\s=]+(-?\\d+\\.\\d+)/i);var lon=txt.match(/(?:lng|lon|longitude)[:\\s=]+(-?\\d+\\.\\d+)/i);var alt=txt.match(/(?:alt|altitude)[:\\s=]+(\\d+)/i)||[null,2500];var spd=txt.match(/(?:speed|gs)[:\\s=]+(\\d+)/i)||[null,110];if(lat&&lon){fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tail:window.spiderTargetTail,lat:parseFloat(lat[1]),lon:parseFloat(lon[1]),alt:parseInt(alt[1]),speed:parseInt(spd[1])})}).catch(function(e){console.warn('Sync error:',e);});}}catch(e){}}s();window.spiderSyncTimer=setInterval(s,5000);})();`;
            link.href = code;
        }
    }
};

window.copySpiderBookmarklet = function() {
    const link = document.getElementById('spider-bookmarklet-link');
    if (link && link.href) {
        navigator.clipboard.writeText(link.href).then(() => {
            alert("📋 Bookmarklet code copied to clipboard!\nYou can paste this into a new bookmark's URL field.");
        }).catch(() => {
            alert("Code: " + link.href);
        });
    }
};

window.closeSpidertracksModal = function() {
    const modal = document.getElementById('spidertracks-modal');
    if (modal) modal.style.display = 'none';
};

window.sendManualSpiderPos = async function() {
    const tail = (document.getElementById('spider-input-tail').value || 'N12345').toUpperCase().trim();
    const lat = parseFloat(document.getElementById('spider-input-lat').value || 41.4542);
    const lon = parseFloat(document.getElementById('spider-input-lon').value || -87.0068);
    
    if (isNaN(lat) || isNaN(lon)) {
        alert("Please enter valid decimal coordinates (e.g. 41.4542, -87.0068)");
        return;
    }

    const payload = { tail, lat, lon, alt: 2500, speed: 110, heading: 180 };
    const endpoints = [`${window.location.origin}/spidertracks`, 'http://localhost:8080/spidertracks', 'http://127.0.0.1:3001/spidertracks'];
    
    for (const ep of endpoints) {
        try {
            const r = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            if (r.ok) {
                alert(`✅ Position for ${tail} pushed successfully! Checking map...`);
                fetchSpidertracksFeed();
                closeSpidertracksModal();
                return;
            }
        } catch(e) {}
    }
    alert("Position stored locally on map!");
    const hex = `SPIDER_${tail.replace(/[^A-Z0-9]/g, '')}`.toLowerCase();
    const dist = getDistanceNM(lat, lon, KVPZ_COORDS[0], KVPZ_COORDS[1]);
    aircraftCache[hex] = {
        hex: hex, callsign: tail, tail: tail, type: 'SPDR', desc: 'Spidertracks Aircraft',
        lat: lat, lon: lon, alt: 2500, speed: 110, vspeed: 0, heading: 180, dist: dist,
        operator: 'Spidertracks Feed', lastSeen: Date.now(), mil: 0, categoryClass: 'spidertracks', source: 'Spidertracks Satellite'
    };
    updateMapMarker(aircraftCache[hex]);
    updateUI();
    closeSpidertracksModal();
};

window.clearSpidertracksFeed = async function() {
    Object.keys(aircraftCache).forEach(hex => {
        if (hex.startsWith('spider_') || (aircraftCache[hex] && aircraftCache[hex].source === 'Spidertracks Satellite')) {
            removeAircraftLayers(hex);
            delete aircraftCache[hex];
        }
    });

    const endpoints = [
        `${window.location.origin}/spidertracks`,
        'http://localhost:8080/spidertracks',
        'http://127.0.0.1:3001/spidertracks'
    ];
    for (const ep of endpoints) {
        try {
            await fetch(ep, { method: 'DELETE' });
        } catch(e) {}
    }

    updateUI();
    closeSpidertracksModal();
    alert("🗑️ All SpiderTracks markers have been removed from the map!");
};

