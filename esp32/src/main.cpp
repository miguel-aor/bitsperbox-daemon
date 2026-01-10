/**
 * BitsperWatch - ESP32-C6 Notification Device
 *
 * Receives notifications from BitsperBox (Raspberry Pi) or directly from
 * Supabase Realtime and displays them on the LCD screen.
 *
 * Hardware: XUMIUZIY ESP32-C6 LCD 1.47" (ST7789 172x320)
 *
 * (c) 2025 BitsperFoods
 */

#include <Arduino.h>
#include "config.h"
#include "display.h"
#include "storage.h"
#include "wifi_manager.h"
#include "web_portal.h"
#include "websocket_client.h"

// ============================================
// Global State
// ============================================

enum DeviceState {
    STATE_BOOT,
    STATE_AP_MODE,
    STATE_CONNECTING,
    STATE_CONNECTED,
    STATE_ERROR
};

DeviceState currentState = STATE_BOOT;
DeviceConfig deviceConfig;
unsigned long lastUpdate = 0;
bool shouldRestart = false;
unsigned long restartTime = 0;

// Notification state
bool hasActiveNotification = false;
unsigned long notificationTime = 0;
NotificationData currentNotification;

// Button state
volatile bool btnUserPressed = false;
volatile bool btnBootPressed = false;
unsigned long btnUserPressTime = 0;
unsigned long btnBootPressTime = 0;

// Long press detection
#define LONG_PRESS_TIME 3000  // 3 seconds for factory reset

// Alert blinking
bool alertBlinkState = false;
unsigned long lastBlink = 0;

// ============================================
// Button Handling
// ============================================

void IRAM_ATTR onUserButtonPress() {
    btnUserPressed = true;
    btnUserPressTime = millis();
}

void IRAM_ATTR onBootButtonPress() {
    btnBootPressed = true;
    btnBootPressTime = millis();
}

void setupButtons() {
    pinMode(BTN_USER, INPUT_PULLUP);
    pinMode(BTN_BOOT, INPUT_PULLUP);

    attachInterrupt(digitalPinToInterrupt(BTN_USER), onUserButtonPress, FALLING);
    attachInterrupt(digitalPinToInterrupt(BTN_BOOT), onBootButtonPress, FALLING);

    Serial.println("[BTN] Buttons initialized");
}

void dismissNotification() {
    hasActiveNotification = false;
    Display.blinkAlert(false);
    const char* modeText = strcmp(deviceConfig.mode, "direct") == 0 ? "Supabase" : "BitsperBox";
    Display.showIdle(WsClient.isConnected(), modeText);
    Serial.println("[NOTIF] Notification dismissed");
}

void handleButtons() {
    // USER button - dismiss notification
    if (btnUserPressed) {
        btnUserPressed = false;
        Serial.println("[BTN] USER button pressed");

        if (hasActiveNotification) {
            dismissNotification();
        }
    }

    // BOOT button - check for long press to factory reset
    if (btnBootPressed) {
        // Check if still held
        if (digitalRead(BTN_BOOT) == LOW) {
            unsigned long holdTime = millis() - btnBootPressTime;

            if (holdTime > LONG_PRESS_TIME) {
                btnBootPressed = false;
                Serial.println("[BTN] Long press detected - Factory Reset!");

                Display.showError("Factory Reset...");
                delay(1000);

                Storage.clearConfig();
                ESP.restart();
            }
        } else {
            btnBootPressed = false;
            Serial.println("[BTN] BOOT button released");

            // Short press - show connection info
            if (currentState == STATE_CONNECTED && !hasActiveNotification) {
                Display.showConnected(WifiMgr.getSSID().c_str(), WifiMgr.getIPAddress().c_str());
                delay(3000);
                const char* modeText = strcmp(deviceConfig.mode, "direct") == 0 ? "Supabase" : "BitsperBox";
                Display.showIdle(WsClient.isConnected(), modeText);
            }
        }
    }
}

// ============================================
// Notification Handling
// ============================================

void showNotification(NotificationData& notif) {
    hasActiveNotification = true;
    notificationTime = millis();
    currentNotification = notif;

    Display.showNotification(notif.table, notif.type, notif.message, notif.priority);

    Serial.printf("[NOTIF] Showing: Table %s - %s (%s)\n",
                  notif.table, notif.type, notif.priority);
}

void updateNotificationBlink() {
    if (!hasActiveNotification) return;

    // Only blink for urgent/high priority
    bool shouldBlink = (strcmp(currentNotification.priority, "urgent") == 0 ||
                        strcmp(currentNotification.priority, "high") == 0);

    if (!shouldBlink) return;

    if (millis() - lastBlink > ALERT_BLINK_INTERVAL) {
        lastBlink = millis();
        alertBlinkState = !alertBlinkState;
        Display.blinkAlert(alertBlinkState);
    }

    // Auto-dismiss after timeout
    if (millis() - notificationTime > NOTIFICATION_TIMEOUT) {
        Serial.println("[NOTIF] Auto-dismissing after timeout");
        dismissNotification();
    }
}

// ============================================
// State Machine
// ============================================

void enterAPMode() {
    Serial.println("[STATE] Entering AP Mode");
    currentState = STATE_AP_MODE;

    WifiMgr.startAPMode();
    Portal.begin();

    Portal.onConfigSaved([]() {
        Serial.println("[STATE] Config saved, scheduling restart...");
        shouldRestart = true;
        restartTime = millis() + 3000;
    });
}

void startWebSocketClient() {
    Serial.println("[STATE] Starting WebSocket client");

    // Set up notification callback
    WsClient.onNotification([](NotificationData& notif) {
        showNotification(notif);
    });

    // Set up connection status callback
    WsClient.onConnectionChange([](bool connected) {
        if (connected) {
            Serial.println("[WS] Connected to BitsperBox!");
            if (!hasActiveNotification) {
                const char* modeText = strcmp(deviceConfig.mode, "direct") == 0 ? "Supabase" : "BitsperBox";
                Display.showIdle(true, modeText);
            }
        } else {
            Serial.println("[WS] Disconnected from BitsperBox");
            if (!hasActiveNotification) {
                const char* modeText = strcmp(deviceConfig.mode, "direct") == 0 ? "Supabase" : "BitsperBox";
                Display.showIdle(false, modeText);
            }
        }
    });

    // Connect to BitsperBox
    WsClient.begin(deviceConfig.bitsperbox_ip, deviceConfig.bitsperbox_port);
}

void enterConnectedMode() {
    Serial.println("[STATE] Entering Connected Mode");
    currentState = STATE_CONNECTED;

    delay(2000);  // Show connected screen briefly

    // Start WebSocket based on mode
    if (strcmp(deviceConfig.mode, "bitsperbox") == 0) {
        startWebSocketClient();
    } else {
        // Direct mode - TODO: Implement Supabase client
        Serial.println("[STATE] Direct mode not yet implemented");
    }

    // Show idle screen
    const char* modeText = strcmp(deviceConfig.mode, "direct") == 0 ? "Supabase" : "BitsperBox";
    Display.showIdle(false, modeText);
}

// ============================================
// Setup & Loop
// ============================================

void setup() {
    // Initialize Serial
    Serial.begin(115200);
    delay(1000);

    Serial.println();
    Serial.println("========================================");
    Serial.println("   BitsperWatch - ESP32-C6");
    Serial.println("   Firmware v" FIRMWARE_VERSION);
    Serial.println("========================================");

    // Initialize display first for visual feedback
    Serial.println("[INIT] Initializing display...");
    Display.begin();
    Display.showSplash();

    // Initialize storage
    Serial.println("[INIT] Initializing storage...");
    Storage.begin();

    // Initialize buttons
    setupButtons();

    // Initialize WiFi manager
    WifiMgr.begin();

    // Print device info
    Serial.printf("[INFO] Device ID: %s\n", Storage.getDeviceId().c_str());
    Serial.printf("[INFO] Chip: %s Rev %d\n", ESP.getChipModel(), ESP.getChipRevision());
    Serial.printf("[INFO] Flash: %d MB\n", ESP.getFlashChipSize() / 1024 / 1024);
    Serial.printf("[INFO] Free heap: %d bytes\n", ESP.getFreeHeap());

    delay(1500);

    // Check if configured
    if (Storage.isConfigured()) {
        Serial.println("[INIT] Configuration found, loading...");

        if (Storage.loadConfig(deviceConfig)) {
            Serial.printf("[INIT] Mode: %s\n", deviceConfig.mode);
            Serial.printf("[INIT] BitsperBox IP: %s:%d\n",
                          deviceConfig.bitsperbox_ip, deviceConfig.bitsperbox_port);

            // Try to connect to WiFi
            currentState = STATE_CONNECTING;
            if (WifiMgr.connect(deviceConfig.wifi_ssid, deviceConfig.wifi_password)) {
                enterConnectedMode();
            } else {
                Serial.println("[INIT] WiFi connection failed, entering AP mode");
                enterAPMode();
            }
        } else {
            enterAPMode();
        }
    } else {
        Serial.println("[INIT] No configuration, entering AP mode");
        enterAPMode();
    }

    Serial.println("[INIT] Setup complete!");
}

void loop() {
    // Handle scheduled restart
    if (shouldRestart && millis() > restartTime) {
        Serial.println("[SYSTEM] Restarting...");
        ESP.restart();
    }

    // Handle buttons
    handleButtons();

    // State-specific updates
    switch (currentState) {
        case STATE_AP_MODE:
            Portal.handleClient();
            break;

        case STATE_CONNECTED:
            WifiMgr.checkConnection();

            // WebSocket client loop (for BitsperBox mode)
            if (strcmp(deviceConfig.mode, "bitsperbox") == 0) {
                WsClient.loop();
            }

            // Update notification blinking
            updateNotificationBlink();
            break;

        default:
            break;
    }

    // Update display animations
    Display.update();

    delay(10);
}
