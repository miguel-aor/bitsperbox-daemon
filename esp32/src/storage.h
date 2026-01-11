#ifndef STORAGE_H
#define STORAGE_H

#include <Arduino.h>
#include <Preferences.h>

// ============================================
// Configuration Storage (NVS)
// ============================================

struct DeviceConfig {
    // WiFi
    char wifi_ssid[64];
    char wifi_password[64];

    // Mode: "bitsperbox" or "direct"
    char mode[16];

    // Connection mode: "wifi", "ble", "both"
    char connection_mode[8];

    // BitsperBox mode settings
    char bitsperbox_ip[32];
    uint16_t bitsperbox_port;

    // BLE settings (for connecting to BitsperBox via Bluetooth)
    char ble_server_address[20];  // MAC address: "AA:BB:CC:DD:EE:FF"
    char ble_server_name[32];     // Display name of selected BLE device

    // Direct mode settings (Supabase)
    char supabase_url[128];
    char supabase_key[256];
    char restaurant_id[64];

    // Device info
    char device_name[32];

    // Flags
    bool configured;
};

class StorageManager {
public:
    void begin();

    // Load/Save full config
    bool loadConfig(DeviceConfig& config);
    bool saveConfig(const DeviceConfig& config);

    // Check if configured
    bool isConfigured();

    // Clear all config (factory reset)
    void clearConfig();

    // Get device unique ID (from MAC)
    String getDeviceId();

private:
    Preferences _prefs;
    String _deviceId;
};

extern StorageManager Storage;

#endif // STORAGE_H
