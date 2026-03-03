#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""WebGIS account management CLI."""

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
SCHEMA_VERSION = "20260303_v3"


def utc_now_text() -> str:
    return datetime.now(timezone.utc).strftime(DATETIME_FMT)


def normalize_user_status(status: str | None, default: str = "offline") -> str:
    value = (status or "").strip().lower()
    if not value:
        return default
    if value in {"在线", "online"}:
        return "online"
    if value in {"离线", "offline"}:
        return "offline"
    return default


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


def validate_password(password: str, username: str = "") -> str | None:
    value = str(password or "")
    if len(value) < PASSWORD_MIN_LENGTH:
        return f"密码至少 {PASSWORD_MIN_LENGTH} 位"
    if len(value) > PASSWORD_MAX_LENGTH:
        return f"密码长度不能超过 {PASSWORD_MAX_LENGTH} 位"
    if any(ch.isspace() for ch in value):
        return "密码不能包含空格"
    if not all(33 <= ord(ch) <= 126 for ch in value):
        return "密码仅支持英文、数字和常见符号"
    if username and value.lower() == username.lower():
        return "密码不能与用户名相同"
    return None


def normalize_password_secret(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("sha256:"):
        digest = text[7:].strip().lower()
        if len(digest) == 64 and all(ch in "0123456789abcdef" for ch in digest):
            return digest
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def digest_from_sha256(password_sha256: str) -> str:
    text = str(password_sha256 or "").strip().lower()
    if text.startswith("sha256:"):
        text = text[7:].strip().lower()
    if len(text) != 64 or any(ch not in "0123456789abcdef" for ch in text):
        raise ValueError("password_sha256 格式无效，需要 64 位十六进制")
    return text


def resolve_password_digest(
    plain_password: str | None,
    password_sha256: str | None,
    username: str = "",
    *,
    allow_prompt: bool = True,
) -> str:
    has_plain = plain_password is not None
    has_sha = password_sha256 is not None
    if has_plain and has_sha:
        raise ValueError("只能提供 --password 或 --password-sha256 其中一个")

    if has_sha:
        return digest_from_sha256(password_sha256 or "")

    if has_plain:
        plain = str(plain_password or "")
    elif allow_prompt:
        if not sys.stdin.isatty():
            raise ValueError("缺少密码参数：请提供 --password 或 --password-sha256")
        while True:
            first = getpass.getpass("输入密码: ")
            second = getpass.getpass("确认密码: ")
            if not first:
                print("[WARN] 密码不能为空")
                continue
            if first != second:
                print("[WARN] 两次输入不一致，请重试")
                continue
            plain = first
            break
    else:
        raise ValueError("缺少密码参数：请提供 --password 或 --password-sha256")

    err = validate_password(plain, username)
    if err:
        raise ValueError(err)
    return normalize_password_secret(plain)


def rebuild_schema(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        DROP TABLE IF EXISTS alerts;
        DROP TABLE IF EXISTS od_routes;
        DROP TABLE IF EXISTS nodes;
        DROP TABLE IF EXISTS user_login_history;
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
            register_ip TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            last_active_at TEXT NOT NULL
        );

        CREATE INDEX idx_users_user_type ON users(user_type);
        CREATE INDEX idx_users_status ON users(status);
        CREATE INDEX idx_users_last_active ON users(last_active_at);
        CREATE INDEX idx_users_register_ip ON users(register_ip);

        CREATE TABLE user_login_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ip_address TEXT NOT NULL,
            login_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_login_history_user_time ON user_login_history(user_id, login_at DESC, id DESC);

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


def ensure_schema(db: sqlite3.Connection) -> None:
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


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    ensure_schema(db)
    return db


def resolve_user(db: sqlite3.Connection, user_id: int | None, username: str | None) -> sqlite3.Row:
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


def row_payload(db: sqlite3.Connection, row: sqlite3.Row) -> dict:
    route_count_row = db.execute("SELECT COUNT(*) AS c FROM od_routes WHERE user_id = ?", (int(row["id"]),)).fetchone()
    route_count = int((route_count_row or {"c": 0})["c"] or 0)
    return {
        "id": int(row["id"]),
        "name": row["name"] or "",
        "username": row["username"] or "",
        "user_type": row["user_type"] or "student",
        "status": normalize_user_status(row["status"]),
        "avatar_url": row["avatar_url"] or LOCAL_DEFAULT_AVATAR,
        "failed_login_count": int(row["failed_login_count"] or 0),
        "lock_until": row["lock_until"] or "",
        "force_password_change": int(row["force_password_change"] or 0),
        "register_ip": row["register_ip"] or "",
        "created_at": row["created_at"] or "",
        "last_active_at": row["last_active_at"] or "",
        "route_count": route_count,
    }


def cmd_list(args: argparse.Namespace) -> int:
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
        params: list = []
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
        payload = [dict(r) for r in rows]

        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        if not payload:
            print("无账户记录")
            return 0
        header = f"{'ID':<4} {'用户名':<24} {'姓名':<12} {'类型':<8} {'状态':<8} {'路线':<6} {'失败次数':<8} {'锁定':<6} {'需改密':<6}"
        print(header)
        print("-" * len(header))
        for r in payload:
            print(
                f"{int(r['id']):<4} {str(r.get('username') or ''):<24} {str(r.get('name') or ''):<12} "
                f"{str(r.get('user_type') or 'student'):<8} {normalize_user_status(r.get('status')):<8} "
                f"{int(r.get('route_count') or 0):<6} {int(r.get('failed_login_count') or 0):<8} "
                f"{('yes' if r.get('lock_until') else 'no'):<6} {('yes' if int(r.get('force_password_change') or 0) else 'no'):<6}"
            )
        return 0
    finally:
        db.close()


def cmd_show(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        payload = row_payload(db, user)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        for k, v in payload.items():
            print(f"{k}: {v}")
        return 0
    finally:
        db.close()


def cmd_create(args: argparse.Namespace) -> int:
    name = (args.name or "").strip()
    username = (args.username or "").strip()
    if not name:
        print("[ERROR] 姓名不能为空")
        return 1
    user_err = validate_username(username)
    if user_err:
        print(f"[ERROR] {user_err}")
        return 1

    try:
        digest = resolve_password_digest(args.password, args.password_sha256, username=username, allow_prompt=True)
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1
    password_hash = generate_password_hash(digest)
    now_text = utc_now_text()
    user_type = args.user_type
    status = normalize_user_status(args.status, default="offline")
    force_password_change = 1 if args.force_change else 0

    db = get_db()
    try:
        db.execute(
            """
            INSERT INTO users(
                name, user_type, status, avatar_url, username, password_hash,
                failed_login_count, lock_until, force_password_change, register_ip, created_at, last_active_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                name,
                user_type,
                status,
                args.avatar_url or LOCAL_DEFAULT_AVATAR,
                username,
                password_hash,
                0,
                None,
                force_password_change,
                (args.register_ip or "").strip()[:128],
                now_text,
                now_text,
            ),
        )
        db.commit()
        print(f"[OK] 账户已创建：{username}")
        return 0
    except sqlite3.IntegrityError:
        print("[ERROR] 用户名已存在")
        return 1
    finally:
        db.close()


def cmd_update(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        updates: list[str] = []
        params: list = []

        if args.name is not None:
            name = args.name.strip()
            if not name:
                raise ValueError("姓名不能为空")
            updates.append("name = ?")
            params.append(name)

        if args.status is not None:
            updates.append("status = ?")
            params.append(normalize_user_status(args.status))

        if args.user_type is not None:
            updates.append("user_type = ?")
            params.append(args.user_type)

        if args.avatar_url is not None:
            updates.append("avatar_url = ?")
            params.append((args.avatar_url or "").strip() or LOCAL_DEFAULT_AVATAR)

        if args.force_change:
            updates.append("force_password_change = 1")
        if args.clear_force_change:
            updates.append("force_password_change = 0")
        if args.unlock:
            updates.extend(["failed_login_count = 0", "lock_until = NULL"])

        if not updates:
            raise ValueError("没有可更新字段")

        updates.append("last_active_at = ?")
        params.append(utc_now_text())
        params.append(int(user["id"]))
        db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
        db.commit()
        print(f"[OK] 账户已更新：{user['username']}")
        return 0
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1
    finally:
        db.close()


def cmd_set_role(args: argparse.Namespace) -> int:
    args.user_type = args.user_type
    return cmd_update(args)


def cmd_reset_password(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        username = str(user["username"] or "")
        try:
            digest = resolve_password_digest(args.password, args.password_sha256, username=username, allow_prompt=True)
        except ValueError as exc:
            print(f"[ERROR] {exc}")
            return 1

        force_value = 1 if args.force_change else int(user["force_password_change"] or 0)
        db.execute(
            """
            UPDATE users
            SET password_hash = ?, force_password_change = ?, failed_login_count = 0,
                lock_until = NULL, last_active_at = ?
            WHERE id = ?
            """,
            (
                generate_password_hash(digest),
                force_value,
                utc_now_text(),
                int(user["id"]),
            ),
        )
        db.commit()
        print(f"[OK] 密码已重置：{username}")
        return 0
    finally:
        db.close()


def cmd_unlock(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        db.execute(
            "UPDATE users SET failed_login_count = 0, lock_until = NULL, last_active_at = ? WHERE id = ?",
            (utc_now_text(), int(user["id"])),
        )
        db.commit()
        print(f"[OK] 已解锁账户：{user['username']}")
        return 0
    finally:
        db.close()


def cmd_delete(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        if not args.yes:
            ans = input(f"确认删除账户 {user['username']} 及其路线？[y/N]: ").strip().lower()
            if ans not in {"y", "yes"}:
                print("[INFO] 已取消")
                return 0
        uid = int(user["id"])
        db.execute("DELETE FROM od_routes WHERE user_id = ?", (uid,))
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
        db.commit()
        print(f"[OK] 账户已删除：{user['username']}")
        return 0
    finally:
        db.close()


def cmd_stats(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        total_users = int(db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] or 0)
        total_admin = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE user_type='admin'").fetchone()["c"] or 0)
        total_students = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE user_type='student'").fetchone()["c"] or 0)
        total_online = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE status='online'").fetchone()["c"] or 0)
        total_locked = int(
            db.execute("SELECT COUNT(*) AS c FROM users WHERE lock_until IS NOT NULL AND TRIM(lock_until) <> ''").fetchone()["c"]
            or 0
        )
        must_change = int(db.execute("SELECT COUNT(*) AS c FROM users WHERE force_password_change = 1").fetchone()["c"] or 0)
        total_routes = int(db.execute("SELECT COUNT(*) AS c FROM od_routes").fetchone()["c"] or 0)
        payload = {
            "total_users": total_users,
            "admin_users": total_admin,
            "student_users": total_students,
            "online_users": total_online,
            "locked_users": total_locked,
            "must_change_password_users": must_change,
            "total_routes": total_routes,
        }
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 0
        for k, v in payload.items():
            print(f"{k}: {v}")
        return 0
    finally:
        db.close()


def cmd_reset_schema(args: argparse.Namespace) -> int:
    if not args.yes:
        if not sys.stdin.isatty():
            print("[ERROR] reset-schema 需要 --yes（非交互环境）")
            return 1
        ans = input("将清空旧数据并重建数据库结构，确认继续？[y/N]: ").strip().lower()
        if ans not in {"y", "yes"}:
            print("[INFO] 已取消")
            return 0
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
        print(f"[OK] 已重建数据库结构（schema={SCHEMA_VERSION}）")
        return 0
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebGIS 账户管理工具")
    sub = parser.add_subparsers(dest="command")

    p_list = sub.add_parser("list", help="列出账户")
    p_list.add_argument("--user-type", choices=["student", "admin"])
    p_list.add_argument("--status")
    p_list.add_argument("--keyword")
    p_list.add_argument("--limit", type=int, default=100)
    p_list.add_argument("--all", action="store_true")
    p_list.add_argument("--json", action="store_true")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser("show", help="查看账户详情")
    p_show.add_argument("--id", type=int)
    p_show.add_argument("--username")
    p_show.add_argument("--json", action="store_true")
    p_show.set_defaults(func=cmd_show)

    p_create = sub.add_parser("create", help="创建账户")
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--username", required=True)
    p_create.add_argument("--user-type", choices=["student", "admin"], default="student")
    p_create.add_argument("--status", default="offline")
    p_create.add_argument("--avatar-url", default=LOCAL_DEFAULT_AVATAR)
    p_create.add_argument("--password")
    p_create.add_argument("--password-sha256")
    p_create.add_argument("--register-ip", default="")
    p_create.add_argument("--force-change", action="store_true")
    p_create.set_defaults(func=cmd_create)

    p_update = sub.add_parser("update", help="更新账户字段")
    p_update.add_argument("--id", type=int)
    p_update.add_argument("--username")
    p_update.add_argument("--name")
    p_update.add_argument("--status")
    p_update.add_argument("--user-type", choices=["student", "admin"])
    p_update.add_argument("--avatar-url")
    p_update.add_argument("--force-change", action="store_true")
    p_update.add_argument("--clear-force-change", action="store_true")
    p_update.add_argument("--unlock", action="store_true")
    p_update.set_defaults(func=cmd_update)

    p_role = sub.add_parser("set-role", help="设置账户角色")
    p_role.add_argument("--id", type=int)
    p_role.add_argument("--username")
    p_role.add_argument("--user-type", choices=["student", "admin"], required=True)
    p_role.set_defaults(func=cmd_set_role)

    p_reset = sub.add_parser("reset-password", help="重置密码")
    p_reset.add_argument("--id", type=int)
    p_reset.add_argument("--username")
    p_reset.add_argument("--password")
    p_reset.add_argument("--password-sha256")
    p_reset.add_argument("--force-change", action="store_true")
    p_reset.set_defaults(func=cmd_reset_password)

    p_unlock = sub.add_parser("unlock", help="解锁账户")
    p_unlock.add_argument("--id", type=int)
    p_unlock.add_argument("--username")
    p_unlock.set_defaults(func=cmd_unlock)

    p_delete = sub.add_parser("delete", help="删除账户")
    p_delete.add_argument("--id", type=int)
    p_delete.add_argument("--username")
    p_delete.add_argument("--yes", action="store_true")
    p_delete.set_defaults(func=cmd_delete)

    p_stats = sub.add_parser("stats", help="统计账户与路线数量")
    p_stats.add_argument("--json", action="store_true")
    p_stats.set_defaults(func=cmd_stats)

    p_schema = sub.add_parser("reset-schema", help="重建数据库结构（会清空旧数据）")
    p_schema.add_argument("--yes", action="store_true")
    p_schema.set_defaults(func=cmd_reset_schema)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    try:
        return int(args.func(args))
    except ValueError as exc:
        print(f"[ERROR] {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
