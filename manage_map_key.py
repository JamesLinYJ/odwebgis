# 【中文注释】
# 文件说明：manage_map_key.py 为项目自研源码文件，包含核心业务逻辑。
# 维护约定：变更前先确认输入输出与调用链，避免影响前后端联调。

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
        return "Key 涓嶈兘涓虹┖"
    if len(value) < 16:
        return "Key 闀垮害杩囩煭锛岃妫€鏌ヨ緭鍏?
    if any(ch.isspace() for ch in value):
        return "Key 涓嶈兘鍖呭惈绌虹櫧瀛楃"
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
        print(f"[ENV] {ENV_KEY} 宸查厤缃紝闀垮害 {len(env_key)}")
    else:
        print(f"[ENV] {ENV_KEY} 鏈厤缃?)
    if file_key:
        print(f"[FILE] {KEY_FILE} 宸查厤缃紝闀垮害 {len(file_key)}")
    else:
        print(f"[FILE] {KEY_FILE} 鏈厤缃?)
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    key = args.key
    if args.stdin:
        key = sys.stdin.read()
    if key is None:
        key = input("璇疯緭鍏ュぉ鍦板浘 API Key: ")
    key = normalize_key(key)
    err = validate_key(key)
    if err:
        print(f"[ERROR] {err}")
        return 1

    write_file_key(key)
    print(f"[OK] 宸插啓鍏?{KEY_FILE}")
    print(f"[TIP] 鍚姩鏈嶅姟鍚庡皢鑷姩浣跨敤璇?Key锛堝墠绔笉浼氭毚闇诧級銆?)
    return 0


def cmd_clear(_: argparse.Namespace) -> int:
    try:
        os.remove(KEY_FILE)
        print(f"[OK] 宸插垹闄?{KEY_FILE}")
    except FileNotFoundError:
        print(f"[INFO] {KEY_FILE} 涓嶅瓨鍦紝鏃犻渶娓呯悊")
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
                return True, "涓婃父杩斿洖 200"
            return False, f"涓婃父杩斿洖 {int(resp.status)}"
    except urllib.error.HTTPError as exc:
        return False, f"涓婃父杩斿洖 {exc.code}"
    except Exception as exc:
        return False, f"缃戠粶寮傚父: {exc}"


def cmd_check(args: argparse.Namespace) -> int:
    key = normalize_key(args.key or os.environ.get(ENV_KEY, "") or read_file_key())
    err = validate_key(key)
    if err:
        print(f"[ERROR] {err}")
        return 1
    ok, msg = probe_key(key)
    if ok:
        print(f"[OK] Key 鍙敤锛歿msg}")
        return 0
    print(f"[ERROR] Key 涓嶅彲鐢細{msg}")
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebGIS 澶╁湴鍥?API Key 鍛戒护琛岀鐞嗗伐鍏?)
    sub = parser.add_subparsers(dest="command", required=True)

    p_show = sub.add_parser("show", help="鏄剧ず褰撳墠 Key 閰嶇疆鐘舵€?)
    p_show.set_defaults(func=cmd_show)

    p_set = sub.add_parser("set", help="璁剧疆/瑕嗙洊鏈湴 .tianditu_key")
    p_set.add_argument("--key", help="鐩存帴浼犲叆 Key")
    p_set.add_argument("--stdin", action="store_true", help="浠庢爣鍑嗚緭鍏ヨ鍙?Key")
    p_set.set_defaults(func=cmd_set)

    p_clear = sub.add_parser("clear", help="鍒犻櫎鏈湴 .tianditu_key")
    p_clear.set_defaults(func=cmd_clear)

    p_check = sub.add_parser("check", help="妫€娴?Key 鏄惁鍙闂ぉ鍦板浘")
    p_check.add_argument("--key", help="寰呮娴?Key锛堜笉浼犲垯鎸?ENV -> FILE 椤哄簭鏌ユ壘锛?)
    p_check.set_defaults(func=cmd_check)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

