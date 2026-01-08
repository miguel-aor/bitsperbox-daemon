// BitsperBox Web UI

const API_BASE = '/api';

// State
let selectedPrinter = null;
let currentPrinterType = 'usb';

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

// Printer Type Tabs
const printerTabs = document.querySelectorAll('.printer-tab');
const printerSections = document.querySelectorAll('.printer-section');

printerTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const printerTabId = tab.dataset.printerTab;
    currentPrinterType = printerTabId;

    printerTabs.forEach(t => t.classList.remove('active'));
    printerSections.forEach(s => s.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(`${printerTabId}-section`).classList.add('active');

    // Load data for printer type
    if (printerTabId === 'usb') loadPrinters();
    if (printerTabId === 'bluetooth') loadBluetoothDevices();
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

// Select USB Printer
async function selectPrinter(item) {
  // Remove previous selection
  document.querySelectorAll('#printer-list .printer-item').forEach(i => {
    i.classList.remove('selected');
    i.querySelector('.printer-check').textContent = '';
  });

  // Select this one
  item.classList.add('selected');
  item.querySelector('.printer-check').textContent = '✓';

  const printerConfig = {
    type: 'usb',
    vendorId: parseInt(item.dataset.vendor),
    productId: parseInt(item.dataset.product),
    devicePath: item.dataset.path,
  };

  // Save printer config
  try {
    await api('/printers/config', {
      method: 'POST',
      body: JSON.stringify(printerConfig),
    });
    showToast('Impresora USB seleccionada', 'success');
  } catch (error) {
    showToast('Error guardando impresora', 'error');
  }
}

// Scan Printers
document.getElementById('scan-printers').addEventListener('click', loadPrinters);

// ============================================
// Network Printer Functions
// ============================================

// Test Network Connection
document.getElementById('test-network').addEventListener('click', async () => {
  const ip = document.getElementById('network-ip').value.trim();
  const port = document.getElementById('network-port').value || '9100';
  const statusEl = document.getElementById('network-status');

  if (!ip) {
    showToast('Ingresa la dirección IP', 'error');
    return;
  }

  statusEl.textContent = 'Probando...';
  statusEl.className = 'connection-status testing';

  try {
    const result = await api('/printers/network/test', {
      method: 'POST',
      body: JSON.stringify({ ip, port: parseInt(port) }),
    });

    if (result.success) {
      statusEl.textContent = '✓ Conectado';
      statusEl.className = 'connection-status success';
    } else {
      statusEl.textContent = '✗ Sin conexión';
      statusEl.className = 'connection-status error';
    }
  } catch (error) {
    statusEl.textContent = '✗ Error';
    statusEl.className = 'connection-status error';
  }
});

// Save Network Printer
document.getElementById('save-network').addEventListener('click', async () => {
  const ip = document.getElementById('network-ip').value.trim();
  const port = document.getElementById('network-port').value || '9100';

  if (!ip) {
    showToast('Ingresa la dirección IP', 'error');
    return;
  }

  const printerConfig = {
    type: 'network',
    ip,
    port: parseInt(port),
  };

  try {
    await api('/printers/config', {
      method: 'POST',
      body: JSON.stringify(printerConfig),
    });
    showToast('Impresora de red guardada', 'success');
  } catch (error) {
    showToast('Error guardando impresora', 'error');
  }
});

// ============================================
// Bluetooth Printer Functions
// ============================================

// Load paired Bluetooth devices
async function loadBluetoothDevices() {
  const listEl = document.getElementById('bluetooth-list');
  listEl.innerHTML = '<p class="loading">Cargando dispositivos...</p>';

  try {
    const data = await api('/bluetooth/devices');

    if (!data.devices || data.devices.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No hay dispositivos pareados</p>';
      return;
    }

    listEl.innerHTML = data.devices.map(device => `
      <div class="printer-item bluetooth-device" data-address="${device.address}" data-name="${device.name}">
        <div class="printer-info">
          <span class="printer-name">${device.name || 'Dispositivo Bluetooth'}</span>
          <span class="printer-path">${device.address}</span>
        </div>
        <div class="printer-check"></div>
      </div>
    `).join('');

    // Add click handlers
    document.querySelectorAll('.bluetooth-device').forEach(item => {
      item.addEventListener('click', () => selectBluetoothDevice(item));
    });
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error cargando dispositivos</p>';
  }
}

// Select Bluetooth device and save config
async function selectBluetoothDevice(item) {
  // Remove previous selection
  document.querySelectorAll('#bluetooth-list .printer-item').forEach(i => {
    i.classList.remove('selected');
    i.querySelector('.printer-check').textContent = '';
  });

  // Select this one
  item.classList.add('selected');
  item.querySelector('.printer-check').textContent = '✓';

  const printerConfig = {
    type: 'bluetooth',
    bluetoothAddress: item.dataset.address,
    bluetoothName: item.dataset.name,
  };

  // Save printer config
  try {
    await api('/printers/config', {
      method: 'POST',
      body: JSON.stringify(printerConfig),
    });
    showToast('Impresora Bluetooth guardada', 'success');
  } catch (error) {
    showToast('Error guardando impresora', 'error');
  }
}

// Scan for new Bluetooth devices
document.getElementById('scan-bluetooth').addEventListener('click', async () => {
  const listEl = document.getElementById('bluetooth-list');
  const scanningEl = document.getElementById('bluetooth-scanning');
  const btn = document.getElementById('scan-bluetooth');

  btn.disabled = true;
  scanningEl.style.display = 'flex';

  try {
    const data = await api('/bluetooth/scan');

    if (!data.devices || data.devices.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No se encontraron dispositivos</p>';
    } else {
      listEl.innerHTML = data.devices.map(device => `
        <div class="printer-item bluetooth-device ${device.paired ? '' : 'unpaired'}"
             data-address="${device.address}"
             data-name="${device.name}"
             data-paired="${device.paired}">
          <div class="printer-info">
            <span class="printer-name">${device.name || 'Dispositivo'}</span>
            <span class="printer-path">${device.address} ${device.paired ? '(pareado)' : '(nuevo)'}</span>
          </div>
          <div class="printer-check">${device.paired ? '' : '+'}</div>
        </div>
      `).join('');

      // Add click handlers
      document.querySelectorAll('.bluetooth-device').forEach(item => {
        item.addEventListener('click', () => {
          if (item.dataset.paired === 'true') {
            selectBluetoothDevice(item);
          } else {
            pairBluetoothDevice(item.dataset.address, item.dataset.name);
          }
        });
      });
    }

    showToast('Escaneo completado', 'success');
  } catch (error) {
    showToast('Error escaneando Bluetooth', 'error');
  } finally {
    btn.disabled = false;
    scanningEl.style.display = 'none';
  }
});

// Load paired devices button
document.getElementById('load-bluetooth').addEventListener('click', loadBluetoothDevices);

// Pair with a Bluetooth device
async function pairBluetoothDevice(address, name) {
  showToast(`Pareando con ${name || address}...`, 'info');

  try {
    const result = await api('/bluetooth/pair', {
      method: 'POST',
      body: JSON.stringify({ address }),
    });

    if (result.success) {
      showToast('Dispositivo pareado correctamente', 'success');
      // Reload the list
      loadBluetoothDevices();
    } else {
      showToast(result.error || 'Error al parear', 'error');
    }
  } catch (error) {
    showToast('Error al parear dispositivo', 'error');
  }
}

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

// ============================================
// Multi-Printer Functions
// ============================================

// Multi-printer state
let mpLocalPrinters = [];
let mpAssignments = [];
let mpStations = [];

// Add type tabs for multi-printer
const mpAddTabs = document.querySelectorAll('.mp-add-tab');
const mpAddSections = document.querySelectorAll('.mp-add-section');

mpAddTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const addType = tab.dataset.addType;

    mpAddTabs.forEach(t => t.classList.remove('active'));
    mpAddSections.forEach(s => s.classList.remove('active'));

    tab.classList.add('active');
    document.getElementById(`mp-add-${addType}`).classList.add('active');

    // Load data for the section
    if (addType === 'usb') mpScanUSB();
    if (addType === 'bluetooth') mpLoadBluetoothPaired();
  });
});

// Load multi-printer data when tab is clicked
tabs.forEach(tab => {
  const originalClick = tab.onclick;
  tab.addEventListener('click', () => {
    if (tab.dataset.tab === 'multi-printer') {
      loadMultiPrinterData();
    }
  });
});

// Load all multi-printer data
async function loadMultiPrinterData() {
  await Promise.all([
    mpLoadLocalPrinters(),
    mpLoadAssignments(),
    mpLoadSyncSetting(),
  ]);
  mpScanUSB();
}

// Load local printers
async function mpLoadLocalPrinters() {
  const listEl = document.getElementById('mp-printer-list');
  listEl.innerHTML = '<p class="loading">Cargando impresoras...</p>';

  try {
    const data = await api('/printers/local');
    mpLocalPrinters = data.printers || [];

    if (mpLocalPrinters.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No hay impresoras registradas. Agrega una abajo.</p>';
    } else {
      listEl.innerHTML = mpLocalPrinters.map(printer => `
        <div class="mp-printer-card" data-id="${printer.id}">
          <div class="mp-printer-icon">${getPrinterIcon(printer.type)}</div>
          <div class="mp-printer-details">
            <strong>${printer.name}</strong>
            <small>${getPrinterInfo(printer)}</small>
            <span class="mp-printer-status ${printer.status || 'unknown'}">${getStatusText(printer.status)}</span>
          </div>
          <div class="mp-printer-actions">
            <button class="btn btn-sm btn-secondary" onclick="mpTestPrinter('${printer.id}')">Probar</button>
            <button class="btn btn-sm btn-danger" onclick="mpRemovePrinter('${printer.id}')">×</button>
          </div>
        </div>
      `).join('');
    }

    // Update role dropdowns
    mpUpdateRoleDropdowns();
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error cargando impresoras</p>';
    console.error('Error loading local printers:', error);
  }
}

// Helper functions for printer display
function getPrinterIcon(type) {
  switch (type) {
    case 'usb': return '🔌';
    case 'network': return '🌐';
    case 'bluetooth': return '📶';
    default: return '🖨️';
  }
}

function getPrinterInfo(printer) {
  switch (printer.type) {
    case 'usb':
      return printer.devicePath || `VID:${printer.vendorId} PID:${printer.productId}`;
    case 'network':
      return `${printer.ip}:${printer.port || 9100}`;
    case 'bluetooth':
      return printer.bluetoothAddress || printer.bluetoothName;
    default:
      return printer.type;
  }
}

function getStatusText(status) {
  switch (status) {
    case 'ready': return '● Listo';
    case 'error': return '● Error';
    case 'disconnected': return '● Desconectado';
    default: return '○ Desconocido';
  }
}

// Update role dropdown options
function mpUpdateRoleDropdowns() {
  const selects = ['mp-role-customer', 'mp-role-kitchen', 'mp-role-fiscal'];

  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    const currentValue = select.value;

    // Clear and rebuild options
    select.innerHTML = '<option value="">Sin asignar</option>';
    mpLocalPrinters.forEach(printer => {
      const option = document.createElement('option');
      option.value = printer.id;
      option.textContent = `${getPrinterIcon(printer.type)} ${printer.name}`;
      select.appendChild(option);
    });

    // Restore selection
    if (currentValue) select.value = currentValue;
  });

  // Also update station dropdowns if they exist
  mpUpdateStationDropdowns();
}

// Update station dropdowns
function mpUpdateStationDropdowns() {
  document.querySelectorAll('.mp-station-select').forEach(select => {
    const currentValue = select.value;

    select.innerHTML = '<option value="">Sin asignar</option>';
    mpLocalPrinters.forEach(printer => {
      const option = document.createElement('option');
      option.value = printer.id;
      option.textContent = `${getPrinterIcon(printer.type)} ${printer.name}`;
      select.appendChild(option);
    });

    if (currentValue) select.value = currentValue;
  });
}

// Load assignments
async function mpLoadAssignments() {
  try {
    const data = await api('/printers/assignments');
    mpAssignments = data.assignments || [];

    // Apply role assignments to dropdowns
    mpAssignments.forEach(assignment => {
      if (assignment.role === 'customer_ticket') {
        document.getElementById('mp-role-customer').value = assignment.localPrinterId;
        document.getElementById('mp-drawer-customer').checked = assignment.cashDrawerEnabled || false;
      } else if (assignment.role === 'kitchen_default') {
        document.getElementById('mp-role-kitchen').value = assignment.localPrinterId;
      } else if (assignment.role === 'fiscal') {
        document.getElementById('mp-role-fiscal').value = assignment.localPrinterId;
      }
    });

    // Apply station assignments
    mpStations = mpAssignments.filter(a => a.role === 'station');
    mpRenderStations();
  } catch (error) {
    console.error('Error loading assignments:', error);
  }
}

// Render station assignments
function mpRenderStations() {
  const listEl = document.getElementById('mp-stations-list');

  if (mpStations.length === 0) {
    listEl.innerHTML = '<p class="no-stations">No hay estaciones configuradas. Sincroniza con el dashboard.</p>';
    return;
  }

  listEl.innerHTML = mpStations.map(station => `
    <div class="mp-station-row" data-station-id="${station.stationId}">
      <div class="mp-station-label">
        <span class="mp-station-icon">🍳</span>
        <span>${station.stationName || station.stationId}</span>
      </div>
      <select class="mp-station-select mp-select" data-station-id="${station.stationId}">
        <option value="">Sin asignar</option>
        ${mpLocalPrinters.map(p => `
          <option value="${p.id}" ${p.id === station.localPrinterId ? 'selected' : ''}>
            ${getPrinterIcon(p.type)} ${p.name}
          </option>
        `).join('')}
      </select>
    </div>
  `).join('');
}

// Load sync setting
async function mpLoadSyncSetting() {
  try {
    const data = await api('/printers/sync-setting');
    document.getElementById('mp-auto-sync').checked = data.syncWithDashboard || false;
  } catch (error) {
    console.error('Error loading sync setting:', error);
  }
}

// Scan USB printers for adding
async function mpScanUSB() {
  const listEl = document.getElementById('mp-usb-detected');
  listEl.innerHTML = '<p class="loading">Escaneando...</p>';

  try {
    const data = await api('/printers');
    const printers = data.printers || [];

    if (printers.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No se detectaron impresoras USB</p>';
      return;
    }

    // Filter out already registered printers
    const registeredIds = new Set(mpLocalPrinters.filter(p => p.type === 'usb').map(p => `${p.vendorId}:${p.productId}`));
    const available = printers.filter(p => !registeredIds.has(`${p.vendorId}:${p.productId}`));

    if (available.length === 0) {
      listEl.innerHTML = '<p class="no-printers">Todas las impresoras USB ya están registradas</p>';
      return;
    }

    listEl.innerHTML = available.map(printer => `
      <div class="mp-detected-item" data-vendor="${printer.vendorId}" data-product="${printer.productId}" data-path="${printer.devicePath || ''}">
        <span class="mp-detected-name">${printer.vendorName || 'Impresora USB'}</span>
        <span class="mp-detected-info">${printer.devicePath || `${printer.vendorId}:${printer.productId}`}</span>
        <button class="btn btn-sm btn-primary" onclick="mpAddUSBPrinter(this.parentElement)">Agregar</button>
      </div>
    `).join('');
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error escaneando USB</p>';
  }
}

// Add USB printer
async function mpAddUSBPrinter(element) {
  const name = element.querySelector('.mp-detected-name').textContent;
  const printer = {
    name,
    type: 'usb',
    vendorId: parseInt(element.dataset.vendor),
    productId: parseInt(element.dataset.product),
    devicePath: element.dataset.path,
  };

  try {
    await api('/printers/local', {
      method: 'POST',
      body: JSON.stringify(printer),
    });
    showToast(`${name} agregada`, 'success');
    await mpLoadLocalPrinters();
    mpScanUSB();
  } catch (error) {
    showToast('Error agregando impresora', 'error');
  }
}

// Scan USB button
document.getElementById('mp-scan-usb').addEventListener('click', mpScanUSB);

// Add network printer
document.getElementById('mp-add-network-btn').addEventListener('click', async () => {
  const name = document.getElementById('mp-net-name').value.trim();
  const ip = document.getElementById('mp-net-ip').value.trim();
  const port = parseInt(document.getElementById('mp-net-port').value) || 9100;

  if (!name || !ip) {
    showToast('Completa nombre e IP', 'error');
    return;
  }

  const printer = { name, type: 'network', ip, port };

  try {
    await api('/printers/local', {
      method: 'POST',
      body: JSON.stringify(printer),
    });
    showToast(`${name} agregada`, 'success');
    document.getElementById('mp-net-name').value = '';
    document.getElementById('mp-net-ip').value = '';
    await mpLoadLocalPrinters();
  } catch (error) {
    showToast('Error agregando impresora', 'error');
  }
});

// Load paired Bluetooth devices for multi-printer
async function mpLoadBluetoothPaired() {
  const listEl = document.getElementById('mp-bt-detected');
  listEl.innerHTML = '<p class="loading">Cargando...</p>';

  try {
    const data = await api('/bluetooth/devices');
    const devices = data.devices || [];

    if (devices.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No hay dispositivos pareados</p>';
      return;
    }

    // Filter out already registered
    const registeredAddrs = new Set(mpLocalPrinters.filter(p => p.type === 'bluetooth').map(p => p.bluetoothAddress));
    const available = devices.filter(d => !registeredAddrs.has(d.address));

    if (available.length === 0) {
      listEl.innerHTML = '<p class="no-printers">Todos los dispositivos ya están registrados</p>';
      return;
    }

    listEl.innerHTML = available.map(device => `
      <div class="mp-detected-item" data-address="${device.address}" data-name="${device.name}">
        <span class="mp-detected-name">${device.name || 'Dispositivo BT'}</span>
        <span class="mp-detected-info">${device.address}</span>
        <button class="btn btn-sm btn-primary" onclick="mpAddBluetoothPrinter(this.parentElement)">Agregar</button>
      </div>
    `).join('');
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error cargando Bluetooth</p>';
  }
}

// Add Bluetooth printer
async function mpAddBluetoothPrinter(element) {
  const name = element.querySelector('.mp-detected-name').textContent;
  const printer = {
    name,
    type: 'bluetooth',
    bluetoothAddress: element.dataset.address,
    bluetoothName: element.dataset.name,
  };

  try {
    await api('/printers/local', {
      method: 'POST',
      body: JSON.stringify(printer),
    });
    showToast(`${name} agregada`, 'success');
    await mpLoadLocalPrinters();
    mpLoadBluetoothPaired();
  } catch (error) {
    showToast('Error agregando impresora', 'error');
  }
}

// Bluetooth buttons
document.getElementById('mp-scan-bt').addEventListener('click', async () => {
  const listEl = document.getElementById('mp-bt-detected');
  listEl.innerHTML = '<p class="loading">Escaneando...</p>';

  try {
    const data = await api('/bluetooth/scan');
    const devices = data.devices || [];

    if (devices.length === 0) {
      listEl.innerHTML = '<p class="no-printers">No se encontraron dispositivos</p>';
      return;
    }

    const registeredAddrs = new Set(mpLocalPrinters.filter(p => p.type === 'bluetooth').map(p => p.bluetoothAddress));

    listEl.innerHTML = devices.map(device => `
      <div class="mp-detected-item ${registeredAddrs.has(device.address) ? 'registered' : ''}" data-address="${device.address}" data-name="${device.name}">
        <span class="mp-detected-name">${device.name || 'Dispositivo'}</span>
        <span class="mp-detected-info">${device.address} ${device.paired ? '(pareado)' : ''}</span>
        ${registeredAddrs.has(device.address) ? '<span class="registered-badge">Registrado</span>' :
          `<button class="btn btn-sm btn-primary" onclick="mpAddBluetoothPrinter(this.parentElement)">Agregar</button>`}
      </div>
    `).join('');
  } catch (error) {
    listEl.innerHTML = '<p class="no-printers">Error escaneando</p>';
  }
});

document.getElementById('mp-load-bt').addEventListener('click', mpLoadBluetoothPaired);

// Test printer
async function mpTestPrinter(printerId) {
  showToast('Probando impresora...', 'info');

  try {
    const result = await api(`/printers/${printerId}/test`, { method: 'POST' });
    if (result.success) {
      showToast('Conexión OK', 'success');
    } else {
      showToast('Error de conexión', 'error');
    }
    await mpLoadLocalPrinters();
  } catch (error) {
    showToast('Error probando impresora', 'error');
  }
}

// Remove printer
async function mpRemovePrinter(printerId) {
  if (!confirm('¿Eliminar esta impresora?')) return;

  try {
    await api(`/printers/local/${printerId}`, { method: 'DELETE' });
    showToast('Impresora eliminada', 'success');
    await mpLoadLocalPrinters();
  } catch (error) {
    showToast('Error eliminando impresora', 'error');
  }
}

// Refresh printers button
document.getElementById('mp-refresh-printers').addEventListener('click', mpLoadLocalPrinters);

// Sync with dashboard
document.getElementById('mp-sync-dashboard').addEventListener('click', async () => {
  const statusEl = document.getElementById('mp-sync-status');
  statusEl.textContent = 'Sincronizando...';
  statusEl.className = 'connection-status testing';

  try {
    const result = await api('/printers/multi-status');

    if (result.dashboardSettings) {
      // Show preview
      const previewEl = document.getElementById('mp-dashboard-preview');
      const infoEl = document.getElementById('mp-dashboard-info');
      previewEl.style.display = 'block';

      infoEl.innerHTML = `
        <div class="mp-dashboard-item">
          <strong>Ticket Cliente:</strong> ${result.dashboardSettings.customer_ticket_printer?.enabled ? '✓ Habilitado' : '✗ Deshabilitado'}
        </div>
        <div class="mp-dashboard-item">
          <strong>Cocina Default:</strong> ${result.dashboardSettings.kitchen_default_printer?.enabled ? '✓ Habilitado' : '✗ Deshabilitado'}
        </div>
        <div class="mp-dashboard-item">
          <strong>Estaciones:</strong> ${result.stations?.length || 0} configuradas
        </div>
      `;

      // Update stations from dashboard
      if (result.stations && result.stations.length > 0) {
        mpStations = result.stations.map(s => ({
          role: 'station',
          stationId: s.stationId,
          stationName: s.stationName,
          localPrinterId: '',
        }));
        mpRenderStations();
      }

      statusEl.textContent = '✓ Sincronizado';
      statusEl.className = 'connection-status success';
      showToast('Dashboard sincronizado', 'success');
    } else {
      statusEl.textContent = 'Sin datos';
      statusEl.className = 'connection-status warning';
    }
  } catch (error) {
    statusEl.textContent = '✗ Error';
    statusEl.className = 'connection-status error';
    showToast('Error sincronizando', 'error');
  }
});

// Sync stations button
document.getElementById('mp-sync-stations').addEventListener('click', () => {
  document.getElementById('mp-sync-dashboard').click();
});

// Save auto-sync setting
document.getElementById('mp-auto-sync').addEventListener('change', async (e) => {
  try {
    await api('/printers/sync-setting', {
      method: 'POST',
      body: JSON.stringify({ syncWithDashboard: e.target.checked }),
    });
    showToast(`Auto-sync ${e.target.checked ? 'activado' : 'desactivado'}`, 'success');
  } catch (error) {
    showToast('Error guardando configuración', 'error');
    e.target.checked = !e.target.checked;
  }
});

// Save all multi-printer configuration
document.getElementById('mp-save-all').addEventListener('click', async () => {
  const btn = document.getElementById('mp-save-all');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    // Build assignments from UI
    const assignments = [];

    // Customer ticket role
    const customerPrinter = document.getElementById('mp-role-customer').value;
    if (customerPrinter) {
      assignments.push({
        role: 'customer_ticket',
        localPrinterId: customerPrinter,
        cashDrawerEnabled: document.getElementById('mp-drawer-customer').checked,
      });
    }

    // Kitchen default role
    const kitchenPrinter = document.getElementById('mp-role-kitchen').value;
    if (kitchenPrinter) {
      assignments.push({
        role: 'kitchen_default',
        localPrinterId: kitchenPrinter,
      });
    }

    // Fiscal role
    const fiscalPrinter = document.getElementById('mp-role-fiscal').value;
    if (fiscalPrinter) {
      assignments.push({
        role: 'fiscal',
        localPrinterId: fiscalPrinter,
      });
    }

    // Station assignments
    document.querySelectorAll('.mp-station-select').forEach(select => {
      if (select.value) {
        const stationId = select.dataset.stationId;
        const station = mpStations.find(s => s.stationId === stationId);
        assignments.push({
          role: 'station',
          stationId,
          stationName: station?.stationName || stationId,
          localPrinterId: select.value,
        });
      }
    });

    // Save assignments
    await api('/printers/assignments', {
      method: 'POST',
      body: JSON.stringify({ assignments }),
    });

    showToast('Configuración guardada. Reinicia el daemon para aplicar.', 'success');
  } catch (error) {
    showToast('Error guardando configuración', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar Toda la Configuración';
  }
});

// Initial load
loadStatus();
