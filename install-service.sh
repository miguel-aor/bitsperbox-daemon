#!/bin/bash

# BitsperBox Service Installer
# Run this script on the Raspberry Pi to install the systemd service

set -e

echo "========================================="
echo "  BitsperBox Service Installer"
echo "========================================="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo ./install-service.sh"
  exit 1
fi

# Get the current user (the one who called sudo)
ACTUAL_USER=${SUDO_USER:-$USER}
HOME_DIR=$(eval echo ~$ACTUAL_USER)
INSTALL_DIR="$HOME_DIR/bitsperbox-daemon"

echo ""
echo "Installing for user: $ACTUAL_USER"
echo "Install directory: $INSTALL_DIR"
echo ""

# Build the project first
echo "[1/6] Building project..."
cd "$INSTALL_DIR"
sudo -u $ACTUAL_USER npm run build

# Update service file with correct user
echo "[2/6] Configuring service file..."
sed -i "s/User=admin1/User=$ACTUAL_USER/" bitsperbox.service
sed -i "s/Group=admin1/Group=$ACTUAL_USER/" bitsperbox.service
sed -i "s|/home/admin1|$HOME_DIR|g" bitsperbox.service

# Copy service file
echo "[3/6] Installing systemd service..."
cp bitsperbox.service /etc/systemd/system/bitsperbox.service

# Add user to required groups
echo "[4/6] Adding user to hardware groups..."
usermod -aG dialout,bluetooth,lp $ACTUAL_USER 2>/dev/null || true

# Reload systemd
echo "[5/6] Reloading systemd..."
systemctl daemon-reload

# Enable and start service
echo "[6/6] Enabling service..."
systemctl enable bitsperbox.service

echo ""
echo "========================================="
echo "  Installation Complete!"
echo "========================================="
echo ""
echo "Commands:"
echo "  Start:   sudo systemctl start bitsperbox"
echo "  Stop:    sudo systemctl stop bitsperbox"
echo "  Status:  sudo systemctl status bitsperbox"
echo "  Logs:    sudo journalctl -u bitsperbox -f"
echo ""
echo "The service will start automatically on boot."
echo ""
echo "Starting service now..."
systemctl start bitsperbox
systemctl status bitsperbox --no-pager
