#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include "storage.h"
#include "config.h"

// ============================================
// WiFi Manager - Connection & AP Mode
// ============================================

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
    void checkConnection();

private:
    WiFiState _state = WIFI_STATE_DISCONNECTED;
    String _apSSID;
    unsigned long _lastCheck = 0;
    unsigned long _connectStart = 0;
    int _reconnectAttempts = 0;
};

extern WiFiManager_ WifiMgr;

#endif // WIFI_MANAGER_H
