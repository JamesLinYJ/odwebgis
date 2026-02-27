(() => {
    const state = {
        map: null,
        routeLayer: null,
        hubLayer: null,
        heatLayer: null,
        routes: [],
        nodes: [],
        users: [],
        currentUserId: null,
        search: "",
        layer: {
            routes: true,
            heat: true,
            hubs: true,
            thickness: 3,
            opacity: 0.8,
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
        state.map = L.map("explorerMap", {
            zoomControl: false,
            minZoom: 3,
        }).setView([34.2, 108.9], 5);

        L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
            maxZoom: 18,
            attribution: "&copy; OpenStreetMap &copy; CARTO",
        }).addTo(state.map);

        state.routeLayer = L.layerGroup().addTo(state.map);
        state.hubLayer = L.layerGroup().addTo(state.map);
    }

    function bindControls() {
        document.getElementById("zoomInBtn").addEventListener("click", () => state.map.zoomIn());
        document.getElementById("zoomOutBtn").addEventListener("click", () => state.map.zoomOut());
        document.getElementById("fitBtn").addEventListener("click", fitAllToBounds);

        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.forEach((btn) => {
            btn.addEventListener("click", () => {
                tabs.forEach((x) => x.classList.remove("active"));
                btn.classList.add("active");
                document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("active"));
                document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
            });
        });

        const routeSearch = document.getElementById("routeSearch");
        let timer = null;
        routeSearch.addEventListener("input", () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                state.search = routeSearch.value.trim();
                loadRoutes();
            }, 220);
        });

        const layerRoutes = document.getElementById("layerRoutes");
        const layerHeat = document.getElementById("layerHeat");
        const layerHubs = document.getElementById("layerHubs");
        const arcThickness = document.getElementById("arcThickness");
        const arcOpacity = document.getElementById("arcOpacity");

        layerRoutes.addEventListener("change", () => {
            state.layer.routes = layerRoutes.checked;
            renderMap();
        });

        layerHeat.addEventListener("change", () => {
            state.layer.heat = layerHeat.checked;
            renderMap();
        });

        layerHubs.addEventListener("change", () => {
            state.layer.hubs = layerHubs.checked;
            renderMap();
        });

        arcThickness.addEventListener("input", () => {
            state.layer.thickness = Number(arcThickness.value);
            document.getElementById("arcThicknessVal").textContent = `${state.layer.thickness.toFixed(1)}px`;
            renderMap();
        });

        arcOpacity.addEventListener("input", () => {
            state.layer.opacity = Number(arcOpacity.value);
            document.getElementById("arcOpacityVal").textContent = state.layer.opacity.toFixed(2);
            renderMap();
        });

        document.getElementById("resetLayersBtn").addEventListener("click", () => {
            state.layer = {
                routes: true,
                heat: true,
                hubs: true,
                thickness: 3,
                opacity: 0.8,
            };
            layerRoutes.checked = true;
            layerHeat.checked = true;
            layerHubs.checked = true;
            arcThickness.value = "3";
            arcOpacity.value = "0.8";
            document.getElementById("arcThicknessVal").textContent = "3.0px";
            document.getElementById("arcOpacityVal").textContent = "0.80";
            renderMap();
        });

        document.getElementById("routeForm").addEventListener("submit", submitRoute);
        document.getElementById("studentRegisterForm").addEventListener("submit", submitStudentRegister);
        document.getElementById("uploadBtn").addEventListener("click", uploadBatch);
        document.getElementById("downloadTemplateBtn").addEventListener("click", () => {
            window.open("/api/routes/template", "_blank");
        });
        document.getElementById("refreshRoutesBtn").addEventListener("click", async () => {
            await loadRoutes();
            await loadStats();
        });
    }

    async function initUsers() {
        const res = await api.get("/api/users?user_type=student");
        state.users = res.users || [];
        const select = document.getElementById("userIdSelect");
        select.innerHTML = "";
        state.users.forEach((u) => {
            const option = document.createElement("option");
            option.value = u.id;
            option.textContent = `${u.name}${u.student_no ? ` · ${u.student_no}` : ""} · ${u.region}`;
            select.appendChild(option);
        });

        if (state.users.length > 0) {
            const stored = Number(window.localStorage.getItem("webgisCurrentUserId")) || null;
            const found = state.users.find((u) => u.id === stored);
            state.currentUserId = found ? found.id : state.users[0].id;
            select.value = String(state.currentUserId);
            updateCurrentStudentText();
        } else {
            state.currentUserId = null;
            updateCurrentStudentText();
        }

        select.onchange = () => {
            state.currentUserId = Number(select.value) || null;
            if (state.currentUserId) {
                window.localStorage.setItem("webgisCurrentUserId", String(state.currentUserId));
            }
            updateCurrentStudentText();
        };
    }

    async function initNodes() {
        const res = await api.get("/api/nodes");
        state.nodes = res.nodes || [];
    }

    async function loadRoutes() {
        const params = new URLSearchParams();
        if (state.search) params.set("q", state.search);
        const res = await api.get(`/api/routes?${params.toString()}`);
        state.routes = res.routes || [];
        renderMap();
        renderRecentList();
    }

    async function loadStats() {
        const res = await api.get("/api/stats/overview");
        document.getElementById("totalFlowVal").textContent = api.fmtNumber(res.total_flow || 0);
        document.getElementById("routeCountVal").textContent = api.fmtNumber(res.route_count || 0);
        document.getElementById("peakWindowVal").textContent = res.peak_window || "-";
        document.getElementById("activeAlertsVal").textContent = api.fmtNumber(res.active_alerts || 0);
        drawMiniBars(document.getElementById("liveCanvas"), res.live_series || []);
    }

    function renderMap() {
        state.routeLayer.clearLayers();
        state.hubLayer.clearLayers();
        if (state.heatLayer) {
            state.map.removeLayer(state.heatLayer);
            state.heatLayer = null;
        }

        if (state.layer.hubs) {
            state.nodes.forEach((node) => {
                const marker = L.circleMarker([node.lat, node.lon], {
                    radius: 6,
                    color: "#1f6cff",
                    weight: 2,
                    fillColor: "#66b4ff",
                    fillOpacity: 0.9,
                });
                marker.bindPopup(`<strong>${node.code}</strong><br>${node.name}<br>${node.region}`);
                marker.addTo(state.hubLayer);
            });
        }

        const heatPoints = [];
        if (state.layer.routes) {
            state.routes.forEach((route) => {
                const from = [route.origin_lat, route.origin_lon];
                const to = [route.destination_lat, route.destination_lon];
                const points = buildCurve(from, to, 40);
                const color = categoryColor[route.category] || "#1f6cff";
                const weightScale = 0.4 + Math.min(route.flow_weight / 3500, 1.7);

                const polyline = L.polyline(points, {
                    color,
                    weight: state.layer.thickness * weightScale,
                    opacity: state.layer.opacity,
                    dashArray: "10 8",
                    lineJoin: "round",
                });

                polyline.bindPopup(`
                    <div style="min-width:170px">
                        <strong>${route.origin_name} -> ${route.destination_name}</strong><br>
                        类别: ${route.category}<br>
                        流量: ${api.fmtNumber(route.flow_weight)}<br>
                        录入人: ${route.user_name || "-"}<br>
                        时间: ${api.fmtTime(route.created_at)}
                    </div>
                `);
                polyline.addTo(state.routeLayer);

                L.circleMarker(to, {
                    radius: 4,
                    color,
                    fillColor: color,
                    fillOpacity: 1,
                    weight: 0,
                }).addTo(state.routeLayer);

                const intensity = Math.max(0.2, Math.min(route.flow_weight / 5000, 1));
                heatPoints.push([route.origin_lat, route.origin_lon, intensity]);
                heatPoints.push([route.destination_lat, route.destination_lon, intensity]);
            });
        }

        if (state.layer.heat && heatPoints.length > 0) {
            state.heatLayer = L.heatLayer(heatPoints, {
                radius: 28,
                blur: 20,
                minOpacity: 0.35,
                gradient: {
                    0.2: "#8cd6ff",
                    0.45: "#43b8ff",
                    0.7: "#1f6cff",
                    1.0: "#f97316",
                },
            }).addTo(state.map);
        }
    }

    function renderRecentList() {
        const list = document.getElementById("recentRoutes");
        list.innerHTML = "";

        const rows = state.routes.slice(0, 8);
        if (rows.length === 0) {
            list.innerHTML = `<li class="recent-item"><div class="left"><strong>暂无数据</strong><span>请先添加 OD 路线</span></div></li>`;
            return;
        }

        rows.forEach((route) => {
            const item = document.createElement("li");
            item.className = "recent-item";
            item.innerHTML = `
                <div class="left">
                    <strong>${route.origin_name} -> ${route.destination_name}</strong>
                    <span>${route.category} · ${api.fmtNumber(route.flow_weight)} · ${api.fmtTime(route.created_at)}</span>
                </div>
                <button class="delete-btn" data-id="${route.id}">删除</button>
            `;
            list.appendChild(item);
        });

        list.querySelectorAll(".delete-btn").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.id;
                try {
                    await api.del(`/api/routes/${id}`);
                    api.notify("路线已删除");
                    await Promise.all([loadRoutes(), loadStats()]);
                } catch (err) {
                    api.notify(err.message, true);
                }
            });
        });
    }

    async function submitRoute(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const payload = {};

        formData.forEach((value, key) => {
            payload[key] = String(value).trim();
        });

        const selectedUserId = Number(payload.user_id) || state.currentUserId;
        if (!selectedUserId) {
            api.notify("请先在左侧完成学生注册或选择学生账号", true);
            return;
        }
        payload.user_id = selectedUserId;

        try {
            await api.postJson("/api/routes", payload);
            api.notify("新增路线成功");
            await Promise.all([loadRoutes(), loadStats()]);
            form.reset();
            if (state.currentUserId) {
                document.getElementById("userIdSelect").value = String(state.currentUserId);
            }
        } catch (err) {
            api.notify(err.message, true);
        }
    }

    async function submitStudentRegister(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);
        const payload = {};
        formData.forEach((value, key) => {
            payload[key] = String(value).trim();
        });

        try {
            const res = await api.postJson("/api/students/register", payload);
            const user = res.user;
            state.currentUserId = Number(user.id);
            window.localStorage.setItem("webgisCurrentUserId", String(state.currentUserId));
            api.notify("学生注册成功");
            form.reset();
            await initUsers();
            updateCurrentStudentText();
        } catch (err) {
            api.notify(err.message, true);
        }
    }

    function updateCurrentStudentText() {
        const text = document.getElementById("currentStudentText");
        const user = state.users.find((u) => u.id === state.currentUserId) || null;
        if (!user) {
            text.textContent = "当前未选择学生账号";
            return;
        }
        text.textContent = `当前账号：${user.name}${user.student_no ? `（${user.student_no}）` : ""}，${user.class_name || "未填写班级"}`;
    }

    async function uploadBatch() {
        const input = document.getElementById("batchFile");
        const output = document.getElementById("uploadResult");

        if (!input.files || input.files.length === 0) {
            output.textContent = "请先选择 CSV 文件";
            return;
        }

        const formData = new FormData();
        formData.append("file", input.files[0]);

        try {
            const res = await api.postForm("/api/routes/batch", formData);
            const failed = res.errors?.length || 0;
            output.textContent = `成功写入 ${res.inserted} 条，失败 ${failed} 条`;
            if (failed > 0) {
                output.textContent += `（示例: 第 ${res.errors[0].line} 行 ${res.errors[0].error}）`;
            }
            api.notify("批量导入完成");
            await Promise.all([loadRoutes(), loadStats()]);
            input.value = "";
        } catch (err) {
            output.textContent = err.message;
            api.notify(err.message, true);
        }
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

    function fitAllToBounds() {
        const points = [];
        state.routes.forEach((r) => {
            points.push([r.origin_lat, r.origin_lon]);
            points.push([r.destination_lat, r.destination_lon]);
        });
        if (points.length < 2) return;
        state.map.fitBounds(points, { padding: [40, 40] });
    }

    function drawMiniBars(canvas, values) {
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!values || values.length === 0) return;
        const maxVal = Math.max(...values, 1);
        const barW = w / values.length;

        values.forEach((v, i) => {
            const barH = (v / maxVal) * (h - 4);
            const x = i * barW + 1;
            const y = h - barH;
            ctx.fillStyle = i > 20 ? "#f97316" : "#1f6cff";
            ctx.fillRect(x, y, Math.max(1.5, barW - 2), barH);
        });
    }

    async function bootstrap() {
        try {
            initMap();
            bindControls();
            await Promise.all([initUsers(), initNodes()]);
            await Promise.all([loadRoutes(), loadStats()]);
            fitAllToBounds();
        } catch (err) {
            api.notify(err.message || "初始化失败", true);
            console.error(err);
        }
    }

    window.addEventListener("DOMContentLoaded", bootstrap);
})();
