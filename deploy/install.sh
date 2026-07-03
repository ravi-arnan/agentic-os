#!/usr/bin/env bash
# Install Agentic OS as a persistent systemd *user* service and (optionally)
# expose it on your tailnet. Run this yourself — it uses no sudo except the
# one clearly-marked linger step.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$REPO/deploy/agentic-os.service"
UNIT_DST="$HOME/.config/systemd/user/agentic-os.service"

echo "==> Agentic OS deploy"
echo "    repo:  $REPO"
echo "    unit:  $UNIT_DST"

# 1. Build the frontend so the server has something to serve.
echo "==> Building frontend (npm run build)"
( cd "$REPO" && npm run build )

# 2. Install + start the user service.
mkdir -p "$(dirname "$UNIT_DST")"
cp "$UNIT_SRC" "$UNIT_DST"
systemctl --user daemon-reload
systemctl --user enable --now agentic-os.service
echo "==> Service status:"
systemctl --user --no-pager status agentic-os.service | head -6 || true

# 3. Keep it running after logout / across reboots (needs sudo once).
if ! loginctl show-user "$USER" 2>/dev/null | grep -q 'Linger=yes'; then
  echo
  echo "==> Enabling linger so the service survives logout/reboot."
  echo "    (this is the only sudo step)"
  sudo loginctl enable-linger "$USER"
fi

echo
echo "==> Done. Dashboard is live on the laptop at http://localhost:4177"
echo
echo "    To reach it from your phone / other tailnet devices, run:"
echo "      tailscale serve --bg 4177"
echo "    then open the HTTPS URL it prints (https://<machine>.<tailnet>.ts.net)."
echo
echo "    Manage the service:"
echo "      systemctl --user restart agentic-os     # after code changes"
echo "      systemctl --user stop agentic-os"
echo "      journalctl --user -u agentic-os -f       # live logs"
