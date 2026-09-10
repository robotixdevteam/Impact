/**
 * AI Impact Kit — Data Science / Prediction Module
 * Handles live collection, polling, chart rendering, prediction overlay,
 * mode switching (forecast / compare), and custom model parameters.
 */

// ─── State ────────────────────────────────────────────────────────
let predSessionId = null;
let predPollingInterval = null;
let predChartInstance = null;
let predStartTime = null;
let predDurationSec = 300;
let predMode = 'forecast';       // 'forecast' or 'compare'
let predParamMode = 'default';   // 'default' or 'custom'
let compareTrainSamples = 0;     // Set after session starts
let predOverlaid = false;        // Guard: prevents duplicate overlay calls

// ─── Populate Sensor Dropdown ────────────────────────────────────
function populatePredictionSensorDropdown() {
    const select = document.getElementById('predSensor');
    select.innerHTML = '';
    for (const [key, info] of Object.entries(sensorRegistry)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${info.name} (${info.unit})`;
        select.appendChild(opt);
    }
}

// ─── Mode Toggle ─────────────────────────────────────────────────
function setPredMode(mode) {
    predMode = mode;
    // Update toggle UI
    document.querySelectorAll('.mode-toggle-card').forEach(card => {
        card.classList.toggle('active', card.dataset.mode === mode);
    });
    // Show/hide training split slider
    const splitCtrl = document.getElementById('trainSplitControl');
    if (mode === 'compare') {
        splitCtrl.classList.remove('hidden');
    } else {
        splitCtrl.classList.add('hidden');
    }
}

// ─── Parameter Mode Toggle ───────────────────────────────────────
function setParamMode(mode) {
    predParamMode = mode;
    document.getElementById('paramDefault').classList.toggle('active', mode === 'default');
    document.getElementById('paramCustom').classList.toggle('active', mode === 'custom');

    const panel = document.getElementById('paramsPanel');
    if (mode === 'custom') {
        buildParamInputs();
        panel.classList.add('open');
    } else {
        panel.classList.remove('open');
    }
}

// ─── Dynamic Parameter Inputs ────────────────────────────────────
function onModelChange() {
    // Rebuild param inputs if in custom mode
    if (predParamMode === 'custom') {
        buildParamInputs();
    }
}

function buildParamInputs() {
    const model = document.getElementById('predModel').value;
    const container = document.getElementById('paramFields');

    const PARAM_DEFS = {
        arima: [
            { key: 'p', label: 'p (AR order)', default: 1, min: 0, max: 10 },
            { key: 'd', label: 'd (Differencing)', default: 1, min: 0, max: 3 },
            { key: 'q', label: 'q (MA order)', default: 0, min: 0, max: 10 },
        ],
        sarima: [
            { key: 'p', label: 'p (AR order)', default: 1, min: 0, max: 10 },
            { key: 'd', label: 'd (Differencing)', default: 1, min: 0, max: 3 },
            { key: 'q', label: 'q (MA order)', default: 1, min: 0, max: 10 },
            { key: 'P', label: 'P (Seasonal AR)', default: 1, min: 0, max: 5 },
            { key: 'D', label: 'D (Seasonal Diff)', default: 0, min: 0, max: 2 },
            { key: 'Q', label: 'Q (Seasonal MA)', default: 1, min: 0, max: 5 },
            { key: 'seasonal_period', label: 'Seasonal Period', default: 12, min: 2, max: 52 },
        ],
        lstm: [
            { key: 'epochs', label: 'Epochs', default: 30, min: 5, max: 200 },
            { key: 'units', label: 'LSTM Units', default: 32, min: 4, max: 256 },
            { key: 'look_back', label: 'Look-Back Window', default: 10, min: 2, max: 50 },
            { key: 'learning_rate', label: 'Learning Rate', default: 0.01, min: 0.0001, max: 0.1, step: 0.001 },
            { key: 'batch_size', label: 'Batch Size', default: 16, min: 1, max: 128 },
        ],
        auto: null,
    };

    const params = PARAM_DEFS[model];

    if (!params) {
        container.innerHTML = `
            <div class="params-note">
                <span>💡</span>
                <span>Auto mode uses optimized default parameters for each model and selects the best one automatically. Custom parameters are not available in Auto mode.</span>
            </div>
        `;
        return;
    }

    let html = '<div class="params-grid">';
    for (const p of params) {
        const step = p.step || (p.key === 'learning_rate' ? 0.001 : 1);
        html += `
            <div class="control-group">
                <label>${p.label}</label>
                <input type="number" id="param_${p.key}" value="${p.default}"
                       min="${p.min}" max="${p.max}" step="${step}">
            </div>
        `;
    }
    html += '</div>';
    container.innerHTML = html;
}

function getCustomParams() {
    if (predParamMode === 'default') return null;

    const model = document.getElementById('predModel').value;
    if (model === 'auto') return null;

    const params = {};
    const inputs = document.querySelectorAll('#paramFields input[type="number"]');
    inputs.forEach(input => {
        const key = input.id.replace('param_', '');
        params[key] = parseFloat(input.value);
    });
    return Object.keys(params).length > 0 ? params : null;
}

// ─── Start Prediction ────────────────────────────────────────────
async function startPrediction() {
    const sensor = document.getElementById('predSensor').value;
    const model = document.getElementById('predModel').value;
    const durationMin = parseFloat(document.getElementById('predDuration').value);
    // User requested: "irrespective of data collection time i want predicted line for 1 min"
    // So we force forecastSteps to 60 (1 minute) for forecast mode. (Compare mode ignores this anyway).
    const forecastSteps = 60;
    const compareTrainPct = predMode === 'compare'
        ? parseInt(document.getElementById('trainSplitSlider').value) / 100
        : 0.5;

    predDurationSec = durationMin * 60;

    const body = {
        sensor,
        duration_min: durationMin,
        interval_sec: 1.0,
        model,
        forecast_steps: forecastSteps,
        mode: predMode,
        params: getCustomParams(),
        compare_train_pct: compareTrainPct,
    };

    try {
        const res = await fetch(`${API_BASE}/api/predict/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();
        predSessionId = data.session_id;
        predStartTime = Date.now();
        compareTrainSamples = data.train_samples || 0;

        // UI updates
        document.getElementById('btnStartPred').classList.add('hidden');
        document.getElementById('btnCancelPred').classList.remove('hidden');
        document.getElementById('predProgress').classList.remove('hidden');
        document.getElementById('predPlaceholder').style.display = 'none';
        document.getElementById('predChart').style.display = 'block';
        document.getElementById('modelInfoCard').classList.add('hidden');

        // Show phase badge for compare mode
        const phaseBadge = document.getElementById('phaseBadge');
        if (predMode === 'compare') {
            phaseBadge.className = 'phase-badge training';
            phaseBadge.innerHTML = '<span class="phase-badge-dot"></span> Training Phase';
        } else {
            phaseBadge.className = 'hidden';
        }

        // Reset overlay guard
        predOverlaid = false;

        // Destroy old chart
        if (predChartInstance) {
            predChartInstance.destroy();
            predChartInstance = null;
        }

        // Initialize live chart
        const sensorName = sensorRegistry[sensor]?.name || sensor;
        const unit = sensorRegistry[sensor]?.unit || '';
        if (predMode === 'compare') {
            initCompareChart(sensorName, unit);
        } else {
            initPredChart(sensorName, unit);
        }

        // Start polling
        predPollingInterval = setInterval(pollPredictionStatus, 2000);
        updatePredTimer();

    } catch (e) {
        console.error('Failed to start prediction:', e);
        alert('Failed to start prediction: ' + e.message);
    }
}

// ─── Poll Status ─────────────────────────────────────────────────
async function pollPredictionStatus() {
    if (!predSessionId) return;

    try {
        const res = await fetch(`${API_BASE}/api/predict/status/${predSessionId}`);
        const data = await res.json();

        // Update progress
        document.getElementById('predProgressBar').style.width = `${data.progress}%`;
        document.getElementById('predStatusText').textContent =
            `Collecting... ${data.collected_count}/${data.total_samples} samples (${data.progress}%)`;

        // ─── Compare Mode ────────────────────────────────────────
        if (predMode === 'compare') {
            // Update phase badge
            const phaseBadge = document.getElementById('phaseBadge');
            if (data.compare_phase === 'comparing') {
                phaseBadge.className = 'phase-badge comparing';
                phaseBadge.innerHTML = '<span class="phase-badge-dot"></span> Comparing Live vs Predicted';
            } else if (data.compare_phase === 'training') {
                phaseBadge.className = 'phase-badge training';
                phaseBadge.innerHTML = '<span class="phase-badge-dot"></span> Training Phase';
            }

            // Update chart with live + predicted data
            if (data.data && data.data.length > 0) {
                updateCompareChartData(data.data, data.compare_data);
            }

            // On completion
            if (data.status === 'complete') {
                clearInterval(predPollingInterval);
                predPollingInterval = null;

                document.getElementById('predStatusText').textContent = 'Comparison complete!';

                if (data.compare_data) {
                    showModelInfo({
                        model_name: data.compare_data.model_name,
                        metrics: data.compare_data.metrics,
                        predictions: data.compare_data.all_predictions,
                    });
                }
                resetPredUI();
            }

        // ─── Forecast Mode ───────────────────────────────────────
        } else {
            // Update live chart with collected data (skip if prediction already overlaid)
            if (data.data && data.data.length > 0 && !predOverlaid) {
                updatePredChartData(data.data);
            }

            // If complete, show prediction (guard against duplicate calls)
            if (data.status === 'complete' && !predOverlaid) {
                predOverlaid = true;
                clearInterval(predPollingInterval);
                predPollingInterval = null;

                document.getElementById('predStatusText').textContent = 'Collection complete! Running prediction model...';

                // Fetch full result
                const resultRes = await fetch(`${API_BASE}/api/predict/result/${predSessionId}`);
                const result = await resultRes.json();

                if (result.prediction && !result.prediction.error) {
                    overlayPrediction(result.collected_data, result.prediction);
                    showModelInfo(result.prediction);
                } else {
                    document.getElementById('predStatusText').textContent =
                        'Prediction error: ' + (result.prediction?.error || 'Unknown error');
                }

                resetPredUI();
            }
        }

        // Handle errors / cancellation
        if (data.status === 'error' || data.status === 'cancelled') {
            clearInterval(predPollingInterval);
            predPollingInterval = null;
            document.getElementById('predStatusText').textContent = `Status: ${data.status}`;
            resetPredUI();
        }

    } catch (e) {
        console.error('Polling error:', e);
    }
}

// ─── Cancel Prediction ───────────────────────────────────────────
async function cancelPrediction() {
    if (!predSessionId) return;

    try {
        await fetch(`${API_BASE}/api/predict/cancel/${predSessionId}`, { method: 'DELETE' });
    } catch (e) {
        console.error('Cancel error:', e);
    }

    clearInterval(predPollingInterval);
    predPollingInterval = null;
    resetPredUI();
}

function resetPredUI() {
    document.getElementById('btnStartPred').classList.remove('hidden');
    document.getElementById('btnCancelPred').classList.add('hidden');
    document.getElementById('predProgress').classList.add('hidden');
    document.getElementById('phaseBadge').className = 'hidden';
}

// ─── Timer Display ───────────────────────────────────────────────
function updatePredTimer() {
    const timerEl = document.getElementById('predTimer');
    const totalMins = Math.floor(predDurationSec / 60);
    const totalSecs = predDurationSec % 60;
    const totalStr = `${String(totalMins).padStart(2, '0')}:${String(totalSecs).padStart(2, '0')}`;

    function tick() {
        if (!predSessionId) return;
        const elapsed = Math.floor((Date.now() - predStartTime) / 1000);
        const elapsedMins = Math.floor(elapsed / 60);
        const elapsedSecs = elapsed % 60;
        timerEl.textContent = `${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')} / ${totalStr}`;

        if (elapsed < predDurationSec && predSessionId) {
            requestAnimationFrame(() => setTimeout(tick, 1000));
        }
    }
    tick();
}

// ═══════════════════════════════════════════════════════════════════
// FORECAST MODE — Chart Functions (existing behavior)
// ═══════════════════════════════════════════════════════════════════

function initPredChart(sensorName, unit) {
    const canvas = document.getElementById('predChart');

    predChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: `${sensorName} (Live)`,
                    data: [],
                    borderColor: 'rgba(34, 211, 238, 1)',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    fill: true,
                    tension: 0.3,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                title: {
                    display: true,
                    text: `Live Sensor Data — ${sensorName}`,
                    color: '#e5e7eb',
                    font: { size: 15, weight: 600 },
                },
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 16,
                        filter: (item) => !item.text.startsWith('_'),
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(11, 18, 32, 0.95)',
                    titleColor: '#22d3ee',
                    bodyColor: '#e5e7eb',
                    borderColor: 'rgba(34, 211, 238, 0.2)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                },
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        maxTicksLimit: 15,
                        maxRotation: 0,
                    },
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    title: {
                        display: true,
                        text: unit,
                        color: '#64748b',
                    },
                },
            },
        },
    });
}

function updatePredChartData(dataPoints) {
    if (!predChartInstance) return;

    const labels = dataPoints.map(d => {
        const t = new Date(d.timestamp);
        return `${t.getMinutes()}:${String(t.getSeconds()).padStart(2, '0')}`;
    });
    const values = dataPoints.map(d => d.value);

    predChartInstance.data.labels = labels;
    predChartInstance.data.datasets[0].data = values;
    predChartInstance.update('none');
}

function overlayPrediction(collectedData, prediction) {
    if (!predChartInstance) return;

    // Remove any previously added prediction datasets (keep only the first — live data)
    predChartInstance.data.datasets.length = 1;

    // Extend labels for predicted points
    const lastTime = new Date(collectedData[collectedData.length - 1]?.timestamp || Date.now());
    const predLabels = prediction.predictions.map((_, i) => {
        const t = new Date(lastTime.getTime() + (i + 1) * 1000);
        return `${t.getMinutes()}:${String(t.getSeconds()).padStart(2, '0')}`;
    });

    // Combine labels
    const existingLabels = predChartInstance.data.labels;
    const allLabels = [...existingLabels, ...predLabels];

    // Actual data padded with nulls for prediction zone
    const actualData = [...predChartInstance.data.datasets[0].data, ...new Array(prediction.predictions.length).fill(null)];

    // Prediction data padded with nulls for actual zone (connect at boundary)
    const lastActualValue = predChartInstance.data.datasets[0].data[predChartInstance.data.datasets[0].data.length - 1];
    const predData = [
        ...new Array(existingLabels.length - 1).fill(null),
        lastActualValue,
        ...prediction.predictions,
    ];

    // Confidence interval
    const lowerCI = [
        ...new Array(existingLabels.length - 1).fill(null),
        lastActualValue,
        ...prediction.lower_ci,
    ];
    const upperCI = [
        ...new Array(existingLabels.length - 1).fill(null),
        lastActualValue,
        ...prediction.upper_ci,
    ];

    predChartInstance.data.labels = allLabels;
    predChartInstance.data.datasets[0].data = actualData;

    // Add prediction dataset
    predChartInstance.data.datasets.push({
        label: `Predicted (${prediction.model_name})`,
        data: predData,
        borderColor: 'rgba(245, 158, 11, 1)',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.3,
        spanGaps: true,
    });

    // Add confidence interval as a filled area
    predChartInstance.data.datasets.push({
        label: 'Confidence Interval (95%)',
        data: upperCI,
        borderColor: 'transparent',
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderWidth: 0,
        pointRadius: 0,
        fill: '+1',
        tension: 0.3,
        spanGaps: true,
    });
    predChartInstance.data.datasets.push({
        label: '_lower_ci',
        data: lowerCI,
        borderColor: 'transparent',
        backgroundColor: 'transparent',
        borderWidth: 0,
        pointRadius: 0,
        fill: false,
        tension: 0.3,
        spanGaps: true,
    });

    // Legend filter is already set at chart init time to hide '_' prefixed entries

    predChartInstance.options.plugins.title.text = `Prediction Complete — ${prediction.model_name}`;
    predChartInstance.update();
}

// ═══════════════════════════════════════════════════════════════════
// COMPARE MODE — Chart Functions (new)
// ═══════════════════════════════════════════════════════════════════

function initCompareChart(sensorName, unit) {
    const canvas = document.getElementById('predChart');

    predChartInstance = new Chart(canvas, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: `${sensorName} — Live Data`,
                    data: [],
                    borderColor: 'rgba(34, 211, 238, 1)',
                    backgroundColor: 'rgba(34, 211, 238, 0.08)',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.3,
                },
                {
                    label: `${sensorName} — Predicted`,
                    data: [],
                    borderColor: 'rgba(245, 158, 11, 1)',
                    backgroundColor: 'rgba(245, 158, 11, 0.06)',
                    borderWidth: 2.5,
                    borderDash: [8, 4],
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.3,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                title: {
                    display: true,
                    text: `Live vs Predicted — ${sensorName} (Training Phase)`,
                    color: '#e5e7eb',
                    font: { size: 15, weight: 600 },
                },
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 16,
                        filter: (item) => !item.text.startsWith('_'),
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(11, 18, 32, 0.95)',
                    titleColor: '#22d3ee',
                    bodyColor: '#e5e7eb',
                    borderColor: 'rgba(34, 211, 238, 0.2)',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 8,
                },
                annotation: undefined,
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 10 },
                        maxTicksLimit: 15,
                        maxRotation: 0,
                    },
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#94a3b8', font: { size: 11 } },
                    title: {
                        display: true,
                        text: unit,
                        color: '#64748b',
                    },
                },
            },
        },
    });
}

function updateCompareChartData(allData, compareData) {
    if (!predChartInstance) return;

    // All data labels
    const labels = allData.map(d => {
        const t = new Date(d.timestamp);
        return `${t.getMinutes()}:${String(t.getSeconds()).padStart(2, '0')}`;
    });
    const allValues = allData.map(d => d.value);

    // Live data line — shows all collected data
    predChartInstance.data.labels = labels;
    predChartInstance.data.datasets[0].data = allValues;

    // Predicted line — only available after training
    if (compareData && compareData.all_predictions) {
        const trainCount = compareData.train_data ? compareData.train_data.length : compareTrainSamples;

        // Build predicted data: naive forecast during training period, then predictions
        const predictedLine = [];
        for (let i = 0; i < allValues.length; i++) {
            if (i < trainCount) {
                // Naive forecast: use previous value so line isn't blank
                predictedLine.push(i > 0 ? allValues[i - 1] : allValues[0]);
            } else {
                const predIdx = i - trainCount;
                if (predIdx < compareData.all_predictions.length) {
                    predictedLine.push(compareData.all_predictions[predIdx]);
                } else {
                    predictedLine.push(null);
                }
            }
        }

        predChartInstance.data.datasets[1].data = predictedLine;

        // Update title to show comparing phase
        const sensorName = predChartInstance.data.datasets[0].label.replace(' — Live Data', '');
        predChartInstance.options.plugins.title.text = `Live vs Predicted — ${sensorName} (Comparing)`;

        // Add a vertical separator line dataset for training/compare boundary
        if (predChartInstance.data.datasets.length < 3) {
            // Create a vertical line at the training boundary
            const separatorData = allValues.map((_, i) => null);
            predChartInstance.data.datasets.push({
                label: '_train_boundary',
                data: separatorData,
                borderColor: 'transparent',
                backgroundColor: 'transparent',
                pointRadius: 0,
                fill: false,
                showLine: false,
            });
        }
    } else {
        // Still in training — show naive predictions instead of empty line
        const predictedLine = [];
        for (let i = 0; i < allValues.length; i++) {
            predictedLine.push(i > 0 ? allValues[i - 1] : allValues[0]);
        }
        predChartInstance.data.datasets[1].data = predictedLine;
    }

    predChartInstance.update('none');
}

// ─── Show Model Info ─────────────────────────────────────────────
let lastPredictionResult = null;  // Track for AI explanation

function showModelInfo(prediction) {
    const card = document.getElementById('modelInfoCard');
    const info = document.getElementById('modelInfo');

    // Store for AI explanation
    lastPredictionResult = prediction;

    card.classList.remove('hidden');

    info.innerHTML = `
        <div class="model-info-item">
            <div class="label">Model</div>
            <div class="value">${prediction.model_name}</div>
        </div>
        <div class="model-info-item">
            <div class="label">MAE</div>
            <div class="value">${prediction.metrics.mae}</div>
        </div>
        <div class="model-info-item">
            <div class="label">RMSE</div>
            <div class="value">${prediction.metrics.rmse}</div>
        </div>
        <div class="model-info-item">
            <div class="label">Forecast Points</div>
            <div class="value">${prediction.predictions.length}</div>
        </div>
        <div class="model-info-item">
            <div class="label">Mode</div>
            <div class="value">${predMode === 'compare' ? '📊 Live vs Predicted' : '🔮 Future Forecast'}</div>
        </div>
    `;
}

// ─── AI-Powered Prediction Explanation ──────────────────────────

async function askAIAboutPrediction() {
    if (!lastPredictionResult) {
        alert('Please run a prediction first.');
        return;
    }

    const panel = document.getElementById('predictionAIPanel');
    const body = document.getElementById('predictionAIBody');
    const sensor = document.getElementById('predSensor');
    const sensorName = sensor.options[sensor.selectedIndex]?.textContent || sensor.value;

    // Show panel with loading state
    panel.classList.remove('hidden');
    body.innerHTML = `
        <div class="ai-insight-loading">
            <div class="ai-shimmer">
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
            </div>
            <span>AI is analyzing your prediction results...</span>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/api/chat/explain-prediction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model_name: lastPredictionResult.model_name,
                sensor: sensorName,
                mode: predMode,
                mae: lastPredictionResult.metrics?.mae ?? 0,
                rmse: lastPredictionResult.metrics?.rmse ?? 0,
                predictions_count: lastPredictionResult.predictions?.length ?? 0,
            }),
        });

        const data = await res.json();
        if (data.insight) {
            let formatted = data.insight
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
            body.innerHTML = formatted;
            body.classList.add('ai-fade-in');
        } else {
            body.textContent = 'AI could not generate an explanation. Please try again.';
        }
    } catch (e) {
        console.error('AI Prediction explanation error:', e);
        body.textContent = `\u26a0\ufe0f Error: ${e.message}. Make sure the server is running and OpenAI API key is configured.`;
    }
}

function hidePredictionAI() {
    document.getElementById('predictionAIPanel').classList.add('hidden');
}

async function askAIModelAdvice() {
    const sensor = document.getElementById('predSensor').value;
    const panel = document.getElementById('modelAdvicePanel');
    const body = document.getElementById('modelAdviceBody');

    if (!sensor) {
        alert('Please select a sensor first.');
        return;
    }

    panel.classList.remove('hidden');
    body.innerHTML = `
        <div class="ai-insight-loading">
            <div class="ai-shimmer">
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
            </div>
            <span>AI Model Advisor is analyzing sensor traits...</span>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/api/chat/model-advice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor }),
        });

        const data = await res.json();
        if (data.advice) {
            let formatted = data.advice
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
            body.innerHTML = formatted;
            body.classList.add('ai-fade-in');
        } else {
            body.textContent = 'AI could not generate model advice. Please try again.';
        }
    } catch (e) {
        console.error('AI Model Advisor error:', e);
        body.textContent = `⚠️ Error: ${e.message}. Make sure the server is running and OpenAI API key is configured.`;
    }
}


