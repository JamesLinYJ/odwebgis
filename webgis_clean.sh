#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-runtime}"
shift || true

PYTHON_BIN="${PYTHON_BIN:-python3}"
exec "$PYTHON_BIN" webgisctl.py clean "$MODE" "$@"

