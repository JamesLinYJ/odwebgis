const { useEffect, useMemo, useState } = React;

function PasswordStrengthBar({ password, username = "" }) {
    const info = useMemo(() => api.passwordStrength(password, username), [password, username]);
    const widthMap = { weak: "33%", medium: "66%", strong: "100%" };
    const colorMap = {
        weak: "bg-rose-500",
        medium: "bg-amber-500",
        strong: "bg-emerald-500",
    };

    if (!password) {
        return <div className="text-[11px] font-semibold text-slate-500">密码强度：未输入</div>;
    }

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

function AuthApp() {
    const [tab, setTab] = useState("login");
    const [loading, setLoading] = useState(false);
    const [loginForm, setLoginForm] = useState({ username: "", password: "" });
    const [guestForm, setGuestForm] = useState({ name: "" });
    const [registerForm, setRegisterForm] = useState({
        name: "",
        username: "",
        password: "",
        password_confirm: "",
    });

    useEffect(() => {
        api.get("/api/auth/me")
            .then((res) => {
                const user = res.user || null;
                if (!user) return;
                window.location.href = user.user_type === "admin" ? "/admin" : "/";
            })
            .catch(() => {
                // ignore
            });
    }, []);

    async function submitLogin(e) {
        e.preventDefault();
        if (!loginForm.username.trim() || !loginForm.password) {
            api.notify("请输入用户名和密码", true);
            return;
        }
        setLoading(true);
        try {
            const res = await api.postJsonSecure("/api/auth/login", {
                username: loginForm.username.trim(),
                password: loginForm.password,
            });
            api.notify("登录成功");
            window.location.href = res.redirect || "/";
        } catch (err) {
            api.notify(err.message || "登录失败，请检查账号或密码", true);
        } finally {
            setLoading(false);
        }
    }

    async function submitRegister(e) {
        e.preventDefault();
        if (!registerForm.name.trim()) {
            api.notify("请输入姓名", true);
            return;
        }
        if (!registerForm.username.trim()) {
            api.notify("请输入用户名", true);
            return;
        }
        if (registerForm.password !== registerForm.password_confirm) {
            api.notify("两次输入的密码不一致", true);
            return;
        }

        const passwordErr = api.validatePasswordInput(registerForm.password, registerForm.username);
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setLoading(true);
        try {
            await api.postJsonSecure("/api/auth/register", {
                name: registerForm.name.trim(),
                username: registerForm.username.trim(),
                password: registerForm.password,
            });
            api.notify("注册成功，正在进入平台");
            window.location.href = "/";
        } catch (err) {
            api.notify(err.message || "注册失败，请稍后重试", true);
        } finally {
            setLoading(false);
        }
    }

    async function submitGuest(e) {
        e.preventDefault();
        const name = guestForm.name.trim();
        if (!name) {
            api.notify("请输入姓名", true);
            return;
        }

        setLoading(true);
        try {
            const res = await api.postJson("/api/auth/guest-login", { name });
            api.notify("已进入访客模式");
            window.location.href = res.redirect || "/";
        } catch (err) {
            api.notify(err.message || "访客进入失败，请稍后重试", true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="mx-auto flex min-h-screen max-w-[460px] items-center justify-center p-3 sm:p-6 ios-fade-up">
            <div className="ios-card w-full overflow-hidden rounded-[1.4rem] border border-blue-100 bg-white/80 shadow-soft sm:rounded-[2rem]">
                <section className="p-4 sm:p-10">
                    <div className="mb-2 text-3xl font-black tracking-tight text-brand-700">账户入口</div>
                    <div className="mb-6 text-sm font-semibold text-slate-500">登录、注册或访客进入</div>

                    <div className="ios-tab-switch mb-6 grid grid-cols-3 gap-1 rounded-2xl bg-blue-50/50 p-1.5">
                        <button
                            type="button"
                            onClick={() => setTab("login")}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition-all sm:px-4 sm:py-2.5 sm:text-sm ${tab === "login" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("register")}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition-all sm:px-4 sm:py-2.5 sm:text-sm ${tab === "register" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            注册
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("guest")}
                            className={`rounded-xl px-3 py-2 text-xs font-bold transition-all sm:px-4 sm:py-2.5 sm:text-sm ${tab === "guest" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            访客
                        </button>
                    </div>

                    <div className="grid min-h-[300px] overflow-hidden sm:min-h-[340px]">
                        <form
                            onSubmit={submitLogin}
                            className={`ios-tab-pane ${tab === "login" ? "ios-tab-pane-active" : "ios-tab-pane-hidden-left pointer-events-none"}`}
                            style={{ position: "relative", gridArea: "1 / 1" }}
                        >
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">用户名</label>
                                    <input
                                        required
                                        value={loginForm.username}
                                        onChange={(e) => setLoginForm((prev) => ({ ...prev, username: e.target.value }))}
                                        className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="请输入用户名"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">密码</label>
                                    <input
                                        required
                                        type="password"
                                        value={loginForm.password}
                                        onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                                        className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="请输入密码"
                                    />
                                </div>
                                <button
                                    disabled={loading}
                                    className="btn-primary mt-2 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                                >
                                    {loading ? "登录中..." : "登录"}
                                </button>
                            </div>
                        </form>

                        <form
                            onSubmit={submitRegister}
                            className={`ios-tab-pane ${tab === "register" ? "ios-tab-pane-active" : "ios-tab-pane-hidden-right pointer-events-none"}`}
                            style={{ position: "relative", gridArea: "1 / 1" }}
                        >
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">姓名</label>
                                    <input
                                        required
                                        value={registerForm.name}
                                        onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="请输入姓名"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">用户名</label>
                                    <input
                                        required
                                        value={registerForm.username}
                                        onChange={(e) => setRegisterForm((prev) => ({ ...prev, username: e.target.value }))}
                                        className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="3-24 位，支持字母/数字/下划线"
                                    />
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-slate-500">密码</label>
                                        <input
                                            required
                                            type="password"
                                            value={registerForm.password}
                                            onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
                                            className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                            placeholder="6-64 位，支持特殊字符"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs font-bold text-slate-500">确认密码</label>
                                        <input
                                            required
                                            type="password"
                                            value={registerForm.password_confirm}
                                            onChange={(e) => setRegisterForm((prev) => ({ ...prev, password_confirm: e.target.value }))}
                                            className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                            placeholder="请再次输入密码"
                                        />
                                    </div>
                                </div>
                                <PasswordStrengthBar password={registerForm.password} username={registerForm.username} />
                                <button
                                    disabled={loading}
                                    className="btn-primary mt-2 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                                >
                                    {loading ? "注册中..." : "注册"}
                                </button>
                            </div>
                        </form>

                        <form
                            onSubmit={submitGuest}
                            className={`ios-tab-pane ${tab === "guest" ? "ios-tab-pane-active" : "ios-tab-pane-hidden-right pointer-events-none"}`}
                            style={{ position: "relative", gridArea: "1 / 1" }}
                        >
                            <div className="space-y-3">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">姓名</label>
                                    <input
                                        required
                                        maxLength={32}
                                        value={guestForm.name}
                                        onChange={(e) => setGuestForm((prev) => ({ ...prev, name: e.target.value }))}
                                        className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                        placeholder="输入姓名后进入访客模式"
                                    />
                                </div>
                                <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-semibold text-slate-600">
                                    访客可直接进入学生页面并录入线路，数据将以访客身份保存。
                                </div>
                                <button
                                    disabled={loading}
                                    className="btn-primary mt-2 w-full rounded-xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
                                >
                                    {loading ? "进入中..." : "进入访客模式"}
                                </button>
                            </div>
                        </form>
                    </div>
                </section>
            </div>
        </div>
    );
}

const authRootNode = document.getElementById("app");
if (ReactDOM.createRoot) {
    ReactDOM.createRoot(authRootNode).render(<AuthApp />);
} else {
    ReactDOM.render(<AuthApp />, authRootNode);
}
