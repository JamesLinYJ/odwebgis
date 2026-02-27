#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-.venv}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "[ERROR] 未找到 ${PYTHON_BIN}。请先安装 Python 3.10+。"
  exit 1
fi

if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
  if [[ -d "$VENV_DIR" ]]; then
    rm -rf "$VENV_DIR"
  fi
  echo "[INFO] 创建虚拟环境 ${VENV_DIR} ..."
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

chmod +x start_linux.sh cleanup_linux.sh manage_map_key.sh || true

if [[ -z "${TIANDITU_API_KEY:-}" ]] && [[ ! -s ".tianditu_key" ]]; then
  echo "[WARN] 尚未配置天地图 Key。"
  if [[ -t 0 ]]; then
    read -r -p "请输入天地图 API Key（可回车跳过，稍后用 ./manage_map_key.sh set 配置）: " INPUT_KEY
    if [[ -n "$INPUT_KEY" ]]; then
      python manage_map_key.py set --key "$INPUT_KEY"
      python manage_map_key.py check || true
    fi
  fi
fi

echo "[INFO] 启动 WebGIS ..."
./start_linux.sh
