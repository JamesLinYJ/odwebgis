(function () {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function safeNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function escapeXml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    function nowStamp() {
        const d = new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const h = String(d.getHours()).padStart(2, "0");
        const min = String(d.getMinutes()).padStart(2, "0");
        const s = String(d.getSeconds()).padStart(2, "0");
        return `${y}${m}${day}_${h}${min}${s}`;
    }

    function normalizeRoutes(routes) {
        return (routes || [])
            .map((route, idx) => {
                const originLat = safeNumber(route.origin_lat, NaN);
                const originLon = safeNumber(route.origin_lon, NaN);
                const destinationLat = safeNumber(route.destination_lat, NaN);
                const destinationLon = safeNumber(route.destination_lon, NaN);
                return {
                    id: route.id || `route_${idx + 1}`,
                    origin_name: route.origin_name || "起点",
                    destination_name: route.destination_name || "终点",
                    origin_lat: originLat,
                    origin_lon: originLon,
                    destination_lat: destinationLat,
                    destination_lon: destinationLon,
                    category: route.category || "未分类",
                    user_name: route.user_name || route.username || "",
                    created_at: route.created_at || "",
                };
            })
            .filter((route) =>
                Number.isFinite(route.origin_lat)
                && Number.isFinite(route.origin_lon)
                && Number.isFinite(route.destination_lat)
                && Number.isFinite(route.destination_lon)
                && Math.abs(route.origin_lat) <= 90
                && Math.abs(route.destination_lat) <= 90
                && Math.abs(route.origin_lon) <= 180
                && Math.abs(route.destination_lon) <= 180
            );
    }

    function routeLabel(route) {
        return `${route.origin_name || "起点"} -> ${route.destination_name || "终点"}`;
    }

    function colorForCategory(category, idx, customMap = {}) {
        return customMap[category] || ["#2563eb", "#0891b2", "#7c3aed", "#f97316", "#0f766e"][idx % 5];
    }

    function colorWithAlpha(hex, alpha) {
        const m = String(hex || "").match(/^#([0-9a-fA-F]{6})$/);
        const a = clamp(alpha, 0, 1);
        if (!m) return `rgba(37,99,235,${a.toFixed(3)})`;
        const n = parseInt(m[1], 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        return `rgba(${r},${g},${b},${a.toFixed(3)})`;
    }

    function computeBounds(routes) {
        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        routes.forEach((route) => {
            minLat = Math.min(minLat, route.origin_lat, route.destination_lat);
            maxLat = Math.max(maxLat, route.origin_lat, route.destination_lat);
            minLon = Math.min(minLon, route.origin_lon, route.destination_lon);
            maxLon = Math.max(maxLon, route.origin_lon, route.destination_lon);
        });
        if (!Number.isFinite(minLat) || !Number.isFinite(maxLat) || !Number.isFinite(minLon) || !Number.isFinite(maxLon)) {
            return { minLat: 18, maxLat: 54.5, minLon: 73, maxLon: 135.5 };
        }
        const latPad = Math.max(1.2, (maxLat - minLat) * 0.18);
        const lonPad = Math.max(1.2, (maxLon - minLon) * 0.18);
        return {
            minLat: minLat - latPad,
            maxLat: maxLat + latPad,
            minLon: minLon - lonPad,
            maxLon: maxLon + lonPad,
        };
    }

    function makeProjector(bounds, mapX, mapY, mapW, mapH) {
        const spanLon = Math.max(1e-6, bounds.maxLon - bounds.minLon);
        const spanLat = Math.max(1e-6, bounds.maxLat - bounds.minLat);
        return (lat, lon) => {
            const px = mapX + ((lon - bounds.minLon) / spanLon) * mapW;
            const py = mapY + (1 - ((lat - bounds.minLat) / spanLat)) * mapH;
            return [px, py];
        };
    }

    function makeCurveGeometry(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = Math.max(12, dist * 0.2);
        const cx = (x1 + x2) / 2 + (dy / dist) * offset;
        const cy = (y1 + y2) / 2 - (dx / dist) * offset;
        const mx = 0.25 * x1 + 0.5 * cx + 0.25 * x2;
        const my = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
        return { cx, cy, mx, my };
    }

    function buildCategoryLegend(routes) {
        const byCategory = new Map();
        routes.forEach((route) => {
            const item = byCategory.get(route.category) || { count: 0 };
            item.count += 1;
            byCategory.set(route.category, item);
        });
        return Array.from(byCategory.entries()).sort((a, b) => b[1].count - a[1].count);
    }

    function pickLabeledRoutes(routes, limit) {
        const rows = routes
            .filter((r) => String(r.user_name || "").trim())
            .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
        return rows.slice(0, limit);
    }

    function createPosterSvg(inputRoutes, options = {}) {
        const routes = normalizeRoutes(inputRoutes).slice(0, clamp(safeNumber(options.maxRoutes, 900), 20, 2500));
        if (!routes.length) throw new Error("没有可导出的 OD 线路");

        const width = clamp(safeNumber(options.width, 1920), 960, 4096);
        const height = clamp(safeNumber(options.height, 1080), 600, 4096);
        const title = options.title || "OD 流向图";
        const subtitle = options.subtitle || "WebGIS 导出";
        const owner = options.owner || "";
        const categoryColors = options.categoryColors || {};
        const labelLimit = clamp(safeNumber(options.labelLimit, 90), 0, 220);

        const pad = 52;
        const headerH = 120;
        const sideW = Math.round(width * 0.28);
        const mapX = pad;
        const mapY = headerH + 8;
        const mapW = width - pad * 2 - sideW - 18;
        const mapH = height - mapY - pad;
        const sideX = mapX + mapW + 18;
        const sideY = mapY;
        const sideH = mapH;

        const bounds = computeBounds(routes);
        const project = makeProjector(bounds, mapX + 22, mapY + 22, mapW - 44, mapH - 44);

        const linePaths = [];
        const points = [];
        const labels = [];
        routes.forEach((route, idx) => {
            const [x1, y1] = project(route.origin_lat, route.origin_lon);
            const [x2, y2] = project(route.destination_lat, route.destination_lon);
            const { cx, cy, mx, my } = makeCurveGeometry(x1, y1, x2, y2);
            const color = colorForCategory(route.category, idx, categoryColors);
            linePaths.push(
                `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${escapeXml(color)}" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.76"/>`
            );
            points.push(
                `<circle cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="3.1" fill="${escapeXml(colorWithAlpha(color, 0.78))}"/>`,
                `<circle cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="3.6" fill="${escapeXml(color)}"/>`
            );
            if (idx < labelLimit && route.user_name) {
                const txt = escapeXml(route.user_name);
                labels.push(
                    `<text x="${mx.toFixed(2)}" y="${(my - 8).toFixed(2)}" text-anchor="middle" font-size="12" font-weight="700" fill="#0f172a" stroke="#ffffff" stroke-width="3" paint-order="stroke">${txt}</text>`
                );
            }
        });

        const legendItems = buildCategoryLegend(routes).slice(0, 8);
        const legendSvg = legendItems.map((item, idx) => {
            const cat = item[0];
            const stat = item[1];
            const color = colorForCategory(cat, idx, categoryColors);
            const y = sideY + 260 + idx * 36;
            return (
                `<circle cx="${sideX + 28}" cy="${y}" r="7" fill="${escapeXml(color)}"/>` +
                `<text x="${sideX + 44}" y="${y + 4}" font-size="17" fill="#1f2937">${escapeXml(cat)}</text>` +
                `<text x="${sideX + sideW - 22}" y="${y + 4}" text-anchor="end" font-size="15" fill="#475569">${escapeXml(`${stat.count} 条`)}</text>`
            );
        }).join("");

        const latestRoutes = [...routes]
            .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
            .slice(0, 6);
        const latestRows = latestRoutes.map((route, idx) => {
            const y = sideY + sideH - 182 + idx * 28;
            return `<text x="${sideX + 20}" y="${y}" font-size="14" fill="#334155">${idx + 1}. ${escapeXml(routeLabel(route))}</text>`;
        }).join("");

        const nowText = new Date().toLocaleString("zh-CN", { hour12: false });
        const ownerText = owner ? ` | 导出用户：${owner}` : "";
        const labelStat = pickLabeledRoutes(routes, labelLimit).length;

        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            `<defs>` +
            `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="#f8fbff"/><stop offset="56%" stop-color="#e8f0ff"/><stop offset="100%" stop-color="#dde8ff"/>` +
            `</linearGradient>` +
            `<linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0%" stop-color="#ffffff"/><stop offset="100%" stop-color="#f6f9ff"/>` +
            `</linearGradient>` +
            `<filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">` +
            `<feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#1d4ed8" flood-opacity="0.12"/>` +
            `</filter>` +
            `</defs>` +

            `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrad)"/>` +
            `<circle cx="${(width * 0.18).toFixed(1)}" cy="${(height * 0.2).toFixed(1)}" r="${Math.round(height * 0.24)}" fill="rgba(59,130,246,0.08)"/>` +
            `<circle cx="${(width * 0.74).toFixed(1)}" cy="${(height * 0.78).toFixed(1)}" r="${Math.round(height * 0.26)}" fill="rgba(14,165,233,0.07)"/>` +

            `<text x="${pad}" y="58" font-size="40" font-weight="900" fill="#1e3a8a">${escapeXml(title)}</text>` +
            `<text x="${pad}" y="88" font-size="20" font-weight="600" fill="#475569">${escapeXml(subtitle)}</text>` +
            `<text x="${pad}" y="112" font-size="14" fill="#64748b">${escapeXml(nowText + ownerText)}</text>` +

            `<g filter="url(#softShadow)">` +
            `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" rx="22" fill="url(#panelGrad)" stroke="#bfdbfe"/>` +
            `<rect x="${sideX}" y="${sideY}" width="${sideW}" height="${sideH}" rx="22" fill="url(#panelGrad)" stroke="#bfdbfe"/>` +
            `</g>` +

            `<g opacity="0.45">` +
            `${Array.from({ length: 9 }, (_, i) => {
                const x = mapX + 20 + (i * (mapW - 40)) / 8;
                return `<line x1="${x.toFixed(2)}" y1="${(mapY + 18).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(mapY + mapH - 18).toFixed(2)}" stroke="#dbeafe" stroke-width="1"/>`;
            }).join("")}` +
            `${Array.from({ length: 6 }, (_, i) => {
                const y = mapY + 20 + (i * (mapH - 40)) / 5;
                return `<line x1="${(mapX + 18).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(mapX + mapW - 18).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dbeafe" stroke-width="1"/>`;
            }).join("")}` +
            `</g>` +

            `<g>${linePaths.join("")}</g>` +
            `<g>${points.join("")}</g>` +
            `<g>${labels.join("")}</g>` +

            `<text x="${sideX + 20}" y="${sideY + 46}" font-size="26" font-weight="900" fill="#1e3a8a">导出摘要</text>` +
            `<text x="${sideX + 20}" y="${sideY + 84}" font-size="16" fill="#334155">线路总数：${escapeXml(String(routes.length))} 条</text>` +
            `<text x="${sideX + 20}" y="${sideY + 112}" font-size="16" fill="#334155">标注人名：${escapeXml(String(labelStat))}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 140}" font-size="16" fill="#334155">经度范围：${bounds.minLon.toFixed(2)} ~ ${bounds.maxLon.toFixed(2)}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 168}" font-size="16" fill="#334155">纬度范围：${bounds.minLat.toFixed(2)} ~ ${bounds.maxLat.toFixed(2)}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 214}" font-size="20" font-weight="800" fill="#1e3a8a">分类统计</text>` +
            `${legendSvg}` +
            `<text x="${sideX + 20}" y="${sideY + sideH - 208}" font-size="20" font-weight="800" fill="#1e3a8a">最近路线</text>` +
            `${latestRows}` +
            `</svg>`
        );
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    async function svgToPngBlob(svgText, width, height, scale = 2) {
        const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(svgBlob);
        const img = new Image();
        img.decoding = "async";
        const loaded = new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("SVG 渲染失败，无法导出 PNG"));
        });
        img.src = url;
        await loaded;

        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            URL.revokeObjectURL(url);
            throw new Error("浏览器不支持 Canvas 导出");
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        const pngBlob = await new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), "image/png", 1);
        });
        if (!pngBlob) throw new Error("PNG 导出失败");
        return pngBlob;
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForMapStable(map) {
        if (!map) return;
        await wait(140);
        await new Promise((resolve) => map.whenReady(resolve));
        await wait(140);
    }

    function drawRoundedRect(ctx, x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
    }

    function routeCurvePoints(route, map) {
        const p1 = map.latLngToContainerPoint([route.origin_lat, route.origin_lon]);
        const p2 = map.latLngToContainerPoint([route.destination_lat, route.destination_lon]);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = Math.max(12, dist * 0.2);
        const cx = (p1.x + p2.x) / 2 + (dy / dist) * offset;
        const cy = (p1.y + p2.y) / 2 - (dx / dist) * offset;
        const mx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
        const my = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
        return { p1, p2, c: { x: cx, y: cy }, m: { x: mx, y: my } };
    }

    async function drawLeafletTiles(ctx, map, mapX, mapY, drawScale, cornerRadius) {
        const container = map.getContainer();
        const mapRect = container.getBoundingClientRect();
        const tileImages = Array.from(container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"));
        if (!tileImages.length) throw new Error("未找到底图瓦片，无法导出底图");

        ctx.save();
        drawRoundedRect(ctx, mapX, mapY, mapRect.width * drawScale, mapRect.height * drawScale, cornerRadius);
        ctx.clip();

        tileImages.forEach((img) => {
            if (!img.complete || !img.naturalWidth) return;
            const r = img.getBoundingClientRect();
            const x = mapX + (r.left - mapRect.left) * drawScale;
            const y = mapY + (r.top - mapRect.top) * drawScale;
            const w = r.width * drawScale;
            const h = r.height * drawScale;
            try {
                ctx.drawImage(img, x, y, w, h);
            } catch {
                // ignore a single tile draw failure
            }
        });
        ctx.restore();
    }

    function drawNameTag(ctx, text, x, y, mapX, mapY, mapW, mapH, scale) {
        const clean = String(text || "").trim();
        if (!clean) return;
        if (x < mapX + 12 * scale || x > mapX + mapW - 12 * scale) return;
        if (y < mapY + 12 * scale || y > mapY + mapH - 12 * scale) return;
        const clipped = clean.length > 14 ? `${clean.slice(0, 13)}...` : clean;
        ctx.font = `700 ${Math.round(10.5 * scale)}px "MiSans","Microsoft YaHei",sans-serif`;
        const textW = ctx.measureText(clipped).width;
        const padX = 6 * scale;
        const boxW = textW + padX * 2;
        const boxH = 16 * scale;
        const bx = x - boxW / 2;
        const by = y - boxH - 4 * scale;

        ctx.save();
        drawRoundedRect(ctx, bx, by, boxW, boxH, 6 * scale);
        ctx.fillStyle = "rgba(255,255,255,0.88)";
        ctx.fill();
        ctx.strokeStyle = "rgba(59,130,246,0.32)";
        ctx.lineWidth = 1 * scale;
        ctx.stroke();
        ctx.fillStyle = "#0f172a";
        ctx.textBaseline = "middle";
        ctx.fillText(clipped, bx + padX, by + boxH / 2);
        ctx.restore();
    }

    async function renderMapPosterCanvas(map, inputRoutes, options = {}) {
        const routes = normalizeRoutes(inputRoutes).slice(0, clamp(safeNumber(options.maxRoutes, 900), 20, 2500));
        if (!routes.length) throw new Error("没有可导出的 OD 线路");
        if (!map) throw new Error("地图对象不可用，无法导出底图");

        await waitForMapStable(map);

        const mapSize = map.getSize();
        if (!mapSize || mapSize.x < 40 || mapSize.y < 40) {
            throw new Error("地图尺寸异常，无法导出");
        }

        const mapScale = clamp(safeNumber(options.mapScale, 2.2), 1.2, 4);
        const dpr = (typeof window !== "undefined" && window.devicePixelRatio) ? window.devicePixelRatio : 1;
        const qualityScale = clamp(safeNumber(options.qualityScale, dpr), 1, 2);
        const drawScale = clamp(mapScale * qualityScale, 1.4, 5);

        const pad = 28 * drawScale;
        const headerH = 88 * drawScale;
        const mapW = mapSize.x * drawScale;
        const mapH = mapSize.y * drawScale;
        const sideW = Math.max(300 * drawScale, Math.min(500 * drawScale, mapW * 0.34));
        const width = Math.round(mapW + sideW + pad * 3);
        const height = Math.round(mapH + headerH + pad * 2);
        const mapX = pad;
        const mapY = headerH + pad * 0.55;
        const sideX = mapX + mapW + pad;
        const sideY = mapY;
        const sideH = mapH;
        const cornerRadius = 22 * drawScale;

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(2, Math.round(width));
        canvas.height = Math.max(2, Math.round(height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器不支持 Canvas 导出");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#f7fbff");
        bgGrad.addColorStop(0.56, "#e8f1ff");
        bgGrad.addColorStop(1, "#dde9ff");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = "rgba(59,130,246,0.08)";
        ctx.beginPath();
        ctx.arc(width * 0.18, height * 0.2, height * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(14,165,233,0.07)";
        ctx.beginPath();
        ctx.arc(width * 0.76, height * 0.78, height * 0.25, 0, Math.PI * 2);
        ctx.fill();

        drawRoundedRect(ctx, mapX, mapY, mapW, mapH, cornerRadius);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.strokeStyle = "#bfdbfe";
        ctx.lineWidth = 1.2 * drawScale;
        ctx.stroke();

        drawRoundedRect(ctx, sideX, sideY, sideW, sideH, cornerRadius);
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fill();
        ctx.strokeStyle = "#bfdbfe";
        ctx.lineWidth = 1.2 * drawScale;
        ctx.stroke();

        await drawLeafletTiles(ctx, map, mapX, mapY, drawScale, cornerRadius);

        ctx.save();
        drawRoundedRect(ctx, mapX, mapY, mapW, mapH, cornerRadius);
        ctx.clip();
        const overlay = ctx.createLinearGradient(mapX, mapY, mapX + mapW, mapY + mapH);
        overlay.addColorStop(0, "rgba(30,64,175,0.06)");
        overlay.addColorStop(1, "rgba(15,118,110,0.04)");
        ctx.fillStyle = overlay;
        ctx.fillRect(mapX, mapY, mapW, mapH);
        ctx.restore();

        const categoryColors = options.categoryColors || {};
        routes.forEach((route, idx) => {
            const color = colorForCategory(route.category, idx, categoryColors);
            const { p1, p2, c } = routeCurvePoints(route, map);
            ctx.beginPath();
            ctx.moveTo(mapX + p1.x * drawScale, mapY + p1.y * drawScale);
            ctx.quadraticCurveTo(
                mapX + c.x * drawScale,
                mapY + c.y * drawScale,
                mapX + p2.x * drawScale,
                mapY + p2.y * drawScale
            );
            ctx.strokeStyle = colorWithAlpha(color, 0.74);
            ctx.lineWidth = 3.2 * drawScale;
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.beginPath();
            ctx.fillStyle = colorWithAlpha(color, 0.95);
            ctx.arc(mapX + p2.x * drawScale, mapY + p2.y * drawScale, 4 * drawScale, 0, Math.PI * 2);
            ctx.fill();
        });

        const labelLimit = clamp(safeNumber(options.labelLimit, 90), 0, 220);
        pickLabeledRoutes(routes, labelLimit).forEach((route) => {
            const { m } = routeCurvePoints(route, map);
            drawNameTag(
                ctx,
                route.user_name,
                mapX + m.x * drawScale,
                mapY + m.y * drawScale,
                mapX,
                mapY,
                mapW,
                mapH,
                drawScale
            );
        });

        const owner = options.owner ? ` | 导出用户：${options.owner}` : "";
        const subtitle = options.subtitle || "地图底图 + OD 线路导出";
        const title = options.title || "OD 流向图";

        ctx.fillStyle = "#1e3a8a";
        ctx.font = `900 ${Math.round(34 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText(title, pad, 46 * drawScale);
        ctx.fillStyle = "#475569";
        ctx.font = `600 ${Math.round(16 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText(subtitle, pad, 72 * drawScale);
        ctx.fillStyle = "#64748b";
        ctx.font = `${Math.round(12 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText(`${new Date().toLocaleString("zh-CN", { hour12: false })}${owner}`, pad, 92 * drawScale);

        const legendItems = buildCategoryLegend(routes).slice(0, 8);
        ctx.fillStyle = "#1e3a8a";
        ctx.font = `900 ${Math.round(22 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText("导出摘要", sideX + 18 * drawScale, sideY + 34 * drawScale);
        ctx.fillStyle = "#334155";
        ctx.font = `${Math.round(14 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText(`线路总数：${routes.length} 条`, sideX + 18 * drawScale, sideY + 62 * drawScale);
        ctx.fillText(`标注人名：${pickLabeledRoutes(routes, labelLimit).length}`, sideX + 18 * drawScale, sideY + 86 * drawScale);
        ctx.fillText(`底图模式：${options.baseMapMode === "satellite" ? "卫星影像" : "矢量地图"}`, sideX + 18 * drawScale, sideY + 110 * drawScale);

        ctx.fillStyle = "#1e3a8a";
        ctx.font = `800 ${Math.round(17 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText("分类统计", sideX + 18 * drawScale, sideY + 146 * drawScale);

        legendItems.forEach((item, idx) => {
            const y = sideY + 172 * drawScale + idx * 28 * drawScale;
            const cat = item[0];
            const stat = item[1];
            const color = colorForCategory(cat, idx, categoryColors);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(sideX + 24 * drawScale, y - 5 * drawScale, 5 * drawScale, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#1f2937";
            ctx.font = `${Math.round(14 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
            ctx.fillText(cat, sideX + 36 * drawScale, y);
            ctx.fillStyle = "#475569";
            const txt = `${stat.count} 条`;
            const txtW = ctx.measureText(txt).width;
            ctx.fillText(txt, sideX + sideW - 16 * drawScale - txtW, y);
        });

        const latestRoutes = [...routes]
            .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
            .slice(0, 7);
        const topHeadY = sideY + sideH - 220 * drawScale;
        ctx.fillStyle = "#1e3a8a";
        ctx.font = `800 ${Math.round(17 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText("最近路线", sideX + 18 * drawScale, topHeadY);
        ctx.fillStyle = "#334155";
        ctx.font = `${Math.round(12 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        latestRoutes.forEach((route, idx) => {
            const y = topHeadY + 24 * drawScale + idx * 22 * drawScale;
            const label = `${idx + 1}. ${routeLabel(route)}`;
            const clipped = label.length > 38 ? `${label.slice(0, 37)}...` : label;
            ctx.fillText(clipped, sideX + 18 * drawScale, y);
        });

        return canvas;
    }

    async function canvasToBlob(canvas, type = "image/png", quality = 1) {
        const blob = await new Promise((resolve) => {
            canvas.toBlob((b) => resolve(b), type, quality);
        });
        if (!blob) throw new Error("图片编码失败");
        return blob;
    }

    async function downloadPoster(routes, options = {}) {
        const filename = options.filename || `od_poster_${nowStamp()}`;
        const format = String(options.format || "png").toLowerCase();
        const width = clamp(safeNumber(options.width, 1920), 960, 4096);
        const height = clamp(safeNumber(options.height, 1080), 600, 4096);

        if (options.map) {
            const canvas = await renderMapPosterCanvas(options.map, routes, options);
            if (format === "svg") {
                throw new Error("带底图导出当前仅支持 PNG，请选择 PNG");
            }
            const blob = await canvasToBlob(canvas, "image/png", 1);
            downloadBlob(blob, `${filename}.png`);
            return;
        }

        const svgText = createPosterSvg(routes, options);
        if (format === "svg") {
            downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
            return;
        }

        const pngBlob = await svgToPngBlob(svgText, width, height, clamp(safeNumber(options.scale, 2.4), 1, 5));
        downloadBlob(pngBlob, `${filename}.png`);
    }

    window.odExport = {
        createPosterSvg,
        downloadPoster,
        renderMapPosterCanvas,
    };
})();
