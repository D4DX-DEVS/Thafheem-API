#!/usr/bin/env bash
# Brings the API back when nothing answers on its port.
#
# Apache proxies to 127.0.0.1:5000. When the Node process is gone (PM2 hit its
# restart cap, the PM2 daemon was killed, or the host rebooted) Apache serves a
# bare 503 with no CORS headers, and every browser request fails as a CORS error
# until someone restarts it by hand. Cron runs this every 2 minutes (installed
# by the deploy workflow) so that state lasts minutes, not hours.
#
# Only "no HTTP response at all" counts as dead. A 5xx or 429 means Node is up,
# e.g. with MySQL down, and restarting would not help.
#
# No `set -u`: nvm.sh is not nounset-safe and would leave pm2 off the PATH.

APP_NAME="thafheem-backend"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://127.0.0.1:5000/"

# One run at a time, in case pm2 hangs longer than the cron interval.
mkdir -p "$APP_DIR/logs"
exec 9>"$APP_DIR/logs/.watchdog.lock"
if command -v flock >/dev/null; then flock -n 9 || exit 0; fi

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
command -v pm2 >/dev/null || { echo "$(date '+%F %T') pm2 not found on PATH"; exit 1; }

alive() {
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$URL")" != "000" ]
}

alive && exit 0
# A deploy restart keeps the port closed while the old process drains
# (graceful shutdown allows up to 30s); don't restart on top of it.
sleep 45
alive && exit 0

echo "$(date '+%F %T') API not answering on $URL, restarting"
cd "$APP_DIR" || exit 1

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$APP_NAME" --update-env
# A fresh PM2 daemon (after a kill or reboot) has an empty process list;
# the list saved by the last deploy brings the app back.
elif pm2 resurrect >/dev/null 2>&1 && pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "$(date '+%F %T') restored from saved PM2 process list"
else
  pm2 start server.js --name "$APP_NAME" --time --max-memory-restart 500M
  pm2 save --force
fi
