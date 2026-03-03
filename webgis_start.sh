#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

pick_python() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    echo "$PYTHON_BIN"
    return 0
  fi
  if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
    echo "$ROOT_DIR/.venv/bin/python"
    return 0
  fi
  for candidate in python3.12 python3.11 python3.10 python3.9 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(pick_python)" || { echo "[ERROR] Python runtime not found."; exit 1; }
if [[ "${1:-}" == "--stop" ]]; then
  shift
  exec "$PYTHON_BIN" webgisctl.py stop "$@"
fi
if [[ "${1:-}" == "--restart" ]]; then
  shift
  exec "$PYTHON_BIN" webgisctl.py restart --open "$@"
fi
exec "$PYTHON_BIN" webgisctl.py start --open "$@"
