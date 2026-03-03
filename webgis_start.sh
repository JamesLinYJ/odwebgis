#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ "${1:-}" == "--stop" ]]; then
  shift
  exec "$PYTHON_BIN" webgisctl.py stop "$@"
fi
if [[ "${1:-}" == "--restart" ]]; then
  shift
  exec "$PYTHON_BIN" webgisctl.py restart --open "$@"
fi
exec "$PYTHON_BIN" webgisctl.py start --open "$@"

