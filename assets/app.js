/* ================================================================
 *  MyHydroponic — Web UI  (app.js)
 *  Registry-driven: sensors, tabs, charts, KPI, dosaggi, CSV export
 * ================================================================ */

const socket = io(`http://${window.location.host}`);

/* ---------- SENSOR REGISTRY ---------- */
const SENSORS = {
    temp:  { resource: 'temp_c',   wsEvent: 'temp_c',   label: 'Temp soluzione (\u00b0C)', unit: '\u00b0C',    color: '#ff9800', fill: 'rgba(255,152,0,0.12)' },
    ec:    { resource: 'ec_ms',    wsEvent: 'ec_ms',     label: 'EC (mS/cm)',          unit: 'mS/cm', color: '#00bcd4', fill: 'rgba(0,188,212,0.10)' },
    ph:    { resource: 'ph_value', wsEvent: 'ph_value',  label: 'pH',                  unit: '',      color: '#4caf50', fill: 'rgba(76,175,80,0.10)' },
    phmv:  { resource: 'ph_mv',    wsEvent: 'ph_mv',     label: 'pH (mV)',             unit: 'mV',    color: '#f44336', fill: 'rgba(244,67,54,0.10)' },
    level: { resource: 'float_ok', wsEvent: 'float_ok',  label: 'Livello',             unit: '',      color: '#ab47bc', fill: 'rgba(171,71,188,0.10)' },
};

const TOP_ROW_SENSORS    = ['temp', 'ec'];
const BOTTOM_ROW_SENSORS = ['ph', 'phmv', 'level'];
const KPI_SENSORS        = ['temp', 'ec', 'ph', 'level'];

/* ---------- RANGE BANDS (chartjs-plugin-annotation) ---------- */
const RANGE_BANDS = {
    ph:   { min: 5.5, max: 6.5, color: 'rgba(76,175,80,0.13)' },
    ec:   { min: 1.0, max: 2.0, color: 'rgba(0,188,212,0.13)' },
    temp: { min: 18,  max: 26,  color: 'rgba(255,152,0,0.13)' },
};

/* ---------- KPI ALERT THRESHOLDS ---------- */
const KPI_ALERTS = {
    ph:   { min: 5.5, max: 6.5 },
    ec:   { min: 1.0, max: 2.0 },
    temp: { min: 18,  max: 26  },
};

/* ---------- PUMP NAMES ---------- */
const PUMP_NAMES = ['irrigation', 'ph_down', 'nutrients', 'recirculation', 'refill'];

/* ---------- TAB CONFIG ---------- */
const TABS = [
    { id: '1y',  label: '1 anno', start: '-365d', aggr: '1d',  maxPts: 400, showMin: false, showSec: false },
    { id: '1m',  label: '1 mese', start: '-30d',  aggr: '6h',  maxPts: 200, showMin: false, showSec: false },
    { id: '14d', label: '14 gg',  start: '-14d',  aggr: '2h',  maxPts: 200, showMin: false, showSec: false },
    { id: '7d',  label: '7 gg',   start: '-7d',   aggr: '1h',  maxPts: 200, showMin: false, showSec: false },
    { id: '1d',  label: '1 D',    start: '-1d',   aggr: '1h',  maxPts: 24,  showMin: true,  showSec: false },
    { id: '1h',  label: '1 h',    start: '-1h',   aggr: '5m',  maxPts: 12,  showMin: true,  showSec: true  },
    { id: 'live',     label: 'Live',     isLive: true },
    { id: 'dosaggi',  label: 'Dosaggi',  isDosaggi: true },
    { id: 'settings', label: 'Sistema',  isSettings: true },
];

/* ---------- FSM STATE MAP ---------- */
const FSM_STATES = {
    0: { name: 'IDLE',          color: '#2ecc71' },
    1: { name: 'REFILLING',     color: '#e74c3c' },
    2: { name: 'IRRIGATING',    color: '#3498db' },
    3: { name: 'DOSING',        color: '#e74c3c' },
    4: { name: 'MIXING',        color: '#f39c12' },
    5: { name: 'RECIRCULATING', color: '#9b59b6' },
    6: { name: 'ERROR',         color: '#c0392b' },
    7: { name: 'DRAINING',      color: '#95a5a6' },
};

/* ---------- CHART STORE ---------- */
// charts[tabId][sensorKey] = { canvas, chart, data }
const charts = {};

/* ---------- KPI STATE ---------- */
const kpiState = {};
KPI_SENSORS.forEach(k => { kpiState[k] = { current: null, prev: null, history: [] }; });

let liveCircleTimeout = null;
const noDataTimeout = 10000;
let errorContainer;

/* ================================================================
 *  DOM GENERATION
 * ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
    errorContainer = document.getElementById('error-container');
    initTheme();
    buildKPICards();
    buildTabs();
    buildTabContents();
    initSocketIO();
    initSystemInfo();
});

/* ---------- KPI CARDS ---------- */
function buildKPICards() {
    const row = document.getElementById('kpi-row');
    KPI_SENSORS.forEach(key => {
        const s = SENSORS[key];
        const card = document.createElement('div');
        card.className = 'kpi-card';
        card.id = `kpi-${key}`;
        card.innerHTML = `
            <div class="kpi-label">${s.label}</div>
            <div class="kpi-value-row">
                <span class="kpi-value" id="kpi-${key}-value">--</span>
                <span class="kpi-unit">${s.unit}</span>
                <span class="kpi-trend" id="kpi-${key}-trend"></span>
            </div>
            <div class="kpi-range" id="kpi-${key}-range">min -- / max --</div>
        `;
        card.style.borderTopColor = s.color;
        row.appendChild(card);
    });
}

/* ---------- TAB BUTTONS ---------- */
function buildTabs() {
    const bar = document.getElementById('tabs-bar');
    TABS.forEach(tab => {
        const btn = document.createElement('button');
        btn.dataset.tab = tab.id;
        if (tab.isLive) {
            btn.className = 'tab-with-circle tab active';
            btn.innerHTML = `<span id="live-circle"></span>${tab.label}`;
        } else {
            btn.className = 'tab';
            btn.textContent = tab.label;
        }
        btn.addEventListener('click', () => switchTab(tab));
        bar.appendChild(btn);
    });
}

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tab.id}"]`).classList.add('active');
    document.getElementById(`tab-${tab.id}`).classList.add('active');

    if (!tab.isLive && !tab.isDosaggi && !tab.isSettings) {
        loadHistoricalTab(tab);
    } else if (tab.isDosaggi) {
        loadDosaggiTab();
    } else if (tab.isSettings) {
        loadSystemStatus();
    }
}

/* ---------- TAB CONTENT PANELS ---------- */
function buildTabContents() {
    const root = document.getElementById('charts-root');

    TABS.forEach(tab => {
        const div = document.createElement('div');
        div.id = `tab-${tab.id}`;
        div.className = 'tab-content' + (tab.isLive ? ' active' : '');

        if (tab.isDosaggi) {
            div.innerHTML = buildDosaggiHTML();
        } else if (tab.isSettings) {
            div.innerHTML = buildSettingsHTML();
        } else {
            div.innerHTML = buildChartTabHTML(tab);
            initChartsForTab(tab, div);
        }
        root.appendChild(div);
    });
}

function buildChartTabHTML(tab) {
    const topCharts = TOP_ROW_SENSORS.map(k => chartContainerHTML(k, tab.id)).join('');
    const bottomCharts = BOTTOM_ROW_SENSORS.map(k => chartContainerHTML(k, tab.id, true)).join('');

    const exportBtn = (!tab.isLive)
        ? `<div class="export-row"><button class="btn btn-export" onclick="exportCSV('${tab.id}')">CSV Export</button></div>`
        : '';

    return `${exportBtn}<div class="top-row">${topCharts}</div><div class="derived-row">${bottomCharts}</div>`;
}

function chartContainerHTML(sensorKey, tabId, isDerived) {
    const s = SENSORS[sensorKey];
    const cid = `${sensorKey}-${tabId}-chart`;
    return `
        <div class="container${isDerived ? ' derived-container' : ''}">
            <div class="graph-header">
                <span>${s.label}</span>
            </div>
            <canvas id="${cid}"></canvas>
            <div id="${cid}-nodata" class="nodata-container">
                <img src="./img/nodata.svg" class="nodata-img">
                <span class="no-data">No data</span>
            </div>
        </div>`;
}

function initChartsForTab(tab, parentEl) {
    charts[tab.id] = {};
    const allKeys = [...TOP_ROW_SENSORS, ...BOTTOM_ROW_SENSORS];
    allKeys.forEach(key => {
        const s = SENSORS[key];
        const canvas = parentEl.querySelector(`#${key}-${tab.id}-chart`);
        charts[tab.id][key] = {
            canvas: canvas,
            chart: null,
            data: newChartData(s.color, s.fill),
            unit: s.unit,
            sensorKey: key,
        };
    });
}

/* ================================================================
 *  DOSAGGI TAB
 * ================================================================ */

function buildDosaggiHTML() {
    return `
        <div class="dosaggi-kpi-row">
            <div class="kpi-card kpi-card-sm"><div class="kpi-label">Dosaggi (7gg)</div><div class="kpi-value" id="dos-count">--</div></div>
            <div class="kpi-card kpi-card-sm"><div class="kpi-label">Durata media</div><div class="kpi-value" id="dos-avg-dur">--</div></div>
            <div class="kpi-card kpi-card-sm"><div class="kpi-label">Intervallo medio</div><div class="kpi-value" id="dos-avg-int">--</div></div>
            <div class="kpi-card kpi-card-sm"><div class="kpi-label">Efficacia</div><div class="kpi-value" id="dos-eff">--%</div></div>
        </div>

        <div class="container dosaggi-table-container">
            <div class="graph-header"><span>Cicli dosaggio (7 giorni)</span></div>
            <div class="table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>Timestamp</th><th>pH prima</th><th>pH dopo</th><th>\u0394 pH</th>
                        <th>EC prima</th><th>EC dopo</th><th>\u0394 EC</th><th>Risultato</th>
                    </tr></thead>
                    <tbody id="dosing-tbody"></tbody>
                </table>
            </div>
            <div class="pagination" id="dosing-pagination"></div>
        </div>

        <div class="container dosaggi-table-container">
            <div class="graph-header"><span>Storico FSM (7 giorni)</span></div>
            <div class="table-scroll">
                <table class="data-table">
                    <thead><tr>
                        <th>Timestamp</th><th>Stato</th><th>Durata (min)</th>
                    </tr></thead>
                    <tbody id="fsm-tbody"></tbody>
                </table>
            </div>
            <div class="pagination" id="fsm-pagination"></div>
        </div>`;
}

let dosingData = [];
let fsmData = [];
let dosingPage = 0;
let fsmPage = 0;
const PAGE_SIZE = 10;

async function loadDosaggiTab() {
    const [phBefore, phAfter, ecBefore, ecAfter, fsmRaw] = await Promise.all([
        listSamples('dosing_ph_before', '-7d', '1m'),
        listSamples('dosing_ph_after',  '-7d', '1m'),
        listSamples('dosing_ec_before', '-7d', '1m'),
        listSamples('dosing_ec_after',  '-7d', '1m'),
        listSamples('fsm_state',        '-7d', '1m'),
    ]);

    // Build dosing cycles
    dosingData = buildDosingCycles(phBefore, phAfter, ecBefore, ecAfter);
    dosingPage = 0;
    renderDosingTable();

    // Build FSM events
    fsmData = buildFSMEvents(fsmRaw);
    fsmPage = 0;
    renderFSMTable();

    // KPI summary
    updateDosaggiKPI();
}

function buildDosingCycles(phB, phA, ecB, ecA) {
    if (!phB || !phA) return [];
    const cycles = [];
    const len = Math.min(phB.length, phA.length);
    for (let i = 0; i < len; i++) {
        const phBefore = phB[i].value;
        const phAfter  = phA[i].value;
        const ecBefore = (ecB && ecB[i]) ? ecB[i].value : null;
        const ecAfter  = (ecA && ecA[i]) ? ecA[i].value : null;
        if (phBefore === 0 && phAfter === 0) continue; // skip empty
        cycles.push({
            ts: phB[i].ts,
            phBefore, phAfter,
            ecBefore, ecAfter,
            deltaPh: phAfter - phBefore,
            deltaEc: (ecBefore !== null && ecAfter !== null) ? ecAfter - ecBefore : null,
        });
    }
    return cycles.reverse(); // newest first
}

function getDosingResult(cycle) {
    const ph = cycle.phAfter;
    if (ph >= 5.5 && ph <= 6.5) return { text: 'Target', cls: 'badge-ok' };
    if (ph > 6.5) return { text: 'Eccesso', cls: 'badge-warn' };
    return { text: 'Difetto', cls: 'badge-err' };
}

function renderDosingTable() {
    const tbody = document.getElementById('dosing-tbody');
    const page = dosingData.slice(dosingPage * PAGE_SIZE, (dosingPage + 1) * PAGE_SIZE);
    tbody.innerHTML = page.map(c => {
        const r = getDosingResult(c);
        return `<tr>
            <td>${fmtTs(c.ts)}</td>
            <td>${c.phBefore.toFixed(2)}</td><td>${c.phAfter.toFixed(2)}</td>
            <td class="${c.deltaPh < 0 ? 'delta-neg' : 'delta-pos'}">${c.deltaPh > 0 ? '+' : ''}${c.deltaPh.toFixed(2)}</td>
            <td>${c.ecBefore !== null ? c.ecBefore.toFixed(2) : '--'}</td>
            <td>${c.ecAfter !== null ? c.ecAfter.toFixed(2) : '--'}</td>
            <td>${c.deltaEc !== null ? ((c.deltaEc > 0 ? '+' : '') + c.deltaEc.toFixed(2)) : '--'}</td>
            <td><span class="badge ${r.cls}">${r.text}</span></td>
        </tr>`;
    }).join('');
    renderPagination('dosing-pagination', dosingData.length, dosingPage, p => { dosingPage = p; renderDosingTable(); });
}

function buildFSMEvents(raw) {
    if (!raw || raw.length < 2) return [];
    const events = [];
    for (let i = 0; i < raw.length - 1; i++) {
        const stateVal = Math.round(raw[i].value);
        const stateInfo = FSM_STATES[stateVal] || { name: `STATE_${stateVal}`, color: '#888' };
        const durMin = ((raw[i + 1].ts - raw[i].ts) / 60000).toFixed(1);
        if (stateVal === 0 && durMin > 60) continue; // skip long IDLE
        events.push({ ts: raw[i].ts, state: stateInfo, duration: durMin });
    }
    return events.reverse();
}

function renderFSMTable() {
    const tbody = document.getElementById('fsm-tbody');
    const page = fsmData.slice(fsmPage * PAGE_SIZE, (fsmPage + 1) * PAGE_SIZE);
    tbody.innerHTML = page.map(e => `<tr>
        <td>${fmtTs(e.ts)}</td>
        <td><span class="state-badge" style="background:${e.state.color}">${e.state.name}</span></td>
        <td>${e.duration}</td>
    </tr>`).join('');
    renderPagination('fsm-pagination', fsmData.length, fsmPage, p => { fsmPage = p; renderFSMTable(); });
}

function updateDosaggiKPI() {
    const el = (id) => document.getElementById(id);
    el('dos-count').textContent = dosingData.length;

    if (dosingData.length > 0) {
        const onTarget = dosingData.filter(c => c.phAfter >= 5.5 && c.phAfter <= 6.5).length;
        el('dos-eff').textContent = Math.round(onTarget / dosingData.length * 100) + '%';
    }

    if (dosingData.length >= 2) {
        const intervals = [];
        for (let i = 0; i < dosingData.length - 1; i++) {
            intervals.push(Math.abs(dosingData[i].ts - dosingData[i + 1].ts) / 60000);
        }
        el('dos-avg-int').textContent = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) + ' min';
    }

    // avg duration not available from before/after only; show "--"
    el('dos-avg-dur').textContent = '--';
}

function renderPagination(containerId, totalItems, currentPage, onPageChange) {
    const container = document.getElementById(containerId);
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    let html = '';
    if (currentPage > 0) html += `<button class="btn btn-page" data-p="${currentPage - 1}">&laquo;</button>`;
    for (let i = 0; i < totalPages; i++) {
        html += `<button class="btn btn-page${i === currentPage ? ' active' : ''}" data-p="${i}">${i + 1}</button>`;
    }
    if (currentPage < totalPages - 1) html += `<button class="btn btn-page" data-p="${currentPage + 1}">&raquo;</button>`;
    container.innerHTML = html;
    container.querySelectorAll('[data-p]').forEach(btn => {
        btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.p)));
    });
}

/* ================================================================
 *  HISTORICAL DATA LOADING (parallel fetch + spinner)
 * ================================================================ */

async function loadHistoricalTab(tabCfg) {
    const tabEl = document.getElementById(`tab-${tabCfg.id}`);
    showSpinners(tabEl);

    try {
        const sensorKeys = [...TOP_ROW_SENSORS, ...BOTTOM_ROW_SENSORS];
        const results = await Promise.all(
            sensorKeys.map(k => listSamples(SENSORS[k].resource, tabCfg.start, tabCfg.aggr))
        );
        sensorKeys.forEach((key, i) => {
            renderChartData(charts[tabCfg.id][key], results[i], tabCfg.maxPts, tabCfg.showMin, tabCfg.showSec);
        });
    } finally {
        hideSpinners(tabEl);
    }
}

function showSpinners(tabEl) {
    tabEl.querySelectorAll('.container').forEach(c => {
        if (c.querySelector('.chart-spinner')) return;
        const sp = document.createElement('div');
        sp.className = 'chart-spinner';
        c.appendChild(sp);
    });
}

function hideSpinners(tabEl) {
    tabEl.querySelectorAll('.chart-spinner').forEach(s => s.remove());
}

/* ================================================================
 *  CSV EXPORT
 * ================================================================ */

async function exportCSV(tabId) {
    const tabCfg = TABS.find(t => t.id === tabId);
    if (!tabCfg || tabCfg.isLive || tabCfg.isDosaggi) return;

    const sensorKeys = [...TOP_ROW_SENSORS, ...BOTTOM_ROW_SENSORS];
    const results = await Promise.all(
        sensorKeys.map(k => listSamples(SENSORS[k].resource, tabCfg.start, tabCfg.aggr))
    );

    const tsMap = new Map();
    sensorKeys.forEach((key, i) => {
        if (!results[i]) return;
        for (const row of results[i]) {
            if (!tsMap.has(row.ts)) tsMap.set(row.ts, {});
            tsMap.get(row.ts)[key] = row.value;
        }
    });

    const sorted = [...tsMap.entries()].sort((a, b) => a[0] - b[0]);
    const header = 'timestamp,temp_c,ec_ms,ph,ph_mv,level\n';
    const rows = sorted.map(([ts, vals]) => {
        const d = new Date(ts).toISOString();
        return `${d},${vals.temp ?? ''},${vals.ec ?? ''},${vals.ph ?? ''},${vals.phmv ?? ''},${vals.level ?? ''}`;
    }).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `idroponica_${tabId}_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ================================================================
 *  SOCKET.IO
 * ================================================================ */

function initSocketIO() {
    socket.on('connect', () => {
        if (errorContainer) { errorContainer.style.display = 'none'; errorContainer.textContent = ''; }
    });

    socket.on('disconnect', () => {
        if (errorContainer) {
            errorContainer.textContent = 'Connessione persa. Verifica la connessione.';
            errorContainer.style.display = 'block';
        }
    });

    // Live chart data
    for (const [key, sensor] of Object.entries(SENSORS)) {
        socket.on(sensor.wsEvent, (msg) => {
            if (charts['live'] && charts['live'][key]) {
                renderChartData(charts['live'][key], [msg]);
            }
            updateKPI(key, msg);
        });
    }

    // FSM state
    socket.on('state_changed', (msg) => {
        const statusEl = document.getElementById('system-status');
        if (statusEl && msg.state) {
            statusEl.textContent = msg.state;
            statusEl.className = 'status-value ' + msg.state;
        }
    });

    // Server clock
    socket.on('server_time', (msg) => {
        const el = document.getElementById('server-clock');
        if (el && msg.time) el.textContent = msg.time;
    });

    // Pump status
    socket.on('pump_status', (msg) => {
        updatePumpStatus(msg);
    });
}

/* Fetch system status on first load for pump bar + next irrigation */
function initSystemInfo() {
    loadSystemStatus();
    // Refresh system info every 60s
    setInterval(() => {
        const settingsTab = document.getElementById('tab-settings');
        if (settingsTab && settingsTab.classList.contains('active')) {
            loadSystemStatus();
        }
    }, 60000);
}

/* ================================================================
 *  KPI UPDATES
 * ================================================================ */

function updateKPI(key, msg) {
    if (!KPI_SENSORS.includes(key)) return;
    const state = kpiState[key];
    state.prev = state.current;
    state.current = msg.value;
    state.history.push({ value: msg.value, ts: msg.ts });

    // Keep only last 60 min
    const cutoff = Date.now() - 3600000;
    state.history = state.history.filter(h => h.ts > cutoff);

    const valEl = document.getElementById(`kpi-${key}-value`);
    const trendEl = document.getElementById(`kpi-${key}-trend`);
    const rangeEl = document.getElementById(`kpi-${key}-range`);

    if (!valEl) return;

    const card = document.getElementById(`kpi-${key}`);

    if (key === 'level') {
        valEl.textContent = state.current >= 1 ? 'OK' : 'LOW';
        valEl.className = 'kpi-value ' + (state.current >= 1 ? 'kpi-ok' : 'kpi-low');
        if (trendEl) trendEl.textContent = '';
        if (rangeEl) rangeEl.textContent = '';
        // Alert for low water
        if (card) card.classList.toggle('kpi-alert', state.current < 1);
    } else {
        valEl.textContent = state.current.toFixed(2);
        if (trendEl && state.prev !== null) {
            const diff = state.current - state.prev;
            trendEl.textContent = diff > 0.01 ? '\u25b2' : (diff < -0.01 ? '\u25bc' : '\u25cf');
            trendEl.className = 'kpi-trend ' + (diff > 0.01 ? 'trend-up' : (diff < -0.01 ? 'trend-down' : 'trend-stable'));
        }
        if (rangeEl && state.history.length > 0) {
            const vals = state.history.map(h => h.value);
            rangeEl.textContent = `min ${Math.min(...vals).toFixed(1)} / max ${Math.max(...vals).toFixed(1)}`;
        }
        // Alert if out of range
        const alert = KPI_ALERTS[key];
        if (card && alert) {
            const outOfRange = state.current < alert.min || state.current > alert.max;
            card.classList.toggle('kpi-alert', outOfRange);
        }
    }
}

/* ================================================================
 *  CHART RENDERING
 * ================================================================ */

async function listSamples(resource, start, aggr_window) {
    try {
        const response = await fetch(`http://${window.location.host}/get_samples/${resource}/${start}/${aggr_window}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data.error) { console.log(`Samples error ${resource}: ${data.error}`); return null; }
        return data;
    } catch (error) {
        console.log(`Fetch error ${resource}: ${error.message}`);
        return null;
    }
}

function renderChartData(obj, messages, maxPoints, showMinutes, showSeconds) {
    if (!obj || !obj.canvas) return;
    maxPoints = maxPoints || 20;
    if (!messages || messages.length === 0) return;

    const noDataDiv = document.getElementById(obj.canvas.id + '-nodata');
    const liveCircle = document.getElementById('live-circle');
    const isLive = obj.canvas.id.endsWith('-live-chart');

    // Reset data for historical tabs
    if (!isLive) {
        obj.data.labels = [];
        obj.data.datasets[0].data = [];
    }

    for (const message of messages) {
        if (message.ts === undefined) continue;

        let dateStr;
        const date = new Date(message.ts);
        if (showMinutes && showSeconds) {
            dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } else if (showMinutes) {
            dateStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            dateStr = date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit' });
        }

        obj.data.labels.push(dateStr);
        obj.data.datasets[0].data.push(message.value);

        if (obj.data.labels.length > maxPoints) {
            obj.data.labels.shift();
            obj.data.datasets[0].data.shift();
        }
    }

    const hasData = obj.data.labels.length > 0;

    if (!hasData) {
        if (obj.canvas) obj.canvas.style.display = 'none';
        if (noDataDiv) noDataDiv.style.display = 'flex';
        if (isLive && liveCircle) { liveCircle.style.display = 'none'; liveCircle.classList.remove('flash'); }
        if (obj.chart) { obj.chart.destroy(); obj.chart = null; }
    } else {
        if (obj.canvas) obj.canvas.style.display = 'block';
        if (noDataDiv) noDataDiv.style.display = 'none';

        if (isLive && liveCircle) {
            liveCircle.style.display = 'flex';
            liveCircle.classList.add('flash');
            if (liveCircleTimeout) clearTimeout(liveCircleTimeout);
            liveCircleTimeout = setTimeout(() => {
                liveCircle.classList.remove('flash');
                liveCircle.style.display = 'none';
            }, noDataTimeout);
        }

        if (!obj.chart) {
            obj.chart = newChart(obj.canvas.getContext('2d'), obj, obj.sensorKey);
        } else {
            obj.chart.update();
        }
    }
}

function newChart(ctx, obj, sensorKey) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const tickColor = isDark ? '#8899a6' : '#666';

    const opts = {
        responsive: true,
        animation: false,
        scales: {
            y: { grid: { color: gridColor }, ticks: { color: tickColor } },
            x: { grid: { display: false }, ticks: { maxRotation: 45, minRotation: 45, color: tickColor } },
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
            legend: { display: false },
            tooltip: {
                displayColors: false,
                callbacks: {
                    title: () => '',
                    label: (context) => `${context.label} \u2014 ${context.parsed.y.toFixed(2)} ${obj.unit || ''}`,
                },
            },
        },
    };

    // Range band annotation
    const band = RANGE_BANDS[sensorKey];
    if (band) {
        opts.plugins.annotation = {
            annotations: {
                optimalBand: {
                    type: 'box',
                    yMin: band.min,
                    yMax: band.max,
                    backgroundColor: band.color,
                    borderWidth: 0,
                },
            },
        };
    }

    return new Chart(ctx, { type: 'line', data: obj.data, options: opts });
}

function newChartData(borderColor, backgroundColor) {
    return {
        labels: [],
        datasets: [{
            data: [],
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            fill: true,
        }],
    };
}

/* ================================================================
 *  SETTINGS / SYSTEM TAB
 * ================================================================ */

function buildSettingsHTML() {
    return `
        <div class="sysinfo-grid" id="sysinfo-grid">
            <div class="sysinfo-item"><span class="sysinfo-label">Uptime</span><span class="sysinfo-value" id="sys-uptime">--</span></div>
            <div class="sysinfo-item"><span class="sysinfo-label">Stato FSM</span><span class="sysinfo-value" id="sys-state">--</span></div>
            <div class="sysinfo-item"><span class="sysinfo-label">In stato da</span><span class="sysinfo-value" id="sys-state-elapsed">--</span></div>
            <div class="sysinfo-item"><span class="sysinfo-label">Prossima irrigazione</span><span class="sysinfo-value" id="sys-next-irrig">--</span></div>
            <div class="sysinfo-item"><span class="sysinfo-label">Intervallo sensori</span><span class="sysinfo-value" id="sys-interval">--</span></div>
            <div class="sysinfo-item"><span class="sysinfo-label">Connessione</span><span class="sysinfo-value" id="sys-conn" style="color:#2ecc71">OK</span></div>
        </div>

        <div class="settings-grid">
            <div class="settings-section">
                <h3>Soglie pH / EC</h3>
                <div class="setting-row"><label>pH min</label><input type="number" step="0.1" id="cfg-ph-min" value="5.5"></div>
                <div class="setting-row"><label>pH max</label><input type="number" step="0.1" id="cfg-ph-max" value="6.5"></div>
                <div class="setting-row"><label>EC min (mS/cm)</label><input type="number" step="0.1" id="cfg-ec-min" value="1.0"></div>
                <div class="setting-row"><label>EC max (mS/cm)</label><input type="number" step="0.1" id="cfg-ec-max" value="2.0"></div>
                <div class="setting-row"><label>Intervallo sensori (s)</label><input type="number" step="1" id="cfg-interval" value="30"></div>
                <button class="btn btn-save" onclick="saveConfig()">Salva configurazione</button>
            </div>

            <div class="settings-section">
                <h3>Schedule irrigazione</h3>
                <div class="schedule-hours" id="schedule-hours"></div>
            </div>
        </div>`;
}

async function loadSystemStatus() {
    try {
        const resp = await fetch(`http://${window.location.host}/api/system_status`);
        if (!resp.ok) return;
        const data = await resp.json();

        const el = (id) => document.getElementById(id);

        // Uptime
        const hrs = Math.floor(data.uptime_sec / 3600);
        const mins = Math.floor((data.uptime_sec % 3600) / 60);
        if (el('sys-uptime')) el('sys-uptime').textContent = `${hrs}h ${mins}m`;
        if (el('sys-state')) el('sys-state').textContent = data.state;
        if (el('sys-state-elapsed')) {
            const eSec = data.state_elapsed_sec;
            el('sys-state-elapsed').textContent = eSec > 60 ? `${Math.floor(eSec / 60)}m ${eSec % 60}s` : `${eSec}s`;
        }
        if (el('sys-next-irrig')) el('sys-next-irrig').textContent = data.next_irrigation;
        if (el('sys-interval')) el('sys-interval').textContent = `${data.sensor_interval}s`;

        // Update next irrigation badge in pump bar
        if (el('next-irrig-text')) el('next-irrig-text').textContent = data.next_irrigation;

        // Thresholds
        if (data.thresholds) {
            if (el('cfg-ph-min')) el('cfg-ph-min').value = data.thresholds.ph_min;
            if (el('cfg-ph-max')) el('cfg-ph-max').value = data.thresholds.ph_max;
            if (el('cfg-ec-min')) el('cfg-ec-min').value = data.thresholds.ec_min;
            if (el('cfg-ec-max')) el('cfg-ec-max').value = data.thresholds.ec_max;
            // Update alert thresholds
            KPI_ALERTS.ph.min = data.thresholds.ph_min;
            KPI_ALERTS.ph.max = data.thresholds.ph_max;
            KPI_ALERTS.ec.min = data.thresholds.ec_min;
            KPI_ALERTS.ec.max = data.thresholds.ec_max;
        }
        if (el('cfg-interval')) el('cfg-interval').value = data.sensor_interval;

        // Schedule hours visualization
        const container = el('schedule-hours');
        if (container && data.watering_hours) {
            container.innerHTML = '';
            for (let h = 0; h < 24; h++) {
                const chip = document.createElement('div');
                chip.className = 'hour-chip';
                chip.textContent = h;
                if (data.watering_hours.includes(h)) chip.classList.add('hour-active');
                container.appendChild(chip);
            }
        }
    } catch (e) {
        console.log('System status fetch error:', e.message);
    }
}

async function saveConfig() {
    const el = (id) => document.getElementById(id);
    const params = new URLSearchParams({
        ph_min: el('cfg-ph-min')?.value || '',
        ph_max: el('cfg-ph-max')?.value || '',
        ec_min: el('cfg-ec-min')?.value || '',
        ec_max: el('cfg-ec-max')?.value || '',
        sensor_interval: el('cfg-interval')?.value || '',
    });
    try {
        const resp = await fetch(`http://${window.location.host}/api/config/update?${params}`);
        const data = await resp.json();
        if (data.status === 'ok') {
            alert('Configurazione salvata!');
            loadSystemStatus();
        } else {
            alert('Errore: ' + (data.message || 'sconosciuto'));
        }
    } catch (e) {
        alert('Errore di connessione: ' + e.message);
    }
}

/* ================================================================
 *  PUMP STATUS
 * ================================================================ */

function updatePumpStatus(status) {
    PUMP_NAMES.forEach(name => {
        const el = document.getElementById(`pump-${name}`);
        if (el) {
            if (status[name]) {
                el.classList.add('active');
            } else {
                el.classList.remove('active');
            }
        }
    });
}

/* ================================================================
 *  COMMANDS
 * ================================================================ */

async function sendCommand(cmd) {
    try {
        const response = await fetch(`http://${window.location.host}/api/command/${cmd}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log('Command OK:', cmd, data);
    } catch (error) {
        console.error('Command failed:', cmd, error);
        alert('Comando fallito: ' + error.message);
    }
}

/* ================================================================
 *  THEME
 * ================================================================ */

function initTheme() {
    const saved = localStorage.getItem('hydro-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateToggleIcon(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('hydro-theme', next);
    updateToggleIcon(next);
    applyChartTheme();
}

function updateToggleIcon(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '\u2600\ufe0f' : '\ud83c\udf19';
}

function applyChartTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
    const tickColor = isDark ? '#8899a6' : '#666';

    Chart.defaults.color = tickColor;
    Chart.defaults.borderColor = gridColor;

    // Update all existing charts
    for (const tabId of Object.keys(charts)) {
        for (const key of Object.keys(charts[tabId])) {
            const c = charts[tabId][key].chart;
            if (c) {
                c.options.scales.y.grid.color = gridColor;
                c.options.scales.y.ticks.color = tickColor;
                c.options.scales.x.ticks.color = tickColor;
                c.update();
            }
        }
    }
}

/* ================================================================
 *  HELPERS
 * ================================================================ */

function fmtTs(ts) {
    const d = new Date(ts);
    return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
