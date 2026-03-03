const { useEffect, useMemo, useState } = React;

function PasswordStrengthBar({ password, username = "" }) {
    const info = useMemo(() => api.passwordStrength(password, username), [password, username]);
    const widthMap = { weak: "33%", medium: "66%", strong: "100%" };
    const colorMap = {
        weak: "bg-rose-500",
        medium: "bg-amber-500",
        strong: "bg-emerald-500",
    };

    if (!password) return <div className="text-[11px] font-semibold text-slate-500">密码强度：未输入</div>;

    return (
        <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                    className={`h-full ${colorMap[info.level] || "bg-rose-500"} transition-all duration-500`}
                    style={{ width: widthMap[info.level] || "33%" }}
                />
            </div>
            <div className="text-[11px] font-semibold text-slate-600">密码强度：{info.label}</div>
            {info.error && <div className="text-[11px] font-semibold text-rose-600">{info.error}</div>}
        </div>
    );
}

function AccountApp() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [user, setUser] = useState(null);
    const [themeMode, setThemeMode] = useState(api.getTheme(api.getThemePreference()));
    const [form, setForm] = useState({
        old_password: "",
        new_password: "",
        confirm_password: "",
    });

    async function loadMe() {
        try {
            const res = await api.get("/api/auth/me");
            const me = res.user || null;
            if (!me) {
                window.location.href = "/auth";
                return;
            }
            setUser(me);
        } catch {
            window.location.href = "/auth";
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadMe();
    }, []);

    useEffect(() => {
        const onThemeChange = (event) => {
            setThemeMode(event?.detail?.theme || api.getTheme(api.getThemePreference()));
        };
        window.addEventListener("webgis-theme-change", onThemeChange);
        return () => window.removeEventListener("webgis-theme-change", onThemeChange);
    }, []);

    async function submitPassword(e) {
        e.preventDefault();
        if (!form.old_password || !form.new_password || !form.confirm_password) {
            api.notify("请完整填写密码信息", true);
            return;
        }
        if (form.new_password !== form.confirm_password) {
            api.notify("两次输入的新密码不一致", true);
            return;
        }

        const passwordErr = api.validatePasswordInput(form.new_password, user?.username || "");
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setSaving(true);
        try {
            await api.postJsonSecure("/api/auth/change-password", {
                old_password: form.old_password,
                new_password: form.new_password,
            });
            api.notify("密码已更新");
            setForm({
                old_password: "",
                new_password: "",
                confirm_password: "",
            });
            await loadMe();
        } catch (err) {
            api.notify(err.message || "修改失败，请稍后重试", true);
        } finally {
            setSaving(false);
        }
    }

    async function logout() {
        try {
            await api.postJson("/api/auth/logout", {});
        } catch {
            // ignore
        }
        window.location.href = "/auth";
    }

    function backToMain() {
        if (!user) return;
        window.location.href = user.user_type === "admin" ? "/admin" : "/";
    }

    function toggleThemeMode() {
        const next = api.toggleTheme();
        setThemeMode(next);
    }

    return (
        <div className="mx-auto max-w-[860px] p-2.5 sm:p-4 ios-fade-up">
            <header className="ios-card mb-4 rounded-[1.4rem] border border-blue-100 bg-white/80 px-4 py-4 shadow-soft sm:rounded-[2rem] sm:px-6 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-2xl font-black text-brand-700">账户中心</div>
                        <div className="text-xs font-semibold text-slate-500">查看账号信息并管理密码</div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                        <button
                            type="button"
                            onClick={backToMain}
                            className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 transition-all hover:bg-blue-50"
                        >
                            返回主页
                        </button>
                        <button
                            type="button"
                            onClick={toggleThemeMode}
                            className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-brand-700 transition-all hover:bg-blue-50"
                        >
                            {themeMode === "dark" ? "浅色模式" : "深色模式"}
                        </button>
                        <button
                            type="button"
                            onClick={logout}
                            className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-bold text-rose-600 transition-all hover:bg-rose-50"
                        >
                            退出登录
                        </button>
                    </div>
                </div>
            </header>

            <main className="ios-card rounded-[1.4rem] border border-blue-100 bg-white/80 p-4 shadow-soft sm:rounded-[2rem] sm:p-6">
                {loading && <div className="text-sm font-semibold text-slate-500">正在加载账户信息...</div>}
                {!loading && user && (
                    <div className="space-y-4">
                        <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4 sm:p-5">
                            <div className="text-lg font-black text-brand-700">{user.name}</div>
                            {!user.is_guest && (
                                <div className="mt-1 text-xs font-semibold text-slate-600">
                                    用户名：{user.username || "-"}
                                </div>
                            )}
                            <div className="mt-1 text-xs font-semibold text-slate-600">
                                角色：{user.is_guest ? "访客" : user.user_type === "admin" ? "管理员" : "学生"}
                            </div>
                            {user.must_change_password && (
                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                                    当前账户需要先修改密码后继续使用。
                                </div>
                            )}
                            {user.is_system_admin && (
                                <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
                                    系统后台账户密码由部署环境统一管理。
                                </div>
                            )}
                            {user.is_guest && (
                                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-600">
                                    访客账号无需设置密码，退出后可再次以访客身份进入。
                                </div>
                            )}
                        </div>

                        {!user.is_system_admin && !user.is_guest && (
                            <form onSubmit={submitPassword} className="space-y-4 rounded-2xl border border-blue-100 bg-white/80 p-4 shadow-sm sm:p-5">
                                <div className="mb-2 text-lg font-black text-brand-700">修改密码</div>
                                <input
                                    required
                                    type="password"
                                    value={form.old_password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, old_password: e.target.value }))}
                                    className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                    placeholder="当前密码"
                                />
                                <input
                                    required
                                    type="password"
                                    value={form.new_password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, new_password: e.target.value }))}
                                    className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                    placeholder="新密码（6-64 位，支持特殊字符）"
                                />
                                <input
                                    required
                                    type="password"
                                    value={form.confirm_password}
                                    onChange={(e) => setForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
                                    className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                    placeholder="再次输入新密码"
                                />
                                <PasswordStrengthBar password={form.new_password} username={user.username || ""} />
                                <button
                                    disabled={saving}
                                    className="btn-primary mt-2 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                                >
                                    {saving ? "提交中..." : "确认修改密码"}
                                </button>
                            </form>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}

const accountRootNode = document.getElementById("app");
if (ReactDOM.createRoot) {
    ReactDOM.createRoot(accountRootNode).render(<AccountApp />);
} else {
    ReactDOM.render(<AccountApp />, accountRootNode);
}
