(function () {
    const THEME_STORAGE_KEY = "webgis_theme";

    function normalizeThemePref(theme) {
        const raw = String(theme || "").trim().toLowerCase();
        if (raw === "light" || raw === "dark" || raw === "auto") return raw;
        return "auto";
    }

    function prefersDarkTheme() {
        try {
            return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
        } catch {
            return false;
        }
    }

    function getThemePreference() {
        try {
            return normalizeThemePref(localStorage.getItem(THEME_STORAGE_KEY));
        } catch {
            return "auto";
        }
    }

    function resolveAppliedTheme(pref) {
        const normalized = normalizeThemePref(pref);
        if (normalized === "auto") {
            return prefersDarkTheme() ? "dark" : "light";
        }
        return normalized;
    }

    function applyTheme(pref) {
        const applied = resolveAppliedTheme(pref);
        const isDark = applied === "dark";
        const root = document.documentElement;
        const body = document.body;
        if (root) {
            root.classList.toggle("theme-dark", isDark);
            root.dataset.theme = applied;
        }
        if (body) {
            body.classList.toggle("theme-dark", isDark);
            body.dataset.theme = applied;
        }
        try {
            window.dispatchEvent(new CustomEvent("webgis-theme-change", {
                detail: { theme: applied, preference: normalizeThemePref(pref) },
            }));
        } catch {
            // ignore
        }
        return applied;
    }

    function setTheme(pref) {
        const normalized = normalizeThemePref(pref);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, normalized);
        } catch {
            // ignore storage failure
        }
        return applyTheme(normalized);
    }

    function toggleTheme() {
        const applied = resolveAppliedTheme(getThemePreference());
        const nextPref = applied === "dark" ? "light" : "dark";
        return setTheme(nextPref);
    }

    function initTheme() {
        const pref = getThemePreference();
        applyTheme(pref);
        try {
            if (window.matchMedia) {
                const media = window.matchMedia("(prefers-color-scheme: dark)");
                const onChange = () => {
                    if (getThemePreference() === "auto") {
                        applyTheme("auto");
                    }
                };
                if (typeof media.addEventListener === "function") {
                    media.addEventListener("change", onChange);
                } else if (typeof media.addListener === "function") {
                    media.addListener(onChange);
                }
            }
        } catch {
            // ignore
        }
    }

    initTheme();

    const SHA256_K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
        0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
        0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
        0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
        0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];

    function rightRotate(value, amount) {
        return (value >>> amount) | (value << (32 - amount));
    }

    function utf8Bytes(text) {
        if (window.TextEncoder) {
            return Array.from(new TextEncoder().encode(text));
        }
        const encoded = unescape(encodeURIComponent(text));
        const arr = [];
        for (let i = 0; i < encoded.length; i += 1) {
            arr.push(encoded.charCodeAt(i));
        }
        return arr;
    }

    function sha256HexPure(text) {
        const msg = utf8Bytes(String(text || ""));
        const bitLen = msg.length * 8;

        msg.push(0x80);
        while ((msg.length % 64) !== 56) {
            msg.push(0x00);
        }

        const high = Math.floor(bitLen / 0x100000000);
        const low = bitLen >>> 0;
        msg.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
        msg.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

        const hash = [
            0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
            0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
        ];

        for (let offset = 0; offset < msg.length; offset += 64) {
            const w = new Array(64);
            for (let i = 0; i < 16; i += 1) {
                const j = offset + i * 4;
                w[i] = ((msg[j] << 24) | (msg[j + 1] << 16) | (msg[j + 2] << 8) | msg[j + 3]) >>> 0;
            }
            for (let i = 16; i < 64; i += 1) {
                const s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                const s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
            }

            let [a, b, c, d, e, f, g, h] = hash;

            for (let i = 0; i < 64; i += 1) {
                const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
                const ch = (e & f) ^ (~e & g);
                const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
                const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
                const maj = (a & b) ^ (a & c) ^ (b & c);
                const temp2 = (S0 + maj) >>> 0;

                h = g;
                g = f;
                f = e;
                e = (d + temp1) >>> 0;
                d = c;
                c = b;
                b = a;
                a = (temp1 + temp2) >>> 0;
            }

            hash[0] = (hash[0] + a) >>> 0;
            hash[1] = (hash[1] + b) >>> 0;
            hash[2] = (hash[2] + c) >>> 0;
            hash[3] = (hash[3] + d) >>> 0;
            hash[4] = (hash[4] + e) >>> 0;
            hash[5] = (hash[5] + f) >>> 0;
            hash[6] = (hash[6] + g) >>> 0;
            hash[7] = (hash[7] + h) >>> 0;
        }

        return hash.map((v) => v.toString(16).padStart(8, "0")).join("");
    }

    async function request(url, options = {}) {
        const response = await fetch(url, options);
        const isJson = response.headers.get("content-type")?.includes("application/json");
        const payload = isJson ? await response.json() : await response.text();

        if (!response.ok) {
            const message = isJson ? payload.message || "请求失败" : "请求失败";
            throw new Error(message);
        }

        return payload;
    }

    function get(url) {
        return request(url);
    }

    function postJson(url, data) {
        return request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
        });
    }

    async function sha256Hex(text) {
        if (window.isSecureContext && window.crypto && window.crypto.subtle) {
            try {
                const bytes = new TextEncoder().encode(String(text || ""));
                const digest = await window.crypto.subtle.digest("SHA-256", bytes);
                const arr = Array.from(new Uint8Array(digest));
                return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
            } catch {
                // fallback to pure JS implementation
            }
        }
        return sha256HexPure(String(text || ""));
    }

    async function encryptSensitiveData(data) {
        const payload = { ...(data || {}) };
        const keys = ["password", "old_password", "new_password"];
        for (const key of keys) {
            const value = payload[key];
            if (typeof value !== "string") continue;
            if (value.startsWith("sha256:")) continue;
            const digest = await sha256Hex(value);
            payload[key] = `sha256:${digest}`;
        }
        return payload;
    }

    async function postJsonSecure(url, data) {
        const secureData = await encryptSensitiveData(data);
        return request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(secureData),
        });
    }

    function validatePasswordInput(password, username = "") {
        const value = String(password || "");
        if (value.length < 6) return "密码至少 6 位";
        if (value.length > 64) return "密码长度不能超过 64 位";
        if (/\s/.test(value)) return "密码不能包含空格";
        if (!/^[\x21-\x7E]+$/.test(value)) {
            return "密码仅支持英文、数字和常见符号，不支持中文或全角字符";
        }
        if (username && value.toLowerCase() === String(username).toLowerCase()) {
            return "密码不能与用户名相同";
        }
        return null;
    }

    function passwordStrength(password, username = "") {
        const value = String(password || "");
        const invalid = !!validatePasswordInput(value, username);
        const hasLower = /[a-z]/.test(value);
        const hasUpper = /[A-Z]/.test(value);
        const hasDigit = /\d/.test(value);
        const hasSymbol = /[^A-Za-z0-9]/.test(value);

        // Count how many character categories are present
        const categories = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;

        // Detect common weak patterns
        const lower = value.toLowerCase();
        const commonPatterns = [
            "123456", "654321", "111111", "000000", "888888",
            "abcdef", "qwerty", "password", "abc123", "admin",
            "letmein", "welcome", "monkey", "dragon", "master",
        ];
        const hasCommonPattern = commonPatterns.some((p) => lower.includes(p));

        // Detect too many repeated characters (e.g. "aaaaaa")
        const maxRepeat = value.split("").reduce((max, ch, i, arr) => {
            if (i === 0) return 1;
            const run = arr[i] === arr[i - 1] ? (max === i ? max + 1 : 2) : 1;
            return Math.max(max, run);
        }, 0);
        const tooManyRepeats = maxRepeat >= Math.max(3, Math.ceil(value.length * 0.5));

        // Detect sequential runs (abc, 123, cba, 321)
        let maxSeq = 1;
        let curSeq = 1;
        for (let i = 1; i < value.length; i++) {
            const diff = value.charCodeAt(i) - value.charCodeAt(i - 1);
            if (diff === 1 || diff === -1) {
                curSeq++;
                maxSeq = Math.max(maxSeq, curSeq);
            } else {
                curSeq = 1;
            }
        }
        const tooSequential = maxSeq >= Math.max(4, Math.ceil(value.length * 0.6));

        // Build score with weighted factors
        let score = 0;

        // Length contribution (0-3 points)
        if (value.length >= 6) score += 1;
        if (value.length >= 10) score += 1;
        if (value.length >= 14) score += 1;

        // Category diversity (0-3 points)
        if (categories >= 2) score += 1;
        if (categories >= 3) score += 1;
        if (categories >= 4) score += 1;

        // Penalties
        if (hasCommonPattern) score = Math.max(0, score - 2);
        if (tooManyRepeats) score = Math.max(0, score - 2);
        if (tooSequential) score = Math.max(0, score - 1);
        if (categories <= 1 && value.length < 10) score = Math.min(score, 1);
        if (invalid && value.length > 0) score = Math.min(score, 1);

        // Determine level
        let level = "weak";
        let label = "弱";
        if (value.length === 0) {
            label = "未输入";
        } else if (score >= 5) {
            level = "strong";
            label = "强";
        } else if (score >= 3) {
            level = "medium";
            label = "中";
        }

        return {
            score,
            level,
            label,
            hasLower,
            hasUpper,
            hasDigit,
            hasSymbol,
            categories,
            length: value.length,
            valid: !invalid,
            error: invalid ? validatePasswordInput(value, username) : "",
        };
    }

    function postForm(url, formData) {
        return request(url, {
            method: "POST",
            body: formData,
        });
    }

    function del(url) {
        return request(url, {
            method: "DELETE",
        });
    }

    function fmtNumber(value) {
        const num = Number(value) || 0;
        return num.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    }

    function fmtTime(value) {
        if (!value) return "-";
        const d = new Date(String(value).replace(" ", "T") + "Z");
        if (Number.isNaN(d.getTime())) return String(value);
        return d.toLocaleString("zh-CN", { hour12: false });
    }

    function notify(message, isError = false) {
        const id = "global-toast";
        let toast = document.getElementById(id);

        if (!toast) {
            toast = document.createElement("div");
            toast.id = id;
            toast.style.position = "fixed";
            toast.style.right = "16px";
            toast.style.bottom = "16px";
            toast.style.zIndex = "3000";
            toast.style.padding = "10px 14px";
            toast.style.borderRadius = "12px";
            toast.style.fontWeight = "700";
            toast.style.color = "#fff";
            toast.style.boxShadow = "0 16px 30px rgba(15,23,42,0.18)";
            toast.style.backdropFilter = "blur(10px)";
            toast.style.transition = "opacity .25s ease, transform .25s ease";
            toast.style.transform = "translateY(6px)";
            document.body.appendChild(toast);
        }

        toast.style.background = isError
            ? "linear-gradient(135deg, #dc2626, #ef4444)"
            : "linear-gradient(135deg, #2563eb, #0ea5e9)";
        toast.textContent = message;
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)";

        clearTimeout(toast.__timer);
        toast.__timer = setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transform = "translateY(6px)";
        }, 2200);
    }

    function normalizeUserType(userType) {
        const value = String(userType || "").trim().toLowerCase();
        if (value === "normal_user" || value === "admin" || value === "super_admin") return value;
        return "normal_user";
    }

    function isAdminType(userType) {
        const value = normalizeUserType(userType);
        return value === "admin" || value === "super_admin";
    }

    function isSuperAdminType(userType) {
        return normalizeUserType(userType) === "super_admin";
    }

    function userTypeLabel(userType) {
        const value = normalizeUserType(userType);
        if (value === "super_admin") return "超级管理员";
        if (value === "admin") return "管理员";
        return "普通账户";
    }

    function getMapKey() {
        return String(window.__WEBGIS_MAP_KEY__ || "").trim();
    }

    function getTiandituLayerConfig(layer) {
        const safeLayer = ["vec", "cva", "img", "cia"].includes(String(layer || "").toLowerCase())
            ? String(layer).toLowerCase()
            : "vec";
        const key = getMapKey();
        if (!key) return null;
        return {
            url: `https://t{s}.tianditu.gov.cn/${safeLayer}_w/wmts?service=wmts&request=GetTile&version=1.0.0&layer=${safeLayer}&style=default&tilematrixset=w&format=tiles&tilematrix={z}&tilerow={y}&tilecol={x}&tk=${encodeURIComponent(key)}`,
            options: {
                subdomains: ["0", "1", "2", "3", "4", "5", "6", "7"],
                maxZoom: 18,
                crossOrigin: true,
            },
        };
    }

    window.api = {
        get,
        postJson,
        postJsonSecure,
        validatePasswordInput,
        passwordStrength,
        postForm,
        del,
        fmtNumber,
        fmtTime,
        notify,
        getThemePreference,
        getTheme: resolveAppliedTheme,
        setTheme,
        toggleTheme,
        applyTheme,
        getMapKey,
        getTiandituLayerConfig,
        normalizeUserType,
        isAdminType,
        isSuperAdminType,
        userTypeLabel,
    };
})();

