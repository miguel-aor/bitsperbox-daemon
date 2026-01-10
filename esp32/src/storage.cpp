#include "storage.h"
#include <WiFi.h>

StorageManager Storage;

void StorageManager::begin() {
    _prefs.begin("bitsperwatch", false);

    // Generate device ID from MAC
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X%02X%02X%02X%02X%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    _deviceId = String(macStr);

    Serial.printf("[Storage] Initialized. Device ID: %s\n", _deviceId.c_str());
}

bool StorageManager::loadConfig(DeviceConfig& config) {
    // Clear struct
    memset(&config, 0, sizeof(DeviceConfig));

    // Check if configured
    config.configured = _prefs.getBool("configured", false);
    if (!config.configured) {
        Serial.println("[Storage] No configuration found");
        return false;
    }

    // Load WiFi
    String ssid = _prefs.getString("wifi_ssid", "");
    String pass = _prefs.getString("wifi_pass", "");
    strncpy(config.wifi_ssid, ssid.c_str(), sizeof(config.wifi_ssid) - 1);
    strncpy(config.wifi_password, pass.c_str(), sizeof(config.wifi_password) - 1);

    // Load mode
    String mode = _prefs.getString("mode", "bitsperbox");
    strncpy(config.mode, mode.c_str(), sizeof(config.mode) - 1);

    // Load BitsperBox settings
    String bbIp = _prefs.getString("bb_ip", "");
    config.bitsperbox_port = _prefs.getUShort("bb_port", 3334);
    strncpy(config.bitsperbox_ip, bbIp.c_str(), sizeof(config.bitsperbox_ip) - 1);

    // Load Supabase settings (for direct mode)
    String sbUrl = _prefs.getString("sb_url", "");
    String sbKey = _prefs.getString("sb_key", "");
    String restId = _prefs.getString("rest_id", "");
    strncpy(config.supabase_url, sbUrl.c_str(), sizeof(config.supabase_url) - 1);
    strncpy(config.supabase_key, sbKey.c_str(), sizeof(config.supabase_key) - 1);
    strncpy(config.restaurant_id, restId.c_str(), sizeof(config.restaurant_id) - 1);

    // Load device name
    String devName = _prefs.getString("dev_name", "BitsperWatch");
    strncpy(config.device_name, devName.c_str(), sizeof(config.device_name) - 1);

    Serial.printf("[Storage] Config loaded. Mode: %s, WiFi: %s\n",
                  config.mode, config.wifi_ssid);

    return true;
}

bool StorageManager::saveConfig(const DeviceConfig& config) {
    // Save WiFi
    _prefs.putString("wifi_ssid", config.wifi_ssid);
    _prefs.putString("wifi_pass", config.wifi_password);

    // Save mode
    _prefs.putString("mode", config.mode);

    // Save BitsperBox settings
    _prefs.putString("bb_ip", config.bitsperbox_ip);
    _prefs.putUShort("bb_port", config.bitsperbox_port);

    // Save Supabase settings
    _prefs.putString("sb_url", config.supabase_url);
    _prefs.putString("sb_key", config.supabase_key);
    _prefs.putString("rest_id", config.restaurant_id);

    // Save device name
    _prefs.putString("dev_name", config.device_name);

    // Mark as configured
    _prefs.putBool("configured", true);

    Serial.println("[Storage] Configuration saved");
    return true;
}

bool StorageManager::isConfigured() {
    return _prefs.getBool("configured", false);
}

void StorageManager::clearConfig() {
    _prefs.clear();
    Serial.println("[Storage] Configuration cleared (factory reset)");
}

String StorageManager::getDeviceId() {
    return _deviceId;
}
