import csv
import io
import os
import sqlite3
import hashlib
import hmac
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from flask import Flask, Response, g, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webgis.db")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
MAX_FAILED_LOGIN_ATTEMPTS = 5
LOGIN_LOCK_MINUTES = 15
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64
LOCAL_DEFAULT_AVATAR = "/static/images/avatar-default.svg"
SYSTEM_ADMIN_ACCOUNT_ENV = "WEBGIS_SYSTEM_ADMIN_ACCOUNT"
SYSTEM_ADMIN_PASSWORD_ENV = "WEBGIS_SYSTEM_ADMIN_PASSWORD"
SYSTEM_ADMIN_PASSWORD_SHA256_ENV = "WEBGIS_SYSTEM_ADMIN_PASSWORD_SHA256"
TIANDITU_API_KEY_ENV = "TIANDITU_API_KEY"
TIANDITU_API_KEY_FILE = os.path.join(BASE_DIR, ".tianditu_key")
TILE_RATE_LIMIT_PER_MIN = 900
TILE_RATE_WINDOW_SECONDS = 60
_tile_rate_buckets: dict[str, deque[float]] = {}


def utc_now_text() -> str:
    return datetime.utcnow().strftime(DATETIME_FMT)


def parse_datetime_text(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, DATETIME_FMT)
    except ValueError:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return None


def normalize_user_status(status: str | None, default: str = "offline") -> str:
    value = (status or "").strip().lower()
    if not value:
        return default
    if value in {"在线", "online"}:
        return "online"
    if value in {"离线", "offline"}:
        return "offline"
    return default


def user_status_label(status_code: str | None) -> str:
    code = normalize_user_status(status_code)
    return "在线" if code == "online" else "离线"


def validate_username(username: str) -> str | None:
    value = (username or "").strip()
    if not value:
        return "用户名不能为空"
    if any(ch.isspace() for ch in value):
        return "用户名不能包含空格"
    if len(value) < 3:
        return "用户名至少 3 位"
    if len(value) > 24:
        return "用户名长度不能超过 24 位"
    return None


def validate_password_strength(password: str, username: str = "") -> str | None:
    text = str(password or "")
    if text.startswith("sha256:"):
        digest = text[7:].strip().lower()
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            return "密码加密格式无效"
        return None

    if len(text) < PASSWORD_MIN_LENGTH:
        return f"密码至少 {PASSWORD_MIN_LENGTH} 位"
    if len(text) > PASSWORD_MAX_LENGTH:
        return f"密码长度不能超过 {PASSWORD_MAX_LENGTH} 位"
    if any(ch.isspace() for ch in text):
        return "密码不能包含空格"
    if not all(33 <= ord(ch) <= 126 for ch in text):
        return "密码仅支持英文、数字和常见符号，不支持中文或全角字符"
    if username and text.lower() == username.lower():
        return "密码不能与用户名相同"
    return None


def normalize_password_secret(password: str) -> str:
    text = str(password or "").strip()
    if text.startswith("sha256:"):
        digest = text[7:].strip().lower()
        if len(digest) == 64 and all(ch in "0123456789abcdef" for ch in digest):
            return digest
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def get_tianditu_api_key() -> str:
    env_key = (os.environ.get(TIANDITU_API_KEY_ENV) or "").strip()
    if env_key:
        return env_key

    try:
        with open(TIANDITU_API_KEY_FILE, "r", encoding="utf-8") as fp:
            return (fp.readline() or "").strip()
    except OSError:
        return ""


def get_tile_rate_limit_per_min() -> int:
    raw = (os.environ.get("WEBGIS_TILE_RATE_LIMIT_PER_MIN") or "").strip()
    if not raw:
        return TILE_RATE_LIMIT_PER_MIN
    try:
        value = int(raw)
    except ValueError:
        return TILE_RATE_LIMIT_PER_MIN
    return max(60, min(5000, value))


def consume_tile_quota(identity: str) -> tuple[bool, int]:
    now_ts = time.time()
    limit = get_tile_rate_limit_per_min()
    bucket = _tile_rate_buckets.get(identity)
    if bucket is None:
        bucket = deque()
        _tile_rate_buckets[identity] = bucket

    cutoff = now_ts - TILE_RATE_WINDOW_SECONDS
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()

    if len(bucket) >= limit:
        retry_after = max(1, int(TILE_RATE_WINDOW_SECONDS - (now_ts - bucket[0])) + 1)
        return False, retry_after

    bucket.append(now_ts)
    return True, 0


def get_system_admin_account() -> str:
    return (os.environ.get(SYSTEM_ADMIN_ACCOUNT_ENV) or "").strip()


def get_system_admin_secret_digest() -> str | None:
    raw_digest = (os.environ.get(SYSTEM_ADMIN_PASSWORD_SHA256_ENV) or "").strip().lower()
    if raw_digest.startswith("sha256:"):
        raw_digest = raw_digest[7:].strip().lower()
    if len(raw_digest) == 64 and all(ch in "0123456789abcdef" for ch in raw_digest):
        return raw_digest

    plain = os.environ.get(SYSTEM_ADMIN_PASSWORD_ENV)
    if plain is None:
        return None
    plain_text = str(plain)
    if not plain_text:
        return None
    return hashlib.sha256(plain_text.encode("utf-8")).hexdigest()


def system_admin_enabled() -> bool:
    return bool(get_system_admin_account() and get_system_admin_secret_digest())


def build_system_admin_user(status: str = "online") -> dict[str, Any]:
    account = get_system_admin_account() or "SYSTEM_ADMIN"
    now = utc_now_text()
    return {
        "id": 0,
        "name": "系统后台管理员",
        "role": "系统管理员",
        "status": user_status_label(status),
        "status_code": normalize_user_status(status),
        "avatar_url": LOCAL_DEFAULT_AVATAR,
        "focus_topic": "系统管理",
        "user_type": "admin",
        "student_no": account,
        "username": account,
        "class_name": "",
        "created_at": now,
        "last_active_at": now,
        "force_password_change": 0,
        "must_change_password": False,
        "route_count": 0,
        "is_system_admin": True,
    }


def is_system_admin_user(user: sqlite3.Row | dict[str, Any] | None) -> bool:
    return isinstance(user, dict) and bool(user.get("is_system_admin"))


def create_app() -> Flask:
    app = Flask(__name__)
    app.secret_key = os.environ.get("WEBGIS_SECRET_KEY", "webgis-dev-secret-change-me")
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_SECURE"] = os.environ.get("WEBGIS_COOKIE_SECURE", "0") == "1"
    app.permanent_session_lifetime = timedelta(hours=12)
    init_db()
    if not system_admin_enabled():
        print(
            f"[WARN] 未配置系统后台管理账号。请设置 {SYSTEM_ADMIN_ACCOUNT_ENV} 和 "
            f"{SYSTEM_ADMIN_PASSWORD_ENV} 或 {SYSTEM_ADMIN_PASSWORD_SHA256_ENV}。"
        )
    if not get_tianditu_api_key():
        print(
            f"[WARN] 未配置天地图 Key。请设置环境变量 {TIANDITU_API_KEY_ENV}，"
            f"或在项目根目录写入 {os.path.basename(TIANDITU_API_KEY_FILE)}。"
        )

    @app.teardown_appcontext
    def close_db(_: Exception | None) -> None:
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def session_user() -> sqlite3.Row | dict[str, Any] | None:
        if session.get("is_system_admin"):
            return build_system_admin_user(status="online")
        user_id = session.get("user_id")
        if not user_id:
            return None
        db = get_db()
        row = db.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
        if row is None:
            session.pop("user_id", None)
            return None
        return row

    def require_admin() -> tuple[sqlite3.Row | dict[str, Any] | None, Any | None]:
        user = session_user()
        if user is None:
            return None, (jsonify({"ok": False, "message": "未登录"}), 401)
        if user["user_type"] != "admin":
            return None, (jsonify({"ok": False, "message": "无管理员权限"}), 403)
        return user, None

    @app.route("/")
    def home() -> str:
        user = session_user()
        if user is None:
            return redirect(url_for("auth_page"))
        if user["user_type"] == "admin":
            return redirect(url_for("admin"))
        return render_template("explorer.html")

    @app.route("/auth")
    def auth_page() -> str:
        user = session_user()
        if user is not None:
            if user["user_type"] == "admin":
                return redirect(url_for("admin"))
            return redirect(url_for("home"))
        return render_template("auth.html")

    @app.route("/admin")
    def admin() -> str:
        user = session_user()
        if user is None:
            return redirect(url_for("auth_page"))
        if user["user_type"] != "admin":
            return redirect(url_for("home"))
        return render_template("admin.html")

    @app.route("/admin/accounts")
    def admin_accounts_page() -> str:
        user = session_user()
        if user is None:
            return redirect(url_for("auth_page"))
        if user["user_type"] != "admin":
            return redirect(url_for("home"))
        return render_template("admin_accounts.html")

    @app.route("/account")
    def account_page() -> str:
        user = session_user()
        if user is None:
            return redirect(url_for("auth_page"))
        return render_template("account.html")

    @app.get("/api/map/tile/<layer>/<int:z>/<int:x>/<int:y>")
    def proxy_map_tile(layer: str, z: int, x: int, y: int) -> Any:
        user = session_user()
        if user is None:
            return jsonify({"ok": False, "message": "未登录"}), 401

        sec_fetch_site = (request.headers.get("Sec-Fetch-Site") or "").strip().lower()
        if sec_fetch_site and sec_fetch_site not in {"same-origin", "same-site", "none"}:
            return jsonify({"ok": False, "message": "非法请求来源"}), 403

        referer = (request.headers.get("Referer") or "").strip()
        if referer:
            parsed = urlparse(referer)
            if parsed.netloc and parsed.netloc != request.host:
                return jsonify({"ok": False, "message": "非法请求来源"}), 403

        if layer not in {"vec", "cva", "img", "cia"}:
            return jsonify({"ok": False, "message": "不支持的图层"}), 404
        tianditu_api_key = get_tianditu_api_key()
        if not tianditu_api_key:
            return jsonify({"ok": False, "message": "天地图密钥未配置"}), 500
        if z < 0 or z > 22:
            return jsonify({"ok": False, "message": "zoom 超出范围"}), 400

        requester_id = int(user["id"])
        remote_addr = request.remote_addr or "-"
        quota_ok, retry_after = consume_tile_quota(f"{requester_id}:{remote_addr}")
        if not quota_ok:
            return (
                jsonify({"ok": False, "message": "瓦片请求过于频繁，请稍后重试"}),
                429,
                {"Retry-After": str(retry_after)},
            )

        subdomain = str((x + y + z) % 8)
        remote_url = (
            f"https://t{subdomain}.tianditu.gov.cn/{layer}_w/wmts"
            f"?service=wmts&request=GetTile&version=1.0.0"
            f"&layer={layer}&style=default&tilematrixset=w&format=tiles"
            f"&tilematrix={z}&tilerow={y}&tilecol={x}&tk={tianditu_api_key}"
        )

        user_agent = (request.headers.get("User-Agent") or "").strip()
        if not user_agent or user_agent.lower().startswith("python-urllib"):
            user_agent = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            )

        try:
            upstream_req = urllib.request.Request(
                remote_url,
                headers={
                    "User-Agent": user_agent,
                    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                },
            )
            with urllib.request.urlopen(upstream_req, timeout=8) as resp:
                data = resp.read()
                content_type = resp.headers.get("Content-Type", "image/png")
        except urllib.error.HTTPError as exc:
            return jsonify({"ok": False, "message": f"上游瓦片服务返回 {exc.code}"}), 502
        except Exception:
            return jsonify({"ok": False, "message": "瓦片服务暂不可用"}), 502

        return Response(
            data,
            mimetype=content_type,
            headers={
                "Cache-Control": "private, max-age=43200",
                "Vary": "Cookie",
                "X-Content-Type-Options": "nosniff",
                "Cross-Origin-Resource-Policy": "same-origin",
            },
        )

    @app.get("/api/auth/me")
    def auth_me() -> Any:
        if session.get("is_system_admin"):
            return jsonify({"ok": True, "user": build_system_admin_user(status="online")})

        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"ok": False, "message": "未登录"}), 401
        db = get_db()
        user = db.execute(
            """
            SELECT u.*, COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE u.id = ?
            GROUP BY u.id
            """,
            (user_id,),
        ).fetchone()
        if user is None:
            session.pop("user_id", None)
            return jsonify({"ok": False, "message": "用户不存在"}), 401
        return jsonify({"ok": True, "user": user_row_to_dict(user)})

    @app.post("/api/auth/register")
    def auth_register() -> Any:
        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        username = (
            payload.get("username")
            or payload.get("student_no")
            or payload.get("account")
            or ""
        ).strip()
        password = (payload.get("password") or "").strip()

        if not name:
            return jsonify({"ok": False, "message": "姓名不能为空"}), 400
        username_err = validate_username(username)
        if username_err:
            return jsonify({"ok": False, "message": username_err}), 400
        password_err = validate_password_strength(password, username)
        if password_err:
            return jsonify({"ok": False, "message": password_err}), 400

        db = get_db()
        exists = db.execute(
            """
            SELECT id FROM users
            WHERE UPPER(COALESCE(student_no, '')) = UPPER(?)
            """,
            (username,),
        ).fetchone()
        if exists is not None:
            return jsonify({"ok": False, "message": "该用户名已存在"}), 400

        now = utc_now_text()
        avatar_url = LOCAL_DEFAULT_AVATAR

        cur = db.execute(
            """
            INSERT INTO users(
                name, role, region, status, avatar_url, focus_topic,
                user_type, student_no, class_name, password_hash, created_at, last_active_at,
                force_password_change, failed_login_count, lock_until
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                name,
                "学生",
                "",
                "offline",
                avatar_url,
                "课堂演示",
                "student",
                username,
                "",
                generate_password_hash(normalize_password_secret(password)),
                now,
                now,
                0,
                0,
                None,
            ),
        )
        db.commit()
        new_id = int(cur.lastrowid)
        session.clear()
        session["user_id"] = new_id
        session.permanent = True
        db.execute(
            "UPDATE users SET status = 'online', last_active_at = ? WHERE id = ?",
            (utc_now_text(), new_id),
        )
        db.commit()
        return jsonify({"ok": True, "user_id": new_id, "redirect": "/"})

    @app.post("/api/auth/login")
    def auth_login() -> Any:
        payload = request.get_json(silent=True) or {}
        account = (
            payload.get("account")
            or payload.get("username")
            or payload.get("student_no")
            or ""
        ).strip()
        password = (payload.get("password") or "").strip()

        if not account or not password:
            return jsonify({"ok": False, "message": "请输入用户名和密码"}), 400

        # 系统后台管理账号（由部署环境变量控制，不写入数据库）
        system_admin_account = get_system_admin_account()
        system_admin_digest = get_system_admin_secret_digest()
        if system_admin_account and system_admin_digest and account.upper() == system_admin_account.upper():
            incoming_secret = normalize_password_secret(password)
            if hmac.compare_digest(incoming_secret, system_admin_digest):
                session.clear()
                session["is_system_admin"] = True
                session.permanent = True
                return jsonify(
                    {
                        "ok": True,
                        "redirect": "/admin",
                        "must_change_password": False,
                    }
                )
            return jsonify({"ok": False, "message": "用户名或密码错误"}), 401

        db = get_db()
        row = db.execute(
            """
            SELECT id, user_type, password_hash,
                   COALESCE(failed_login_count, 0) AS failed_login_count,
                   lock_until,
                   COALESCE(force_password_change, 0) AS force_password_change
            FROM users
            WHERE UPPER(COALESCE(student_no, '')) = UPPER(?)
            """,
            (account,),
        ).fetchone()
        if row is None:
            return jsonify({"ok": False, "message": "用户名或密码错误"}), 401

        lock_until = parse_datetime_text(row["lock_until"])
        if lock_until is not None and lock_until > datetime.utcnow():
            remain_minutes = max(1, int((lock_until - datetime.utcnow()).total_seconds() // 60) + 1)
            return jsonify({"ok": False, "message": f"登录失败次数过多，请 {remain_minutes} 分钟后再试"}), 429

        hashed = row["password_hash"] or ""
        normalized_secret = normalize_password_secret(password)
        password_ok = bool(hashed) and check_password_hash(hashed, normalized_secret)
        # 兼容早期未做前端加密时的口令校验
        if not password_ok and hashed:
            password_ok = check_password_hash(hashed, password)
        if not password_ok:
            failed_count = int(row["failed_login_count"] or 0) + 1
            next_lock_until = None
            status_code = 401
            message = "用户名或密码错误"
            if failed_count >= MAX_FAILED_LOGIN_ATTEMPTS:
                next_lock_until = (datetime.utcnow() + timedelta(minutes=LOGIN_LOCK_MINUTES)).strftime(DATETIME_FMT)
                failed_count = 0
                status_code = 429
                message = f"登录失败次数过多，请 {LOGIN_LOCK_MINUTES} 分钟后再试"
            db.execute(
                """
                UPDATE users
                SET failed_login_count = ?, lock_until = ?, last_active_at = ?
                WHERE id = ?
                """,
                (failed_count, next_lock_until, utc_now_text(), int(row["id"])),
            )
            db.commit()
            return jsonify({"ok": False, "message": message}), status_code

        uid = int(row["id"])
        session.clear()
        session["user_id"] = uid
        session.permanent = True
        db.execute(
            """
            UPDATE users
            SET status = 'online', last_active_at = ?, failed_login_count = 0, lock_until = NULL
            WHERE id = ?
            """,
            (utc_now_text(), uid),
        )
        db.commit()
        redirect_path = "/admin" if row["user_type"] == "admin" else "/"
        return jsonify(
            {
                "ok": True,
                "user_id": uid,
                "redirect": redirect_path,
                "must_change_password": bool(int(row["force_password_change"] or 0)),
            }
        )

    @app.post("/api/auth/logout")
    def auth_logout() -> Any:
        session.pop("is_system_admin", None)
        user_id = session.pop("user_id", None)
        if user_id:
            db = get_db()
            db.execute(
                "UPDATE users SET status = 'offline', last_active_at = ? WHERE id = ?",
                (utc_now_text(), int(user_id)),
            )
            db.commit()
        return jsonify({"ok": True})

    @app.post("/api/auth/change-password")
    def auth_change_password() -> Any:
        user = session_user()
        if user is None:
            return jsonify({"ok": False, "message": "未登录"}), 401
        if is_system_admin_user(user):
            return jsonify({"ok": False, "message": "系统后台账号密码由部署环境统一管理"}), 400

        payload = request.get_json(silent=True) or {}
        old_password = (payload.get("old_password") or "").strip()
        new_password = (payload.get("new_password") or "").strip()

        if not old_password or not new_password:
            return jsonify({"ok": False, "message": "请输入旧密码和新密码"}), 400
        password_err = validate_password_strength(new_password, user["student_no"] or "")
        if password_err:
            return jsonify({"ok": False, "message": password_err}), 400

        hashed = user["password_hash"] or ""
        normalized_old_secret = normalize_password_secret(old_password)
        password_ok = bool(hashed) and check_password_hash(hashed, normalized_old_secret)
        # 兼容早期未做前端加密时的旧口令校验
        if not password_ok and hashed:
            password_ok = check_password_hash(hashed, old_password)
        if not password_ok:
            return jsonify({"ok": False, "message": "旧密码错误"}), 400

        db = get_db()
        db.execute(
            """
            UPDATE users
            SET password_hash = ?, last_active_at = ?, force_password_change = 0
            WHERE id = ?
            """,
            (
                generate_password_hash(normalize_password_secret(new_password)),
                utc_now_text(),
                int(user["id"]),
            ),
        )
        db.commit()
        return jsonify({"ok": True})

    @app.get("/api/routes")
    def list_routes() -> Any:
        user = session_user()
        if user is None:
            return jsonify({"ok": False, "message": "未登录"}), 401

        db = get_db()
        q = request.args.get("q", "").strip()
        category = request.args.get("category", "").strip()
        user_id = request.args.get("user_id", "").strip()
        limit = clamp_int(request.args.get("limit", "300"), 1, 1000, 300)

        sql = [
            """
            SELECT r.*, u.name AS user_name
            FROM od_routes r
            LEFT JOIN users u ON u.id = r.user_id
            WHERE 1=1
            """
        ]
        params: list[Any] = []

        if q:
            sql.append(
                """
                AND (
                    r.origin_name LIKE ? OR r.destination_name LIKE ?
                    OR r.origin_code LIKE ? OR r.destination_code LIKE ?
                    OR r.category LIKE ?
                )
                """
            )
            like = f"%{q}%"
            params.extend([like, like, like, like, like])

        if category:
            sql.append("AND r.category = ?")
            params.append(category)

        if user["user_type"] != "admin":
            sql.append("AND r.user_id = ?")
            params.append(int(user["id"]))
        elif user_id:
            try:
                uid = int(user_id)
                sql.append("AND r.user_id = ?")
                params.append(uid)
            except ValueError:
                return jsonify({"ok": False, "message": "user_id 非法"}), 400

        sql.append("ORDER BY datetime(r.created_at) DESC LIMIT ?")
        params.append(limit)
        rows = db.execute("\n".join(sql), params).fetchall()

        return jsonify(
            {
                "ok": True,
                "routes": [route_row_to_dict(r) for r in rows],
            }
        )

    @app.post("/api/routes")
    def add_route() -> Any:
        payload = request.get_json(silent=True) or {}
        db = get_db()

        try:
            route_id = insert_route(db, payload)
            db.commit()
        except ValueError as exc:
            return jsonify({"ok": False, "message": str(exc)}), 400

        row = db.execute(
            """
            SELECT r.*, u.name AS user_name
            FROM od_routes r
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.id = ?
            """,
            (route_id,),
        ).fetchone()
        return jsonify({"ok": True, "route": route_row_to_dict(row)})

    @app.delete("/api/routes/<int:route_id>")
    def delete_route(route_id: int) -> Any:
        user = session_user()
        if user is None:
            return jsonify({"ok": False, "message": "未登录"}), 401

        db = get_db()
        route = db.execute("SELECT id, user_id FROM od_routes WHERE id = ?", (route_id,)).fetchone()
        if route is None:
            return jsonify({"ok": False, "message": "未找到该路线"}), 404
        if user["user_type"] != "admin" and int(route["user_id"]) != int(user["id"]):
            return jsonify({"ok": False, "message": "无权限删除该路线"}), 403

        cur = db.execute("DELETE FROM od_routes WHERE id = ?", (route_id,))
        db.commit()
        if cur.rowcount == 0:
            return jsonify({"ok": False, "message": "未找到该路线"}), 404
        return jsonify({"ok": True})

    @app.post("/api/routes/batch")
    def batch_routes() -> Any:
        _, err = require_admin()
        if err:
            return err

        upload = request.files.get("file")
        if upload is None:
            return jsonify({"ok": False, "message": "缺少 CSV 文件"}), 400

        raw = upload.read()
        if not raw:
            return jsonify({"ok": False, "message": "CSV 文件为空"}), 400

        db = get_db()
        text = raw.decode("utf-8-sig", errors="ignore")
        reader = csv.DictReader(io.StringIO(text))

        inserted = 0
        errors: list[dict[str, Any]] = []

        for idx, row in enumerate(reader, start=2):
            if not any((v or "").strip() for v in row.values()):
                continue
            normalized = {k.strip(): (v or "").strip() for k, v in row.items() if k}
            try:
                insert_route(db, normalized)
                inserted += 1
            except ValueError as exc:
                errors.append({"line": idx, "error": str(exc)})

        db.commit()

        return jsonify(
            {
                "ok": True,
                "inserted": inserted,
                "errors": errors,
            }
        )

    @app.get("/api/routes/template")
    def download_template() -> Any:
        content = (
            "origin_code,origin_name,origin_lat,origin_lon,destination_code,destination_name,"
            "destination_lat,destination_lon,category,user_id\n"
        ).encode("utf-8-sig")
        return send_file(
            io.BytesIO(content),
            mimetype="text/csv",
            as_attachment=True,
            download_name="od_routes_template.csv",
        )

    @app.get("/api/nodes")
    def list_nodes() -> Any:
        db = get_db()
        rows = db.execute(
            "SELECT code, name, region, lat, lon FROM nodes ORDER BY code ASC"
        ).fetchall()
        return jsonify({"ok": True, "nodes": [dict(r) for r in rows]})

    @app.post("/api/nodes")
    def create_node() -> Any:
        payload = request.get_json(silent=True) or {}
        code = (payload.get("code") or "").strip().upper()
        name = (payload.get("name") or "").strip()
        region = (payload.get("region") or "").strip() or "未分组"
        lat = to_float(payload.get("lat"), "lat")
        lon = to_float(payload.get("lon"), "lon")

        if not code:
            return jsonify({"ok": False, "message": "code 不能为空"}), 400
        if not name:
            return jsonify({"ok": False, "message": "name 不能为空"}), 400
        validate_lat_lon(lat, lon)

        db = get_db()
        try:
            db.execute(
                "INSERT INTO nodes(code, name, region, lat, lon) VALUES(?,?,?,?,?)",
                (code, name, region, lat, lon),
            )
            db.commit()
        except sqlite3.IntegrityError:
            return jsonify({"ok": False, "message": "该节点代码已存在"}), 400

        return jsonify({"ok": True})

    @app.get("/api/users")
    def list_users() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        q = request.args.get("q", "").strip()
        status = normalize_user_status(request.args.get("status", "").strip(), "")
        user_type = request.args.get("user_type", "").strip()

        sql = [
            """
            SELECT u.*,
                   COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE 1=1
            """
        ]
        params: list[Any] = []

        if q:
            like = f"%{q}%"
            sql.append(
                """
                AND (
                    u.name LIKE ? OR u.id LIKE ?
                    OR COALESCE(u.student_no, '') LIKE ? OR u.status LIKE ?
                )
                """
            )
            params.extend([like, like, like, like])
        if status:
            sql.append("AND u.status = ?")
            params.append(status)
        if user_type:
            sql.append("AND u.user_type = ?")
            params.append(user_type)

        sql.append("GROUP BY u.id ORDER BY route_count DESC, datetime(COALESCE(u.last_active_at, u.created_at)) DESC")
        rows = db.execute("\n".join(sql), params).fetchall()
        return jsonify({"ok": True, "users": [user_row_to_dict(r) for r in rows]})

    @app.post("/api/students/register")
    def register_student() -> Any:
        return auth_register()

    @app.get("/api/users/<int:user_id>/summary")
    def user_summary(user_id: int) -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        user = db.execute(
            """
            SELECT u.*,
                   COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE u.id = ?
            GROUP BY u.id
            """,
            (user_id,),
        ).fetchone()

        if user is None:
            return jsonify({"ok": False, "message": "用户不存在"}), 404

        routes = db.execute(
            """
            SELECT r.*, u.name AS user_name
            FROM od_routes r
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.user_id = ?
            ORDER BY datetime(r.created_at) DESC
            LIMIT 200
            """,
            (user_id,),
        ).fetchall()

        categories = db.execute(
            """
            SELECT category, COUNT(*) AS count
            FROM od_routes
            WHERE user_id = ?
            GROUP BY category
            ORDER BY count DESC
            """,
            (user_id,),
        ).fetchall()

        return jsonify(
            {
                "ok": True,
                "user": user_row_to_dict(user),
                "routes": [route_row_to_dict(r) for r in routes],
                "categories": [dict(r) for r in categories],
            }
        )

    @app.get("/api/alerts")
    def list_alerts() -> Any:
        db = get_db()
        rows = db.execute(
            """
            SELECT id, level, message, active, created_at
            FROM alerts
            ORDER BY datetime(created_at) DESC
            LIMIT 20
            """
        ).fetchall()
        return jsonify({"ok": True, "alerts": [dict(r) for r in rows]})

    @app.get("/api/stats/overview")
    def stats_overview() -> Any:
        db = get_db()
        route_count = db.execute("SELECT COUNT(*) AS v FROM od_routes").fetchone()["v"]
        active_alerts = (
            db.execute("SELECT COUNT(*) AS v FROM alerts WHERE active = 1").fetchone()["v"]
        )

        peak = db.execute(
            """
            SELECT strftime('%H', created_at) AS hour,
                   COUNT(*) AS total
            FROM od_routes
            GROUP BY hour
            ORDER BY total DESC
            LIMIT 1
            """
        ).fetchone()

        peak_window = "暂无数据"
        if peak and peak["hour"] is not None:
            h = int(peak["hour"])
            peak_window = f"{h:02d}:00 - {(h + 1) % 24:02d}:00"

        hourly = {int(r["hour"]): int(r["total"]) for r in db.execute(
            """
            SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
                   COUNT(*) AS total
            FROM od_routes
            GROUP BY hour
            """
        ).fetchall()}
        live_series = [hourly.get(i, 0) for i in range(24)]

        return jsonify(
            {
                "ok": True,
                "route_count": int(route_count),
                "active_alerts": int(active_alerts),
                "peak_window": peak_window,
                "live_series": live_series,
            }
        )

    @app.get("/api/admin/region-load")
    def region_load() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()

        rows = db.execute(
            """
            SELECT
                COALESCE(n.region, '自定义') AS region,
                COUNT(r.id) AS total
            FROM od_routes r
            LEFT JOIN nodes n ON UPPER(r.destination_code) = UPPER(n.code)
            GROUP BY COALESCE(n.region, '自定义')
            ORDER BY total DESC
            """
        ).fetchall()

        total = sum(float(r["total"]) for r in rows) or 1.0
        items = [
            {
                "region": r["region"],
                "total": round(float(r["total"]), 2),
                "ratio": round(float(r["total"]) * 100.0 / total, 2),
            }
            for r in rows
        ]

        top = items[0] if items else {"region": "暂无", "total": 0, "ratio": 0}
        return jsonify({"ok": True, "top": top, "items": items})

    @app.get("/api/admin/hourly")
    def admin_hourly() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        rows = db.execute(
            """
            SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour,
                   COUNT(*) AS total
            FROM od_routes
            GROUP BY hour
            ORDER BY hour ASC
            """
        ).fetchall()
        data = [{"hour": int(r["hour"]), "total": round(float(r["total"]), 2)} for r in rows]
        return jsonify({"ok": True, "series": data})

    @app.get("/api/admin/overview")
    def admin_overview() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        total_students = db.execute(
            "SELECT COUNT(*) AS v FROM users WHERE user_type = 'student'"
        ).fetchone()["v"]
        active_students = db.execute(
            "SELECT COUNT(*) AS v FROM users WHERE user_type = 'student' AND status = 'online'"
        ).fetchone()["v"]
        new_students_today = db.execute(
            """
            SELECT COUNT(*) AS v
            FROM users
            WHERE user_type = 'student'
              AND date(created_at) = date('now')
            """
        ).fetchone()["v"]
        total_routes = db.execute("SELECT COUNT(*) AS v FROM od_routes").fetchone()["v"]

        top_student = db.execute(
            """
            SELECT u.id, u.name, COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE u.user_type = 'student'
            GROUP BY u.id
            ORDER BY route_count DESC
            LIMIT 1
            """
        ).fetchone()

        return jsonify(
            {
                "ok": True,
                "total_students": int(total_students),
                "active_students": int(active_students),
                "new_students_today": int(new_students_today),
                "total_routes": int(total_routes),
                "top_student": dict(top_student) if top_student else None,
            }
        )

    @app.get("/api/admin/accounts")
    def admin_list_accounts() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        q = request.args.get("q", "").strip()
        user_type = request.args.get("user_type", "").strip()
        status = normalize_user_status(request.args.get("status", "").strip(), "")

        sql = [
            """
            SELECT u.*,
                   COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE 1=1
            """
        ]
        params: list[Any] = []

        if q:
            like = f"%{q}%"
            sql.append(
                """
                AND (
                    u.name LIKE ? OR COALESCE(u.student_no, '') LIKE ?
                    OR u.role LIKE ? OR u.status LIKE ?
                )
                """
            )
            params.extend([like, like, like, like])
        if user_type in {"student", "admin"}:
            sql.append("AND u.user_type = ?")
            params.append(user_type)
        if status:
            sql.append("AND u.status = ?")
            params.append(status)

        sql.append("GROUP BY u.id ORDER BY datetime(COALESCE(u.created_at, u.last_active_at)) DESC, u.id DESC")
        rows = db.execute("\n".join(sql), params).fetchall()
        return jsonify({"ok": True, "accounts": [user_row_to_dict(r) for r in rows]})

    @app.post("/api/admin/accounts")
    def admin_create_account() -> Any:
        admin_user, err = require_admin()
        if err:
            return err

        payload = request.get_json(silent=True) or {}
        name = (payload.get("name") or "").strip()
        account = (
            payload.get("username")
            or payload.get("account")
            or payload.get("student_no")
            or ""
        ).strip()
        password = (payload.get("password") or "").strip()
        user_type = (payload.get("user_type") or "student").strip().lower()

        if not name:
            return jsonify({"ok": False, "message": "姓名不能为空"}), 400
        username_err = validate_username(account)
        if username_err:
            return jsonify({"ok": False, "message": username_err}), 400
        password_err = validate_password_strength(password, account)
        if password_err:
            return jsonify({"ok": False, "message": password_err}), 400
        if user_type not in {"student", "admin"}:
            return jsonify({"ok": False, "message": "user_type 仅支持 student/admin"}), 400

        db = get_db()
        exists = db.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(student_no, '')) = UPPER(?)",
            (account,),
        ).fetchone()
        if exists is not None:
            return jsonify({"ok": False, "message": "该用户名已存在"}), 400

        now = utc_now_text()
        avatar_url = LOCAL_DEFAULT_AVATAR

        if user_type == "admin":
            role = "管理员"
            default_region = ""
            default_class = ""
            focus_topic = "系统管理"
        else:
            role = "学生"
            default_region = ""
            default_class = ""
            focus_topic = "课堂演示"

        cur = db.execute(
            """
            INSERT INTO users(
                name, role, region, status, avatar_url, focus_topic,
                user_type, student_no, class_name, password_hash, created_at, last_active_at,
                force_password_change, failed_login_count, lock_until
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                name,
                role,
                default_region,
                "offline",
                avatar_url,
                focus_topic,
                user_type,
                account,
                default_class,
                generate_password_hash(normalize_password_secret(password)),
                now,
                now,
                1,
                0,
                None,
            ),
        )
        db.execute(
            "UPDATE users SET last_active_at = ? WHERE id = ?",
            (utc_now_text(), int(admin_user["id"])),
        )
        db.commit()
        return jsonify({"ok": True, "user_id": int(cur.lastrowid)})

    @app.delete("/api/admin/accounts/<int:account_id>")
    def admin_delete_account(account_id: int) -> Any:
        admin_user, err = require_admin()
        if err:
            return err

        if int(admin_user["id"]) == account_id:
            return jsonify({"ok": False, "message": "不能删除当前登录管理员"}), 400

        db = get_db()
        target = db.execute("SELECT id, user_type FROM users WHERE id = ?", (account_id,)).fetchone()
        if target is None:
            return jsonify({"ok": False, "message": "账户不存在"}), 404

        db.execute("DELETE FROM od_routes WHERE user_id = ?", (account_id,))
        db.execute("DELETE FROM users WHERE id = ?", (account_id,))
        db.execute(
            "UPDATE users SET last_active_at = ? WHERE id = ?",
            (utc_now_text(), int(admin_user["id"])),
        )
        db.commit()
        return jsonify({"ok": True})

    @app.delete("/api/admin/accounts/<int:account_id>/routes")
    def admin_delete_account_routes(account_id: int) -> Any:
        admin_user, err = require_admin()
        if err:
            return err

        db = get_db()
        target = db.execute(
            "SELECT id, user_type FROM users WHERE id = ?",
            (account_id,),
        ).fetchone()
        if target is None:
            return jsonify({"ok": False, "message": "账户不存在"}), 404

        cur = db.execute("DELETE FROM od_routes WHERE user_id = ?", (account_id,))
        db.execute(
            "UPDATE users SET last_active_at = ? WHERE id = ?",
            (utc_now_text(), int(admin_user["id"])),
        )
        db.commit()
        return jsonify({"ok": True, "deleted_count": int(cur.rowcount or 0)})

    @app.post("/api/admin/accounts/<int:account_id>/reset-password")
    def admin_reset_password(account_id: int) -> Any:
        admin_user, err = require_admin()
        if err:
            return err

        payload = request.get_json(silent=True) or {}
        new_password = (payload.get("new_password") or "").strip()
        if not new_password:
            return jsonify({"ok": False, "message": "请输入新密码"}), 400

        db = get_db()
        target = db.execute("SELECT id, student_no FROM users WHERE id = ?", (account_id,)).fetchone()
        if target is None:
            return jsonify({"ok": False, "message": "账户不存在"}), 404
        password_err = validate_password_strength(new_password, target["student_no"] or "")
        if password_err:
            return jsonify({"ok": False, "message": password_err}), 400

        db.execute(
            """
            UPDATE users
            SET password_hash = ?, last_active_at = ?, force_password_change = 1,
                failed_login_count = 0, lock_until = NULL
            WHERE id = ?
            """,
            (
                generate_password_hash(normalize_password_secret(new_password)),
                utc_now_text(),
                account_id,
            ),
        )
        db.execute(
            "UPDATE users SET last_active_at = ? WHERE id = ?",
            (utc_now_text(), int(admin_user["id"])),
        )
        db.commit()
        return jsonify({"ok": True})

    @app.get("/api/export/users-csv")
    def export_users_csv() -> Any:
        _, err = require_admin()
        if err:
            return err

        db = get_db()
        rows = db.execute(
            """
            SELECT u.id, u.name, u.status, u.role, u.student_no,
                   COUNT(r.id) AS route_count,
                   u.last_active_at
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            GROUP BY u.id
            ORDER BY route_count DESC
            """
        ).fetchall()

        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["ID", "姓名", "用户名", "状态", "角色", "路线数量", "最后活跃时间"]
        )
        for r in rows:
            writer.writerow(
                [
                    r["id"],
                    r["name"],
                    r["student_no"] or "",
                    user_status_label(r["status"]),
                    r["role"],
                    r["route_count"],
                    r["last_active_at"],
                ]
            )

        data = buffer.getvalue().encode("utf-8-sig")
        return send_file(
            io.BytesIO(data),
            mimetype="text/csv",
            as_attachment=True,
            download_name="webgis_users_export.csv",
        )

    return app


def get_db() -> sqlite3.Connection:
    db = g.get("db")
    if db is None:
        db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
        g.db = db
    return db


def clamp_int(raw: str, min_v: int, max_v: int, default: int) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(min_v, min(max_v, value))


def to_float(value: Any, field: str) -> float:
    if value is None or str(value).strip() == "":
        raise ValueError(f"{field} 不能为空")
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{field} 不是有效数字") from exc


def to_optional_float(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def validate_lat_lon(lat: float, lon: float) -> None:
    if lat < -90 or lat > 90:
        raise ValueError("纬度范围必须在 -90 到 90")
    if lon < -180 or lon > 180:
        raise ValueError("经度范围必须在 -180 到 180")


def resolve_endpoint(
    db: sqlite3.Connection,
    label: str,
    code: str | None,
    name: str | None,
    lat: float | None,
    lon: float | None,
) -> dict[str, Any]:
    clean_code = (code or "").strip().upper()
    clean_name = (name or "").strip()

    if clean_code:
        row = db.execute(
            "SELECT code, name, region, lat, lon FROM nodes WHERE UPPER(code) = ?",
            (clean_code,),
        ).fetchone()
        if row is None:
            raise ValueError(f"{label}代码 {clean_code} 不存在")
        return {
            "code": row["code"],
            "name": clean_name or row["name"],
            "region": row["region"],
            "lat": float(row["lat"]),
            "lon": float(row["lon"]),
        }

    if lat is None or lon is None:
        raise ValueError(f"{label}需要输入代码或经纬度")

    validate_lat_lon(lat, lon)
    return {
        "code": None,
        "name": clean_name or f"{label}手动点",
        "region": "自定义",
        "lat": float(lat),
        "lon": float(lon),
    }


def insert_route(db: sqlite3.Connection, payload: dict[str, Any]) -> int:
    session_user_id = session.get("user_id")
    session_user_type = None
    if session_user_id:
        row = db.execute(
            "SELECT id, user_type FROM users WHERE id = ?",
            (int(session_user_id),),
        ).fetchone()
        if row is not None:
            session_user_id = int(row["id"])
            session_user_type = row["user_type"]
        else:
            session_user_id = None

    user_id = payload.get("user_id")
    if user_id in (None, ""):
        if session_user_id:
            user_id = session_user_id

    if user_id in (None, ""):
        raise ValueError("请先登录后再录入路线")

    try:
        user_id = int(user_id)
    except ValueError as exc:
        raise ValueError("user_id 非法") from exc

    if session_user_id is not None and session_user_type != "admin" and user_id != session_user_id:
        raise ValueError("无权为其他用户录入路线")

    user_exists = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
    if user_exists is None:
        raise ValueError("user_id 对应用户不存在")

    origin = resolve_endpoint(
        db,
        "起点",
        payload.get("origin_code"),
        payload.get("origin_name"),
        to_optional_float(payload.get("origin_lat")),
        to_optional_float(payload.get("origin_lon")),
    )
    destination = resolve_endpoint(
        db,
        "终点",
        payload.get("destination_code"),
        payload.get("destination_name"),
        to_optional_float(payload.get("destination_lat")),
        to_optional_float(payload.get("destination_lon")),
    )

    category = (payload.get("category") or "货运").strip() or "货运"
    status = (payload.get("status") or "active").strip() or "active"
    created_at = (payload.get("created_at") or "").strip()
    if created_at:
        try:
            datetime.fromisoformat(created_at)
        except ValueError as exc:
            raise ValueError("created_at 必须是 ISO 格式") from exc
    else:
        created_at = utc_now_text()

    cur = db.execute(
        """
        INSERT INTO od_routes(
            user_id,
            origin_code,
            origin_name,
            origin_lat,
            origin_lon,
            destination_code,
            destination_name,
            destination_lat,
            destination_lon,
            category,
            status,
            created_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            user_id,
            origin["code"],
            origin["name"],
            origin["lat"],
            origin["lon"],
            destination["code"],
            destination["name"],
            destination["lat"],
            destination["lon"],
            category,
            status,
            created_at,
        ),
    )

    db.execute(
        """
        UPDATE users
        SET last_active_at = ?
        WHERE id = ?
        """,
        (utc_now_text(), user_id),
    )

    return int(cur.lastrowid)


def route_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result["line_label"] = (
        f"{result.get('origin_code') or result.get('origin_name')} -> "
        f"{result.get('destination_code') or result.get('destination_name')}"
    )
    return result


def user_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    result.pop("password_hash", None)
    result.pop("failed_login_count", None)
    result.pop("lock_until", None)
    result.pop("region", None)
    status_code = normalize_user_status(result.get("status"))
    result["status_code"] = status_code
    result["status"] = user_status_label(status_code)
    result["username"] = result.get("student_no") or ""
    result["must_change_password"] = bool(int(result.get("force_password_change") or 0))
    result["route_count"] = int(result.get("route_count", 0))
    result["is_system_admin"] = False
    return result


def init_db() -> None:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row

    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            role TEXT NOT NULL,
            region TEXT NOT NULL,
            status TEXT NOT NULL,
            avatar_url TEXT,
            focus_topic TEXT,
            user_type TEXT NOT NULL DEFAULT 'student',
            student_no TEXT,
            class_name TEXT,
            password_hash TEXT,
            failed_login_count INTEGER NOT NULL DEFAULT 0,
            lock_until TEXT,
            force_password_change INTEGER NOT NULL DEFAULT 0,
            created_at TEXT,
            last_active_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS nodes (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            region TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS od_routes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            origin_code TEXT,
            origin_name TEXT NOT NULL,
            origin_lat REAL NOT NULL,
            origin_lon REAL NOT NULL,
            destination_code TEXT,
            destination_name TEXT NOT NULL,
            destination_lat REAL NOT NULL,
            destination_lon REAL NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            active INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )

    ensure_user_columns(db)
    ensure_routes_schema(db)
    cleanup_legacy_seed_admin(db)

    db.commit()
    db.close()


def ensure_user_columns(db: sqlite3.Connection) -> None:
    columns = {r["name"] for r in db.execute("PRAGMA table_info(users)").fetchall()}

    if "user_type" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN user_type TEXT NOT NULL DEFAULT 'student'")
    if "student_no" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN student_no TEXT")
    if "class_name" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN class_name TEXT")
    if "password_hash" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
    if "failed_login_count" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0")
    if "lock_until" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN lock_until TEXT")
    if "force_password_change" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0")
    if "created_at" not in columns:
        db.execute("ALTER TABLE users ADD COLUMN created_at TEXT")
        db.execute(
            """
            UPDATE users
            SET created_at = COALESCE(last_active_at, datetime('now'))
            WHERE created_at IS NULL OR created_at = ''
            """
        )
    db.execute(
        """
        UPDATE users
        SET failed_login_count = COALESCE(failed_login_count, 0),
            force_password_change = COALESCE(force_password_change, 0)
        """
    )
    db.execute(
        """
        UPDATE users
        SET status = CASE
            WHEN LOWER(COALESCE(status, '')) IN ('online', '在线') THEN 'online'
            WHEN LOWER(COALESCE(status, '')) IN ('offline', '离线') THEN 'offline'
            ELSE 'offline'
        END
        """
    )
    db.execute(
        """
        UPDATE users
        SET avatar_url = ?
        WHERE avatar_url LIKE 'https://i.pravatar.cc/%'
           OR avatar_url LIKE 'http://i.pravatar.cc/%'
        """,
        (LOCAL_DEFAULT_AVATAR,),
    )


def ensure_routes_schema(db: sqlite3.Connection) -> None:
    columns = [r["name"] for r in db.execute("PRAGMA table_info(od_routes)").fetchall()]
    if not columns:
        return
    if "flow_weight" not in columns:
        return

    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS od_routes_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            origin_code TEXT,
            origin_name TEXT NOT NULL,
            origin_lat REAL NOT NULL,
            origin_lon REAL NOT NULL,
            destination_code TEXT,
            destination_name TEXT NOT NULL,
            destination_lat REAL NOT NULL,
            destination_lon REAL NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );

        INSERT INTO od_routes_new(
            id, user_id, origin_code, origin_name, origin_lat, origin_lon,
            destination_code, destination_name, destination_lat, destination_lon,
            category, status, created_at
        )
        SELECT
            id, user_id, origin_code, origin_name, origin_lat, origin_lon,
            destination_code, destination_name, destination_lat, destination_lon,
            category, status, created_at
        FROM od_routes;

        DROP TABLE od_routes;
        ALTER TABLE od_routes_new RENAME TO od_routes;
        """
    )


def cleanup_legacy_seed_admin(db: sqlite3.Connection) -> None:
    if not system_admin_enabled():
        return
    db.execute(
        """
        DELETE FROM users
        WHERE user_type = 'admin'
          AND name = '系统管理员'
          AND UPPER(COALESCE(student_no, '')) IN ('ADMIN001', 'ADMIN_SYS')
        """
    )


app = create_app()


if __name__ == "__main__":
    host = os.environ.get("WEBGIS_HOST", "0.0.0.0")
    try:
        port = int(os.environ.get("WEBGIS_PORT", "5000"))
    except ValueError:
        port = 5000
    app.run(host=host, port=port, debug=False)
