#!/usr/bin/env bash
# 【中文注释】
# 文件说明：manage_map_key.sh 为 Linux 运维/部署脚本。
# 维护约定：调整参数默认值时，请同步更新脚本帮助信息。
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
exec "$PYTHON_BIN" manage_map_key.py "$@"

