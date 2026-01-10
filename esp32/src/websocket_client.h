#ifndef WEBSOCKET_CLIENT_H
#define WEBSOCKET_CLIENT_H

#include <Arduino.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include "storage.h"
#include "config.h"

// ============================================
// WebSocket Client for BitsperBox
// ============================================

struct NotificationData {
    char table[16];
    char type[32];
    char message[256];
    char priority[16];
    unsigned long timestamp;
};

class BitsperBoxClient {
public:
    void begin(const char* host, uint16_t port);
    void loop();
    void disconnect();

    bool isConnected();
    void sendAck(const char* notificationId);

    // Callback when notification received
    void onNotification(std::function<void(NotificationData&)> callback);

    // Callback for connection status changes
    void onConnectionChange(std::function<void(bool)> callback);

private:
    WebSocketsClient _ws;
    bool _connected = false;
    unsigned long _lastReconnect = 0;
    unsigned long _lastHeartbeat = 0;
    int _reconnectAttempts = 0;

    std::function<void(NotificationData&)> _onNotification = nullptr;
    std::function<void(bool)> _onConnectionChange = nullptr;

    void handleEvent(WStype_t type, uint8_t* payload, size_t length);
    void handleMessage(uint8_t* payload, size_t length);
    void sendRegister();
    void sendHeartbeat();
};

extern BitsperBoxClient WsClient;

#endif // WEBSOCKET_CLIENT_H
