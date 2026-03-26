const socket = io(`http://${window.location.host}`);

// ── Chart color palette (dark-theme friendly) ──
const COLORS = {
    temp: { border: '#ff8c42', bg: 'rgba(255,140,66,0.10)', glow: 'rgba(255,140,66,0.3)' },
    ec: { border: '#00b8a9', bg: 'rgba(0,184,169,0.08)', glow: 'rgba(0,184,169,0.3)' },
    ph: { border: '#2ecc71', bg: 'rgba(46,204,113,0.08)', glow: 'rgba(46,204,113,0.3)' },
    level: { border: '#a855f7', bg: 'rgba(168,85,247,0.06)', glow: 'rgba(168,85,247,0.3)' },
};

// Live charts
const tempLive = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ecLive = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const phLive = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const levelLive = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 1h
const temp1h = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec1h = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph1h = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level1h = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 1d
const temp1d = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec1d = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph1d = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level1d = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 7d
const temp7d = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec7d = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph7d = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level7d = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 14d
const temp14d = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec14d = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph14d = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level14d = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 1m
const temp1m = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec1m = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph1m = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level1m = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

// Storico 1y
const temp1y = { canvas: null, chart: null, data: newChartData(COLORS.temp), unit: '°C' };
const ec1y = { canvas: null, chart: null, data: newChartData(COLORS.ec), unit: 'mS/cm' };
const ph1y = { canvas: null, chart: null, data: newChartData(COLORS.ph), unit: '' };
const level1y = { canvas: null, chart: null, data: newChartData(COLORS.level), unit: '' };

let liveCircleTimeout = null;
const noDataTimeout = 10000;
let errorContainer;

document.addEventListener('DOMContentLoaded', () => {
    // Mappa i canvas esistenti

    // Live
    tempLive.canvas = document.getElementById('temperature-live-chart');
    ecLive.canvas = document.getElementById('humidity-live-chart');
    phLive.canvas = document.getElementById('dew_point-live-chart');
    levelLive.canvas = document.getElementById('absolute_humidity-live-chart');

    // 1h
    temp1h.canvas = document.getElementById('temperature-1h-chart');
    ec1h.canvas = document.getElementById('humidity-1h-chart');
    ph1h.canvas = document.getElementById('dew_point-1h-chart');
    level1h.canvas = document.getElementById('absolute_humidity-1h-chart');

    // 1d
    temp1d.canvas = document.getElementById('temperature-1d-chart');
    ec1d.canvas = document.getElementById('humidity-1d-chart');
    ph1d.canvas = document.getElementById('dew_point-1d-chart');
    level1d.canvas = document.getElementById('absolute_humidity-1d-chart');

    // 7d
    temp7d.canvas = document.getElementById('temperature-7d-chart');
    ec7d.canvas = document.getElementById('humidity-7d-chart');
    ph7d.canvas = document.getElementById('dew_point-7d-chart');
    level7d.canvas = document.getElementById('absolute_humidity-7d-chart');

    // 14d
    temp14d.canvas = document.getElementById('temperature-14d-chart');
    ec14d.canvas = document.getElementById('humidity-14d-chart');
    ph14d.canvas = document.getElementById('dew_point-14d-chart');
    level14d.canvas = document.getElementById('absolute_humidity-14d-chart');

    // 1m
    temp1m.canvas = document.getElementById('temperature-1m-chart');
    ec1m.canvas = document.getElementById('humidity-1m-chart');
    ph1m.canvas = document.getElementById('dew_point-1m-chart');
    level1m.canvas = document.getElementById('absolute_humidity-1m-chart');

    // 1y
    temp1y.canvas = document.getElementById('temperature-1y-chart');
    ec1y.canvas = document.getElementById('humidity-1y-chart');
    ph1y.canvas = document.getElementById('dew_point-1y-chart');
    level1y.canvas = document.getElementById('absolute_humidity-1y-chart');

    const liveCircle = document.getElementById('live-circle');
    if (liveCircle) liveCircle.style.display = 'none';

    errorContainer = document.getElementById('error-container');

    // Tabs: gestione generica attiva/non attiva
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(this.dataset.tab).classList.add('active');
        });
    });

    // Helper: carica eventi FSM e renderizza con annotazioni
    async function loadHistoricalTab(charts, start, aggr_window, maxPoints, showMin, showSec) {
        const [temp, ec, ph, level, fsmEvents] = await Promise.all([
            listSamples("temp_c", start, aggr_window),
            listSamples("ec_ms", start, aggr_window),
            listSamples("ph_value", start, aggr_window),
            listSamples("float_ok", start, aggr_window),
            loadFsmEvents(start, aggr_window),
        ]);
        const annotations = buildAnnotations(fsmEvents, showMin, showSec);
        renderChartData(charts.temp, temp, maxPoints, showMin, showSec);
        renderChartData(charts.ec, ec, maxPoints, showMin, showSec);
        renderChartData(charts.ph, ph, maxPoints, showMin, showSec);
        renderChartData(charts.level, level, maxPoints, showMin, showSec);
        applyAnnotations([charts.temp, charts.ec, charts.ph], annotations);
        updateKPIs(charts.suffix, temp, ec, ph, level);
    }

    // Storico 1h
    const tab1h = document.querySelector('.tab[data-tab="historical-1h"]');
    if (tab1h) {
        tab1h.addEventListener('click', () => loadHistoricalTab(
            { temp: temp1h, ec: ec1h, ph: ph1h, level: level1h, suffix: '1h' },
            '-1h', '5m', 12, true, true
        ));
    }

    // Storico 1d
    const tab1d = document.querySelector('.tab[data-tab="historical-1d"]');
    if (tab1d) {
        tab1d.addEventListener('click', () => loadHistoricalTab(
            { temp: temp1d, ec: ec1d, ph: ph1d, level: level1d, suffix: '1d' },
            '-1d', '1h', 24, true, false
        ));
    }

    // Storico 7d
    const tab7d = document.querySelector('.tab[data-tab="historical-7d"]');
    if (tab7d) {
        tab7d.addEventListener('click', () => loadHistoricalTab(
            { temp: temp7d, ec: ec7d, ph: ph7d, level: level7d, suffix: '7d' },
            '-7d', '1h', 200, false, false
        ));
    }

    // Storico 14d
    const tab14d = document.querySelector('.tab[data-tab="historical-14d"]');
    if (tab14d) {
        tab14d.addEventListener('click', () => loadHistoricalTab(
            { temp: temp14d, ec: ec14d, ph: ph14d, level: level14d, suffix: '14d' },
            '-14d', '2h', 200, false, false
        ));
    }

    // Storico 1m (~30d)
    const tab1m = document.querySelector('.tab[data-tab="historical-1m"]');
    if (tab1m) {
        tab1m.addEventListener('click', () => loadHistoricalTab(
            { temp: temp1m, ec: ec1m, ph: ph1m, level: level1m, suffix: '1m' },
            '-30d', '6h', 200, false, false
        ));
    }

    // Storico 1y
    const tab1y = document.querySelector('.tab[data-tab="historical-1y"]');
    if (tab1y) {
        tab1y.addEventListener('click', () => loadHistoricalTab(
            { temp: temp1y, ec: ec1y, ph: ph1y, level: level1y, suffix: '1y' },
            '-365d', '1d', 400, false, false
        ));
    }

    // Tab Analisi Dosaggi
    const tabDosing = document.querySelector('.tab[data-tab="dosing-analysis"]');
    if (tabDosing) {
        tabDosing.addEventListener('click', () => loadDosingAnalysis());
    }

    // ── Bottone fullscreen su ogni chart container ────────────────────────────
    document.querySelectorAll('.container').forEach(container => {
        const header = container.querySelector('.graph-header');
        if (!header) return;

        const btn = document.createElement('button');
        btn.className = 'btn-fullscreen';
        btn.title = 'Visualizza a tutto schermo';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>`;

        btn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                container.requestFullscreen().catch(err => {
                    console.warn('Fullscreen non disponibile:', err);
                });
            } else {
                document.exitFullscreen();
            }
        });

        // Aggiorna icona al cambio stato fullscreen
        document.addEventListener('fullscreenchange', () => {
            const isFs = document.fullscreenElement === container;
            btn.innerHTML = isFs
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                    <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
                  </svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                    stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                    <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                    <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                  </svg>`;
        }, { capture: false });

        // Inserisci a fine header (prima del popover)
        const popover = header.querySelector('.popover');
        if (popover) header.insertBefore(btn, popover);
        else header.appendChild(btn);
    });

    initSocketIO();
});


function initSocketIO() {
    socket.on('connect', () => {
        if (errorContainer) {
            errorContainer.style.display = 'none';
            errorContainer.textContent = '';
        }
    });

    socket.on('disconnect', () => {
        if (errorContainer) {
            errorContainer.textContent = 'Connessione persa. Controlla il collegamento con la scheda.';
            errorContainer.style.display = 'block';
        }
    });

    // Canali live + aggiornamento KPI
    socket.on('temp_c', (msg) => { renderChartData(tempLive, [msg]); updateLiveKPIs(); });
    socket.on('ec_ms', (msg) => { renderChartData(ecLive, [msg]); updateLiveKPIs(); });
    socket.on('ph_value', (msg) => { renderChartData(phLive, [msg]); updateLiveKPIs(); });
    socket.on('float_ok', (msg) => { renderChartData(levelLive, [msg]); updateLiveKPIs(); });

    // Clock update
    socket.on('server_time', (message) => {
        const clockEl = document.getElementById('server-clock');
        if (clockEl && message.time) {
            clockEl.textContent = message.time;
        }
    });

    // Status updates
    socket.on('state_changed', (message) => {
        const statusEl = document.getElementById('system-status');
        if (statusEl && message.state) {
            statusEl.textContent = message.state;
            statusEl.className = 'status-value ' + message.state;
        }
    });
}

// ── KPI helpers ──

/** Compute average from an array of {ts, value} messages */
function computeAvg(messages) {
    if (!messages || messages.length === 0) return null;
    const values = messages.filter(m => m.value !== undefined && m.value !== null).map(m => m.value);
    if (values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}

/** Set a single KPI element's text. Shows "--" if value is null. */
function setKPI(elementId, value, decimals = 2) {
    const el = document.getElementById(elementId);
    if (!el) return;
    // Preserve existing unit span
    const unitSpan = el.querySelector('.kpi-unit');
    const unitHTML = unitSpan ? unitSpan.outerHTML : '';
    if (value === null || value === undefined) {
        el.innerHTML = '--' + unitHTML;
    } else {
        el.innerHTML = value.toFixed(decimals) + unitHTML;
    }
}

/** Update KPI cards for a given tab suffix (e.g. '1h', '7d', 'live') */
function updateKPIs(tabSuffix, tempData, ecData, phData, levelData) {
    setKPI(`kpi-temp-${tabSuffix}`, computeAvg(tempData));
    setKPI(`kpi-ec-${tabSuffix}`, computeAvg(ecData));
    setKPI(`kpi-ph-${tabSuffix}`, computeAvg(phData));
    setKPI(`kpi-level-${tabSuffix}`, computeAvg(levelData));
}

/** Update live KPI cards from the chart data arrays (running averages) */
function updateLiveKPIs() {
    setKPI('kpi-temp-live', chartDataAvg(tempLive));
    setKPI('kpi-ec-live', chartDataAvg(ecLive));
    setKPI('kpi-ph-live', chartDataAvg(phLive));
    setKPI('kpi-level-live', chartDataAvg(levelLive));
}

/** Compute average from a chart object's dataset */
function chartDataAvg(obj) {
    const values = obj.data.datasets[0].data;
    if (!values || values.length === 0) return null;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
}

// ── Commands ──

async function sendCommand(cmd) {
    try {
        const response = await fetch(`http://${window.location.host}/api/command/${cmd}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        console.log("Command result:", data);
    } catch (error) {
        console.error("Command failed:", error);
        alert("Comando fallito: " + error.message);
    }
}

// ── Data fetching ──

async function listSamples(resource, start, aggr_window) {
    try {
        const response = await fetch(`http://${window.location.host}/get_samples/${resource}/${start}/${aggr_window}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data.error) {
            console.log(`Failed to get samples for ${resource}: ${data.error}`);
            return;
        }
        return data;
    } catch (error) {
        console.log(`Error fetching samples for ${resource}: ${error.message}`);
    }
}

// ── FSM Events & Annotations ──

/**
 * Carica i campioni fsm_state dal server.
 * Usa aggr_func=max per rilevare le transizioni di stato anche in finestre aggregate.
 */
async function loadFsmEvents(start, aggr_window) {
    try {
        const response = await fetch(`http://${window.location.host}/get_samples/fsm_state/${start}/${aggr_window}`);
        if (!response.ok) return [];
        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('FSM events non disponibili:', e.message);
        return [];
    }
}

/**
 * Helper: formatta un timestamp nello stesso formato usato dalle label del grafico.
 * Deve rispecchiare esattamente la logica in renderChartData.
 */
function formatTsLikeChart(ts, showMinutes, showSeconds) {
    const d = new Date(ts);
    if (showMinutes && showSeconds) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (showMinutes) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        return d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
}

/**
 * Converte i campioni fsm_state in annotazioni Chart.js (box verticali).
 * Stato 2 = IRRIGATING (blu), 3 = DOSING (rosso), 4 = MIXING (giallo),
 * 1 = REFILLING (ciano), 5 = RECIRCULATING (viola), 7 = DRAINING (grigio).
 * Ogni fascia mostra un'etichetta testuale con il nome dello stato.
 */
function buildAnnotations(fsmData, showMinutes = true, showSeconds = true) {
    if (!fsmData || fsmData.length === 0) return {};

    const stateStyles = {
        1: { bg: 'rgba(6,182,212,0.10)', border: 'rgba(6,182,212,0.45)', label: '💧 Refill', color: 'rgba(6,182,212,0.9)' },
        2: { bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.4)', label: '🌊 Irrigazione', color: 'rgba(59,130,246,0.9)' },
        3: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)', label: '⚗️ Dosaggio', color: 'rgba(239,68,68,0.9)' },
        4: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', label: '🔄 Mixing', color: 'rgba(245,158,11,0.9)' },
        5: { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.4)', label: '♻️ Ricircolo', color: 'rgba(168,85,247,0.9)' },
        7: { bg: 'rgba(100,116,139,0.10)', border: 'rgba(100,116,139,0.4)', label: '⏳ Scarico', color: 'rgba(100,116,139,0.9)' },
    };

    const annotations = {};
    let idx = 0;

    // Gap minimo tra etichette: 5% del range totale → max ~20 label visibili
    const totalRange = fsmData[fsmData.length - 1].ts - fsmData[0].ts;
    const minLabelGapMs = totalRange * 0.05;
    let lastLabelTs = -Infinity;
    let labelRow = 0; // alterna tra due altezze verticali

    let i = 0;
    while (i < fsmData.length) {
        const stateVal = Math.round(fsmData[i].value);
        if (!stateStyles[stateVal]) { i++; continue; }

        // Trova fine del blocco
        let j = i + 1;
        while (j < fsmData.length && Math.round(fsmData[j].value) === stateVal) j++;

        const startTs = fsmData[i].ts;
        const endTs = fsmData[j - 1].ts;
        const s = stateStyles[stateVal];
        const key = `evt_${idx++}`;

        // Fascia colorata (sempre visibile)
        annotations[key] = {
            type: 'box',
            xMin: formatTsLikeChart(startTs, showMinutes, showSeconds),
            xMax: formatTsLikeChart(endTs, showMinutes, showSeconds),
            backgroundColor: s.bg,
            borderColor: s.border,
            borderWidth: 1,
        };

        // Etichetta: solo se distante abbastanza dall'ultima stampata
        if ((startTs - lastLabelTs) >= minLabelGapMs) {
            const yAdjust = labelRow === 0 ? -6 : -20;
            labelRow = 1 - labelRow;
            annotations[`${key}_lbl`] = {
                type: 'label',
                xValue: formatTsLikeChart(startTs, showMinutes, showSeconds),
                yAdjust,
                yValue: undefined,
                position: { x: 'start', y: 'end' },
                content: s.label,
                color: s.color,
                font: { size: 10, weight: 'bold', family: "'Roboto Mono', monospace" },
                textAlign: 'left',
                padding: 2,
            };
            lastLabelTs = startTs;
        }

        i = j;
    }
    return annotations;
}

/**
 * Applica un set di annotazioni a uno o più grafici Chart.js già inizializzati.
 * Se il grafico non è ancora creato, salva le annotazioni nel chart object per uso futuro.
 */
function applyAnnotations(chartObjs, annotations) {
    if (!annotations || Object.keys(annotations).length === 0) return;
    chartObjs.forEach(obj => {
        if (!obj.chart) return;
        if (!obj.chart.options.plugins) obj.chart.options.plugins = {};
        obj.chart.options.plugins.annotation = { annotations };
        obj.chart.update();
    });
}

// ── Dosing Analysis ──

// Mappa nomi stato FSM
const STATE_NAMES = {
    0: 'IDLE',
    1: 'REFILLING',
    2: 'IRRIGATING',
    3: 'DOSING',
    4: 'MIXING',
    5: 'RECIRCULATING',
    6: 'ERROR',
    7: 'DRAINING',
};

const STATE_BADGE_MAP = {
    0: '<span class="badge badge-idle">IDLE</span>',
    1: '<span class="badge badge-refilling">💧 Refill</span>',
    2: '<span class="badge badge-irrigating">🌊 Irrigazione</span>',
    3: '<span class="badge badge-dosing-ev">⚗️ Dosaggio</span>',
    4: '<span class="badge badge-mixing-ev">🔄 Mixing</span>',
    5: '<span class="badge badge-recirculating">♻️ Ricircolo</span>',
    6: '<span class="badge badge-error">⚠️ Errore</span>',
    7: '<span class="badge badge-draining">⏳ Scarico</span>',
};

// ── Stato paginazione tabelle ──────────────────────────────────────────────────
const PAGE_SIZE = 10;
let _dosingRows = [];   // array HTML string completo (cicli dosaggio)
let _eventRows = [];   // array HTML string completo (eventi FSM)
let _dosingPageIdx = 0;
let _eventPageIdx = 0;

function renderDosingPage(idx) {
    const tbody = document.getElementById('dosing-table-body');
    const info = document.getElementById('dosing-page-info');
    const prevBtn = document.getElementById('dosing-prev');
    const nextBtn = document.getElementById('dosing-next');
    if (!tbody) return;
    const total = _dosingRows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    idx = Math.max(0, Math.min(idx, pages - 1));
    _dosingPageIdx = idx;
    const slice = _dosingRows.slice(idx * PAGE_SIZE, (idx + 1) * PAGE_SIZE);
    tbody.innerHTML = slice.join('') || '<tr><td colspan="9" class="no-data">Nessun ciclo dosaggio pH/EC (ultimi 7 giorni)</td></tr>';
    if (info) info.textContent = total > 0 ? `${idx + 1} / ${pages}  (${total} righe)` : '–';
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx >= pages - 1 || total === 0;
    // Scroll to top del body scrollabile
    const sb = document.querySelector('#dosing-table-wrap .scroll-body');
    if (sb) sb.scrollTop = 0;
}

function renderEventPage(idx) {
    const tbody = document.getElementById('event-history-body');
    const info = document.getElementById('event-page-info');
    const prevBtn = document.getElementById('event-prev');
    const nextBtn = document.getElementById('event-next');
    if (!tbody) return;
    const total = _eventRows.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    idx = Math.max(0, Math.min(idx, pages - 1));
    _eventPageIdx = idx;
    const slice = _eventRows.slice(idx * PAGE_SIZE, (idx + 1) * PAGE_SIZE);
    tbody.innerHTML = slice.join('') || '<tr><td colspan="4" class="no-data">Nessun evento registrato (ultimi 7 giorni)</td></tr>';
    if (info) info.textContent = total > 0 ? `${idx + 1} / ${pages}  (${total} righe)` : '–';
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx >= pages - 1 || total === 0;
    const sb = document.querySelector('#event-table-wrap .scroll-body');
    if (sb) sb.scrollTop = 0;
}

// Chiamate dai bottoni HTML
function dosingPage(delta) { renderDosingPage(_dosingPageIdx + delta); }
function eventPage(delta) { renderEventPage(_eventPageIdx + delta); }

/**
 * Carica dati dosing + cronologia eventi FSM.
 */
async function loadDosingAnalysis() {
    const start = '-7d';
    const aggr = '10m';

    const [phBefore, phAfter, ecBefore, ecAfter, fsmData] = await Promise.all([
        listSamples('dosing_ph_before', start, aggr),
        listSamples('dosing_ph_after', start, aggr),
        listSamples('dosing_ec_before', start, aggr),
        listSamples('dosing_ec_after', start, aggr),
        loadFsmEvents(start, '1m'),
    ]);

    // ─── 1. Cicli dosaggio ───
    const cycles = [];
    if (phBefore && phBefore.length > 0) {
        phBefore.forEach((bef, idx) => {
            const aft = phAfter && phAfter[idx] ? phAfter[idx] : null;
            const ecB = ecBefore && ecBefore[idx] ? ecBefore[idx] : null;
            const ecA = ecAfter && ecAfter[idx] ? ecAfter[idx] : null;

            const phB = bef.value;
            const phA = aft ? aft.value : null;
            const ecBv = ecB ? ecB.value : null;
            const ecAv = ecA ? ecA.value : null;

            const durationMin = 5.2;
            const deltaPh = phA !== null ? (phA - phB) : null;
            const deltaEc = ecAv !== null && ecBv !== null ? (ecAv - ecBv) : null;

            let result = 'on-target';
            const PH_LO = 5.5, PH_HI = 6.5, EC_LO = 1.0, EC_HI = 2.0;
            if (phA !== null) {
                if (phA < PH_LO || (ecAv !== null && ecAv < EC_LO)) result = 'undershoot';
                if (phA > PH_HI || (ecAv !== null && ecAv > EC_HI)) result = 'overshoot';
            } else {
                result = 'unknown';
            }
            cycles.push({ ts: bef.ts, durationMin, phB, phA, ecBv, ecAv, deltaPh, deltaEc, result });
        });
    }

    // KPI dosaggio
    const count = cycles.length;
    const avgDur = count > 0 ? (cycles.reduce((s, c) => s + c.durationMin, 0) / count) : null;
    let avgInterval = null;
    if (count >= 2) {
        let totalGap = 0;
        for (let i = 1; i < cycles.length; i++) totalGap += (cycles[i].ts - cycles[i - 1].ts) / 60000;
        avgInterval = totalGap / (cycles.length - 1);
    }
    const onTargetCount = cycles.filter(c => c.result === 'on-target').length;
    const effectiveness = count > 0 ? (onTargetCount / count * 100) : null;

    const fmt = (v, dec = 1) => v !== null && v !== undefined ? v.toFixed(dec) : '--';
    const setEl = (id, txt) => { const el = document.getElementById(id); if (el) { const u = el.querySelector('.kpi-unit'); el.innerHTML = txt + (u ? u.outerHTML : ''); } };

    setEl('kpi-dosing-count', count > 0 ? String(count) : '0');
    setEl('kpi-dosing-duration', fmt(avgDur) + '<span class="kpi-unit">min</span>');
    setEl('kpi-dosing-interval', fmt(avgInterval) + '<span class="kpi-unit">min</span>');
    setEl('kpi-dosing-effectiveness', fmt(effectiveness, 0) + '<span class="kpi-unit">%</span>');

    // Costruisci righe HTML per la tabella dosaggi
    const badgeMap = {
        'on-target': '<span class="badge badge-on-target">✓ Target</span>',
        'overshoot': '<span class="badge badge-overshoot">↑ Eccesso</span>',
        'undershoot': '<span class="badge badge-undershoot">↓ Difetto</span>',
        'unknown': '<span class="badge">--</span>',
    };
    const sign = v => v === null ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2);
    _dosingRows = cycles.map(c => {
        const ts = new Date(c.ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `<tr>
            <td>${ts}</td>
            <td>${c.durationMin.toFixed(1)} min</td>
            <td>${c.phB !== null && c.phB !== undefined ? c.phB.toFixed(2) : '--'}</td>
            <td>${c.phA !== null && c.phA !== undefined ? c.phA.toFixed(2) : '--'}</td>
            <td>${sign(c.deltaPh)}</td>
            <td>${c.ecBv !== null && c.ecBv !== undefined ? c.ecBv.toFixed(2) : '--'}</td>
            <td>${c.ecAv !== null && c.ecAv !== undefined ? c.ecAv.toFixed(2) : '--'}</td>
            <td>${sign(c.deltaEc)}</td>
            <td>${badgeMap[c.result] || '--'}</td>
        </tr>`;
    });
    _dosingPageIdx = 0;
    renderDosingPage(0);

    // ─── 2. Cronologia eventi FSM ───
    const evtBody = document.getElementById('event-history-body');
    if (!evtBody) return;

    const events = [];
    if (fsmData && fsmData.length > 0) {
        let i = 0;
        while (i < fsmData.length) {
            const stateVal = Math.round(fsmData[i].value);
            if (stateVal === 0) { i++; continue; }
            let j = i + 1;
            while (j < fsmData.length && Math.round(fsmData[j].value) === stateVal) j++;
            const startTs = fsmData[i].ts;
            const endTs = fsmData[j - 1].ts;
            const durMin = Math.max(1, Math.round((endTs - startTs) / 60000));
            events.push({ stateVal, startTs, endTs, durMin });
            i = j;
        }
    }

    const irrigCount = events.filter(e => e.stateVal === 2).length;
    const dosingEvCount = events.filter(e => e.stateVal === 3).length;
    const mixingCount = events.filter(e => e.stateVal === 4).length;
    const totalEvents = events.length;
    setEl('kpi-event-total', totalEvents > 0 ? String(totalEvents) : '0');
    setEl('kpi-event-irrig', String(irrigCount));
    setEl('kpi-event-dosing', String(dosingEvCount));
    setEl('kpi-event-mixing', String(mixingCount));

    // Costruisci righe HTML per la tabella eventi (più recenti prima)
    _eventRows = events.reverse().map(e => {
        const ts = new Date(e.startTs).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const badge = STATE_BADGE_MAP[e.stateVal] || `<span class="badge">${STATE_NAMES[e.stateVal] || e.stateVal}</span>`;
        return `<tr>
            <td>${ts}</td>
            <td>${badge}</td>
            <td>${e.durMin} min</td>
            <td>${new Date(e.endTs).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`;
    });
    _eventPageIdx = 0;
    renderEventPage(0);
}

// ── Chart rendering ──


function renderChartData(obj, messages, maxPoints = 20, showMinutes = true, showSeconds = true) {
    if (!messages || messages.length === 0) return;

    const noDataDiv = document.getElementById((obj.canvas && obj.canvas.id) + '-nodata');
    const liveCircle = document.getElementById('live-circle');
    const isLiveChart = obj.canvas && obj.canvas.id && obj.canvas.id.endsWith('-live-chart');

    // Per gli storici resetto sempre i dati
    if (!isLiveChart) {
        obj.data.labels = [];
        obj.data.datasets[0].data = [];
    }

    for (const message of messages) {
        if (message.ts === undefined) continue;

        let date = new Date(message.ts);
        if (showMinutes && showSeconds) {
            date = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else if (showMinutes) {
            date = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            date = date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        }

        obj.data.labels.push(date);
        obj.data.datasets[0].data.push(message.value);

        if (obj.data.labels.length > maxPoints) {
            obj.data.labels.shift();
            obj.data.datasets[0].data.shift();
        }

        if (obj.data.labels.length === 0 || obj.data.datasets[0].data.length === 0) {
            if (obj.canvas) obj.canvas.style.display = 'none';
            if (noDataDiv) noDataDiv.style.display = 'flex';

            if (isLiveChart && liveCircle) {
                liveCircle.style.display = 'none';
                liveCircle.classList.remove('flash');
                if (liveCircleTimeout) {
                    clearTimeout(liveCircleTimeout);
                    liveCircleTimeout = null;
                }
            }

            if (obj.chart) {
                obj.chart.destroy();
                obj.chart = null;
            }
        } else {
            if (obj.canvas) obj.canvas.style.display = 'block';
            if (noDataDiv) noDataDiv.style.display = 'none';

            if (isLiveChart && liveCircle) {
                liveCircle.style.display = 'flex';
                liveCircle.classList.add('flash');

                if (liveCircleTimeout) clearTimeout(liveCircleTimeout);
                liveCircleTimeout = setTimeout(() => {
                    liveCircle.classList.remove('flash');
                    liveCircle.style.display = 'none';
                }, noDataTimeout);
            }

            if (!obj.chart) {
                obj.chart = newChart(obj.canvas.getContext('2d'), obj);
            } else {
                obj.chart.update();
            }
        }
    }
}

function newChart(ctx, obj) {
    return new Chart(ctx, {
        type: 'line',
        data: obj.data,
        options: {
            responsive: true,
            animation: false,
            scales: {
                y: {
                    grid: {
                        color: 'rgba(255,255,255,0.06)',
                        drawBorder: false,
                    },
                    ticks: {
                        color: '#8a9bb5',
                        font: { family: "'Roboto Mono', monospace", size: 11 },
                    },
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45,
                        color: '#8a9bb5',
                        font: { family: "'Roboto Mono', monospace", size: 10 },
                    },
                },
            },
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: { display: false },
                annotation: { annotations: {} },
                tooltip: {
                    backgroundColor: 'rgba(15,25,35,0.95)',
                    titleColor: '#e8edf2',
                    bodyColor: '#e8edf2',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        title: () => '',
                        label: function (context) {
                            const unit = context.chart && context.chart.options && context.chart.options._unit
                                ? context.chart.options._unit
                                : (obj.unit || '');
                            if (!context.chart.options._unit) context.chart.options._unit = obj.unit;
                            return `${context.label}  ·  ${context.parsed.y.toFixed(2)} ${unit}`;
                        },
                    },
                },
                noDataMessage: true,
            },
        },
    });
}

function newChartData(color) {
    return {
        labels: [],
        datasets: [{
            data: [],
            borderColor: color.border,
            backgroundColor: color.bg,
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            pointHoverRadius: 5,
            borderWidth: 2,
        }],
    };
}