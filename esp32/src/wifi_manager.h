#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <functional>
#include "storage.h"
#include "config.h"

// ============================================
// WiFi Manager - Connection & AP Mode
// With stability improvements based on ESP32 documentation
// ============================================

// Reconnection settings
#define WIFI_MIN_BACKOFF 1000UL      // Start with 1 second
#define WIFI_MAX_BACKOFF 30000UL     // Max 30 seconds between retries
#define WIFI_MAX_RECONNECT_ATTEMPTS 10  // Before switching to AP mode

enum WiFiState {
    WIFI_STATE_DISCONNECTED,
    WIFI_STATE_CONNECTING,
    WIFI_STATE_CONNECTED,
    WIFI_STATE_AP_MODE,
    WIFI_STATE_ERROR
};

class WiFiManager_ {
public:
    void begin();

    // Connection
    bool connect(const char* ssid, const char* password);
    bool connectFromConfig();
    void disconnect();

    // AP Mode for configuration
    void startAPMode();
    void stopAPMode();
    bool isAPMode();

    // Status
    WiFiState getState();
    String getIPAddress();
    String getSSID();
    String getAPSSID();
    int getRSSI();

    // Check connection
    bool isConnected();
    void checkConnection();  // Legacy - calls loop()
    void loop();             // Call this in main loop

    // Event handling
    void handleWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);

    // Callback for connection state changes
    void setConnectionCallback(std::function<void(bool)> callback);

private:
    WiFiState _state = WIFI_STATE_DISCONNECTED;
    String _apSSID;
    unsigned long _lastCheck = 0;
    unsigned long _connectStart = 0;
    int _reconnectAttempts = 0;

    // Exponential backoff
    unsigned long _currentBackoff = WIFI_MIN_BACKOFF;
    unsigned long _nextReconnect = 0;
    bool _reconnectScheduled = false;
    bool _manualDisconnect = false;

    // RSSI monitoring
    unsigned long _lastRssiCheck = 0;

    // Callback
    std::function<void(bool)> _onConnectionChange = nullptr;

    // Helper methods
    void scheduleReconnect();
    const char* getDisconnectReason(wifi_err_reason_t reason);
    const char* getSignalQuality(int rssi);
};

extern WiFiManager_ WifiMgr;

#endif // WIFI_MANAGER_H
