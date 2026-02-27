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
            <div className="text-[11px] font-semibold text-slate-600">
                密码强度：{info.label}
            </div>
            {info.error && <div className="text-[11px] font-semibold text-rose-600">{info.error}</div>}
        </div>
    );
}

function AuthApp() {
    const [tab, setTab] = useState("login");
    const [loading, setLoading] = useState(false);
    const [loginForm, setLoginForm] = useState({ account: "", password: "" });
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
                // 未登录留在当前页
            });
    }, []);

    async function submitLogin(e) {
        e.preventDefault();
        if (!loginForm.account.trim() || !loginForm.password) {
            api.notify("请输入用户名和密码", true);
            return;
        }
        setLoading(true);
        try {
            const res = await api.postJsonSecure("/api/auth/login", {
                account: loginForm.account.trim(),
                password: loginForm.password,
            });
            api.notify("登录成功");
            window.location.href = res.redirect || "/";
        } catch (err) {
            api.notify(err.message || "登录失败", true);
        } finally {
            setLoading(false);
        }
    }

    async function submitRegister(e) {
        e.preventDefault();
        if (registerForm.password !== registerForm.password_confirm) {
            api.notify("两次密码输入不一致", true);
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
            api.notify("注册成功");
            window.location.href = "/";
        } catch (err) {
            api.notify(err.message || "注册失败", true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="mx-auto flex min-h-screen max-w-[560px] items-center justify-center p-3 sm:p-4 ios-fade-up">
            <div className="ios-card w-full overflow-hidden rounded-3xl border border-blue-100 bg-white/95 shadow-soft">
                <section className="p-6 sm:p-8">
                    <div className="mb-2 text-2xl font-black text-blue-700">登录 / 注册</div>
                    <div className="mb-5 text-xs font-semibold text-slate-500">请输入用户名与密码</div>

                    <div className="mb-5 flex rounded-xl bg-blue-50 p-1">
                        <button
                            type="button"
                            onClick={() => setTab("login")}
                            className={`w-1/2 rounded-lg px-3 py-2 text-sm font-bold ${tab === "login" ? "bg-white text-blue-700 shadow" : "text-slate-500"}`}
                        >
                            登录
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("register")}
                            className={`w-1/2 rounded-lg px-3 py-2 text-sm font-bold ${tab === "register" ? "bg-white text-blue-700 shadow" : "text-slate-500"}`}
                        >
                            注册
                        </button>
                    </div>

                    {tab === "login" && (
                        <form onSubmit={submitLogin} className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500">用户名</label>
                                <input
                                    required
                                    value={loginForm.account}
                                    onChange={(e) => setLoginForm((p) => ({ ...p, account: e.target.value }))}
                                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    placeholder="请输入用户名"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500">密码</label>
                                <input
                                    required
                                    type="password"
                                    value={loginForm.password}
                                    onChange={(e) => setLoginForm((p) => ({ ...p, password: e.target.value }))}
                                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    placeholder="请输入密码"
                                />
                            </div>
                            <button
                                disabled={loading}
                                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                            >
                                {loading ? "提交中..." : "登录"}
                            </button>
                        </form>
                    )}

                    {tab === "register" && (
                        <form onSubmit={submitRegister} className="space-y-3">
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500">姓名</label>
                                <input
                                    required
                                    value={registerForm.name}
                                    onChange={(e) => setRegisterForm((p) => ({ ...p, name: e.target.value }))}
                                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    placeholder="请输入姓名"
                                />
                            </div>
                            <div>
                                <label className="mb-1 block text-xs font-bold text-slate-500">用户名</label>
                                <input
                                    required
                                    value={registerForm.username}
                                    onChange={(e) => setRegisterForm((p) => ({ ...p, username: e.target.value }))}
                                    className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                    placeholder="3-24 位"
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">密码</label>
                                    <input
                                        required
                                        type="password"
                                        value={registerForm.password}
                                        onChange={(e) => setRegisterForm((p) => ({ ...p, password: e.target.value }))}
                                        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                        placeholder="8-64 位，支持特殊符号"
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs font-bold text-slate-500">确认密码</label>
                                    <input
                                        required
                                        type="password"
                                        value={registerForm.password_confirm}
                                        onChange={(e) => setRegisterForm((p) => ({ ...p, password_confirm: e.target.value }))}
                                        className="w-full rounded-xl border border-blue-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
                                        placeholder="再次输入密码"
                                    />
                                </div>
                            </div>
                            <PasswordStrengthBar password={registerForm.password} username={registerForm.username} />
                            <button
                                disabled={loading}
                                className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                            >
                                {loading ? "提交中..." : "注册"}
                            </button>
                        </form>
                    )}
                </section>
            </div>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("app")).render(<AuthApp />);
