#!/bin/bash

# BitsperBox Service Uninstaller

set -e

echo "========================================="
echo "  BitsperBox Service Uninstaller"
echo "========================================="

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo ./uninstall-service.sh"
  exit 1
fi

echo ""
echo "Stopping service..."
systemctl stop bitsperbox 2>/dev/null || true

echo "Disabling service..."
systemctl disable bitsperbox 2>/dev/null || true

echo "Removing service file..."
rm -f /etc/systemd/system/bitsperbox.service

echo "Reloading systemd..."
systemctl daemon-reload

echo ""
echo "========================================="
echo "  Uninstallation Complete!"
echo "========================================="
echo ""
echo "The BitsperBox service has been removed."
echo "Your configuration and code are still in place."
