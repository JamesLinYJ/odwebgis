#!/usr/bin/env bash
# 【中文注释】
# 文件说明：manage_map_key.sh 为 Linux 运维/部署脚本。
# 维护约定：调整参数默认值时，请同步更新脚本帮助信息。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -d ".venv" ]]; then
  # shellcheck disable=SC1091
  source ".venv/bin/activate"
fi

python3 manage_map_key.py "$@"

