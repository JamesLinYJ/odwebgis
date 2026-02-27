(function () {
    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function safeNumber(value, fallback = 0) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function escapeXml(text) {
        return String(text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }

    function colorWithAlpha(hex, alpha) {
        const c = String(hex || "").trim();
        const m = c.match(/^#([0-9a-fA-F]{6})$/);
        if (!m) {
            return `rgba(37,99,235,${clamp(alpha, 0, 1).toFixed(3)})`;
        }
        const int = parseInt(m[1], 16);
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r},${g},${b},${clamp(alpha, 0, 1).toFixed(3)})`;
    }

    function routeLabel(route) {
        const o = route.origin_name || "O";
        const d = route.destination_name || "D";
        return `${o} -> ${d}`;
    }

    function normalizeRoutes(routes) {
        return (routes || [])
            .map((route, idx) => {
                const originLat = safeNumber(route.origin_lat, NaN);
                const originLon = safeNumber(route.origin_lon, NaN);
                const destinationLat = safeNumber(route.destination_lat, NaN);
                const destinationLon = safeNumber(route.destination_lon, NaN);
                const flowWeight = Math.max(0.01, safeNumber(route.flow_weight, 1));
                return {
                    id: route.id || `route_${idx + 1}`,
                    origin_name: route.origin_name || "起点",
                    destination_name: route.destination_name || "终点",
                    origin_lat: originLat,
                    origin_lon: originLon,
                    destination_lat: destinationLat,
                    destination_lon: destinationLon,
                    flow_weight: flowWeight,
                    category: route.category || "未分类",
                    user_name: route.user_name || "",
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

    function makeCurvePath(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = Math.max(12, dist * 0.2);
        const cx = (x1 + x2) / 2 + (dy / dist) * offset;
        const cy = (y1 + y2) / 2 - (dx / dist) * offset;
        return `M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }

    function formatFlow(num) {
        return safeNumber(num, 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
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

    function createPosterSvg(inputRoutes, options = {}) {
        const routes = normalizeRoutes(inputRoutes).slice(0, clamp(safeNumber(options.maxRoutes, 900), 20, 2500));
        if (!routes.length) {
            throw new Error("没有可导出的 OD 线路");
        }

        const width = clamp(safeNumber(options.width, 1920), 960, 4096);
        const height = clamp(safeNumber(options.height, 1080), 600, 4096);
        const title = options.title || "OD 流向图";
        const subtitle = options.subtitle || "WebGIS 教学导出";
        const owner = options.owner || "";
        const categoryColors = options.categoryColors || {};

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

        const flowValues = routes.map((r) => safeNumber(r.flow_weight, 1));
        const flowMin = Math.min(...flowValues);
        const flowMax = Math.max(...flowValues);
        const flowSpan = Math.max(1e-6, flowMax - flowMin);
        const totalFlow = flowValues.reduce((sum, v) => sum + v, 0);

        const drawRoutes = [...routes].sort((a, b) => safeNumber(a.flow_weight, 0) - safeNumber(b.flow_weight, 0));
        const lines = [];
        const points = [];

        drawRoutes.forEach((route, idx) => {
            const [x1, y1] = project(route.origin_lat, route.origin_lon);
            const [x2, y2] = project(route.destination_lat, route.destination_lon);
            const ratio = (safeNumber(route.flow_weight, 1) - flowMin) / flowSpan;
            const widthPx = 1.2 + ratio * 7.2;
            const opacity = 0.22 + ratio * 0.7;
            const baseColor = categoryColors[route.category] || ["#2563eb", "#0891b2", "#7c3aed", "#f97316", "#0f766e"][idx % 5];

            lines.push(
                `<path d="${makeCurvePath(x1, y1, x2, y2)}" stroke="${escapeXml(baseColor)}" stroke-width="${widthPx.toFixed(2)}" stroke-linecap="round" fill="none" opacity="${opacity.toFixed(3)}"/>`
            );

            points.push(
                `<circle cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="${(2 + ratio * 2.4).toFixed(2)}" fill="${escapeXml(colorWithAlpha(baseColor, 0.82))}"/>`,
                `<circle cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="${(2.2 + ratio * 2.8).toFixed(2)}" fill="${escapeXml(baseColor)}"/>`
            );
        });

        const byCategory = new Map();
        routes.forEach((route) => {
            const current = byCategory.get(route.category) || { count: 0, flow: 0 };
            current.count += 1;
            current.flow += safeNumber(route.flow_weight, 0);
            byCategory.set(route.category, current);
        });
        const legendItems = Array.from(byCategory.entries())
            .sort((a, b) => b[1].flow - a[1].flow)
            .slice(0, 8);

        const legend = legendItems
            .map((item, idx) => {
                const cat = item[0];
                const stat = item[1];
                const color = categoryColors[cat] || ["#2563eb", "#0891b2", "#7c3aed", "#f97316", "#0f766e"][idx % 5];
                const y = sideY + 260 + idx * 36;
                return (
                    `<circle cx="${sideX + 28}" cy="${y}" r="7" fill="${escapeXml(color)}"/>` +
                    `<text x="${sideX + 44}" y="${y + 4}" font-size="17" fill="#1f2937">${escapeXml(cat)}</text>` +
                    `<text x="${sideX + sideW - 22}" y="${y + 4}" text-anchor="end" font-size="15" fill="#475569">${escapeXml(formatFlow(stat.flow))}</text>`
                );
            })
            .join("");

        const topRoutes = [...routes]
            .sort((a, b) => safeNumber(b.flow_weight, 0) - safeNumber(a.flow_weight, 0))
            .slice(0, 6);
        const topRows = topRoutes
            .map((route, idx) => {
                const y = sideY + sideH - 182 + idx * 28;
                return (
                    `<text x="${sideX + 20}" y="${y}" font-size="14" fill="#334155">` +
                    `${idx + 1}. ${escapeXml(routeLabel(route))}` +
                    `</text>`
                );
            })
            .join("");

        const nowText = new Date().toLocaleString("zh-CN", { hour12: false });
        const ownerText = owner ? ` | 导出用户：${owner}` : "";

        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            `<defs>` +
            `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="#f8fbff"/>` +
            `<stop offset="56%" stop-color="#e8f0ff"/>` +
            `<stop offset="100%" stop-color="#dde8ff"/>` +
            `</linearGradient>` +
            `<linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">` +
            `<stop offset="0%" stop-color="#ffffff"/>` +
            `<stop offset="100%" stop-color="#f6f9ff"/>` +
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

            `<g>${lines.join("")}</g>` +
            `<g>${points.join("")}</g>` +

            `<text x="${sideX + 20}" y="${sideY + 46}" font-size="26" font-weight="900" fill="#1e3a8a">导出摘要</text>` +
            `<text x="${sideX + 20}" y="${sideY + 84}" font-size="16" fill="#334155">线路总数：${escapeXml(String(routes.length))} 条</text>` +
            `<text x="${sideX + 20}" y="${sideY + 112}" font-size="16" fill="#334155">总流量：${escapeXml(formatFlow(totalFlow))}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 140}" font-size="16" fill="#334155">经度范围：${bounds.minLon.toFixed(2)} ~ ${bounds.maxLon.toFixed(2)}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 168}" font-size="16" fill="#334155">纬度范围：${bounds.minLat.toFixed(2)} ~ ${bounds.maxLat.toFixed(2)}</text>` +
            `<text x="${sideX + 20}" y="${sideY + 214}" font-size="20" font-weight="800" fill="#1e3a8a">分类流量</text>` +
            `${legend}` +
            `<text x="${sideX + 20}" y="${sideY + sideH - 208}" font-size="20" font-weight="800" fill="#1e3a8a">Top 路线</text>` +
            `${topRows}` +
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
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        const pngBlob = await new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), "image/png", 1);
        });
        if (!pngBlob) {
            throw new Error("PNG 导出失败");
        }
        return pngBlob;
    }

    async function downloadPoster(routes, options = {}) {
        const filename = options.filename || `od_poster_${nowStamp()}`;
        const format = String(options.format || "png").toLowerCase();
        const svgText = createPosterSvg(routes, options);
        const width = clamp(safeNumber(options.width, 1920), 960, 4096);
        const height = clamp(safeNumber(options.height, 1080), 600, 4096);

        if (format === "svg") {
            downloadBlob(new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }), `${filename}.svg`);
            return;
        }

        const pngBlob = await svgToPngBlob(svgText, width, height, clamp(safeNumber(options.scale, 2), 1, 4));
        downloadBlob(pngBlob, `${filename}.png`);
    }

    window.odExport = {
        createPosterSvg,
        downloadPoster,
    };
})();
