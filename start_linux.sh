#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VENV_DIR="${VENV_DIR:-.venv}"
PID_FILE="${PID_FILE:-webgis.pid}"
LOG_DIR="${LOG_DIR:-logs}"
HOST="${WEBGIS_HOST:-0.0.0.0}"
PORT="${WEBGIS_PORT:-5000}"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "[ERROR] 虚拟环境不存在：$VENV_DIR"
  echo "[TIP] 请先执行 ./setup_linux.sh"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "[INFO] WebGIS 已运行，PID=$OLD_PID"
    echo "[INFO] 访问: http://127.0.0.1:${PORT}"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

mkdir -p "$LOG_DIR"

export WEBGIS_HOST="$HOST"
export WEBGIS_PORT="$PORT"

nohup python3 app.py >"${LOG_DIR}/webgis.out.log" 2>"${LOG_DIR}/webgis.err.log" &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

sleep 1
if ! kill -0 "$NEW_PID" 2>/dev/null; then
  echo "[ERROR] 启动失败，请查看 ${LOG_DIR}/webgis.err.log"
  rm -f "$PID_FILE"
  exit 1
fi

echo "[OK] WebGIS 启动成功，PID=$NEW_PID"
echo "[OK] 地址: http://127.0.0.1:${PORT}"
echo "[INFO] 日志: ${LOG_DIR}/webgis.out.log, ${LOG_DIR}/webgis.err.log"
