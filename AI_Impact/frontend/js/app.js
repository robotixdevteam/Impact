/**
 * AI Impact Kit — Main App Controller
 * Handles navigation, settings, and initialization.
 */

const API_BASE = '';  // Same origin (served by FastAPI)

// ─── State ────────────────────────────────────────────────────────
let sensorRegistry = {};
let unsdgGoals = {};

// ─── View Switching ──────────────────────────────────────────────
function switchView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    // Deactivate all nav items
    document.querySelectorAll('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
    // Show target view
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.add('active');
    // Activate nav item
    const nav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (nav) nav.classList.add('active');
    // Close mobile sidebar
    document.querySelector('.sidebar').classList.remove('open');
}

// ─── Settings Modal ──────────────────────────────────────────────
function openSettings() {
    fetchSettings().then(() => {
        document.getElementById('settingsModal').classList.add('active');
    });
}

function closeSettings() {
    document.getElementById('settingsModal').classList.remove('active');
}

async function fetchSettings() {
    try {
        const res = await fetch(`${API_BASE}/api/settings`);
        const data = await res.json();
        document.getElementById('settingSensorIP').value = data.sensor_ip || '192.168.4.1';
        document.getElementById('settingSimMode').value = data.simulation_mode ? 'true' : 'false';
        updateConnectionStatus(data);
    } catch (e) {
        console.error('Failed to fetch settings:', e);
    }
}

async function saveSettings() {
    const ip = document.getElementById('settingSensorIP').value.trim();
    const sim = document.getElementById('settingSimMode').value;
    try {
        const res = await fetch(`${API_BASE}/api/settings?sensor_ip=${encodeURIComponent(ip)}&simulation_mode=${sim}`, {
            method: 'PUT',
        });
        const data = await res.json();
        updateConnectionStatus(data);
        closeSettings();
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

function updateConnectionStatus(settings) {
    const dot = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (settings.simulation_mode) {
        dot.className = 'status-dot sim';
        text.textContent = 'Simulation Mode';
    } else {
        dot.className = 'status-dot';
        text.textContent = `Live — ${settings.sensor_ip}`;
    }
}

// ─── Load Sensor Registry ────────────────────────────────────────
async function loadSensorRegistry() {
    try {
        const res = await fetch(`${API_BASE}/api/analysis/registry`);
        const data = await res.json();
        sensorRegistry = data.sensors;
        populateSensorGrid();
        populatePredictionSensorDropdown();
        populateAxisDropdowns();
    } catch (e) {
        console.error('Failed to load sensor registry:', e);
    }
}

// ─── Load UNSDG Goals ────────────────────────────────────────────
async function loadUnsdgGoals() {
    try {
        const res = await fetch(`${API_BASE}/api/analysis/unsdg`);
        const data = await res.json();
        unsdgGoals = data.goals;
        populateUnsdgGrid();
    } catch (e) {
        console.error('Failed to load UNSDG goals:', e);
    }
}

// ─── Populate Axis Dropdowns ─────────────────────────────────────
function populateAxisDropdowns() {
    const xSelect = document.getElementById('xAxis');
    const ySelect = document.getElementById('yAxis');

    // X-axis options
    xSelect.innerHTML = '<option value="sensors">Sensor Names</option>';
    for (const [key, info] of Object.entries(sensorRegistry)) {
        xSelect.innerHTML += `<option value="${key}">${info.name}</option>`;
    }

    // Y-axis options
    ySelect.innerHTML = '<option value="values">Sensor Values</option>';
    for (const [key, info] of Object.entries(sensorRegistry)) {
        ySelect.innerHTML += `<option value="${key}">${info.name}</option>`;
    }
}

// ─── Chart Color Palette ─────────────────────────────────────────
const CHART_COLORS = [
    'rgba(34, 211, 238, 0.85)',   // cyan
    'rgba(99, 102, 241, 0.85)',   // indigo
    'rgba(34, 197, 94, 0.85)',    // emerald
    'rgba(245, 158, 11, 0.85)',   // amber
    'rgba(244, 63, 94, 0.85)',    // rose
    'rgba(168, 85, 247, 0.85)',   // purple
    'rgba(236, 72, 153, 0.85)',   // pink
    'rgba(14, 165, 233, 0.85)',   // sky
    'rgba(132, 204, 22, 0.85)',   // lime
    'rgba(251, 146, 60, 0.85)',   // orange
    'rgba(20, 184, 166, 0.85)',   // teal
    'rgba(139, 92, 246, 0.85)',   // violet
    'rgba(234, 179, 8, 0.85)',    // yellow
    'rgba(249, 115, 22, 0.85)',   // deep orange
    'rgba(6, 182, 212, 0.85)',    // cyan-500
    'rgba(59, 130, 246, 0.85)',   // blue
];

const CHART_BORDERS = CHART_COLORS.map(c => c.replace('0.85', '1'));
const CHART_BG_LIGHT = CHART_COLORS.map(c => c.replace('0.85', '0.15'));

// ─── Chart.js Global Config ─────────────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";

// ─── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSensorRegistry(),
        loadUnsdgGoals(),
        fetchSettings(),
    ]);
});
