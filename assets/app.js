const socket = io(`http://${window.location.host}`);

// Live charts
const tempLive = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };     // temp_c
const ecLive = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' }; // ec_ms
const phLive = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };      // ph_value
const phmvLive = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };    // ph_mv
const levelLive = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };      // float_ok

// Storico 1h
const temp1h = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec1h = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph1h = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv1h = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level1h = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

// Storico 1d
const temp1d = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec1d = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph1d = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv1d = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level1d = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

// Storico 7d
const temp7d = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec7d = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph7d = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv7d = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level7d = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

// Storico 14d
const temp14d = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec14d = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph14d = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv14d = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level14d = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

// Storico 1m
const temp1m = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec1m = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph1m = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv1m = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level1m = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

// Storico 1y
const temp1y = { canvas: null, chart: null, data: newChartData('orange', 'rgba(255,165,0,0.1)'), unit: '°C' };
const ec1y = { canvas: null, chart: null, data: newChartData('teal', 'rgba(0,128,128,0.08)'), unit: 'mS/cm' };
const ph1y = { canvas: null, chart: null, data: newChartData('green', 'rgba(0,128,0,0.08)'), unit: '' };
const phmv1y = { canvas: null, chart: null, data: newChartData('red', 'rgba(255,0,0,0.08)'), unit: 'mV' };
const level1y = { canvas: null, chart: null, data: newChartData('purple', 'rgba(128,0,128,0.06)'), unit: '' };

let liveCircleTimeout = null;
const noDataTimeout = 10000;
let errorContainer;

document.addEventListener('DOMContentLoaded', () => {
    // Mappa i canvas esistenti

    // Live
    tempLive.canvas = document.getElementById('temperature-live-chart');
    ecLive.canvas = document.getElementById('humidity-live-chart');
    phLive.canvas = document.getElementById('dew_point-live-chart');
    phmvLive.canvas = document.getElementById('heat_index-live-chart');
    levelLive.canvas = document.getElementById('absolute_humidity-live-chart');

    // 1h
    temp1h.canvas = document.getElementById('temperature-1h-chart');
    ec1h.canvas = document.getElementById('humidity-1h-chart');
    ph1h.canvas = document.getElementById('dew_point-1h-chart');
    phmv1h.canvas = document.getElementById('heat_index-1h-chart');
    level1h.canvas = document.getElementById('absolute_humidity-1h-chart');

    // 1d
    temp1d.canvas = document.getElementById('temperature-1d-chart');
    ec1d.canvas = document.getElementById('humidity-1d-chart');
    ph1d.canvas = document.getElementById('dew_point-1d-chart');
    phmv1d.canvas = document.getElementById('heat_index-1d-chart');
    level1d.canvas = document.getElementById('absolute_humidity-1d-chart');

    // 7d
    temp7d.canvas = document.getElementById('temperature-7d-chart');
    ec7d.canvas = document.getElementById('humidity-7d-chart');
    ph7d.canvas = document.getElementById('dew_point-7d-chart');
    phmv7d.canvas = document.getElementById('heat_index-7d-chart');
    level7d.canvas = document.getElementById('absolute_humidity-7d-chart');

    // 14d
    temp14d.canvas = document.getElementById('temperature-14d-chart');
    ec14d.canvas = document.getElementById('humidity-14d-chart');
    ph14d.canvas = document.getElementById('dew_point-14d-chart');
    phmv14d.canvas = document.getElementById('heat_index-14d-chart');
    level14d.canvas = document.getElementById('absolute_humidity-14d-chart');

    // 1m
    temp1m.canvas = document.getElementById('temperature-1m-chart');
    ec1m.canvas = document.getElementById('humidity-1m-chart');
    ph1m.canvas = document.getElementById('dew_point-1m-chart');
    phmv1m.canvas = document.getElementById('heat_index-1m-chart');
    level1m.canvas = document.getElementById('absolute_humidity-1m-chart');

    // 1y
    temp1y.canvas = document.getElementById('temperature-1y-chart');
    ec1y.canvas = document.getElementById('humidity-1y-chart');
    ph1y.canvas = document.getElementById('dew_point-1y-chart');
    phmv1y.canvas = document.getElementById('heat_index-1y-chart');
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

    // Storico 1h
    const tab1h = document.querySelector('.tab[data-tab="historical-1h"]');
    if (tab1h) {
        tab1h.addEventListener('click', async () => {
            renderChartData(temp1h, await listSamples("temp_c", "-1h", "5m"), 12, true, true);
            renderChartData(ec1h, await listSamples("ec_ms", "-1h", "5m"), 12, true, true);
            renderChartData(ph1h, await listSamples("ph_value", "-1h", "5m"), 12, true, true);
            renderChartData(phmv1h, await listSamples("ph_mv", "-1h", "5m"), 12, true, true);
            renderChartData(level1h, await listSamples("float_ok", "-1h", "5m"), 12, true, true);
        });
    }

    // Storico 1d
    const tab1d = document.querySelector('.tab[data-tab="historical-1d"]');
    if (tab1d) {
        tab1d.addEventListener('click', async () => {
            renderChartData(temp1d, await listSamples("temp_c", "-1d", "1h"), 24, true, false);
            renderChartData(ec1d, await listSamples("ec_ms", "-1d", "1h"), 24, true, false);
            renderChartData(ph1d, await listSamples("ph_value", "-1d", "1h"), 24, true, false);
            renderChartData(phmv1d, await listSamples("ph_mv", "-1d", "1h"), 24, true, false);
            renderChartData(level1d, await listSamples("float_ok", "-1d", "1h"), 24, true, false);
        });
    }

    // Storico 7d
    const tab7d = document.querySelector('.tab[data-tab="historical-7d"]');
    if (tab7d) {
        tab7d.addEventListener('click', async () => {
            renderChartData(temp7d, await listSamples("temp_c", "-7d", "1h"), 200, false, false);
            renderChartData(ec7d, await listSamples("ec_ms", "-7d", "1h"), 200, false, false);
            renderChartData(ph7d, await listSamples("ph_value", "-7d", "1h"), 200, false, false);
            renderChartData(phmv7d, await listSamples("ph_mv", "-7d", "1h"), 200, false, false);
            renderChartData(level7d, await listSamples("float_ok", "-7d", "1h"), 200, false, false);
        });
    }

    // Storico 14d
    const tab14d = document.querySelector('.tab[data-tab="historical-14d"]');
    if (tab14d) {
        tab14d.addEventListener('click', async () => {
            renderChartData(temp14d, await listSamples("temp_c", "-14d", "2h"), 200, false, false);
            renderChartData(ec14d, await listSamples("ec_ms", "-14d", "2h"), 200, false, false);
            renderChartData(ph14d, await listSamples("ph_value", "-14d", "2h"), 200, false, false);
            renderChartData(phmv14d, await listSamples("ph_mv", "-14d", "2h"), 200, false, false);
            renderChartData(level14d, await listSamples("float_ok", "-14d", "2h"), 200, false, false);
        });
    }

    // Storico 1m (~30d)
    const tab1m = document.querySelector('.tab[data-tab="historical-1m"]');
    if (tab1m) {
        tab1m.addEventListener('click', async () => {
            renderChartData(temp1m, await listSamples("temp_c", "-30d", "6h"), 200, false, false);
            renderChartData(ec1m, await listSamples("ec_ms", "-30d", "6h"), 200, false, false);
            renderChartData(ph1m, await listSamples("ph_value", "-30d", "6h"), 200, false, false);
            renderChartData(phmv1m, await listSamples("ph_mv", "-30d", "6h"), 200, false, false);
            renderChartData(level1m, await listSamples("float_ok", "-30d", "6h"), 200, false, false);
        });
    }

    // Storico 1y
    const tab1y = document.querySelector('.tab[data-tab="historical-1y"]');
    if (tab1y) {
        tab1y.addEventListener('click', async () => {
            renderChartData(temp1y, await listSamples("temp_c", "-365d", "1d"), 400, false, false);
            renderChartData(ec1y, await listSamples("ec_ms", "-365d", "1d"), 400, false, false);
            renderChartData(ph1y, await listSamples("ph_value", "-365d", "1d"), 400, false, false);
            renderChartData(phmv1y, await listSamples("ph_mv", "-365d", "1d"), 400, false, false);
            renderChartData(level1y, await listSamples("float_ok", "-365d", "1d"), 400, false, false);
        });
    }

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
            errorContainer.textContent = 'Connection to the board lost. Please check the connection.';
            errorContainer.style.display = 'block';
        }
    });

    // Canali live esattamente come in Python
    socket.on('temp_c', (message) => renderChartData(tempLive, [message]));
    socket.on('ec_ms', (message) => renderChartData(ecLive, [message]));
    socket.on('ph_value', (message) => renderChartData(phLive, [message]));
    socket.on('ph_mv', (message) => renderChartData(phmvLive, [message]));
    socket.on('float_ok', (message) => renderChartData(levelLive, [message]));

    // NEW: Listen for status updates
    socket.on('state_changed', (message) => {
        const statusEl = document.getElementById('system-status');
        if (statusEl && message.state) {
            statusEl.textContent = message.state;
            // Optional: change color based on state
            statusEl.className = 'status-value ' + message.state;
        }
    });
}

// NEW: Send commands to the board
async function sendCommand(cmd) {
    try {
        console.log(`Sending command: ${cmd}`);
        const response = await fetch(`http://${window.location.host}/api/command/${cmd}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();
        console.log("Command result:", data);
    } catch (error) {
        console.error("Command failed:", error);
        alert("Command failed: " + error.message);
    }
}

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
            // solo ora (per range lunghi)
            date = date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit' });
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
                y: {},
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                }
            },
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    displayColors: false,
                    callbacks: {
                        title: () => '',
                        label: function (context) {
                            const unit = context.chart && context.chart.options && context.chart.options._unit
                                ? context.chart.options._unit
                                : (obj.unit || '');
                            if (!context.chart.options._unit) context.chart.options._unit = obj.unit;
                            return `${context.label} - ${context.parsed.y.toFixed(2)} ${unit}`;
                        }
                    }
                },
                noDataMessage: true
            }
        }
    });
}

function newChartData(borderColor, backgroundColor) {
    return {
        labels: [],
        datasets: [{
            data: [],
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            fill: true,
        }]
    };
}