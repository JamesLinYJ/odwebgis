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
    const [accounts, setAccounts] = useState([]);
    const [me, setMe] = useState(null);

    const [filter, setFilter] = useState({ q: "", user_type: "all" });
    const [form, setForm] = useState({
        name: "",
        username: "",
        password: "",
        user_type: "student",
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
            const text = [acc.name, acc.username, acc.student_no, acc.role, acc.status].filter(Boolean).join(" ").toLowerCase();
            return text.includes(q);
        });
    }, [accounts, filter]);

    async function loadMe() {
        const res = await api.get("/api/auth/me");
        const user = res.user || null;
        if (!user) throw new Error("未登录");
        if (user.user_type !== "admin") throw new Error("无管理员权限");
        setMe(user);
        return user;
    }

    async function loadAccounts() {
        const params = new URLSearchParams();
        if (filter.q) params.set("q", filter.q);
        if (filter.user_type !== "all") params.set("user_type", filter.user_type);
        const query = params.toString();
        const res = await api.get(`/api/admin/accounts${query ? `?${query}` : ""}`);
        setAccounts(res.accounts || []);
    }

    async function bootstrap() {
        setLoading(true);
        try {
            await loadMe();
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
        const timer = setTimeout(() => {
            loadAccounts().catch((err) => api.notify(err.message || "加载账户失败", true));
        }, 220);
        return () => clearTimeout(timer);
    }, [filter]);

    async function createAccount(e) {
        e.preventDefault();
        if (!form.name.trim()) {
            api.notify("姓名不能为空", true);
            return;
        }
        if (!form.username.trim()) {
            api.notify("用户名不能为空", true);
            return;
        }
        const passwordErr = api.validatePasswordInput(form.password, form.username);
        if (passwordErr) {
            api.notify(passwordErr, true);
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
            setForm({ name: "", username: "", password: "", user_type: "student" });
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "创建账户失败", true);
        } finally {
            setFormSubmitting(false);
        }
    }

    async function removeAccount(acc) {
        const target = `${acc.name}（${acc.username || acc.student_no || "-"}）`;
        if (!window.confirm(`确认删除账户 ${target}？此操作会同时删除该账户的所有线路数据。`)) {
            return;
        }
        setDeleteBusyId(acc.id);
        try {
            await api.del(`/api/admin/accounts/${acc.id}`);
            api.notify("账户已删除");
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "删除失败", true);
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
            api.notify("两次新密码不一致", true);
            return;
        }
        const username = resetModal.account.username || resetModal.account.student_no || "";
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
            api.notify("密码已重置，目标账户下次登录需改密");
            closeResetModal();
            await loadAccounts();
        } catch (err) {
            api.notify(err.message || "重置失败", true);
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

    return (
        <div className="mx-auto max-w-[1200px] p-3 sm:p-4 ios-fade-up">
            <header className="ios-card mb-3 rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-2xl font-black text-admin-600">账户管理</div>
                        <div className="text-xs font-semibold text-slate-500">独立页面管理所有账户</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => (window.location.href = "/admin")}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600"
                        >
                            返回管理后台
                        </button>
                        <button
                            type="button"
                            onClick={() => (window.location.href = "/account")}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600"
                        >
                            我的账户中心
                        </button>
                        <button
                            type="button"
                            onClick={logout}
                            className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600"
                        >
                            退出登录
                        </button>
                    </div>
                </div>
            </header>

            <main className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.15fr]">
                <section className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-soft">
                    <div className="mb-2 text-sm font-black text-admin-600">新增账户</div>
                    <form onSubmit={createAccount} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                            required
                            value={form.name}
                            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                            placeholder="姓名"
                        />
                        <select
                            value={form.user_type}
                            onChange={(e) => setForm((p) => ({ ...p, user_type: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                        >
                            <option value="student">普通账户（学生）</option>
                            <option value="admin">管理员账户</option>
                        </select>
                        <input
                            required
                            value={form.username}
                            onChange={(e) => setForm((p) => ({ ...p, username: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                            placeholder="用户名"
                        />
                        <input
                            required
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                            placeholder="8-64 位，支持特殊符号"
                        />
                        <div className="sm:col-span-2">
                            <PasswordStrengthBar password={form.password} username={form.username} />
                        </div>
                        <button
                            disabled={formSubmitting}
                            className="sm:col-span-2 rounded-lg bg-admin-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
                        >
                            {formSubmitting ? "创建中..." : "创建账户"}
                        </button>
                    </form>
                </section>

                <section className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-soft">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-black text-admin-600">账户列表</div>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-admin-600">
                            共 {api.fmtNumber(visibleAccounts.length)} 个
                        </span>
                    </div>

                    <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <input
                            value={filter.q}
                            onChange={(e) => setFilter((p) => ({ ...p, q: e.target.value }))}
                            className="sm:col-span-2 rounded-lg border border-blue-200 px-3 py-2 text-sm"
                            placeholder="搜索姓名 / 用户名 / 状态"
                        />
                        <select
                            value={filter.user_type}
                            onChange={(e) => setFilter((p) => ({ ...p, user_type: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-3 py-2 text-sm"
                        >
                            <option value="all">角色：全部</option>
                            <option value="student">学生</option>
                            <option value="admin">管理员</option>
                        </select>
                    </div>

                    <div className="max-h-[62vh] space-y-2 overflow-auto pr-1">
                        {visibleAccounts.map((acc) => (
                            <div key={acc.id} className="rounded-xl border border-blue-100 bg-blue-50/30 p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-bold text-slate-700">{acc.name}</div>
                                        <div className="truncate text-xs font-semibold text-slate-500">
                                            用户名：{acc.username || acc.student_no || "-"} | {acc.user_type === "admin" ? "管理员" : "学生"}
                                        </div>
                                        <div className="truncate text-xs font-semibold text-slate-500">
                                            状态：{acc.status} | 线路：{api.fmtNumber(acc.route_count)} 条
                                        </div>
                                    </div>
                                    <div className="text-right text-[11px] font-bold text-slate-400">ID {acc.id}</div>
                                </div>
                                <div className="mt-2 flex items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => openResetModal(acc)}
                                        className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600"
                                    >
                                        重置密码
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeAccount(acc)}
                                        disabled={deleteBusyId === acc.id}
                                        className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 disabled:opacity-60"
                                    >
                                        {deleteBusyId === acc.id ? "删除中..." : "删除账户"}
                                    </button>
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
                <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-slate-900/30 p-3 backdrop-blur-[2px]">
                    <form onSubmit={submitResetPassword} className="ios-card w-[min(92vw,420px)] rounded-2xl border border-blue-100 bg-white p-4 shadow-soft">
                        <div className="mb-2 text-lg font-black text-admin-600">重置密码</div>
                        <div className="mb-3 text-xs font-semibold text-slate-500">
                            目标账户：{resetModal.account?.name}（{resetModal.account?.username || resetModal.account?.student_no || "-"}）
                        </div>
                        <div className="space-y-2">
                            <input
                                required
                                type="password"
                                value={resetModal.password}
                                onChange={(e) => setResetModal((prev) => ({ ...prev, password: e.target.value }))}
                                className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                                placeholder="8-64 位，支持特殊符号"
                            />
                            <input
                                required
                                type="password"
                                value={resetModal.confirm}
                                onChange={(e) => setResetModal((prev) => ({ ...prev, confirm: e.target.value }))}
                                className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                                placeholder="确认新密码"
                            />
                            <PasswordStrengthBar
                                password={resetModal.password}
                                username={resetModal.account?.username || resetModal.account?.student_no || ""}
                            />
                        </div>
                        <div className="mt-3 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={closeResetModal}
                                className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600"
                            >
                                取消
                            </button>
                            <button
                                disabled={resetModal.saving}
                                className="rounded-lg bg-admin-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
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

ReactDOM.createRoot(document.getElementById("app")).render(<AdminAccountsApp />);
