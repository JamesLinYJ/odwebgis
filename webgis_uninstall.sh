#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

REMOVE_ALL=0
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) REMOVE_ALL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help)
      cat <<'USAGE'
Usage: ./webgis_uninstall.sh [options]
  --all   Remove runtime + local data
  --yes   Skip confirmation
USAGE
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown option: $1"
      exit 1
      ;;
  esac
done

if [[ "$ASSUME_YES" != "1" ]]; then
  if [[ "$REMOVE_ALL" == "1" ]]; then
    read -r -p "Stop service and remove all local data? [y/N]: " ans
  else
    read -r -p "Stop service and clean runtime files? [y/N]: " ans
  fi
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]] || exit 1
fi

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
if [[ "$REMOVE_ALL" == "1" ]]; then
  exec "$PYTHON_BIN" webgisctl.py clean all
fi
exec "$PYTHON_BIN" webgisctl.py clean runtime
