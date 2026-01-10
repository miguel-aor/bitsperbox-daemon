#ifndef CONFIG_H
#define CONFIG_H

// ============================================
// BitsperWatch Configuration
// ESP32-C6 LCD 1.47" (XUMIUZIY / Generic)
// ============================================

// ----- Display Pins (ST7789 172x320) -----
// Adjust these if your board has different pinout
#define LCD_MOSI    6    // SPI MOSI
#define LCD_SCLK    7    // SPI Clock
#define LCD_CS      14   // Chip Select
#define LCD_DC      15   // Data/Command
#define LCD_RST     21   // Reset (-1 if not used)
#define LCD_BL      22   // Backlight

// ----- Display Settings -----
#define LCD_WIDTH   172
#define LCD_HEIGHT  320
#define LCD_ROTATION 0   // 0, 1, 2, or 3

// ----- Button Pins -----
#define BTN_BOOT    9    // BOOT button (usually GPIO9)
#define BTN_USER    0    // USER button (usually GPIO0)

// ----- RGB LED Pin (if available) -----
#define RGB_LED_PIN 8    // WS2812 or similar

// ----- SD Card Pins -----
#define SD_CS       10   // SD Card Chip Select
#define SD_MOSI     6    // Shared with LCD
#define SD_MISO     5
#define SD_SCLK     7    // Shared with LCD

// ----- WiFi Settings -----
#define WIFI_AP_SSID_PREFIX "BitsperWatch-"
#define WIFI_AP_PASSWORD    "bitsper123"
#define WIFI_CONNECT_TIMEOUT 15000  // 15 seconds

// ----- WebSocket Settings -----
#define WS_PORT             3334    // BitsperBox WebSocket port
#define WS_RECONNECT_INTERVAL 5000  // 5 seconds

// ----- BLE Settings -----
#define BLE_SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define BLE_NOTIFY_CHAR_UUID    "beb5483e-36e1-4688-b7f5-ea07361b26a8"
#define BLE_REGISTER_CHAR_UUID  "beb5483e-36e1-4688-b7f5-ea07361b26a9"
#define BLE_SERVER_NAME         "BitsperBox"
#define BLE_SCAN_INTERVAL       5000   // Scan every 5 seconds when disconnected
#define BLE_RECONNECT_DELAY     3000   // Wait 3 seconds before reconnecting

// ----- Connection Mode -----
// "wifi" = WiFi WebSocket only
// "ble" = BLE only
// "both" = WiFi primary, BLE fallback
#define DEFAULT_CONNECTION_MODE "both"

// ----- Notification Settings -----
#define NOTIFICATION_TIMEOUT  60000  // Auto-dismiss after 60s
#define MAX_NOTIFICATIONS     10     // Max queue size
#define ALERT_BLINK_INTERVAL  500    // Blink every 500ms for urgent

// ----- Device Info -----
#define DEVICE_TYPE         "BitsperWatch"
#define FIRMWARE_VERSION    "1.0.0"

// ----- Colors (RGB565) -----
#define COLOR_BG            0x0000  // Black
#define COLOR_TEXT          0xFFFF  // White
#define COLOR_PRIMARY       0x07FF  // Cyan (BitsperFoods)
#define COLOR_SUCCESS       0x07E0  // Green
#define COLOR_WARNING       0xFD20  // Orange
#define COLOR_DANGER        0xF800  // Red
#define COLOR_INFO          0x001F  // Blue

// ----- Alert Type Colors -----
#define COLOR_WAITER_CALL   0x001F  // Blue
#define COLOR_BILL_REQUEST  0x07E0  // Green
#define COLOR_PAYMENT       0x07FF  // Cyan
#define COLOR_URGENT        0xF800  // Red

#endif // CONFIG_H
