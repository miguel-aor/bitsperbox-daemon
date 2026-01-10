#include "wifi_manager.h"
#include "display.h"

WiFiManager_ WifiMgr;

// Static callback wrapper for WiFi events
static void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    WifiMgr.handleWiFiEvent(event, info);
}

void WiFiManager_::begin() {
    WiFi.mode(WIFI_STA);

    // ═══════════════════════════════════════════════════════════════════
    // KEY STABILITY SETTINGS (from ESP32 documentation)
    // ═══════════════════════════════════════════════════════════════════

    // Enable auto-reconnect at driver level
    WiFi.setAutoReconnect(true);

    // Persist WiFi config to flash for faster reconnection
    WiFi.persistent(true);

    // Disable WiFi power saving for more stable connection
    // This increases power consumption but improves reliability
    WiFi.setSleep(false);

    // Set WiFi TX power to maximum for better range
    WiFi.setTxPower(WIFI_POWER_19_5dBm);

    // ═══════════════════════════════════════════════════════════════════
    // Register WiFi event handlers for instant disconnect detection
    // ═══════════════════════════════════════════════════════════════════
    WiFi.onEvent(onWiFiEvent);

    // Generate AP SSID from MAC
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char apSSID[32];
    snprintf(apSSID, sizeof(apSSID), "%s%02X%02X", WIFI_AP_SSID_PREFIX, mac[4], mac[5]);
    _apSSID = String(apSSID);

    Serial.println("[WiFi] Manager initialized with stability improvements");
    Serial.println("[WiFi] - Auto-reconnect: ENABLED");
    Serial.println("[WiFi] - Power save: DISABLED");
    Serial.println("[WiFi] - TX Power: MAX (19.5dBm)");
    Serial.printf("[WiFi] AP SSID will be: %s\n", _apSSID.c_str());
}

void WiFiManager_::handleWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
    switch (event) {
        case ARDUINO_EVENT_WIFI_STA_START:
            Serial.println("[WiFi] Station started");
            break;

        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            Serial.println("[WiFi] Connected to AP");
            _reconnectAttempts = 0;
            _currentBackoff = WIFI_MIN_BACKOFF;
            break;

        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            Serial.printf("[WiFi] Got IP: %s\n", WiFi.localIP().toString().c_str());
            Serial.printf("[WiFi] RSSI: %d dBm (Signal: %s)\n",
                         WiFi.RSSI(), getSignalQuality(WiFi.RSSI()));
            _state = WIFI_STATE_CONNECTED;
            _reconnectAttempts = 0;
            _currentBackoff = WIFI_MIN_BACKOFF;
            _reconnectScheduled = false;  // Clear any pending reconnect
            if (_onConnectionChange) _onConnectionChange(true);
            break;

        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            {
                wifi_err_reason_t reason = (wifi_err_reason_t)info.wifi_sta_disconnected.reason;
                Serial.printf("[WiFi] Disconnected! Reason: %d (%s)\n",
                             reason, getDisconnectReason(reason));

                if (_state == WIFI_STATE_CONNECTED) {
                    _state = WIFI_STATE_DISCONNECTED;
                    if (_onConnectionChange) _onConnectionChange(false);
                }

                // Don't auto-reconnect if in AP mode or if manually disconnected
                if (_state != WIFI_STATE_AP_MODE && !_manualDisconnect) {
                    scheduleReconnect();
                }
            }
            break;

        case ARDUINO_EVENT_WIFI_STA_LOST_IP:
            Serial.println("[WiFi] Lost IP address");
            break;

        default:
            break;
    }
}

const char* WiFiManager_::getDisconnectReason(wifi_err_reason_t reason) {
    switch (reason) {
        case WIFI_REASON_UNSPECIFIED: return "UNSPECIFIED";
        case WIFI_REASON_AUTH_EXPIRE: return "AUTH_EXPIRE";
        case WIFI_REASON_AUTH_LEAVE: return "AUTH_LEAVE";
        case WIFI_REASON_ASSOC_EXPIRE: return "ASSOC_EXPIRE";
        case WIFI_REASON_ASSOC_TOOMANY: return "ASSOC_TOOMANY";
        case WIFI_REASON_NOT_AUTHED: return "NOT_AUTHED";
        case WIFI_REASON_NOT_ASSOCED: return "NOT_ASSOCED";
        case WIFI_REASON_ASSOC_LEAVE: return "ASSOC_LEAVE";
        case WIFI_REASON_ASSOC_NOT_AUTHED: return "ASSOC_NOT_AUTHED";
        case WIFI_REASON_BEACON_TIMEOUT: return "BEACON_TIMEOUT";
        case WIFI_REASON_NO_AP_FOUND: return "NO_AP_FOUND";
        case WIFI_REASON_AUTH_FAIL: return "AUTH_FAIL";
        case WIFI_REASON_ASSOC_FAIL: return "ASSOC_FAIL";
        case WIFI_REASON_HANDSHAKE_TIMEOUT: return "HANDSHAKE_TIMEOUT";
        case WIFI_REASON_CONNECTION_FAIL: return "CONNECTION_FAIL";
        default: return "UNKNOWN";
    }
}

const char* WiFiManager_::getSignalQuality(int rssi) {
    if (rssi > -50) return "EXCELLENT";
    if (rssi > -60) return "GOOD";
    if (rssi > -70) return "FAIR";
    if (rssi > -80) return "WEAK";
    return "VERY WEAK";
}

void WiFiManager_::scheduleReconnect() {
    _reconnectAttempts++;

    if (_reconnectAttempts > WIFI_MAX_RECONNECT_ATTEMPTS) {
        Serial.printf("[WiFi] Max reconnect attempts (%d) reached. Starting AP mode.\n",
                     WIFI_MAX_RECONNECT_ATTEMPTS);
        startAPMode();
        return;
    }

    // Calculate backoff with exponential increase
    _currentBackoff = min(_currentBackoff * 2, WIFI_MAX_BACKOFF);

    Serial.printf("[WiFi] Scheduling reconnect attempt %d/%d in %lu ms\n",
                 _reconnectAttempts, WIFI_MAX_RECONNECT_ATTEMPTS, _currentBackoff);

    _nextReconnect = millis() + _currentBackoff;
    _reconnectScheduled = true;
}

bool WiFiManager_::connect(const char* ssid, const char* password) {
    Serial.printf("[WiFi] Connecting to %s...\n", ssid);
    Display.showConnecting(ssid);

    _state = WIFI_STATE_CONNECTING;
    _connectStart = millis();
    _manualDisconnect = false;

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    // Non-blocking wait with visual feedback
    int dots = 0;
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - _connectStart > WIFI_CONNECT_TIMEOUT) {
            Serial.println("\n[WiFi] Connection timeout!");
            _state = WIFI_STATE_ERROR;
            Display.showError("WiFi timeout");
            return false;
        }
        delay(250);
        Serial.print(".");
        dots++;
        if (dots % 20 == 0) Serial.println();
    }

    Serial.println();
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] RSSI: %d dBm (Signal: %s)\n", WiFi.RSSI(), getSignalQuality(WiFi.RSSI()));
    Serial.printf("[WiFi] Channel: %d\n", WiFi.channel());

    _state = WIFI_STATE_CONNECTED;
    _reconnectAttempts = 0;
    _currentBackoff = WIFI_MIN_BACKOFF;
    _reconnectScheduled = false;  // Clear any pending reconnect
    Display.showConnected(ssid, WiFi.localIP().toString().c_str());

    return true;
}

bool WiFiManager_::connectFromConfig() {
    DeviceConfig config;
    if (!Storage.loadConfig(config)) {
        Serial.println("[WiFi] No saved configuration");
        return false;
    }

    if (strlen(config.wifi_ssid) == 0) {
        Serial.println("[WiFi] No SSID configured");
        return false;
    }

    return connect(config.wifi_ssid, config.wifi_password);
}

void WiFiManager_::disconnect() {
    _manualDisconnect = true;
    _reconnectScheduled = false;
    WiFi.disconnect(true);
    _state = WIFI_STATE_DISCONNECTED;
    Serial.println("[WiFi] Disconnected (manual)");
}

void WiFiManager_::startAPMode() {
    Serial.printf("[WiFi] Starting AP Mode: %s\n", _apSSID.c_str());

    _reconnectScheduled = false;
    WiFi.mode(WIFI_AP);
    WiFi.softAP(_apSSID.c_str(), WIFI_AP_PASSWORD);

    delay(100);  // Wait for AP to start

    IPAddress apIP = WiFi.softAPIP();
    Serial.printf("[WiFi] AP Started. IP: %s\n", apIP.toString().c_str());

    _state = WIFI_STATE_AP_MODE;
    Display.showAPMode(_apSSID.c_str(), WIFI_AP_PASSWORD);
}

void WiFiManager_::stopAPMode() {
    WiFi.softAPdisconnect(true);
    WiFi.mode(WIFI_STA);
    _state = WIFI_STATE_DISCONNECTED;
    _reconnectAttempts = 0;
    _currentBackoff = WIFI_MIN_BACKOFF;
    Serial.println("[WiFi] AP Mode stopped");
}

bool WiFiManager_::isAPMode() {
    return _state == WIFI_STATE_AP_MODE;
}

WiFiState WiFiManager_::getState() {
    return _state;
}

String WiFiManager_::getIPAddress() {
    if (_state == WIFI_STATE_AP_MODE) {
        return WiFi.softAPIP().toString();
    }
    return WiFi.localIP().toString();
}

String WiFiManager_::getSSID() {
    return WiFi.SSID();
}

String WiFiManager_::getAPSSID() {
    return _apSSID;
}

int WiFiManager_::getRSSI() {
    return WiFi.RSSI();
}

bool WiFiManager_::isConnected() {
    return WiFi.status() == WL_CONNECTED && _state == WIFI_STATE_CONNECTED;
}

void WiFiManager_::setConnectionCallback(std::function<void(bool)> callback) {
    _onConnectionChange = callback;
}

void WiFiManager_::loop() {
    // Handle scheduled reconnection with exponential backoff
    // Only attempt if we're actually disconnected
    if (_reconnectScheduled && millis() >= _nextReconnect) {
        _reconnectScheduled = false;

        // Double-check we're not already connected
        if (WiFi.status() == WL_CONNECTED || _state == WIFI_STATE_CONNECTED) {
            Serial.println("[WiFi] Already connected, skipping scheduled reconnect");
            return;
        }

        Serial.printf("[WiFi] Attempting reconnect (attempt %d)...\n", _reconnectAttempts);

        WiFi.disconnect();
        delay(100);
        connectFromConfig();
    }

    // Periodic RSSI monitoring (every 30 seconds when connected)
    if (_state == WIFI_STATE_CONNECTED && millis() - _lastRssiCheck > 30000) {
        _lastRssiCheck = millis();
        int rssi = WiFi.RSSI();

        if (rssi < -80) {
            Serial.printf("[WiFi] WARNING: Weak signal! RSSI: %d dBm\n", rssi);
            Display.showWeakSignal(rssi);
        }
    }
}

// Legacy method for backward compatibility
void WiFiManager_::checkConnection() {
    loop();
}
