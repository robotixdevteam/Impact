/**
 * AI Impact Kit — Live Dashboard Module
 * Polls the backend for live values of all sensors and updates the dashboard view.
 */



// Initialize the dashboard grid once the DOM and sensorRegistry are ready
function initDashboard() {
    const grid = document.getElementById('dashboardGrid');
    if (!grid) return;
    
    grid.innerHTML = '';
    
    // Create a card for each sensor in the registry
    for (const [sensorId, info] of Object.entries(sensorRegistry)) {
        const card = document.createElement('div');
        card.className = 'dashboard-card';
        card.id = `dash-card-${sensorId}`;
        card.innerHTML = `
            <div class="dash-card-header">
                <span class="dash-card-title">${info.name}</span>
            </div>
            <div class="dash-card-body">
                <span class="dash-card-value" id="dash-val-${sensorId}">--</span>
                <span class="dash-card-unit">${info.unit}</span>
            </div>
        `;
        grid.appendChild(card);
    }
}

// Fetch live data for all sensors
async function updateDashboardData() {
    const sensorIds = Object.keys(sensorRegistry);
    if (sensorIds.length === 0) return;
    
    try {
        const query = sensorIds.join(',');
        const res = await fetch(`${API_BASE}/api/analysis/sensors?names=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        if (data.sensors && Array.isArray(data.sensors)) {
            data.sensors.forEach(result => {
                // Find the sensor key (e.g. "temperature") that matches this name (e.g. "Temperature")
                const sensorId = Object.keys(sensorRegistry).find(k => sensorRegistry[k].name === result.sensor) || result.sensor;
                
                const valEl = document.getElementById(`dash-val-${sensorId}`);
                if (valEl) {
                    if (result.value !== null && result.value !== undefined) {
                        valEl.textContent = result.value.toFixed(2);
                        valEl.classList.remove('pulse-update');
                        void valEl.offsetWidth; // trigger reflow
                        valEl.classList.add('pulse-update');
                    } else if (result.error) {
                        valEl.textContent = 'ERR';
                        valEl.title = result.error;
                    } else {
                        valEl.textContent = '--';
                    }
                }
            });
        }
    } catch (e) {
        console.error('Failed to update dashboard data:', e);
    }
}

// Hook into view switching to load on-demand values
const originalSwitchView = switchView;
window.switchView = function(viewName) {
    originalSwitchView(viewName);
    
    if (viewName === 'dashboard') {
        if (Object.keys(sensorRegistry).length > 0 && document.getElementById('dashboardGrid').children.length === 0) {
            initDashboard();
        }
        updateDashboardData(); // single immediate fetch on load
    }
};

// On-demand Get Values function triggered by button click
async function getDashboardValues() {
    const btn = document.getElementById('btnGetValues');
    const originalText = btn ? btn.innerHTML : '⚡ Get Values';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '🔄 Fetching...';
    }
    
    await updateDashboardData();
    
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Also listen for initial registry load
document.addEventListener('DOMContentLoaded', () => {
    // If the app starts on the dashboard view, initialize it
    setTimeout(() => {
        const activeView = document.querySelector('.view.active');
        if (activeView && activeView.id === 'view-dashboard') {
            initDashboard();
            updateDashboardData(); // single immediate fetch
        }
    }, 1000);
});
