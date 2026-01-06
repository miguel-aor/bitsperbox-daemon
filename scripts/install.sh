#!/bin/bash

# BitsperBox Installation Script for Raspberry Pi
# Usage: curl -fsSL https://raw.githubusercontent.com/miguel-aor/bitsperbox-daemon/main/scripts/install.sh | bash

set -e

REPO_URL="https://github.com/miguel-aor/bitsperbox-daemon.git"
INSTALL_DIR="$HOME/bitsperbox-daemon"
NODE_VERSION="20"

echo ""
echo "╔════════════════════════════════════════╗"
echo "║     BitsperBox Installation Script     ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check if running on Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "⚠️  Warning: This doesn't appear to be a Raspberry Pi"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for Node.js
echo "📦 Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "Installing Node.js ${NODE_VERSION}..."
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VER" -lt 18 ]; then
        echo "Node.js version too old. Installing Node.js ${NODE_VERSION}..."
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo "✓ Node.js $(node -v) is installed"
    fi
fi

# Install git if not present
if ! command -v git &> /dev/null; then
    echo "Installing git..."
    sudo apt-get update && sudo apt-get install -y git
fi

# Add user to necessary groups for USB printing
echo "📟 Configuring USB permissions..."
sudo usermod -a -G lp,dialout,plugdev $USER 2>/dev/null || true

# Clone or update repository
echo ""
echo "📥 Downloading BitsperBox..."
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull
else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo ""
echo "🔨 Building..."
npm run build

# Create udev rule for USB printers (no sudo required for /dev/usb/lp*)
echo ""
echo "📟 Setting up USB printer rules..."
sudo tee /etc/udev/rules.d/99-usb-printer.rules > /dev/null << 'EOF'
# Allow users in lp group to access USB printers
SUBSYSTEM=="usb", ATTR{bInterfaceClass}=="07", MODE="0666"
SUBSYSTEM=="usbmisc", KERNEL=="lp*", MODE="0666", GROUP="lp"
EOF
sudo udevadm control --reload-rules

echo ""
echo "════════════════════════════════════════"
echo "✅ BitsperBox installed successfully!"
echo "════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "1. Run the setup wizard:"
echo "   cd $INSTALL_DIR && npm run setup"
echo ""
echo "2. Test the daemon:"
echo "   npm start"
echo ""
echo "3. Install as a service (auto-start on boot):"
echo "   npm run install:service"
echo "   sudo systemctl start bitsperbox"
echo ""
echo "4. View logs:"
echo "   npm run logs"
echo ""
echo "⚠️  You may need to log out and back in for USB permissions to take effect."
echo ""
