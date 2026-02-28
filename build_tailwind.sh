#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TAILWIND_VERSION="${TAILWIND_VERSION:-v3.4.17}"
INPUT_FILE="${TAILWIND_INPUT_FILE:-static/css/tailwind.input.css}"
OUTPUT_FILE="${TAILWIND_OUTPUT_FILE:-static/css/tailwind.generated.css}"
CONFIG_FILE="${TAILWIND_CONFIG_FILE:-tailwind.config.js}"
NPM_BIN="${NPM_BIN:-npm}"
TAILWIND_USE_STANDALONE="${TAILWIND_USE_STANDALONE:-0}"

download_file() {
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL "$url" -o "$out"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
    return 0
  fi
  echo "[ERROR] Neither curl nor wget is available for downloading tailwindcss."
  return 1
}

resolve_tailwind_bin() {
  if [[ "$TAILWIND_USE_STANDALONE" != "1" ]]; then
    if command -v "$NPM_BIN" >/dev/null 2>&1 && [[ -f "$ROOT_DIR/package.json" ]]; then
      if [[ ! -x "$ROOT_DIR/node_modules/.bin/tailwindcss" ]]; then
        echo "[INFO] Installing Node dependencies for Tailwind build ..." >&2
        if [[ -f "$ROOT_DIR/package-lock.json" ]]; then
          "$NPM_BIN" ci --no-audit --no-fund >&2
        else
          "$NPM_BIN" install --no-audit --no-fund >&2
        fi
      fi
      if [[ -x "$ROOT_DIR/node_modules/.bin/tailwindcss" ]]; then
        echo "$ROOT_DIR/node_modules/.bin/tailwindcss"
        return 0
      fi
    fi
  fi

  if [[ -n "${TAILWIND_BIN:-}" ]]; then
    if [[ ! -x "$TAILWIND_BIN" ]]; then
      echo "[ERROR] TAILWIND_BIN is set but not executable: $TAILWIND_BIN"
      exit 1
    fi
    echo "$TAILWIND_BIN"
    return 0
  fi

  if command -v tailwindcss >/dev/null 2>&1; then
    command -v tailwindcss
    return 0
  fi

  local arch
  arch="$(uname -m)"
  local bin_name=""
  case "$arch" in
    x86_64|amd64) bin_name="tailwindcss-linux-x64" ;;
    aarch64|arm64) bin_name="tailwindcss-linux-arm64" ;;
    *)
      echo "[ERROR] Unsupported Linux arch for auto tailwindcss binary: $arch"
      echo "[TIP] Set TAILWIND_BIN to a valid tailwindcss executable."
      exit 1
      ;;
  esac

  local target="$ROOT_DIR/tools/$bin_name"
  if [[ ! -x "$target" ]]; then
    local url="https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/${bin_name}"
    echo "[INFO] Downloading Tailwind standalone binary: $url" >&2
    download_file "$url" "$target"
    chmod +x "$target"
  fi
  echo "$target"
}

if [[ ! -f "$INPUT_FILE" ]]; then
  echo "[ERROR] Tailwind input file not found: $INPUT_FILE"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[ERROR] Tailwind config file not found: $CONFIG_FILE"
  exit 1
fi

BIN_PATH="$(resolve_tailwind_bin)"
echo "[INFO] Building Tailwind CSS with: $BIN_PATH"
"$BIN_PATH" -c "$CONFIG_FILE" -i "$INPUT_FILE" -o "$OUTPUT_FILE" --minify
echo "[OK] Tailwind CSS generated: $OUTPUT_FILE"
