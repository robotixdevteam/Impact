/**
 * AI Impact Kit — Data Analysis Module
 * Handles sensor selection, UNSDG goal selection, chart configuration, and rendering.
 */

// ─── State ────────────────────────────────────────────────────────
let selectedSensors = new Set();
let selectedGoal = null;
let analysisChartInstance = null;
let lastChartSensorData = null;  // Track last chart data for AI analysis

let analysisStartTime = null;
let analysisDurationSec = 0;
let analysisCollectionInterval = null;
let analysisIsCollecting = false;
let analysisCollectedData = {};
let analysisCollectedTimestamps = [];

// ─── Populate Sensor Grid ────────────────────────────────────────
function populateSensorGrid() {
    const grid = document.getElementById('sensorGrid');
    grid.innerHTML = '';
    for (const [key, info] of Object.entries(sensorRegistry)) {
        const chip = document.createElement('div');
        chip.className = 'sensor-chip';
        chip.dataset.sensor = key;
        chip.innerHTML = `<span class="sensor-chip-dot"></span>${info.name}`;
        chip.onclick = () => toggleSensor(key);
        grid.appendChild(chip);
    }
}

function toggleSensor(key) {
    if (selectedSensors.has(key)) {
        selectedSensors.delete(key);
    } else {
        selectedSensors.add(key);
    }
    updateSensorChipUI();
}

function selectAllSensors() {
    Object.keys(sensorRegistry).forEach(k => selectedSensors.add(k));
    updateSensorChipUI();
}

function clearSensorSelection() {
    selectedSensors.clear();
    updateSensorChipUI();
}

function updateSensorChipUI() {
    document.querySelectorAll('.sensor-chip').forEach(chip => {
        const key = chip.dataset.sensor;
        if (selectedSensors.has(key)) {
            chip.classList.add('selected');
        } else {
            chip.classList.remove('selected');
        }
    });
}

// ─── Populate UNSDG Grid ─────────────────────────────────────────
function populateUnsdgGrid() {
    const grid = document.getElementById('unsdgGrid');
    grid.innerHTML = '';
    for (const [key, goal] of Object.entries(unsdgGoals)) {
        const card = document.createElement('div');
        card.className = 'unsdg-card';
        card.dataset.goal = key;
        card.style.setProperty('--card-color', goal.color);
        card.innerHTML = `
            <div class="unsdg-card-icon">${goal.icon}</div>
            <div class="unsdg-card-title">${goal.name}</div>
            <div class="unsdg-card-sdg">SDG ${goal.sdg_number}</div>
            <div class="unsdg-card-sensors">
                ${goal.sensors.map(s => `<span class="unsdg-sensor-tag">${sensorRegistry[s]?.name || s}</span>`).join('')}
            </div>
        `;
        card.onclick = () => selectGoal(key);
        grid.appendChild(card);
    }
}

function selectGoal(goalKey) {
    // If same goal clicked, deselect
    if (selectedGoal === goalKey) {
        clearUnsdgSelection();
        return;
    }

    selectedGoal = goalKey;
    const goal = unsdgGoals[goalKey];

    // Auto-select the sensors for this goal
    selectedSensors.clear();
    goal.sensors.forEach(s => selectedSensors.add(s));
    updateSensorChipUI();

    // Update UNSDG card UI
    document.querySelectorAll('.unsdg-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.goal === goalKey);
    });
}

function clearUnsdgSelection() {
    selectedGoal = null;
    document.querySelectorAll('.unsdg-card').forEach(card => card.classList.remove('selected'));
}

function calculateTrend(values) {
    if (!values || values.length < 2) return 'stable \u27a1\ufe0f';
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const delta = avgSecond - avgFirst;
    const threshold = avgFirst * 0.01; // 1% change threshold
    if (delta > threshold) return 'increasing \ud83d\udcc8';
    if (delta < -threshold) return 'decreasing \ud83d\udcc9';
    return 'stable \u27a1\ufe0f';
}

function cleanSensorData(timestamps, collectedData, sensors) {
    const cleaned = {};
    console.log("[Data Cleaning] Starting data cleanup process...");
    
    sensors.forEach(s => {
        const rawVals = collectedData[s] || [];
        const cleanVals = [];
        let imputedCount = 0;
        let smoothedCount = 0;
        
        for (let i = 0; i < rawVals.length; i++) {
            let val = rawVals[i];
            
            // 1. Imputation (Fill missing/null/undefined/NaN values)
            if (val === null || val === undefined || isNaN(val)) {
                imputedCount++;
                if (cleanVals.length > 0) {
                    val = cleanVals[cleanVals.length - 1]; // Forward fill
                } else {
                    // Try backward fill
                    let foundAhead = false;
                    for (let j = i + 1; j < rawVals.length; j++) {
                        if (rawVals[j] !== null && rawVals[j] !== undefined && !isNaN(rawVals[j])) {
                            val = rawVals[j];
                            foundAhead = true;
                            break;
                        }
                    }
                    if (!foundAhead) {
                        val = 0.0;
                    }
                }
            }
            
            // 2. Outlier Smoothing (deviations over 400% from rolling average)
            if (cleanVals.length >= 2) {
                const prev1 = cleanVals[cleanVals.length - 1];
                const prev2 = cleanVals[cleanVals.length - 2];
                const rollingAvg = (prev1 + prev2) / 2;
                
                if (rollingAvg > 0.1 && Math.abs(val - rollingAvg) > rollingAvg * 4) {
                    smoothedCount++;
                    val = rollingAvg; // Smooth spike to average
                }
            }
            
            cleanVals.push(val);
        }
        
        if (imputedCount > 0 || smoothedCount > 0) {
            console.log(`[Data Cleaning] Sensor "${sensorRegistry[s]?.name || s}": Imputed ${imputedCount} missing values, Smoothed ${smoothedCount} outlier spikes.`);
        }
        cleaned[s] = cleanVals;
    });
    
    return cleaned;
}

function renderTimeSeriesChart(timestamps, cleanedData, sensorsToFetch, chartType) {
    const canvas = document.getElementById('analysisChart');
    const placeholder = document.getElementById('analysisPlaceholder');

    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    if (analysisChartInstance) {
        analysisChartInstance.destroy();
    }

    const resolvedType = chartType || 'line';

    const datasets = sensorsToFetch.map((s, idx) => {
        const info = sensorRegistry[s] || { name: s, unit: '' };
        const ds = {
            label: `${info.name} (${info.unit})`,
            data: cleanedData[s],
            backgroundColor: CHART_BG_LIGHT[idx % CHART_BG_LIGHT.length],
            borderColor: CHART_COLORS[idx % CHART_COLORS.length],
            borderWidth: 2,
        };

        // Chart-type-specific styling
        if (resolvedType === 'line') {
            ds.pointRadius = timestamps.length > 50 ? 2 : 4;
            ds.pointHoverRadius = 6;
            ds.fill = false;
            ds.tension = 0.35;
        } else if (resolvedType === 'bar') {
            ds.borderRadius = 4;
        } else if (resolvedType === 'radar') {
            ds.fill = true;
            ds.backgroundColor = CHART_BG_LIGHT[idx % CHART_BG_LIGHT.length];
            ds.pointRadius = 3;
        }

        return ds;
    });

    const titleSuffix = selectedGoal ? `${unsdgGoals[selectedGoal]?.icon} ${unsdgGoals[selectedGoal]?.name} (Cleaned History)` : 'Cleaned Time-Series History';

    analysisChartInstance = new Chart(canvas, {
        type: resolvedType,
        data: {
            labels: timestamps,
            datasets: datasets,
        },
        options: getChartOptions(resolvedType, titleSuffix),
    });
}

// ─── Generate Chart ──────────────────────────────────────────────
async function generateChart(customDurationSec = null) {
    analysisIsCollecting = false;
    if (analysisCollectionInterval) {
        clearInterval(analysisCollectionInterval);
        analysisCollectionInterval = null;
    }

    const xAxis = document.getElementById('xAxis').value;
    const yAxis = document.getElementById('yAxis').value;
    const chartTypeSelect = document.getElementById('chartType');
    let chartType = chartTypeSelect.value;
    
    let durationVal;
    if (customDurationSec !== null) {
        durationVal = customDurationSec === 0 ? 'snapshot' : String(customDurationSec);
    } else {
        durationVal = document.getElementById('chartDuration').value;
    }

    // Determine which sensors to fetch
    let sensorsToFetch = [];
    if (xAxis !== 'sensors' && yAxis !== 'values') {
        sensorsToFetch = [xAxis, yAxis];
    } else if (selectedSensors.size > 0) {
        sensorsToFetch = Array.from(selectedSensors);
    } else {
        alert('Please select at least one sensor or UNSDG goal.');
        return;
    }

    const placeholder = document.getElementById('analysisPlaceholder');
    const canvas = document.getElementById('analysisChart');
    const btnAskAI = document.getElementById('btnAskAIChart');

    // chartType is preserved from the user's selection for all modes

    if (durationVal === 'snapshot') {
        // --- Snapshot Mode ---
        document.getElementById('analysisProgress').classList.add('hidden');
        placeholder.innerHTML = '<div class="spinner"></div><p class="mt-sm text-muted">Fetching sensor data...</p>';
        placeholder.style.display = 'flex';
        canvas.style.display = 'none';
        btnAskAI.disabled = true;

        try {
            const names = sensorsToFetch.join(',');
            const res = await fetch(`${API_BASE}/api/analysis/sensors?names=${names}`);
            const data = await res.json();

            if (data.sensors) {
                renderAnalysisChart(data.sensors, chartType, xAxis, yAxis);
            }
        } catch (e) {
            placeholder.innerHTML = `<span class="icon">❌</span><p>Error: ${e.message}</p>`;
            console.error('Chart generation error:', e);
        }
    } else {
        // --- Time-Series Data Collection Mode ---
        analysisDurationSec = parseInt(durationVal);
        if (isNaN(analysisDurationSec) || analysisDurationSec <= 0) {
            console.error('Invalid duration selected:', durationVal);
            placeholder.innerHTML = '<span class="icon">❌</span><p>Error: Invalid duration selected.</p>';
            btnAskAI.disabled = true;
            return;
        }
        analysisStartTime = Date.now();
        analysisIsCollecting = true;
        analysisCollectedData = {};
        sensorsToFetch.forEach(s => {
            analysisCollectedData[s] = [];
        });
        analysisCollectedTimestamps = [];

        // Show progress UI
        document.getElementById('analysisProgress').classList.remove('hidden');
        document.getElementById('analysisProgressBar').style.width = '0%';
        document.getElementById('analysisProgressText').textContent = 'Initializing telemetry collection...';
        btnAskAI.disabled = true;

        placeholder.innerHTML = '<div class="spinner"></div><p class="mt-sm text-muted">Collecting sensor telemetry... Please wait.</p>';
        placeholder.style.display = 'flex';
        canvas.style.display = 'none';

        if (analysisChartInstance) {
            analysisChartInstance.destroy();
            analysisChartInstance = null;
        }

        const formatTime = (sec) => {
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = (sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        const totalStr = formatTime(analysisDurationSec);
        document.getElementById('analysisTimer').textContent = `00:00 / ${totalStr}`;

        const collectSample = async () => {
            if (!analysisIsCollecting) return;

            const elapsed = Math.floor((Date.now() - analysisStartTime) / 1000);
            if (elapsed > analysisDurationSec) {
                // Done!
                analysisIsCollecting = false;
                if (analysisCollectionInterval) {
                    clearInterval(analysisCollectionInterval);
                    analysisCollectionInterval = null;
                }
                document.getElementById('analysisProgress').classList.add('hidden');

                // Perform Data Cleaning
                const cleanedData = cleanSensorData(analysisCollectedTimestamps, analysisCollectedData, sensorsToFetch);
                
                // Render the Chart
                renderTimeSeriesChart(analysisCollectedTimestamps, cleanedData, sensorsToFetch, chartType);

                // Build sensor summaries for GenAI analysis using cleaned data
                const sensorSummaries = sensorsToFetch.map(s => {
                    const info = sensorRegistry[s] || { name: s, unit: '' };
                    const vals = cleanedData[s];
                    const currentVal = vals[vals.length - 1] ?? 0;
                    const minVal = vals.length > 0 ? Math.min(...vals) : 0;
                    const maxVal = vals.length > 0 ? Math.max(...vals) : 0;
                    const avgVal = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
                    const trendText = calculateTrend(vals);

                    return {
                        sensor: info.name,
                        name: info.name,
                        value: currentVal,
                        unit: info.unit,
                        min_value: minVal,
                        max_value: maxVal,
                        avg_value: avgVal,
                        trend: trendText,
                    };
                });

                lastChartSensorData = sensorSummaries;
                btnAskAI.disabled = false;
                return;
            }

            const pct = Math.min(100, (elapsed / analysisDurationSec) * 100);
            document.getElementById('analysisProgressBar').style.width = `${pct}%`;
            document.getElementById('analysisTimer').textContent = `${formatTime(elapsed)} / ${totalStr}`;
            document.getElementById('analysisProgressText').textContent = `Collecting sensor data... ${elapsed}/${analysisDurationSec}s`;

            try {
                const names = sensorsToFetch.join(',');
                const res = await fetch(`${API_BASE}/api/analysis/sensors?names=${names}`);
                const data = await res.json();

                // Double check we are still active after async network fetch
                if (!analysisIsCollecting) return;

                if (data.sensors) {
                    const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    analysisCollectedTimestamps.push(nowStr);

                    data.sensors.forEach(item => {
                        const key = Object.keys(sensorRegistry).find(k => sensorRegistry[k].name === item.sensor);
                        if (key && analysisCollectedData[key] !== undefined) {
                            analysisCollectedData[key].push(item.value);
                        }
                    });
                }
            } catch (e) {
                console.error('Error during background sensor data collection:', e);
            }
        };

        // Assign the interval reference first so it can be cleared instantly
        analysisCollectionInterval = setInterval(collectSample, 1000);
        
        // Execute the first collection cycle asynchronously
        collectSample();
    }
}

async function askAITextToChart() {
    const input = document.getElementById('textToChartInput');
    const status = document.getElementById('textToChartStatus');
    const btn = document.getElementById('btnTextToChart');
    const query = input.value.trim();

    if (!query) {
        alert('Please enter a chart request first.');
        return;
    }

    status.style.display = 'block';
    status.style.color = 'var(--text-muted)';
    status.textContent = '🪄 GenAI is parsing your request...';
    btn.disabled = true;

    try {
        const res = await fetch(`${API_BASE}/api/chat/text-to-chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: query }),
        });

        const data = await res.json();
        if (data.error) {
            status.style.color = 'var(--accent-rose)';
            status.textContent = data.error;
            btn.disabled = false;
            return;
        }

        if (data.sensors && data.sensors.length > 0) {
            status.style.color = 'var(--accent-emerald)';
            status.textContent = `✅ Found sensors: ${data.sensors.map(s => sensorRegistry[s]?.name || s).join(', ')} | Type: ${data.chart_type} | Duration: ${data.duration_sec ? data.duration_sec + 's' : 'Snapshot'}. Generating...`;
            
            selectedSensors.clear();
            data.sensors.forEach(s => selectedSensors.add(s));
            updateSensorChipUI();

            document.getElementById('chartType').value = data.chart_type;

            const durationSelect = document.getElementById('chartDuration');
            const durationStr = data.duration_sec ? String(data.duration_sec) : 'snapshot';
            if (durationSelect) {
                let optionExists = false;
                for (let i = 0; i < durationSelect.options.length; i++) {
                    if (durationSelect.options[i].value === durationStr) {
                        optionExists = true;
                        break;
                    }
                }
                if (!optionExists && durationStr !== 'snapshot') {
                    const newOpt = document.createElement('option');
                    newOpt.value = durationStr;
                    newOpt.textContent = `${data.duration_sec} seconds`;
                    durationSelect.appendChild(newOpt);
                }
                durationSelect.value = durationStr;
            }

            await generateChart(data.duration_sec !== undefined ? data.duration_sec : null);
        } else {
            status.style.color = 'var(--accent-rose)';
            status.textContent = '❌ Could not find matching sensors for that request. Try naming specific sensors.';
        }
    } catch (e) {
        console.error('Text-to-Chart error:', e);
        status.style.color = 'var(--accent-rose)';
        status.textContent = `⚠️ Error: ${e.message}`;
    } finally {
        btn.disabled = false;
    }
}

function renderAnalysisChart(sensorData, chartType, xAxis, yAxis) {
    const canvas = document.getElementById('analysisChart');
    const placeholder = document.getElementById('analysisPlaceholder');

    // Store data for AI analysis
    lastChartSensorData = sensorData;
    document.getElementById('btnAskAIChart').disabled = false;
    // Destroy old chart
    if (analysisChartInstance) {
        analysisChartInstance.destroy();
    }

    placeholder.style.display = 'none';
    canvas.style.display = 'block';

    // Check if X vs Y mode (two specific sensors)
    if (xAxis !== 'sensors' && yAxis !== 'values') {
        // Find the two sensor values
        const xData = sensorData.find(s => {
            const regEntry = Object.entries(sensorRegistry).find(([k, v]) => k === xAxis);
            return regEntry && s.sensor === regEntry[1].name;
        });
        const yData = sensorData.find(s => {
            const regEntry = Object.entries(sensorRegistry).find(([k, v]) => k === yAxis);
            return regEntry && s.sensor === regEntry[1].name;
        });

        const xVal = xData?.value ?? 0;
        const yVal = yData?.value ?? 0;
        const xName = sensorRegistry[xAxis]?.name || xAxis;
        const yName = sensorRegistry[yAxis]?.name || yAxis;

        analysisChartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: [xName, yName],
                datasets: [{
                    label: 'Sensor Values',
                    data: [xVal, yVal],
                    backgroundColor: [CHART_COLORS[0], CHART_COLORS[1]],
                    borderColor: [CHART_BORDERS[0], CHART_BORDERS[1]],
                    borderWidth: 2,
                    borderRadius: 8,
                }]
            },
            options: getChartOptions(chartType, `${xName} vs ${yName}`),
        });
        return;
    }

    // Standard multi-sensor chart
    const labels = sensorData.map(s => s.sensor);
    const values = sensorData.map(s => s.value ?? 0);
    const units = sensorData.map(s => s.unit || '');

    const colors = values.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);
    const borders = values.map((_, i) => CHART_BORDERS[i % CHART_BORDERS.length]);
    const bgLight = values.map((_, i) => CHART_BG_LIGHT[i % CHART_BG_LIGHT.length]);

    let datasets;
    if (['line', 'radar'].includes(chartType)) {
        datasets = [{
            label: selectedGoal ? unsdgGoals[selectedGoal]?.name || 'Sensors' : 'Sensor Values',
            data: values,
            backgroundColor: bgLight,
            borderColor: CHART_COLORS[0],
            borderWidth: 2,
            pointBackgroundColor: colors,
            pointBorderColor: borders,
            pointRadius: 6,
            pointHoverRadius: 8,
            fill: chartType === 'line',
            tension: 0.3,
        }];
    } else {
        datasets = [{
            label: 'Sensor Values',
            data: values,
            backgroundColor: colors,
            borderColor: borders,
            borderWidth: 2,
            borderRadius: chartType === 'bar' ? 8 : 0,
        }];
    }

    const goalTitle = selectedGoal ? `${unsdgGoals[selectedGoal]?.icon} ${unsdgGoals[selectedGoal]?.name}` : '';

    analysisChartInstance = new Chart(canvas, {
        type: chartType,
        data: { labels, datasets },
        options: getChartOptions(chartType, goalTitle),
    });
}

function getChartOptions(chartType, titleSuffix = '') {
    const isRadialType = ['pie', 'doughnut', 'polarArea', 'radar'].includes(chartType);
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
            duration: 800,
            easing: 'easeOutQuart',
        },
        plugins: {
            title: {
                display: !!titleSuffix,
                text: titleSuffix,
                color: '#e5e7eb',
                font: { size: 16, weight: 600 },
                padding: { bottom: 16 },
            },
            legend: {
                display: true,
                position: 'bottom',
                labels: {
                    color: '#94a3b8',
                    padding: 16,
                    usePointStyle: true,
                    pointStyleWidth: 12,
                },
            },
            tooltip: {
                backgroundColor: 'rgba(11, 18, 32, 0.95)',
                titleColor: '#22d3ee',
                bodyColor: '#e5e7eb',
                borderColor: 'rgba(34, 211, 238, 0.2)',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                displayColors: true,
            },
        },
        scales: isRadialType ? {} : {
            x: {
                grid: { color: 'rgba(255,255,255,0.04)' },
                ticks: { color: '#94a3b8', font: { size: 11 } },
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.04)' },
                ticks: { color: '#94a3b8', font: { size: 11 } },
                beginAtZero: true,
            },
        },
    };
}

// ─── AI-Powered Analysis Functions ──────────────────────────────

async function askAIAboutChart() {
    if (!lastChartSensorData || lastChartSensorData.length === 0) {
        alert('Please generate a chart first.');
        return;
    }

    const panel = document.getElementById('analysisAIPanel');
    const body = document.getElementById('analysisAIBody');
    const chartType = document.getElementById('chartType').value;
    const goalName = selectedGoal ? (unsdgGoals[selectedGoal]?.name || null) : null;

    // Show panel with loading state
    panel.classList.remove('hidden');
    body.innerHTML = `
        <div class="ai-insight-loading">
            <div class="ai-shimmer">
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
            </div>
            <span>AI is analyzing your chart data...</span>
        </div>
    `;

    // Build sensor data payload including time-series stats
    const sensors = lastChartSensorData.map(s => ({
        name: s.sensor || s.name || 'Unknown',
        value: s.value ?? 0,
        unit: s.unit || '',
        min_value: s.min_value !== undefined ? s.min_value : null,
        max_value: s.max_value !== undefined ? s.max_value : null,
        avg_value: s.avg_value !== undefined ? s.avg_value : null,
        trend: s.trend !== undefined ? s.trend : null,
    }));

    try {
        const res = await fetch(`${API_BASE}/api/chat/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensors, chart_type: chartType, goal_name: goalName }),
        });

        const data = await res.json();
        if (data.insight) {
            // Format basic markdown (bold)
            let formatted = data.insight
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');
            body.innerHTML = formatted;
            body.classList.add('ai-fade-in');
        } else {
            body.textContent = 'AI could not generate an insight. Please try again.';
        }
    } catch (e) {
        console.error('AI Analysis error:', e);
        body.textContent = `⚠️ Error: ${e.message}. Make sure the server is running and OpenAI API key is configured.`;
    }
}

async function askAIChartRecommendation() {
    if (selectedSensors.size === 0) {
        alert('Please select at least one sensor first.');
        return;
    }

    const panel = document.getElementById('analysisAIPanel');
    const body = document.getElementById('analysisAIBody');

    // Show panel with loading state
    panel.classList.remove('hidden');
    body.innerHTML = `
        <div class="ai-insight-loading">
            <div class="ai-shimmer">
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
                <span class="ai-shimmer-dot"></span>
            </div>
            <span>AI is thinking about the best chart for your data...</span>
        </div>
    `;

    const sensorNames = Array.from(selectedSensors).map(
        key => sensorRegistry[key]?.name || key
    );

    try {
        const res = await fetch(`${API_BASE}/api/chat/recommend-chart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensors: sensorNames, count: sensorNames.length }),
        });

        const data = await res.json();
        if (data.recommendation) {
            let formatted = data.recommendation
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/RECOMMENDED:/g, '<strong>RECOMMENDED:</strong>')
                .replace(/\n/g, '<br>');
            body.innerHTML = formatted;
            body.classList.add('ai-fade-in');
        } else {
            body.textContent = 'AI could not generate a recommendation. Please try again.';
        }
    } catch (e) {
        console.error('AI Recommendation error:', e);
        body.textContent = `\u26a0\ufe0f Error: ${e.message}. Make sure the server is running and OpenAI API key is configured.`;
    }
}

function hideAnalysisAI() {
    document.getElementById('analysisAIPanel').classList.add('hidden');
}
