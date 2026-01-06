// BitsperBox Web UI

const API_BASE = '/api';

// State
let selectedPrinter = null;

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Tab Navigation
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const tabId = tab.dataset.tab;

    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(tabId).classList.add('active');

    // Load data for the tab
    if (tabId === 'status') loadStatus();
    if (tabId === 'printer') loadPrinters();
    if (tabId === 'config') loadConfig();
  });
});

// Toast notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// API calls
async function api(endpoint, options = {}) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Load Status
async function loadStatus() {
  try {
    const data = await api('/status');

    // Configured status
    const configuredEl = document.getElementById('status-configured');
    configuredEl.textContent = data.configured ? 'Sí' : 'No';
    configuredEl.className = `status-value ${data.configured ? 'ok' : 'error'}`;

    // Connection status
    const connectedEl = document.getElementById('status-connected');
    connectedEl.textContent = data.status.connected ? 'Conectado' : 'Desconectado';
    connectedEl.className = `status-value ${data.status.connected ? 'ok' : 'error'}`;

    // Realtime status
    const realtimeEl = document.getElementById('status-realtime');
    realtimeEl.textContent = data.status.realtimeStatus || '-';
    realtimeEl.className = `status-value ${
      data.status.realtimeStatus === 'SUBSCRIBED' ? 'ok' :
      data.status.realtimeStatus === 'polling' ? 'warning' : ''
    }`;

    // Orders processed
    document.getElementById('status-orders').textContent =
      data.status.ordersProcessed || 0;

    // Device info
    if (data.config) {
      document.getElementById('info-device-id').textContent =
        data.config.deviceId || '-';
      document.getElementById('info-restaurant').textContent =
        data.config.restaurantName || data.config.restaurantId || '-';
      document.getElementById('info-printer').textContent =
        data.config.hasPrinter ? 'Configurada' : 'No configurada';
    } else {
      document.getElementById('info-device-id').textContent = '-';
      document.getElementById('info-restaurant').textContent = '-';
      document.getElementById('info-printer').textContent = '-';
    }
  } catch (error) {
    showToast('Error cargando estado', 'error');
  }
}

// Load Config
async function loadConfig() {
  try {
    const data = await api('/config');

    if (data.configured) {
      document.getElementById('deviceId').value = data.deviceId || '';
      document.getElementById('deviceToken').value = '';
      document.getElementById('deviceToken').placeholder = data.deviceToken || 'Token de autenticación';
      document.getElementById('restaurantId').value = data.restaurantId || '';
      document.getElementById('restaurantName').value = data.restaurantName || '';
      document.getElementById('supabaseUrl').value = data.supabaseUrl || '';
      document.getElementById('supabaseKey').value = '';
      document.getElementById('supabaseKey').placeholder = data.supabaseKey || 'eyJhbGci...';
      document.getElementById('frontendUrl').value = data.frontendUrl || '';
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
}

// Save Config
document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const config = Object.fromEntries(formData);

  // Don't send empty passwords (keep existing)
  if (!config.deviceToken) delete config.deviceToken;
  if (!config.supabaseKey) delete config.supabaseKey;

  try {
    const result = await api('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });

    showToast(result.message || 'Configuración guardada', 'success');
  } catch (error) {
    showToast(error.message || 'Error guardando configuración', 'error');
  }
});

// Reset Config
document.getElementById('reset-config').addEventListener('click', async () => {
  if (!confirm('¿Estás seguro de resetear la configuración?')) return;

  try {
    await api('/config/reset', { method: 'POST' });
    showToast('Configuración reseteada', 'success');

    // Clear form
    document.getElementById('config-form').reset();
  } catch (error) {
    showToast('Error reseteando configuración', 'error');
  }
});

// Load Printers
async function loadPrinters() {
  const listEl = document.getElementById('printer-list');
  listEl.innerHTML = '<p class="loading">Buscando impresoras...</p>';

  try {
    const data = await api('/printers');

    if (!data.printers || data.printers.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No se encontraron impresoras USB</p>';
      return;
    }

    listEl.innerHTML = data.printers.map(printer => `
      <div class="printer-item" data-vendor="${printer.vendorId}" data-product="${printer.productId}" data-path="${printer.devicePath || ''}">
        <div class="printer-info">
          <span class="printer-name">${printer.vendorName || 'Impresora USB'}</span>
          <span class="printer-path">${printer.devicePath || `${printer.vendorId}:${printer.productId}`}</span>
        </div>
        <div class="printer-check"></div>
      </div>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.printer-item').forEach(item => {
      item.addEventListener('click', () => selectPrinter(item));
    });
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error detectando impresoras</p>';
  }
}

// Select Printer
async function selectPrinter(item) {
  // Remove previous selection
  document.querySelectorAll('.printer-item').forEach(i => {
    i.classList.remove('selected');
    i.querySelector('.printer-check').textContent = '';
  });

  // Select this one
  item.classList.add('selected');
  item.querySelector('.printer-check').textContent = '✓';

  selectedPrinter = {
    vendorId: item.dataset.vendor,
    productId: item.dataset.product,
    devicePath: item.dataset.path,
  };

  // Save printer config
  try {
    await api('/printers/config', {
      method: 'POST',
      body: JSON.stringify(selectedPrinter),
    });
    showToast('Impresora seleccionada', 'success');
  } catch (error) {
    showToast('Error guardando impresora', 'error');
  }
}

// Scan Printers
document.getElementById('scan-printers').addEventListener('click', loadPrinters);

// Test Print
document.getElementById('test-print').addEventListener('click', async () => {
  const resultEl = document.getElementById('print-result');
  resultEl.className = 'result-message';
  resultEl.style.display = 'none';

  const btn = document.getElementById('test-print');
  btn.disabled = true;
  btn.textContent = 'Imprimiendo...';

  try {
    const result = await api('/printers/test', { method: 'POST' });
    resultEl.textContent = result.message || 'Prueba impresa correctamente';
    resultEl.className = 'result-message success';
  } catch (error) {
    resultEl.textContent = error.message || 'Error al imprimir';
    resultEl.className = 'result-message error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Imprimir Prueba';
  }
});

// Refresh Status
document.getElementById('refresh-status').addEventListener('click', () => {
  loadStatus();
  showToast('Estado actualizado', 'success');
});

// Initial load
loadStatus();
