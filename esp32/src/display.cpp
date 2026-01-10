#include "display.h"

DisplayManager Display;

void DisplayManager::begin() {
    _display.init();
    _display.setRotation(LCD_ROTATION);
    _display.fillScreen(COLOR_BG);
    _display.setTextColor(COLOR_TEXT);
    _display.setTextSize(1);
    _initialized = true;
    setBrightness(128);
}

void DisplayManager::clear() {
    _display.fillScreen(COLOR_BG);
}

void DisplayManager::setBrightness(uint8_t brightness) {
    _display.setBrightness(brightness);
}

void DisplayManager::showSplash() {
    clear();

    // Logo area
    _display.fillRect(0, 0, LCD_WIDTH, 80, COLOR_PRIMARY);

    // Title
    _display.setTextColor(COLOR_BG);
    _display.setTextSize(2);
    drawCenteredText("BITSPER", 20, 2, COLOR_BG);
    drawCenteredText("WATCH", 45, 2, COLOR_BG);

    // Version
    _display.setTextColor(COLOR_TEXT);
    _display.setTextSize(1);
    drawCenteredText(FIRMWARE_VERSION, 100, 1, COLOR_TEXT);

    // Loading
    drawCenteredText("Iniciando...", 150, 1, COLOR_PRIMARY);

    // Footer
    _display.setTextColor(0x7BEF);  // Gray
    drawCenteredText("BitsperFoods", LCD_HEIGHT - 20, 1, 0x7BEF);
}

void DisplayManager::showConnecting(const char* ssid) {
    clear();
    drawHeader("CONECTANDO", COLOR_WARNING);

    _display.setTextSize(1);
    drawCenteredText("Conectando a WiFi...", 100, 1, COLOR_TEXT);

    _display.setTextSize(1);
    drawCenteredText(ssid, 130, 1, COLOR_PRIMARY);

    // Animated dots would go here
    drawCenteredText("...", 160, 2, COLOR_WARNING);
}

void DisplayManager::showConnected(const char* ssid, const char* ip) {
    clear();
    drawHeader("CONECTADO", COLOR_SUCCESS);

    _display.setTextSize(1);
    drawCenteredText("WiFi:", 100, 1, 0x7BEF);
    drawCenteredText(ssid, 120, 1, COLOR_TEXT);

    drawCenteredText("IP:", 150, 1, 0x7BEF);
    drawCenteredText(ip, 170, 1, COLOR_TEXT);

    drawCenteredText("OK!", 210, 2, COLOR_SUCCESS);
}

void DisplayManager::showAPMode(const char* ssid, const char* password) {
    clear();
    drawHeader("CONFIGURAR", COLOR_INFO);

    _display.setTextSize(1);
    drawCenteredText("Conecta a WiFi:", 90, 1, COLOR_TEXT);

    _display.setTextSize(1);
    drawCenteredText(ssid, 115, 1, COLOR_PRIMARY);

    drawCenteredText("Password:", 145, 1, COLOR_TEXT);
    drawCenteredText(password, 165, 1, COLOR_PRIMARY);

    drawCenteredText("Luego abre:", 200, 1, 0x7BEF);
    drawCenteredText("192.168.4.1", 220, 1, COLOR_WARNING);
}

void DisplayManager::showError(const char* message) {
    clear();
    drawHeader("ERROR", COLOR_DANGER);

    _display.setTextSize(1);
    drawCenteredText(message, 120, 1, COLOR_TEXT);

    drawCenteredText("Reiniciando...", 180, 1, COLOR_WARNING);
}

void DisplayManager::showIdle(bool connected, const char* mode) {
    clear();

    // Header with connection status
    uint16_t headerColor = connected ? COLOR_SUCCESS : COLOR_DANGER;
    drawHeader("BITSPERWATCH", headerColor);

    // Connection indicator
    const char* statusText = connected ? "Conectado" : "Desconectado";
    uint16_t statusColor = connected ? COLOR_SUCCESS : COLOR_DANGER;

    _display.fillCircle(20, 100, 8, statusColor);
    _display.setTextSize(1);
    _display.setCursor(35, 95);
    _display.setTextColor(COLOR_TEXT);
    _display.print(statusText);

    // Mode
    _display.setCursor(35, 115);
    _display.setTextColor(0x7BEF);
    _display.print("via ");
    _display.print(mode);

    // Waiting message
    drawCenteredText("Esperando", 170, 1, 0x7BEF);
    drawCenteredText("notificaciones...", 190, 1, 0x7BEF);

    // Footer with time or info
    drawFooter("BTN: Menu", "v" FIRMWARE_VERSION);
}

void DisplayManager::showNotification(const char* table, const char* type,
                                      const char* message, const char* priority) {
    clear();

    // Get colors based on type/priority
    uint16_t bgColor = getColorForType(type);
    bool isUrgent = (strcmp(priority, "urgent") == 0 || strcmp(priority, "high") == 0);

    // Header with alert type
    const char* icon = getIconForType(type);
    char header[32];
    snprintf(header, sizeof(header), "%s ALERTA", icon);
    drawHeader(header, bgColor);

    // Table number - BIG
    _display.setTextSize(4);
    char tableText[16];
    snprintf(tableText, sizeof(tableText), "MESA %s", table);
    drawCenteredText(tableText, 90, 3, COLOR_TEXT);

    // Separator line
    _display.drawFastHLine(10, 140, LCD_WIDTH - 20, 0x7BEF);

    // Message
    _display.setTextSize(1);
    _display.setTextColor(COLOR_TEXT);
    _display.setCursor(10, 155);

    // Word wrap the message
    String msg = String(message);
    int maxWidth = LCD_WIDTH - 20;
    int charWidth = 6;  // Approximate char width at size 1
    int maxChars = maxWidth / charWidth;

    if (msg.length() <= maxChars) {
        drawCenteredText(message, 160, 1, COLOR_TEXT);
    } else {
        // Simple word wrap - first line
        int splitPos = msg.lastIndexOf(' ', maxChars);
        if (splitPos == -1) splitPos = maxChars;

        String line1 = msg.substring(0, splitPos);
        String line2 = msg.substring(splitPos + 1);

        drawCenteredText(line1.c_str(), 155, 1, COLOR_TEXT);
        drawCenteredText(line2.c_str(), 175, 1, COLOR_TEXT);
    }

    // Footer
    if (isUrgent) {
        _display.fillRect(0, LCD_HEIGHT - 40, LCD_WIDTH, 40, COLOR_DANGER);
        drawCenteredText("!! URGENTE !!", LCD_HEIGHT - 25, 1, COLOR_TEXT);
    }

    drawFooter("[USER] OK", "");
}

void DisplayManager::showNotificationQueue(int current, int total) {
    // Small indicator at top right
    char queueText[16];
    snprintf(queueText, sizeof(queueText), "%d/%d", current, total);

    _display.fillRect(LCD_WIDTH - 40, 5, 35, 15, 0x7BEF);
    _display.setTextColor(COLOR_BG);
    _display.setTextSize(1);
    _display.setCursor(LCD_WIDTH - 35, 8);
    _display.print(queueText);
}

void DisplayManager::clearNotification() {
    showIdle(true, "BitsperBox");
}

void DisplayManager::blinkAlert(bool state) {
    if (state) {
        _display.invertDisplay(true);
    } else {
        _display.invertDisplay(false);
    }
}

void DisplayManager::update() {
    // For any animations or updates
}

void DisplayManager::showWeakSignal(int rssi) {
    // Show a small warning banner at the top without clearing the whole screen
    _display.fillRect(0, 0, LCD_WIDTH, 25, COLOR_WARNING);
    _display.setTextColor(COLOR_BG);
    _display.setTextSize(1);

    char msg[32];
    snprintf(msg, sizeof(msg), "Senal debil: %d dBm", rssi);
    drawCenteredText(msg, 8, 1, COLOR_BG);
}

void DisplayManager::showReconnecting(int attempt, int maxAttempts) {
    clear();
    drawHeader("RECONECTANDO", COLOR_WARNING);

    _display.setTextSize(1);
    drawCenteredText("Conexion perdida", 80, 1, COLOR_TEXT);

    char attemptText[32];
    snprintf(attemptText, sizeof(attemptText), "Intento %d de %d", attempt, maxAttempts);
    drawCenteredText(attemptText, 120, 1, COLOR_PRIMARY);

    // Progress bar
    int barWidth = 120;
    int barHeight = 10;
    int barX = (LCD_WIDTH - barWidth) / 2;
    int barY = 160;
    int progress = (attempt * barWidth) / maxAttempts;

    _display.drawRect(barX, barY, barWidth, barHeight, COLOR_PRIMARY);
    _display.fillRect(barX + 2, barY + 2, progress - 4, barHeight - 4, COLOR_PRIMARY);

    drawCenteredText("Espere...", 200, 1, 0x7BEF);
}

// ============================================
// Private Helper Methods
// ============================================

uint16_t DisplayManager::getColorForType(const char* type) {
    if (strcmp(type, "waiter_called") == 0) return COLOR_WAITER_CALL;
    if (strcmp(type, "bill_ready") == 0) return COLOR_BILL_REQUEST;
    if (strcmp(type, "payment_confirmed") == 0) return COLOR_PAYMENT;
    if (strcmp(type, "urgent") == 0) return COLOR_URGENT;
    return COLOR_PRIMARY;
}

const char* DisplayManager::getIconForType(const char* type) {
    if (strcmp(type, "waiter_called") == 0) return "!";
    if (strcmp(type, "bill_ready") == 0) return "$";
    if (strcmp(type, "payment_confirmed") == 0) return "*";
    return "?";
}

void DisplayManager::drawCenteredText(const char* text, int y, int size, uint16_t color) {
    _display.setTextSize(size);
    _display.setTextColor(color);

    int w = _display.textWidth(text);
    int x = (LCD_WIDTH - w) / 2;
    _display.setCursor(x, y);
    _display.print(text);
}

void DisplayManager::drawHeader(const char* title, uint16_t bgColor) {
    _display.fillRect(0, 0, LCD_WIDTH, 50, bgColor);
    drawCenteredText(title, 18, 1, COLOR_BG);
}

void DisplayManager::drawFooter(const char* left, const char* right) {
    int y = LCD_HEIGHT - 15;
    _display.setTextSize(1);
    _display.setTextColor(0x7BEF);

    if (strlen(left) > 0) {
        _display.setCursor(5, y);
        _display.print(left);
    }

    if (strlen(right) > 0) {
        int w = _display.textWidth(right);
        _display.setCursor(LCD_WIDTH - w - 5, y);
        _display.print(right);
    }
}

// ============================================
// BLE Status Display Methods
// ============================================

void DisplayManager::showBLEScanning() {
    clear();
    drawHeader("BLUETOOTH", COLOR_INFO);

    // Bluetooth icon (simple representation)
    int cx = LCD_WIDTH / 2;
    int cy = 110;

    // Draw a stylized B for Bluetooth
    _display.fillCircle(cx, cy, 25, COLOR_INFO);
    _display.setTextColor(COLOR_BG);
    _display.setTextSize(3);
    _display.setCursor(cx - 9, cy - 12);
    _display.print("B");

    // Scanning text
    drawCenteredText("Buscando", 160, 1, COLOR_TEXT);
    drawCenteredText("BitsperBox...", 180, 1, COLOR_PRIMARY);

    // Animated dots indicator
    static int dots = 0;
    dots = (dots + 1) % 4;
    char dotStr[5] = "    ";
    for (int i = 0; i < dots; i++) dotStr[i] = '.';
    drawCenteredText(dotStr, 210, 2, COLOR_INFO);

    drawFooter("Escaneando", "BLE");
}

void DisplayManager::showBLEFound(const char* deviceName) {
    clear();
    drawHeader("BLE ENCONTRADO", COLOR_SUCCESS);

    // Success checkmark
    int cx = LCD_WIDTH / 2;
    int cy = 100;
    _display.fillCircle(cx, cy, 25, COLOR_SUCCESS);
    _display.setTextColor(COLOR_BG);
    _display.setTextSize(2);
    _display.setCursor(cx - 8, cy - 8);
    _display.print("OK");

    drawCenteredText("Dispositivo:", 150, 1, 0x7BEF);
    drawCenteredText(deviceName, 170, 1, COLOR_TEXT);

    drawCenteredText("Conectando...", 210, 1, COLOR_PRIMARY);
}

void DisplayManager::showBLEConnecting(const char* deviceName) {
    clear();
    drawHeader("CONECTANDO BLE", COLOR_WARNING);

    // Bluetooth icon
    int cx = LCD_WIDTH / 2;
    int cy = 100;
    _display.drawCircle(cx, cy, 25, COLOR_INFO);
    _display.drawCircle(cx, cy, 20, COLOR_INFO);
    _display.setTextColor(COLOR_INFO);
    _display.setTextSize(2);
    _display.setCursor(cx - 6, cy - 8);
    _display.print("B");

    drawCenteredText("Conectando a:", 150, 1, 0x7BEF);
    drawCenteredText(deviceName, 170, 1, COLOR_TEXT);

    // Progress indicator
    static int progress = 0;
    progress = (progress + 20) % 120;
    int barX = (LCD_WIDTH - 120) / 2;
    _display.drawRect(barX, 200, 120, 10, COLOR_INFO);
    _display.fillRect(barX + 2, 202, progress, 6, COLOR_INFO);

    drawFooter("Espere...", "");
}

void DisplayManager::showBLEStatus(const char* status, const char* detail) {
    clear();
    drawHeader("BLUETOOTH", COLOR_INFO);

    // Status icon based on state
    int cx = LCD_WIDTH / 2;
    int cy = 110;

    if (strcmp(status, "NO_ADAPTER") == 0 ||
        strcmp(status, "ERROR") == 0) {
        // Error X
        _display.fillCircle(cx, cy, 25, COLOR_DANGER);
        _display.setTextColor(COLOR_BG);
        _display.setTextSize(3);
        _display.setCursor(cx - 9, cy - 12);
        _display.print("X");
    } else if (strcmp(status, "CONNECTED") == 0) {
        // Connected checkmark
        _display.fillCircle(cx, cy, 25, COLOR_SUCCESS);
        _display.setTextColor(COLOR_BG);
        _display.setTextSize(2);
        _display.setCursor(cx - 8, cy - 8);
        _display.print("OK");
    } else {
        // Default Bluetooth symbol
        _display.drawCircle(cx, cy, 25, COLOR_INFO);
        _display.setTextColor(COLOR_INFO);
        _display.setTextSize(2);
        _display.setCursor(cx - 6, cy - 8);
        _display.print("B");
    }

    // Status text
    drawCenteredText(status, 160, 1, COLOR_TEXT);

    if (detail != nullptr && strlen(detail) > 0) {
        drawCenteredText(detail, 185, 1, 0x7BEF);
    }

    drawFooter("BLE", "v" FIRMWARE_VERSION);
}
