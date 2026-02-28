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

    async function submitPassword(e) {
        e.preventDefault();
        if (!form.old_password || !form.new_password || !form.confirm_password) {
            api.notify("请完整填写密码", true);
            return;
        }
        if (form.new_password !== form.confirm_password) {
            api.notify("两次新密码不一致", true);
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
            api.notify("密码修改成功");
            setForm({
                old_password: "",
                new_password: "",
                confirm_password: "",
            });
            await loadMe();
        } catch (err) {
            api.notify(err.message || "密码修改失败", true);
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

    return (
        <div className="mx-auto max-w-[860px] p-3 sm:p-4 ios-fade-up">
            <header className="ios-card mb-3 rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-2xl font-black text-blue-700">账户中心</div>
                        <div className="text-xs font-semibold text-slate-500">单独页面</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={backToMain}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-700"
                        >
                            返回主界面
                        </button>
                        <button
                            type="button"
                            onClick={logout}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-blue-700"
                        >
                            退出登录
                        </button>
                    </div>
                </div>
            </header>

            <main className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-soft">
                {loading && <div className="text-sm font-semibold text-slate-500">正在加载账户信息...</div>}
                {!loading && user && (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                            <div className="text-sm font-black text-blue-700">{user.name}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-600">用户名：{user.username || "-"}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-600">角色：{user.user_type === "admin" ? "管理员" : "学生"}</div>
                            {user.must_change_password && (
                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                                    当前账户需要先修改密码
                                </div>
                            )}
                            {user.is_system_admin && (
                                <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700">
                                    系统后台账号密码由部署环境统一管理
                                </div>
                            )}
                        </div>

                        {!user.is_system_admin && (
                            <form onSubmit={submitPassword} className="space-y-2 rounded-xl border border-blue-100 bg-white p-3">
                                <div className="text-sm font-black text-blue-700">修改密码</div>
                                <input
                                    required
                                    type="password"
                                    value={form.old_password}
                                    onChange={(e) => setForm((p) => ({ ...p, old_password: e.target.value }))}
                                    className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                                    placeholder="旧密码"
                                />
                                <input
                                    required
                                    type="password"
                                    value={form.new_password}
                                    onChange={(e) => setForm((p) => ({ ...p, new_password: e.target.value }))}
                                    className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                                    placeholder="8-64 位，支持特殊符号"
                                />
                                <input
                                    required
                                    type="password"
                                    value={form.confirm_password}
                                    onChange={(e) => setForm((p) => ({ ...p, confirm_password: e.target.value }))}
                                    className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                                    placeholder="确认新密码"
                                />
                                <PasswordStrengthBar password={form.new_password} username={user.username || ""} />
                                <button
                                    disabled={saving}
                                    className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
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
