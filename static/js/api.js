(function () {
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
        if (!window.crypto || !window.crypto.subtle) {
            return String(text || "");
        }
        const bytes = new TextEncoder().encode(String(text || ""));
        const digest = await window.crypto.subtle.digest("SHA-256", bytes);
        const arr = Array.from(new Uint8Array(digest));
        return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
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
        if (value.length < 8) return "密码至少 8 位";
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

        let score = 0;
        if (value.length >= 8) score += 1;
        if (value.length >= 12) score += 1;
        if (hasLower && hasUpper) score += 1;
        if (hasDigit) score += 1;
        if (hasSymbol) score += 1;
        if (invalid && value.length > 0) score = Math.min(score, 1);

        let level = "weak";
        let label = "弱";
        if (value.length === 0) {
            label = "未输入";
        } else if (score >= 4) {
            level = "strong";
            label = "强";
        } else if (score >= 2) {
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
        const d = new Date(value.replace(" ", "T") + "Z");
        if (Number.isNaN(d.getTime())) return value;
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
            toast.style.boxShadow = "0 10px 22px rgba(0,0,0,0.2)";
            document.body.appendChild(toast);
        }

        toast.style.background = isError
            ? "linear-gradient(90deg,#d94841,#ef4444)"
            : "linear-gradient(90deg,#1f6cff,#15b8f9)";
        toast.textContent = message;
        toast.style.opacity = "1";

        clearTimeout(toast.__timer);
        toast.__timer = setTimeout(() => {
            toast.style.opacity = "0";
        }, 2200);
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
    };
})();
