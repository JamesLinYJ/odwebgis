import argparse
import hashlib
import os
import sqlite3
import sys
from datetime import UTC, datetime

from werkzeug.security import generate_password_hash


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "webgis.db")
DATETIME_FMT = "%Y-%m-%d %H:%M:%S"
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 64
LOCAL_DEFAULT_AVATAR = "/static/images/avatar-default.svg"


def utc_now_text() -> str:
    return datetime.now(UTC).strftime(DATETIME_FMT)


def get_db() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    ensure_schema(db)
    return db


def ensure_schema(db: sqlite3.Connection) -> None:
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
            flow_weight REAL NOT NULL,
            category TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """
    )
    db.commit()


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
        return "密码仅支持英文、数字和常见符号，不支持中文或全角字符"
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


def digest_from_sha256(sha256_value: str) -> str:
    text = str(sha256_value or "").strip().lower()
    if text.startswith("sha256:"):
        text = text[7:].strip().lower()
    if len(text) != 64 or any(ch not in "0123456789abcdef" for ch in text):
        raise ValueError("password_sha256 格式无效，需要 64 位十六进制")
    return text


def resolve_password_digest(plain_password: str | None, password_sha256: str | None, username: str = "") -> str:
    has_plain = plain_password is not None
    has_sha = password_sha256 is not None
    if has_plain == has_sha:
        raise ValueError("必须且只能提供 --password 或 --password-sha256 其中一个")
    if has_sha:
        return digest_from_sha256(password_sha256 or "")
    plain = str(plain_password or "")
    err = validate_password(plain, username)
    if err:
        raise ValueError(err)
    return normalize_password_secret(plain)


def resolve_user(db: sqlite3.Connection, user_id: int | None, username: str | None) -> sqlite3.Row:
    if (user_id is None) == (username is None):
        raise ValueError("必须且只能指定 --id 或 --username")
    if user_id is not None:
        row = db.execute("SELECT * FROM users WHERE id = ?", (int(user_id),)).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM users WHERE UPPER(COALESCE(student_no, '')) = UPPER(?)",
            ((username or "").strip(),),
        ).fetchone()
    if row is None:
        raise ValueError("目标账户不存在")
    return row


def cmd_list(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        sql = "SELECT id, name, user_type, student_no, status, force_password_change, last_active_at FROM users WHERE 1=1"
        params: list[object] = []
        if args.user_type:
            sql += " AND user_type = ?"
            params.append(args.user_type)
        if args.keyword:
            sql += " AND (name LIKE ? OR student_no LIKE ?)"
            like = f"%{args.keyword}%"
            params.extend([like, like])
        sql += " ORDER BY id ASC"
        rows = db.execute(sql, params).fetchall()
        if not rows:
            print("无账户记录")
            return 0

        print("ID  用户名              姓名           类型      状态  需改密  最后活跃")
        print("--  -------------------  ------------  --------  ----  -----  -------------------")
        for r in rows:
            print(
                f"{int(r['id']):<3} "
                f"{(r['student_no'] or '-'): <20}"
                f"{(r['name'] or '-'): <14}"
                f"{(r['user_type'] or '-'): <10}"
                f"{(r['status'] or '-'): <6}"
                f"{int(r['force_password_change'] or 0): <7}"
                f"{(r['last_active_at'] or '-'): <20}"
            )
        return 0
    finally:
        db.close()


def cmd_create(args: argparse.Namespace) -> int:
    username = (args.username or "").strip()
    name = (args.name or "").strip()
    user_type = (args.user_type or "student").strip().lower()

    username_err = validate_username(username)
    if username_err:
        raise ValueError(username_err)
    if not name:
        raise ValueError("姓名不能为空")
    if user_type not in {"student", "admin"}:
        raise ValueError("user_type 仅支持 student/admin")

    secret_digest = resolve_password_digest(args.password, args.password_sha256, username)
    db = get_db()
    try:
        exists = db.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(student_no, '')) = UPPER(?)",
            (username,),
        ).fetchone()
        if exists is not None:
            raise ValueError("该用户名已存在")

        now = utc_now_text()
        if user_type == "admin":
            role = "管理员"
            region = "系统"
            focus_topic = "系统管理"
        else:
            role = "学生"
            region = "未分组"
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
                region,
                "离线",
                LOCAL_DEFAULT_AVATAR,
                focus_topic,
                user_type,
                username,
                "",
                generate_password_hash(secret_digest),
                now,
                now,
                1 if args.force_change else 0,
                0,
                None,
            ),
        )
        db.commit()
        print(f"创建成功：id={int(cur.lastrowid)}, username={username}, type={user_type}")
        return 0
    finally:
        db.close()


def cmd_delete(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        db.execute("DELETE FROM od_routes WHERE user_id = ?", (int(user["id"]),))
        db.execute("DELETE FROM users WHERE id = ?", (int(user["id"]),))
        db.commit()
        print(f"删除成功：id={int(user['id'])}, username={user['student_no']}")
        return 0
    finally:
        db.close()


def cmd_reset_password(args: argparse.Namespace) -> int:
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        secret_digest = resolve_password_digest(args.password, args.password_sha256, user["student_no"] or "")
        db.execute(
            """
            UPDATE users
            SET password_hash = ?, force_password_change = ?, failed_login_count = 0, lock_until = NULL, last_active_at = ?
            WHERE id = ?
            """,
            (
                generate_password_hash(secret_digest),
                1 if args.force_change else 0,
                utc_now_text(),
                int(user["id"]),
            ),
        )
        db.commit()
        print(f"重置密码成功：id={int(user['id'])}, username={user['student_no']}")
        return 0
    finally:
        db.close()


def cmd_set_role(args: argparse.Namespace) -> int:
    user_type = (args.user_type or "").strip().lower()
    if user_type not in {"student", "admin"}:
        raise ValueError("user_type 仅支持 student/admin")
    db = get_db()
    try:
        user = resolve_user(db, args.id, args.username)
        if user_type == "admin":
            role = "管理员"
            region = "系统"
            focus_topic = "系统管理"
        else:
            role = "学生"
            region = "未分组"
            focus_topic = "课堂演示"
        db.execute(
            """
            UPDATE users
            SET user_type = ?, role = ?, region = ?, focus_topic = ?, last_active_at = ?
            WHERE id = ?
            """,
            (user_type, role, region, focus_topic, utc_now_text(), int(user["id"])),
        )
        db.commit()
        print(f"角色更新成功：id={int(user['id'])}, username={user['student_no']}, type={user_type}")
        return 0
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="WebGIS 账户命令行管理（系统后台无需登录网页即可直接管理数据库账户）"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list", help="列出账户")
    p_list.add_argument("--user-type", choices=["student", "admin"], help="按类型筛选")
    p_list.add_argument("--keyword", help="按姓名/用户名模糊筛选")
    p_list.set_defaults(func=cmd_list)

    p_create = sub.add_parser("create", help="创建账户")
    p_create.add_argument("--name", required=True, help="姓名")
    p_create.add_argument("--username", required=True, help="用户名")
    p_create.add_argument("--user-type", choices=["student", "admin"], default="student", help="账户类型")
    p_create.add_argument("--password", help="明文密码")
    p_create.add_argument("--password-sha256", help="sha256 摘要（64位或 sha256: 前缀）")
    p_create.add_argument("--force-change", action="store_true", default=False, help="首次登录强制改密")
    p_create.set_defaults(func=cmd_create)

    p_delete = sub.add_parser("delete", help="删除账户")
    p_delete.add_argument("--id", type=int, help="账户ID")
    p_delete.add_argument("--username", help="用户名")
    p_delete.set_defaults(func=cmd_delete)

    p_reset = sub.add_parser("reset-password", help="重置密码")
    p_reset.add_argument("--id", type=int, help="账户ID")
    p_reset.add_argument("--username", help="用户名")
    p_reset.add_argument("--password", help="明文密码")
    p_reset.add_argument("--password-sha256", help="sha256 摘要（64位或 sha256: 前缀）")
    p_reset.add_argument("--force-change", action="store_true", default=False, help="下次登录强制改密")
    p_reset.set_defaults(func=cmd_reset_password)

    p_role = sub.add_parser("set-role", help="调整账户类型")
    p_role.add_argument("--id", type=int, help="账户ID")
    p_role.add_argument("--username", help="用户名")
    p_role.add_argument("--user-type", choices=["student", "admin"], required=True, help="目标类型")
    p_role.set_defaults(func=cmd_set_role)

    return parser


def main() -> int:
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
