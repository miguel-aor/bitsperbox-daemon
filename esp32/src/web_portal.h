#ifndef WEB_PORTAL_H
#define WEB_PORTAL_H

#include <Arduino.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "storage.h"

// ============================================
// Web Portal for Configuration
// ============================================

class WebPortal {
public:
    void begin();
    void stop();
    void handleClient();
    bool isRunning();

    // Callback when config is saved
    void onConfigSaved(std::function<void()> callback);

private:
    WebServer* _server = nullptr;
    DNSServer* _dns = nullptr;
    bool _running = false;
    std::function<void()> _onConfigSaved = nullptr;

    void handleRoot();
    void handleSave();
    void handleScan();
    void handleScanBLE();
    void handleNotFound();

    String generateHTML();
    String scanNetworks();
    String scanBLEDevices();
};

extern WebPortal Portal;

#endif // WEB_PORTAL_H
