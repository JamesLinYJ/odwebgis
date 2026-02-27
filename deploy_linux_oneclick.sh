#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

HOST="${WEBGIS_HOST:-0.0.0.0}"
PORT="${WEBGIS_PORT:-5000}"
MAP_KEY="${TIANDITU_API_KEY:-}"
ADMIN_USERNAME="${WEBGIS_DEFAULT_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${WEBGIS_DEFAULT_ADMIN_PASSWORD:-}"
ADMIN_NAME="${WEBGIS_DEFAULT_ADMIN_NAME:-DefaultAdmin}"
SYSTEM_ADMIN_ACCOUNT="${WEBGIS_SYSTEM_ADMIN_ACCOUNT:-}"
SYSTEM_ADMIN_PASSWORD="${WEBGIS_SYSTEM_ADMIN_PASSWORD:-}"
FORCE_CHANGE=0

usage() {
  cat <<'USAGE'
Usage: ./deploy_linux_oneclick.sh [options]

Options:
  --host <host>                     Service host, default 0.0.0.0
  --port <port>                     Service port, default 5000
  --map-key <key>                   TianDiTu API key
  --admin-username <username>       Default admin username, default admin
  --admin-password <password>       Default admin password (if omitted, interactive/autogen)
  --admin-name <name>               Default admin display name
  --system-admin-account <account>  Optional system backend account
  --system-admin-password <pass>    Optional system backend password
  --force-change                    Force default admin to change password on next login
  -h, --help                        Show this help

Examples:
  ./deploy_linux_oneclick.sh --map-key "<TIANDITU_KEY>" --admin-username admin --admin-password "Admin#Pass123"
  ./deploy_linux_oneclick.sh --map-key "<TIANDITU_KEY>" --admin-username teacher --admin-password "Teacher#Pass123" --port 5056

Helpful commands:
  python manage_map_key.py set --key "<your_key>"
  python manage_accounts.py create --name "Admin" --username admin --user-type admin --password "<password>"
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --map-key) MAP_KEY="$2"; shift 2 ;;
    --admin-username) ADMIN_USERNAME="$2"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="$2"; shift 2 ;;
    --admin-name) ADMIN_NAME="$2"; shift 2 ;;
    --system-admin-account) SYSTEM_ADMIN_ACCOUNT="$2"; shift 2 ;;
    --system-admin-password) SYSTEM_ADMIN_PASSWORD="$2"; shift 2 ;;
    --force-change) FORCE_CHANGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown option: $1"; usage; exit 1 ;;
  esac
done

ensure_non_empty() {
  local value="$1"
  local name="$2"
  if [[ -z "$value" ]]; then
    echo "[ERROR] $name cannot be empty."
    exit 1
  fi
}

verify_admin_login() {
  echo "[INFO] Verifying admin login and core endpoints ..."
  python - <<PY
import json, hashlib, urllib.request, urllib.error, http.cookiejar
base='http://127.0.0.1:${PORT}'
username=${ADMIN_USERNAME@Q}
password=${ADMIN_PASSWORD@Q}
jar=http.cookiejar.CookieJar()
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def post(path, data):
    req=urllib.request.Request(base+path, data=json.dumps(data).encode('utf-8'), headers={'Content-Type':'application/json'})
    with opener.open(req, timeout=8) as r:
        return r.status, json.loads(r.read().decode('utf-8'))

def get(path):
    req=urllib.request.Request(base+path)
    with opener.open(req, timeout=8) as r:
        return r.status, json.loads(r.read().decode('utf-8'))

pw='sha256:'+hashlib.sha256(password.encode('utf-8')).hexdigest()
status,_=post('/api/auth/login', {'account': username, 'password': pw})
assert status == 200, 'admin login failed'
assert get('/api/admin/overview')[0] == 200
assert get('/api/admin/accounts')[0] == 200
assert get('/api/users?user_type=student')[0] == 200
print('OK')
PY
}

echo "[TIP] API key command:"
echo "      python manage_map_key.py set --key \"<your_tianditu_key>\""
echo "[TIP] Account command:"
echo "      python manage_accounts.py create --name \"Admin\" --username admin --user-type admin --password \"<password>\""

if [[ -z "$MAP_KEY" && -s .tianditu_key ]]; then
  MAP_KEY="$(cat .tianditu_key)"
fi

if [[ -z "$MAP_KEY" && -t 0 ]]; then
  read -r -p "TianDiTu API key: " MAP_KEY
fi
ensure_non_empty "$MAP_KEY" "TianDiTu API key"

if [[ -z "$ADMIN_USERNAME" && -t 0 ]]; then
  read -r -p "Default admin username: " ADMIN_USERNAME
fi
ensure_non_empty "$ADMIN_USERNAME" "Default admin username"

if [[ -z "$ADMIN_PASSWORD" && -t 0 ]]; then
  read -r -s -p "Default admin password (leave blank to auto-generate): " ADMIN_PASSWORD
  echo
fi

if [[ -z "$ADMIN_PASSWORD" ]]; then
  echo "[INFO] No admin password entered, generating a secure random password."
  ADMIN_PASSWORD="$(python3 - <<'PY'
import secrets, string
alphabet = string.ascii_letters + string.digits + '!@#$%^&*()_+-=[]{}:,.?'
print(''.join(secrets.choice(alphabet) for _ in range(16)))
PY
)"
fi

echo "[INFO] Step 1/6: setup Python env"
./setup_linux.sh

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[INFO] Step 2/6: save map key"
python manage_map_key.py set --key "$MAP_KEY"
python manage_map_key.py check || true

echo "[INFO] Step 3/6: build Tailwind CSS"
./build_tailwind.sh

echo "[INFO] Step 4/6: write runtime env"
cat > .env.webgis <<EOF
WEBGIS_HOST="$HOST"
WEBGIS_PORT="$PORT"
TIANDITU_API_KEY="$MAP_KEY"
EOF

if [[ -n "$SYSTEM_ADMIN_ACCOUNT" ]]; then
  cat >> .env.webgis <<EOF
WEBGIS_SYSTEM_ADMIN_ACCOUNT="$SYSTEM_ADMIN_ACCOUNT"
EOF
fi
if [[ -n "$SYSTEM_ADMIN_PASSWORD" ]]; then
  cat >> .env.webgis <<EOF
WEBGIS_SYSTEM_ADMIN_PASSWORD="$SYSTEM_ADMIN_PASSWORD"
EOF
fi

echo "[INFO] Step 5/6: start service"
./start_linux.sh

echo "[INFO] Step 6/6: ensure default admin account"
ACCOUNT_EXISTS="$(python - <<PY
import sqlite3
name = ${ADMIN_USERNAME@Q}
con = sqlite3.connect('webgis.db')
row = con.execute("SELECT id FROM users WHERE UPPER(COALESCE(student_no,'')) = UPPER(?)", (name,)).fetchone()
print('1' if row else '0')
PY
)"

if [[ "$ACCOUNT_EXISTS" == "1" ]]; then
  python manage_accounts.py set-role --username "$ADMIN_USERNAME" --user-type admin
  if [[ "$FORCE_CHANGE" == "1" ]]; then
    python manage_accounts.py reset-password --username "$ADMIN_USERNAME" --password "$ADMIN_PASSWORD" --force-change
  else
    python manage_accounts.py reset-password --username "$ADMIN_USERNAME" --password "$ADMIN_PASSWORD"
  fi
else
  CREATE_ARGS=(create --name "$ADMIN_NAME" --username "$ADMIN_USERNAME" --user-type admin --password "$ADMIN_PASSWORD")
  if [[ "$FORCE_CHANGE" == "1" ]]; then
    CREATE_ARGS+=(--force-change)
  fi
  python manage_accounts.py "${CREATE_ARGS[@]}"
fi

verify_admin_login

echo "[OK] Deployment complete."
echo "[OK] URL: http://127.0.0.1:${PORT}"
echo "[OK] Default admin username: $ADMIN_USERNAME"
echo "[OK] Default admin password: $ADMIN_PASSWORD"

