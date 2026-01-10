#include "web_portal.h"
#include "wifi_manager.h"
#include "config.h"

WebPortal Portal;

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

    // BitsperBox mode
    if (_server->hasArg("bb_ip")) {
        strncpy(config.bitsperbox_ip, _server->arg("bb_ip").c_str(), sizeof(config.bitsperbox_ip) - 1);
    }
    config.bitsperbox_port = _server->hasArg("bb_port") ?
        _server->arg("bb_port").toInt() : 3334;

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
        "<style>body{font-family:sans-serif;background:#1a1a2e;color:#fff;"
        "display:flex;justify-content:center;align-items:center;height:100vh;margin:0;}"
        ".card{background:#16213e;padding:40px;border-radius:16px;text-align:center;}"
        "h1{color:#00d9ff;}p{color:#aaa;}</style></head><body>"
        "<div class='card'><h1>Configuracion Guardada</h1>"
        "<p>El dispositivo se reiniciara en 3 segundos...</p></div></body></html>");

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

String WebPortal::generateHTML() {
    String deviceId = Storage.getDeviceId();

    String html = F("<!DOCTYPE html><html><head><meta charset='UTF-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
        "<title>BitsperWatch Setup</title><style>"
        "*{box-sizing:border-box}"
        "body{font-family:-apple-system,sans-serif;background:linear-gradient(135deg,#1a1a2e,#16213e);"
        "color:#fff;margin:0;padding:20px;min-height:100vh}"
        ".container{max-width:400px;margin:0 auto}"
        ".header{text-align:center;margin-bottom:30px}"
        ".header h1{color:#00d9ff;margin:0;font-size:28px}"
        ".header p{color:#888;margin:10px 0 0;font-size:14px}"
        ".card{background:rgba(255,255,255,0.05);border-radius:16px;padding:24px;"
        "margin-bottom:20px;border:1px solid rgba(255,255,255,0.1)}"
        ".card h2{margin:0 0 20px;font-size:18px;color:#00d9ff}"
        "label{display:block;margin-bottom:6px;color:#aaa;font-size:14px}"
        "input,select{width:100%;padding:12px;border:1px solid rgba(255,255,255,0.2);"
        "border-radius:8px;background:rgba(0,0,0,0.3);color:#fff;font-size:16px;margin-bottom:16px}"
        "input:focus,select:focus{outline:none;border-color:#00d9ff}"
        ".radio-group{display:flex;gap:16px;margin-bottom:16px}"
        ".radio-option{flex:1;padding:16px;border:2px solid rgba(255,255,255,0.2);"
        "border-radius:12px;cursor:pointer;text-align:center;transition:all 0.2s}"
        ".radio-option:hover{border-color:rgba(0,217,255,0.5)}"
        ".radio-option.selected{border-color:#00d9ff;background:rgba(0,217,255,0.1)}"
        ".radio-option input{display:none}"
        ".radio-option .icon{font-size:32px;margin-bottom:8px}"
        ".radio-option .label{font-weight:600;color:#fff}"
        ".radio-option .desc{font-size:12px;color:#888;margin-top:4px}"
        ".mode-section{display:none}.mode-section.active{display:block}"
        "button{width:100%;padding:16px;background:linear-gradient(135deg,#00d9ff,#00b4d8);"
        "border:none;border-radius:12px;color:#000;font-size:18px;font-weight:600;cursor:pointer}"
        "button:hover{opacity:0.9}"
        ".networks{max-height:200px;overflow-y:auto;margin-bottom:16px}"
        ".network{padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;"
        "margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between}"
        ".network:hover{background:rgba(0,217,255,0.1)}"
        ".scan-btn{background:transparent;border:1px solid #00d9ff;color:#00d9ff;"
        "padding:10px;font-size:14px;margin-bottom:16px}"
        "</style></head><body><div class='container'>"
        "<div class='header'><h1>BitsperWatch</h1><p>ID: ");

    html += deviceId;

    html += F("</p></div><form action='/save' method='POST'>"
        "<div class='card'><h2>WiFi</h2>"
        "<button type='button' class='scan-btn' onclick='scanNetworks()'>Buscar Redes</button>"
        "<div id='networks' class='networks'></div>"
        "<label>Nombre de Red (SSID)</label>"
        "<input type='text' name='ssid' id='ssid' required placeholder='Tu red WiFi'>"
        "<label>Contrasena</label>"
        "<input type='password' name='password' id='password' placeholder='Contrasena WiFi'></div>"
        "<div class='card'><h2>Nombre del Dispositivo</h2>"
        "<input type='text' name='device_name' value='Mesero 1' placeholder='Ej: Mesero Juan'></div>"
        "<div class='card'><h2>Modo de Conexion</h2>"
        "<div class='radio-group'>"
        "<label class='radio-option selected' id='opt-bitsperbox' onclick='setMode(\"bitsperbox\")'>"
        "<input type='radio' name='mode' value='bitsperbox' checked>"
        "<div class='icon'>[Pi]</div><div class='label'>BitsperBox</div>"
        "<div class='desc'>Via Raspberry Pi</div></label>"
        "<label class='radio-option' id='opt-direct' onclick='setMode(\"direct\")'>"
        "<input type='radio' name='mode' value='direct'>"
        "<div class='icon'>[Cloud]</div><div class='label'>Directo</div>"
        "<div class='desc'>Via Supabase</div></label></div>"
        "<div id='mode-bitsperbox' class='mode-section active'>"
        "<label>IP del BitsperBox</label>"
        "<input type='text' name='bb_ip' placeholder='192.168.1.100'>"
        "<label>Puerto</label><input type='number' name='bb_port' value='3334'></div>"
        "<div id='mode-direct' class='mode-section'>"
        "<label>Supabase URL</label><input type='text' name='sb_url' placeholder='https://xxx.supabase.co'>"
        "<label>Supabase Anon Key</label><input type='text' name='sb_key' placeholder='eyJ...'>"
        "<label>Restaurant ID</label><input type='text' name='rest_id' placeholder='uuid'></div></div>"
        "<button type='submit'>Guardar y Conectar</button></form></div>"
        "<script>"
        "function setMode(m){"
        "document.querySelector('input[value=\"bitsperbox\"]').checked=(m==='bitsperbox');"
        "document.querySelector('input[value=\"direct\"]').checked=(m==='direct');"
        "document.getElementById('mode-bitsperbox').className='mode-section'+(m==='bitsperbox'?' active':'');"
        "document.getElementById('mode-direct').className='mode-section'+(m==='direct'?' active':'');"
        "document.getElementById('opt-bitsperbox').className='radio-option'+(m==='bitsperbox'?' selected':'');"
        "document.getElementById('opt-direct').className='radio-option'+(m==='direct'?' selected':'');}"
        "function scanNetworks(){"
        "document.getElementById('networks').innerHTML='<p style=\"color:#888\">Buscando...</p>';"
        "fetch('/scan').then(r=>r.json()).then(nets=>{"
        "var h='';nets.sort((a,b)=>b.rssi-a.rssi);"
        "nets.forEach(n=>{"
        "var sig=n.rssi>-50?'****':n.rssi>-70?'***':n.rssi>-80?'**':'*';"
        "h+='<div class=\"network\" onclick=\"selNet(\\''+n.ssid+'\\')\"><span>'+(n.encrypted?'# ':'')+n.ssid+'</span><span>'+sig+'</span></div>';});"
        "document.getElementById('networks').innerHTML=h||'<p style=\"color:#888\">No se encontraron redes</p>';});}"
        "function selNet(s){document.getElementById('ssid').value=s;document.getElementById('password').focus();}"
        "</script></body></html>");

    return html;
}
