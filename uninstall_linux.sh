#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

REMOVE_ALL=0
ASSUME_YES=0

usage() {
  cat <<'USAGE'
Usage: ./uninstall_linux.sh [options]

Options:
  --all             Remove project runtime and data (.venv, webgis.db, keys, env)
  --yes             Skip confirmation
  -h, --help        Show this help

Examples:
  ./uninstall_linux.sh
  ./uninstall_linux.sh --all --yes
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) REMOVE_ALL=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $1"; usage; exit 1 ;;
  esac
done

confirm() {
  local message="$1"
  if [[ "$ASSUME_YES" == "1" ]]; then
    return 0
  fi
  read -r -p "$message [y/N]: " answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]]
}

if [[ "$REMOVE_ALL" == "1" ]]; then
  confirm "This will stop service and remove all local data. Continue?" || exit 1
else
  confirm "This will stop service and clean runtime files. Continue?" || exit 1
fi

echo "[INFO] Stopping local process and cleaning runtime..."
./cleanup_linux.sh runtime

if [[ "$REMOVE_ALL" == "1" ]]; then
  echo "[INFO] Removing venv/database/keys/env..."
  ./cleanup_linux.sh all
fi

echo "[OK] Uninstall complete."

