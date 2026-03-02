#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"
NPM_BIN="${NPM_BIN:-npm}"
AUTO_INSTALL_NODE="${AUTO_INSTALL_NODE:-1}"
PKG_TIMEOUT_SECONDS="${PKG_TIMEOUT_SECONDS:-240}"

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

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout --foreground "${PKG_TIMEOUT_SECONDS}s" "$@"
    return $?
  fi
  "$@"
}

pkg_install() {
  local packages=("$@")
  if [[ -z "$PKG_MGR" ]]; then
    echo "[ERROR] No supported package manager (apt-get/dnf/yum) found."
    return 1
  fi
  case "$PKG_MGR" in
    apt-get)
      export DEBIAN_FRONTEND=noninteractive
      local apt_update_cmd=()
      local apt_install_cmd=()
      if [[ -n "$SUDO_CMD" ]]; then
        apt_update_cmd+=("$SUDO_CMD")
        apt_install_cmd+=("$SUDO_CMD")
      fi
      apt_update_cmd+=(apt-get -o DPkg::Lock::Timeout=60 update -y)
      apt_install_cmd+=(apt-get -o DPkg::Lock::Timeout=60 install -y "${packages[@]}")
      run_with_timeout "${apt_update_cmd[@]}"
      run_with_timeout "${apt_install_cmd[@]}"
      ;;
    dnf)
      local dnf_cmd=()
      if [[ -n "$SUDO_CMD" ]]; then
        dnf_cmd+=("$SUDO_CMD")
      fi
      dnf_cmd+=(dnf install -y "${packages[@]}")
      run_with_timeout "${dnf_cmd[@]}"
      ;;
    yum)
      local yum_cmd=()
      if [[ -n "$SUDO_CMD" ]]; then
        yum_cmd+=("$SUDO_CMD")
      fi
      yum_cmd+=(yum install -y "${packages[@]}")
      run_with_timeout "${yum_cmd[@]}"
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
    apt-get)
      if ! pkg_install python3 python3-venv python3-pip; then
        echo "[ERROR] Installing Python runtime failed or timed out (${PKG_TIMEOUT_SECONDS}s)."
        exit 1
      fi
      ;;
    dnf|yum)
      if ! pkg_install python3 python3-pip python3-virtualenv; then
        echo "[ERROR] Installing Python runtime failed or timed out (${PKG_TIMEOUT_SECONDS}s)."
        exit 1
      fi
      ;;
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
  if [[ "$AUTO_INSTALL_NODE" != "1" ]]; then
    echo "[WARN] npm not found. Skipping Node.js auto-install (AUTO_INSTALL_NODE=0)."
    echo "[WARN] Tailwind will use standalone binary."
    return 1
  fi
  if [[ -z "$PKG_MGR" ]]; then
    echo "[WARN] npm not found and no supported package manager available. Tailwind will fall back to standalone mode."
    return 1
  fi
  if [[ -n "$SUDO_CMD" ]] && [[ ! -t 0 ]] && ! $SUDO_CMD -n true >/dev/null 2>&1; then
    echo "[WARN] sudo requires password in current session, skip Node.js auto-install."
    echo "[WARN] Tailwind will use standalone binary."
    return 1
  fi
  echo "[INFO] Installing Node.js and npm (timeout=${PKG_TIMEOUT_SECONDS}s) ..."
  if ! pkg_install nodejs npm; then
    echo "[WARN] Failed to install Node.js/npm via package manager or timeout."
    echo "[WARN] Tailwind will use standalone binary."
    return 1
  fi
  if ! command -v "$NPM_BIN" >/dev/null 2>&1; then
    echo "[WARN] Node.js/npm install command finished but npm is still unavailable."
    echo "[WARN] Tailwind will use standalone binary."
    return 1
  fi
}

install_node_if_missing || true

if command -v "$NPM_BIN" >/dev/null 2>&1 && [[ -f package.json ]]; then
  echo "[INFO] Installing Node dependencies ..."
  if [[ -f package-lock.json ]]; then
    if ! "$NPM_BIN" ci --no-audit --no-fund; then
      echo "[WARN] npm ci failed, continue with standalone Tailwind fallback."
    fi
  else
    if ! "$NPM_BIN" install --no-audit --no-fund; then
      echo "[WARN] npm install failed, continue with standalone Tailwind fallback."
    fi
  fi
fi

chmod +x setup_linux.sh start_linux.sh cleanup_linux.sh uninstall_linux.sh manage_map_key.sh manage_accounts.sh deploy_linux_oneclick.sh build_tailwind.sh || true

echo "[OK] Linux environment is ready."
echo "[TIP] Start service: ./start_linux.sh"
echo "[TIP] Build Tailwind CSS: ./build_tailwind.sh"
echo "[TIP] Disable Node auto-install: AUTO_INSTALL_NODE=0 ./setup_linux.sh"
echo "[TIP] Uninstall: ./uninstall_linux.sh"
