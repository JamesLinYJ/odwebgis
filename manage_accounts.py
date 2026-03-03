# 【中文注释】
# 文件说明：manage_accounts.py 为项目自研源码文件，包含核心业务逻辑。
# 维护约定：变更前先确认输入输出与调用链，避免影响前后端联调。

import argparse
import getpass
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime, timezone

from werkzeug.security import generate_password_hash


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webgis.db")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
PASSWORD_MIN_LENGTH = 6
PASSWORD_MAX_LENGTH = 64
LOCAL_DEFAULT_AVATAR = "/static/images/avatar-default.svg"
SCHEMA_VERSION = "20260228_v2"


def utc_now_text():
    return datetime.now(timezone.utc).strftime(DATETIME_FMT)


def normalize_user_status(status, default="offline"):
    value = (status or "").strip().lower()
    if not value:
        return default
    if value in {"鍦ㄧ嚎", "online"}:
        return "online"
    if value in {"绂荤嚎", "offline"}:
        return "offline"
    return default


def validate_username(username):
    value = (username or "").strip()
    if not value:
        return "鐢ㄦ埛鍚嶄笉鑳戒负绌?
    if any(ch.isspace() for ch in value):
        return "鐢ㄦ埛鍚嶄笉鑳藉寘鍚┖鏍?
    if len(value) < 3:
        return "鐢ㄦ埛鍚嶈嚦灏?3 浣?
    if len(value) > 24:
        return "鐢ㄦ埛鍚嶉暱搴︿笉鑳借秴杩?24 浣?
    return None


def validate_password(password, username=""):
    value = str(password or "")
    if len(value) < PASSWORD_MIN_LENGTH:
        return f"瀵嗙爜鑷冲皯 {PASSWORD_MIN_LENGTH} 浣?
    if len(value) > PASSWORD_MAX_LENGTH:
        return f"瀵嗙爜闀垮害涓嶈兘瓒呰繃 {PASSWORD_MAX_LENGTH} 浣?
    if any(ch.isspace() for ch in value):
        return "瀵嗙爜涓嶈兘鍖呭惈绌烘牸"
    if not all(33 <= ord(ch) <= 126 for ch in value):
        return "瀵嗙爜浠呮敮鎸佽嫳鏂囥€佹暟瀛楀拰甯歌绗﹀彿锛屼笉鏀寔涓枃鎴栧叏瑙掑瓧绗?
    if username and value.lower() == username.lower():
        return "瀵嗙爜涓嶈兘涓庣敤鎴峰悕鐩稿悓"
    return None


def normalize_password_secret(value):
    text = str(value or "").strip()
    if text.startswith("sha256:"):
        digest = text[7:].strip().lower()
        if len(digest) == 64 and all(ch in "0123456789abcdef" for ch in digest):
            return digest
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def digest_from_sha256(sha256_value):
    text = str(sha256_value or "").strip().lower()
    if text.startswith("sha256:"):
        text = text[7:].strip().lower()
    if len(text) != 64 or any(ch not in "0123456789abcdef" for ch in text):
        raise ValueError("password_sha256 鏍煎紡鏃犳晥锛岄渶瑕?64 浣嶅崄鍏繘鍒?)
    return text


def prompt_password_interactive(label="瀵嗙爜"):
    if not sys.stdin.isatty():
        raise ValueError("缂哄皯瀵嗙爜鍙傛暟锛氳鎻愪緵 --password 鎴?--password-sha256")
    while True:
        first = getpass.getpass(f"{label}: ")
        second = getpass.getpass("纭瀵嗙爜: ")
        if not first:
            print("[WARN] 瀵嗙爜涓嶈兘涓虹┖")
            continue
        if first != second:
            print("[WARN] 涓ゆ杈撳叆涓嶄竴鑷达紝璇烽噸璇?)
            continue
        return first


def resolve_password_digest(plain_password, password_sha256, username="", allow_prompt=True):
    has_plain = plain_password is not None
    has_sha = password_sha256 is not None
    if has_plain and has_sha:
        raise ValueError("鍙兘鎻愪緵 --password 鎴?--password-sha256 鍏朵腑涓€涓?)

    if has_sha:
        return digest_from_sha256(password_sha256)

    if has_plain:
        plain = str(plain_password or "")
    elif allow_prompt:
        plain = prompt_password_interactive("杈撳叆瀵嗙爜")
    else:
        raise ValueError("缂哄皯瀵嗙爜鍙傛暟锛氳鎻愪緵 --password 鎴?--password-sha256")

    err = validate_password(plain, username)
    if err:
        raise ValueError(err)
    return normalize_password_secret(plain)


def rebuild_schema(db):
    db.executescript(
        """
        DROP TABLE IF EXISTS alerts;
        DROP TABLE IF EXISTS od_routes;
        DROP TABLE IF EXISTS nodes;
        DROP TABLE IF EXISTS users;

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            user_type TEXT NOT NULL CHECK(user_type IN ('student', 'admin')),
            status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online', 'offline')),
            avatar_url TEXT NOT NULL DEFAULT '/static/images/avatar-default.svg',
            password_hash TEXT NOT NULL,
            failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK(failed_login_count >= 0),
            lock_until TEXT,
            force_password_change INTEGER NOT NULL DEFAULT 0 CHECK(force_password_change IN (0, 1)),
            created_at TEXT NOT NULL,
            last_active_at TEXT NOT NULL
        );

        CREATE INDEX idx_users_user_type ON users(user_type);
        CREATE INDEX idx_users_status ON users(status);
        CREATE INDEX idx_users_last_active ON users(last_active_at);

        CREATE TABLE nodes (
            code TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            region TEXT NOT NULL,
            lat REAL NOT NULL,
            lon REAL NOT NULL
        );

        CREATE TABLE od_routes (
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
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_routes_user_id ON od_routes(user_id);
        CREATE INDEX idx_routes_category ON od_routes(category);
        CREATE INDEX idx_routes_created_at ON od_routes(created_at);

        CREATE TABLE alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            active INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )


def ensure_schema(db):
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    row = db.execute("SELECT value FROM app_meta WHERE key = 'schema_version'").fetchone()
    current = (row["value"] if row else "").strip()
    if current != SCHEMA_VERSION:
        rebuild_schema(db)
        db.execute(
            """
            INSERT INTO app_meta(key, value)
            VALUES('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (SCHEMA_VERSION,),
        )
        print(f"[INFO] 鏁版嵁搴撶粨鏋勫凡閲嶅缓涓烘柊鐗堬紙schema={SCHEMA_VERSION}锛夛紝鏃ф暟鎹凡涓㈠純銆?)
    db.commit()


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    ensure_schema(db)
    return db


def resolve_user(db, user_id, username):
    if (user_id is None) == (username is None):
        raise ValueError("蹇呴』涓斿彧鑳芥寚瀹?--id 鎴?--username")
    if user_id is not None:
        row = db.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM users WHERE UPPER(COALESCE(username, '')) = UPPER(?)",
            ((username or "").strip(),),
        ).fetchone()
    if row is None:
        raise ValueError("鐩爣璐︽埛涓嶅瓨鍦?)
    return row


def user_row_to_payload(db, row):
    route_count = db.execute("SELECT COUNT(*) AS c FROM od_routes WHERE user_id = ?", (int(row["id"]),)).fetchone()
    return {
        "id": int(row["id"]),
        "name": row["name"] or "",
        "username": row["username"] or "",
        "user_type": row["user_type"] or "student",
        "status": normalize_user_status(row["status"]),
        "force_password_change": int(row["force_password_change"] or 0),
        "failed_login_count": int(row["failed_login_count"] or 0),
        "lock_until": row["lock_until"] or "",
        "created_at": row["created_at"] or "",
        "last_active_at": row["last_active_at"] or "",
        "route_count": int((route_count or {"c": 0})["c"] or 0),
    }


def cmd_list(args):
    db = get_db()
    try:
        sql = [
            """
            SELECT u.id, u.name, u.user_type, u.username, u.status,
                   COALESCE(u.force_password_change, 0) AS force_password_change,
                   COALESCE(u.failed_login_count, 0) AS failed_login_count,
                   u.lock_until, u.created_at, u.last_active_at,
                   COUNT(r.id) AS route_count
            FROM users u
            LEFT JOIN od_routes r ON r.user_id = u.id
            WHERE 1=1
            """
        ]
        params = []
        if args.user_type:
            sql.append("AND u.user_type = ?")
            params.append(args.user_type)
        if args.status:
            sql.append("AND u.status = ?")
            params.append(normalize_user_status(args.status))
        if args.keyword:
            like = f"%{args.keyword}%"
            sql.append("AND (u.name LIKE ? OR COALESCE(u.username, '') LIKE ?)")
            params.extend([like, like])
        sql.append("GROUP BY u.id")
        sql.append("ORDER BY datetime(COALESCE(u.created_at, u.last_active_at)) DESC, u.id DESC")
        if not args.all:
            sql.append("LIMIT ?")
            params.append(max(1, min(int(args.limit), 5000)))

        rows = db.execute("\n".join(sql), params).fetchall()
        payload = []
        for row in rows:
            payload.append(
                {
                    "id": int(row["id"]),
                    "username": row["username"] or "",
                    "name": row["name"] or "",
                    "user_type": row["user_type"] or "student",
                    "status": normalize_user_status(row["status"]),
                    "route_count": int(row["route_count"] or 0),
                    "failed_login_count": int(row["failed_login_count"] or 0),
                    "locked": bool(row["lock_until"]),
                    "must_change_password": bool(int(row["force_password_change"] or 0)),
                    "last_active_at": row["last_active_at"] or "",
                }
            )

        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0

        if not payload:
            print("鏃犺处鎴疯褰?)
            return 0

        header = (
            f"{'ID':<4} {'鐢ㄦ埛鍚?:<24} {'濮撳悕':<12} {'绫诲瀷':<8} {'鐘舵€?:<8} "
            f"{'璺嚎':<6} {'澶辫触娆℃暟':<8} {'閿佸畾':<6} {'闇€鏀瑰瘑':<6} {'鏈€鍚庢椿璺?}"
        )
        print(header)
        print("-" * len(header))
        for item in payload:
            print(
                f"{item['id']:<4} "
                f"{item['username']:<24} "
                f"{item['name']:<12} "
                f"{item['user_type']:<8} "
                f"{item['status']:<8} "
                f"{item['route_count']:<6} "
                f"{item['failed_login_count']:<8} "
                f"{('yes' if item['locked'] else 'no'):<6} "
                f"{('yes' if item['must_change_password'] else 'no'):<6} "
                f"{item['last_active_at']}"
            )
        return 0
    finally:
        db.close()


def cmd_show(args):
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        payload = user_row_to_payload(db, user)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        print(f"ID: {payload['id']}")
        print(f"濮撳悕: {payload['name']}")
        print(f"鐢ㄦ埛鍚? {payload['username']}")
        print(f"绫诲瀷: {payload['user_type']}")
        print(f"鐘舵€? {payload['status']}")
        print(f"璺嚎鏁伴噺: {payload['route_count']}")
        print(f"澶辫触鐧诲綍娆℃暟: {payload['failed_login_count']}")
        print(f"閿佸畾鑷? {payload['lock_until'] or '-'}")
        print(f"涓嬫鐧诲綍寮哄埗鏀瑰瘑: {'鏄? if payload['force_password_change'] else '鍚?}")
        print(f"鍒涘缓鏃堕棿: {payload['created_at'] or '-'}")
        print(f"鏈€鍚庢椿璺? {payload['last_active_at'] or '-'}")
        return 0
    finally:
        db.close()


def cmd_create(args):
    username = (args.username or "").strip()
    name = (args.name or "").strip()
    user_type = (args.user_type or "student").strip().lower()
    status = normalize_user_status(args.status, "offline")

    username_err = validate_username(username)
    if username_err:
        raise ValueError(username_err)
    if not name:
        raise ValueError("濮撳悕涓嶈兘涓虹┖")
    if user_type not in {"student", "admin"}:
        raise ValueError("user_type 浠呮敮鎸?student/admin")

    secret_digest = resolve_password_digest(args.password, args.password_sha256, username=username, allow_prompt=True)

    db = get_db()
    try:
        exists = db.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(username, '')) = UPPER(?)",
            (username,),
        ).fetchone()
        if exists is not None:
            raise ValueError("璇ョ敤鎴峰悕宸插瓨鍦?)

        now = utc_now_text()
        cur = db.execute(
            """
            INSERT INTO users(
                username, name, user_type, status, avatar_url, password_hash,
                failed_login_count, lock_until, force_password_change, created_at, last_active_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                username,
                name,
                user_type,
                status,
                LOCAL_DEFAULT_AVATAR,
                generate_password_hash(secret_digest),
                0,
                None,
                1 if args.force_change else 0,
                now,
                now,
            ),
        )
        db.commit()
        result = {
            "ok": True,
            "id": int(cur.lastrowid),
            "username": username,
            "user_type": user_type,
            "status": status,
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f"鍒涘缓鎴愬姛: id={result['id']}, username={username}, type={user_type}, status={status}")
        return 0
    finally:
        db.close()


def cmd_update(args):
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        updates = []
        params = []

        if args.name is not None:
            value = args.name.strip()
            if not value:
                raise ValueError("濮撳悕涓嶈兘涓虹┖")
            updates.append("name = ?")
            params.append(value)

        if args.username_new is not None:
            username_new = args.username_new.strip()
            username_err = validate_username(username_new)
            if username_err:
                raise ValueError(username_err)
            exists = db.execute(
                "SELECT id FROM users WHERE UPPER(COALESCE(username, '')) = UPPER(?) AND id <> ?",
                (username_new, int(user["id"])),
            ).fetchone()
            if exists is not None:
                raise ValueError("鏂扮敤鎴峰悕宸插瓨鍦?)
            updates.append("username = ?")
            params.append(username_new)

        if args.status is not None:
            updates.append("status = ?")
            params.append(normalize_user_status(args.status, "offline"))

        if args.user_type is not None:
            user_type = args.user_type.strip().lower()
            if user_type not in {"student", "admin"}:
                raise ValueError("user_type 浠呮敮鎸?student/admin")
            updates.append("user_type = ?")
            params.append(user_type)

        if args.force_change is True:
            updates.append("force_password_change = 1")
        elif args.force_change is False:
            updates.append("force_password_change = 0")

        if args.unlock:
            updates.extend(["failed_login_count = 0", "lock_until = NULL"])

        if not updates:
            raise ValueError("娌℃湁鍙洿鏂板瓧娈碉紝璇疯嚦灏戞彁渚涗竴涓洿鏂板弬鏁?)

        updates.append("last_active_at = ?")
        params.append(utc_now_text())
        params.append(int(user["id"]))

        db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()

        updated = db.execute("SELECT * FROM users WHERE id = ?", (int(user["id"]),)).fetchone()
        payload = user_row_to_payload(db, updated)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(f"鏇存柊鎴愬姛: id={payload['id']}, username={payload['username']}, type={payload['user_type']}, status={payload['status']}")
        return 0
    finally:
        db.close()




def cmd_reset_password(args):
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        username = (user["username"] or "").strip()
        secret_digest = resolve_password_digest(args.password, args.password_sha256, username=username, allow_prompt=True)

        if args.force_change is True:
            force_value = 1
        elif args.force_change is False:
            force_value = 0
        else:
            force_value = int(user["force_password_change"] or 0)

        db.execute(
            """
            UPDATE users
            SET password_hash = ?,
                force_password_change = ?,
                failed_login_count = 0,
                lock_until = NULL,
                last_active_at = ?
            WHERE id = ?
            """,
            (
                generate_password_hash(secret_digest),
                force_value,
                utc_now_text(),
                int(user["id"]),
            ),
        )
        db.commit()
        if args.json:
            print(
                json.dumps(
                    {"ok": True, "id": int(user["id"]), "username": username, "force_password_change": force_value},
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            print(f"閲嶇疆瀵嗙爜鎴愬姛: id={int(user['id'])}, username={username}, force_change={force_value}")
        return 0
    finally:
        db.close()


def cmd_unlock(args):
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        db.execute(
            """
            UPDATE users
            SET failed_login_count = 0, lock_until = NULL, last_active_at = ?
            WHERE id = ?
            """,
            (utc_now_text(), int(user["id"])),
        )
        db.commit()
        if args.json:
            print(json.dumps({"ok": True, "id": int(user["id"]), "username": user["username"] or ""}, ensure_ascii=False, indent=2))
        else:
            print(f"瑙ｉ攣鎴愬姛: id={int(user['id'])}, username={user['username'] or ''}")
        return 0
    finally:
        db.close()


def cmd_delete(args):
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        uid = int(user["id"])
        if not args.keep_routes:
            db.execute("DELETE FROM od_routes WHERE user_id = ?", (uid,))
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.commit()
        if args.json:
            print(json.dumps({"ok": True, "deleted_user_id": uid}, ensure_ascii=False, indent=2))
        else:
            extra = "锛堜繚鐣欎簡璺嚎鏁版嵁锛? if args.keep_routes else "锛堝凡鍚屾椂鍒犻櫎璇ョ敤鎴疯矾绾匡級"
            print(f"鍒犻櫎鎴愬姛: id={uid}, username={user['username'] or ''} {extra}")
        return 0
    finally:
        db.close()


def cmd_stats(args):
    db = get_db()
    try:
        total_users = int(db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] or 0)
        total_students = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE user_type='student'").fetchone()["c"] or 0)
        total_admins = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE user_type='admin'").fetchone()["c"] or 0)
        online_users = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE status='online'").fetchone()["c"] or 0)
        locked_users = int(
            db.execute(
                "SELECT COUNT(*) AS c FROM users WHERE lock_until IS NOT NULL AND TRIM(lock_until) <> ''"
            ).fetchone()["c"]
            or 0
        )
        must_change = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE force_password_change = 1").fetchone()["c"] or 0)
        total_routes = int(db.execute("SELECT COUNT(*) AS c FROM od_routes").fetchone()["c"] or 0)

        payload = {
            "total_users": total_users,
            "students": total_students,
            "admins": total_admins,
            "online": online_users,
            "locked": locked_users,
            "must_change_password": must_change,
            "total_routes": total_routes,
        }
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print("璐︽埛缁熻")
            print(f"- 鎬昏处鎴? {total_users}")
            print(f"- 瀛︾敓: {total_students}")
            print(f"- 绠＄悊鍛? {total_admins}")
            print(f"- 鍦ㄧ嚎: {online_users}")
            print(f"- 閿佸畾涓? {locked_users}")
            print(f"- 闇€鏀瑰瘑: {must_change}")
            print(f"- 璺嚎鎬绘暟: {total_routes}")
        return 0
    finally:
        db.close()


def cmd_reset_schema(args):
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        rebuild_schema(db)
        db.execute(
            """
            INSERT INTO app_meta(key, value)
            VALUES('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (SCHEMA_VERSION,),
        )
        db.commit()
        print(f"宸查噸寤烘暟鎹簱缁撴瀯锛坰chema={SCHEMA_VERSION}锛?)
        return 0
    finally:
        db.close()


def add_user_selector_arguments(parser):
    parser.add_argument("--id", type=int, help="璐︽埛 ID")
    parser.add_argument("--username", help="鐢ㄦ埛鍚?)


def build_parser():
    parser = argparse.ArgumentParser(
        description="WebGIS 璐︽埛鍛戒护琛岀鐞嗭紙涓嶄緷璧栫綉椤电櫥褰曪紝鐩存帴绠＄悊鏁版嵁搴擄級"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="鍒楀嚭璐︽埛")
    p_list.add_argument("--user-type", choices=["student", "admin"], help="鎸夌被鍨嬬瓫閫?)
    p_list.add_argument("--status", choices=["online", "offline"], help="鎸夌姸鎬佺瓫閫?)
    p_list.add_argument("--keyword", help="鎸夊鍚?鐢ㄦ埛鍚嶆ā绯婄瓫閫?)
    p_list.add_argument("--limit", type=int, default=200, help="闄愬埗杩斿洖鏁伴噺锛岄粯璁?200")
    p_list.add_argument("--all", action="store_true", help="杩斿洖鍏ㄩ儴锛屼笉鍙?--limit 闄愬埗")
    p_list.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="鏌ョ湅璐︽埛璇︽儏")
    add_user_selector_arguments(p_show)
    p_show.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_show.set_defaults(func=cmd_show)

    p_create = sub.add_parser("create", help="鍒涘缓璐︽埛")
    p_create.add_argument("--name", required=True, help="濮撳悕")
    p_create.add_argument("--username", required=True, help="鐢ㄦ埛鍚?)
    p_create.add_argument("--user-type", choices=["student", "admin"], default="student", help="璐︽埛绫诲瀷")
    p_create.add_argument("--status", choices=["online", "offline"], default="offline", help="鍒濆鐘舵€?)
    p_create.add_argument("--password", help="鏄庢枃瀵嗙爜")
    p_create.add_argument("--password-sha256", help="sha256 鎽樿锛?4浣嶆垨 sha256: 鍓嶇紑锛?)
    p_create.add_argument("--force-change", action="store_true", default=False, help="涓嬫鐧诲綍寮哄埗鏀瑰瘑")
    p_create.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_create.set_defaults(func=cmd_create)

    p_update = sub.add_parser("update", help="鏇存柊璐︽埛璧勬枡")
    add_user_selector_arguments(p_update)
    p_update.add_argument("--name", help="淇敼濮撳悕")
    p_update.add_argument("--username-new", help="淇敼鐢ㄦ埛鍚?)
    p_update.add_argument("--status", choices=["online", "offline"], help="淇敼鐘舵€?)
    p_update.add_argument("--user-type", choices=["student", "admin"], help="淇敼绫诲瀷")
    p_update.add_argument("--force-change", dest="force_change", action="store_true", help="璁剧疆涓嬫鐧诲綍寮哄埗鏀瑰瘑")
    p_update.add_argument("--clear-force-change", dest="force_change", action="store_false", help="鍙栨秷涓嬫鐧诲綍寮哄埗鏀瑰瘑")
    p_update.add_argument("--unlock", action="store_true", help="鍚屾椂瑙ｉ攣璇ヨ处鎴?)
    p_update.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_update.set_defaults(func=cmd_update, force_change=None)



    p_reset = sub.add_parser("reset-password", help="閲嶇疆瀵嗙爜")
    add_user_selector_arguments(p_reset)
    p_reset.add_argument("--password", help="鏄庢枃瀵嗙爜")
    p_reset.add_argument("--password-sha256", help="sha256 鎽樿锛?4浣嶆垨 sha256: 鍓嶇紑锛?)
    p_reset.add_argument("--force-change", dest="force_change", action="store_true", help="涓嬫鐧诲綍寮哄埗鏀瑰瘑")
    p_reset.add_argument("--clear-force-change", dest="force_change", action="store_false", help="鍙栨秷涓嬫鐧诲綍寮哄埗鏀瑰瘑")
    p_reset.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_reset.set_defaults(func=cmd_reset_password, force_change=None)

    p_unlock = sub.add_parser("unlock", help="瑙ｉ攣璐︽埛锛堟竻绌哄け璐ユ鏁板拰閿佸畾鏃堕棿锛?)
    add_user_selector_arguments(p_unlock)
    p_unlock.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_unlock.set_defaults(func=cmd_unlock)

    p_delete = sub.add_parser("delete", help="鍒犻櫎璐︽埛")
    add_user_selector_arguments(p_delete)
    p_delete.add_argument("--keep-routes", action="store_true", help="浠呭垹闄よ处鎴凤紝淇濈暀鍏惰矾绾?)
    p_delete.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_delete.set_defaults(func=cmd_delete)

    p_stats = sub.add_parser("stats", help="璐︽埛缁熻")
    p_stats.add_argument("--json", action="store_true", help="浠?JSON 杈撳嚭")
    p_stats.set_defaults(func=cmd_stats)

    p_schema = sub.add_parser("reset-schema", help="閲嶅缓鏁版嵁搴撶粨鏋勫苟娓呯┖鏃ф暟鎹?)
    p_schema.set_defaults(func=cmd_reset_schema)

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1
    except sqlite3.Error as exc:
        print(f"[DB ERROR] {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

