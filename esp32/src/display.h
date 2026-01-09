#ifndef DISPLAY_H
#define DISPLAY_H

#include <LovyanGFX.hpp>
#include "config.h"

// ============================================
// Display Driver Configuration for ESP32-C6
// ST7789 172x320 1.47" LCD
// ============================================

class LGFX : public lgfx::LGFX_Device {
    lgfx::Panel_ST7789 _panel_instance;
    lgfx::Bus_SPI _bus_instance;
    lgfx::Light_PWM _light_instance;

public:
    LGFX(void) {
        // SPI Bus configuration
        {
            auto cfg = _bus_instance.config();
            cfg.spi_host = SPI2_HOST;
            cfg.spi_mode = 0;
            cfg.freq_write = 40000000;
            cfg.freq_read = 16000000;
            cfg.spi_3wire = false;
            cfg.use_lock = true;
            cfg.dma_channel = SPI_DMA_CH_AUTO;
            cfg.pin_sclk = LCD_SCLK;
            cfg.pin_mosi = LCD_MOSI;
            cfg.pin_miso = -1;
            cfg.pin_dc = LCD_DC;
            _bus_instance.config(cfg);
            _panel_instance.setBus(&_bus_instance);
        }

        // Panel configuration
        {
            auto cfg = _panel_instance.config();
            cfg.pin_cs = LCD_CS;
            cfg.pin_rst = LCD_RST;
            cfg.pin_busy = -1;
            cfg.memory_width = LCD_WIDTH;
            cfg.memory_height = LCD_HEIGHT;
            cfg.panel_width = LCD_WIDTH;
            cfg.panel_height = LCD_HEIGHT;
            cfg.offset_x = 34;  // Offset for 172x320 display
            cfg.offset_y = 0;
            cfg.offset_rotation = 0;
            cfg.dummy_read_pixel = 8;
            cfg.dummy_read_bits = 1;
            cfg.readable = true;
            cfg.invert = true;  // ST7789 typically needs invert
            cfg.rgb_order = false;
            cfg.dlen_16bit = false;
            cfg.bus_shared = true;
            _panel_instance.config(cfg);
        }

        // Backlight configuration
        {
            auto cfg = _light_instance.config();
            cfg.pin_bl = LCD_BL;
            cfg.invert = false;
            cfg.freq = 44100;
            cfg.pwm_channel = 0;
            _light_instance.config(cfg);
            _panel_instance.setLight(&_light_instance);
        }

        setPanel(&_panel_instance);
    }
};

// ============================================
// Display Manager Class
// ============================================

class DisplayManager {
public:
    void begin();
    void clear();
    void setBrightness(uint8_t brightness);

    // Screen states
    void showSplash();
    void showConnecting(const char* ssid);
    void showConnected(const char* ssid, const char* ip);
    void showAPMode(const char* ssid, const char* password);
    void showError(const char* message);
    void showIdle(bool connected, const char* mode);

    // Notifications
    void showNotification(const char* table, const char* type,
                         const char* message, const char* priority);
    void showNotificationQueue(int current, int total);
    void clearNotification();
    void blinkAlert(bool state);

    // Utility
    void update();
    LGFX* getLGFX() { return &_display; }

private:
    LGFX _display;
    bool _initialized = false;

    uint16_t getColorForType(const char* type);
    const char* getIconForType(const char* type);
    void drawCenteredText(const char* text, int y, int size, uint16_t color);
    void drawHeader(const char* title, uint16_t bgColor);
    void drawFooter(const char* left, const char* right);
};

extern DisplayManager Display;

#endif // DISPLAY_H
