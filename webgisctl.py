#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unified WebGIS control entrypoint for Windows/Linux/WSL.

This script consolidates setup/build/start/stop/deploy/clean workflows.
Older .sh/.bat scripts can remain as thin wrappers for compatibility.
"""

import argparse
import hashlib
import http.cookiejar
import json
import os
import platform
import re
import secrets
import shutil
import signal
import sqlite3
import stat
import string
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple


ROOT_DIR = Path(__file__).resolve().parent
ENV_FILE = ROOT_DIR / ".env.webgis"
PID_FILE = ROOT_DIR / "webgis.pid"
LOG_DIR = ROOT_DIR / "logs"
DEFAULT_VENV_DIR = ".venv"
DEFAULT_PORT = 5000
TAILWIND_VERSION = "v3.4.17"


def info(msg: str) -> None:
    print(f"[INFO] {msg}")


def warn(msg: str) -> None:
    print(f"[WARN] {msg}")


def error(msg: str) -> None:
    print(f"[ERROR] {msg}")


def ok(msg: str) -> None:
    print(f"[OK] {msg}")


def is_windows() -> bool:
    return os.name == "nt"


def quote_env_value(value: str) -> str:
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def parse_env_line(line: str) -> Optional[Tuple[str, str]]:
    raw = line.strip()
    if not raw or raw.startswith("#") or "=" not in raw:
        return None
    key, value = raw.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if len(value) >= 2 and ((value[0] == value[-1] == '"') or (value[0] == value[-1] == "'")):
        value = value[1:-1]
    return key, value


def load_env_file(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    env_map: Dict[str, str] = {}
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            parsed = parse_env_line(line)
            if parsed:
                env_map[parsed[0]] = parsed[1]
    except OSError:
        pass
    return env_map


def save_env_file(path: Path, updates: Dict[str, str]) -> None:
    env_map = load_env_file(path)
    env_map.update({k: str(v) for k, v in updates.items() if v is not None})

    ordered_keys = [
        "WEBGIS_HOST",
        "WEBGIS_PORT",
        "TIANDITU_API_KEY",
        "WEBGIS_SECRET_KEY",
        "WEBGIS_SYSTEM_ADMIN_ACCOUNT",
        "WEBGIS_SYSTEM_ADMIN_PASSWORD",
    ]
    keys = ordered_keys + sorted(k for k in env_map.keys() if k not in ordered_keys)
    lines = [f"{k}={quote_env_value(env_map[k])}" for k in keys if k in env_map and env_map[k] != ""]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if not is_windows():
        try:
            path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass


def get_venv_python(venv_dir: str) -> Path:
    venv_path = ROOT_DIR / venv_dir
    if is_windows():
        return venv_path / "Scripts" / "python.exe"
    return venv_path / "bin" / "python"


def run_cmd(
    cmd: Sequence[str],
    *,
    env: Optional[Dict[str, str]] = None,
    check: bool = True,
    cwd: Optional[Path] = None,
    timeout: Optional[int] = None,
) -> subprocess.CompletedProcess:
    display = " ".join(cmd)
    info(f"Run: {display}")
    return subprocess.run(
        list(cmd),
        cwd=str(cwd or ROOT_DIR),
        env=env,
        check=check,
        timeout=timeout,
        text=True,
    )


def maybe_prompt(prompt: str, current: str = "") -> str:
    if not sys.stdin.isatty():
        return current
    tip = f" [{current}]" if current else ""
    value = input(f"{prompt}{tip}: ").strip()
    if not value:
        return current
    return value


def read_password_interactive(prompt: str = "Password") -> str:
    import getpass

    if not sys.stdin.isatty():
        return ""
    while True:
        p1 = getpass.getpass(f"{prompt}: ")
        p2 = getpass.getpass("Confirm password: ")
        if not p1:
            warn("Password cannot be empty.")
            continue
        if p1 != p2:
            warn("Password mismatch, retry.")
            continue
        return p1


def ensure_venv_and_python_deps(args: argparse.Namespace) -> Path:
    python_bin = args.python or sys.executable
    venv_python = get_venv_python(args.venv_dir)
    venv_root = ROOT_DIR / args.venv_dir

    if not venv_python.exists():
        info(f"Create virtual env: {venv_root}")
        if venv_root.exists():
            shutil.rmtree(venv_root, ignore_errors=True)
        run_cmd([python_bin, "-m", "venv", args.venv_dir])

    if not args.skip_python_deps:
        run_cmd([str(venv_python), "-m", "pip", "install", "--upgrade", "pip", "setuptools", "wheel"])
        run_cmd([str(venv_python), "-m", "pip", "install", "-r", "requirements.txt"])

    return venv_python


def ensure_node_deps(args: argparse.Namespace) -> None:
    if args.skip_node_deps:
        info("Skip Node dependency install by option.")
        return
    if not (ROOT_DIR / "package.json").exists():
        return
    npm = shutil.which("npm")
    if not npm:
        warn("npm not found, skip Node dependency install.")
        return
    use_ci = (ROOT_DIR / "package-lock.json").exists()
    if use_ci:
        run_cmd([npm, "ci", "--no-audit", "--no-fund"], check=False, timeout=args.npm_timeout)
    else:
        run_cmd([npm, "install", "--no-audit", "--no-fund"], check=False, timeout=args.npm_timeout)


def arch_name() -> str:
    machine = platform.machine().lower()
    if machine in {"x86_64", "amd64"}:
        return "x64"
    if machine in {"aarch64", "arm64"}:
        return "arm64"
    return machine


def standalone_tailwind_binary() -> Path:
    if is_windows():
        preferred = ROOT_DIR / "tools" / "tailwindcss.exe"
        if preferred.exists():
            return preferred
    elif platform.system().lower() == "linux":
        arch = arch_name()
        preferred = ROOT_DIR / "tools" / f"tailwindcss-linux-{arch}"
        if preferred.exists():
            return preferred

    os_name = platform.system().lower()
    arch = arch_name()
    if os_name.startswith("win"):
        asset_name = f"tailwindcss-windows-{arch}.exe"
    elif os_name == "linux":
        asset_name = f"tailwindcss-linux-{arch}"
    elif os_name == "darwin":
        asset_name = f"tailwindcss-macos-{arch}"
    else:
        raise RuntimeError(f"Unsupported platform for standalone tailwind: {os_name}")

    target = ROOT_DIR / "tools" / asset_name
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        url = f"https://github.com/tailwindlabs/tailwindcss/releases/download/{TAILWIND_VERSION}/{asset_name}"
        info(f"Downloading standalone tailwind binary: {url}")
        with urllib.request.urlopen(url, timeout=120) as resp:
            content = resp.read()
        target.write_bytes(content)
        if not is_windows():
            target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    if is_windows():
        stable = ROOT_DIR / "tools" / "tailwindcss.exe"
        if target != stable:
            shutil.copy2(target, stable)
            return stable
    return target


def run_tailwind_build(args: argparse.Namespace) -> None:
    input_file = ROOT_DIR / "static" / "css" / "tailwind.input.css"
    output_file = ROOT_DIR / "static" / "css" / "tailwind.generated.css"
    config_file = ROOT_DIR / "tailwind.config.js"
    if not input_file.exists() or not config_file.exists():
        raise RuntimeError("Tailwind input/config file missing.")

    npm = shutil.which("npm")
    node = shutil.which("node")
    if (not args.force_standalone_tailwind) and npm and node and (ROOT_DIR / "package.json").exists():
        result = run_cmd([npm, "run", "build:tailwind"], check=False, timeout=args.npm_timeout)
        if result.returncode == 0:
            ok("Tailwind CSS build completed with npm.")
            return
        warn("npm Tailwind build failed, fallback to standalone binary.")

    tailwind_bin = standalone_tailwind_binary()
    run_cmd(
        [
            str(tailwind_bin),
            "-c",
            str(config_file),
            "-i",
            str(input_file),
            "-o",
            str(output_file),
            "--minify",
        ]
    )
    ok(f"Tailwind CSS build completed with standalone binary: {tailwind_bin}")


def health_status(host: str, port: int, path: str, timeout: float = 2.0) -> Optional[int]:
    url = f"http://{host}:{port}{path}"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return int(resp.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except Exception:
        return None


def app_ready(port: int) -> bool:
    status = health_status("127.0.0.1", port, "/auth", timeout=1.5)
    return status == 200


def read_pid(pid_path: Path) -> Optional[int]:
    if not pid_path.exists():
        return None
    try:
        return int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        return None


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def find_pid_by_port(port: int) -> Optional[int]:
    if is_windows():
        try:
            result = subprocess.run(["netstat", "-aon"], capture_output=True, text=True, timeout=10, check=False)
            for line in result.stdout.splitlines():
                if f":{port} " in line and "LISTENING" in line.upper():
                    parts = line.strip().split()
                    if parts:
                        return int(parts[-1])
        except Exception:
            return None
        return None

    lsof = shutil.which("lsof")
    if not lsof:
        return None
    try:
        result = subprocess.run([lsof, "-ti", f"tcp:{port}"], capture_output=True, text=True, timeout=8, check=False)
        out = result.stdout.strip().splitlines()
        if out:
            return int(out[0].strip())
    except Exception:
        return None
    return None


def kill_pid(pid: int) -> None:
    if not pid_alive(pid):
        return
    if is_windows():
        subprocess.run(["taskkill", "/F", "/PID", str(pid)], check=False)
        return
    try:
        os.kill(pid, signal.SIGTERM)
        time.sleep(1.0)
        if pid_alive(pid):
            os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def stop_service(args: argparse.Namespace) -> None:
    pid = read_pid(Path(args.pid_file))
    if pid and pid_alive(pid):
        info(f"Stopping PID {pid}")
        kill_pid(pid)
    else:
        port_pid = find_pid_by_port(args.port)
        if port_pid:
            info(f"Stopping process on port {args.port}, PID {port_pid}")
            kill_pid(port_pid)
        else:
            info("No running process found.")
    try:
        Path(args.pid_file).unlink()
    except OSError:
        pass


def start_service(args: argparse.Namespace) -> int:
    env_map = load_env_file(Path(args.env_file))
    host = args.host or env_map.get("WEBGIS_HOST", "0.0.0.0")
    port = int(args.port or env_map.get("WEBGIS_PORT", DEFAULT_PORT))

    pid_path = Path(args.pid_file)
    pid = read_pid(pid_path)
    if pid and pid_alive(pid) and app_ready(port):
        ok(f"Service already running. PID={pid}, URL=http://127.0.0.1:{port}")
        if args.open:
            webbrowser.open(f"http://127.0.0.1:{port}/auth")
        return 0

    if pid and not pid_alive(pid):
        try:
            pid_path.unlink()
        except OSError:
            pass

    if args.restart:
        stop_service(args)

    logs = Path(args.log_dir)
    logs.mkdir(parents=True, exist_ok=True)

    venv_python = get_venv_python(args.venv_dir)
    python_bin = str(venv_python if venv_python.exists() else (args.python or sys.executable))

    env = os.environ.copy()
    env.update(env_map)
    env["WEBGIS_HOST"] = host
    env["WEBGIS_PORT"] = str(port)

    if not env.get("WEBGIS_SECRET_KEY"):
        env["WEBGIS_SECRET_KEY"] = secrets.token_hex(32)
        save_env_file(Path(args.env_file), {"WEBGIS_SECRET_KEY": env["WEBGIS_SECRET_KEY"]})
        info("WEBGIS_SECRET_KEY missing, generated and saved.")

    out_log = logs / "webgis.out.log"
    err_log = logs / "webgis.err.log"
    out_fp = open(out_log, "w", encoding="utf-8")
    err_fp = open(err_log, "w", encoding="utf-8")
    popen_kwargs = {
        "cwd": str(ROOT_DIR),
        "stdout": out_fp,
        "stderr": err_fp,
        "env": env,
    }
    if is_windows():
        popen_kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["start_new_session"] = True

    proc = subprocess.Popen([python_bin, "app.py"], **popen_kwargs)  # type: ignore[arg-type]
    pid_path.write_text(str(proc.pid), encoding="utf-8")
    info(f"Started app process, PID={proc.pid}")

    deadline = time.time() + float(args.wait_seconds)
    while time.time() < deadline:
        if app_ready(port):
            ok(f"Service started: http://127.0.0.1:{port}")
            if args.open:
                webbrowser.open(f"http://127.0.0.1:{port}/auth")
            return 0
        if not pid_alive(proc.pid):
            break
        time.sleep(0.6)

    error("Service failed to start in time.")
    error(f"Check logs: {out_log} / {err_log}")
    return 1


def run_health_checks(args: argparse.Namespace) -> int:
    host = args.host or "127.0.0.1"
    port = int(args.port or DEFAULT_PORT)
    checks = [
        ("/auth", {200}),
        ("/", {200, 302}),
        ("/api/auth/me", {200, 401}),
        ("/admin", {200, 302}),
        ("/admin/accounts", {200, 302}),
    ]
    passed = True
    for path, expected in checks:
        code = health_status(host, port, path)
        if code in expected:
            print(f"[OK]   {path:<20} -> {code}")
        else:
            passed = False
            exp = "/".join(str(v) for v in sorted(expected))
            print(f"[FAIL] {path:<20} -> {code} (expected {exp})")
    if passed:
        ok("All health checks passed.")
        return 0
    warn("Some health checks failed.")
    return 2


def write_tianditu_key(venv_python: Path, key: str) -> None:
    run_cmd([str(venv_python), "manage_map_key.py", "set", "--key", key])


def username_exists(username: str) -> bool:
    db_path = ROOT_DIR / "webgis.db"
    if not db_path.exists():
        return False
    try:
        con = sqlite3.connect(str(db_path))
        row = con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
        ).fetchone()
        if not row:
            return False
        found = con.execute(
            "SELECT id FROM users WHERE UPPER(COALESCE(username,'')) = UPPER(?)",
            (username,),
        ).fetchone()
        return bool(found)
    except sqlite3.Error:
        return False
    finally:
        try:
            con.close()
        except Exception:
            pass


def ensure_admin_account(
    venv_python: Path,
    username: str,
    password: str,
    name: str,
    force_change: bool,
) -> None:
    if username_exists(username):
        run_cmd([str(venv_python), "manage_accounts.py", "update", "--username", username, "--user-type", "super_admin"])
        cmd = [
            str(venv_python),
            "manage_accounts.py",
            "reset-password",
            "--username",
            username,
            "--password",
            password,
        ]
        if force_change:
            cmd.append("--force-change")
        run_cmd(cmd)
        return

    cmd = [
        str(venv_python),
        "manage_accounts.py",
        "create",
        "--name",
        name,
        "--username",
        username,
        "--user-type",
        "super_admin",
        "--password",
        password,
    ]
    if force_change:
        cmd.append("--force-change")
    run_cmd(cmd)


def verify_admin_login(port: int, username: str, password: str) -> None:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    base = f"http://127.0.0.1:{port}"
    hashed = "sha256:" + hashlib.sha256(password.encode("utf-8")).hexdigest()
    payload = json.dumps({"username": username, "password": hashed}).encode("utf-8")
    req = urllib.request.Request(base + "/api/auth/login", data=payload, headers={"Content-Type": "application/json"})
    with opener.open(req, timeout=8) as resp:
        if int(resp.status) != 200:
            raise RuntimeError("Admin login verification failed.")
    req2 = urllib.request.Request(base + "/api/admin/overview")
    with opener.open(req2, timeout=8) as resp:
        if int(resp.status) != 200:
            raise RuntimeError("Admin overview verification failed.")


def random_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()_+-=[]{}:,.?"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def cmd_setup(args: argparse.Namespace) -> int:
    ensure_venv_and_python_deps(args)
    ensure_node_deps(args)
    ok("Setup completed.")
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    if not args.skip_tailwind:
        run_tailwind_build(args)
    if args.with_jsx_dist:
        venv_python = get_venv_python(args.venv_dir)
        py = str(venv_python if venv_python.exists() else (args.python or sys.executable))
        run_cmd([py, "build_jsx.py"])
    ok("Build completed.")
    return 0


def cmd_start(args: argparse.Namespace) -> int:
    args.restart = False
    return start_service(args)


def cmd_stop(args: argparse.Namespace) -> int:
    stop_service(args)
    ok("Service stopped.")
    return 0


def cmd_restart(args: argparse.Namespace) -> int:
    args.restart = True
    return start_service(args)


def cmd_check(args: argparse.Namespace) -> int:
    return run_health_checks(args)


def cmd_clean(args: argparse.Namespace) -> int:
    stop_service(args)

    # Runtime artifacts
    for p in [
        ROOT_DIR / "run_stdout.log",
        ROOT_DIR / "run_stderr.log",
        Path(args.pid_file),
        ROOT_DIR / "webgis-wsl.pid",
    ]:
        try:
            p.unlink()
        except OSError:
            pass

    for log_dir in [Path(args.log_dir), ROOT_DIR / "logs-wsl"]:
        if log_dir.exists():
            shutil.rmtree(log_dir, ignore_errors=True)

    for pycache in ROOT_DIR.rglob("__pycache__"):
        shutil.rmtree(pycache, ignore_errors=True)

    if args.mode == "all":
        for p in [
            ROOT_DIR / args.venv_dir,
            ROOT_DIR / ".venv-wsl",
            ROOT_DIR / "webgis.db",
            ROOT_DIR / ".tianditu_key",
            Path(args.env_file),
        ]:
            if p.exists():
                if p.is_dir():
                    shutil.rmtree(p, ignore_errors=True)
                else:
                    try:
                        p.unlink()
                    except OSError:
                        pass
        if args.remove_node_modules:
            nm = ROOT_DIR / "node_modules"
            if nm.exists():
                shutil.rmtree(nm, ignore_errors=True)
    ok(f"Cleanup completed (mode={args.mode}).")
    return 0


def cmd_deploy(args: argparse.Namespace) -> int:
    map_key = (args.map_key or os.environ.get("TIANDITU_API_KEY", "")).strip()
    if not map_key:
        key_file = ROOT_DIR / ".tianditu_key"
        if key_file.exists():
            map_key = key_file.read_text(encoding="utf-8").strip()
    if not map_key:
        map_key = maybe_prompt("TianDiTu API key", "")
    if not map_key:
        error("TianDiTu API key is required.")
        return 1

    admin_username = (args.admin_username or "admin").strip() or "admin"
    admin_name = (args.admin_name or "DefaultAdmin").strip() or "DefaultAdmin"
    admin_password = (args.admin_password or "").strip()
    if not admin_password:
        admin_password = read_password_interactive("Default admin password")
    if not admin_password:
        admin_password = random_password(16)
        warn("No admin password provided; generated random password.")

    secret_key = (args.secret_key or "").strip() or secrets.token_hex(32)

    info("Step 1/6: setup")
    cmd_setup(args)

    venv_python = get_venv_python(args.venv_dir)
    if not venv_python.exists():
        error(f"Missing venv python: {venv_python}")
        return 1

    info("Step 2/6: save map key")
    write_tianditu_key(venv_python, map_key)

    info("Step 3/6: build assets")
    cmd_build(args)

    info("Step 4/6: write runtime env")
    updates = {
        "WEBGIS_HOST": args.host,
        "WEBGIS_PORT": str(args.port),
        "TIANDITU_API_KEY": map_key,
        "WEBGIS_SECRET_KEY": secret_key,
    }
    if args.system_admin_account:
        updates["WEBGIS_SYSTEM_ADMIN_ACCOUNT"] = args.system_admin_account
    if args.system_admin_password:
        updates["WEBGIS_SYSTEM_ADMIN_PASSWORD"] = args.system_admin_password
    save_env_file(Path(args.env_file), updates)

    info("Step 5/6: restart service")
    restart_args = argparse.Namespace(**vars(args))
    restart_args.restart = True
    restart_args.open = args.open
    if start_service(restart_args) != 0:
        return 1

    info("Step 6/6: ensure default admin account")
    ensure_admin_account(
        venv_python=venv_python,
        username=admin_username,
        password=admin_password,
        name=admin_name,
        force_change=bool(args.force_change),
    )
    verify_admin_login(int(args.port), admin_username, admin_password)
    ok("Deployment complete.")
    print(f"[OK] URL: http://127.0.0.1:{args.port}")
    print(f"[OK] Default admin username: {admin_username}")
    print(f"[OK] Default admin password: {admin_password}")
    return 0


def add_common_runtime_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--python", default=sys.executable, help="Python executable path.")
    parser.add_argument("--venv-dir", default=DEFAULT_VENV_DIR, help="Virtual env directory.")
    parser.add_argument("--env-file", default=str(ENV_FILE), help="Runtime env file path.")
    parser.add_argument("--pid-file", default=str(PID_FILE), help="PID file path.")
    parser.add_argument("--log-dir", default=str(LOG_DIR), help="Log directory.")
    parser.add_argument("--host", default="0.0.0.0", help="Service host.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Service port.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebGIS unified controller (Windows/Linux/WSL).")
    sub = parser.add_subparsers(dest="command")

    p_setup = sub.add_parser("setup", help="Create venv and install Python/Node dependencies.")
    p_setup.add_argument("--python", default=sys.executable, help="Python executable path.")
    p_setup.add_argument("--venv-dir", default=DEFAULT_VENV_DIR, help="Virtual env directory.")
    p_setup.add_argument("--skip-python-deps", action="store_true", help="Skip pip install.")
    p_setup.add_argument("--skip-node-deps", action="store_true", help="Skip npm install.")
    p_setup.add_argument("--npm-timeout", type=int, default=300, help="npm install timeout seconds.")
    p_setup.set_defaults(func=cmd_setup)

    p_build = sub.add_parser("build", help="Build front-end assets.")
    p_build.add_argument("--python", default=sys.executable, help="Python executable path.")
    p_build.add_argument("--venv-dir", default=DEFAULT_VENV_DIR, help="Virtual env directory.")
    p_build.add_argument("--skip-tailwind", action="store_true", help="Skip Tailwind build.")
    p_build.add_argument("--with-jsx-dist", action="store_true", help="Compile JSX to static/js/dist.")
    p_build.add_argument("--force-standalone-tailwind", action="store_true", help="Force standalone Tailwind binary.")
    p_build.add_argument("--npm-timeout", type=int, default=300, help="npm build timeout seconds.")
    p_build.set_defaults(func=cmd_build)

    p_start = sub.add_parser("start", help="Start service in background.")
    add_common_runtime_options(p_start)
    p_start.add_argument("--wait-seconds", type=int, default=45, help="Startup wait timeout.")
    p_start.add_argument("--open", action="store_true", help="Open browser /auth page after start.")
    p_start.set_defaults(func=cmd_start)

    p_stop = sub.add_parser("stop", help="Stop running service.")
    add_common_runtime_options(p_stop)
    p_stop.set_defaults(func=cmd_stop)

    p_restart = sub.add_parser("restart", help="Restart service.")
    add_common_runtime_options(p_restart)
    p_restart.add_argument("--wait-seconds", type=int, default=45, help="Startup wait timeout.")
    p_restart.add_argument("--open", action="store_true", help="Open browser /auth page after restart.")
    p_restart.set_defaults(func=cmd_restart)

    p_check = sub.add_parser("check", help="Run health checks.")
    p_check.add_argument("--host", default="127.0.0.1", help="Check host.")
    p_check.add_argument("--port", type=int, default=DEFAULT_PORT, help="Check port.")
    p_check.set_defaults(func=cmd_check)

    p_clean = sub.add_parser("clean", help="Cleanup runtime or full project data.")
    add_common_runtime_options(p_clean)
    p_clean.add_argument("mode", choices=["runtime", "all"], nargs="?", default="runtime")
    p_clean.add_argument("--remove-node-modules", action="store_true", help="Also remove node_modules in all mode.")
    p_clean.set_defaults(func=cmd_clean)

    p_deploy = sub.add_parser("deploy", help="One-command deploy (cross-platform).")
    add_common_runtime_options(p_deploy)
    p_deploy.add_argument("--skip-python-deps", action="store_true", help="Skip pip install in setup.")
    p_deploy.add_argument("--skip-node-deps", action="store_true", help="Skip npm install in setup.")
    p_deploy.add_argument("--npm-timeout", type=int, default=300, help="npm timeout seconds.")
    p_deploy.add_argument("--force-standalone-tailwind", action="store_true", help="Force standalone Tailwind binary.")
    p_deploy.add_argument("--skip-tailwind", action="store_true", help="Skip Tailwind build.")
    p_deploy.add_argument("--with-jsx-dist", action="store_true", help="Compile JSX to dist during deploy.")
    p_deploy.add_argument("--wait-seconds", type=int, default=45, help="Startup wait timeout.")
    p_deploy.add_argument("--open", action="store_true", help="Open browser page after deploy.")
    p_deploy.add_argument("--map-key", default="", help="TianDiTu API key.")
    p_deploy.add_argument("--secret-key", default="", help="WEBGIS_SECRET_KEY.")
    p_deploy.add_argument("--admin-username", default="admin", help="Default admin username.")
    p_deploy.add_argument("--admin-password", default="", help="Default admin password.")
    p_deploy.add_argument("--admin-name", default="DefaultAdmin", help="Default admin display name.")
    p_deploy.add_argument("--system-admin-account", default="", help="Optional system backend account.")
    p_deploy.add_argument("--system-admin-password", default="", help="Optional system backend password.")
    p_deploy.add_argument("--force-change", action="store_true", help="Force admin password change on next login.")
    p_deploy.set_defaults(func=cmd_deploy)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        parser.print_help()
        return 2
    try:
        return int(args.func(args))
    except subprocess.CalledProcessError as exc:
        error(f"Command failed with code {exc.returncode}: {' '.join(exc.cmd)}")
        return int(exc.returncode or 1)
    except KeyboardInterrupt:
        warn("Interrupted.")
        return 130
    except Exception as exc:  # pragma: no cover
        error(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
