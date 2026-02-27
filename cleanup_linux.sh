#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PID_FILE="${PID_FILE:-webgis.pid}"
LOG_DIR="${LOG_DIR:-logs}"

stop_service() {
  if [[ -f "$PID_FILE" ]]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
      echo "[INFO] 停止 WebGIS 进程 PID=$PID"
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
  rm -f run_stdout.log run_stderr.log
  if [[ -d "$LOG_DIR" ]]; then
    rm -rf "$LOG_DIR"
  fi
  find . -type d -name "__pycache__" -prune -exec rm -rf {} + 2>/dev/null || true
}

clean_all() {
  clean_runtime
  rm -rf .venv
  rm -f webgis.db
  rm -f .tianditu_key
}

MODE="${1:-runtime}"

stop_service

case "$MODE" in
  runtime)
    clean_runtime
    echo "[OK] 已完成运行时清理（进程/日志/缓存）。"
    ;;
  all)
    clean_all
    echo "[OK] 已完成完整清理（包含 .venv / webgis.db / .tianditu_key）。"
    ;;
  *)
    echo "[ERROR] 不支持的参数: $MODE"
    echo "用法: ./cleanup_linux.sh [runtime|all]"
    exit 1
    ;;
esac
