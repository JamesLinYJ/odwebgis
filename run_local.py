import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


BASE_URL = "http://127.0.0.1:5000"
CHECK_PATHS = [
    ("/auth", {200}),
    ("/", {200, 302}),
    ("/admin", {200, 302}),
    ("/admin/accounts", {200, 302}),
    ("/account", {200, 302}),
    ("/api/auth/me", {200, 401}),
    ("/api/admin/overview", {200, 401, 403}),
]


def http_status(path: str, timeout: float = 3.0) -> int | None:
    try:
        with urllib.request.urlopen(BASE_URL + path, timeout=timeout) as resp:
            return int(resp.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:
        return None


def http_ok(path: str, timeout: float = 3.0) -> bool:
    return http_status(path, timeout=timeout) == 200


def wait_ready(retries: int = 30, delay: float = 0.5) -> bool:
    for _ in range(retries):
        if http_ok("/"):
            return True
        time.sleep(delay)
    return False


def start_server() -> subprocess.Popen | None:
    if http_ok("/"):
        print("检测到已有服务运行在 5000 端口。")
        return None

    stdout_path = os.path.join(os.getcwd(), "run_stdout.log")
    stderr_path = os.path.join(os.getcwd(), "run_stderr.log")
    out = open(stdout_path, "w", encoding="utf-8")
    err = open(stderr_path, "w", encoding="utf-8")

    kwargs = {
        "cwd": os.getcwd(),
        "stdout": out,
        "stderr": err,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen([sys.executable, "app.py"], **kwargs)
    print(f"已启动服务进程，PID={proc.pid}")
    return proc


def debug_checks() -> None:
    print("开始调试检查:")
    for path, expected in CHECK_PATHS:
        status = http_status(path)
        ok = status in expected if status is not None else False
        status_text = str(status) if status is not None else "NO_RESPONSE"
        expected_text = "/".join(str(s) for s in sorted(expected))
        print(f"  {path} -> {status_text} ({'OK' if ok else f'EXPECT {expected_text}'})")


def open_pages() -> None:
    opened_auth = webbrowser.open(BASE_URL + "/auth")
    print(f"浏览器打开登录页: {opened_auth}")
    print("管理员后台地址未自动打开（可手动访问 /admin）。")


if __name__ == "__main__":
    start_server()
    if not wait_ready():
        print("服务启动失败，请查看 run_stderr.log")
        raise SystemExit(1)
    debug_checks()
    open_pages()
    print("完成。")
