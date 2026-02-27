const { useEffect, useMemo, useRef, useState } = React;

function buildCurve(start, end, segments = 40) {
    const [lat1, lon1] = start;
    const [lat2, lon2] = end;
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    const dx = lon2 - lon1;
    const dy = lat2 - lat1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const offset = Math.max(0.8, dist * 0.2);
    const ctrlLat = midLat + (dx / (dist || 1)) * offset;
    const ctrlLon = midLon - (dy / (dist || 1)) * offset;

    const points = [];
    for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * ctrlLat + t * t * lat2;
        const lon = (1 - t) * (1 - t) * lon1 + 2 * (1 - t) * t * ctrlLon + t * t * lon2;
        points.push([lat, lon]);
    }
    return points;
}

function MetricCard({ title, value, hint }) {
    return (
        <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 shadow-soft">
            <div className="text-xs font-bold text-slate-500">{title}</div>
            <div className="mt-1 text-2xl font-black text-slate-800">{value}</div>
            {hint && <div className="text-xs font-semibold text-slate-500">{hint}</div>}
        </div>
    );
}

function routeBrief(route) {
    return `${route.origin_name} -> ${route.destination_name}`;
}

function AdminApp() {
    const mapHostRef = useRef(null);
    const mapSectionRef = useRef(null);
    const mapRef = useRef(null);
    const baseTileLayersRef = useRef(null);
    const routeLayerRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState([]);
    const [allRoutes, setAllRoutes] = useState([]);
    const [overview, setOverview] = useState({
        total_students: 0,
        active_students: 0,
        new_students_today: 0,
        total_routes: 0,
        top_student: null,
    });

    const [filters, setFilters] = useState({ q: "", status: "" });
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);
    const [selectedUserRoutes, setSelectedUserRoutes] = useState([]);
    const [categories, setCategories] = useState([]);

    const [onlySelectedStudent, setOnlySelectedStudent] = useState(false);
    const [selectedRouteId, setSelectedRouteId] = useState("");
    const [routeCategory, setRouteCategory] = useState("all");
    const [routeKeyword, setRouteKeyword] = useState("");
    const [lineLabelMode, setLineLabelMode] = useState("simple");
    const [baseMapMode, setBaseMapMode] = useState("vector");
    const [mapFullscreen, setMapFullscreen] = useState(false);
    const [exportingPoster, setExportingPoster] = useState(false);
    const [filterPanelOpen, setFilterPanelOpen] = useState(true);
    const [accountPanelOpen, setAccountPanelOpen] = useState(true);
    const [accounts, setAccounts] = useState([]);
    const [accountFilter, setAccountFilter] = useState({ q: "", user_type: "all" });
    const [accountForm, setAccountForm] = useState({
        name: "",
        account: "",
        password: "",
        user_type: "student",
    });
    const [accountSubmitting, setAccountSubmitting] = useState(false);
    const [accountResetBusyId, setAccountResetBusyId] = useState(null);
    const [accountDeleteBusyId, setAccountDeleteBusyId] = useState(null);
    const [routeDeleteBusyId, setRouteDeleteBusyId] = useState(null);
    const [deleteUserRoutesBusy, setDeleteUserRoutesBusy] = useState(false);
    const [detailCardScale, setDetailCardScale] = useState(1);
    const [studentContextMenu, setStudentContextMenu] = useState({
        open: false,
        x: 0,
        y: 0,
        user: null,
        routeId: "",
    });
    const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
    const [passwordSubmitting, setPasswordSubmitting] = useState(false);
    const [passwordForm, setPasswordForm] = useState({
        old_password: "",
        new_password: "",
        confirm_password: "",
    });
    const [me, setMe] = useState(null);
    const [securityHintShown, setSecurityHintShown] = useState(false);

    const userMap = useMemo(() => {
        const map = new Map();
        users.forEach((u) => map.set(Number(u.id), u));
        return map;
    }, [users]);

    const selectedStudentRoutesFromAll = useMemo(() => {
        if (!selectedUserId) return [];
        return allRoutes.filter((r) => Number(r.user_id) === Number(selectedUserId));
    }, [allRoutes, selectedUserId]);

    const contextUserRoutes = useMemo(() => {
        const uid = Number(studentContextMenu.user?.id || 0);
        if (!uid) return [];
        return allRoutes.filter((r) => Number(r.user_id) === uid);
    }, [allRoutes, studentContextMenu.user]);

    const categoryOptions = useMemo(() => {
        const base = onlySelectedStudent ? selectedStudentRoutesFromAll : allRoutes;
        const set = new Set(base.map((r) => r.category).filter(Boolean));
        return ["all", ...Array.from(set)];
    }, [onlySelectedStudent, selectedStudentRoutesFromAll, allRoutes]);

    const filteredAccounts = useMemo(() => {
        const q = accountFilter.q.trim().toLowerCase();
        return accounts.filter((acc) => {
            if (accountFilter.user_type !== "all" && acc.user_type !== accountFilter.user_type) {
                return false;
            }
            if (!q) return true;
            const text = [
                acc.name,
                acc.student_no,
                acc.role,
                acc.status,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return text.includes(q);
        });
    }, [accounts, accountFilter]);

    const activeRoutes = useMemo(() => {
        let rows = allRoutes;

        if (onlySelectedStudent && selectedUserId) {
            rows = rows.filter((r) => Number(r.user_id) === Number(selectedUserId));
        }

        if (selectedRouteId) {
            rows = rows.filter((r) => String(r.id) === String(selectedRouteId));
        }

        if (routeCategory !== "all") {
            rows = rows.filter((r) => r.category === routeCategory);
        }

        const keyword = routeKeyword.trim().toLowerCase();
        if (keyword) {
            rows = rows.filter((r) => {
                const text = [
                    r.origin_name,
                    r.destination_name,
                    r.origin_code,
                    r.destination_code,
                    r.category,
                    r.user_name,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return text.includes(keyword);
            });
        }

        return rows;
    }, [allRoutes, onlySelectedStudent, selectedUserId, selectedRouteId, routeCategory, routeKeyword]);

    useEffect(() => {
        if (!categoryOptions.includes(routeCategory)) {
            setRouteCategory("all");
        }
    }, [categoryOptions, routeCategory]);

    async function loadMe() {
        const res = await api.get("/api/auth/me");
        const user = res.user || null;
        setMe(user);
        if (!user) {
            throw new Error("未登录");
        }
        if (user.user_type !== "admin") {
            throw new Error("无管理员权限");
        }
        if (user.must_change_password && !securityHintShown) {
            setSecurityHintShown(true);
            api.notify("请先在账户中心修改密码");
            window.location.href = "/account";
        }
        return user;
    }

    async function loadUsers() {
        const params = new URLSearchParams();
        params.set("user_type", "student");
        if (filters.q) params.set("q", filters.q);
        if (filters.status) params.set("status", filters.status);

        const res = await api.get(`/api/users?${params.toString()}`);
        const list = res.users || [];
        setUsers(list);

        if (list.length === 0) {
            setSelectedUserId(null);
            setSelectedUser(null);
            setSelectedUserRoutes([]);
            setCategories([]);
            setStudentContextMenu({ open: false, x: 0, y: 0, user: null, routeId: "" });
            return;
        }

        if (!list.some((u) => Number(u.id) === Number(selectedUserId))) {
            setSelectedUserId(list[0].id);
        }
    }

    async function loadAllRoutes() {
        const res = await api.get("/api/routes?limit=2000");
        setAllRoutes(res.routes || []);
    }

    async function loadOverview() {
        const res = await api.get("/api/admin/overview");
        setOverview(res || {});
    }

    async function loadAccounts() {
        const params = new URLSearchParams();
        if (accountFilter.q) params.set("q", accountFilter.q);
        if (accountFilter.user_type !== "all") params.set("user_type", accountFilter.user_type);
        const query = params.toString();
        const res = await api.get(`/api/admin/accounts${query ? `?${query}` : ""}`);
        setAccounts(res.accounts || []);
    }

    async function loadSelectedSummary(userId) {
        if (!userId) return;
        const res = await api.get(`/api/users/${userId}/summary`);
        setSelectedUser(res.user || null);
        setSelectedUserRoutes(res.routes || []);
        setCategories(res.categories || []);
    }

    async function bootstrap() {
        setLoading(true);
        try {
            await loadMe();
            await Promise.all([loadUsers(), loadAllRoutes(), loadOverview()]);
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
            loadUsers().catch((err) => api.notify(err.message || "加载学生失败", true));
        }, 250);
        return () => clearTimeout(timer);
    }, [filters]);

    useEffect(() => {
        if (!selectedUserId) return;
        setSelectedRouteId("");
        loadSelectedSummary(selectedUserId).catch((err) => api.notify(err.message || "加载学生摘要失败", true));
    }, [selectedUserId]);

    useEffect(() => {
        if (!studentContextMenu.open) return;

        const closeMenu = () => {
            setStudentContextMenu((prev) => (prev.open ? { ...prev, open: false } : prev));
        };
        const onEsc = (e) => {
            if (e.key === "Escape") closeMenu();
        };

        document.addEventListener("click", closeMenu);
        document.addEventListener("contextmenu", closeMenu);
        document.addEventListener("keydown", onEsc);
        return () => {
            document.removeEventListener("click", closeMenu);
            document.removeEventListener("contextmenu", closeMenu);
            document.removeEventListener("keydown", onEsc);
        };
    }, [studentContextMenu.open]);

    useEffect(() => {
        if (document.getElementById("od-line-label-style")) return;
        const style = document.createElement("style");
        style.id = "od-line-label-style";
        style.textContent = `
            .leaflet-tooltip.od-line-label {
                border: 1px solid #cfe2ff;
                background: rgba(255, 255, 255, 0.92);
                color: #1e3a8a;
                font-size: 12px;
                font-weight: 700;
                border-radius: 8px;
                padding: 2px 6px;
                box-shadow: 0 4px 12px rgba(37, 99, 235, 0.16);
            }
            .leaflet-tooltip.od-line-label:before {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }, []);

    useEffect(() => {
        if (!mapHostRef.current || mapRef.current) return;

        const map = L.map(mapHostRef.current, {
            zoomControl: false,
            minZoom: 4,
            attributionControl: false,
        }).setView([35.2, 104.2], 5);
        const chinaBounds = [[18.0, 73.0], [54.5, 135.5]];
        map.setMaxBounds(chinaBounds);
        const vec = L.tileLayer("/api/map/tile/vec/{z}/{x}/{y}", { maxZoom: 18 });
        const cva = L.tileLayer("/api/map/tile/cva/{z}/{x}/{y}", { maxZoom: 18 });
        const img = L.tileLayer("/api/map/tile/img/{z}/{x}/{y}", { maxZoom: 18 });
        const cia = L.tileLayer("/api/map/tile/cia/{z}/{x}/{y}", { maxZoom: 18 });
        vec.addTo(map);
        cva.addTo(map);
        baseTileLayersRef.current = { vec, cva, img, cia };
        map.fitBounds(chinaBounds, { padding: [18, 18] });

        mapRef.current = map;
        routeLayerRef.current = L.layerGroup().addTo(map);

        return () => {
            map.remove();
            mapRef.current = null;
            baseTileLayersRef.current = null;
        };
    }, []);

    useEffect(() => {
        const map = mapRef.current;
        const layers = baseTileLayersRef.current;
        if (!map || !layers) return;
        const { vec, cva, img, cia } = layers;
        [vec, cva, img, cia].forEach((layer) => {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        if (baseMapMode === "satellite") {
            img.addTo(map);
            cia.addTo(map);
        } else {
            vec.addTo(map);
            cva.addTo(map);
        }
    }, [baseMapMode]);

    useEffect(() => {
        if (!mapRef.current) return;
        const timer = setTimeout(() => {
            mapRef.current && mapRef.current.invalidateSize();
        }, 320);
        return () => clearTimeout(timer);
    }, [mapFullscreen]);

    useEffect(() => {
        const onFullscreenChange = () => {
            const active = document.fullscreenElement === mapSectionRef.current;
            setMapFullscreen(Boolean(active));
            setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 80);
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
    }, []);

    useEffect(() => {
        if (!routeLayerRef.current) return;
        routeLayerRef.current.clearLayers();

        const effectiveLabelMode = activeRoutes.length > 250 && lineLabelMode === "detail" ? "simple" : lineLabelMode;

        activeRoutes.forEach((route) => {
            const uid = Number(route.user_id);
            const userInfo = userMap.get(uid);
            const studentName = userInfo?.name || route.user_name || "未知学生";
            const studentNo = userInfo?.student_no || "";

            const isSelected = selectedUserId && uid === Number(selectedUserId);
            const color = isSelected ? "#1d4ed8" : "#93c5fd";
            const opacity = isSelected ? 0.95 : 0.5;
            const weight = isSelected ? 3.8 : 2.2;

            const from = [route.origin_lat, route.origin_lon];
            const to = [route.destination_lat, route.destination_lon];
            const curve = buildCurve(from, to);

            const line = L.polyline(curve, {
                color,
                weight,
                opacity,
                dashArray: isSelected ? "9 6" : "7 8",
            }).addTo(routeLayerRef.current);

            if (effectiveLabelMode !== "none") {
                const labelText = effectiveLabelMode === "detail"
                    ? `${studentName} | ${route.category}`
                    : `${studentName}`;
                line.bindTooltip(labelText, {
                    permanent: true,
                    direction: "center",
                    className: "od-line-label",
                });
            }

            line.bindPopup(
                `<div style="min-width:220px">` +
                    `<strong>${route.origin_name} -> ${route.destination_name}</strong><br/>` +
                    `录入用户：${studentName}${studentNo ? ` (${studentNo})` : ""}<br/>` +
                    `分类：${route.category}<br/>` +
                    `时间：${api.fmtTime(route.created_at)}` +
                `</div>`
            );

            L.circleMarker(to, {
                radius: isSelected ? 4.5 : 3.6,
                color,
                fillColor: color,
                fillOpacity: isSelected ? 0.95 : 0.75,
                weight: 0,
            }).addTo(routeLayerRef.current);
        });
    }, [activeRoutes, selectedUserId, lineLabelMode, userMap]);

    function zoomToRoutes(routes) {
        if (!mapRef.current || !routes || routes.length === 0) return;
        const points = [];
        routes.forEach((route) => {
            points.push([route.origin_lat, route.origin_lon]);
            points.push([route.destination_lat, route.destination_lon]);
        });
        if (points.length >= 2) {
            mapRef.current.fitBounds(points, { padding: [50, 50] });
        }
    }

    function fitToVisibleRoutes() {
        if (activeRoutes.length === 0) {
            api.notify("当前筛选下没有可见线路", true);
            return;
        }
        zoomToRoutes(activeRoutes);
    }

    function zoomToStudent(userId) {
        setSelectedUserId(userId);
        setOnlySelectedStudent(true);
        setSelectedRouteId("");
        const rows = allRoutes.filter((r) => Number(r.user_id) === Number(userId));
        if (rows.length === 0) {
            api.notify("该学生暂无线路数据", true);
            return;
        }
        zoomToRoutes(rows);
    }

    function focusOneRoute(route) {
        setSelectedUserId(route.user_id);
        setOnlySelectedStudent(true);
        setSelectedRouteId(String(route.id));
        zoomToRoutes([route]);
    }

    function clearMapFilters() {
        setOnlySelectedStudent(false);
        setSelectedRouteId("");
        setRouteCategory("all");
        setRouteKeyword("");
    }

    function showAllStudentsRoutes() {
        setOnlySelectedStudent(false);
        setSelectedRouteId("");
    }

    function showSelectedStudentRoutes() {
        if (!selectedUserId) {
            api.notify("请先在左侧选择学生", true);
            return;
        }
        setOnlySelectedStudent(true);
        setSelectedRouteId("");
    }

    function openStudentContextMenu(e, user) {
        e.preventDefault();
        setSelectedUserId(user.id);
        setStudentContextMenu({
            open: true,
            x: e.clientX,
            y: e.clientY,
            user,
            routeId: "",
        });
    }

    function applyContextRouteFilter() {
        const routeId = String(studentContextMenu.routeId || "");
        const user = studentContextMenu.user;
        if (!user) return;
        if (!routeId) {
            setSelectedUserId(user.id);
            setOnlySelectedStudent(true);
            setSelectedRouteId("");
            zoomToStudent(user.id);
            return;
        }
        const route = allRoutes.find((r) => String(r.id) === routeId);
        if (!route) {
            api.notify("该线路不存在或已被删除", true);
            return;
        }
        focusOneRoute(route);
        setStudentContextMenu((prev) => ({ ...prev, open: false }));
    }

    function removeContextSelectedRoute() {
        const routeId = String(studentContextMenu.routeId || "");
        if (!routeId) {
            api.notify("请先在右键菜单选择一条线路", true);
            return;
        }
        const route = allRoutes.find((r) => String(r.id) === routeId);
        if (!route) {
            api.notify("该线路不存在或已被删除", true);
            return;
        }
        removeRoute(route);
    }

    function generateAllOdMap() {
        if (allRoutes.length === 0) {
            api.notify("当前没有可用线路数据", true);
            return;
        }
        clearMapFilters();
        setTimeout(() => zoomToRoutes(allRoutes), 80);
        api.notify("已生成全量 OD 图");
    }

    async function toggleMapFullscreen() {
        const mapNode = mapSectionRef.current;
        if (!mapNode) return;
        try {
            if (document.fullscreenElement === mapNode) {
                await document.exitFullscreen();
                return;
            }
            if (mapNode.requestFullscreen) {
                await mapNode.requestFullscreen();
                return;
            }
        } catch (err) {
            api.notify(err.message || "切换全屏失败", true);
            return;
        }
        // Fallback: 浏览器不支持 Fullscreen API 时保留页面内全屏体验
        setMapFullscreen((v) => !v);
    }

    async function exportOdPoster(format = "png") {
        if (!window.odExport || typeof window.odExport.downloadPoster !== "function") {
            api.notify("导出模块未加载", true);
            return;
        }
        if (activeRoutes.length === 0) {
            api.notify("当前筛选下没有可导出的线路", true);
            return;
        }
        setExportingPoster(true);
        try {
            const who = me?.name || me?.username || me?.student_no || "";
            const subtitle = onlySelectedStudent ? "教师端筛选导出（仅当前学生）" : "教师端筛选导出（全体可见）";
            await window.odExport.downloadPoster(activeRoutes, {
                format,
                title: "OD 全量/筛选线路导出图",
                subtitle,
                owner: who,
                filename: `od_admin_${new Date().toISOString().slice(0, 10)}`,
                categoryColors: {
                    课堂: "#2563eb",
                    通勤: "#0891b2",
                    调研: "#7c3aed",
                    实习: "#f97316",
                    其他: "#4b5563",
                },
                width: 1920,
                height: 1080,
                scale: 2,
                map: format === "png" ? mapRef.current : null,
                baseMapMode,
                mapScale: 2.2,
                qualityScale: 1.8,
                labelLimit: 160,
            });
            api.notify(format === "svg" ? "OD 图 SVG 已导出" : "OD 图 PNG 已导出");
        } catch (err) {
            api.notify(err.message || "导出失败", true);
        } finally {
            setExportingPoster(false);
        }
    }

    async function refreshData() {
        setLoading(true);
        try {
            await Promise.all([
                loadMe(),
                loadUsers(),
                loadAllRoutes(),
                loadOverview(),
                selectedUserId ? loadSelectedSummary(selectedUserId) : Promise.resolve(),
            ]);
            api.notify("数据已刷新");
        } catch (err) {
            api.notify(err.message || "刷新失败", true);
        } finally {
            setLoading(false);
        }
    }

    async function createAccount(e) {
        e.preventDefault();
        if (!accountForm.name.trim()) {
            api.notify("姓名不能为空", true);
            return;
        }
        if (!accountForm.account.trim()) {
            api.notify("用户名不能为空", true);
            return;
        }
        const passwordErr = api.validatePasswordInput(accountForm.password, accountForm.account);
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setAccountSubmitting(true);
        try {
            await api.postJsonSecure("/api/admin/accounts", {
                name: accountForm.name.trim(),
                username: accountForm.account.trim(),
                password: accountForm.password,
                user_type: accountForm.user_type,
            });
            api.notify("账户创建成功");
            setAccountForm({
                name: "",
                account: "",
                password: "",
                user_type: "student",
            });
            await Promise.all([loadAccounts(), loadUsers(), loadOverview()]);
        } catch (err) {
            api.notify(err.message || "创建账户失败", true);
        } finally {
            setAccountSubmitting(false);
        }
    }

    async function removeAccount(account) {
        if (!window.confirm(`确认删除账户 ${account.name}（${account.username || account.student_no || "无用户名"}）？该账户所有线路也会删除。`)) {
            return;
        }
        const deletedIsSelected = Number(selectedUserId) === Number(account.id);
        const summaryTargetId = deletedIsSelected ? null : selectedUserId;
        if (deletedIsSelected) {
            setSelectedUserId(null);
            setSelectedRouteId("");
            setSelectedUser(null);
            setSelectedUserRoutes([]);
            setCategories([]);
        }
        setAccountDeleteBusyId(account.id);
        try {
            await api.del(`/api/admin/accounts/${account.id}`);
            api.notify("账户已删除");
            setStudentContextMenu((prev) => ({ ...prev, open: false, routeId: "" }));
            await Promise.all([
                loadAccounts(),
                loadUsers(),
                loadAllRoutes(),
                loadOverview(),
            ]);
            if (summaryTargetId) {
                try {
                    await loadSelectedSummary(summaryTargetId);
                } catch {
                    // Selected user may have been removed during deletion.
                }
            }
        } catch (err) {
            api.notify(err.message || "删除账户失败", true);
        } finally {
            setAccountDeleteBusyId(null);
        }
    }

    async function removeRoute(route) {
        if (!route || !route.id) return;
        if (!window.confirm(`确认删除线路「${routeBrief(route)}」？`)) {
            return;
        }
        setRouteDeleteBusyId(route.id);
        try {
            await api.del(`/api/routes/${route.id}`);
            if (String(selectedRouteId) === String(route.id)) {
                setSelectedRouteId("");
            }
            api.notify("线路已删除");
            setStudentContextMenu((prev) => ({ ...prev, open: false, routeId: "" }));
            await Promise.all([
                loadAllRoutes(),
                loadUsers(),
                loadOverview(),
                selectedUserId ? loadSelectedSummary(selectedUserId) : Promise.resolve(),
            ]);
        } catch (err) {
            api.notify(err.message || "删除线路失败", true);
        } finally {
            setRouteDeleteBusyId(null);
        }
    }

    async function removeSelectedUserRoutes(userInput = null) {
        const targetUser = userInput || selectedUser;
        if (!targetUser) return;
        const targetRoutes = allRoutes.filter((r) => Number(r.user_id) === Number(targetUser.id));
        const total = Number(targetRoutes.length || 0);
        if (total <= 0) {
            api.notify("该学生暂无可删除线路", true);
            return;
        }
        if (!window.confirm(`确认删除 ${targetUser.name} 的全部 ${total} 条线路？`)) {
            return;
        }
        setDeleteUserRoutesBusy(true);
        try {
            const res = await api.del(`/api/admin/accounts/${targetUser.id}/routes`);
            setSelectedRouteId("");
            setStudentContextMenu((prev) => ({ ...prev, open: false, routeId: "" }));
            api.notify(`已删除 ${api.fmtNumber(res.deleted_count || 0)} 条线路`);
            await Promise.all([
                loadAllRoutes(),
                loadUsers(),
                loadOverview(),
                selectedUserId ? loadSelectedSummary(selectedUserId) : Promise.resolve(),
            ]);
        } catch (err) {
            api.notify(err.message || "删除学生线路失败", true);
        } finally {
            setDeleteUserRoutesBusy(false);
        }
    }

    async function resetAccountPassword(account) {
        const input = window.prompt(`给账户 ${account.name} 设定新密码（8-64 位，支持特殊符号）`, "");
        if (input === null) return;
        const newPassword = input.trim();
        if (!newPassword) {
            api.notify("请输入新密码", true);
            return;
        }
        const passwordErr = api.validatePasswordInput(newPassword, account.username || account.student_no || "");
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setAccountResetBusyId(account.id);
        try {
            await api.postJsonSecure(`/api/admin/accounts/${account.id}/reset-password`, {
                new_password: newPassword,
            });
            api.notify(`已重置 ${account.name} 的密码`);
        } catch (err) {
            api.notify(err.message || "重置密码失败", true);
        } finally {
            setAccountResetBusyId(null);
        }
    }

    async function changeMyPassword(e) {
        e.preventDefault();
        if (passwordForm.new_password !== passwordForm.confirm_password) {
            api.notify("两次新密码不一致", true);
            return;
        }
        const passwordErr = api.validatePasswordInput(passwordForm.new_password, me?.username || me?.student_no || "");
        if (passwordErr) {
            api.notify(passwordErr, true);
            return;
        }

        setPasswordSubmitting(true);
        try {
            await api.postJsonSecure("/api/auth/change-password", {
                old_password: passwordForm.old_password,
                new_password: passwordForm.new_password,
            });
            api.notify("密码修改成功");
            setPasswordForm({
                old_password: "",
                new_password: "",
                confirm_password: "",
            });
            setPasswordPanelOpen(false);
        } catch (err) {
            api.notify(err.message || "密码修改失败", true);
        } finally {
            setPasswordSubmitting(false);
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

    const topCategoryText = categories
        .slice(0, 3)
        .map((item) => `${item.category}:${api.fmtNumber(item.count)}条`)
        .join(" | ");

    return (
        <div className="mx-auto max-w-[1900px] p-3 sm:p-4 ios-fade-up">
            <header className="ios-card mb-3 rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="text-2xl font-black text-admin-600">WebGIS 教师管理后台</div>
                        <div className="text-sm font-semibold text-slate-500">全局线路总览、学生筛选与账户治理</div>
                        {me && (
                            <div className="mt-0.5 text-xs font-semibold text-slate-500">
                                当前账户：{me.name}（{me.username || me.student_no || "-"}）
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={refreshData} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600">刷新数据</button>
                        <button onClick={generateAllOdMap} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600">一键生成全量OD图</button>
                        <button onClick={() => exportOdPoster("png")} disabled={exportingPoster} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600 disabled:opacity-60">{exportingPoster ? "导出中..." : "导出OD图 PNG"}</button>
                        <button onClick={() => exportOdPoster("svg")} disabled={exportingPoster} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600 disabled:opacity-60">导出 SVG</button>
                        <button onClick={() => window.location.href = "/admin/accounts"} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600">账户管理页</button>
                        <button onClick={() => window.location.href = "/account"} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600">账户中心</button>
                        <a href="/api/export/users-csv" className="rounded-lg bg-admin-600 px-3 py-2 text-sm font-bold text-white">导出学生 CSV</a>
                        <button onClick={logout} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-admin-600">退出登录</button>
                    </div>
                </div>
            </header>

            <main className={mapFullscreen ? "" : "grid grid-cols-1 gap-3 xl:grid-cols-[340px_1fr_410px]"}>
                {!mapFullscreen && (
                <aside className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-soft">
                    <div className="mb-2 flex items-center justify-between">
                        <div className="text-lg font-black text-admin-600">学生列表</div>
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-admin-600">{users.length}</span>
                    </div>

                    <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50/50 px-2 py-1.5 text-xs font-semibold text-slate-600">
                        单击选择学生，双击缩放到该学生线路，右键打开操作菜单（删除路线/账户）
                    </div>

                    <input
                        value={filters.q}
                        onChange={(e) => setFilters((p) => ({ ...p, q: e.target.value }))}
                        className="mb-2 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm"
                        placeholder="搜索姓名/用户名"
                    />

                    <div className="mb-3 grid grid-cols-1 gap-2">
                        <select
                            value={filters.status}
                            onChange={(e) => setFilters((p) => ({ ...p, status: e.target.value }))}
                            className="rounded-lg border border-blue-200 px-2 py-1.5 text-sm"
                        >
                            <option value="">状态：全部</option>
                            <option value="online">在线</option>
                            <option value="offline">离线</option>
                        </select>
                    </div>

                    <div className="max-h-[62vh] space-y-2 overflow-auto pr-1">
                        {users.map((u) => (
                            <button
                                key={u.id}
                                onClick={() => setSelectedUserId(u.id)}
                                onDoubleClick={() => zoomToStudent(u.id)}
                                onContextMenu={(e) => openStudentContextMenu(e, u)}
                                className={`w-full rounded-xl border p-2 text-left ${
                                    Number(selectedUserId) === Number(u.id)
                                        ? "border-admin-300 bg-blue-50"
                                        : "border-blue-100 bg-white"
                                }`}
                            >
                                <div className="flex items-center gap-2">
                                    <img
                                        src={u.avatar_url || "/static/images/avatar-default.svg"}
                                        alt={u.name}
                                        className="h-10 w-10 rounded-full border border-blue-200 object-cover"
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-sm font-bold text-slate-700">{u.name}</div>
                                        <div className="truncate text-xs font-semibold text-slate-500">
                                            用户名：{u.username || u.student_no || "未设置"}
                                        </div>
                                    </div>
                                    <div className="text-right text-xs font-bold text-slate-500">
                                        <div>{api.fmtNumber(u.route_count)} 条</div>
                                        <div>{u.status}</div>
                                    </div>
                                </div>
                            </button>
                        ))}

                        {users.length === 0 && (
                            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm font-semibold text-slate-500">没有匹配的学生</div>
                        )}
                    </div>
                </aside>
                )}

                <section ref={mapSectionRef} className={`${mapFullscreen ? "fixed inset-0 z-[1300] rounded-none border-0" : "relative h-[60vh] min-h-[360px] overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-soft sm:h-[74vh] sm:min-h-[620px]"} ios-card`}>
                    <div ref={mapHostRef} className="h-full w-full" />

                    <div className="absolute left-3 top-3 z-[900] flex flex-col gap-2 sm:left-4 sm:top-4">
                        <button onClick={() => mapRef.current && mapRef.current.zoomIn()} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xl font-black text-admin-600">+</button>
                        <button onClick={() => mapRef.current && mapRef.current.zoomOut()} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xl font-black text-admin-600">-</button>
                        <button onClick={() => setBaseMapMode((v) => (v === "vector" ? "satellite" : "vector"))} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-admin-600 sm:text-sm">
                            {baseMapMode === "satellite" ? "切到矢量" : "切到卫星"}
                        </button>
                        <button onClick={fitToVisibleRoutes} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-sm font-black text-admin-600">适配</button>
                        <button onClick={toggleMapFullscreen} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-black text-admin-600 sm:text-sm">
                            {mapFullscreen ? "退出全屏" : "全屏"}
                        </button>
                    </div>

                    <div className="absolute right-3 top-3 z-[900] w-[min(90vw,340px)] rounded-xl border border-blue-100 bg-white/95 p-3 shadow-soft sm:right-4 sm:top-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-bold tracking-wide text-slate-500">地图筛选控制</div>
                            <button
                                onClick={() => setFilterPanelOpen((v) => !v)}
                                className="rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] font-bold text-admin-600"
                            >
                                {filterPanelOpen ? "收起" : "展开"}
                            </button>
                        </div>

                        <div className={`ios-collapse ${filterPanelOpen ? "mt-2 max-h-[900px] opacity-100" : "max-h-0 opacity-0"}`}>
                        <div className="text-xs font-semibold text-slate-500">学生范围</div>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={showAllStudentsRoutes}
                                className={`rounded-md border px-2 py-1 text-xs font-bold ${!onlySelectedStudent ? "border-admin-300 bg-blue-50 text-admin-600" : "border-blue-200 bg-white text-slate-600"}`}
                            >
                                全部学生
                            </button>
                            <button
                                type="button"
                                onClick={showSelectedStudentRoutes}
                                disabled={!selectedUserId}
                                className={`rounded-md border px-2 py-1 text-xs font-bold disabled:opacity-60 ${onlySelectedStudent ? "border-admin-300 bg-blue-50 text-admin-600" : "border-blue-200 bg-white text-slate-600"}`}
                            >
                                仅选中学生
                            </button>
                        </div>

                        <div className="mt-2 text-xs font-semibold text-slate-500">特定线路筛选（选中学生）</div>
                        <select
                            value={selectedRouteId}
                            onChange={(e) => {
                                setOnlySelectedStudent(true);
                                setSelectedRouteId(e.target.value);
                            }}
                            className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
                            disabled={!selectedUserId}
                        >
                            <option value="">全部线路</option>
                            {selectedUserRoutes.map((route) => (
                                <option key={route.id} value={route.id}>
                                    {routeBrief(route)} | {route.category}
                                </option>
                            ))}
                        </select>
                        <div className="mt-1 flex items-center justify-end">
                            <button
                                type="button"
                                disabled={!selectedRouteId}
                                onClick={() => {
                                    const route = selectedUserRoutes.find((r) => String(r.id) === String(selectedRouteId));
                                    if (!route) return;
                                    focusOneRoute(route);
                                }}
                                className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600 disabled:opacity-60"
                            >
                                展示该线路
                            </button>
                        </div>

                        <div className="mt-2 text-xs font-semibold text-slate-500">分类筛选</div>
                        <select
                            value={routeCategory}
                            onChange={(e) => setRouteCategory(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
                        >
                            {categoryOptions.map((cat) => (
                                <option key={cat} value={cat}>
                                    {cat === "all" ? "全部分类" : cat}
                                </option>
                            ))}
                        </select>

                        <div className="mt-2 text-xs font-semibold text-slate-500">关键词筛选</div>
                        <input
                            value={routeKeyword}
                            onChange={(e) => setRouteKeyword(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
                            placeholder="起终点/分类/学生名"
                        />

                        <div className="mt-2 text-xs font-semibold text-slate-500">线路标注</div>
                        <select
                            value={lineLabelMode}
                            onChange={(e) => setLineLabelMode(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
                        >
                            <option value="none">不显示标注</option>
                            <option value="simple">仅姓名标注</option>
                            <option value="detail">姓名 + 分类</option>
                        </select>

                        <div className="mt-2 flex items-center justify-between">
                            <div className="text-xs font-semibold text-slate-500">可见线路：{api.fmtNumber(activeRoutes.length)} 条</div>
                            <button onClick={clearMapFilters} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600">
                                清空筛选
                            </button>
                        </div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">底图：{baseMapMode === "satellite" ? "卫星影像" : "矢量地图"}</div>
                        </div>
                    </div>

                    <div
                        className="absolute bottom-4 left-4 z-[900] max-w-[440px] rounded-xl border border-blue-100 bg-white/95 p-3 shadow-soft transition-all duration-500"
                        style={{ transform: `scale(${detailCardScale})`, transformOrigin: "left bottom" }}
                    >
                        {!selectedUser && <div className="text-sm font-semibold text-slate-500">请选择学生查看详情。</div>}
                        {selectedUser && (
                            <div>
                                <div className="mb-2 flex items-center justify-between">
                                    <div className="text-xs font-bold text-slate-500">详情卡片缩放</div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => setDetailCardScale((v) => Math.max(0.85, Number((v - 0.05).toFixed(2))))}
                                            className="rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs font-black text-admin-600"
                                        >
                                            -
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDetailCardScale(1)}
                                            className="rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs font-black text-admin-600"
                                        >
                                            {Math.round(detailCardScale * 100)}%
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setDetailCardScale((v) => Math.min(1.4, Number((v + 0.05).toFixed(2))))}
                                            className="rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs font-black text-admin-600"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                                <div className="text-lg font-black text-admin-600">{selectedUser.name}</div>
                                <div className="text-xs font-semibold text-slate-500">
                                    用户名：{selectedUser.username || selectedUser.student_no || "未设置"} | 状态：{selectedUser.status}
                                </div>
                                <div className="mt-2 text-xs font-semibold text-slate-600">
                                    路线：{api.fmtNumber(selectedUser.route_count)} 条
                                </div>
                                <div className="mt-1 text-xs font-semibold text-slate-500">分类：{topCategoryText || "暂无"}</div>
                                <div className="mt-1 text-xs font-semibold text-slate-500">最后活跃：{api.fmtTime(selectedUser.last_active_at)}</div>
                                <div className="mt-2 text-xs font-semibold text-slate-500">删除操作请在左侧学生列表右键菜单中执行</div>
                            </div>
                        )}
                    </div>
                </section>

                {!mapFullscreen && (
                <aside className="ios-card max-h-[74vh] space-y-3 overflow-auto rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-soft">
                    <div className="grid grid-cols-2 gap-2">
                        <MetricCard title="学生总数" value={api.fmtNumber(overview.total_students || 0)} />
                        <MetricCard title="在线学生" value={api.fmtNumber(overview.active_students || 0)} />
                        <MetricCard title="今日新增" value={api.fmtNumber(overview.new_students_today || 0)} />
                        <MetricCard title="路线总数" value={api.fmtNumber(overview.total_routes || 0)} />
                        <MetricCard
                            title="路线最多学生"
                            value={overview.top_student ? overview.top_student.name : "暂无"}
                            hint={overview.top_student ? `ID: ${overview.top_student.id}` : ""}
                        />
                    </div>

                    <div className="rounded-xl border border-blue-100 p-3">
                        <div className="mb-2 flex items-center justify-between">
                            <div className="text-sm font-black text-admin-600">选中学生线路</div>
                            <button
                                onClick={() => {
                                    if (!selectedUserId) return;
                                    zoomToStudent(selectedUserId);
                                }}
                                className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600"
                            >
                                一键定位学生
                            </button>
                        </div>
                        <div className="max-h-[240px] space-y-2 overflow-auto pr-1">
                            {selectedUserRoutes.slice(0, 16).map((route) => (
                                <div key={route.id} className="rounded-lg border border-blue-100 bg-blue-50/40 p-2">
                                    <div className="truncate text-sm font-bold text-slate-700">{routeBrief(route)}</div>
                                    <div className="text-xs font-semibold text-slate-500">{route.category} | {api.fmtTime(route.created_at)}</div>
                                    <div className="mt-1 flex items-center justify-end gap-2">
                                        <button
                                            onClick={() => zoomToRoutes([route])}
                                            className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600"
                                        >
                                            定位
                                        </button>
                                        <button
                                            onClick={() => focusOneRoute(route)}
                                            className="rounded-md border border-admin-200 bg-admin-50 px-2 py-1 text-xs font-bold text-admin-600"
                                        >
                                            仅显示此线路
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {selectedUserRoutes.length === 0 && (
                                <div className="text-sm font-semibold text-slate-500">暂无该学生线路</div>
                            )}
                        </div>
                    </div>

                </aside>
                )}
            </main>

            {studentContextMenu.open && studentContextMenu.user && (
                <div
                    className="fixed z-[1400] w-[min(90vw,320px)] rounded-xl border border-blue-100 bg-white p-3 shadow-soft ios-pop-in"
                    style={{
                        left: Math.max(8, Math.min(studentContextMenu.x, window.innerWidth - 330)),
                        top: Math.max(8, Math.min(studentContextMenu.y, window.innerHeight - 360)),
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => e.preventDefault()}
                >
                    <div className="text-sm font-black text-admin-600">{studentContextMenu.user.name}</div>
                    <div className="text-xs font-semibold text-slate-500">
                        用户名：{studentContextMenu.user.username || studentContextMenu.user.student_no || "未设置"}
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                showAllStudentsRoutes();
                                setStudentContextMenu((prev) => ({ ...prev, open: false }));
                            }}
                            className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600"
                        >
                            显示全部学生
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                zoomToStudent(studentContextMenu.user.id);
                                setStudentContextMenu((prev) => ({ ...prev, open: false }));
                            }}
                            className="rounded-md border border-admin-200 bg-admin-50 px-2 py-1 text-xs font-bold text-admin-600"
                        >
                            仅显示该学生
                        </button>
                    </div>

                    <div className="mt-2 text-xs font-semibold text-slate-500">选择该学生的一条线路</div>
                    <select
                        value={studentContextMenu.routeId}
                        onChange={(e) => setStudentContextMenu((prev) => ({ ...prev, routeId: e.target.value }))}
                        className="mt-1 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-xs"
                    >
                        <option value="">请选择线路</option>
                        {contextUserRoutes.map((route) => (
                            <option key={route.id} value={route.id}>
                                {routeBrief(route)} | {route.category}
                            </option>
                        ))}
                    </select>

                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={!studentContextMenu.routeId}
                            onClick={applyContextRouteFilter}
                            className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-admin-600 disabled:opacity-60"
                        >
                            展示该线路
                        </button>
                        <button
                            type="button"
                            disabled={!studentContextMenu.routeId || !!routeDeleteBusyId}
                            onClick={removeContextSelectedRoute}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 disabled:opacity-60"
                        >
                            {routeDeleteBusyId ? "删除中..." : "删除该线路"}
                        </button>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            disabled={deleteUserRoutesBusy || contextUserRoutes.length === 0}
                            onClick={() => removeSelectedUserRoutes(studentContextMenu.user)}
                            className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 disabled:opacity-60"
                        >
                            {deleteUserRoutesBusy ? "删除中..." : "删除该学生全部路线"}
                        </button>
                        <button
                            type="button"
                            disabled={accountDeleteBusyId === studentContextMenu.user.id}
                            onClick={() => removeAccount(studentContextMenu.user)}
                            className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600 disabled:opacity-60"
                        >
                            {accountDeleteBusyId === studentContextMenu.user.id ? "删除中..." : "删除该学生账户"}
                        </button>
                    </div>
                </div>
            )}

            {loading && (
                <div className="pointer-events-none fixed inset-0 z-[1200] flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
                    <div className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-bold text-admin-600 shadow-soft">正在加载...</div>
                </div>
            )}
        </div>
    );
}

const adminRootNode = document.getElementById("app");
if (ReactDOM.createRoot) {
    ReactDOM.createRoot(adminRootNode).render(<AdminApp />);
} else {
    ReactDOM.render(<AdminApp />, adminRootNode);
}
