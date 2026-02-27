import argparse
import os
import sys
import urllib.error
import urllib.request


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEY_FILE = os.path.join(BASE_DIR, ".tianditu_key")
ENV_KEY = "TIANDITU_API_KEY"


def normalize_key(raw: str) -> str:
    text = (raw or "").strip().lstrip("\ufeff")
    return text


def validate_key(key: str) -> str | None:
    value = normalize_key(key)
    if not value:
        return "Key 不能为空"
    if len(value) < 16:
        return "Key 长度过短，请检查输入"
    if any(ch.isspace() for ch in value):
        return "Key 不能包含空白字符"
    return None


def read_file_key() -> str:
    try:
        with open(KEY_FILE, "r", encoding="ascii") as fp:
            return normalize_key(fp.readline())
    except OSError:
        return ""


def write_file_key(key: str) -> None:
    with open(KEY_FILE, "w", encoding="ascii", newline="\n") as fp:
        fp.write(normalize_key(key))
        fp.write("\n")


def cmd_show(_: argparse.Namespace) -> int:
    env_key = normalize_key(os.environ.get(ENV_KEY, ""))
    file_key = read_file_key()
    if env_key:
        print(f"[ENV] {ENV_KEY} 已配置，长度 {len(env_key)}")
    else:
        print(f"[ENV] {ENV_KEY} 未配置")
    if file_key:
        print(f"[FILE] {KEY_FILE} 已配置，长度 {len(file_key)}")
    else:
        print(f"[FILE] {KEY_FILE} 未配置")
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    key = args.key
    if args.stdin:
        key = sys.stdin.read()
    if key is None:
        key = input("请输入天地图 API Key: ")
    key = normalize_key(key)
    err = validate_key(key)
    if err:
        print(f"[ERROR] {err}")
        return 1

    write_file_key(key)
    print(f"[OK] 已写入 {KEY_FILE}")
    print(f"[TIP] 启动服务后将自动使用该 Key（前端不会暴露）。")
    return 0


def cmd_clear(_: argparse.Namespace) -> int:
    try:
        os.remove(KEY_FILE)
        print(f"[OK] 已删除 {KEY_FILE}")
    except FileNotFoundError:
        print(f"[INFO] {KEY_FILE} 不存在，无需清理")
    return 0


def probe_key(key: str) -> tuple[bool, str]:
    url = (
        "https://t0.tianditu.gov.cn/vec_w/wmts"
        "?service=wmts&request=GetTile&version=1.0.0"
        "&layer=vec&style=default&tilematrixset=w&format=tiles"
        f"&tilematrix=5&tilerow=12&tilecol=26&tk={key}"
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "image/*,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            if int(resp.status) == 200:
                return True, "上游返回 200"
            return False, f"上游返回 {int(resp.status)}"
    except urllib.error.HTTPError as exc:
        return False, f"上游返回 {exc.code}"
    except Exception as exc:
        return False, f"网络异常: {exc}"


def cmd_check(args: argparse.Namespace) -> int:
    key = normalize_key(args.key or os.environ.get(ENV_KEY, "") or read_file_key())
    err = validate_key(key)
    if err:
        print(f"[ERROR] {err}")
        return 1
    ok, msg = probe_key(key)
    if ok:
        print(f"[OK] Key 可用：{msg}")
        return 0
    print(f"[ERROR] Key 不可用：{msg}")
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebGIS 天地图 API Key 命令行管理工具")
    sub = parser.add_subparsers(dest="command", required=True)

    p_show = sub.add_parser("show", help="显示当前 Key 配置状态")
    p_show.set_defaults(func=cmd_show)

    p_set = sub.add_parser("set", help="设置/覆盖本地 .tianditu_key")
    p_set.add_argument("--key", help="直接传入 Key")
    p_set.add_argument("--stdin", action="store_true", help="从标准输入读取 Key")
    p_set.set_defaults(func=cmd_set)

    p_clear = sub.add_parser("clear", help="删除本地 .tianditu_key")
    p_clear.set_defaults(func=cmd_clear)

    p_check = sub.add_parser("check", help="检测 Key 是否可访问天地图")
    p_check.add_argument("--key", help="待检测 Key（不传则按 ENV -> FILE 顺序查找）")
    p_check.set_defaults(func=cmd_check)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
