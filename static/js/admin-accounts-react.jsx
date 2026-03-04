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

function AdminAccountsApp() {
    const [loading, setLoading] = useState(true);
    const [me, setMe] = useState(null);
    const [accounts, setAccounts] = useState([]);
    const [canManagePrivileged, setCanManagePrivileged] = useState(false);
    const [themeMode, setThemeMode] = useState(api.getTheme(api.getThemePreference()));
    const [filter, setFilter] = useState({ q: "", user_type: "all" });
    const [form, setForm] = useState({
        name: "",
        username: "",
        password: "",
        user_type: "normal_user",
    });
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [deleteBusyId, setDeleteBusyId] = useState(null);
    const [resetModal, setResetModal] = useState({
        open: false,
        account: null,
        password: "",
        confirm: "",
        saving: false,
    });

    const visibleAccounts = useMemo(() => {
        const q = filter.q.trim().toLowerCase();
        return accounts.filter((acc) => {
            if (filter.user_type !== "all" && acc.user_type !== filter.user_type) return false;
            if (!q) return true;
            const text = [acc.name, acc.username, acc.role, acc.status].filter(Boolean).join(" ").toLowerCase();
            return text.includes(q);
        });
    }, [accounts, filter]);

    async function loadMeAndGuard() {
        const res = await api.get("/api/auth/me");
        const user = res.user || null;
        if (!user) throw new Error("未登录");
        if (!api.isAdminType(user.user_type)) throw new Error("无管理员权限");
        setMe(user);
        const allowPrivileged = !!(user.is_system_admin || api.isSuperAdminType(user.user_type));
        setCanManagePrivileged(allowPrivileged);
        setFilter((prev) => ({ ...prev, user_type: allowPrivileged ? prev.user_type : (prev.user_type === "all" || prev.user_type === "normal_user" ? prev.user_type : "normal_user") }));
        setForm((prev) => ({ ...prev, user_type: allowPrivileged ? "super_admin" : "normal_user" }));
    }

    async function loadAccounts() {
        const params = new URLSearchParams();
        if (filter.q) params.set("q", filter.q);
        if (filter.user_type !== "all") params.set("user_type", filter.user_type);
        const query = params.toString();
        const res = await api.get(`/api/admin/accounts${query ? `?${query}` : ""}`);
        setAccounts(res.accounts || []);
        if (typeof res.can_manage_privileged === "boolean") {
            setCanManagePrivileged(res.can_manage_privileged);
            if (!res.can_manage_privileged) {
                setFilter((prev) => ({ ...prev, user_type: prev.user_type === "all" || prev.user_type === "normal_user" ? prev.user_type : "normal_user" }));
                setForm((prev) => ({ ...prev, user_type: "normal_user" }));
            }
        }
    }

    async function bootstrap() {
        setLoading(true);
        try {
            await loadMeAndGuard();
            await loadAccounts();
        } catch (err) {
            const msg = err.message || "";
            if (msg.includes("未登录")) {
                window.location.href = "/auth";
                return;
            }
            if (msg.includes("无管理员权限")) {
                window.location.href = "/";
                return;
            }
            api.notify(msg || "初始化失败", true);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        bootstrap();
    }, []);

    useEffect(() => {
        const onThemeChange = (event) => {
            setThemeMode(event?.detail?.theme || api.getTheme(api.getThemePreference()));
        };
        window.addEventListener("webgis-theme-change", onThemeChange);
        return () => window.removeEventListener("webgis-theme-change", onThemeChange);
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            loadAccounts().catch((err) => api.notify(err.message || "加载账户失败", true));
        }, 220);
        return () => clearTimeout(timer);
    }, [filter]);

    async function createAccount(e) {
        e.preventDefault();
        if (!form.name.trim()) {
            api.notify("请输入姓名", true);
            return;
        }
        if (!form.username.trim()) {
            api.notify("请输入用户名", true);
            return;
        }
        const passwordErr = api.validatePasswordInput(form.password, form.username);
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }
        if (!canManagePrivileged && form.user_type !== "normal_user") {
            api.notify("仅超级管理员可创建管理账户", true);
            return;
        }

        setFormSubmitting(true);
        try {
            await api.postJsonSecure("/api/admin/accounts", {
                name: form.name.trim(),
                username: form.username.trim(),
                password: form.password,
                user_type: form.user_type,
            });
            api.notify("账户创建成功");
            setForm({ name: "", username: "", password: "", user_type: canManagePrivileged ? "super_admin" : "normal_user" });
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "创建失败，请稍后重试", true);
        } finally {
            setFormSubmitting(false);
        }
    }

    async function removeAccount(acc) {
        const target = `${acc.name}（${acc.username || "-"}）`;
        if (!window.confirm(`确认删除账户 ${target}？该账户的所有线路也会一并删除。`)) return;
        setDeleteBusyId(acc.id);
        try {
            await api.del(`/api/admin/accounts/${acc.id}`);
            api.notify("账户已删除");
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "删除失败，请稍后重试", true);
        } finally {
            setDeleteBusyId(null);
        }
    }

    function openResetModal(acc) {
        setResetModal({
            open: true,
            account: acc,
            password: "",
            confirm: "",
            saving: false,
        });
    }

    function closeResetModal() {
        setResetModal({
            open: false,
            account: null,
            password: "",
            confirm: "",
            saving: false,
        });
    }

    async function submitResetPassword(e) {
        e.preventDefault();
        if (!resetModal.account) return;
        if (resetModal.password !== resetModal.confirm) {
            api.notify("两次输入的新密码不一致", true);
            return;
        }
        const username = resetModal.account.username || "";
        const passwordErr = api.validatePasswordInput(resetModal.password, username);
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setResetModal((prev) => ({ ...prev, saving: true }));
        try {
            await api.postJsonSecure(`/api/admin/accounts/${resetModal.account.id}/reset-password`, {
                new_password: resetModal.password,
            });
            api.notify("密码已重置，目标账户下次登录将被提示修改密码");
            closeResetModal();
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "重置失败，请稍后重试", true);
            setResetModal((prev) => ({ ...prev, saving: false }));
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

    function toggleThemeMode() {
        const next = api.toggleTheme();
        setThemeMode(next);
    }

    return (
        <div className="mx-auto max-w-[1400px] p-2.5 sm:p-5 ios-fade-up">
            <header className="ios-card mb-5 rounded-[1.4rem] border border-blue-100 bg-white/80 px-4 py-4 shadow-soft sm:rounded-[2rem] sm:px-6 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-2xl font-black text-admin-600">账户管理</div>
                        <div className="text-xs font-semibold text-slate-500">管理普通与管理员账户</div>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
                        <a
                            href="/api/export/accounts-csv"
                            className="rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50"
                        >
                            导出账户列表 CSV
                        </a>
                        <button
                            type="button"
                            onClick={() => (window.location.href = "/admin")}
                            className="rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50"
                        >
                            返回管理后台
                        </button>
                        <button
                            type="button"
                            onClick={() => (window.location.href = "/account")}
                            className="rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50"
                        >
                            我的账户
                        </button>
                        <button
                            type="button"
                            onClick={toggleThemeMode}
                            className="rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50"
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

            <main className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.5fr]">
                <section className="ios-card h-fit rounded-[1.4rem] border border-blue-100 bg-white/80 p-4 shadow-soft sm:rounded-[2rem] sm:p-6">
                    <div className="mb-4 text-lg font-black text-admin-600">新增账户</div>
                    <form onSubmit={createAccount} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                            required
                            value={form.name}
                            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-3 text-sm"
                            placeholder="姓名"
                        />
                        <select
                            value={form.user_type}
                            onChange={(e) => setForm((prev) => ({ ...prev, user_type: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-3 text-sm"
                        >
                            <option value="normal_user">普通账户</option>
                            {canManagePrivileged && <option value="super_admin">超级管理员账户</option>}
                        </select>
                        <input
                            required
                            value={form.username}
                            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-3 text-sm sm:col-span-2"
                            placeholder="用户名"
                        />
                        <input
                            required
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-3 text-sm sm:col-span-2"
                            placeholder="初始密码（6-64 位，支持特殊字符）"
                        />
                        <div className="px-1 sm:col-span-2">
                            <PasswordStrengthBar password={form.password} username={form.username} />
                        </div>
                        <button
                            disabled={formSubmitting}
                            className="btn-primary mt-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-60 sm:col-span-2"
                        >
                            {formSubmitting ? "创建中..." : "创建账户"}
                        </button>
                    </form>
                </section>

                <section className="ios-card flex h-auto flex-col rounded-[1.4rem] border border-blue-100 bg-white/80 p-4 shadow-soft sm:rounded-[2rem] sm:p-6 lg:h-[min(85vh,900px)]">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-lg font-black text-admin-600">账户列表</div>
                        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-admin-600">
                            共 {api.fmtNumber(visibleAccounts.length)} 个
                        </span>
                    </div>

                    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <input
                            value={filter.q}
                            onChange={(e) => setFilter((prev) => ({ ...prev, q: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-2.5 text-sm sm:col-span-2"
                            placeholder="搜索姓名、用户名或状态"
                        />
                        <select
                            value={filter.user_type}
                            onChange={(e) => setFilter((prev) => ({ ...prev, user_type: e.target.value }))}
                            className="modern-input rounded-xl px-4 py-2.5 text-sm"
                        >
                            <option value="all">角色：全部</option>
                            <option value="normal_user">普通账户</option>
                            {canManagePrivileged && <option value="super_admin">超级管理员</option>}
                        </select>
                    </div>

                    <div className="flex-1 space-y-2.5 overflow-auto pr-1 sm:pr-2">
                        {visibleAccounts.map((acc) => (
                            <div key={acc.id} className="rounded-2xl border border-blue-100 bg-white/60 p-3 shadow-sm transition-all hover:border-admin-200 hover:bg-white hover:shadow-md sm:p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-base font-bold text-slate-800">{acc.name}</div>
                                        <div className="mt-1 truncate text-xs font-semibold text-slate-500">
                                            用户名：{acc.username || "-"} | {api.userTypeLabel(acc.user_type)}
                                        </div>
                                        <div className="truncate text-xs font-semibold text-slate-500">
                                            状态：{acc.status} | 路线：{api.fmtNumber(acc.route_count)} 条
                                        </div>
                                    </div>
                                    <div className="text-right text-[11px] font-bold text-slate-400">ID {acc.id}</div>
                                </div>
                                <div className="mt-3 flex flex-wrap items-center justify-end gap-2 sm:mt-4 sm:gap-3">
                                    {(canManagePrivileged || acc.user_type === "normal_user") && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => openResetModal(acc)}
                                                className="rounded-xl border border-admin-200 bg-white px-4 py-2 text-xs font-bold text-admin-600 transition-all hover:bg-admin-50"
                                            >
                                                重置密码
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeAccount(acc)}
                                                disabled={deleteBusyId === acc.id}
                                                className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-xs font-bold text-rose-600 transition-all hover:bg-rose-50 disabled:opacity-60"
                                            >
                                                {deleteBusyId === acc.id ? "删除中..." : "删除账户"}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                        {visibleAccounts.length === 0 && (
                            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm font-semibold text-slate-500">
                                没有匹配的账户
                            </div>
                        )}
                    </div>
                </section>
            </main>

            {resetModal.open && (
                <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-md">
                    <form
                        onSubmit={submitResetPassword}
                        className="ios-card w-[min(92vw,440px)] rounded-[2rem] border border-blue-100 bg-white/90 p-6 shadow-soft"
                    >
                        <div className="mb-2 text-xl font-black text-admin-600">重置密码</div>
                        <div className="mb-4 text-sm font-semibold text-slate-500">
                            目标账户：{resetModal.account?.name}（{resetModal.account?.username || "-"}）
                        </div>
                        <div className="space-y-4">
                            <input
                                required
                                type="password"
                                value={resetModal.password}
                                onChange={(e) => setResetModal((prev) => ({ ...prev, password: e.target.value }))}
                                className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                placeholder="新密码（6-64 位，支持特殊字符）"
                            />
                            <input
                                required
                                type="password"
                                value={resetModal.confirm}
                                onChange={(e) => setResetModal((prev) => ({ ...prev, confirm: e.target.value }))}
                                className="modern-input w-full rounded-xl px-4 py-3 text-sm"
                                placeholder="再次输入新密码"
                            />
                            <div className="px-1">
                                <PasswordStrengthBar
                                    password={resetModal.password}
                                    username={resetModal.account?.username || ""}
                                />
                            </div>
                        </div>
                        <div className="mt-5 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={closeResetModal}
                                className="rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50"
                            >
                                取消
                            </button>
                            <button
                                disabled={resetModal.saving}
                                className="btn-primary rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-60"
                            >
                                {resetModal.saving ? "提交中..." : "确认重置"}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading && (
                <div className="pointer-events-none fixed inset-0 z-[1200] flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                    <div className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-bold text-admin-600 shadow-soft">
                        正在加载...
                    </div>
                </div>
            )}
        </div>
    );
}

const adminAccountsRootNode = document.getElementById("app");
if (ReactDOM.createRoot) {
    ReactDOM.createRoot(adminAccountsRootNode).render(<AdminAccountsApp />);
} else {
    ReactDOM.render(<AdminAccountsApp />, adminAccountsRootNode);
}

