#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"

install_python_if_missing() {
  if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    return 0
  fi
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "[ERROR] $PYTHON_BIN not found and apt-get is unavailable."
    echo "[ERROR] Please install Python 3.10+ manually."
    exit 1
  fi

  local SUDO_CMD=""
  if [[ "${EUID:-$(id -u)}" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
    SUDO_CMD="sudo"
  fi

  echo "[INFO] Installing Python runtime with apt-get ..."
  $SUDO_CMD apt-get update -y
  $SUDO_CMD apt-get install -y python3 python3-venv python3-pip
}

install_python_if_missing

if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
  echo "[INFO] Creating virtual environment: $VENV_DIR"
  rm -rf "$VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements.txt

chmod +x setup_linux.sh start_linux.sh cleanup_linux.sh uninstall_linux.sh manage_map_key.sh deploy_linux_oneclick.sh build_tailwind.sh || true

echo "[OK] Linux environment is ready."
echo "[TIP] Start service: ./start_linux.sh"
echo "[TIP] Build Tailwind CSS: ./build_tailwind.sh"
echo "[TIP] Uninstall: ./uninstall_linux.sh"
