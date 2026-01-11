#ifndef BLE_CLIENT_H
#define BLE_CLIENT_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEScan.h>
#include <BLEAdvertisedDevice.h>
#include <BLEClient.h>
#include <functional>
#include "config.h"
#include "storage.h"

// ============================================
// BLE Client for BitsperWatch
// Connects to BitsperBox via Bluetooth Low Energy
// ============================================

enum BLEState {
    BLE_STATE_IDLE,
    BLE_STATE_SCANNING,
    BLE_STATE_CONNECTING,
    BLE_STATE_CONNECTED,
    BLE_STATE_DISCONNECTED,
    BLE_STATE_ERROR
};

// Same notification structure as WebSocket
struct BLENotificationData {
    char table[16];
    char type[32];
    char message[256];
    char priority[16];
    unsigned long timestamp;
};

class BitsperBoxBLEClient {
public:
    void begin();
    void loop();
    void startScan();
    void stopScan();
    void disconnect();
    void forceReconnect();

    bool isConnected();
    bool isScanning();
    BLEState getState();

    // Register device with BitsperBox
    void registerDevice(const char* deviceId, const char* deviceName);

    // Set target server address (from config)
    void setTargetAddress(const char* address);
    const char* getTargetAddress();

    // Callbacks
    void onNotification(std::function<void(BLENotificationData&)> callback);
    void onConnectionChange(std::function<void(bool)> callback);

    // Called by BLE callbacks (public for friend access)
    void handleDeviceFound(BLEAdvertisedDevice* device);
    void handleConnect();
    void handleDisconnect();
    void handleNotifyData(uint8_t* data, size_t length);
    void markScanComplete();

private:
    BLEState _state = BLE_STATE_IDLE;
    BLEScan* _pBLEScan = nullptr;
    BLEClient* _pClient = nullptr;
    BLERemoteCharacteristic* _pNotifyChar = nullptr;
    BLERemoteCharacteristic* _pRegisterChar = nullptr;
    BLEAdvertisedDevice* _pServerDevice = nullptr;

    // Connection state
    bool _connected = false;
    bool _doConnect = false;
    bool _doScan = false;
    unsigned long _lastScanTime = 0;
    unsigned long _lastReconnect = 0;
    unsigned long _lastHeartbeat = 0;
    int _reconnectAttempts = 0;

    // Device info for registration
    char _deviceId[32] = {0};
    char _deviceName[32] = {0};

    // Target server address (from config)
    char _targetAddress[20] = {0};

    // Callbacks
    std::function<void(BLENotificationData&)> _onNotification = nullptr;
    std::function<void(bool)> _onConnectionChange = nullptr;

    // Helper methods
    bool connectToServer();
    void parseNotification(uint8_t* data, size_t length);
    void scheduleReconnect();
};

extern BitsperBoxBLEClient BleClient;

#endif // BLE_CLIENT_H
