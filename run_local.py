# 【中文注释】
# 文件说明：run_local.py 为项目自研源码文件，包含核心业务逻辑。
# 维护约定：变更前先确认输入输出与调用链，避免影响前后端联调。

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

# Windows console may use GBK encoding; prevent crashes on Unicode output
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:
        pass


def get_port() -> int:
    raw = (os.environ.get("WEBGIS_PORT") or "").strip()
    if raw:
        try:
            return int(raw)
        except ValueError:
            pass
    return 5000


BASE_HOST = "127.0.0.1"
CHECK_PATHS = [
    ("/auth", {200}),
    ("/", {200, 302}),
    ("/admin", {200, 302}),
    ("/admin/accounts", {200, 302}),
    ("/account", {200, 302}),
    ("/api/auth/me", {200, 401}),
    ("/api/admin/overview", {200, 401, 403}),
]


def base_url() -> str:
    return f"http://{BASE_HOST}:{get_port()}"


def http_status(path: str, timeout: float = 3.0) -> int | None:
    try:
        with urllib.request.urlopen(base_url() + path, timeout=timeout) as resp:
            return int(resp.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:
        return None


def http_ok(path: str, timeout: float = 3.0) -> bool:
    return http_status(path, timeout=timeout) == 200


def http_reachable(path: str = "/", timeout: float = 3.0) -> bool:
    return http_status(path, timeout=timeout) is not None


def wait_ready(retries: int = 30, delay: float = 0.5) -> bool:
    for i in range(retries):
        if http_ok("/"):
            return True
        if i == 0:
            print(f"  Waiting for server ({base_url()}) ...")
        time.sleep(delay)
    return False


def find_pid_on_port(port: int) -> int | None:
    """Find the PID listening on the given port."""
    import socket

    try:
        import ctypes

        # Try reading PID file first
        pid_path = os.path.join(os.getcwd(), "webgis.pid")
        if os.path.isfile(pid_path):
            with open(pid_path) as f:
                pid = int(f.read().strip())
                try:
                    os.kill(pid, 0)  # check if alive
                    return pid
                except OSError:
                    pass
    except Exception:
        pass

    # Fallback: use netstat on Windows
    if os.name == "nt":
        try:
            import re

            result = subprocess.run(
                ["netstat", "-aon"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            for line in result.stdout.splitlines():
                if f":{port} " in line and "LISTENING" in line:
                    parts = line.strip().split()
                    if parts:
                        return int(parts[-1])
        except Exception:
            pass
    return None


def stop_server() -> bool:
    """Stop any running server on the configured port."""
    port = get_port()
    pid = find_pid_on_port(port)
    if pid is None:
        if not http_reachable("/"):
            return True  # nothing running
        print(f"  [WARN] Server on port {port} but cannot find PID")
        return False

    print(f"  Stopping PID {pid} on port {port} ...")
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True, timeout=10)
        else:
            import signal

            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    except Exception as e:
        print(f"  [WARN] Kill failed: {e}")
        return False

    # Wait for port to free up
    for _ in range(10):
        if not http_reachable("/", timeout=0.5):
            # Clean PID file
            pid_path = os.path.join(os.getcwd(), "webgis.pid")
            if os.path.isfile(pid_path):
                try:
                    os.remove(pid_path)
                except OSError:
                    pass
            return True
        time.sleep(0.5)
    return False


def start_server() -> subprocess.Popen | None:
    port = get_port()
    if http_reachable("/"):
        print(f"  Server already running on port {port}.")
        return None

    stdout_path = os.path.join(os.getcwd(), "run_stdout.log")
    stderr_path = os.path.join(os.getcwd(), "run_stderr.log")

    env = os.environ.copy()
    env.setdefault("WEBGIS_PORT", str(port))

    print(f"  Starting server on port {port} ...")

    out = open(stdout_path, "w", encoding="utf-8")
    err = open(stderr_path, "w", encoding="utf-8")

    kwargs = {
        "cwd": os.getcwd(),
        "stdout": out,
        "stderr": err,
        "env": env,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen([sys.executable, "app.py"], **kwargs)

    # Save PID
    pid_path = os.path.join(os.getcwd(), "webgis.pid")
    with open(pid_path, "w") as f:
        f.write(str(proc.pid))

    print(f"  PID    : {proc.pid}")
    print(f"  Stdout : {stdout_path}")
    print(f"  Stderr : {stderr_path}")
    return proc


def debug_checks() -> None:
    print("\n  Health Check:")
    all_ok = True
    for path, expected in CHECK_PATHS:
        status = http_status(path)
        ok = status in expected if status is not None else False
        if not ok:
            all_ok = False
        status_text = str(status) if status is not None else "NO_RESPONSE"
        expected_text = "/".join(str(s) for s in sorted(expected))
        icon = "[OK]  " if ok else "[FAIL]"
        print(f"    {icon} {path} -> {status_text}" + ("" if ok else f" (expect {expected_text})"))
    if all_ok:
        print("    -- ALL CHECKS PASSED --")
    else:
        print("    [WARN] Some checks failed, see run_stderr.log")


def open_pages() -> None:
    url = base_url() + "/auth"
    opened = webbrowser.open(url)
    print(f"\n  Browser : {url}" + (" (opened)" if opened else " (failed to open)"))
    print(f"  Admin   : {base_url()}/admin")
    print(f"  Accounts: {base_url()}/admin/accounts")


def print_banner() -> None:
    print()
    print("  ============================================")
    print("    WebGIS  -  Local Development Launcher")
    print("  ============================================")
    print()


def print_usage() -> None:
    print("  Usage: python run_local.py [command]")
    print()
    print("  Commands:")
    print("    (none)      Start server, run checks, open browser")
    print("    --restart   Stop running server and start fresh")
    print("    --stop      Stop running server")
    print("    --check     Run health checks only")
    print("    --help      Show this help")
    print()


if __name__ == "__main__":
    args = sys.argv[1:]
    cmd = args[0] if args else ""

    if cmd in ("-h", "--help"):
        print_banner()
        print_usage()
        raise SystemExit(0)

    print_banner()

    if cmd == "--stop":
        print("  Stopping server ...")
        if stop_server():
            print("  [OK] Server stopped.")
        else:
            print("  [WARN] Could not stop server.")
        raise SystemExit(0)

    if cmd == "--restart":
        print("  Restarting server ...")
        stop_server()
        time.sleep(1)

    if cmd == "--check":
        debug_checks()
        raise SystemExit(0)

    start_server()
    if not wait_ready():
        print("\n  [ERROR] Server failed to start!")
        print("  [TIP]   Check run_stderr.log for details")
        raise SystemExit(1)
    debug_checks()
    open_pages()
    print("\n  Done.\n")

