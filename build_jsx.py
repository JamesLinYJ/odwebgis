# 【中文注释】
# 文件说明：build_jsx.py 为项目自研源码文件，包含核心业务逻辑。
# 维护约定：变更前先确认输入输出与调用链，避免影响前后端联调。

#!/usr/bin/env python3
"""Build script: pre-compile JSX files and minify CSS.

Usage:
    python build_jsx.py

Requirements:
    Node.js with npx available, OR Babel already installed locally.
"""

import os
import re
import shutil
import subprocess
import sys
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Ensure Node.js is on PATH (useful when freshly installed and shell hasn't refreshed)
_NODEJS_DIR = r"C:\Program Files\nodejs"
if sys.platform == "win32" and os.path.isdir(_NODEJS_DIR):
    if _NODEJS_DIR.lower() not in os.environ.get("PATH", "").lower():
        os.environ["PATH"] = _NODEJS_DIR + os.pathsep + os.environ.get("PATH", "")
JS_SRC_DIR = os.path.join(BASE_DIR, "static", "js")
JS_DIST_DIR = os.path.join(BASE_DIR, "static", "js", "dist")
CSS_DIR = os.path.join(BASE_DIR, "static", "css")
CSS_DIST_DIR = os.path.join(BASE_DIR, "static", "css", "dist")
VENDOR_CSS_DIR = os.path.join(BASE_DIR, "static", "vendor", "leaflet")
VENDOR_CSS_DIST_DIR = os.path.join(BASE_DIR, "static", "vendor", "leaflet", "dist")


def find_npx() -> str:
    """Find npx executable."""
    npx = shutil.which("npx")
    if npx:
        return npx
    # Windows: try common locations
    for candidate in [
        r"C:\Program Files\nodejs\npx.cmd",
        os.path.expandvars(r"%APPDATA%\npm\npx.cmd"),
        os.path.expandvars(r"%ProgramFiles%\nodejs\npx.cmd"),
    ]:
        if os.path.isfile(candidate):
            return candidate
    return "npx"


def ensure_babel_deps():
    """Ensure @babel/cli and @babel/preset-react are available."""
    pkg_json = os.path.join(BASE_DIR, "package.json")
    if os.path.isfile(pkg_json):
        with open(pkg_json, "r", encoding="utf-8") as f:
            pkg = json.load(f)
        dev_deps = pkg.get("devDependencies", {})
        if "@babel/cli" in dev_deps and "@babel/preset-react" in dev_deps:
            # Already declared, just ensure installed
            if os.path.isdir(os.path.join(BASE_DIR, "node_modules", "@babel", "cli")):
                return
    print("[INFO] Installing @babel/cli and @babel/preset-react ...")
    npm_cmd = shutil.which("npm") or r"C:\Program Files\nodejs\npm.cmd"
    subprocess.check_call(
        [npm_cmd, "install", "--save-dev", "@babel/cli", "@babel/core", "@babel/preset-react"],
        cwd=BASE_DIR,
        timeout=120,
        shell=(sys.platform == "win32"),
    )


def compile_jsx_files():
    """Compile all .jsx files to .js using Babel."""
    os.makedirs(JS_DIST_DIR, exist_ok=True)

    jsx_files = sorted(f for f in os.listdir(JS_SRC_DIR) if f.endswith(".jsx"))
    if not jsx_files:
        print("[WARN] No .jsx files found in", JS_SRC_DIR)
        return

    npx = find_npx()

    for jsx_file in jsx_files:
        src_path = os.path.join(JS_SRC_DIR, jsx_file)
        out_name = jsx_file.replace(".jsx", ".js")
        out_path = os.path.join(JS_DIST_DIR, out_name)

        print(f"[BUILD] {jsx_file} -> dist/{out_name}")
        result = subprocess.run(
            [
                npx, "babel",
                src_path,
                "--out-file", out_path,
                "--presets=@babel/preset-react",
                "--no-comments",
            ],
            cwd=BASE_DIR,
            capture_output=True,
            text=True,
            timeout=60,
            shell=(sys.platform == "win32"),
        )
        if result.returncode != 0:
            print(f"[ERROR] Failed to compile {jsx_file}:")
            print(result.stderr)
            sys.exit(1)

    # Also copy non-JSX JS files that are loaded by templates
    for js_file in ["api.js", "od-export.js"]:
        src = os.path.join(JS_SRC_DIR, js_file)
        dst = os.path.join(JS_DIST_DIR, js_file)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
            print(f"[COPY] {js_file} -> dist/{js_file}")

    print(f"[OK] Compiled {len(jsx_files)} JSX files")


def minify_css(src_path: str, dst_path: str):
    """Simple CSS minifier: remove comments, collapse whitespace."""
    with open(src_path, "r", encoding="utf-8") as f:
        css = f.read()

    original_size = len(css.encode("utf-8"))

    # Remove CSS comments
    css = re.sub(r"/\*[\s\S]*?\*/", "", css)
    # Remove leading/trailing whitespace on each line
    css = "\n".join(line.strip() for line in css.splitlines())
    # Collapse multiple newlines
    css = re.sub(r"\n{2,}", "\n", css)
    # Remove newlines around braces, colons, semicolons
    css = re.sub(r"\s*\{\s*", "{", css)
    css = re.sub(r"\s*\}\s*", "}", css)
    css = re.sub(r"\s*;\s*", ";", css)
    css = re.sub(r"\s*:\s*", ":", css)
    css = re.sub(r"\s*,\s*", ",", css)
    # Remove trailing semicolons before closing braces
    css = css.replace(";}", "}")
    css = css.strip()

    minified_size = len(css.encode("utf-8"))

    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write(css)

    ratio = (1 - minified_size / original_size) * 100 if original_size > 0 else 0
    basename = os.path.basename(src_path)
    print(f"[CSS] {basename}: {original_size:,} -> {minified_size:,} bytes ({ratio:.0f}% smaller)")


def minify_css_files():
    """Minify CSS files that benefit from it."""
    os.makedirs(CSS_DIST_DIR, exist_ok=True)
    os.makedirs(VENDOR_CSS_DIST_DIR, exist_ok=True)

    css_targets = [
        (os.path.join(CSS_DIR, "motion.css"), os.path.join(CSS_DIST_DIR, "motion.min.css")),
        (os.path.join(VENDOR_CSS_DIR, "leaflet.css"), os.path.join(VENDOR_CSS_DIST_DIR, "leaflet.min.css")),
    ]

    for src, dst in css_targets:
        if os.path.isfile(src):
            minify_css(src, dst)
        else:
            print(f"[WARN] CSS file not found: {src}")


def main():
    print("=" * 50)
    print("WebGIS Build: JSX compilation & CSS minification")
    print("=" * 50)

    ensure_babel_deps()
    compile_jsx_files()
    minify_css_files()

    print()
    print("[OK] Build complete!")
    print("[TIP] Remember to update HTML templates if this is a fresh build.")


if __name__ == "__main__":
    main()

