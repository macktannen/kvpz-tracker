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
let customIconDb = { typeOverrides: {}, tailOverrides: {}, hexOverrides: {} }; // Persistent ICAO type & tail icon overrides
let selectedHex = null;
let currentFilter = 'all';
let searchFilter = '';
let operationsLog = [];

async function loadCustomIconDb() {
    try {
        const stored = safeGetItem('kvpz_custom_icons');
        if (stored) {
            customIconDb = JSON.parse(stored);
        }
    } catch(e) {}

    // Query shared server database file
    const endpoints = [
        `${window.location.origin}/icon-override`,
        'http://localhost:8080/icon-override',
        'http://127.0.0.1:3001/icon-override',
        'custom_icons.json'
    ];

    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const db = await res.json();
                if (db && (db.typeOverrides || db.tailOverrides || db.hexOverrides)) {
                    customIconDb = {
                        typeOverrides: { ...(customIconDb.typeOverrides || {}), ...(db.typeOverrides || {}) },
                        tailOverrides: { ...(customIconDb.tailOverrides || {}), ...(db.tailOverrides || {}) },
                        hexOverrides: { ...(customIconDb.hexOverrides || {}), ...(db.hexOverrides || {}) }
                    };
                    safeSetItem('kvpz_custom_icons', JSON.stringify(customIconDb));
                    console.log('[Custom Icons] Synchronized persistent ICAO type icon overrides from server:', customIconDb);
                    break;
                }
            }
        } catch(e) {}
    }
}

window.saveCustomIconOverrideForType = async function(targetType, targetKey, shapeKey) {
    if (!targetKey) return;
    const cleanKey = targetKey.trim().toUpperCase();
    
    if (!customIconDb.typeOverrides) customIconDb.typeOverrides = {};
    if (!customIconDb.tailOverrides) customIconDb.tailOverrides = {};

    if (targetType === 'type') {
        if (shapeKey === 'default' || shapeKey === 'reset') {
            delete customIconDb.typeOverrides[cleanKey];
        } else {
            customIconDb.typeOverrides[cleanKey] = shapeKey;
        }
    } else if (targetType === 'tail') {
        if (shapeKey === 'default' || shapeKey === 'reset') {
            delete customIconDb.tailOverrides[cleanKey];
        } else {
            customIconDb.tailOverrides[cleanKey] = shapeKey;
        }
    }

    safeSetItem('kvpz_custom_icons', JSON.stringify(customIconDb));

    // Post to server endpoint to update custom_icons.json globally for all users
    const endpoints = [
        `${window.location.origin}/icon-override`,
        'http://localhost:8080/icon-override',
        'http://127.0.0.1:3001/icon-override'
    ];

    for (const ep of endpoints) {
        try {
            await fetch(ep, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targetType, targetKey: cleanKey, shapeKey })
            });
        } catch(e) {}
    }

    refreshAllAircraftLayers();
};
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
    loadCustomIconDb();
    
    // Set checkbox inputs to their corresponding state values
    document.getElementById('toggle-rings').checked = showRings;
    document.getElementById('toggle-labels').checked = showLabels;
    document.getElementById('toggle-trails').checked = showTrails;
    document.getElementById('toggle-powerlines').checked = showPowerlines;
    document.getElementById('toggle-radar').checked = showRadar;
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
    const settingsToggleBtn = document.getElementById('settings-toggle-btn');
    if (settingsToggleBtn) {
        settingsToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const iconContainer = document.getElementById('icon-override-menu-container');
            if (iconContainer) iconContainer.classList.remove('open');
            document.getElementById('map-settings-container').classList.toggle('open');
        });
    }

    // Visual Icon Selector & Type Override Dropdown Toggle Listener
    const iconOverrideBtn = document.getElementById('icon-override-toggle-btn');
    if (iconOverrideBtn) {
        iconOverrideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const styleContainer = document.getElementById('map-settings-container');
            if (styleContainer) styleContainer.classList.remove('open');
            
            const iconContainer = document.getElementById('icon-override-menu-container');
            if (iconContainer) {
                iconContainer.classList.toggle('open');
                if (iconContainer.classList.contains('open')) {
                    if (window.updateIconOverrideDropdownMenu) window.updateIconOverrideDropdownMenu();
                }
            }
        });
    }
    
    // Click outside to close dropdowns
    document.addEventListener('click', (e) => {
        const container = document.getElementById('map-settings-container');
        if (container && !container.contains(e.target)) {
            container.classList.remove('open');
        }
        const iconContainer = document.getElementById('icon-override-menu-container');
        if (iconContainer && !iconContainer.contains(e.target)) {
            iconContainer.classList.remove('open');
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
        if (c.length > 3 && (type.includes(c) || desc.includes(c))) return true;
        return false;
    });

    const tarShapes = {
        'cessna': { viewBox: '0 -1 32 31', sw: 1.8, path: 'M16.36 20.96l2.57.27s.44.05.4.54l-.02.63s-.03.47-.45.54l-2.31.34-.44-.74-.22 1.63-.25-1.62-.38.73-2.35-.35s-.44-.1-.43-.6l-.02-.6s0-.5.48-.5l2.5-.27-.56-5.4-3.64-.1-5.83-1.02h-.45v-2.06s-.07-.37.46-.34l5.8-.17 3.55.12s-.1-2.52.52-2.82l-1.68-.04s-.1-.06 0-.14l1.94-.03s.35-1.18.7 0l1.91.04s.11.05 0 .14l-1.7.02s.62-.09.56 2.82l3.54-.1 5.81.17s.51-.04.48.35l-.01 2.06h-.47l-5.8 1-3.67.11z' },
        'single_turbo': { viewBox: '-2 -2 23 23', sw: 1.5, path: 'M 9.53,0.50 C 9.51,0.54 9.42,0.76 9.38,0.82 9.05,0.53 6.02,0.49 6.02,0.99 c 0.50,0 2.50,0.13 3.33,-0.08 C 8.52,1.63 8.53,3.51 8.23,6.47 L 1.33,7.00 C 0.50,7.07 0.50,7.57 0.50,8.44 L 5.97,9.39 C 6.71,9.58 8.12,10.04 8.12,10.04 c 0,0 0.29,4.81 0.82,6.26 l -2.91,0.67 c 0,0 -0.19,0.63 -0.19,1.20 l 3.54,0.23 0.08,0.11 0.08,-0.11 3.55,-0.20 c -0.00,-0.56 -0.18,-1.20 -0.18,-1.20 L 9.99,16.30 c 0.55,-1.44 0.88,-6.25 0.88,-6.25 0,0 1.41,-0.45 2.15,-0.63 l 5.48,-0.90 c 0.01,-0.87 0.01,-1.38 -0.81,-1.45 L 10.79,6.49 C 10.51,3.52 10.54,1.64 9.71,0.91 10.54,1.13 12.54,1.02 13.04,1.03 13.05,0.52 10.02,0.53 9.68,0.82 9.65,0.76 9.55,0.54 9.53,0.50 Z' },
        'twin_small': { viewBox: '-3 -4 25 22', sw: 1.5, path: 'M9.5,15.75c-.21,0-.34-.17-.41-.51l-2.88.23v-.27c0-.78,0-1.11.28-1.13L9,13.1c-.31-1.86-.55-5-.59-5.55l-.08-.09H6.08L.25,6.54v-1A.43.43,0,0,1,.67,5l3.75-.27L5,4.45V3.53H4.73V2.7a.35.35,0,0,1,.34-.35h.07c.12-.52.26-.83.54-.83s.42.31.53.83h.07a.35.35,0,0,1,.34.35v.83H6.36v1l2-.08C8.42.81,9.09.25,9.49.25s1.09.55,1.12,4.21l2,.08v-1h-.25V2.7a.35.35,0,0,1,.34-.35h.07c.12-.52.26-.83.53-.83s.42.31.54.83h.07a.35.35,0,0,1,.34.35v.83H14v.92l.57.32L18.32,5a.42.42,0,0,1,.43.46v1L13,7.46H10.71l-.08.09c0,.56-.27,3.68-.59,5.55l2.46,1c.28,0,.28.35.28,1.13v.27l-2.88-.23C9.84,15.58,9.71,15.75,9.5,15.75Z' },
        'twin_large': { viewBox: '-2 -3 25 25', sw: 1.5, path: 'M10.1,18.34H7l0-.21c-.08-.54,0-.87.11-1L7.19,17l.2,0,2.35-.33c-.16-.82-.42-2.9-.42-3.14s0-2.71,0-3.51H8c-.12,1.34-.41,1.36-.55,1.37h0c-.19,0-.46,0-.6-1.55L.27,9.52l0-.25c.06-.73.31-.9.45-.93l6-.48a3.65,3.65,0,0,1,.3-2,.45.45,0,0,1,.32-.16h0a.39.39,0,0,1,.3.12A3.67,3.67,0,0,1,8,7.77l1.26-.07c0-.71,0-2.92,0-4.48A3.84,3.84,0,0,1,10.1.4a.4.4,0,0,1,.28-.16h.23A.4.4,0,0,1,10.9.4a3.84,3.84,0,0,1,.87,2.81c0,1.55,0,3.77,0,4.48L13,7.77a3.67,3.67,0,0,1,.29-1.94.38.38,0,0,1,.28-.12.46.46,0,0,1,.34.16,3.66,3.66,0,0,1,.3,2l6,.48c.18,0,.43.21.49.94l0,.25-6.53.3c-.14,1.55-.42,1.55-.59,1.55s-.45,0-.57-1.37H11.74c0,.8,0,3.27,0,3.51s-.26,2.32-.42,3.14l2.38.34h.11l.13.13c.15.18.19.51.11,1l0,.21H10.9l-.4,1Z' },
        'jet_swept': { viewBox: '-1 -1 20 26', sw: 1.5, path: 'M9.44,23c-.1.6-.35.6-.44.6s-.34,0-.44-.6l-3,.67V22.6A.54.54,0,0,1,6,22.05l2.38-1.12L8,19.33H6.69l0-.2a8.23,8.23,0,0,1-.14-3.85l.06-.18H7.73V13.19h-2L.26,14.29v-.93c0-.28.07-.46.22-.53l7.25-3.6V3.85A4.47,4.47,0,0,1,8.83.49L9,.34l.17.15a4.47,4.47,0,0,1,1.1,3.36V9.23l7.25,3.6c.14.07.22.25.22.53v.93l-5.51-1.1h-2V15.1h1.17l.06.18a8.24,8.24,0,0,1-.15,3.84l0,.2H10l-.36,1.6,2.43,1.14a.52.52,0,0,1,.35.53v1.08Z' },
        'jet_nonswept': { viewBox: '-2 -2.4 22 22', sw: 1.5, path: 'M9,17.09l-3.51.61v-.3c0-.65.11-1,.33-1.09L8.5,15a5.61,5.61,0,0,1-.28-1.32l-.53-.41-.1-.69H7.12l0-.21a7.19,7.19,0,0,1-.15-2.19L.24,9.05V8.84c0-1.1.51-1.15.61-1.15L7.8,7.18V2.88C7.8.64,8.89.3,8.93.28L9,.26l.07,0s1.13.36,1.13,2.6v4.3l7,.51c.09,0,.59.06.59,1.15v.21l-6.69,1.16a7.17,7.17,0,0,1-.15,2.19l0,.21h-.47l-.1.69-.53.41A5.61,5.61,0,0,1,9.5,15l2.74,1.28c.2.07.31.43.31,1.08v.3Z' },
        'b737': { viewBox: '-2 -2 74.5 74.7', sw: 3, path: "M34.889 67.926c-1.458.366-14.151 2.859-14.151 2.859l-.069-2.435 12.768-7.019c-1.535-6.777-1.875-8.756-2.06-14.715l-.017-9.018-4.679.026c.018.731-.129 1.457-.429 2.125-.418-.667-.401-1.322-.397-2.101-.794 0-1.561.198-2.352.329.024.836-.095 1.488-.437 2.156-.347-.635-.352-1.136-.402-1.971l-5.735 1.323c-.008.857.04 1.345-.392 2.119-.373-.631-.41-1.257-.41-1.962L1.793 42.793c-1.957.397-1.572.561-1.74 1.544.013-.86-.036-2.334-.026-3.249 0-.52.116-.751.595-.976 7.89-4.004 16.208-7.251 23.891-11.472-.101-.701-.568-.221-.737-.493-.311-2.068-.344-4.905-.118-6.453.04-.224.102-.456.299-.455 1.586.008 1.912-.042 3.26-.013.198.004.294.208.331.427a28.31 28.31 0 0 1 .074 4.847l3.736-3.088c-.013-2.249-.028-5.838.075-7.6C31.705 9.732 33.285.469 35.291.024c2.004.443 3.585 9.706 3.858 15.786.103 1.762.087 5.351.074 7.6l3.736 3.088c-.116-1.359-.087-3.466.074-4.849.037-.218.134-.423.331-.427 1.349-.029 1.673.021 3.26.013.198 0 .259.233.299.456.225 1.548.194 4.384-.118 6.452-.169.274-.635-.208-.736.495 7.681 4.22 16.001 7.468 23.892 11.471.476.225.594.456.593.978.011.914-.04 2.388-.026 3.248-.168-.983.217-1.147-1.738-1.543L54.453 39.64c.001.705-.037 1.332-.41 1.963-.431-.775-.384-1.263-.392-2.119l-5.735-1.323c-.049.833-.054 1.336-.401 1.971-.341-.669-.46-1.322-.437-2.156-.791-.132-1.561-.331-2.353-.331.004.781.021 1.434-.397 2.101-.3-.667-.446-1.392-.429-2.123l-4.679-.026-.016 9.017c-.185 5.96-.527 7.938-2.061 14.716l12.769 7.018-.069 2.435-14.153-2.858c-.097.414-.089 1.302-.401 1.29-.312.013-.304-.876-.402-1.29z" },
        'b738': { viewBox: '-2 -2 74.5 87.3', sw: 3, path: "M34.894 80.404c-1.458.366-14.151 2.859-14.151 2.859l-.069-2.434 12.769-7.019c-1.535-6.779-1.876-8.758-2.061-14.716l-.022-15.412-4.679.026c.018.731-.129 1.457-.429 2.125-.418-.667-.401-1.322-.397-2.101-.794 0-1.561.198-2.352.329.024.836-.095 1.488-.437 2.156-.347-.635-.352-1.136-.402-1.971l-5.735 1.323c-.008.857.04 1.345-.392 2.119-.373-.631-.41-1.257-.41-1.962L1.793 48.877c-1.957.397-1.572.561-1.74 1.544.013-.86-.036-2.334-.026-3.249 0-.52.116-.751.595-.976 7.89-4.004 16.208-7.251 23.891-11.472-.101-.701-.568-.221-.737-.493-.311-2.068-.344-4.905-.118-6.453.04-.224.102-.456.299-.455 1.586.008 1.912-.042 3.26-.013.198.004.294.208.331.427a28.34 28.34 0 0 1 .083 4.839l3.735-3.088.069-13.676C31.706 9.73 33.288.467 35.292.024c2.004.443 3.586 9.706 3.858 15.785.103 1.762.095 11.43.082 13.678l3.735 3.086a28.18 28.18 0 0 1 .075-4.847c.037-.218.124-.415.321-.419 1.349-.029 1.673.021 3.26.013.198 0 .259.233.299.456.225 1.548.194 4.384-.118 6.452-.169.274-.635-.208-.736.495 7.681 4.22 16.001 7.468 23.892 11.471.476.225.594.456.593.978.011.914-.04 2.388-.026 3.248-.168-.983.217-1.148-1.738-1.543l-14.335-3.153c.001.705-.037 1.332-.41 1.963-.431-.775-.384-1.263-.392-2.119l-5.735-1.323c-.049.833-.054 1.336-.401 1.971-.341-.669-.46-1.322-.437-2.156-.791-.132-1.561-.331-2.353-.331.004.781.021 1.434-.397 2.101-.3-.667-.446-1.392-.429-2.123l-4.679-.026-.011 15.412c-.185 5.958-.527 7.938-2.061 14.715l12.769 7.018-.069 2.437-14.151-2.86c-.098.415-.09 1.303-.402 1.292-.312.012-.304-.876-.402-1.291z" },
        'b739': { viewBox: '-2 -2 74.5 92.7', sw: 3, path: "M34.889 85.862c-1.458.366-14.151 2.859-14.151 2.859l-.069-2.435 12.769-7.018c-1.535-6.779-1.876-8.758-2.061-14.716l-.017-18.041-4.679.026c.018.731-.129 1.457-.429 2.125-.418-.667-.401-1.322-.397-2.101-.794 0-1.561.198-2.352.329.024.836-.095 1.488-.437 2.156-.347-.635-.352-1.136-.402-1.971l-5.735 1.323c-.008.857.04 1.345-.392 2.119-.373-.631-.41-1.257-.41-1.962L1.793 51.707c-1.957.397-1.572.561-1.74 1.544.013-.86-.036-2.334-.026-3.249 0-.52.116-.751.595-.976 7.89-4.004 16.208-7.251 23.891-11.472-.101-.701-.568-.221-.737-.493-.311-2.068-.344-4.905-.118-6.453.04-.224.102-.456.299-.455 1.586.008 1.912-.042 3.26-.013.198.004.298.21.335.429.161 1.382.198 3.481.082 4.839l3.736-3.086.065-16.507C31.706 9.732 33.287.469 35.292.026c2.004.443 3.585 9.706 3.858 15.785.103 1.762.098 14.258.085 16.507l3.736 3.088a28.19 28.19 0 0 1 .071-4.85c.037-.218.124-.415.321-.419 1.349-.029 1.673.021 3.26.013.198 0 .259.233.299.456.225 1.548.194 4.384-.118 6.452-.169.274-.635-.208-.736.495 7.681 4.22 16.001 7.468 23.892 11.471.476.225.594.456.593.978.011.914-.04 2.388-.026 3.248-.168-.983.217-1.148-1.738-1.543l-14.335-3.153c.001.705-.037 1.332-.41 1.963-.431-.775-.384-1.263-.392-2.119l-5.735-1.323c-.049.833-.054 1.336-.401 1.971-.341-.669-.46-1.322-.437-2.156-.791-.132-1.561-.331-2.353-.331.004.781.021 1.434-.397 2.101-.3-.667-.446-1.392-.429-2.123l-4.679-.026-.016 18.039c-.185 5.96-.527 7.938-2.061 14.716l12.769 7.018-.069 2.437-14.151-2.86c-.098.415-.09 1.303-.402 1.292-.312.012-.304-.877-.401-1.291z" },
        'a319': { viewBox: '-10 -10 380 373', sw: 16, path: "M160.574 263.98c2.88 19.23 5.92 26.17 5.61 29.66.04 1.3-.3 2.17-.93 2.67-7.24 5.72-50.22 32.65-50.66 34.44-.76 2.3-.53 12.26.12 12.92l56.5-13.24c2.01 7.89 4.2 14.9 6.43 22.07h4.91c2.23-7.16 4.42-14.18 6.43-22.07l56.5 13.24c.65-.65.88-10.62.12-12.92-.44-1.78-43.42-28.72-50.67-34.44-.62-.5-.96-1.38-.93-2.67-.3-3.5 2.73-10.43 5.61-29.66 2.43-20.77 1-53.35 1.54-78.49h27.68c-.35 2.48 1.18 7.97 2.1 7.79 1.6-.84 1.85-5.49 1.83-8.28h5.81c.22 1.21.39 3.83 1.3 4.01 1.13 0 1.24-3.07 1.44-4.01 9.06-.15 9.09.66 22.46 4.28.6.15 1.11.51 1.14 1.11-.1 3.12.49 8.1 2 8.25 1.49-.62 1.9-5.29 1.99-7.76l33.56 10.1c-.11 4.05.39 8.45 1.75 9.14 1.3.16 1.96-5.45 2.43-7.8l50.94 15.49c.63 2.2-.41 4.93 1.17 4.83.34.02.69-.15.77-.53.26-3.24.3-6.89.28-9.93l-.12-6.34c-.1-1.34-.06-2.72-1.95-4.33-7.72-5.4-73.22-37.45-107.72-56.62-2.87-1.59-2.62-1.71-2.81-2.26-.14-1.19 1.33-1.04 1.52-2.13.8-1.09 4.16-26.76.37-35.02l-18.37.3c-.3 0-.16.37-.3.6-2.85 11.04-1.55 17.15-.25 28.62a610 610 0 0 1-25.56-13.47c-1.03-.84-2.79-3.24-2.86-5.2l-1.03-74.98c-.02-10.65-10.22-33.63-16.25-38.93a6.64 6.64 0 0 0-4.14-1.92c-.15 0-2.32.2-4.22 1.92-6.03 5.3-16.22 28.28-16.24 38.93l-1.32 74.99c-.07 1.94-1.83 4.35-2.86 5.19-7.05 4.05-17.39 9.35-25.56 13.47 1.3-11.47 2.6-17.58-.24-28.62-.14-.23 0-.6-.3-.61l-18.38-.3c-3.78 8.27-.42 33.94.38 35.03.19 1.09 1.66.94 1.52 2.13-.2.55.05.67-2.81 2.26-34.5 19.17-100 51.2-107.72 56.62-1.9 1.61-1.86 2.99-1.96 4.33 0 1.68-.37 9.79.17 16.27.08.38.42.55.77.53 1.58.1.54-2.62 1.16-4.83 2.36-1.05 35.27-10.8 50.94-15.49.48 2.35 1.13 7.96 2.43 7.8 1.37-.7 1.87-5.09 1.75-9.14l33.56-10.1c.09 2.47.5 7.14 2 7.76 1.5-.15 2.09-5.14 2-8.25.02-.6.54-.96 1.14-1.1 13.37-3.63 13.4-4.45 22.45-4.3.2.95.32 4.03 1.44 4.02.92-.18 1.08-2.8 1.3-4.01h5.81c-.02 2.8.23 7.44 1.83 8.28.93.18 2.45-5.31 2.1-7.79h27.69c.47 26.24-1.3 62.82 1.41 78.49z" },
        'a320': { viewBox: '-10 -10 380 415', sw: 16, path: "m359.814 226.26-.13-6.33c-.1-1.34-.06-2.72-1.95-4.34-7.72-5.4-73.22-37.44-107.72-56.6-2.87-1.6-2.62-1.73-2.81-2.27-.14-1.19 1.33-1.04 1.52-2.13.8-1.1 4.16-26.77.37-35.03l-18.37.3c-.3 0-.16.38-.3.6-2.85 11.05-1.55 17.16-.25 28.62a588 588 0 0 1-25.56-13.47c-1.03-.83-2.79-3.24-2.86-5.18-.84-5.06-.6-83.1-1.17-89.08-.02-10.65-10.22-33.63-16.25-38.93a6.64 6.64 0 0 0-4.14-1.92c-.15 0-2.32.2-4.21 1.92-6.04 5.3-16.23 28.28-16.25 38.92-.58 5.99-.33 84.03-1.18 89.08-.07 1.95-1.83 4.36-2.86 5.2-7.05 4.05-17.39 9.35-25.56 13.46 1.3-11.46 2.6-17.57-.24-28.62-.14-.22 0-.6-.3-.6l-18.38-.3c-3.78 8.26-.42 33.93.38 35.03.19 1.09 1.66.94 1.52 2.13-.2.54.05.67-2.81 2.26-34.5 19.17-100 51.2-107.73 56.61-1.89 1.62-1.85 3-1.95 4.33 0 1.69-.37 9.8.17 16.28.08.38.42.54.76.52 1.59.1.55-2.62 1.17-4.83 2.36-1.04 35.27-10.8 50.94-15.48.47 2.34 1.13 7.95 2.43 7.8 1.36-.7 1.87-5.1 1.75-9.15l33.56-10.1c.09 2.47.5 7.14 2 7.76 1.5-.15 2.09-5.13 2-8.24.02-.6.53-.96 1.14-1.11 13.37-3.62 13.4-4.44 22.45-4.29.2.94.32 4.02 1.44 4.01.92-.17 1.08-2.8 1.3-4h5.81c-.02 2.79.23 7.44 1.83 8.27.92.18 2.45-5.3 2.1-7.78h27.69c.3 40.33-.65 95.32 1.47 108.16 2.88 19.23 5.91 26.17 5.61 29.65.04 1.3-.3 2.18-.93 2.68-7.25 5.72-50.23 32.65-50.67 34.44-.76 2.3-.53 12.26.13 12.92l56.5-13.24c2 7.89 4.2 14.9 6.42 22.07h4.92a424 424 0 0 0 6.42-22.07l56.5 13.24c.65-.65.89-10.62.13-12.92-.44-1.78-43.42-28.72-50.67-34.44-.63-.5-.97-1.38-.93-2.67-.3-3.5 2.73-10.43 5.61-29.66 2.12-12.83 1.17-67.83 1.47-108.16h27.69c-.35 2.48 1.17 7.97 2.1 7.78 1.6-.83 1.85-5.48 1.83-8.27h5.8c.23 1.2.4 3.83 1.31 4 1.12.02 1.23-3.07 1.44-4 9.05-.16 9.08.66 22.45 4.28.6.15 1.12.5 1.15 1.1-.1 3.12.49 8.1 2 8.25 1.49-.62 1.9-5.28 1.99-7.76l33.56 10.1c-.12 4.06.39 8.45 1.75 9.15 1.3.15 1.96-5.46 2.43-7.8l50.94 15.49c.62 2.2-.42 4.92 1.17 4.83.34.02.68-.15.76-.53.27-3.24.31-6.9.29-9.94z" },
        'a321': { viewBox: '-10 -10 380 485', sw: 16, path: "M160.674 375.1c2.88 19.24 5.91 26.17 5.61 29.66.04 1.3-.3 2.18-.93 2.67-7.24 5.72-50.22 32.66-50.66 34.45-.76 2.3-.53 12.26.12 12.92l56.5-13.25c2 7.9 4.2 14.91 6.42 22.08h4.92c2.23-7.16 4.42-14.18 6.43-22.08l56.5 13.25c.65-.66.88-10.62.12-12.92-.44-1.79-43.42-28.72-50.67-34.44-.62-.5-.96-1.38-.93-2.68-.3-3.49 2.73-10.42 5.61-29.65 3.14-16.96 1.06-90.04 1.44-134.91h27.68c-.35 2.47 1.18 7.96 2.1 7.78 1.6-.84 1.85-5.48 1.83-8.28h5.81c.22 1.21.39 3.84 1.3 4.01 1.13.01 1.24-3.07 1.44-4 9.06-.16 9.09.65 22.46 4.28.6.14 1.11.5 1.14 1.1-.1 3.12.49 8.1 2 8.25 1.5-.62 1.9-5.29 2-7.76l33.55 10.1c-.11 4.05.4 8.45 1.76 9.14 1.3.16 1.95-5.45 2.43-7.8l50.93 15.49c.63 2.2-.41 4.93 1.17 4.83.34.02.69-.14.77-.53.27-3.24.3-6.89.28-9.93l-.12-6.34c-.1-1.34-.06-2.72-1.95-4.33-7.72-5.4-73.22-37.45-107.72-56.61-2.87-1.6-2.62-1.72-2.81-2.26-.14-1.2 1.33-1.05 1.52-2.13.8-1.1 4.16-26.77.37-35.03l-18.37.3c-.3 0-.16.38-.3.6-2.85 11.05-1.55 17.15-.24 28.62-8.18-4.12-18.52-9.42-25.57-13.47-1.03-.84-2.79-3.24-2.86-5.19l-1.52-129.7c-.02-10.64-10.21-33.62-16.25-38.92a6.64 6.64 0 0 0-4.13-1.92c-.16 0-2.32.2-4.22 1.92-6.03 5.3-16.23 28.28-16.25 38.93l-.83 129.69c-.06 1.95-1.83 4.35-2.85 5.19-7.06 4.05-17.4 9.35-25.57 13.47 1.3-11.47 2.61-17.58-.24-28.62-.14-.23 0-.6-.3-.6l-18.38-.3c-3.78 8.26-.42 33.93.38 35.02.19 1.1 1.66.94 1.52 2.13-.19.55.05.67-2.81 2.26-34.5 19.17-100 51.21-107.72 56.62-1.9 1.61-1.86 2.99-1.95 4.33-.01 1.68-.38 9.79.16 16.27.08.39.42.55.77.53 1.58.1.54-2.62 1.16-4.83 2.37-1.05 35.27-10.8 50.94-15.48.48 2.34 1.14 7.95 2.43 7.8 1.37-.7 1.87-5.1 1.75-9.15l33.57-10.1c.08 2.47.5 7.14 1.99 7.76 1.5-.15 2.1-5.13 2-8.25.02-.6.54-.96 1.14-1.1 13.37-3.63 13.4-4.44 22.46-4.29.2.94.3 4.02 1.43 4.01.92-.18 1.08-2.8 1.3-4h5.81c-.01 2.78.23 7.43 1.83 8.27.93.18 2.45-5.3 2.1-7.78h27.69c.5 44.97-.9 117.74 1.5 134.9z" },
        'airliner': { viewBox: '-1 -2 34 34', sw: 1.5, path: 'M16 1c-.17 0-.67.58-.9 1.03-.6 1.21-.6 1.15-.65 5.2-.04 2.97-.08 3.77-.18 3.9-.15.17-1.82 1.1-1.98 1.1-.08 0-.1-.25-.05-.83.03-.5.01-.92-.05-1.08-.1-.25-.13-.26-.71-.26-.82 0-.86.07-.78 1.5.03.6.08 1.17.11 1.25.05.12-.02.2-.25.33l-8 4.2c-.2.2-.18.1-.19 1.29 3.9-1.2 3.71-1.21 3.93-1.21.06 0 .1 0 .13.14.08.3.28.3.28-.04 0-.25.03-.27 1.16-.6.65-.2 1.22-.35 1.28-.35.05 0 .12.04.15.17.07.3.27.27.27-.08 0-.25.01-.27.7-.47.68-.1.98-.09 1.47-.1.18 0 .22 0 .26.18.06.34.22.35.27-.01.04-.2.1-.17 1.06-.14l1.07.02.05 4.2c.05 3.84.07 4.28.26 5.09.11.49.2.99.2 1.11 0 .19-.31.43-1.93 1.5l-1.93 1.26v1.02l4.13-.95.63 1.54c.05.07.12.09.19.09s.14-.02.19-.09l.63-1.54 4.13.95V29.3l-1.93-1.27c-1.62-1.06-1.93-1.3-1.93-1.49 0-.12.09-.62.2-1.11.19-.81.2-1.25.26-5.09l.05-4.2 1.07-.02c.96-.03 1.02-.05 1.06.14.05.36.21.35.27 0 .04-.17.08-.16.26-.16.49 0 .8-.02 1.48.1.68.2.69.21.69.46 0 .35.2.38.27.08.03-.13.1-.17.15-.17.06 0 .63.15 1.28.34 1.13.34 1.16.36 1.16.61 0 .35.2.34.28.04.03-.13.07-.14.13-.14.22 0 .03 0 3.93 1.2-.01-1.18.02-1.07-.19-1.27l-8-4.21c-.23-.12-.3-.21-.25-.33.03-.08.08-.65.11-1.25.08-1.43.04-1.5-.78-1.5-.58 0-.61.01-.71.26-.06.16-.08.58-.05 1.08.04.58.03.83-.05.83-.16 0-1.83-.93-1.98-1.1-.1-.13-.14-.93-.18-3.9-.05-4.05-.05-3.99-.65-5.2C16.67 1.58 16.17 1 16 1z' },
        'heavy_2e': { viewBox: '0 -3.2 64.2 64.2', sw: 2.2, path: "m 31.414,2.728 c -0.314,0.712 -1.296,2.377 -1.534,6.133 l -0.086,13.379 c 0.006,0.400 -0.380,0.888 -0.945,1.252 l -2.631,1.729 c 0.157,-0.904 0.237,-3.403 -0.162,-3.850 l -2.686,0.006 c -0.336,1.065 -0.358,2.518 -0.109,4.088 h 0.434 L 24.057,26.689 8.611,36.852 7.418,38.432 7.381,39.027 8.875,38.166 l 8.295,-2.771 0.072,0.730 0.156,-0.004 0.150,-0.859 3.799,-1.234 0.074,0.727 0.119,0.004 0.117,-0.832 2.182,-0.730 h 1.670 l 0.061,0.822 h 0.176 l 0.062,-0.822 4.018,-0.002 v 13.602 c 0.051,1.559 0.465,3.272 0.826,4.963 l -6.836,5.426 c -0.097,0.802 -0.003,1.372 0.049,1.885 l 7.734,-2.795 0.477,1.973 h 0.232 l 0.477,-1.973 7.736,2.795 c 0.052,-0.513 0.146,-1.083 0.049,-1.885 l -6.836,-5.426 c 0.361,-1.691 0.775,-3.404 0.826,-4.963 V 33.193 l 4.016,0.002 0.062,0.822 h 0.178 L 38.875,33.195 h 1.672 l 2.182,0.730 0.117,0.832 0.119,-0.004 0.072,-0.727 3.799,1.234 0.152,0.859 0.154,0.004 0.072,-0.730 8.297,2.771 1.492,0.861 -0.037,-0.596 -1.191,-1.580 -15.447,-10.162 0.363,-1.225 H 41.125 c 0.248,-1.569 0.225,-3.023 -0.111,-4.088 l -2.686,-0.006 c -0.399,0.447 -0.317,2.945 -0.160,3.850 L 35.535,23.492 C 34.970,23.128 34.584,22.640 34.590,22.240 L 34.504,8.910 C 34.193,4.926 33.369,3.602 32.934,2.722 32.442,1.732 31.894,1.828 31.414,2.728 Z" },
        'heavy_4e': { viewBox: '0 0 64 64', sw: 2.2, path: "m 30.764,3.957 c -1.030,1.995 -1.438,5.650 -1.600,7.687 -0.248,3.120 -0.114,5.478 -0.156,7.568 -0.016,0.798 -0.737,1.483 -1.435,2.163 l -4.630,4.207 c 0.136,-0.609 0.313,-2.735 0.011,-3.413 l -2.147,-0.067 c -0.337,0.636 -0.227,2.516 -0.102,3.486 l 0.414,0.033 0.179,1.447 -5.794,5.342 c 0.077,-0.914 0.114,-2.161 -0.105,-2.633 l -2.172,-0.078 c -0.367,0.716 -0.185,2.323 -0.053,3.475 h 0.394 l 0.138,0.949 -7.991,6.563 C 5.411,40.937 5.586,41.437 5.564,41.830 l -0.694,2.353 0.005,0.991 0.715,-1.236 10.464,-6.218 c 0.012,0.663 0.110,1.051 0.231,1.010 0.135,-0.045 0.328,-0.852 0.361,-1.290 l 2.274,-1.389 c -0.003,0.493 0.054,1.174 0.196,1.088 0.126,-0.076 0.384,-0.807 0.362,-1.370 l 1.528,-0.943 2.988,-1.018 c 0.073,0.381 0.122,0.929 0.292,0.896 0.159,-0.031 0.257,-0.491 0.355,-1.065 l 1.704,-0.597 c 0.025,0.437 0.163,0.976 0.297,0.914 0.149,-0.070 0.339,-0.647 0.356,-1.118 l 1.935,-0.666 0.054,10.106 c 0.183,3.800 0.173,5.797 0.919,9.127 -0.072,0.573 -0.374,0.766 -0.640,1.020 l -6.724,6.317 -0.007,2.046 8.553,-2.312 c 0.019,0.586 0.061,1.045 0.432,1.368 l 0.146,1.817 0.146,-1.817 c 0.371,-0.323 0.413,-0.782 0.432,-1.368 l 8.553,2.312 -0.007,-2.046 -6.724,-6.317 c -0.266,-0.253 -0.569,-0.446 -0.640,-1.020 0.747,-3.331 0.736,-5.327 0.919,-9.127 l 0.054,-10.106 1.935,0.666 c 0.017,0.470 0.207,1.048 0.356,1.118 0.134,0.062 0.272,-0.477 0.297,-0.914 l 1.704,0.597 c 0.098,0.574 0.196,1.034 0.355,1.065 0.170,0.033 0.219,-0.515 0.292,-0.896 l 2.988,1.018 1.528,0.943 c -0.021,0.563 0.237,1.294 0.362,1.370 0.141,0.086 0.198,-0.595 0.196,-1.088 l 2.274,1.389 c 0.033,0.439 0.227,1.245 0.361,1.290 0.121,0.041 0.219,-0.347 0.231,-1.010 l 10.464,6.218 0.715,1.236 0.005,-0.991 -0.694,-2.353 c -0.021,-0.393 0.153,-0.893 -0.151,-1.143 l -7.991,-6.563 0.138,-0.949 h 0.394 c 0.132,-1.152 0.314,-2.760 -0.053,-3.475 l -2.172,0.078 c -0.218,0.472 -0.182,1.719 -0.105,2.633 l -5.794,-5.342 0.179,-1.447 0.414,-0.033 c 0.125,-0.970 0.236,-2.850 -0.102,-3.486 l -2.147,0.067 c -0.302,0.678 -0.125,2.804 0.011,3.413 l -4.630,-4.207 c -0.698,-0.680 -1.419,-1.365 -1.435,-2.163 -0.042,-2.090 0.092,-4.448 -0.156,-7.568 -0.162,-2.037 -0.600,-5.677 -1.600,-7.687 -0.592,-1.190 -1.211,-1.157 -1.809,0 z" },
        'a359': { viewBox: '-20 -20 562 578', sw: 20, path: "M237.77 72.911c-1.33 31.55-.18 76.46-.65 103.26-.41 5.93-12.66 14.72-20.17 20.6-8.23 6-17.4 12.8-25.3 19.22 1.78-11.25 2.67-24.53-.85-36.54-.36-.8-.84-1.46-1.81-1.62a139.6 139.6 0 0 0-23.52 0c-.42-.03-1.51.6-1.72 1.18-3.45 9.7-3.78 24.81.65 45.74.2.95 2.63.48 3.75.71l.66 2.6 2.49.07v2.92c-47.16 34.9-116.96 79.7-159.74 112.83-3.1 2.71-7.24 8.15-8.85 12.58-1.93 3.35-3.02 18.22-1.48 17.74 1.11-.04-.15-7.84 5.11-11.96 5-6.14 88.92-38.18 115.75-49.92.32 1.77 1.28 5.92 1.84 6.05 1.22-.63 1.86-5.25 2.55-7.85l31.23-12.26c.34 1.96 1.3 6.51 1.96 6.44.89-.39 2.03-5.01 2.53-8.04 10.54-4 21.91-6.29 34-6.73.37 2.36 1.41 7.66 2.14 7.59 1.2-.76 1.83-4.94 2.52-7.87a735 735 0 0 1 33.22-.76c.07 9.1.74 24.91 3.2 30.65.19 20.22-.58 67.09.83 86.7 1.21 17.82 5.75 39.31 10.65 58.48-.1 2.33-.95 4.6-2.48 6.37-16.17 13.36-37.07 27.7-53.92 42.29-5.92 6.27-6.03 12.24-8.74 24.76l71.52-25.56a127 127 0 0 0 3.77 12.72h.96c.16 3.44.24 10.32 1.2 10.99.97-.67 1.07-7.53 1.23-10.97h.95a127 127 0 0 0 3.78-12.73l71.51 25.57c-2.7-12.52-2.8-18.49-8.73-24.76-16.85-14.6-37.75-28.93-53.93-42.3a10.43 10.43 0 0 1-2.47-6.36c4.9-19.17 9.43-40.66 10.65-58.5 1.41-19.6.64-66.46.83-86.69 2.45-5.73 3.12-21.55 3.2-30.64 10.38.04 22.88.22 33.22.76.68 2.93 1.32 7.1 2.52 7.86.73.08 1.77-5.22 2.14-7.58a106.2 106.2 0 0 1 34 6.73c.5 3.03 1.64 7.65 2.53 8.04.65.07 1.61-4.49 1.95-6.44 8.77 3.19 22.49 8.72 31.23 12.26.7 2.6 1.33 7.22 2.56 7.85.56-.13 1.52-4.28 1.84-6.05 26.83 11.74 110.74 43.78 115.75 49.92 5.26 4.12 4 11.92 5.1 11.96 1.55.48.46-14.39-1.47-17.74-1.61-4.43-5.75-9.87-8.85-12.59-42.78-33.12-112.58-77.92-159.74-112.83v-2.91l2.48-.08.67-2.6c1.12-.22 3.54.24 3.75-.7 4.43-20.93 4.1-36.04.64-45.74-.2-.58-1.29-1.2-1.71-1.19a139.6 139.6 0 0 0-23.52.01c-.97.16-1.45.82-1.8 1.62-3.53 12.01-2.64 25.28-.86 36.54a624 624 0 0 0-25.3-19.22c-7.51-5.88-19.76-14.67-20.17-20.6-.47-26.8.67-71.72-.66-103.26-.33-14.07-11.85-71.55-23.3-72.43-11.46.86-22.98 58.34-23.31 72.41z" },
        'a332': { viewBox: '-50 -50 1370 1353', sw: 42, path: "M640.424 1251.25c1.83-1.53 3.8-32.27 6.55-53.53l195.5 54.86c1.46 0-2.95-42.47-4.87-46.95-.82-1.92-2.89-5-4.74-6.73-61.32-38.85-113.44-66.94-170.42-102.2 14.04-101.98 28.3-176.49 31.36-236.63 2.42-64.73 1.9-89.45 1.9-158a238.4 238.4 0 0 0 10.29-45.93l79.36.94c.64 10.63 4.56 30.22 8.15 30.42 1.8.01 7.3-16.95 7.33-23.64.03-5.85 1.2-7.27 4.47-7.27 17 4.17 37.8 12.02 55.51 18.1-.57 8.16 4.26 30.31 8.26 31.41 3.21-.48 6.95-20.08 8.12-25.27l52.15 17.53c1.88 12.2 4.92 29.7 8.72 31.1 3.44.79 7.1-21.05 8.56-24.84 1.15-.01 50.81 17.18 51.5 17.83 2.09 10.83 5.7 29.92 8.9 30.99 3.44 1 7.17-19.9 8.21-25.3 32.2 8.64 234.77 99.3 244.66 106.02 3.17 1.94 6.28 4.17 9.4 6.34.36-6.3.43-12.19.66-18.49-7.3-17.2-16.23-36.38-16.1-41.66 0-3.58-.42-5.35-2.61-7.49l-413.4-257.15c0-.74 1.07-1.44 2.43-2.1 3.88-5.52 7.02-32.88 11.3-45.13.1-5.05 8.47-1.33 8-4.5 5.58-18.8 6.18-81.92 1.68-103.47-1.14-.93-61.73-1.84-61.49.32-6.39 32.18-3.2 77.43 1.42 104.14 2.63.47 5.72.27 8.51.31 2.93 14.19 5.05 24.57 7.06 37.92l-120.5-73.55c-1.24-92.1.3-231-2.17-260.1C691.574 110.06 655.244.52 635.224.5c-20.01.03-56.34 109.57-58.84 169.04-2.48 29.11-.93 168-2.18 260.1l-120.49 73.56c2.01-13.35 4.13-23.74 7.05-37.92 2.8-.05 5.89.16 8.52-.32 4.61-26.7 7.8-71.95 1.42-104.13.24-2.16-60.35-1.26-61.5-.33-4.5 21.56-3.89 84.67 1.7 103.49-.48 3.16 7.9-.56 7.98 4.5 4.28 12.24 7.43 39.6 11.31 45.12 1.35.66 2.44 1.36 2.42 2.1-144.21 93.67-277.18 170.05-413.4 257.15-2.19 2.13-2.61 3.9-2.61 7.49.14 5.28-8.8 24.46-16.1 41.66l.65 18.5c3.12-2.18 6.24-4.42 9.4-6.35 9.9-6.71 212.46-97.38 244.66-106.01 1.04 5.39 4.77 26.3 8.21 25.29 3.21-1.07 6.82-20.16 8.9-31 .7-.64 50.35-17.83 51.5-17.82 1.48 3.8 5.13 25.63 8.57 24.85 3.8-1.4 6.84-18.9 8.71-31.11l52.16-17.53c1.17 5.2 4.9 24.79 8.11 25.27 4-1.1 8.83-23.26 8.27-31.42 17.7-6.07 38.5-13.93 55.51-18.1 3.26 0 4.44 1.43 4.46 7.28.03 6.7 5.54 23.64 7.34 23.64 3.59-.2 7.5-19.8 8.15-30.42l79.36-.94a238.5 238.5 0 0 0 10.29 45.93c0 68.55-.52 93.26 1.9 158 3.06 60.14 17.32 134.65 31.35 236.62l-170.41 102.21a23.9 23.9 0 0 0-4.75 6.73c-1.91 4.47-6.32 46.95-4.87 46.95l195.49-54.89c3.34 22.79 4.74 52.12 6.75 53.58.84 1.47 9.27 1.38 10.2-.02z" },
        'md11': { viewBox: '-4 -4 72 72', sw: 2, path: 'm 32,0.7 0.3,0.1 0.4,0.4 0.5,0.8 0.6,1.4 0.4,1.7 0.7,4.2 0.2,4.1 0,11.8 4.1,3.2 -0.2,-1.1 0,-1.2 0.1,-1.1 0.2,-0.4 2.5,0 0.2,0.4 0.1,1.1 0,1.2 -0.3,1.3 -0.3,0 -0.3,1.5 16.6,13.4 0,0.6 0.4,2.2 0,1.2 -0.4,-0.9 0,0.3 -9.6,-4.6 -0.1,0.6 -0.1,0.3 -0.1,0 -0.1,-0.3 -0.1,-0.8 -4.5,-2.3 -0.1,0.7 -0.1,0.4 -0.1,0 -0.1,-0.4 -0.1,-0.9 -1.1,-0.6 -6.5,-1.4 0,4.4 -0.1,4.2 -0.5,3.7 -0.6,3.3 6.6,5.5 0,3.2 -7,-2.6 -0.1,0.8 -0.2,0.7 -0.3,0 -0.5,2.1 -0.2,0 -0.2,0.6 -0.2,-0.6 -0.2,0 -0.5,-2.1 -0.3,0 -0.2,-0.7 -0.1,-0.8 -7,2.5 0,-3.1 6.6,-5.5 -0.6,-3.3 -0.5,-3.7 -0.1,-4.2 0,-4.4 -6.5,1.4 -1.1,0.6 -0.1,0.9 -0.1,0.3 -0.1,0 -0.1,-0.3 -0.1,-0.7 -4.5,2.3 -0.1,0.8 -0.1,0.3 -0.1,0 -0.1,-0.3 -0.1,-0.6 -9.6,4.6 0,-0.3 -0.4,0.9 0,-1.2 0.4,-2.2 0,-0.6 16.6,-13.4 -0.3,-1.5 -0.3,0 -0.3,-1.3 0,-1.2 0.1,-1.1 0.2,-0.4 2.5,0 0.2,0.4 0.1,1.1 0,1.2 -0.2,1.1 4.1,-3.3 0,-11.7 0.2,-4.1 0.7,-4.2 0.4,-1.7 0.6,-1.4 0.5,-0.8 0.4,-0.4 z' },
        'c130': { viewBox: '-1 -16 64 64', sw: 2.2, path: 'm 31,1 1,0 1,1 1,2 0,8 3,0 0,-3 1,-1 1,1 0,3 6,0 0,-3 1,-1 1,1 0,3 10,1 0,2 -1,1 -17,3 -5,0 0,10 -1,1 8,2 0,1 -1,1 -8,0 -1,1 -1,-1 -8,0 -1,-1 0,-1 8,-2 -1,-1 0,-10 -5,0 -17,-3 -1,-1 0,-2 10,-1 0,-3 1,-1 1,1 0,3 6,0 0,-3 1,-1 1,1 0,3 3,0 0,-8 1,-2 1,-1 z' },
        'a400': { viewBox: '-9.5 0 140 140', sw: 4, path: 'm 60.2353,6.87783 L62.5882,9.40724 L63.1312,5.07692 L63.7059,11.3484 L67.1765,19.0543 L67.4706,39.5837 L70.4118,45.2896 L77.2941,47.8778 L77,43.9367 L78.2941,39.6425 L72.7059,38.7149 L77.4118,38.2896 L79.1176,35.8778 L80.7647,38.2308 L87,38.8914 L80.8235,39.9367 L81.2941,43.4661 L80.9412,48.6199 L93.5294,52.9367 L93.5294,48.3484 L94.2941,44.3484 L89.1765,43.819 L94.1176,42.7602 L95.5882,40.4661 L97.1176,42.7602 L102.471,43.5747 L97.1176,44.5249 L98,48.2896 L97.3756,54.0905 L118.683,62.0181 L118.706,68.6425 L100.941,67.2443 L99.4118,70.0543 L98.9412,67.1131 L91.5294,66.267 L90.7647,68.8778 L89.7059,66.2896 L83.8235,65.7738 L82.9412,69.1719 L82.3529,65.6516 L73.4118,64.819 L72.4706,68.9955 L71.5294,64.5837 L70.7059,68.7602 L67.7647,71.2308 L67.5294,91.5131 L63.9882,110.925 L85.3529,127.348 L86.2941,132.878 L61.5882,123.348 L60.3529,127.466 L59.4118,123.231 L33.5882,132.29 L34.8824,126.878 L56.2353,110.819 L53,91.3484 L52.5882,72.1131 L49.7059,68.7602 L49.1765,64.6425 L48.0588,68.5249 L46.8824,64.8869 L38.4706,65.5747 L37.2941,69.3484 L36.3529,65.9955 L30.6471,66.1719 L29.7059,69.2896 L28.5294,66.3394 L21.4118,67.0679 L20.7059,70.1719 L19.5294,67.1719 L1.39819,68.5611 L1.65611,61.7828 L22.8824,54.2896 L22.5294,48.7014 L23.5882,43.819 L17.7059,43.4661 L23.1765,42.4661 L24.5882,40.1719 L25.8235,42.4661 L31.7059,43.4796 L26.1176,44.3484 L26.7647,48.7602 L26.0588,53.0679 L38.9412,48.7964 L39.1765,43.8778 L40.1176,39.4072 L33.2353,39.0543 L39.7647,37.7014 L41.2941,35.1719 L42.1765,38.0543 L48,38.8326 L42.6471,40.0543 L43.2805,44.0543 L42.8824,47.5837 L50,44.9955 L52.5294,40.1131 L53,18.5249 L56.1765,11.2308 z' },
        'a225': { viewBox: '75 -4 72 72', sw: 2, path: ' M123.984 55.377l.768 2.092.09 3.559-.655 1.058-.27 1.78-.43-1.828-10.175-3.944-.655-.072-.36 1.876-2.009.024-.451-1.852h-.564l-10.154 4.233-.316 1.803-.428-1.78-.61-.769-.045-3.92.745-2.044.722 1.275L108.506 51l-.767-17.051-6.882.072-21.12 8.682v-2.309l.79-1.66 11.327-8.176-1.016-1.37.023-3.368.564-.529h1.399l.519.626.113 3.727 3.497-2.573-.587-.986-.09-3.223.339-.697h1.76l.45.577v3.006l3.43-2.405-.654-.77-.022-3.823.586-.457h1.287l.518.601v3.247l3.362-2.886v-8.032l.316-3.512.226-2.212.79-2.67.857-1.515.654-.841.677.048.542.457.654 1.25.587 1.058.541 1.804.316 1.515.271 1.732.113 2.91.225 7.767 3.51 2.97-.091-3.198.429-.59 1.635-.023.395.553.08 3.547-.587.83 3.452 2.429-.09-2.958.406-.746h1.602l.541.577.023 3.391-.61.938 3.633 2.477-.045-3.872.564-.577h1.264l.564.722.045 3.367-.88 1.274 11.192 7.6.79.841.248.842.18.721v1.66l-21.277-7.984-7.04.024-.37 17.152 9.381 5.611z' },
        'e3awacs': { viewBox: '48 -2 36 36', sw: 1.5, path: 'M 65.811,0.918 C 65.338,1.311 64.907,3.105 64.761,5.285 c -0.042,0.650 -0.070,2.099 -0.056,3.209 l 0.021,2.031 -2.192,1.652 -2.192,1.652 -0.042,-0.508 c -0.077,-0.900 -0.132,-1.131 -0.257,-1.137 -0.223,-0.014 -0.745,0.020 -0.772,0.047 -0.056,0.054 -0.007,1.835 0.063,2.051 0.035,0.129 0.063,0.244 0.049,0.250 -0.007,0.007 -0.654,0.487 -1.441,1.076 -0.786,0.589 -1.461,1.097 -1.503,1.124 -0.056,0.041 -0.070,-0.176 -0.042,-0.772 0.014,-0.508 0,-0.900 -0.049,-1.015 -0.077,-0.183 -0.090,-0.190 -0.543,-0.169 l -0.473,0.020 -0.056,0.372 c -0.063,0.372 -0.021,1.841 0.063,2.173 0.035,0.162 -0.077,0.257 -1.552,1.367 -1.635,1.225 -2.171,1.726 -2.366,2.227 -0.139,0.366 -0.223,2.762 -0.097,2.762 0.049,0 0.077,-0.210 0.077,-0.609 V 22.480 l 0.278,-0.169 c 0.160,-0.095 0.355,-0.203 0.438,-0.230 0.084,-0.034 1.935,-0.907 4.120,-1.936 l 3.967,-1.868 1.649,-0.332 c 1.468,-0.298 1.705,-0.332 2.150,-0.284 l 0.508,0.047 -0.285,0.183 c -0.738,0.474 -1.274,1.516 -1.274,2.478 0,0.393 0.160,1.002 0.355,1.381 0.202,0.379 0.745,0.927 1.169,1.171 0.306,0.183 0.355,0.237 0.383,0.474 0.021,0.149 0.118,0.819 0.209,1.489 0.118,0.812 0.153,1.239 0.104,1.286 -0.035,0.034 -0.870,0.691 -1.858,1.456 -2.074,1.611 -2.074,1.611 -2.053,2.491 0.021,0.677 0.063,0.867 0.188,0.765 0.049,-0.041 0.884,-0.318 1.858,-0.616 0.974,-0.291 1.949,-0.596 2.164,-0.670 0.480,-0.156 0.445,-0.210 0.515,0.826 0.021,0.399 0.070,0.724 0.097,0.724 0.028,0 0.070,-0.359 0.097,-0.792 0.021,-0.440 0.070,-0.819 0.097,-0.839 0.028,-0.027 0.459,0.081 0.953,0.237 0.501,0.162 1.461,0.460 2.136,0.677 0.682,0.210 1.281,0.399 1.343,0.420 0.090,0.034 0.104,-0.061 0.104,-0.691 0,-0.460 -0.035,-0.792 -0.090,-0.887 -0.042,-0.081 -0.912,-0.792 -1.928,-1.577 -1.016,-0.792 -1.865,-1.456 -1.893,-1.483 -0.028,-0.027 0.021,-0.454 0.111,-0.955 0.090,-0.501 0.188,-1.185 0.216,-1.516 0.049,-0.575 0.056,-0.603 0.257,-0.711 0.731,-0.386 1.350,-1.103 1.566,-1.835 0.348,-1.171 -0.132,-2.620 -1.079,-3.249 -0.195,-0.129 -0.355,-0.257 -0.362,-0.291 0,-0.027 0.230,-0.047 0.515,-0.047 0.348,0 1.058,0.108 2.178,0.332 l 1.656,0.338 4.036,1.896 c 2.220,1.043 4.176,1.970 4.350,2.051 l 0.313,0.156 0.021,0.657 c 0.007,0.366 0.042,0.663 0.077,0.663 0.090,0 0.146,-1.956 0.063,-2.336 -0.188,-0.860 -0.494,-1.198 -2.436,-2.647 l -1.601,-1.198 0.042,-0.278 c 0.084,-0.562 0.125,-1.909 0.063,-2.173 l -0.063,-0.271 -0.466,-0.020 c -0.452,-0.020 -0.466,-0.014 -0.515,0.169 -0.028,0.102 -0.056,0.548 -0.056,0.982 0,0.440 -0.014,0.799 -0.035,0.799 -0.035,0 -2.199,-1.604 -2.798,-2.072 l -0.181,-0.135 0.097,-0.426 c 0.063,-2.64 0.097,-0.691 0.084,-1.144 l -0.021,-0.724 -0.445,-0.020 c -0.257,-0.014 -0.480,0.014 -0.522,0.054 -0.042,0.041 -0.090,0.413 -0.111,0.819 l -0.035,0.745 -2.206,-1.645 -2.206,-1.645 -0.007,-2.166 C 67.391,4.730 67.363,4.168 67.085,2.814 66.911,1.981 66.730,1.500 66.417,1.067 66.194,0.756 66.055,0.722 65.811,0.918 Z' },
        'p8': { viewBox: '-2 -2 83.5 87.3', sw: 3, path: "M39.156 80.404c-1.458.366-14.151 2.859-14.151 2.859l-.069-2.434 12.769-7.019c-1.535-6.779-1.876-8.758-2.061-14.716l-.022-15.412-4.679.026a4.9 4.9 0 0 1-.429 2.125c-.418-.667-.401-1.322-.397-2.101-.794 0-1.561.198-2.352.329.024.836-.095 1.488-.437 2.156-.347-.635-.352-1.136-.402-1.971l-5.735 1.323c-.008.857.04 1.345-.392 2.119-.373-.631-.41-1.257-.41-1.962L6.055 48.877c-1.786.992-4.702 3.064-6.013 4.015-.312-1.197 3.79-5.921 4.842-6.697 7.89-4.004 16.208-7.251 23.891-11.472-.101-.701-.568-.221-.737-.493-.311-2.068-.344-4.905-.118-6.453.04-.224.102-.456.299-.455 1.586.008 1.912-.042 3.26-.013.198.004.294.208.331.427a28.3 28.3 0 0 1 .083 4.839l3.735-3.088.069-13.676C35.968 9.73 37.55.467 39.554.024c2.004.443 3.586 9.706 3.858 15.785.103 1.762.095 11.43.082 13.678l3.735 3.086a28 28 0 0 1 .075-4.847c.037-.218.124-.415.321-.419 1.349-.029 1.673.021 3.26.013.198 0 .259.233.299.456.225 1.548.194 4.384-.118 6.452-.169.274-.635-.208-.736.495 7.681 4.22 16.001 7.468 23.892 11.471 1.226.61 5.36 5.79 5.331 6.812-1.818-1.045-4.568-3.299-6.503-4.129l-14.335-3.153c.001.705-.037 1.332-.41 1.963-.431-.775-.384-1.263-.392-2.119l-5.735-1.323c-.049.833-.054 1.336-.401 1.971-.341-.669-.46-1.322-.437-2.156-.791-.132-1.561-.331-2.353-.331.004.781.021 1.434-.397 2.101a4.9 4.9 0 0 1-.429-2.123l-4.679-.026-.011 15.412c-.185 5.958-.527 7.938-2.061 14.715l12.769 7.018-.069 2.437-14.151-2.86c-.098.415-.09 1.303-.402 1.292-.312.012-.304-.876-.402-1.291z" },
        'hi_perf': { viewBox: '-7.8 0 80 80', sw: 3, path: "M 30.82,61.32 29.19,54.84 29.06,60.19 27.70,60.70 22.27,60.63 21.68,59.60 l -0.01,-2.71 6.26,-5.52 -0.03,-3.99 -13.35,-0.01 -3e-6,1.15 -1.94,0.00 -0.01,-1.31 0.68,-0.65 L 13.30,37.20 c -0.01,-0.71 0.57,-0.77 0.60,0 l 0.05,1.57 0.28,0.23 0.26,4.09 L 19.90,38.48 c 0,0 -0.04,-1.26 0.20,-1.28 0.16,-0.02 0.20,0.98 0.20,0.98 l 4.40,-3.70 c 0,0 0.02,-1.28 0.20,-1.28 0.14,-0.00 0.20,0.98 0.20,0.98 l 1.80,-1.54 C 27.02,28.77 28.82,25.58 29,21.20 c 0.06,-1.41 0.23,-3.34 0.86,-3.85 0.21,-4.40 1.32,-11.03 2.39,-11.03 1.07,0 2.17,6.64 2.39,11.03 0.63,0.51 0.80,2.45 0.86,3.85 0.18,4.38 1.98,7.57 2.10,11.44 l 1.80,1.54 c 0,0 0.06,-0.99 0.20,-0.98 0.18,0.01 0.20,1.28 0.20,1.28 l 4.40,3.70 c 0,0 0.04,-1.00 0.20,-0.98 0.24,0.03 0.20,1.28 0.20,1.28 l 5.41,4.60 0.26,-4.09 0.28,-0.23 L 50.59,37.20 c 0.03,-0.77 0.61,-0.71 0.60,0 l 0.02,9.37 0.68,0.65 -0.01,1.31 -1.94,-0.00 -3e-6,-1.15 -13.35,0.01 -0.03,3.99 6.26,5.52 L 42.81,59.60 42.22,60.63 36.79,60.70 35.43,60.19 35.30,54.84 33.67,61.32 Z" },
        'f18': { viewBox: '-4 -3 32 32', sw: 1.8, path: 'M22.2 19.36h.3v-.23h.1v-.12h.15l-.1-.34h-.17v-.16h.12v-2.28l-.09-.1v-1.79c0-.37-.16-2.3-.3 0v.71s-.27.26-.26.6v.51s-.16.03-.17.2v.41l-7.4-3.5s0-1.36-.3-3c0 0-.3-1.14-.56-2.9 0 0-.21-2.73-.69-2.83l-.08-2.84s-.18-1.95-.8-2.92c-.62.97-.7 2.92-.7 2.92l-.09 2.84c-.48.1-.69 2.83-.69 2.83-.26 1.76-.55 2.9-.55 2.9-.31 1.64-.3 3-.3 3l-7.41 3.5v-.41c0-.17-.16-.2-.16-.2v-.52c0-.33-.27-.59-.27-.59v-.71c-.14-2.3-.29-.37-.3 0v1.8l-.09.09v2.28h.13v.16h-.18l-.1.34h.15v.12h.1v.23h.3m20.4 0l-.35.41-7.44.29.67 1.86v1.06l2.63 2.83v1.14c-.03.6-.83.39-.83.39l-3.35-1.65-.39.81h-.78c-.17 0-.35-1.08-.35-1.08s-.19 1.08-.36 1.08h-.78l-.38-.8-3.36 1.64s-.8.22-.82-.4v-1.13l2.61-2.83v-1.06l.68-1.86-7.43-.29-.36-.41' },
        'f35': { viewBox: '-4 -1 40 40', sw: 1.8, path: 'm 16.85,2.96 c 0.38,3.4 0.78,5.93 0.78,5.93 l 0.29,0.72 0.77,-0.84 0.38,0.73 0.19,4.5 0.71,1.41 5.85,3.95 v 2.84 l -6.47,1.61 0.5,1.17 2.84,1.92 v 1.6 l -4.85,1.2 -0.63,-4.05 -0.45,0.78 H 15.24 L 14.79,25.65 14.16,29.7 9.31,28.5 v -1.6 l 2.85,-1.92 0.49,-1.17 -6.47,-1.61 v -2.84 l 5.85,-3.95 0.71,-1.4 0.2,-4.51 0.37,-0.73 0.77,0.84 0.3,-0.72 c 0,0 0.4,-2.53 0.77,-5.93 C 15.19,2.27 15.77,1.09 16,1 c 0.209,-0.018 0.78,1.25 0.85,1.96 z' },
        't38': { viewBox: '22.2 -6 36 36', sw: 1.5, path: 'M41.3 27h-2l-.2-1.8-3.3-.2v-1l3-2s-.2-1.5-.1-3.2l-6.5-.6v-1.5l6.3-3.8s-.6-2.8.4-2.7l.3-.4V4.6s.2-4.3 1-6v-1.4h.1v1.5s1 2.3 1 6l.1 5.1.3.4s1-.3.4 2.7l6.3 3.9v1.4l-6.5.6s.1 1.6 0 3.2l2.9 2v1l-3.3.2z' },
        'mirage': { viewBox: '-5.8 -3.8 36 36', sw: 1.5, path: "m 13.09,26.20 c 0,0 0.30,-1.70 0.30,-2.80 L 13.94,22.81 13.92,22.07 21.19,21.60 c 0,0 0.20,-1 -0.30,-1.60 l -4,-6.50 c 0,0 0.40,-5.30 -0.70,-5.80 0,0 -0.70,-0.20 -0.60,4.10 l -1.10,-2.10 V 9 c 0,0 0,-0.40 -0.30,-0.60 l -0.10,-0.70 h -0.70 l -0.30,-1.20 V 3.10 c 0,0 -0.25,-2.58 -0.85,-4.48 C 11.65,0.52 11.40,3.10 11.40,3.10 V 6.50 L 11.10,7.70 H 10.40 L 10.30,8.40 C 10,8.60 10,9 10,9 V 9.70 L 8.90,11.80 C 9,7.50 8.30,7.70 8.30,7.70 7.20,8.20 7.60,13.50 7.60,13.50 l -4,6.50 c -0.50,0.60 -0.30,1.60 -0.30,1.60 l 7.27,0.47 -0.02,0.74 L 11.10,23.40 c 0,1.10 0.30,2.80 0.30,2.80 z" },
        'sb39': { viewBox: '-4.1 0 32 32', sw: 1.5, path: "M12.77 4.94c.15 1.84.06 3.88.06 3.88l.46.17c.22.04.23.03.25.26.03.23.17.4.17.4l2.5 3.86v.85l-2-1.08h-.4l.26.85 1.7 2.28 1.76 1.94v-.38l1.84 2.53.19-.76h.05v-1.48c.14-.66.26-.25.26-.25v-.28c.2-1.26.3 0 .3 0v1.9l.1.1v2.4h-.1v.19h.16l.1.37h-.15v.14h-.08v.23h-.33v.88l-.12.12h-.2v-.82h.08l-.02-.4-5.3.3-.67.41v.46c-.23.1-.3.3-.3.3l-.32 1.42c-.06.17-.18.15-.18.15l-.25 1.64h-1.31l-.25-1.64s-.12.02-.19-.15l-.31-1.41s-.08-.22-.3-.31v-.46l-.67-.4-5.3-.3-.03.4h.1v.81h-.21L4 23.94v-.88h-.33v-.23H3.6v-.14h-.15l.1-.37h.16v-.19H3.6v-2.4l.1-.1v-1.9s.12-1.26.3 0v.28s.13-.41.27.25v1.48h.05l.19.76 1.84-2.53v.38l1.75-1.94 1.7-2.28.26-.85h-.4l-1.99 1.08v-.85l2.5-3.86s.14-.17.17-.4c.02-.23.02-.22.25-.26l.45-.17s-.08-2.04.07-3.88c0 0 .18-1.92.82-3.32.65 1.4.85 3.32.85 3.32z" },
        'l159': { viewBox: '-3.7 0 32 32', sw: 1.5, path: "M13.1 3.13l.11 3c.37 4.18.14 6.3.14 6.3.1.7.59.76.59.76l6.32.7.41-.28v-1.02c.37-2.88.69 0 .69 0v3.55c.03.68-.3 1.6-.3 1.6h-.17a4.2 4.2 0 01-.21-1.14l-.1-.1-6.84 1.44a53.86 53.86 0 01-.46 4.51l3.34.97c.2.48.14 1.3.14 1.3l-4.47.52-4.47-.51s-.06-.83.13-1.3l3.35-.98s-.38-2.55-.46-4.5L4 16.5l-.1.1s-.01.52-.21 1.13H3.5s-.33-.92-.3-1.6v-3.55s.32-2.88.7 0v1.02l.4.27 6.33-.69s.49-.05.58-.76c0 0-.23-2.12.14-6.3l.12-3s.08-1.72.8-1.74c.73.02.81 1.74.81 1.74z" },
        'md_a4': { viewBox: '-4.2 -1 32 32', sw: 1.5, path: 'M11.7 26.5H8v-.7s0-.3.3-.6l2.6-2.4s-.2-1-.3-4H3v-2.4l.3-.6 6.3-5.5.2-1.3s.3-.2.6-.1V7.8s0-.2.2 0c0 0 0-3.5.5-6.2 0 0 .3-1.2.7-1.2.4 0 .7 1.2.7 1.2.5 2.7.5 6.2.5 6.2 0-.2.2 0 .2 0v1l.6.2.2 1.3 6.3 5.5c.3.4.2.6.2.6v2.3h-7.4c-.1 3-.3 4-.3 4l2.6 2.5c.3.3.3.6.3.6v.7H12l-.1.5-.2-.5z' },
        'alpha_jet': { viewBox: '33.2 9 32 32', sw: 1.5, path: 'M49.14 36.015c-.07-.194-.09-.223-.176-.238-.13-.024-.14-.068-.14-.664 0-.277-.012-.504-.027-.504-1.378.334-2.455.604-3.915.961-.014 0-.08-.166-.15-.37-.154-.445-.17-.703-.055-.852 1.33-.883 2.31-1.45 3.795-2.349-.111-.93-.214-1.833-.313-2.697l-.525.021c-.236-.807-.356-1.716-.469-2.41-2.494.435-5.205 1.014-7.794 1.527-.013 0-.024-.115-.024-.256 0-.486.29-1.554.513-1.893.909-.79 2.132-1.51 3.348-2.26.066.04.052.226.08.286l1.15-.515c1.223-.529 1.674-.858 2.698-1.528.127-.555.072-.835.106-1.538l.211-.241.568.036.025-.323c.02-.278.01-.326.01-.326l.184-.027c-.14-9.213 2.22-8.012 1.898.024l.19.02.01.318.01.317h.61l.16.214c.02.515.026.708.068 1.458 1 .74 2.136 1.29 2.77 1.62l1.213.58.036-.308 1.527.962c1.79 1.128 1.827 1.158 1.988 1.636.16.475.298 1.111.313 1.441.008.167.006.303-.006.303-2.779-.55-4.895-.975-7.884-1.572l-.018.127c-.021.777-.206 1.64-.314 2.274-.16.028-.354.03-.548.048-.118.88-.24 1.79-.324 2.673 1.294.783 2.32 1.411 3.686 2.261.062.053.089.126.117.314.033.225.029.27-.06.586a2.575 2.575 0 01-.12.366c-1.355-.264-2.437-.531-3.87-.862l-.186-.042.017.571c-.009.648-.11.572-.11.572-.165.06-.101.15-.162.24l-.032.24-.079-.22z' },
        'v22_fast': { viewBox: '26.7 -3.3 26 26', sw: 1.5, path: 'M33.76 6.93l.01.4.2.06.05.07 3.84.45s.18-.36.6-.88c0 0-.26-2.86.6-3.83v-.28l.05-.05s.1-.51.28 0c0 0 .24-.18.3-.15.05.03 1.31.19 1.23 4.3 0 0 .62.84.58.94l3.83-.44.06-.08.23-.08-.01-.4s-.7-.21-4.04-.5l-.12-.13 4.32.01s.43-1.46.88 0l5.11-.07v.06s-4.12.36-4.79.71l-.2-.24.03.52.2.15.06 1.09-.07.14s-.09 1.63-.41 2.37l-.63-.03-.23-1.2-3.91.43s.36.97-.97 3.79l-.1 2.47h1.06s.06-.28.16-.3m0 0s.43-.02-.04 2.41h-4.5s-.46-2.46-.04-2.4c0 0 .12.02.16.29l1.04.01-.08-2.5s-1.2-2.38-.96-3.82l-3.89-.44-.24 1.2-.62.03s-.4-1.1-.43-2.38l-.05-.1.04-1.1.24-.16.01-.5-.2.23s-1.02-.4-4.8-.71v-.07l5.12.05s.42-1.39.86 0h4.34l-.13.14s-3.99.39-4.03.52' },
        'blimp': { viewBox: '-3.7 -3 32 32', sw: 1.5, path: 'M12.4 26.77v-.81s.71-.24 1.42-1.7c0 0 .1.14.15.17.07.02 2.02.08 2.02.08s.18 0 .17-.3v-1.45s.14-.47-1.3-1.22c0 0 5.25-19.33-2.56-21.8-7.81 2.47-2.57 21.8-2.57 21.8-1.43.75-1.3 1.22-1.3 1.22s.02 1.16 0 1.46c0 .3.18.29.18.29s1.95-.06 2.01-.08c.06-.03.15-.17.15-.17.71 1.46 1.42 1.7 1.42 1.7v.81c0 .17.11.17.11.17s.1 0 .1-.17z' },
        'helo_2b': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 5 C19.5 5 17.5 10 17.5 19 L17.5 28 C17.5 31 19.5 33 22 34 L22 44 L28 44 L28 34 C30.5 33 32.5 31 32.5 28 L32.5 19 C32.5 10 30.5 5 25 5 Z', rotors: '<path d="M14 16 L14 36 M36 16 L36 36 M14 22 L18 22 M36 22 L32 22 M14 31 L18 31 M36 31 L32 31" stroke="#000" stroke-width="1.8" stroke-linecap="round"/><path d="M20 7 C23 5.5 27 5.5 30 7 C31.5 11 31.5 15 30 16.5 C27 17.5 23 17.5 20 16.5 C18.5 15 18.5 11 20 7 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><path d="M17 42.5 L33 42.5" stroke="#000" stroke-width="2.5" stroke-linecap="round"/><line x1="28" y1="44" x2="34" y2="44" stroke="#ffffff" stroke-width="2"/><line x1="1" y1="18.5" x2="49" y2="18.5" stroke="#000" stroke-width="2.8"/><circle cx="25" cy="18.5" r="3" fill="#ffffff" stroke="#000"/>' },
        'helo_b206': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C18.5 4 16.5 9.5 16.5 19.5 L16.5 29 C16.5 32 19 34 22 34.5 L22 45 L28 45 L28 34.5 C31 34 33.5 32 33.5 29 L33.5 19.5 C33.5 9.5 31.5 4 25 4 Z', rotors: '<path d="M13 15 L13 36 M37 15 L37 36 M13 21 L17 21 M37 21 L33 21 M13 30 L17 30 M37 30 L33 30" stroke="#000" stroke-width="2" stroke-linecap="round"/><path d="M19.5 7 C23 5.5 27 5.5 30.5 7 L30.5 14 C27 15 23 15 19.5 14 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><circle cx="21.5" cy="22" r="2" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><circle cx="28.5" cy="22" r="2" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><path d="M28 42 L34 42 L32 46 L28 46 Z"/><line x1="28" y1="44" x2="35" y2="44" stroke="#ffffff" stroke-width="2"/><line x1="1" y1="18" x2="49" y2="18" stroke="#000" stroke-width="3"/><circle cx="25" cy="18" r="3.2" fill="#ffffff" stroke="#000"/>' },
        'helo_b407': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C18.5 4 16 9 16 19.5 L16 29 C16 32 18.5 34.5 21.5 35 L21.5 45 L28.5 45 L28.5 35 C31.5 34.5 34 32 34 29 L34 19.5 C34 9 31.5 4 25 4 Z', rotors: '<path d="M12 15 L12 36 M38 15 L38 36 M12 21 L16 21 M38 21 L34 21 M12 30 L16 30 M38 30 L34 30" stroke="#000" stroke-width="2" stroke-linecap="round"/><path d="M14 41 L21.5 41 M28.5 41 L36 41" stroke="#000" stroke-width="2.8" stroke-linecap="round"/><line x1="28.5" y1="44" x2="35" y2="44" stroke="#ffffff" stroke-width="2"/><path d="M19 6.5 C23 5 27 5 31 6.5 L31 13 C27 14 23 14 19 13 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="3" y1="3" x2="47" y2="31" stroke="#000" stroke-width="2.4"/><line x1="47" y1="3" x2="3" y2="31" stroke="#000" stroke-width="2.4"/><circle cx="25" cy="17" r="3.5" fill="#ffffff" stroke="#000"/>' },
        'helo_h125': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C19 4 16.5 9 16.5 19.5 L16.5 29 C16.5 32 19 34 22 34.5 L22 45 L28 45 L28 34.5 C31 34 33.5 32 33.5 29 L33.5 19.5 C33.5 9 31 4 25 4 Z', rotors: '<path d="M13 16 L13 36 M37 16 M37 36 M13 23 L17 23 M37 23 L33 23" stroke="#000" stroke-width="2"/><path d="M28 39.5 L34.5 39.5 L32.5 45 L28 45 Z"/><path d="M19.5 6.5 C23 5 27 5 30.5 6.5 L30.5 13.5 C27 14.5 23 14.5 19.5 13.5 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="25" y1="17.5" x2="25" y2="0.5" stroke="#000" stroke-width="2.6"/><line x1="25" y1="17.5" x2="7.5" y2="30" stroke="#000" stroke-width="2.6"/><line x1="25" y1="17.5" x2="42.5" y2="30" stroke="#000" stroke-width="2.6"/><circle cx="25" cy="17.5" r="3.5" fill="#ffffff" stroke="#000"/>' },
        'helo_h135': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C19 4 16 8.5 16 18 L16 28 C16 31.5 19 33.5 21.5 34 L21.5 40.5 L28.5 40.5 L28.5 34 C31 33.5 34 31.5 34 28 L34 18 C34 8.5 31 4 25 4 Z', rotors: '<circle cx="25" cy="44" r="4.5" fill="#0b0f19" stroke="#000" stroke-width="2"/><circle cx="25" cy="44" r="1.5" fill="#ffffff"/><path d="M19 6.5 C23 5 27 5 31 6.5 L31 13.5 C27 14.5 23 14.5 19 13.5 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="3" y1="3" x2="47" y2="31" stroke="#000" stroke-width="2.4"/><line x1="47" y1="3" x2="3" y2="31" stroke="#000" stroke-width="2.4"/><circle cx="25" cy="17" r="3.5" fill="#ffffff" stroke="#000"/>' },
        'helo_aw139': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 3.5 C18.5 3.5 15.5 8 15.5 18 L15.5 30 C15.5 33 18.5 35 21.5 35.5 L21.5 45 L28.5 45 L28.5 35.5 C31.5 35 34.5 33 34.5 30 L34.5 18 C34.5 8 31.5 3.5 25 3.5 Z', rotors: '<rect x="11.5" y="21" width="3.5" height="7.5" rx="1.5" stroke="#000" stroke-width="0.8"/><rect x="35" y="21" width="3.5" height="7.5" rx="1.5" stroke="#000" stroke-width="0.8"/><path d="M18.5 6 C22.5 4.5 27.5 4.5 31.5 6 L31.5 13.5 C27.5 14.5 22.5 14.5 18.5 13.5 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="25" y1="17.5" x2="25" y2="0.5" stroke="#000" stroke-width="2.2"/><line x1="25" y1="17.5" x2="45" y2="11.5" stroke="#000" stroke-width="2.2"/><line x1="25" y1="17.5" x2="38" y2="35" stroke="#000" stroke-width="2.2"/><line x1="25" y1="17.5" x2="12" y2="35" stroke="#000" stroke-width="2.2"/><line x1="25" y1="17.5" x2="5" y2="11.5" stroke="#000" stroke-width="2.2"/><circle cx="25" cy="17.5" r="3.8" fill="#ffffff" stroke="#000"/>' },
        'helo_s76': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 2.5 C19 2.5 15 6.5 15 16.5 L15 31 C15 34 18 36 21 36.5 L21 46 L29 46 L29 36.5 C32 36 35 34 35 31 L35 16.5 C35 6.5 31 2.5 25 2.5 Z', rotors: '<path d="M11 43 L39 43" stroke="#000" stroke-width="3" stroke-linecap="round"/><line x1="29" y1="46" x2="35.5" y2="46" stroke="#ffffff" stroke-width="2.2"/><path d="M18 5 C22.5 3.5 27.5 3.5 32 5 L32 12.5 C27.5 13.5 22.5 13.5 18 12.5 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="2" y1="2" x2="48" y2="31" stroke="#000" stroke-width="2.5"/><line x1="48" y1="2" x2="2" y2="31" stroke="#000" stroke-width="2.5"/><circle cx="25" cy="16.5" r="3.8" fill="#ffffff" stroke="#000"/>' },
        'helo_4b': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C19 4 15.5 8.5 15.5 19 L15.5 30 C15.5 33.5 18.5 35.5 21.5 36 L21.5 45 L28.5 45 L28.5 36 C31.5 35.5 34.5 33.5 34.5 30 L34.5 19 C34.5 8.5 31 4 25 4 Z', rotors: '<path d="M11.5 19 L15.5 19 L15.5 26.5 L11.5 26.5 Z M34.5 19 L38.5 19 L38.5 26.5 L34.5 26.5 Z"/><line x1="28.5" y1="45" x2="36" y2="42" stroke="#ffffff" stroke-width="2.6"/><circle cx="28.5" cy="45" r="1.6" fill="#000"/><path d="M18.5 6 C22.5 4.5 27.5 4.5 31.5 6 L31.5 13 C27.5 14 22.5 14 18.5 13 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="2" y1="2" x2="48" y2="31" stroke="#000" stroke-width="2.5"/><line x1="48" y1="2" x2="2" y2="31" stroke="#000" stroke-width="2.5"/><circle cx="25" cy="16.5" r="3.8" fill="#ffffff" stroke="#000"/>' },
        'helo_ch53': { viewBox: '0 0 50 65', sw: 1.2, path: 'M25 6 C18.5 6 15 11 15 22 L15 36 C15 40 18.5 42 21.5 43 L21.5 56 L28.5 56 L28.5 43 C31.5 42 35 40 35 36 L35 22 C35 11 31.5 6 25 6 Z', rotors: '<rect x="9.5" y="21" width="5.5" height="15" rx="2.5" stroke="#000" stroke-width="0.8"/><rect x="35" y="21" width="5.5" height="15" rx="2.5" stroke="#000" stroke-width="0.8"/><rect x="24.2" y="0.5" width="1.6" height="8" stroke="#000" stroke-width="0.6"/><path d="M28.5 54 L39 54 L37 59 L28.5 59 Z" fill="#000"/><line x1="28.5" y1="56" x2="28.5" y2="63" stroke="#000" stroke-width="2.2"/><circle cx="28.5" cy="56" r="1.8" fill="#ffffff" stroke="#000"/><path d="M18 8.5 C22.5 7 27.5 7 32 8.5 L32 15 C27.5 16 22.5 16 18 15 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="25" y1="20" x2="25" y2="1" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="40.5" y2="5" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="48" y2="28" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="35" y2="38" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="15" y2="38" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="2" y2="28" stroke="#000" stroke-width="2.2"/><line x1="25" y1="20" x2="9.5" y2="5" stroke="#000" stroke-width="2.2"/><circle cx="25" cy="20" r="4.2" fill="#ffffff" stroke="#000"/>' },
        'helo_ah64': { viewBox: '0 0 50 50', sw: 1.2, path: 'M25 4 C22.5 4 19.5 8 19.5 18.5 L19.5 30 C19.5 33 21.5 34.5 22.5 35 L22.5 45 L27.5 45 L27.5 35 C28.5 34.5 30.5 33 30.5 30 L30.5 18.5 C30.5 8 27.5 4 25 4 Z', rotors: '<rect x="6.5" y="18.5" width="37" height="3" stroke="#000" stroke-width="0.8"/><rect x="7.5" y="16.5" width="3" height="7.5" fill="#f59e0b" stroke="#000" stroke-width="0.8"/><rect x="14" y="16.5" width="3" height="7.5" fill="#f59e0b" stroke="#000" stroke-width="0.8"/><rect x="33" y="16.5" width="3" height="7.5" fill="#f59e0b" stroke="#000" stroke-width="0.8"/><rect x="39.5" y="16.5" width="3" height="7.5" fill="#f59e0b" stroke="#000" stroke-width="0.8"/><rect x="24.2" y="0.5" width="1.6" height="5" fill="#ffffff" stroke="#000" stroke-width="0.6"/><rect x="23" y="7" width="4" height="5" fill="#0b0f19" stroke="#000" stroke-width="0.6"/><rect x="23" y="13" width="4" height="5" fill="#0b0f19" stroke="#000" stroke-width="0.6"/><line x1="2" y1="2" x2="48" y2="31" stroke="#000" stroke-width="2.5"/><line x1="48" y1="2" x2="2" y2="31" stroke="#000" stroke-width="2.5"/><circle cx="25" cy="16.5" r="3.5" fill="#ffffff" stroke="#000"/>' },
        'helo_tandem': { viewBox: '0 0 50 60', sw: 1.5, path: 'M25 9.5 C19.5 9.5 17.5 13.5 17.5 23.5 L17.5 46.5 C17.5 52.5 19.5 54.5 25 54.5 C30.5 54.5 32.5 52.5 32.5 46.5 L32.5 23.5 C32.5 13.5 30.5 9.5 25 9.5 Z', rotors: '<path d="M14.5 17 L17.5 17 L17.5 43 L14.5 43 Z M32.5 17 L35.5 17 L35.5 43 L32.5 43 Z" stroke="#000" stroke-width="0.8"/><path d="M20 11.5 C23 10.5 27 10.5 30 11.5 L30 16.5 C27 17.5 23 17.5 20 16.5 Z" fill="#0b0f19" stroke="#000" stroke-width="0.8"/><line x1="25" y1="13.5" x2="4" y2="4.5" stroke="#000" stroke-width="2.8"/><line x1="25" y1="13.5" x2="46" y2="4.5" stroke="#000" stroke-width="2.8"/><line x1="25" y1="13.5" x2="25" y2="32" stroke="#000" stroke-width="2.8"/><circle cx="25" cy="13.5" r="3.2" fill="#ffffff" stroke="#000"/><line x1="25" y1="50.5" x2="4" y2="57.5" stroke="#000" stroke-width="2.8"/><line x1="25" y1="50.5" x2="46" y2="57.5" stroke="#000" stroke-width="2.8"/><line x1="25" y1="50.5" x2="25" y2="32" stroke="#000" stroke-width="2.8"/><circle cx="25" cy="50.5" r="3.2" fill="#ffffff" stroke="#000"/>' },
        'generic_triangle': { viewBox: '0 0 24 24', sw: 1.5, path: 'M12 2 L22 22 L12 17 L2 22 Z' }
    };

    let shapeKey = 'cessna';

    // 0. Check Persistent Custom Icon Database (Type > Tail > Hex)
    const hexKey = (ac.hex || '').toLowerCase();
    const tailKey = (ac.tail || ac.r || '').toUpperCase().trim();
    const typeKey = type.trim().toUpperCase();

    let customShape = null;
    if (customIconDb.typeOverrides && customIconDb.typeOverrides[typeKey]) {
        customShape = customIconDb.typeOverrides[typeKey];
    } else if (customIconDb.tailOverrides && customIconDb.tailOverrides[tailKey]) {
        customShape = customIconDb.tailOverrides[tailKey];
    } else if (customIconDb.hexOverrides && customIconDb.hexOverrides[hexKey]) {
        customShape = customIconDb.hexOverrides[hexKey];
    }

    if (customShape && tarShapes[customShape]) {
        shapeKey = customShape;
    } else if (matchType(['H47','CH47','CH46','MH47','BV44','CHINOOK','SEA KNIGHT'])) shapeKey = 'helo_tandem';
    else if (matchType(['H53','CH53','MH53','CH53K','RH53','SUPER STALLION','SEA STALLION','KING STALLION','PAVEMOW'])) shapeKey = 'helo_ch53';
    else if (matchType(['AH64','APACHE','A129','MANGUSTA','KA52','MI28','AH1','COBRA','VIPER','TIGER','MI24'])) shapeKey = 'helo_ah64';
    else if (matchType(['H60','UH60','MH60','SH60','HH60','S70','BLACK HAWK','SEAHAWK','JAYHAWK'])) shapeKey = 'helo_4b';
    else if (matchType(['S76','S92','H92','SIKORSKY','EH10','AW101','CORMORANT','NH90','MI8','MI17','KA27'])) shapeKey = 'helo_s76';
    else if (matchType(['AW13','AW139','AW169','AW189','A109','A119','AW109','AW119','AGUSTA'])) shapeKey = 'helo_aw139';
    else if (matchType(['H135','EC35','EC135','H145','EC45','EC145','EC20','EC120','BK11','BK117','B105','BO105','EC55','H155','AS65','DAUPHIN','PANTHER'])) shapeKey = 'helo_h135';
    else if (matchType(['AS35','AS350','AS355','H125','ASTAR','TWINSTAR','AS32','AS332','H225','SUPER PUMA','EC25','H215'])) shapeKey = 'helo_h125';
    else if (matchType(['B407','B412','B429','B212','B430','B230','B222','BELL 407','BELL 412','BELL 429'])) shapeKey = 'helo_b407';
    else if (matchType(['B06','B206','B204','B205','B214','OH58','JETRANGER','LONGRANGER','KIOWA','BELL'])) shapeKey = 'helo_b206';
    else if (matchType(['R22','R44','R66','CABR','ROBINSON','MD50','HU50','H500','SCH4','S300','EN28','EN48']) || cat === 'helicopter') shapeKey = 'helo_2b';
    else if (matchType(['V22','OSPREY'])) shapeKey = 'v22_fast';
    else if (matchType(['B738','B739','B38M','B39M','737-800','737-900'])) shapeKey = 'b738';
    else if (matchType(['B737','B733','B734','B735','737-700','737-300'])) shapeKey = 'b737';
    else if (matchType(['A320','A20N'])) shapeKey = 'a320';
    else if (matchType(['A321','A21N'])) shapeKey = 'a321';
    else if (matchType(['A319','A19N'])) shapeKey = 'a319';
    else if (matchType(['B744','B748','A388','A340','B747','A380'])) shapeKey = 'heavy_4e';
    else if (matchType(['B77W','B772','B789','B788','B777','B787'])) shapeKey = 'heavy_2e';
    else if (matchType(['A359','A351','A350'])) shapeKey = 'a359';
    else if (matchType(['A332','A333','A339','A330'])) shapeKey = 'a332';
    else if (matchType(['MD11','DC10'])) shapeKey = 'md11';
    else if (matchType(['C130','C30J','HERCULES'])) shapeKey = 'c130';
    else if (matchType(['A400'])) shapeKey = 'a400';
    else if (matchType(['A225','A124'])) shapeKey = 'a225';
    else if (matchType(['E3TF','E3CF','E3AWACS','AWACS','SENTRY'])) shapeKey = 'e3awacs';
    else if (matchType(['P8','POSEIDON'])) shapeKey = 'p8';
    else if (matchType(['F16','FIGHTING FALCON'])) shapeKey = 'hi_perf';
    else if (matchType(['F18','FA18','EA18','HORNET'])) shapeKey = 'f18';
    else if (matchType(['F35','LIGHTNING'])) shapeKey = 'f35';
    else if (matchType(['T38','F5'])) shapeKey = 't38';
    else if (matchType(['MIRAGE','MIRG'])) shapeKey = 'mirage';
    else if (matchType(['SB39','JAS39','GRIPEN'])) shapeKey = 'sb39';
    else if (matchType(['L159','L39'])) shapeKey = 'l159';
    else if (matchType(['A4','SKYHAWK'])) shapeKey = 'md_a4';
    else if (matchType(['ALPHA','ALPHA JET'])) shapeKey = 'alpha_jet';
    else if (matchType(['BE20','BE30','B350','DH8A','AT76','AT72','KING AIR','DASH 8']) || cat === 'business-prop') shapeKey = 'twin_large';
    else if (matchType(['BE58','PA31','BARON','SENECA','SEMINOLE'])) shapeKey = 'twin_small';
    else if (matchType(['PC12','TBM8','TBM9','C208','CARAVAN','PILATUS','TBM'])) shapeKey = 'single_turbo';
    else if (matchType(['GLF5','GLF6','C56X','CL30','FA7X','GULFSTREAM','CITATION','LEARJET','CHALLENGER']) || cat === 'business-jet') shapeKey = 'jet_swept';
    else if (matchType(['E145','CRJ2','CRJ7','CRJ9','ERJ','REGIONAL JET'])) shapeKey = 'jet_nonswept';
    else if (matchType(['BLIMP','BALLOON','AIRSHIP'])) shapeKey = 'blimp';
    else if (cat === 'other' || !type || type === 'Unknown' || type === 'N/A' || type === 'SRCH') shapeKey = 'generic_triangle';
    else shapeKey = 'cessna';

    const shp = tarShapes[shapeKey] || tarShapes['generic_triangle'];
    const rot = shp.rotors || '';
    
    return `<svg class="plane-icon-svg" width="30" height="30" viewBox="${shp.viewBox}" style="transform: rotate(${heading}deg);">
        <path d="${shp.path}" fill="${color}" stroke="#000000" stroke-width="${shp.sw}" stroke-linejoin="round" stroke-linecap="round"/>
        ${rot}
    </svg>`;
}

// 6. Map Marker Graphics & Rotation
function updateMapMarker(ac) {
    const color = getAircraftColor(ac);
    const iconHtml = getAircraftIconSvg(ac, color);
    
    // Check if identified as military (by manual checkbox, type, description, operator, or raw mil flag)
    const isMil = (ac.mil === 1 || ac.mil === true || ac.mil === '1' || String(ac.mil).toLowerCase() === 'true' || ac.categoryClass === 'military');
    const milRingHtml = isMil ? `<div class="mil-target-ring-static" style="border-color: ${color}; color: ${color}; box-shadow: 0 0 10px ${color}80, inset 0 0 6px ${color}40;" title="Military Identified Aircraft"></div>` : '';

    // Custom DivIcon containing SVG plane icon, military ring, and label
    const customIcon = L.divIcon({
        className: 'custom-plane-icon',
        html: `
            <div class="plane-marker-container" style="position: relative;">
                ${milRingHtml}
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

async function saveAndSyncOperations() {
    // Save to localStorage
    safeSetItem('kvpz_operations_log', JSON.stringify(operationsLog));
    
    // Recalculate counters
    arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
    departureCount = operationsLog.filter(log => log.opType === 'departure').length;
    
    updateOpsLog();
    updateCounters();

    // Push synced operations log to server API
    try {
        await fetch('/operations-log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(operationsLog)
        });
    } catch(e) {}
}

async function deleteOperationsByTail(tail) {
    operationsLog = operationsLog.filter(log => {
        const key = (log.tail && log.tail !== 'N/A') ? log.tail : (log.callsign || 'Unknown');
        return key !== tail;
    });
    saveAndSyncOperations();
    try {
        await fetch('/operations-log', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tail })
        });
    } catch(e) {}
}

async function deleteOperationEvent(timestamp, dateStr, timeStr, callsign) {
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

// 7b. Persistent Memory Operations Loader & 24/7 Multi-User Sync
function mergeOperationsLogs(listA, listB) {
    const map = new Map();
    (listA || []).forEach(l => {
        if (!l) return;
        const key = l.id || `${l.timestamp}_${l.hex}_${l.opType}`;
        map.set(key, l);
    });
    (listB || []).forEach(l => {
        if (!l) return;
        const key = l.id || `${l.timestamp}_${l.hex}_${l.opType}`;
        if (!map.has(key)) map.set(key, l);
    });
    const merged = Array.from(map.values());
    merged.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return merged.filter(l => !l || l.timestamp === undefined || l.timestamp >= oneMonthAgo);
}

async function syncOperationsLogWithServer() {
    try {
        const res = await fetch('/operations-log');
        if (res.ok) {
            const serverLogs = await res.json();
            if (Array.isArray(serverLogs)) {
                // Safely merge server logs with local memory without wiping local logs if server is empty
                const merged = mergeOperationsLogs(operationsLog, serverLogs);
                const countChanged = merged.length !== operationsLog.length;
                operationsLog = merged;
                safeSetItem('kvpz_operations_log', JSON.stringify(operationsLog));
                arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
                departureCount = operationsLog.filter(log => log.opType === 'departure').length;
                updateOpsLog();
                updateCounters();

                // If local memory has new logs that server doesn't have, send merged back to server
                if (countChanged && operationsLog.length > serverLogs.length) {
                    fetch('/operations-log', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(operationsLog)
                    }).catch(() => {});
                }
            }
        }
    } catch(e) {}
}

async function loadOperationsLogMemory() {
    try {
        // 1. Always load local storage memory first to guarantee instant UI rendering on refresh
        const stored = safeGetItem('kvpz_operations_log');
        if (stored) {
            try {
                const localLogs = JSON.parse(stored);
                if (Array.isArray(localLogs)) {
                    const oneMonthAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
                    operationsLog = localLogs.filter(log => !log || log.timestamp === undefined || log.timestamp >= oneMonthAgo);
                    arrivalCount = operationsLog.filter(log => log.opType === 'arrival').length;
                    departureCount = operationsLog.filter(log => log.opType === 'departure').length;
                    updateOpsLog();
                    updateCounters();
                }
            } catch(e) {}
        }

        // 2. Fetch and merge with shared server database
        await syncOperationsLogWithServer();

        // 3. Start 10-second sync loop across all connected clients
        setInterval(syncOperationsLogWithServer, 10000);
    } catch (e) {
        console.error("Error loading operations log memory:", e);
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

window.renderIconOverrideCard = function(ac) {
    if (!ac) return '';

    const currentType = (ac.type && ac.type !== 'N/A' && ac.type !== 'Unknown' && ac.type !== 'SRCH') ? ac.type.trim().toUpperCase() : '';
    const tailNum = (ac.tail && ac.tail !== 'N/A' && ac.tail !== 'Unknown') ? ac.tail.trim().toUpperCase() : ac.callsign;
    
    // Check if this type currently has a persistent override
    const activeOverride = currentType && customIconDb.typeOverrides ? customIconDb.typeOverrides[currentType] : null;

    const shapesList = [
        { key: 'cessna', label: '🛩️ Cessna / Light GA (High-Wing)' },
        { key: 'single_turbo', label: '🛩️ Pilatus PC-12 / TBM / Single Turboprop' },
        { key: 'twin_small', label: '🛩️ Beechcraft Baron / Seneca / Twin Small' },
        { key: 'twin_large', label: '🛩️ King Air 200/350 / Dash 8 / Twin Large' },
        { key: 'jet_swept', label: '✈️ Gulfstream / Citation / Swept Bizjet' },
        { key: 'jet_nonswept', label: '✈️ ERJ-145 / CRJ-200 / Regional Jet' },
        { key: 'b737', label: '🛫 Boeing 737 Classic (-300/-500/-700)' },
        { key: 'b738', label: '🛫 Boeing 737-800 / 737-MAX 8' },
        { key: 'b739', label: '🛫 Boeing 737-900 / 737-MAX 9' },
        { key: 'a319', label: '🛫 Airbus A319' },
        { key: 'a320', label: '🛫 Airbus A320 / A320neo' },
        { key: 'a321', label: '🛫 Airbus A321 / A321neo' },
        { key: 'airliner', label: '🛫 Boeing 757 / 767 Commercial Liner' },
        { key: 'heavy_2e', label: '🛬 Boeing 777 / 787 / A330 Heavy Twin' },
        { key: 'heavy_4e', label: '🛬 Boeing 747 Jumbo / A380 Quad Heavy' },
        { key: 'a359', label: '🛬 Airbus A350-900 / A350 XWB' },
        { key: 'a332', label: '🛬 Airbus A330-200 / A330neo' },
        { key: 'md11', label: '🛬 MD-11 / DC-10 Tri-Jet Heavy' },
        { key: 'c130', label: '🎖️ C-130 Hercules / L-100 Cargo' },
        { key: 'a400', label: '🎖️ Airbus A400M Atlas' },
        { key: 'a225', label: '🎖️ An-225 Mriya / An-124 Heavy Airlifter' },
        { key: 'e3awacs', label: '🎖️ E-3 Sentry AWACS Radar Plane' },
        { key: 'p8', label: '🎖️ P-8 Poseidon Maritime Patrol' },
        { key: 'hi_perf', label: '⚡ F-16 Fighting Falcon' },
        { key: 'f18', label: '⚡ F/A-18 Hornet / Super Hornet' },
        { key: 'f35', label: '⚡ F-35 Lightning II Stealth Fighter' },
        { key: 't38', label: '⚡ T-38 Talon Jet Trainer' },
        { key: 'mirage', label: '⚡ Mirage Delta Fighter' },
        { key: 'sb39', label: '⚡ JAS-39 Gripen Canard Fighter' },
        { key: 'l159', label: '⚡ L-159 / L-39 Albatros' },
        { key: 'md_a4', label: '⚡ A-4 Skyhawk Fighter' },
        { key: 'alpha_jet', label: '⚡ Dornier Alpha Jet' },
        { key: 'v22_fast', label: '🚁 V-22 Osprey Tiltrotor' },
        { key: 'blimp', label: '🎈 Blimp / Airship' },
        { key: 'helo_2b', label: '🚁 Robinson R22 / R44 (GA 2-Blade)' },
        { key: 'helo_b206', label: '🚁 Bell 206 JetRanger / LongRanger' },
        { key: 'helo_b407', label: '🚁 Bell 407 / 412 / 429 (4-Blade Twin)' },
        { key: 'helo_h125', label: '🚁 Airbus H125 / AS350 AStar (3-Blade)' },
        { key: 'helo_h135', label: '🚁 Airbus H135 / H145 (Fenestron EMS/Police)' },
        { key: 'helo_aw139', label: '🚁 Leonardo AW139 / AW189 (5-Blade Corporate)' },
        { key: 'helo_s76', label: '🚁 Sikorsky S-76 / S-92 (VIP Corporate)' },
        { key: 'helo_4b', label: '🚁 UH-60 / MH-60 Black Hawk (Tactical Military)' },
        { key: 'helo_ch53', label: '🎖️ CH-53E Super Stallion / CH-53K King Stallion (7-Blade Heavy)' },
        { key: 'helo_ah64', label: '🚁 AH-64 Apache Attack Gunship' },
        { key: 'helo_tandem', label: '🚁 CH-47 Chinook / CH-46 (Tandem Dual Rotor)' }
    ];

    let visualListHtml = `
        <div class="visual-icon-item ${!activeOverride ? 'selected' : ''}" 
             onclick="selectVisualIconItem('${ac.hex}', 'default')" 
             id="visual-icon-${ac.hex}-default">
            <div class="visual-icon-svg-box" style="color: var(--color-text-muted);">
                <i class="fa-solid fa-wand-magic-sparkles"></i>
            </div>
            <div class="visual-icon-info">
                <span class="visual-icon-title">-- Automatic Default Matching --</span>
                <span class="visual-icon-key">Key: auto</span>
            </div>
        </div>
    `;

    shapesList.forEach(item => {
        const isSelected = activeOverride === item.key;
        // Render actual live top-down vector SVG icon inside each list item!
        const svgIcon = getAircraftIconSvg({ type: item.key, heading: 0 }, isSelected ? '#10b981' : '#06b6d4');
        
        visualListHtml += `
            <div class="visual-icon-item ${isSelected ? 'selected' : ''}" 
                 onclick="selectVisualIconItem('${ac.hex}', '${item.key}')" 
                 id="visual-icon-${ac.hex}-${item.key}">
                <div class="visual-icon-svg-box">
                    ${svgIcon}
                </div>
                <div class="visual-icon-info">
                    <span class="visual-icon-title">${item.label}</span>
                    <span class="visual-icon-key">Vector Key: ${item.key}</span>
                </div>
            </div>
        `;
    });

    const currentSvgPreview = getAircraftIconSvg(ac, '#06b6d4');

    return `
        <div class="icon-override-card">
            <div class="icon-override-header">
                <span><i class="fa-solid fa-paintbrush"></i> Visual Icon Selector & Type Override</span>
                ${activeOverride ? '<span style="color:#10b981; font-size:0.68rem;">[OVERRIDDEN]</span>' : ''}
            </div>
            
            <div class="icon-preview-wrapper">
                <div class="icon-preview-box" id="icon-live-preview-box">
                    ${currentSvgPreview}
                </div>
                <div style="font-size:0.7rem; color:var(--color-text-muted); line-height: 1.3; flex: 1;">
                    <strong style="color: #fff;">${tailNum}</strong> &bull; Hex: <span style="color:#34d399; font-weight:700;">${ac.hex.toUpperCase()}</span><br>
                    <span>Selected Vector: <strong id="selected-shape-name-lbl" style="color:var(--accent-cyan); font-family:var(--font-mono);">${activeOverride || 'Default Auto'}</strong></span>
                </div>
            </div>

            <div style="margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem;">
                <label style="font-size: 0.68rem; color: var(--accent-cyan); font-weight: 700;">ICAO Aircraft Type Code:</label>
                <input type="text" id="icon-override-type-${ac.hex}" value="${currentType}" placeholder="e.g. C172, BE20, H60, B738..." style="background: #000; color: #fff; border: 1px solid var(--border-color); padding: 0.35rem 0.5rem; border-radius: 4px; font-size: 0.78rem; font-family: var(--font-mono); text-transform: uppercase;">
            </div>

            <input type="hidden" id="icon-override-selected-shape-${ac.hex}" value="${activeOverride || 'default'}">

            <div style="margin-bottom: 0.5rem; display: flex; flex-direction: column; gap: 0.25rem;">
                <label style="font-size: 0.68rem; color: var(--accent-cyan); font-weight: 700;">Select Top-Down Vector Icon (Real Icons Shown Below):</label>
                
                <div class="visual-icon-picker-container" id="visual-picker-list-${ac.hex}">
                    ${visualListHtml}
                </div>
            </div>

            <div class="icon-override-actions">
                <button class="btn-icon-override-save" onclick="applyIconOverrideFromSelect('${ac.hex}')">
                    <i class="fa-solid fa-floppy-disk"></i> Save Icon for Selected Type
                </button>
                ${(activeOverride && currentType) ? `
                <button class="btn-icon-override-reset" onclick="resetIconOverrideForType('${currentType}')">
                    <i class="fa-solid fa-rotate-left"></i> Reset Type
                </button>` : ''}
            </div>
        </div>
    `;
};

window.selectVisualIconItem = function(hex, shapeKey) {
    const hiddenInput = document.getElementById(`icon-override-selected-shape-${hex}`);
    if (hiddenInput) hiddenInput.value = shapeKey;

    // Highlight selected item visually
    const container = document.getElementById(`visual-picker-list-${hex}`);
    if (container) {
        const items = container.querySelectorAll('.visual-icon-item');
        items.forEach(el => el.classList.remove('selected'));
        const target = document.getElementById(`visual-icon-${hex}-${shapeKey}`);
        if (target) target.classList.add('selected');
    }

    const nameLbl = document.getElementById('selected-shape-name-lbl');
    if (nameLbl) nameLbl.textContent = shapeKey;

    // Update live top preview box
    const previewBox = document.getElementById('icon-live-preview-box');
    if (!previewBox) return;

    const dummyAc = { type: 'DUMMY', heading: 0 };
    const ac = aircraftCache[hex] || dummyAc;
    const tempAc = { ...ac };
    if (shapeKey !== 'default') {
        tempAc.type = 'CUSTOM_PREVIEW';
        customIconDb.typeOverrides['CUSTOM_PREVIEW'] = shapeKey;
    }

    const previewSvg = getAircraftIconSvg(tempAc, '#06b6d4');
    delete customIconDb.typeOverrides['CUSTOM_PREVIEW'];

    previewBox.innerHTML = previewSvg;
};

window.applyIconOverrideFromSelect = async function(hex) {
    const typeInput = document.getElementById(`icon-override-type-${hex}`);
    const hiddenInput = document.getElementById(`icon-override-selected-shape-${hex}`);
    if (!typeInput || !hiddenInput) return;
    
    const typeCode = typeInput.value.trim().toUpperCase();
    if (!typeCode) {
        alert('Please enter a valid ICAO Aircraft Type code (e.g. C172, BE20, H60, B738).');
        return;
    }
    const shapeKey = hiddenInput.value;
    
    // Update live aircraft cache and persistent aircraft database
    const hexKey = hex.toLowerCase();
    if (aircraftCache[hexKey]) {
        aircraftCache[hexKey].type = typeCode;
        aircraftCache[hexKey].categoryClass = getAircraftCategory(aircraftCache[hexKey]);
        updateMapMarker(aircraftCache[hexKey]);
    }
    if (!aircraftInfoDb[hexKey]) aircraftInfoDb[hexKey] = { hex: hex, callsign: 'N/A', tail: 'N/A', type: 'N/A', desc: 'N/A', operator: 'N/A' };
    aircraftInfoDb[hexKey].type = typeCode;
    aircraftInfoDb[hexKey].manual = true;
    saveAircraftDb();

    // Save icon override for this entered ICAO Type globally
    await window.saveCustomIconOverrideForType('type', typeCode, shapeKey);
    
    if (selectedHex) selectAircraft(selectedHex);
    if (window.updateIconOverrideDropdownMenu) window.updateIconOverrideDropdownMenu();
};

window.resetIconOverrideForType = async function(typeCode) {
    await window.saveCustomIconOverrideForType('type', typeCode, 'default');
    if (selectedHex) selectAircraft(selectedHex);
    if (window.updateIconOverrideDropdownMenu) window.updateIconOverrideDropdownMenu();
};

window.updateIconOverrideDropdownMenu = function() {
    const dropdown = document.getElementById('icon-override-dropdown');
    if (!dropdown) return;

    let targetAc = (selectedHex && aircraftCache[selectedHex]) ? aircraftCache[selectedHex] : null;

    if (!targetAc) {
        const activeHexes = Object.keys(aircraftCache);
        if (activeHexes.length > 0) {
            targetAc = aircraftCache[activeHexes[0]];
        } else {
            targetAc = { hex: 'generic', type: 'C172', tail: 'N172SP', callsign: 'N172SP' };
        }
    }

    const savedOverrides = customIconDb.typeOverrides || {};
    const activeTypeKeys = Object.keys(savedOverrides);
    let activeTypesListHtml = '';

    if (activeTypeKeys.length > 0) {
        activeTypesListHtml = `
            <div style="margin-top: 0.6rem; border-top: 1px solid var(--border-color); padding-top: 0.5rem;">
                <span style="font-size: 0.7rem; color: var(--accent-cyan); font-weight: 700; display: block; margin-bottom: 0.38rem;"><i class="fa-solid fa-list-check"></i> Active Saved Type Overrides:</span>
                <div style="display: flex; flex-direction: column; gap: 0.35rem; max-height: 140px; overflow-y: auto;">
                    ${activeTypeKeys.map(typeCode => {
                        const shapeKey = savedOverrides[typeCode];
                        const svgIcon = getAircraftIconSvg({ type: shapeKey, heading: 0 }, '#10b981');
                        return `
                            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.5); padding: 0.3rem 0.5rem; border-radius: 4px; border: 1px solid var(--border-color);">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">${svgIcon}</div>
                                    <span style="font-family: var(--font-mono); font-weight: 700; font-size: 0.78rem; color: #fff;">${typeCode}</span>
                                    <span style="font-size: 0.65rem; color: var(--color-text-muted);">(${shapeKey})</span>
                                </div>
                                <button onclick="resetIconOverrideForType('${typeCode}')" style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; font-size: 0.62rem; padding: 0.15rem 0.4rem; border-radius: 3px; cursor: pointer; font-weight: 700;">Reset</button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    dropdown.innerHTML = `
        ${window.renderIconOverrideCard(targetAc)}
        ${activeTypesListHtml}
    `;
};

window.openIconOverrideDropdown = function() {
    const container = document.getElementById('icon-override-menu-container');
    const styleContainer = document.getElementById('map-settings-container');
    if (styleContainer) styleContainer.classList.remove('open');
    if (container) {
        container.classList.add('open');
        window.updateIconOverrideDropdownMenu();
    }
};

function updateSearchPortalLinks(query) {
    const container = document.getElementById('portal-links-container');
    if (!container) return;
    
    const cleanQuery = query ? query.trim().toUpperCase() : '';
    let customizeBtnHtml = '';

    if (selectedHex && aircraftCache[selectedHex]) {
        const ac = aircraftCache[selectedHex];
        customizeBtnHtml = `
            <button onclick="openIconOverrideDropdown()" style="width: 100%; margin-bottom: 0.5rem; background: rgba(6, 182, 212, 0.15); border: 1px solid var(--accent-cyan); color: var(--accent-cyan); padding: 0.45rem 0.6rem; border-radius: 6px; font-weight: 700; font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 0.4rem; transition: background 0.2s;">
                <i class="fa-solid fa-paintbrush"></i> Customize Icon & Type Override
            </button>
        `;
    }

    if (!cleanQuery && !customizeBtnHtml) {
        container.innerHTML = `<p style="margin: 0; color: var(--color-text-muted); font-size: 0.65rem; font-style: italic;">Enter a tail number or select an aircraft to generate direct database links and customize icons.</p>`;
        return;
    }
    
    // Strip leading N for FAA Registry Lookups
    let faaTxt = cleanQuery;
    if (cleanQuery.startsWith('N')) {
        faaTxt = cleanQuery.substring(1);
    }
    
    container.innerHTML = `
        ${customizeBtnHtml}
        ${cleanQuery ? `
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
        </div>` : ''}
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
    // Straight land border with Illinois (North of 39.36 N to Lake Michigan): Longitude MUST be >= -87.5247 W
    if (lat >= 39.36 && lon < -87.5247) return false;
    // Wabash River (South of 39.36 N down to Ohio River)
    if (lat < 39.36) {
        const wabashWestEdge = -87.5247 - ((39.36 - lat) / (39.36 - 37.77)) * (88.0978 - 87.5247);
        if (lon < wabashWestEdge) return false;
    }
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

