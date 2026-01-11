#include "web_portal.h"
#include "wifi_manager.h"
#include "config.h"
#include <BLEDevice.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>

WebPortal Portal;

// BLE scan results storage
static String bleDevicesJson = "[]";
static bool bleScanComplete = false;

void WebPortal::begin() {
    if (_running) return;

    _server = new WebServer(80);
    _dns = new DNSServer();

    // Captive portal - redirect all DNS to our IP
    _dns->start(53, "*", WiFi.softAPIP());

    // Routes
    _server->on("/", HTTP_GET, [this]() { handleRoot(); });
    _server->on("/save", HTTP_POST, [this]() { handleSave(); });
    _server->on("/scan", HTTP_GET, [this]() { handleScan(); });
    _server->on("/scanble", HTTP_GET, [this]() { handleScanBLE(); });
    _server->onNotFound([this]() { handleNotFound(); });

    _server->begin();
    _running = true;

    Serial.println("[Portal] Web server started on port 80");
}

void WebPortal::stop() {
    if (!_running) return;

    _dns->stop();
    _server->stop();

    delete _dns;
    delete _server;
    _dns = nullptr;
    _server = nullptr;
    _running = false;

    Serial.println("[Portal] Web server stopped");
}

void WebPortal::handleClient() {
    if (!_running) return;
    _dns->processNextRequest();
    _server->handleClient();
}

bool WebPortal::isRunning() {
    return _running;
}

void WebPortal::onConfigSaved(std::function<void()> callback) {
    _onConfigSaved = callback;
}

void WebPortal::handleRoot() {
    _server->send(200, "text/html", generateHTML());
}

void WebPortal::handleSave() {
    DeviceConfig config;
    memset(&config, 0, sizeof(DeviceConfig));

    // Get form data
    if (_server->hasArg("ssid")) {
        strncpy(config.wifi_ssid, _server->arg("ssid").c_str(), sizeof(config.wifi_ssid) - 1);
    }
    if (_server->hasArg("password")) {
        strncpy(config.wifi_password, _server->arg("password").c_str(), sizeof(config.wifi_password) - 1);
    }
    if (_server->hasArg("mode")) {
        strncpy(config.mode, _server->arg("mode").c_str(), sizeof(config.mode) - 1);
    }
    if (_server->hasArg("device_name")) {
        strncpy(config.device_name, _server->arg("device_name").c_str(), sizeof(config.device_name) - 1);
    }

    // Connection mode (wifi, ble, both)
    if (_server->hasArg("conn_mode")) {
        strncpy(config.connection_mode, _server->arg("conn_mode").c_str(), sizeof(config.connection_mode) - 1);
    } else {
        strncpy(config.connection_mode, "both", sizeof(config.connection_mode) - 1);
    }

    // BitsperBox mode
    if (_server->hasArg("bb_ip")) {
        strncpy(config.bitsperbox_ip, _server->arg("bb_ip").c_str(), sizeof(config.bitsperbox_ip) - 1);
    }
    config.bitsperbox_port = _server->hasArg("bb_port") ?
        _server->arg("bb_port").toInt() : 3334;

    // BLE settings
    if (_server->hasArg("ble_addr")) {
        strncpy(config.ble_server_address, _server->arg("ble_addr").c_str(), sizeof(config.ble_server_address) - 1);
    }
    if (_server->hasArg("ble_name")) {
        strncpy(config.ble_server_name, _server->arg("ble_name").c_str(), sizeof(config.ble_server_name) - 1);
    }

    // Direct mode (Supabase)
    if (_server->hasArg("sb_url")) {
        strncpy(config.supabase_url, _server->arg("sb_url").c_str(), sizeof(config.supabase_url) - 1);
    }
    if (_server->hasArg("sb_key")) {
        strncpy(config.supabase_key, _server->arg("sb_key").c_str(), sizeof(config.supabase_key) - 1);
    }
    if (_server->hasArg("rest_id")) {
        strncpy(config.restaurant_id, _server->arg("rest_id").c_str(), sizeof(config.restaurant_id) - 1);
    }

    config.configured = true;

    // Save config
    Storage.saveConfig(config);

    // Send success response
    String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
        "<title>BitsperWatch - Guardado</title>"
        "<style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;background:#1a1a2e;color:#fff;"
        "display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;padding:20px;}"
        ".card{background:#16213e;padding:30px;border-radius:20px;text-align:center;width:100%;max-width:360px;}"
        "h1{color:#00d9ff;font-size:24px;margin:0 0 10px;}p{color:#aaa;margin:0;}"
        ".icon{font-size:60px;margin-bottom:20px;}</style></head><body>"
        "<div class='card'><div class='icon'>&#10004;</div><h1>Configuracion Guardada</h1>"
        "<p>Reiniciando en 3 segundos...</p></div></body></html>");

    _server->send(200, "text/html", html);

    Serial.println("[Portal] Configuration saved!");

    // Notify callback
    if (_onConfigSaved) {
        _onConfigSaved();
    }
}

void WebPortal::handleScan() {
    _server->send(200, "application/json", scanNetworks());
}

void WebPortal::handleScanBLE() {
    _server->send(200, "application/json", scanBLEDevices());
}

void WebPortal::handleNotFound() {
    // Captive portal - redirect to root
    _server->sendHeader("Location", "http://192.168.4.1/", true);
    _server->send(302, "text/plain", "");
}

String WebPortal::scanNetworks() {
    int n = WiFi.scanNetworks();
    String json = "[";

    for (int i = 0; i < n; i++) {
        if (i > 0) json += ",";
        json += "{";
        json += "\"ssid\":\"" + WiFi.SSID(i) + "\",";
        json += "\"rssi\":" + String(WiFi.RSSI(i)) + ",";
        json += "\"encrypted\":" + String(WiFi.encryptionType(i) != WIFI_AUTH_OPEN ? "true" : "false");
        json += "}";
    }

    json += "]";
    WiFi.scanDelete();
    return json;
}

String WebPortal::scanBLEDevices() {
    Serial.println("[Portal] Starting BLE scan...");

    // Initialize BLE if not already done
    if (!BLEDevice::getInitialized()) {
        BLEDevice::init("BitsperWatch");
    }

    BLEScan* pBLEScan = BLEDevice::getScan();
    pBLEScan->setActiveScan(true);
    pBLEScan->setInterval(100);
    pBLEScan->setWindow(99);

    // Scan for 5 seconds
    BLEScanResults* pResults = pBLEScan->start(5, false);

    int count = pResults->getCount();
    Serial.printf("[Portal] BLE scan complete. Found %d devices\n", count);

    String json = "[";
    int added = 0;

    for (int i = 0; i < count; i++) {
        BLEAdvertisedDevice device = pResults->getDevice(i);

        // Get device info
        String name = device.haveName() ? device.getName().c_str() : "";
        String addr = device.getAddress().toString().c_str();
        int rssi = device.getRSSI();

        // Skip devices without names (likely not BitsperBox)
        // But include all for now so user can see what's available
        if (added > 0) json += ",";
        json += "{";
        json += "\"name\":\"" + (name.length() > 0 ? name : "(Sin nombre)") + "\",";
        json += "\"address\":\"" + addr + "\",";
        json += "\"rssi\":" + String(rssi);
        json += "}";
        added++;

        Serial.printf("[Portal]   - %s (%s) RSSI: %d\n",
                      name.length() > 0 ? name.c_str() : "(no name)",
                      addr.c_str(), rssi);
    }

    json += "]";

    pBLEScan->clearResults();

    return json;
}

String WebPortal::generateHTML() {
    String deviceId = Storage.getDeviceId();

    String html = F(R"rawhtml(
<!DOCTYPE html>
<html>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no'>
    <title>BitsperWatch Setup</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            padding: 20px;
            padding-bottom: 100px;
        }
        .container { max-width: 400px; margin: 0 auto; }

        /* Header */
        .header {
            text-align: center;
            padding: 20px 0 30px;
        }
        .header h1 {
            color: #00d9ff;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
        }
        .header .device-id {
            color: #666;
            font-size: 12px;
            font-family: monospace;
        }

        /* Cards */
        .card {
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 16px;
            border: 1px solid rgba(255,255,255,0.1);
        }
        .card h2 {
            font-size: 14px;
            color: #00d9ff;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .card h2 .num {
            background: #00d9ff;
            color: #000;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: 700;
        }

        /* Form elements */
        label {
            display: block;
            color: #888;
            font-size: 13px;
            margin-bottom: 6px;
        }
        input[type="text"], input[type="password"], input[type="number"], select {
            width: 100%;
            padding: 14px 16px;
            border: 2px solid rgba(255,255,255,0.1);
            border-radius: 12px;
            background: rgba(0,0,0,0.3);
            color: #fff;
            font-size: 16px;
            margin-bottom: 12px;
            -webkit-appearance: none;
        }
        input:focus, select:focus {
            outline: none;
            border-color: #00d9ff;
        }

        /* Connection type selector - BIG buttons */
        .conn-type-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
            margin-bottom: 8px;
        }
        .conn-btn {
            padding: 20px 12px;
            border: 2px solid rgba(255,255,255,0.2);
            border-radius: 16px;
            background: rgba(0,0,0,0.2);
            cursor: pointer;
            text-align: center;
            transition: all 0.2s;
        }
        .conn-btn.full-width {
            grid-column: span 2;
        }
        .conn-btn:hover {
            border-color: rgba(0,217,255,0.5);
        }
        .conn-btn.selected {
            border-color: #00d9ff;
            background: rgba(0,217,255,0.15);
        }
        .conn-btn input { display: none; }
        .conn-btn .icon {
            font-size: 32px;
            margin-bottom: 8px;
        }
        .conn-btn .title {
            font-size: 16px;
            font-weight: 600;
            color: #fff;
            margin-bottom: 4px;
        }
        .conn-btn .desc {
            font-size: 11px;
            color: #888;
        }
        .conn-btn.selected .title { color: #00d9ff; }
        .conn-btn .badge {
            display: inline-block;
            background: #00d9ff;
            color: #000;
            font-size: 9px;
            padding: 2px 6px;
            border-radius: 4px;
            margin-top: 6px;
            font-weight: 600;
        }

        /* Collapsible sections */
        .section { display: none; }
        .section.active { display: block; }

        /* WiFi networks */
        .scan-btn {
            width: 100%;
            padding: 12px;
            background: transparent;
            border: 2px dashed rgba(0,217,255,0.3);
            border-radius: 12px;
            color: #00d9ff;
            font-size: 14px;
            cursor: pointer;
            margin-bottom: 12px;
        }
        .scan-btn:hover {
            background: rgba(0,217,255,0.1);
        }
        .networks {
            max-height: 180px;
            overflow-y: auto;
            margin-bottom: 12px;
        }
        .network {
            padding: 12px 14px;
            background: rgba(0,0,0,0.2);
            border-radius: 10px;
            margin-bottom: 8px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .network:hover { background: rgba(0,217,255,0.1); }
        .network .name { font-size: 14px; }
        .network .signal { color: #00d9ff; font-size: 12px; }

        /* Info box */
        .info-box {
            background: rgba(0,217,255,0.1);
            border: 1px solid rgba(0,217,255,0.3);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 16px;
        }
        .info-box p {
            font-size: 13px;
            color: #aaa;
            line-height: 1.5;
        }
        .info-box strong { color: #00d9ff; }

        /* Submit button */
        .submit-btn {
            width: 100%;
            padding: 18px;
            background: linear-gradient(135deg, #00d9ff 0%, #00b4d8 100%);
            border: none;
            border-radius: 14px;
            color: #000;
            font-size: 18px;
            font-weight: 700;
            cursor: pointer;
            position: fixed;
            bottom: 20px;
            left: 20px;
            right: 20px;
            max-width: 400px;
            margin: 0 auto;
        }
        .submit-btn:hover { opacity: 0.9; }
        .submit-btn:disabled {
            background: #444;
            color: #888;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>BitsperWatch</h1>
            <div class="device-id">)rawhtml");

    html += deviceId;

    html += F(R"rawhtml(</div>
        </div>

        <form id="configForm" action="/save" method="POST">

            <!-- Step 1: Connection Type -->
            <div class="card">
                <h2><span class="num">1</span> Tipo de Conexion</h2>
                <div class="conn-type-grid">
                    <label class="conn-btn" id="btn-ble" onclick="setConn('ble')">
                        <input type="radio" name="conn_mode" value="ble">
                        <div class="icon">&#128268;</div>
                        <div class="title">Bluetooth</div>
                        <div class="desc">Sin WiFi necesario</div>
                    </label>
                    <label class="conn-btn" id="btn-wifi" onclick="setConn('wifi')">
                        <input type="radio" name="conn_mode" value="wifi">
                        <div class="icon">&#128246;</div>
                        <div class="title">WiFi</div>
                        <div class="desc">Conexion por red</div>
                    </label>
                    <label class="conn-btn full-width selected" id="btn-both" onclick="setConn('both')">
                        <input type="radio" name="conn_mode" value="both" checked>
                        <div class="icon">&#128268; + &#128246;</div>
                        <div class="title">Bluetooth + WiFi</div>
                        <div class="desc">Usa ambos para mayor estabilidad</div>
                        <span class="badge">RECOMENDADO</span>
                    </label>
                </div>
            </div>

            <!-- Step 2: WiFi Config (shown unless BLE only) -->
            <div class="card section" id="wifi-section">
                <h2><span class="num">2</span> Red WiFi</h2>
                <button type="button" class="scan-btn" onclick="scanNetworks()">
                    &#128269; Buscar Redes WiFi
                </button>
                <div id="networks" class="networks"></div>
                <label>Nombre de la Red</label>
                <input type="text" name="ssid" id="ssid" placeholder="Selecciona o escribe tu red">
                <label>Contrasena</label>
                <input type="password" name="password" id="password" placeholder="Contrasena del WiFi">
            </div>

            <!-- BLE Config (shown for BLE mode) -->
            <div class="card section" id="ble-section">
                <h2><span class="num">2</span> Dispositivo Bluetooth</h2>
                <button type="button" class="scan-btn" onclick="scanBLE()">
                    &#128268; Buscar Dispositivos BLE
                </button>
                <div id="ble-devices" class="networks"></div>
                <input type="hidden" name="ble_addr" id="ble_addr">
                <input type="hidden" name="ble_name" id="ble_name">
                <div id="ble-selected" style="display:none;background:rgba(0,217,255,0.1);padding:14px;border-radius:12px;margin-top:12px;">
                    <div style="color:#00d9ff;font-weight:600;margin-bottom:4px;">Seleccionado:</div>
                    <div id="ble-selected-name" style="color:#fff;"></div>
                    <div id="ble-selected-addr" style="color:#666;font-size:12px;font-family:monospace;"></div>
                </div>
            </div>

            <!-- Step 3: Device Name -->
            <div class="card">
                <h2><span class="num" id="step-name">3</span> Nombre del Dispositivo</h2>
                <label>Como identificar este reloj</label>
                <input type="text" name="device_name" value="Mesero 1" placeholder="Ej: Mesero Juan, Barra, Cocina">
            </div>

            <!-- Step 4: BitsperBox IP (only for WiFi modes) -->
            <div class="card section" id="ip-section">
                <h2><span class="num" id="step-ip">4</span> BitsperBox</h2>
                <label>IP del BitsperBox (Raspberry Pi)</label>
                <input type="text" name="bb_ip" id="bb_ip" placeholder="192.168.1.100">
                <label>Puerto</label>
                <input type="number" name="bb_port" value="3334">
            </div>

            <!-- Hidden: Always BitsperBox mode for now -->
            <input type="hidden" name="mode" value="bitsperbox">

            <button type="submit" class="submit-btn">Guardar Configuracion</button>
        </form>
    </div>

    <script>
        var currentConn = 'both';

        function setConn(mode) {
            currentConn = mode;

            // Update button styles
            document.getElementById('btn-ble').className = 'conn-btn' + (mode === 'ble' ? ' selected' : '');
            document.getElementById('btn-wifi').className = 'conn-btn' + (mode === 'wifi' ? ' selected' : '');
            document.getElementById('btn-both').className = 'conn-btn full-width' + (mode === 'both' ? ' selected' : '');

            // Update radio
            document.querySelector('input[value="' + mode + '"]').checked = true;

            // Show/hide sections
            var showWifi = (mode === 'wifi' || mode === 'both');
            var showBle = (mode === 'ble' || mode === 'both');
            var showIp = (mode === 'wifi' || mode === 'both');

            document.getElementById('wifi-section').className = 'card section' + (showWifi ? ' active' : '');
            document.getElementById('ble-section').className = 'card section' + (showBle ? ' active' : '');
            document.getElementById('ip-section').className = 'card section' + (showIp ? ' active' : '');

            // Update step numbers
            if (mode === 'ble') {
                document.getElementById('step-name').textContent = '2';
            } else {
                document.getElementById('step-name').textContent = '3';
                document.getElementById('step-ip').textContent = '4';
            }
        }

        function scanNetworks() {
            document.getElementById('networks').innerHTML = '<div style="color:#888;text-align:center;padding:20px;">Buscando redes...</div>';
            fetch('/scan')
                .then(r => r.json())
                .then(nets => {
                    var h = '';
                    nets.sort((a, b) => b.rssi - a.rssi);
                    nets.forEach(n => {
                        var sig = n.rssi > -50 ? '&#9679;&#9679;&#9679;&#9679;' :
                                  n.rssi > -70 ? '&#9679;&#9679;&#9679;&#9675;' :
                                  n.rssi > -80 ? '&#9679;&#9679;&#9675;&#9675;' : '&#9679;&#9675;&#9675;&#9675;';
                        h += '<div class="network" onclick="selectNet(\'' + n.ssid.replace(/'/g, "\\'") + '\')">';
                        h += '<span class="name">' + (n.encrypted ? '&#128274; ' : '') + n.ssid + '</span>';
                        h += '<span class="signal">' + sig + '</span></div>';
                    });
                    document.getElementById('networks').innerHTML = h || '<div style="color:#888;text-align:center;padding:20px;">No se encontraron redes</div>';
                })
                .catch(e => {
                    document.getElementById('networks').innerHTML = '<div style="color:#f66;text-align:center;padding:20px;">Error al buscar</div>';
                });
        }

        function selectNet(ssid) {
            document.getElementById('ssid').value = ssid;
            document.getElementById('password').focus();
        }

        function scanBLE() {
            document.getElementById('ble-devices').innerHTML = '<div style="color:#888;text-align:center;padding:20px;">Buscando dispositivos Bluetooth...<br><small>(Esto toma ~5 segundos)</small></div>';
            fetch('/scanble')
                .then(r => r.json())
                .then(devs => {
                    var h = '';
                    devs.sort((a, b) => b.rssi - a.rssi);
                    devs.forEach(d => {
                        var sig = d.rssi > -50 ? '&#9679;&#9679;&#9679;&#9679;' :
                                  d.rssi > -70 ? '&#9679;&#9679;&#9679;&#9675;' :
                                  d.rssi > -80 ? '&#9679;&#9679;&#9675;&#9675;' : '&#9679;&#9675;&#9675;&#9675;';
                        h += '<div class="network" onclick="selectBLE(\'' + d.address.replace(/'/g, "\\'") + '\', \'' + d.name.replace(/'/g, "\\'") + '\')">';
                        h += '<span class="name">&#128268; ' + d.name + '</span>';
                        h += '<span class="signal">' + sig + '</span></div>';
                    });
                    document.getElementById('ble-devices').innerHTML = h || '<div style="color:#888;text-align:center;padding:20px;">No se encontraron dispositivos BLE</div>';
                })
                .catch(e => {
                    document.getElementById('ble-devices').innerHTML = '<div style="color:#f66;text-align:center;padding:20px;">Error al buscar</div>';
                });
        }

        function selectBLE(addr, name) {
            document.getElementById('ble_addr').value = addr;
            document.getElementById('ble_name').value = name;
            document.getElementById('ble-selected').style.display = 'block';
            document.getElementById('ble-selected-name').textContent = name;
            document.getElementById('ble-selected-addr').textContent = addr;
        }

        // Initialize view
        setConn('both');
    </script>
</body>
</html>
)rawhtml");

    return html;
}
