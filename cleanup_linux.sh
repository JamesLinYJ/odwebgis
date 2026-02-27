#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PID_FILE="${PID_FILE:-webgis.pid}"
LOG_DIR="${LOG_DIR:-logs}"
ENV_FILE="${ENV_FILE:-.env.webgis}"

stop_service() {
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
      echo "[INFO] Stopping WebGIS process PID=$PID"
      kill "$PID" 2>/dev/null || true
      sleep 1
      if kill -0 "$PID" 2>/dev/null; then
        kill -9 "$PID" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
  fi
}

clean_runtime() {
  rm -f run_stdout.log run_stderr.log 2>/dev/null || true
  if [[ -d "$LOG_DIR" ]]; then
    rm -rf "$LOG_DIR" 2>/dev/null || true
  fi
  find . -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
}

clean_all() {
  clean_runtime
  rm -rf .venv 2>/dev/null || true
  rm -f webgis.db 2>/dev/null || true
  rm -f .tianditu_key 2>/dev/null || true
  rm -f "$ENV_FILE" 2>/dev/null || true
}

MODE="${1:-runtime}"

stop_service

case "$MODE" in
  runtime)
    clean_runtime
    echo "[OK] Runtime cleanup complete (process/log/cache)."
    ;;
  all)
    clean_all
    echo "[OK] Full cleanup complete (.venv/webgis.db/.tianditu_key/.env.webgis removed)."
    ;;
  *)
    echo "[ERROR] Unsupported mode: $MODE"
    echo "Usage: ./cleanup_linux.sh [runtime|all]"
    exit 1
    ;;
esac
