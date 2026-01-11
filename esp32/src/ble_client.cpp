#include "ble_client.h"
#include "display.h"
#include <ArduinoJson.h>

BitsperBoxBLEClient BleClient;

// Track display updates
static unsigned long lastDisplayUpdate = 0;
static const unsigned long DISPLAY_UPDATE_INTERVAL = 500;  // Update every 500ms

// UUIDs
static BLEUUID serviceUUID(BLE_SERVICE_UUID);
static BLEUUID notifyCharUUID(BLE_NOTIFY_CHAR_UUID);
static BLEUUID registerCharUUID(BLE_REGISTER_CHAR_UUID);

// Forward declarations for callbacks
class MyClientCallback;
class MyAdvertisedDeviceCallbacks;

// ============================================
// BLE Client Callbacks
// ============================================

class MyClientCallback : public BLEClientCallbacks {
    void onConnect(BLEClient* pclient) override {
        Serial.println("[BLE] onConnect callback");
        BleClient.handleConnect();
    }

    void onDisconnect(BLEClient* pclient) override {
        Serial.println("[BLE] onDisconnect callback");
        BleClient.handleDisconnect();
    }
};

class MyAdvertisedDeviceCallbacks : public BLEAdvertisedDeviceCallbacks {
    void onResult(BLEAdvertisedDevice advertisedDevice) override {
        // Log all found devices for debugging
        String name = advertisedDevice.haveName() ? advertisedDevice.getName().c_str() : "(sin nombre)";
        String addr = advertisedDevice.getAddress().toString().c_str();
        Serial.printf("[BLE] Encontrado: %s - %s\n", name.c_str(), addr.c_str());

        // First priority: Check if this matches the configured MAC address
        const char* targetAddr = BleClient.getTargetAddress();
        if (targetAddr != nullptr && strlen(targetAddr) > 0) {
            // Compare addresses (case insensitive)
            String targetLower = String(targetAddr);
            targetLower.toLowerCase();
            String foundLower = addr;
            foundLower.toLowerCase();

            if (targetLower == foundLower) {
                Serial.printf("[BLE] *** BitsperBox encontrado por direccion MAC configurada! ***\n");
                BleClient.handleDeviceFound(&advertisedDevice);
                return;
            }
        }

        // Second priority: Check by service UUID
        if (advertisedDevice.haveServiceUUID() &&
            advertisedDevice.isAdvertisingService(serviceUUID)) {
            Serial.printf("[BLE] *** BitsperBox encontrado por UUID! ***\n");
            BleClient.handleDeviceFound(&advertisedDevice);
            return;
        }

        // Third priority: Check by name
        if (advertisedDevice.haveName() &&
            advertisedDevice.getName() == BLE_SERVER_NAME) {
            Serial.printf("[BLE] *** BitsperBox encontrado por nombre! ***\n");
            BleClient.handleDeviceFound(&advertisedDevice);
            return;
        }
    }
};

// Notification callback (static for BLE library)
static void notifyCallback(BLERemoteCharacteristic* pBLERemoteCharacteristic,
                           uint8_t* pData, size_t length, bool isNotify) {
    Serial.printf("[BLE] Notification received, length: %d\n", length);
    BleClient.handleNotifyData(pData, length);
}

// ============================================
// BLE Client Implementation
// ============================================

// Scan complete callback
static void scanCompleteCallback(BLEScanResults results) {
    Serial.printf("[BLE] Escaneo completo. %d dispositivos encontrados.\n", results.getCount());

    // If we're still in scanning state (didn't find BitsperBox), show status
    if (BleClient.getState() == BLE_STATE_SCANNING) {
        Display.showBLEStatus("NO ENCONTRADO", "Reintentando...");
        Serial.println("[BLE] BitsperBox no encontrado, reintentara...");
        BleClient.markScanComplete();  // Reset state to allow next scan
    }
}

// Public method to mark scan as complete (called from callback)
void BitsperBoxBLEClient::markScanComplete() {
    if (_state == BLE_STATE_SCANNING) {
        _state = BLE_STATE_DISCONNECTED;
    }
}

void BitsperBoxBLEClient::begin() {
    Serial.println("[BLE] Initializing BLE client...");

    BLEDevice::init("BitsperWatch");

    _pBLEScan = BLEDevice::getScan();
    _pBLEScan->setAdvertisedDeviceCallbacks(new MyAdvertisedDeviceCallbacks());
    _pBLEScan->setInterval(1349);
    _pBLEScan->setWindow(449);
    _pBLEScan->setActiveScan(true);

    _state = BLE_STATE_IDLE;

    Serial.println("[BLE] BLE client initialized");
    Serial.println("[BLE] Buscara dispositivo: " BLE_SERVER_NAME);
}

void BitsperBoxBLEClient::loop() {
    // Handle connection request
    if (_doConnect) {
        _doConnect = false;
        Display.showBLEConnecting("BitsperBox");
        if (connectToServer()) {
            Serial.println("[BLE] Connected to BitsperBox!");
            // Note: Display will be updated by onConnectionChange callback
        } else {
            Serial.println("[BLE] Failed to connect, will retry...");
            Display.showBLEStatus("ERROR", "Conexion fallida");
            delay(1000);
            scheduleReconnect();
        }
    }

    // Handle scan request
    if (_doScan && !_connected) {
        _doScan = false;
        _state = BLE_STATE_SCANNING;
        Serial.println("[BLE] Starting BLE scan...");
        Serial.println("[BLE] Buscando dispositivo llamado: " BLE_SERVER_NAME);

        // Show scanning on display
        Display.showBLEScanning();

        // Clear previous results
        _pBLEScan->clearResults();

        // Start scan with completion callback (5 seconds, non-blocking)
        _pBLEScan->start(5, scanCompleteCallback, false);
    }

    // Update display while scanning
    if (_state == BLE_STATE_SCANNING) {
        unsigned long now = millis();
        if (now - lastDisplayUpdate > DISPLAY_UPDATE_INTERVAL) {
            lastDisplayUpdate = now;
            Display.showBLEScanning();  // Update animation
        }
    }

    // Auto-scan if disconnected
    if (!_connected && _state != BLE_STATE_SCANNING &&
        _state != BLE_STATE_CONNECTING) {
        unsigned long now = millis();

        // Check if we should scan
        if (now - _lastScanTime > BLE_SCAN_INTERVAL) {
            _lastScanTime = now;
            _doScan = true;
        }
    }

    // Handle reconnection with backoff
    if (!_connected && _lastReconnect > 0 && millis() >= _lastReconnect) {
        _lastReconnect = 0;
        _doScan = true;
    }
}

void BitsperBoxBLEClient::startScan() {
    if (!_connected) {
        _doScan = true;
    }
}

void BitsperBoxBLEClient::stopScan() {
    if (_pBLEScan) {
        _pBLEScan->stop();
    }
    _state = BLE_STATE_IDLE;
}

void BitsperBoxBLEClient::disconnect() {
    if (_pClient && _connected) {
        _pClient->disconnect();
    }
    _connected = false;
    _state = BLE_STATE_DISCONNECTED;
}

void BitsperBoxBLEClient::forceReconnect() {
    disconnect();
    _reconnectAttempts = 0;
    _doScan = true;
}

bool BitsperBoxBLEClient::isConnected() {
    return _connected;
}

bool BitsperBoxBLEClient::isScanning() {
    return _state == BLE_STATE_SCANNING;
}

BLEState BitsperBoxBLEClient::getState() {
    return _state;
}

void BitsperBoxBLEClient::setTargetAddress(const char* address) {
    if (address != nullptr) {
        strncpy(_targetAddress, address, sizeof(_targetAddress) - 1);
        Serial.printf("[BLE] Target address set to: %s\n", _targetAddress);
    }
}

const char* BitsperBoxBLEClient::getTargetAddress() {
    return _targetAddress;
}

void BitsperBoxBLEClient::registerDevice(const char* deviceId, const char* deviceName) {
    strncpy(_deviceId, deviceId, sizeof(_deviceId) - 1);
    strncpy(_deviceName, deviceName, sizeof(_deviceName) - 1);

    // If already connected, send registration
    if (_connected && _pRegisterChar) {
        StaticJsonDocument<128> doc;
        doc["type"] = "register";
        doc["device_id"] = _deviceId;
        doc["name"] = _deviceName;

        char buffer[128];
        serializeJson(doc, buffer);

        _pRegisterChar->writeValue((uint8_t*)buffer, strlen(buffer));
        Serial.printf("[BLE] Registration sent: %s\n", buffer);
    }
}

void BitsperBoxBLEClient::onNotification(std::function<void(BLENotificationData&)> callback) {
    _onNotification = callback;
}

void BitsperBoxBLEClient::onConnectionChange(std::function<void(bool)> callback) {
    _onConnectionChange = callback;
}

// ============================================
// BLE Event Handlers (called from callbacks)
// ============================================

void BitsperBoxBLEClient::handleDeviceFound(BLEAdvertisedDevice* device) {
    // Ignore if already connected, connecting, or connection pending
    if (_connected || _state == BLE_STATE_CONNECTING || _doConnect) {
        Serial.println("[BLE] Ignoring device found - already connected/connecting");
        return;
    }

    // Stop scanning
    _pBLEScan->stop();
    _state = BLE_STATE_IDLE;

    // Show found device on display
    String deviceName = device->haveName() ? device->getName().c_str() : "BitsperBox";
    Display.showBLEFound(deviceName.c_str());
    delay(1500);  // Show found message briefly

    // Store device and request connection
    _pServerDevice = new BLEAdvertisedDevice(*device);
    _doConnect = true;
}

void BitsperBoxBLEClient::handleConnect() {
    _connected = true;
    _state = BLE_STATE_CONNECTED;
    _reconnectAttempts = 0;

    // Send registration if we have device info
    if (strlen(_deviceId) > 0) {
        // Delay slightly to let connection stabilize
        delay(500);
        registerDevice(_deviceId, _deviceName);
    }

    if (_onConnectionChange) {
        _onConnectionChange(true);
    }
}

void BitsperBoxBLEClient::handleDisconnect() {
    _connected = false;
    _state = BLE_STATE_DISCONNECTED;
    _pNotifyChar = nullptr;
    _pRegisterChar = nullptr;

    Serial.println("[BLE] Disconnected from BitsperBox");

    if (_onConnectionChange) {
        _onConnectionChange(false);
    }

    // Schedule reconnection
    scheduleReconnect();
}

void BitsperBoxBLEClient::handleNotifyData(uint8_t* data, size_t length) {
    parseNotification(data, length);
}

// ============================================
// Private Helper Methods
// ============================================

bool BitsperBoxBLEClient::connectToServer() {
    if (!_pServerDevice) {
        Serial.println("[BLE] No server device to connect to");
        return false;
    }

    _state = BLE_STATE_CONNECTING;
    Serial.printf("[BLE] Connecting to %s...\n",
                  _pServerDevice->getAddress().toString().c_str());

    // Create client
    _pClient = BLEDevice::createClient();
    _pClient->setClientCallbacks(new MyClientCallback());

    // Connect to server
    if (!_pClient->connect(_pServerDevice)) {
        Serial.println("[BLE] Failed to connect");
        _state = BLE_STATE_DISCONNECTED;
        return false;
    }

    Serial.println("[BLE] Connected, discovering services...");

    // Get service
    BLERemoteService* pRemoteService = _pClient->getService(serviceUUID);
    if (pRemoteService == nullptr) {
        Serial.println("[BLE] Failed to find BitsperBox service");
        _pClient->disconnect();
        _state = BLE_STATE_DISCONNECTED;
        return false;
    }

    // Get notification characteristic
    _pNotifyChar = pRemoteService->getCharacteristic(notifyCharUUID);
    if (_pNotifyChar == nullptr) {
        Serial.println("[BLE] Failed to find notify characteristic");
        _pClient->disconnect();
        _state = BLE_STATE_DISCONNECTED;
        return false;
    }

    // Subscribe to notifications
    if (_pNotifyChar->canNotify()) {
        _pNotifyChar->registerForNotify(notifyCallback);
        Serial.println("[BLE] Subscribed to notifications");
    }

    // Get register characteristic
    _pRegisterChar = pRemoteService->getCharacteristic(registerCharUUID);
    if (_pRegisterChar == nullptr) {
        Serial.println("[BLE] Warning: register characteristic not found");
    }

    // Connection successful - callback will be called by onConnect
    return true;
}

void BitsperBoxBLEClient::parseNotification(uint8_t* data, size_t length) {
    // Null terminate the data
    char json[512];
    size_t copyLen = (length < sizeof(json) - 1) ? length : sizeof(json) - 1;
    memcpy(json, data, copyLen);
    json[copyLen] = '\0';

    Serial.printf("[BLE] Parsing: %s\n", json);

    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("[BLE] JSON parse error: %s\n", error.c_str());
        return;
    }

    // Check message type
    const char* type = doc["type"] | "";

    if (strcmp(type, "notification") == 0) {
        BLENotificationData notif;
        memset(&notif, 0, sizeof(notif));

        strncpy(notif.table, doc["table"] | "", sizeof(notif.table) - 1);
        strncpy(notif.type, doc["alert"] | "", sizeof(notif.type) - 1);
        strncpy(notif.message, doc["message"] | "", sizeof(notif.message) - 1);
        strncpy(notif.priority, doc["priority"] | "medium", sizeof(notif.priority) - 1);
        notif.timestamp = doc["timestamp"] | millis();

        Serial.printf("[BLE] Notification: Table %s, Type %s, Priority %s\n",
                      notif.table, notif.type, notif.priority);

        if (_onNotification) {
            _onNotification(notif);
        }
    }
    else if (strcmp(type, "pong") == 0) {
        // Heartbeat response
        Serial.println("[BLE] Heartbeat pong received");
    }
    else if (strcmp(type, "registered") == 0) {
        Serial.println("[BLE] Device registered with BitsperBox");
    }
    else {
        Serial.printf("[BLE] Unknown message type: %s\n", type);
    }
}

void BitsperBoxBLEClient::scheduleReconnect() {
    _reconnectAttempts++;

    // Exponential backoff: 3s, 6s, 12s, 24s, 30s max
    unsigned long delay = BLE_RECONNECT_DELAY * (1 << (_reconnectAttempts - 1));
    if (delay > 30000UL) delay = 30000UL;

    _lastReconnect = millis() + delay;

    Serial.printf("[BLE] Reconnect scheduled in %lu ms (attempt %d)\n",
                  delay, _reconnectAttempts);
}
