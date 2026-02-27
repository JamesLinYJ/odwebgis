#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
PID_FILE="${PID_FILE:-webgis.pid}"
LOG_DIR="${LOG_DIR:-logs}"
ENV_FILE="${ENV_FILE:-.env.webgis}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

HOST="${WEBGIS_HOST:-0.0.0.0}"
PORT="${WEBGIS_PORT:-5000}"

service_ready() {
  python - <<'PY' >/dev/null 2>&1
import os, urllib.request, urllib.error
port = os.environ.get('WEBGIS_PORT', '5000')
try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/auth', timeout=1.5) as r:
        raise SystemExit(0 if r.status == 200 else 1)
except urllib.error.HTTPError as e:
    raise SystemExit(0 if e.code == 200 else 1)
except Exception:
    raise SystemExit(1)
PY
}

if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
  echo "[ERROR] Virtual env not found: $VENV_DIR"
  echo "[TIP] Run ./setup_linux.sh first"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    CMDLINE="$(tr '\0' ' ' <"/proc/${OLD_PID}/cmdline" 2>/dev/null || true)"
    if [[ "$CMDLINE" == *"app.py"* ]]; then
      if service_ready; then
        echo "[INFO] WebGIS already running, PID=$OLD_PID"
        echo "[INFO] URL: http://127.0.0.1:${PORT}"
        exit 0
      fi
      echo "[WARN] PID file points to app.py process but service is unhealthy; restarting."
    else
      echo "[WARN] Stale PID file detected (PID=$OLD_PID), cleaning."
    fi
  fi
  rm -f "$PID_FILE"
fi

mkdir -p "$LOG_DIR"

export WEBGIS_HOST="$HOST"
export WEBGIS_PORT="$PORT"

nohup python app.py >"${LOG_DIR}/webgis.out.log" 2>"${LOG_DIR}/webgis.err.log" &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

for _ in $(seq 1 60); do
  if ! kill -0 "$NEW_PID" 2>/dev/null; then
    break
  fi
  if service_ready; then
    echo "[OK] WebGIS started, PID=$NEW_PID"
    echo "[OK] URL: http://127.0.0.1:${PORT}"
    echo "[INFO] Logs: ${LOG_DIR}/webgis.out.log, ${LOG_DIR}/webgis.err.log"
    exit 0
  fi
  sleep 1
done

echo "[ERROR] Failed to start WebGIS."
echo "[ERROR] Check log: ${LOG_DIR}/webgis.err.log"
rm -f "$PID_FILE"
exit 1
