#include "wifi_manager.h"
#include "display.h"

WiFiManager_ WifiMgr;

void WiFiManager_::begin() {
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);

    // Generate AP SSID from MAC
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char apSSID[32];
    snprintf(apSSID, sizeof(apSSID), "%s%02X%02X", WIFI_AP_SSID_PREFIX, mac[4], mac[5]);
    _apSSID = String(apSSID);

    Serial.println("[WiFi] Manager initialized");
    Serial.printf("[WiFi] AP SSID will be: %s\n", _apSSID.c_str());
}

bool WiFiManager_::connect(const char* ssid, const char* password) {
    Serial.printf("[WiFi] Connecting to %s...\n", ssid);
    Display.showConnecting(ssid);

    _state = WIFI_STATE_CONNECTING;
    _connectStart = millis();
    _reconnectAttempts++;

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    // Wait for connection with timeout
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - _connectStart > WIFI_CONNECT_TIMEOUT) {
            Serial.println("[WiFi] Connection timeout!");
            _state = WIFI_STATE_ERROR;
            Display.showError("WiFi timeout");
            return false;
        }
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("[WiFi] RSSI: %d dBm\n", WiFi.RSSI());

    _state = WIFI_STATE_CONNECTED;
    _reconnectAttempts = 0;
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
    WiFi.disconnect(true);
    _state = WIFI_STATE_DISCONNECTED;
    Serial.println("[WiFi] Disconnected");
}

void WiFiManager_::startAPMode() {
    Serial.printf("[WiFi] Starting AP Mode: %s\n", _apSSID.c_str());

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

void WiFiManager_::checkConnection() {
    // Check every 5 seconds
    if (millis() - _lastCheck < 5000) return;
    _lastCheck = millis();

    if (_state == WIFI_STATE_AP_MODE) return;

    if (WiFi.status() != WL_CONNECTED && _state == WIFI_STATE_CONNECTED) {
        Serial.println("[WiFi] Connection lost! Attempting reconnect...");
        _state = WIFI_STATE_DISCONNECTED;

        // Try to reconnect
        if (_reconnectAttempts < 5) {
            connectFromConfig();
        } else {
            Serial.println("[WiFi] Max reconnect attempts. Starting AP mode.");
            startAPMode();
        }
    }
}
