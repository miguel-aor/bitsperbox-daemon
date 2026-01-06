# BitsperBox Daemon

Hardware bridge daemon for BitsperFoods restaurants. Runs on Raspberry Pi to enable automatic ticket printing from tablets and mobile devices.

## Features

- 🖨️ **Automatic Printing**: Prints kitchen tickets when orders are created
- 📡 **Real-time Sync**: Connects to BitsperFoods cloud via Supabase Realtime
- 🔒 **Atomic Claims**: Prevents duplicate prints when multiple devices are connected
- 💓 **Heartbeat**: Reports device status to cloud dashboard
- 🔌 **USB & Network**: Supports USB thermal printers and network printers

## Requirements

- Raspberry Pi 3/4/Zero 2 W (or any Linux system)
- Node.js 18+
- USB thermal printer (ESC/POS compatible) or network printer

## Quick Install

On your Raspberry Pi, run:

```bash
curl -fsSL https://raw.githubusercontent.com/miguel-aor/bitsperbox-daemon/main/scripts/install.sh | bash
```

## Manual Installation

```bash
# Clone the repository
git clone https://github.com/miguel-aor/bitsperbox-daemon.git
cd bitsperbox-daemon

# Install dependencies
npm install

# Build
npm run build

# Run setup wizard
npm run setup

# Start daemon
npm start
```

## Configuration

Run the setup wizard:

```bash
npm run setup
```

You'll need:
1. Your Supabase URL
2. A Supabase service key or device token
3. Your restaurant ID

## Commands

```bash
# Run setup wizard
npm run setup

# Start daemon (foreground)
npm start

# Check status
npm run status

# Print test page
npm run test:print

# Detect connected printers
npx tsx src/cli.ts detect-printers

# Install as systemd service (auto-start on boot)
npm run install:service

# View service logs
npm run logs
```

## Running as a Service

To run BitsperBox automatically on boot:

```bash
# Install the systemd service
npm run install:service

# Start the service
sudo systemctl start bitsperbox

# Check status
sudo systemctl status bitsperbox

# View logs
journalctl -u bitsperbox -f
```

## USB Printer Setup

1. Connect your thermal printer via USB
2. Run `npx tsx src/cli.ts detect-printers` to verify detection
3. If printer not detected, add your user to the `lp` group:
   ```bash
   sudo usermod -a -G lp $USER
   ```
4. Log out and back in for permissions to take effect

### Supported Printers

Most ESC/POS compatible thermal printers work, including:
- Epson TM-T20/T88 series
- Star TSP100/TSP650 series
- Generic 58mm/80mm thermal printers (Chinese clones)

## Network Printer Setup

For printers connected via Ethernet or WiFi:

1. Run `npm run setup`
2. When asked about printer, select "network printer"
3. Enter the printer's IP address and port (usually 9100)

## Troubleshooting

### Printer not detected
```bash
# Check USB devices
lsusb

# Check if printer device exists
ls -la /dev/usb/

# Add user to lp group
sudo usermod -a -G lp $USER
# Then log out and back in
```

### Permission denied
```bash
# Create udev rule for USB printers
sudo tee /etc/udev/rules.d/99-usb-printer.rules > /dev/null << 'EOF'
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="07", MODE="0666"
EOF
sudo udevadm control --reload-rules
```

### Connection issues
```bash
# Check service status
sudo systemctl status bitsperbox

# View detailed logs
journalctl -u bitsperbox -n 100

# Test Supabase connection
npm run test:connection
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BitsperBox Daemon                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐     ┌─────────────────┐           │
│  │ RealtimeManager │     │ PrinterManager  │           │
│  │                 │     │                 │           │
│  │ - Supabase sub  │     │ - USB detection │           │
│  │ - Order events  │     │ - ESC/POS send  │           │
│  │ - Heartbeats    │     │ - Network print │           │
│  └────────┬────────┘     └────────┬────────┘           │
│           │                       │                     │
│           └───────────┬───────────┘                     │
│                       │                                 │
│              ┌────────▼────────┐                       │
│              │  PrintService   │                       │
│              │                 │                       │
│              │ - Claim jobs    │                       │
│              │ - Fetch ESC/POS │                       │
│              │ - Print tickets │                       │
│              └─────────────────┘                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Development

```bash
# Run in development mode (with auto-reload)
npm run dev

# Build TypeScript
npm run build

# Run linter
npm run lint
```

## License

Proprietary - BitsperFoods
