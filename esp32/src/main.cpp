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
#include <WiFi.h>
#include "config.h"
#include "display.h"

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
unsigned long lastUpdate = 0;

// Button state
bool btnUserPressed = false;
bool btnBootPressed = false;
unsigned long btnUserPressTime = 0;

// ============================================
// Button Handling
// ============================================

void IRAM_ATTR onUserButtonPress() {
    btnUserPressed = true;
    btnUserPressTime = millis();
}

void IRAM_ATTR onBootButtonPress() {
    btnBootPressed = true;
}

void setupButtons() {
    pinMode(BTN_USER, INPUT_PULLUP);
    pinMode(BTN_BOOT, INPUT_PULLUP);

    attachInterrupt(digitalPinToInterrupt(BTN_USER), onUserButtonPress, FALLING);
    attachInterrupt(digitalPinToInterrupt(BTN_BOOT), onBootButtonPress, FALLING);

    Serial.println("[BTN] Buttons initialized");
}

// ============================================
// WiFi Functions
// ============================================

bool connectToWiFi(const char* ssid, const char* password) {
    Serial.printf("[WiFi] Connecting to %s...\n", ssid);
    Display.showConnecting(ssid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    unsigned long startTime = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - startTime > WIFI_CONNECT_TIMEOUT) {
            Serial.println("[WiFi] Connection timeout!");
            return false;
        }
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.printf("[WiFi] Connected! IP: %s\n", WiFi.localIP().toString().c_str());

    Display.showConnected(ssid, WiFi.localIP().toString().c_str());
    delay(2000);

    return true;
}

void startAPMode() {
    // Generate unique AP name from MAC
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char apSSID[32];
    snprintf(apSSID, sizeof(apSSID), "%s%02X%02X", WIFI_AP_SSID_PREFIX, mac[4], mac[5]);

    Serial.printf("[WiFi] Starting AP Mode: %s\n", apSSID);

    WiFi.mode(WIFI_AP);
    WiFi.softAP(apSSID, WIFI_AP_PASSWORD);

    Display.showAPMode(apSSID, WIFI_AP_PASSWORD);
    currentState = STATE_AP_MODE;
}

// ============================================
// Test Functions
// ============================================

void testDisplay() {
    Serial.println("[TEST] Display test starting...");

    // Test 1: Splash screen
    Display.showSplash();
    delay(2000);

    // Test 2: Connecting animation
    Display.showConnecting("TestNetwork");
    delay(2000);

    // Test 3: Connected screen
    Display.showConnected("TestNetwork", "192.168.1.100");
    delay(2000);

    // Test 4: Idle screen
    Display.showIdle(true, "BitsperBox");
    delay(2000);

    // Test 5: Notification - Waiter call
    Display.showNotification("5", "waiter_called",
                             "El cliente necesita atencion", "medium");
    delay(3000);

    // Test 6: Notification - Bill request
    Display.showNotification("3", "bill_ready",
                             "Quiero pagar con tarjeta", "high");
    delay(3000);

    // Test 7: Notification - Urgent
    Display.showNotification("1", "waiter_called",
                             "URGENTE! Necesito ayuda!", "urgent");

    // Blink test
    for (int i = 0; i < 6; i++) {
        Display.blinkAlert(i % 2 == 0);
        delay(500);
    }
    Display.blinkAlert(false);
    delay(2000);

    // Test 8: AP Mode screen
    Display.showAPMode("BitsperWatch-A1B2", "bitsper123");
    delay(2000);

    // Test 9: Error screen
    Display.showError("No se pudo conectar");
    delay(2000);

    Serial.println("[TEST] Display test complete!");
}

void runDemoMode() {
    Serial.println("[DEMO] Running demo mode...");

    // Show idle
    Display.showIdle(true, "Demo Mode");

    // Simulate notifications every 5 seconds
    static unsigned long lastNotif = 0;
    static int notifIndex = 0;

    if (millis() - lastNotif > 5000) {
        lastNotif = millis();

        const char* tables[] = {"1", "3", "5", "7", "12"};
        const char* types[] = {"waiter_called", "bill_ready", "waiter_called", "payment_confirmed", "waiter_called"};
        const char* messages[] = {
            "Necesito mas servilletas",
            "Queremos la cuenta por favor",
            "Pueden traer la carta de postres?",
            "Pago confirmado - Gracias!",
            "Urgente - problema con el pedido"
        };
        const char* priorities[] = {"medium", "high", "low", "medium", "urgent"};

        Display.showNotification(
            tables[notifIndex],
            types[notifIndex],
            messages[notifIndex],
            priorities[notifIndex]
        );

        notifIndex = (notifIndex + 1) % 5;
    }
}

// ============================================
// Setup & Loop
// ============================================

void setup() {
    // Initialize Serial
    Serial.begin(115200);
    delay(1000);  // Give serial time to initialize

    Serial.println();
    Serial.println("========================================");
    Serial.println("   BitsperWatch - ESP32-C6");
    Serial.println("   Firmware v" FIRMWARE_VERSION);
    Serial.println("========================================");

    // Initialize display
    Serial.println("[INIT] Initializing display...");
    Display.begin();
    Display.showSplash();
    delay(1500);

    // Initialize buttons
    setupButtons();

    // Print chip info
    Serial.printf("[INFO] Chip: %s Rev %d\n", ESP.getChipModel(), ESP.getChipRevision());
    Serial.printf("[INFO] Flash: %d MB\n", ESP.getFlashChipSize() / 1024 / 1024);
    Serial.printf("[INFO] Free heap: %d bytes\n", ESP.getFreeHeap());

    // For now, run display test
    // In production, this would check for saved WiFi credentials
    // and connect or start AP mode
    Serial.println("[INIT] Running display test...");
    testDisplay();

    // Show idle screen after test
    Display.showIdle(false, "Sin config");
    currentState = STATE_BOOT;

    Serial.println("[INIT] Setup complete! Press USER button to run demo.");
}

void loop() {
    // Handle USER button
    if (btnUserPressed) {
        btnUserPressed = false;
        Serial.println("[BTN] USER button pressed!");

        // Run demo notification
        static int demoIndex = 0;
        const char* tables[] = {"1", "5", "8", "3", "12"};
        const char* types[] = {"waiter_called", "bill_ready", "waiter_called", "payment_confirmed", "waiter_called"};
        const char* messages[] = {
            "Necesito mas agua por favor",
            "La cuenta por favor!",
            "Pueden venir a tomar la orden?",
            "Pago con tarjeta confirmado",
            "Urgente - ayuda!"
        };
        const char* priorities[] = {"low", "high", "medium", "medium", "urgent"};

        Display.showNotification(
            tables[demoIndex],
            types[demoIndex],
            messages[demoIndex],
            priorities[demoIndex]
        );

        demoIndex = (demoIndex + 1) % 5;
    }

    // Handle BOOT button - return to idle
    if (btnBootPressed) {
        btnBootPressed = false;
        Serial.println("[BTN] BOOT button pressed - returning to idle");
        Display.showIdle(false, "Demo Mode");
    }

    // Update display (for animations)
    Display.update();

    delay(10);
}
