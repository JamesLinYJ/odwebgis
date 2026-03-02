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

    function colorForCategory(category, idx, customMap = {}) {
        return customMap[category] || ["#2563eb", "#0891b2", "#7c3aed", "#f97316", "#0f766e", "#dc2626", "#14b8a6"][idx % 7];
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
        return { cx, cy };
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

    function pickNiceDistanceKm(targetKm) {
        const target = Math.max(0.02, Number(targetKm) || 0.02);
        const exp = Math.floor(Math.log10(target));
        const base = Math.pow(10, exp);
        const candidates = [1, 2, 5, 10].map((n) => n * base);
        let best = candidates[0];
        let delta = Math.abs(best - target);
        candidates.forEach((c) => {
            const d = Math.abs(c - target);
            if (d < delta) {
                best = c;
                delta = d;
            }
        });
        return Math.max(best, 0.02);
    }

    function formatDistanceLabel(km) {
        if (km >= 1) return `${Number(km.toFixed(km >= 10 ? 0 : 1))} km`;
        return `${Math.round(km * 1000)} m`;
    }

    function estimateKmPerPixelFromBounds(bounds, pixelWidth) {
        const meanLat = (bounds.minLat + bounds.maxLat) / 2;
        const spanLon = Math.max(1e-6, bounds.maxLon - bounds.minLon);
        const kmPerDegLon = 111.32 * Math.cos((meanLat * Math.PI) / 180);
        return (spanLon * kmPerDegLon) / Math.max(1, pixelWidth);
    }

    function estimateKmPerPixelFromMap(map, mapSize) {
        try {
            const y = Math.round(mapSize.y * 0.7);
            const left = map.containerPointToLatLng([0, y]);
            const right = map.containerPointToLatLng([100, y]);
            if (!left || !right || typeof left.distanceTo !== "function") return null;
            const meters = left.distanceTo(right);
            if (!Number.isFinite(meters) || meters <= 0) return null;
            return (meters / 1000) / 100;
        } catch {
            return null;
        }
    }

    function createScaleSpec(kmPerPixel, targetPx, minPx, maxPx) {
        const safeKmPerPx = Math.max(1e-6, Number(kmPerPixel) || 1e-6);
        const targetKm = safeKmPerPx * targetPx;
        const niceKm = pickNiceDistanceKm(targetKm);
        const barPx = clamp(niceKm / safeKmPerPx, minPx, maxPx);
        const shownKm = safeKmPerPx * barPx;
        return {
            barPx,
            label: formatDistanceLabel(shownKm),
        };
    }

    function curveBox(x1, y1, cx, cy, x2, y2, pad = 0) {
        return {
            x: Math.min(x1, cx, x2) - pad,
            y: Math.min(y1, cy, y2) - pad,
            w: Math.max(x1, cx, x2) - Math.min(x1, cx, x2) + pad * 2,
            h: Math.max(y1, cy, y2) - Math.min(y1, cy, y2) + pad * 2,
        };
    }

    function rectOverlapArea(a, b) {
        const x1 = Math.max(a.x, b.x);
        const y1 = Math.max(a.y, b.y);
        const x2 = Math.min(a.x + a.w, b.x + b.w);
        const y2 = Math.min(a.y + a.h, b.y + b.h);
        if (x2 <= x1 || y2 <= y1) return 0;
        return (x2 - x1) * (y2 - y1);
    }

    function pickBottomRightLegendBox(mapX, mapY, mapW, mapH, panelW, panelH, routeBoxes, gap = 16) {
        const maxPanelW = Math.max(96, mapW - gap * 2);
        const maxPanelH = Math.max(64, mapH - gap * 2);
        const w = Math.min(panelW, maxPanelW);
        const h = Math.min(panelH, maxPanelH);
        const x = mapX + mapW - gap - w;
        const yStart = mapY + mapH - gap - h;
        const yMin = mapY + gap;
        const step = Math.max(6, Math.round(h / 12));

        let best = { x, y: yStart, score: Number.POSITIVE_INFINITY };
        for (let y = yStart; y >= yMin; y -= step) {
            const box = { x, y, w, h };
            let overlap = 0;
            routeBoxes.forEach((rb) => {
                overlap += rectOverlapArea(box, rb);
            });
            // Prefer staying near bottom-right when overlap is equal.
            const score = overlap + (yStart - y) * w * 0.05;
            if (score < best.score) {
                best = { x, y, score };
                if (overlap < 1e-3) break;
            }
        }
        return { x: best.x, y: best.y, w, h };
    }

    function drawNorthArrowSvg(x, y, size) {
        const half = size / 2;
        return (
            `<g>` +
            `<circle cx="${x}" cy="${y}" r="${half + 8}" fill="rgba(255,255,255,0.9)" stroke="#bfdbfe"/>` +
            `<path d="M ${x} ${y - half} L ${x - half * 0.42} ${y + half * 0.56} L ${x} ${y + half * 0.2} L ${x + half * 0.42} ${y + half * 0.56} Z" fill="#1d4ed8"/>` +
            `<text x="${x}" y="${y - half - 8}" text-anchor="middle" font-size="${Math.round(size * 0.36)}" font-weight="800" fill="#1e3a8a">N</text>` +
            `</g>`
        );
    }

    function createPosterSvg(inputRoutes, options = {}) {
        const routes = normalizeRoutes(inputRoutes).slice(0, clamp(safeNumber(options.maxRoutes, 900), 20, 2500));
        if (!routes.length) throw new Error("没有可导出的 OD 线路");

        const width = clamp(safeNumber(options.width, 1920), 960, 4096);
        const height = clamp(safeNumber(options.height, 1080), 600, 4096);
        const title = options.title || "OD 流向图";
        const categoryColors = options.categoryColors || {};

        const pad = 48;
        const headerH = 86;
        const mapX = pad;
        const mapY = headerH;
        const mapW = width - pad * 2;
        const mapH = height - mapY - pad;
        const mapInset = 18;

        const bounds = computeBounds(routes);
        const project = makeProjector(bounds, mapX + mapInset, mapY + mapInset, mapW - mapInset * 2, mapH - mapInset * 2);

        const linePaths = [];
        const points = [];
        const routeBoxes = [];
        routes.forEach((route, idx) => {
            const [x1, y1] = project(route.origin_lat, route.origin_lon);
            const [x2, y2] = project(route.destination_lat, route.destination_lon);
            const { cx, cy } = makeCurveGeometry(x1, y1, x2, y2);
            const color = colorForCategory(route.category, idx, categoryColors);
            linePaths.push(
                `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${escapeXml(color)}" stroke-width="2.4" stroke-linecap="round" fill="none" opacity="0.8"/>`
            );
            routeBoxes.push(curveBox(x1, y1, cx, cy, x2, y2, 8));
            points.push(
                `<circle cx="${x1.toFixed(2)}" cy="${y1.toFixed(2)}" r="3" fill="${escapeXml(colorWithAlpha(color, 0.7))}"/>`,
                `<circle cx="${x2.toFixed(2)}" cy="${y2.toFixed(2)}" r="3.6" fill="${escapeXml(color)}"/>`
            );
        });

        const maxLegendItems = Math.max(3, Math.min(10, Math.floor((mapH - 120) / 24)));
        const legendItems = buildCategoryLegend(routes).slice(0, maxLegendItems);
        const legendTextChars = legendItems.reduce((maxChars, item) => {
            const text = `${item[0]} ${item[1].count} 条`;
            return Math.max(maxChars, text.length);
        }, 4);
        const legendPadX = 14;
        const legendPadY = 12;
        const legendRowH = 24;
        const legendPanelW = clamp(legendPadX * 2 + 58 + legendTextChars * 8.3, 180, mapW * 0.5);
        const legendPanelH = clamp(legendPadY * 2 + 26 + legendItems.length * legendRowH, 92, mapH - 30);
        const legendRect = pickBottomRightLegendBox(mapX, mapY, mapW, mapH, legendPanelW, legendPanelH, routeBoxes, 16);
        const legendSvg = legendItems.map((item, idx) => {
            const cat = item[0];
            const stat = item[1];
            const color = colorForCategory(cat, idx, categoryColors);
            const y = legendRect.y + legendPadY + 30 + idx * legendRowH;
            return (
                `<circle cx="${legendRect.x + legendPadX + 8}" cy="${y - 4}" r="5.5" fill="${escapeXml(color)}"/>` +
                `<text x="${legendRect.x + legendPadX + 22}" y="${y}" font-size="13.5" fill="#1f2937">${escapeXml(cat)}</text>` +
                `<text x="${legendRect.x + legendRect.w - legendPadX}" y="${y}" text-anchor="end" font-size="13" fill="#475569">${escapeXml(`${stat.count} 条`)}</text>`
            );
        }).join("");

        const kmPerPixel = estimateKmPerPixelFromBounds(bounds, mapW - mapInset * 2);
        const scaleSpec = createScaleSpec(kmPerPixel, (mapW - mapInset * 2) * 0.22, 70, 220);
        const scaleX = mapX + 28;
        const scaleY = mapY + mapH - 28;
        const northX = mapX + mapW - 44;
        const northY = mapY + 46;

        return (
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
            `<defs>` +
            `<linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="#f8fbff"/><stop offset="58%" stop-color="#edf4ff"/><stop offset="100%" stop-color="#e4eeff"/>` +
            `</linearGradient>` +
            `<linearGradient id="mapMask" x1="0" y1="0" x2="1" y2="1">` +
            `<stop offset="0%" stop-color="rgba(30,64,175,0.08)"/><stop offset="100%" stop-color="rgba(14,165,233,0.06)"/>` +
            `</linearGradient>` +
            `<filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%">` +
            `<feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#1d4ed8" flood-opacity="0.12"/>` +
            `</filter>` +
            `</defs>` +

            `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrad)"/>` +
            `<text x="${pad}" y="56" font-size="38" font-weight="900" fill="#1e3a8a">${escapeXml(title)}</text>` +

            `<g filter="url(#softShadow)">` +
            `<rect x="${mapX}" y="${mapY}" width="${mapW}" height="${mapH}" rx="20" fill="#ffffff" stroke="#bfdbfe"/>` +
            `</g>` +

            `<g opacity="0.35">` +
            `${Array.from({ length: 8 }, (_, i) => {
                const x = mapX + mapInset + (i * (mapW - mapInset * 2)) / 7;
                return `<line x1="${x.toFixed(2)}" y1="${(mapY + mapInset).toFixed(2)}" x2="${x.toFixed(2)}" y2="${(mapY + mapH - mapInset).toFixed(2)}" stroke="#dbeafe" stroke-width="1"/>`;
            }).join("")}` +
            `${Array.from({ length: 6 }, (_, i) => {
                const y = mapY + mapInset + (i * (mapH - mapInset * 2)) / 5;
                return `<line x1="${(mapX + mapInset).toFixed(2)}" y1="${y.toFixed(2)}" x2="${(mapX + mapW - mapInset).toFixed(2)}" y2="${y.toFixed(2)}" stroke="#dbeafe" stroke-width="1"/>`;
            }).join("")}` +
            `</g>` +

            `<rect x="${mapX + 1}" y="${mapY + 1}" width="${mapW - 2}" height="${mapH - 2}" rx="20" fill="url(#mapMask)"/>` +
            `<g>${linePaths.join("")}</g>` +
            `<g>${points.join("")}</g>` +

            `<g>` +
            `<rect x="${legendRect.x}" y="${legendRect.y}" width="${legendRect.w}" height="${legendRect.h}" rx="14" fill="rgba(255,255,255,0.93)" stroke="#bfdbfe"/>` +
            `<text x="${legendRect.x + legendPadX}" y="${legendRect.y + legendPadY + 14}" font-size="18" font-weight="900" fill="#1e3a8a">图例</text>` +
            `${legendSvg}` +
            `</g>` +

            `<g>` +
            `<rect x="${scaleX - 10}" y="${scaleY - 22}" width="${scaleSpec.barPx + 20}" height="28" rx="8" fill="rgba(255,255,255,0.9)" stroke="#bfdbfe"/>` +
            `<rect x="${scaleX}" y="${scaleY - 10}" width="${(scaleSpec.barPx / 2).toFixed(2)}" height="6" fill="#0f172a"/>` +
            `<rect x="${(scaleX + scaleSpec.barPx / 2).toFixed(2)}" y="${scaleY - 10}" width="${(scaleSpec.barPx / 2).toFixed(2)}" height="6" fill="#ffffff" stroke="#0f172a" stroke-width="1"/>` +
            `<text x="${scaleX}" y="${scaleY - 14}" font-size="12" fill="#0f172a">0</text>` +
            `<text x="${(scaleX + scaleSpec.barPx).toFixed(2)}" y="${scaleY - 14}" text-anchor="end" font-size="12" fill="#0f172a">${escapeXml(scaleSpec.label)}</text>` +
            `</g>` +

            `${drawNorthArrowSvg(northX, northY, 28)}` +
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
        return { p1, p2, c: { x: cx, y: cy } };
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

    function drawNorthArrowCanvas(ctx, x, y, size) {
        const half = size / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, half + 8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#bfdbfe";
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x, y - half);
        ctx.lineTo(x - half * 0.42, y + half * 0.56);
        ctx.lineTo(x, y + half * 0.2);
        ctx.lineTo(x + half * 0.42, y + half * 0.56);
        ctx.closePath();
        ctx.fillStyle = "#1d4ed8";
        ctx.fill();

        ctx.fillStyle = "#1e3a8a";
        ctx.font = `800 ${Math.max(10, Math.round(size * 0.36))}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("N", x, y - half - 8);
        ctx.restore();
    }

    function drawScaleBarCanvas(ctx, spec, x, y) {
        const width = spec.barPx;
        const half = width / 2;
        ctx.save();
        drawRoundedRect(ctx, x - 10, y - 22, width + 20, 28, 8);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        ctx.strokeStyle = "#bfdbfe";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#0f172a";
        ctx.fillRect(x, y - 10, half, 6);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x + half, y - 10, half, 6);
        ctx.strokeStyle = "#0f172a";
        ctx.strokeRect(x + half, y - 10, half, 6);

        ctx.fillStyle = "#0f172a";
        ctx.font = `600 12px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText("0", x, y - 14);
        ctx.textAlign = "right";
        ctx.fillText(spec.label, x + width, y - 14);
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
        const headerH = 72 * drawScale;
        const mapW = mapSize.x * drawScale;
        const mapH = mapSize.y * drawScale;
        const width = Math.round(mapW + pad * 2);
        const height = Math.round(mapH + headerH + pad * 2);
        const mapX = pad;
        const mapY = headerH + pad * 0.55;
        const cornerRadius = 22 * drawScale;

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(2, Math.round(width));
        canvas.height = Math.max(2, Math.round(height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("浏览器不支持 Canvas 导出");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#f8fbff");
        bgGrad.addColorStop(0.58, "#edf4ff");
        bgGrad.addColorStop(1, "#e4eeff");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        drawRoundedRect(ctx, mapX, mapY, mapW, mapH, cornerRadius);
        ctx.fillStyle = "#ffffff";
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
        overlay.addColorStop(1, "rgba(14,165,233,0.05)");
        ctx.fillStyle = overlay;
        ctx.fillRect(mapX, mapY, mapW, mapH);
        ctx.restore();

        const categoryColors = options.categoryColors || {};
        const routeBoxes = [];
        routes.forEach((route, idx) => {
            const color = colorForCategory(route.category, idx, categoryColors);
            const { p1, p2, c } = routeCurvePoints(route, map);
            const x1 = mapX + p1.x * drawScale;
            const y1 = mapY + p1.y * drawScale;
            const x2 = mapX + p2.x * drawScale;
            const y2 = mapY + p2.y * drawScale;
            const cx = mapX + c.x * drawScale;
            const cy = mapY + c.y * drawScale;

            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo(cx, cy, x2, y2);
            ctx.strokeStyle = colorWithAlpha(color, 0.78);
            ctx.lineWidth = 3.1 * drawScale;
            ctx.lineCap = "round";
            ctx.stroke();

            routeBoxes.push(curveBox(x1, y1, cx, cy, x2, y2, 8 * drawScale));

            ctx.beginPath();
            ctx.fillStyle = colorWithAlpha(color, 0.95);
            ctx.arc(x2, y2, 4 * drawScale, 0, Math.PI * 2);
            ctx.fill();
        });

        const title = options.title || "OD 流向图";
        ctx.fillStyle = "#1e3a8a";
        ctx.font = `900 ${Math.round(34 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.fillText(title, pad, 46 * drawScale);

        const maxLegendItems = Math.max(3, Math.min(10, Math.floor((mapH - 120 * drawScale) / (26 * drawScale))));
        const legendItems = buildCategoryLegend(routes).slice(0, maxLegendItems);
        const legendPadX = 14 * drawScale;
        const legendPadY = 12 * drawScale;
        const legendRowH = 24 * drawScale;

        ctx.save();
        ctx.font = `${Math.round(13 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        const maxTextWidth = legendItems.reduce((maxW, item) => {
            const label = `${item[0]}  ${item[1].count} 条`;
            return Math.max(maxW, ctx.measureText(label).width);
        }, 90 * drawScale);
        ctx.restore();

        const legendPanelW = clamp(legendPadX * 2 + 22 * drawScale + maxTextWidth, 180 * drawScale, mapW * 0.5);
        const legendPanelH = clamp(legendPadY * 2 + 28 * drawScale + legendItems.length * legendRowH, 92 * drawScale, mapH - 30 * drawScale);
        const legendRect = pickBottomRightLegendBox(mapX, mapY, mapW, mapH, legendPanelW, legendPanelH, routeBoxes, 16 * drawScale);

        drawRoundedRect(ctx, legendRect.x, legendRect.y, legendRect.w, legendRect.h, 14 * drawScale);
        ctx.fillStyle = "rgba(255,255,255,0.93)";
        ctx.fill();
        ctx.strokeStyle = "#bfdbfe";
        ctx.lineWidth = 1.1 * drawScale;
        ctx.stroke();

        ctx.fillStyle = "#1e3a8a";
        ctx.font = `900 ${Math.round(18 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText("图例", legendRect.x + legendPadX, legendRect.y + legendPadY + 13 * drawScale);

        legendItems.forEach((item, idx) => {
            const y = legendRect.y + legendPadY + 31 * drawScale + idx * legendRowH;
            const cat = item[0];
            const stat = item[1];
            const color = colorForCategory(cat, idx, categoryColors);

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(legendRect.x + legendPadX + 8 * drawScale, y - 4 * drawScale, 5 * drawScale, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#1f2937";
            ctx.font = `${Math.round(13 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
            ctx.textAlign = "left";
            ctx.fillText(cat, legendRect.x + legendPadX + 21 * drawScale, y);

            ctx.fillStyle = "#475569";
            ctx.textAlign = "right";
            ctx.fillText(`${stat.count} 条`, legendRect.x + legendRect.w - legendPadX, y);
        });

        const kmPerPixel = estimateKmPerPixelFromMap(map, mapSize) || estimateKmPerPixelFromBounds(computeBounds(routes), mapSize.x);
        const scaleSpec = createScaleSpec(kmPerPixel, mapSize.x * 0.22, 70, 220);
        drawScaleBarCanvas(
            ctx,
            { barPx: scaleSpec.barPx * drawScale, label: scaleSpec.label },
            mapX + 28 * drawScale,
            mapY + mapH - 18 * drawScale
        );
        drawNorthArrowCanvas(ctx, mapX + mapW - 40 * drawScale, mapY + 40 * drawScale, 28 * drawScale);

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
