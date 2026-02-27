(() => {
    const state = {
        map: null,
        routeLayer: null,
        nodeLayer: null,
        users: [],
        nodes: [],
        selectedUserId: null,
        selectedRoutes: [],
        filters: {
            q: "",
            status: "",
            region: "",
        },
    };

    const categoryColor = {
        "货运": "#1f6cff",
        "客运": "#00a7c8",
        "快运": "#f97316",
        "冷链": "#0ea5a6",
        "城际": "#4f46e5",
    };

    function initMap() {
        state.map = L.map("adminMap", { zoomControl: false, minZoom: 3 }).setView([34.2, 108.9], 5);
        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
            maxZoom: 18,
            attribution: "&copy; OpenStreetMap &copy; CARTO",
        }).addTo(state.map);

        state.routeLayer = L.layerGroup().addTo(state.map);
        state.nodeLayer = L.layerGroup().addTo(state.map);
    }

    function bindEvents() {
        document.getElementById("adminZoomIn").addEventListener("click", () => state.map.zoomIn());
        document.getElementById("adminZoomOut").addEventListener("click", () => state.map.zoomOut());
        document.getElementById("adminFit").addEventListener("click", fitCurrentRoutes);

        const searchInput = document.getElementById("adminUserSearch");
        const globalInput = document.getElementById("adminGlobalSearch");
        const statusFilter = document.getElementById("statusFilter");
        const regionFilter = document.getElementById("regionFilter");

        let timer = null;
        function scheduleLoad(value) {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                state.filters.q = value.trim();
                await loadUsers();
            }, 220);
        }

        searchInput.addEventListener("input", () => {
            globalInput.value = searchInput.value;
            scheduleLoad(searchInput.value);
        });

        globalInput.addEventListener("input", () => {
            searchInput.value = globalInput.value;
            scheduleLoad(globalInput.value);
        });

        statusFilter.addEventListener("change", async () => {
            state.filters.status = statusFilter.value;
            await loadUsers();
        });

        regionFilter.addEventListener("change", async () => {
            state.filters.region = regionFilter.value;
            await loadUsers();
        });

        document.getElementById("refreshHourlyBtn").addEventListener("click", loadHourly);
        document.getElementById("refreshAlertsBtn").addEventListener("click", loadAlerts);
        document.getElementById("nodeForm").addEventListener("submit", submitNode);
    }

    async function loadUsers() {
        const params = new URLSearchParams();
        if (state.filters.q) params.set("q", state.filters.q);
        if (state.filters.status) params.set("status", state.filters.status);
        if (state.filters.region) params.set("region", state.filters.region);
        params.set("user_type", "student");

        const res = await api.get(`/api/users?${params.toString()}`);
        state.users = res.users || [];

        document.getElementById("userCountBadge").textContent = String(state.users.length);
        renderUserList();

        if (state.users.length === 0) {
            state.selectedUserId = null;
            state.selectedRoutes = [];
            state.routeLayer.clearLayers();
            document.getElementById("selectedUserCard").innerHTML = `
                <div class="big">没有匹配用户</div>
                <p>请调整筛选条件后重试。</p>
            `;
            return;
        }

        const stillExists = state.users.some((u) => u.id === state.selectedUserId);
        const nextUser = stillExists ? state.selectedUserId : state.users[0].id;
        await selectUser(nextUser);
    }

    function renderUserList() {
        const list = document.getElementById("userList");
        list.innerHTML = "";

        state.users.forEach((user) => {
            const li = document.createElement("li");
            li.className = `user-item ${user.id === state.selectedUserId ? "active" : ""}`;
            li.dataset.id = user.id;
            li.innerHTML = `
                <img src="${user.avatar_url || "https://i.pravatar.cc/100"}" alt="${user.name}">
                <div class="user-main">
                    <strong>${user.name}</strong>
                    <span>${user.student_no || "未填学号"} · ${user.class_name || "未填班级"} · ${user.region}</span>
                </div>
                <div class="user-meta">
                    <div>${api.fmtNumber(user.total_flow)}</div>
                    <div>${user.status}</div>
                </div>
            `;
            li.addEventListener("click", () => selectUser(user.id));
            list.appendChild(li);
        });
    }

    async function selectUser(userId) {
        state.selectedUserId = userId;
        renderUserList();

        const res = await api.get(`/api/users/${userId}/summary`);
        const user = res.user;
        const routes = res.routes || [];
        const categories = res.categories || [];
        state.selectedRoutes = routes;

        renderSelectedUser(user, categories);
        drawRoutes(routes);
        fitCurrentRoutes();
    }

    function renderSelectedUser(user, categories) {
        const topCategories = categories.slice(0, 3)
            .map((x) => `${x.category}: ${api.fmtNumber(x.flow)}`)
            .join(" · ");

        document.getElementById("selectedUserCard").innerHTML = `
            <div style="display:flex;gap:10px;align-items:center;">
                <img src="${user.avatar_url || "https://i.pravatar.cc/100"}" style="width:48px;height:48px;border-radius:50%;border:2px solid #d4e6ff" alt="avatar">
                <div>
                    <div class="big" style="font-size:24px;margin:0">${user.name}</div>
                    <div style="color:#5e7292;font-weight:700">${user.student_no || "未填学号"} · ${user.class_name || "未填班级"} · ${user.region}</div>
                </div>
            </div>
            <p style="margin:10px 0 6px">关注领域: ${user.focus_topic || "-"}</p>
            <p style="margin:4px 0">路线: ${api.fmtNumber(user.route_count)} 条，流量: ${api.fmtNumber(user.total_flow)}</p>
            <p style="margin:4px 0">分类: ${topCategories || "暂无"}</p>
            <p style="margin:4px 0;color:#5e7292">最后活跃: ${api.fmtTime(user.last_active_at)}</p>
        `;
    }

    async function loadAdminOverview() {
        const res = await api.get("/api/admin/overview");
        document.getElementById("ovTotalStudents").textContent = api.fmtNumber(res.total_students || 0);
        document.getElementById("ovActiveStudents").textContent = api.fmtNumber(res.active_students || 0);
        document.getElementById("ovNewStudentsToday").textContent = api.fmtNumber(res.new_students_today || 0);
        document.getElementById("ovTotalRoutes").textContent = api.fmtNumber(res.total_routes || 0);
        document.getElementById("ovTotalFlow").textContent = api.fmtNumber(res.total_flow || 0);
        const top = res.top_student;
        document.getElementById("ovTopStudentText").textContent = top
            ? `高流量学生：${top.name}（${api.fmtNumber(top.flow)}）`
            : "高流量学生：暂无";
    }

    async function loadNodes() {
        const res = await api.get("/api/nodes");
        state.nodes = res.nodes || [];
        drawNodes();
    }

    function drawNodes() {
        state.nodeLayer.clearLayers();
        state.nodes.forEach((node) => {
            const marker = L.circleMarker([node.lat, node.lon], {
                radius: 5,
                color: "#1f6cff",
                weight: 2,
                fillColor: "#7dc3ff",
                fillOpacity: 0.95,
            });
            marker.bindPopup(`<strong>${node.code}</strong><br>${node.name}<br>${node.region}`);
            marker.addTo(state.nodeLayer);
        });
    }

    function drawRoutes(routes) {
        state.routeLayer.clearLayers();
        routes.forEach((route) => {
            const from = [route.origin_lat, route.origin_lon];
            const to = [route.destination_lat, route.destination_lon];
            const points = buildCurve(from, to, 40);
            const color = categoryColor[route.category] || "#1f6cff";

            const line = L.polyline(points, {
                color,
                weight: 3.5,
                opacity: 0.88,
                dashArray: "9 7",
            }).addTo(state.routeLayer);

            line.bindPopup(`
                <strong>${route.origin_name} -> ${route.destination_name}</strong><br>
                ${route.category} · ${api.fmtNumber(route.flow_weight)}<br>
                ${api.fmtTime(route.created_at)}
            `);

            L.circleMarker(to, {
                radius: 4,
                color,
                fillColor: color,
                fillOpacity: 1,
                weight: 0,
            }).addTo(state.routeLayer);
        });
    }

    function fitCurrentRoutes() {
        const points = [];
        state.selectedRoutes.forEach((r) => {
            points.push([r.origin_lat, r.origin_lon]);
            points.push([r.destination_lat, r.destination_lon]);
        });
        if (points.length < 2) {
            if (state.nodes.length > 0) {
                const nodePoints = state.nodes.map((n) => [n.lat, n.lon]);
                state.map.fitBounds(nodePoints, { padding: [40, 40] });
            }
            return;
        }
        state.map.fitBounds(points, { padding: [48, 48] });
    }

    async function loadRegionCard() {
        const res = await api.get("/api/admin/region-load");
        const top = res.top || { region: "暂无", ratio: 0, total: 0 };
        document.getElementById("topRegionName").textContent = top.region;
        document.getElementById("topRegionRatio").textContent = `${top.ratio}%`;
        document.getElementById("topRegionTotal").textContent = `${api.fmtNumber(top.total)} 单位`;
        document.getElementById("topRegionBar").style.width = `${Math.max(0, Math.min(100, top.ratio))}%`;
    }

    async function loadHourly() {
        const res = await api.get("/api/admin/hourly");
        drawHourly(document.getElementById("hourlyCanvas"), res.series || []);
    }

    async function loadAlerts() {
        const res = await api.get("/api/alerts");
        const list = document.getElementById("alertList");
        list.innerHTML = "";

        const alerts = res.alerts || [];
        if (alerts.length === 0) {
            list.innerHTML = `<li class="alert-item">暂无告警</li>`;
            return;
        }

        alerts.forEach((alert) => {
            const li = document.createElement("li");
            li.className = "alert-item";
            li.innerHTML = `
                <div class="alert-head">
                    <span class="alert-pill ${alert.level}">${alert.level.toUpperCase()}</span>
                    <span>${api.fmtTime(alert.created_at)}</span>
                </div>
                <div>${alert.message}</div>
            `;
            list.appendChild(li);
        });
    }

    async function submitNode(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const payload = {};
        formData.forEach((value, key) => {
            payload[key] = String(value).trim();
        });

        try {
            await api.postJson("/api/nodes", payload);
            api.notify("节点新增成功");
            form.reset();
            await loadNodes();
            await loadRegionCard();
        } catch (err) {
            api.notify(err.message, true);
        }
    }

    function drawHourly(canvas, series) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!series || series.length === 0) {
            ctx.fillStyle = "#7890b0";
            ctx.font = "14px Manrope";
            ctx.fillText("暂无小时数据", 12, 24);
            return;
        }

        const allHours = Array.from({ length: 24 }, (_, i) => i);
        const table = new Map(series.map((s) => [Number(s.hour), Number(s.total)]));
        const values = allHours.map((h) => table.get(h) || 0);

        const maxVal = Math.max(...values, 1);
        const pad = 18;
        const chartW = w - pad * 2;
        const chartH = h - pad * 2;
        const stepX = chartW / 23;

        ctx.strokeStyle = "#d9e6ff";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 3; i += 1) {
            const y = pad + (chartH / 3) * i;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(w - pad, y);
            ctx.stroke();
        }

        ctx.beginPath();
        values.forEach((v, i) => {
            const x = pad + i * stepX;
            const y = pad + chartH - (v / maxVal) * chartH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = "#1f6cff";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = "#1f6cff";
        values.forEach((v, i) => {
            if (i % 6 === 0) {
                const x = pad + i * stepX;
                const y = pad + chartH - (v / maxVal) * chartH;
                ctx.beginPath();
                ctx.arc(x, y, 2.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = "#6d84a3";
                ctx.font = "11px Manrope";
                ctx.fillText(`${String(i).padStart(2, "0")}:00`, x - 14, h - 4);
                ctx.fillStyle = "#1f6cff";
            }
        });
    }

    function buildCurve(start, end, segments) {
        const [lat1, lon1] = start;
        const [lat2, lon2] = end;
        const midLat = (lat1 + lat2) / 2;
        const midLon = (lon1 + lon2) / 2;
        const dx = lon2 - lon1;
        const dy = lat2 - lat1;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const offset = Math.max(1.2, dist * 0.22);
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

    async function bootstrap() {
        try {
            initMap();
            bindEvents();
            await Promise.all([
                loadNodes(),
                loadUsers(),
                loadRegionCard(),
                loadHourly(),
                loadAlerts(),
                loadAdminOverview(),
            ]);
        } catch (err) {
            api.notify(err.message || "初始化失败", true);
            console.error(err);
        }
    }

    window.addEventListener("DOMContentLoaded", bootstrap);
})();
