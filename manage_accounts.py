import argparse
import getpass
import hashlib
import json
import os
import sqlite3
import sys
from datetime import datetime

from werkzeug.security import generate_password_hash


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webgis.db")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64
LOCAL_DEFAULT_AVATAR = "/static/images/avatar-default.svg"
SCHEMA_VERSION = "20260228_v2"


def utc_now_text():
    return datetime.utcnow().strftime(DATETIME_FMT)


def normalize_user_status(status, default="offline"):
    value = (status or "").strip().lower()
    if not value:
        return default
    if value in {"在线", "online"}:
        return "online"
    if value in {"离线", "offline"}:
        return "offline"
    return default


def validate_username(username):
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


def validate_password(password, username=""):
    value = str(password or "")
    if len(value) < PASSWORD_MIN_LENGTH:
        return f"密码至少 {PASSWORD_MIN_LENGTH} 位"
    if len(value) > PASSWORD_MAX_LENGTH:
        return f"密码长度不能超过 {PASSWORD_MAX_LENGTH} 位"
    if any(ch.isspace() for ch in value):
        return "密码不能包含空格"
    if not all(33 <= ord(ch) <= 126 for ch in value):
        return "密码仅支持英文、数字和常见符号，不支持中文或全角字符"
    if username and value.lower() == username.lower():
        return "密码不能与用户名相同"
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
        raise ValueError("password_sha256 格式无效，需要 64 位十六进制")
    return text


def prompt_password_interactive(label="密码"):
    if not sys.stdin.isatty():
        raise ValueError("缺少密码参数：请提供 --password 或 --password-sha256")
    while True:
        first = getpass.getpass(f"{label}: ")
        second = getpass.getpass("确认密码: ")
        if not first:
            print("[WARN] 密码不能为空")
            continue
        if first != second:
            print("[WARN] 两次输入不一致，请重试")
            continue
        return first


def resolve_password_digest(plain_password, password_sha256, username="", allow_prompt=True):
    has_plain = plain_password is not None
    has_sha = password_sha256 is not None
    if has_plain and has_sha:
        raise ValueError("只能提供 --password 或 --password-sha256 其中一个")

    if has_sha:
        return digest_from_sha256(password_sha256)

    if has_plain:
        plain = str(plain_password or "")
    elif allow_prompt:
        plain = prompt_password_interactive("输入密码")
    else:
        raise ValueError("缺少密码参数：请提供 --password 或 --password-sha256")

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
        print(f"[INFO] 数据库结构已重建为新版（schema={SCHEMA_VERSION}），旧数据已丢弃。")
    db.commit()


def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    ensure_schema(db)
    return db


def resolve_user(db, user_id, username):
    if (user_id is None) == (username is None):
        raise ValueError("必须且只能指定 --id 或 --username")
    if user_id is not None:
        row = db.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM users WHERE UPPER(COALESCE(username, '')) = UPPER(?)",
            ((username or "").strip(),),
        ).fetchone()
    if row is None:
        raise ValueError("目标账户不存在")
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
            print("无账户记录")
            return 0

        header = (
            f"{'ID':<4} {'用户名':<24} {'姓名':<12} {'类型':<8} {'状态':<8} "
            f"{'路线':<6} {'失败次数':<8} {'锁定':<6} {'需改密':<6} {'最后活跃'}"
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
        print(f"姓名: {payload['name']}")
        print(f"用户名: {payload['username']}")
        print(f"类型: {payload['user_type']}")
        print(f"状态: {payload['status']}")
        print(f"路线数量: {payload['route_count']}")
        print(f"失败登录次数: {payload['failed_login_count']}")
        print(f"锁定至: {payload['lock_until'] or '-'}")
        print(f"下次登录强制改密: {'是' if payload['force_password_change'] else '否'}")
        print(f"创建时间: {payload['created_at'] or '-'}")
        print(f"最后活跃: {payload['last_active_at'] or '-'}")
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
        raise ValueError("姓名不能为空")
    if user_type not in {"student", "admin"}:
        raise ValueError("user_type 仅支持 student/admin")

    secret_digest = resolve_password_digest(args.password, args.password_sha256, username=username, allow_prompt=True)

    db = get_db()
    try:
        exists = db.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(username, '')) = UPPER(?)",
            (username,),
        ).fetchone()
        if exists is not None:
            raise ValueError("该用户名已存在")

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
            print(f"创建成功: id={result['id']}, username={username}, type={user_type}, status={status}")
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
                raise ValueError("姓名不能为空")
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
                raise ValueError("新用户名已存在")
            updates.append("username = ?")
            params.append(username_new)

        if args.status is not None:
            updates.append("status = ?")
            params.append(normalize_user_status(args.status, "offline"))

        if args.user_type is not None:
            user_type = args.user_type.strip().lower()
            if user_type not in {"student", "admin"}:
                raise ValueError("user_type 仅支持 student/admin")
            updates.append("user_type = ?")
            params.append(user_type)

        if args.force_change is True:
            updates.append("force_password_change = 1")
        elif args.force_change is False:
            updates.append("force_password_change = 0")

        if args.unlock:
            updates.extend(["failed_login_count = 0", "lock_until = NULL"])

        if not updates:
            raise ValueError("没有可更新字段，请至少提供一个更新参数")

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
            print(f"更新成功: id={payload['id']}, username={payload['username']}, type={payload['user_type']}, status={payload['status']}")
        return 0
    finally:
        db.close()


def cmd_set_role(args):
    ns = argparse.Namespace(
        id=args.id,
        username=args.username,
        name=None,
        username_new=None,
        status=None,
        user_type=args.user_type,
        force_change=None,
        unlock=False,
        json=args.json,
    )
    return cmd_update(ns)


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
            print(f"重置密码成功: id={int(user['id'])}, username={username}, force_change={force_value}")
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
            print(f"解锁成功: id={int(user['id'])}, username={user['username'] or ''}")
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
            extra = "（保留了路线数据）" if args.keep_routes else "（已同时删除该用户路线）"
            print(f"删除成功: id={uid}, username={user['username'] or ''} {extra}")
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
            print("账户统计")
            print(f"- 总账户: {total_users}")
            print(f"- 学生: {total_students}")
            print(f"- 管理员: {total_admins}")
            print(f"- 在线: {online_users}")
            print(f"- 锁定中: {locked_users}")
            print(f"- 需改密: {must_change}")
            print(f"- 路线总数: {total_routes}")
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
        print(f"已重建数据库结构（schema={SCHEMA_VERSION}）")
        return 0
    finally:
        db.close()


def add_user_selector_arguments(parser):
    parser.add_argument("--id", type=int, help="账户 ID")
    parser.add_argument("--username", help="用户名")


def build_parser():
    parser = argparse.ArgumentParser(
        description="WebGIS 账户命令行管理（不依赖网页登录，直接管理数据库）"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="列出账户")
    p_list.add_argument("--user-type", choices=["student", "admin"], help="按类型筛选")
    p_list.add_argument("--status", choices=["online", "offline"], help="按状态筛选")
    p_list.add_argument("--keyword", help="按姓名/用户名模糊筛选")
    p_list.add_argument("--limit", type=int, default=200, help="限制返回数量，默认 200")
    p_list.add_argument("--all", action="store_true", help="返回全部，不受 --limit 限制")
    p_list.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="查看账户详情")
    add_user_selector_arguments(p_show)
    p_show.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_show.set_defaults(func=cmd_show)

    p_create = sub.add_parser("create", help="创建账户")
    p_create.add_argument("--name", required=True, help="姓名")
    p_create.add_argument("--username", required=True, help="用户名")
    p_create.add_argument("--user-type", choices=["student", "admin"], default="student", help="账户类型")
    p_create.add_argument("--status", choices=["online", "offline"], default="offline", help="初始状态")
    p_create.add_argument("--password", help="明文密码")
    p_create.add_argument("--password-sha256", help="sha256 摘要（64位或 sha256: 前缀）")
    p_create.add_argument("--force-change", action="store_true", default=False, help="下次登录强制改密")
    p_create.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_create.set_defaults(func=cmd_create)

    p_update = sub.add_parser("update", help="更新账户资料")
    add_user_selector_arguments(p_update)
    p_update.add_argument("--name", help="修改姓名")
    p_update.add_argument("--username-new", help="修改用户名")
    p_update.add_argument("--status", choices=["online", "offline"], help="修改状态")
    p_update.add_argument("--user-type", choices=["student", "admin"], help="修改类型")
    p_update.add_argument("--force-change", dest="force_change", action="store_true", help="设置下次登录强制改密")
    p_update.add_argument("--clear-force-change", dest="force_change", action="store_false", help="取消下次登录强制改密")
    p_update.add_argument("--unlock", action="store_true", help="同时解锁该账户")
    p_update.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_update.set_defaults(func=cmd_update, force_change=None)

    p_role = sub.add_parser("set-role", help="调整账户类型（兼容旧命令）")
    add_user_selector_arguments(p_role)
    p_role.add_argument("--user-type", choices=["student", "admin"], required=True, help="目标类型")
    p_role.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_role.set_defaults(func=cmd_set_role)

    p_reset = sub.add_parser("reset-password", help="重置密码")
    add_user_selector_arguments(p_reset)
    p_reset.add_argument("--password", help="明文密码")
    p_reset.add_argument("--password-sha256", help="sha256 摘要（64位或 sha256: 前缀）")
    p_reset.add_argument("--force-change", dest="force_change", action="store_true", help="下次登录强制改密")
    p_reset.add_argument("--clear-force-change", dest="force_change", action="store_false", help="取消下次登录强制改密")
    p_reset.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_reset.set_defaults(func=cmd_reset_password, force_change=None)

    p_unlock = sub.add_parser("unlock", help="解锁账户（清空失败次数和锁定时间）")
    add_user_selector_arguments(p_unlock)
    p_unlock.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_unlock.set_defaults(func=cmd_unlock)

    p_delete = sub.add_parser("delete", help="删除账户")
    add_user_selector_arguments(p_delete)
    p_delete.add_argument("--keep-routes", action="store_true", help="仅删除账户，保留其路线")
    p_delete.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_delete.set_defaults(func=cmd_delete)

    p_stats = sub.add_parser("stats", help="账户统计")
    p_stats.add_argument("--json", action="store_true", help="以 JSON 输出")
    p_stats.set_defaults(func=cmd_stats)

    p_schema = sub.add_parser("reset-schema", help="重建数据库结构并清空旧数据")
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
