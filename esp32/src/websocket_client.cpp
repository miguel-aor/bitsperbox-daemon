#include "websocket_client.h"
#include "display.h"

BitsperBoxClient WsClient;

void BitsperBoxClient::begin(const char* host, uint16_t port) {
    Serial.printf("[WS] Initializing connection to BitsperBox at %s:%d\n", host, port);

    // Store host and port for reconnection
    strncpy(_host, host, sizeof(_host) - 1);
    _port = port;

    _ws.begin(host, port, "/");
    _ws.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
        handleEvent(type, payload, length);
    });

    // ═══════════════════════════════════════════════════════════════════
    // WebSocket stability settings
    // ═══════════════════════════════════════════════════════════════════

    // Start with fast reconnect interval (will use exponential backoff on failures)
    _ws.setReconnectInterval(_currentBackoff);

    // Enable ping/pong heartbeat: ping every 15s, timeout 5s, disconnect after 2 failures
    // More aggressive than before (was 30s/10s/2)
    _ws.enableHeartbeat(15000, 5000, 2);

    _lastReconnect = millis();

    Serial.println("[WS] Client initialized with stability improvements");
    Serial.printf("[WS] - Heartbeat: 15s ping, 5s timeout\n");
    Serial.printf("[WS] - Initial reconnect interval: %lu ms\n", _currentBackoff);
}

void BitsperBoxClient::loop() {
    _ws.loop();

    // Send our own heartbeat every 20 seconds (in addition to WebSocket ping/pong)
    if (_connected && millis() - _lastHeartbeat > 20000) {
        sendHeartbeat();
        _lastHeartbeat = millis();
    }

    // Connection watchdog: if we haven't received anything in 60 seconds, force reconnect
    if (_connected && millis() - _lastActivity > 60000) {
        Serial.println("[WS] Connection watchdog triggered - no activity for 60s");
        Serial.println("[WS] Forcing reconnect...");
        _ws.disconnect();
        _connected = false;
        // The library will auto-reconnect
    }

    // Monitor connection attempts and apply exponential backoff
    if (!_connected && _reconnectAttempts > 0) {
        unsigned long timeSinceLastReconnect = millis() - _lastReconnect;

        // If we've been trying for a while, increase the backoff
        if (timeSinceLastReconnect > _currentBackoff * 2) {
            _currentBackoff = min(_currentBackoff * 2, WS_MAX_BACKOFF);
            _ws.setReconnectInterval(_currentBackoff);
            Serial.printf("[WS] Increased reconnect interval to %lu ms\n", _currentBackoff);
        }
    }
}

void BitsperBoxClient::disconnect() {
    _ws.disconnect();
    _connected = false;
}

bool BitsperBoxClient::isConnected() {
    return _connected;
}

void BitsperBoxClient::forceReconnect() {
    Serial.println("[WS] Force reconnect requested");
    _ws.disconnect();
    _connected = false;
    _reconnectAttempts = 0;
    _currentBackoff = WS_MIN_BACKOFF;
    _ws.setReconnectInterval(_currentBackoff);

    // Re-initialize connection
    _ws.begin(_host, _port, "/");
}

void BitsperBoxClient::onNotification(std::function<void(NotificationData&)> callback) {
    _onNotification = callback;
}

void BitsperBoxClient::onConnectionChange(std::function<void(bool)> callback) {
    _onConnectionChange = callback;
}

void BitsperBoxClient::handleEvent(WStype_t type, uint8_t* payload, size_t length) {
    _lastActivity = millis();  // Update activity timestamp on any event

    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected from BitsperBox");
            _connected = false;
            _reconnectAttempts++;
            _lastReconnect = millis();

            // Apply exponential backoff
            _currentBackoff = min(_currentBackoff * 2, WS_MAX_BACKOFF);
            _ws.setReconnectInterval(_currentBackoff);

            Serial.printf("[WS] Reconnect attempt %d, next in %lu ms\n",
                         _reconnectAttempts, _currentBackoff);

            if (_onConnectionChange) _onConnectionChange(false);
            break;

        case WStype_CONNECTED:
            Serial.printf("[WS] Connected to BitsperBox: %s\n", payload);
            _connected = true;
            _reconnectAttempts = 0;
            _currentBackoff = WS_MIN_BACKOFF;  // Reset backoff on successful connection
            _ws.setReconnectInterval(_currentBackoff);
            _lastActivity = millis();
            _lastHeartbeat = millis();

            sendRegister();
            if (_onConnectionChange) _onConnectionChange(true);
            break;

        case WStype_TEXT:
            handleMessage(payload, length);
            break;

        case WStype_PING:
            Serial.println("[WS] Ping received");
            _lastActivity = millis();
            break;

        case WStype_PONG:
            Serial.println("[WS] Pong received");
            _lastActivity = millis();
            break;

        case WStype_ERROR:
            Serial.printf("[WS] Error: %s\n", payload);
            _reconnectAttempts++;
            break;

        case WStype_BIN:
            Serial.printf("[WS] Binary data received (%d bytes)\n", length);
            break;

        default:
            break;
    }
}

void BitsperBoxClient::handleMessage(uint8_t* payload, size_t length) {
    Serial.printf("[WS] Message received: %s\n", payload);
    _lastActivity = millis();

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, length);

    if (error) {
        Serial.printf("[WS] JSON parse error: %s\n", error.c_str());
        return;
    }

    const char* msgType = doc["type"] | "";

    // Handle different message types
    if (strcmp(msgType, "notification") == 0) {
        NotificationData notif;
        memset(&notif, 0, sizeof(NotificationData));

        strncpy(notif.table, doc["table"] | "", sizeof(notif.table) - 1);
        strncpy(notif.type, doc["alert"] | "", sizeof(notif.type) - 1);
        strncpy(notif.message, doc["message"] | "", sizeof(notif.message) - 1);
        strncpy(notif.priority, doc["priority"] | "medium", sizeof(notif.priority) - 1);
        notif.timestamp = doc["timestamp"] | millis();

        Serial.printf("[WS] >>> NOTIFICATION: Table %s, Type: %s, Priority: %s\n",
                      notif.table, notif.type, notif.priority);

        if (_onNotification) {
            _onNotification(notif);
        }

        // Send acknowledgment
        const char* notifId = doc["id"] | "";
        if (strlen(notifId) > 0) {
            sendAck(notifId);
        }
    }
    else if (strcmp(msgType, "welcome") == 0) {
        Serial.println("[WS] Received welcome from BitsperBox");
    }
    else if (strcmp(msgType, "registered") == 0) {
        Serial.println("[WS] Device registered successfully with BitsperBox");
    }
    else if (strcmp(msgType, "ping") == 0) {
        // Respond to application-level ping
        JsonDocument pong;
        pong["type"] = "pong";
        pong["device_id"] = Storage.getDeviceId();
        String pongStr;
        serializeJson(pong, pongStr);
        _ws.sendTXT(pongStr);
        Serial.println("[WS] Responded to ping with pong");
    }
}

void BitsperBoxClient::sendRegister() {
    JsonDocument doc;
    doc["type"] = "register";
    doc["device_id"] = Storage.getDeviceId();

    // Load device name from config
    DeviceConfig config;
    if (Storage.loadConfig(config)) {
        doc["name"] = config.device_name;
    } else {
        doc["name"] = "BitsperWatch";
    }

    doc["firmware"] = FIRMWARE_VERSION;
    doc["rssi"] = WiFi.RSSI();

    String json;
    serializeJson(doc, json);

    Serial.printf("[WS] Sending register: %s\n", json.c_str());
    _ws.sendTXT(json);
}

void BitsperBoxClient::sendHeartbeat() {
    JsonDocument doc;
    doc["type"] = "heartbeat";
    doc["device_id"] = Storage.getDeviceId();
    doc["uptime"] = millis() / 1000;
    doc["free_heap"] = ESP.getFreeHeap();
    doc["rssi"] = WiFi.RSSI();

    // Add signal quality indicator
    int rssi = WiFi.RSSI();
    if (rssi > -50) doc["signal"] = "excellent";
    else if (rssi > -60) doc["signal"] = "good";
    else if (rssi > -70) doc["signal"] = "fair";
    else if (rssi > -80) doc["signal"] = "weak";
    else doc["signal"] = "very_weak";

    String json;
    serializeJson(doc, json);
    _ws.sendTXT(json);

    Serial.printf("[WS] Heartbeat sent (RSSI: %d dBm)\n", rssi);
}

void BitsperBoxClient::sendAck(const char* notificationId) {
    JsonDocument doc;
    doc["type"] = "ack";
    doc["notification_id"] = notificationId;
    doc["device_id"] = Storage.getDeviceId();

    String json;
    serializeJson(doc, json);
    _ws.sendTXT(json);

    Serial.printf("[WS] Sent ack for notification: %s\n", notificationId);
}

unsigned long BitsperBoxClient::getReconnectAttempts() {
    return _reconnectAttempts;
}

unsigned long BitsperBoxClient::getCurrentBackoff() {
    return _currentBackoff;
}
