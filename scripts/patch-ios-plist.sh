#!/usr/bin/env bash
# Adds the iOS permissions Paddy needs to reach the dashboard on your Mac:
#   - NSAppTransportSecurity.NSAllowsLocalNetworking : allow plain http:// to *.local / LAN
#   - NSLocalNetworkUsageDescription                 : the local-network permission prompt text
#
# Run this AFTER `tauri ios init` (and re-run if you ever re-init — it's idempotent).
#   npm run patch-ios
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PB=/usr/libexec/PlistBuddy

PLISTS=$(find "$ROOT/src-tauri/gen/apple" -name "Info.plist" 2>/dev/null || true)
if [ -z "$PLISTS" ]; then
  echo "✗ No iOS Info.plist found. Run 'npm run ios:init' first (needs Xcode installed)." >&2
  exit 1
fi

DESC="Paddy connects to the dashboard running on your Mac over your local network."

for P in $PLISTS; do
  echo "• Patching $P"

  # NSAppTransportSecurity -> NSAllowsLocalNetworking = true
  $PB -c "Add :NSAppTransportSecurity dict" "$P" 2>/dev/null || true
  $PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$P" 2>/dev/null \
    || $PB -c "Set :NSAppTransportSecurity:NSAllowsLocalNetworking true" "$P"

  # Local network usage description (iOS 14+ permission prompt)
  $PB -c "Add :NSLocalNetworkUsageDescription string ${DESC}" "$P" 2>/dev/null \
    || $PB -c "Set :NSLocalNetworkUsageDescription ${DESC}" "$P"
done

echo "✓ iOS network permissions patched."
