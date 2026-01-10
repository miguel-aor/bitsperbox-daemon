#include "websocket_client.h"
#include "display.h"

BitsperBoxClient WsClient;

void BitsperBoxClient::begin(const char* host, uint16_t port) {
    Serial.printf("[WS] Connecting to BitsperBox at %s:%d\n", host, port);

    _ws.begin(host, port, "/");
    _ws.onEvent([this](WStype_t type, uint8_t* payload, size_t length) {
        handleEvent(type, payload, length);
    });

    _ws.setReconnectInterval(5000);
    _ws.enableHeartbeat(30000, 10000, 2);

    _lastReconnect = millis();
}

void BitsperBoxClient::loop() {
    _ws.loop();

    // Send heartbeat every 30 seconds
    if (_connected && millis() - _lastHeartbeat > 30000) {
        sendHeartbeat();
        _lastHeartbeat = millis();
    }
}

void BitsperBoxClient::disconnect() {
    _ws.disconnect();
    _connected = false;
}

bool BitsperBoxClient::isConnected() {
    return _connected;
}

void BitsperBoxClient::onNotification(std::function<void(NotificationData&)> callback) {
    _onNotification = callback;
}

void BitsperBoxClient::onConnectionChange(std::function<void(bool)> callback) {
    _onConnectionChange = callback;
}

void BitsperBoxClient::handleEvent(WStype_t type, uint8_t* payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.println("[WS] Disconnected from BitsperBox");
            _connected = false;
            _reconnectAttempts++;
            if (_onConnectionChange) _onConnectionChange(false);
            break;

        case WStype_CONNECTED:
            Serial.printf("[WS] Connected to BitsperBox: %s\n", payload);
            _connected = true;
            _reconnectAttempts = 0;
            sendRegister();
            if (_onConnectionChange) _onConnectionChange(true);
            break;

        case WStype_TEXT:
            handleMessage(payload, length);
            break;

        case WStype_PING:
            Serial.println("[WS] Ping received");
            break;

        case WStype_PONG:
            Serial.println("[WS] Pong received");
            break;

        case WStype_ERROR:
            Serial.printf("[WS] Error: %s\n", payload);
            break;

        default:
            break;
    }
}

void BitsperBoxClient::handleMessage(uint8_t* payload, size_t length) {
    Serial.printf("[WS] Message received: %s\n", payload);

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

        Serial.printf("[WS] Notification: Table %s, Type: %s, Priority: %s\n",
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
        Serial.println("[WS] Device registered successfully");
    }
    else if (strcmp(msgType, "ping") == 0) {
        // Respond to ping
        JsonDocument pong;
        pong["type"] = "pong";
        String pongStr;
        serializeJson(pong, pongStr);
        _ws.sendTXT(pongStr);
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

    String json;
    serializeJson(doc, json);
    _ws.sendTXT(json);
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
