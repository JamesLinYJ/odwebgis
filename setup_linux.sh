#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
NPM_BIN="${NPM_BIN:-npm}"

detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt-get"
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "dnf"
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    echo "yum"
    return 0
  fi
  echo ""
}

SUDO_CMD=""
if [[ "${EUID:-$(id -u)}" -ne 0 ]] && command -v sudo >/dev/null 2>&1; then
  SUDO_CMD="sudo"
fi

PKG_MGR="$(detect_pkg_manager)"

pkg_install() {
  local packages=("$@")
  if [[ -z "$PKG_MGR" ]]; then
    echo "[ERROR] No supported package manager (apt-get/dnf/yum) found."
    exit 1
  fi
  case "$PKG_MGR" in
    apt-get)
      $SUDO_CMD apt-get update -y
      $SUDO_CMD apt-get install -y "${packages[@]}"
      ;;
    dnf)
      $SUDO_CMD dnf install -y "${packages[@]}"
      ;;
    yum)
      $SUDO_CMD yum install -y "${packages[@]}"
      ;;
  esac
}

install_python_if_missing() {
  if command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    return 0
  fi
  if [[ -z "$PKG_MGR" ]]; then
    echo "[ERROR] $PYTHON_BIN not found and no supported package manager is available."
    echo "[ERROR] Please install Python 3.10+ manually, then rerun."
    exit 1
  fi
  echo "[INFO] Installing Python runtime ..."
  case "$PKG_MGR" in
    apt-get) pkg_install python3 python3-venv python3-pip ;;
    dnf|yum) pkg_install python3 python3-pip python3-virtualenv ;;
  esac
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

install_node_if_missing() {
  if command -v "$NPM_BIN" >/dev/null 2>&1; then
    return 0
  fi
  if [[ -z "$PKG_MGR" ]]; then
    echo "[WARN] npm not found and no supported package manager available. Tailwind will fall back to standalone mode."
    return 1
  fi
  echo "[INFO] Installing Node.js and npm ..."
  pkg_install nodejs npm
}

install_node_if_missing || true

if command -v "$NPM_BIN" >/dev/null 2>&1 && [[ -f package.json ]]; then
  echo "[INFO] Installing Node dependencies ..."
  if [[ -f package-lock.json ]]; then
    "$NPM_BIN" ci --no-audit --no-fund
  else
    "$NPM_BIN" install --no-audit --no-fund
  fi
fi

chmod +x setup_linux.sh start_linux.sh cleanup_linux.sh uninstall_linux.sh manage_map_key.sh manage_accounts.sh deploy_linux_oneclick.sh build_tailwind.sh || true

echo "[OK] Linux environment is ready."
echo "[TIP] Start service: ./start_linux.sh"
echo "[TIP] Build Tailwind CSS: ./build_tailwind.sh"
echo "[TIP] Uninstall: ./uninstall_linux.sh"
