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
                    user_id: route.user_id ?? "",
                    user_name: route.user_name || route.name || "",
                    username: route.username || route.user_username || "",
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

    function personNameForRoute(route, idx = 0) {
        const name = String(route.user_name || "").trim();
        if (name) return name;
        const username = String(route.username || "").trim();
        if (username) return username;
        const userId = route.user_id === 0 || route.user_id ? String(route.user_id) : "";
        if (userId) return `用户#${userId}`;
        return `用户${idx + 1}`;
    }

    function personKeyForRoute(route, idx = 0) {
        const userId = route.user_id === 0 || route.user_id ? String(route.user_id) : "";
        if (userId) return `id:${userId}`;
        const username = String(route.username || "").trim().toLowerCase();
        if (username) return `username:${username}`;
        const name = String(route.user_name || "").trim().toLowerCase();
        if (name) return `name:${name}`;
        return `route:${route.id || idx + 1}`;
    }

    function hashToUInt32(text) {
        const s = String(text || "");
        let h = 2166136261 >>> 0;
        for (let i = 0; i < s.length; i += 1) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h >>> 0;
    }

    function hslToHex(h, s, l) {
        const hue = ((Number(h) % 360) + 360) % 360;
        const sat = clamp(Number(s) || 0, 0, 100) / 100;
        const lit = clamp(Number(l) || 0, 0, 100) / 100;
        const c = (1 - Math.abs(2 * lit - 1)) * sat;
        const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m = lit - c / 2;
        let r = 0;
        let g = 0;
        let b = 0;
        if (hue < 60) {
            r = c; g = x; b = 0;
        } else if (hue < 120) {
            r = x; g = c; b = 0;
        } else if (hue < 180) {
            r = 0; g = c; b = x;
        } else if (hue < 240) {
            r = 0; g = x; b = c;
        } else if (hue < 300) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
        const toHex = (n) => {
            const v = Math.round((n + m) * 255);
            return clamp(v, 0, 255).toString(16).padStart(2, "0");
        };
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function fmtKm(km) {
        if (!Number.isFinite(km)) return "";
        if (km >= 1) return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
        return `${Math.round(km * 1000)} m`;
    }

    function lineStyleSpec(styleMode, routeIndex = 0) {
        const mode = String(styleMode || "flow").toLowerCase();
        if (mode === "solid") {
            return {
                svgDashArray: "",
                canvasDashArray: [],
                haloAlpha: 0.18,
                lineAlphaBoost: 1,
            };
        }
        if (mode === "dashed") {
            return {
                svgDashArray: "10 8",
                canvasDashArray: [10, 8],
                haloAlpha: 0.16,
                lineAlphaBoost: 0.98,
            };
        }
        return {
            svgDashArray: routeIndex % 2 === 0 ? "12 8" : "9 7",
            canvasDashArray: routeIndex % 2 === 0 ? [12, 8] : [9, 7],
            haloAlpha: 0.2,
            lineAlphaBoost: 1.05,
        };
    }

    function quadraticPoint(x1, y1, cx, cy, x2, y2, t) {
        const v = clamp(Number(t) || 0, 0, 1);
        const omt = 1 - v;
        return {
            x: omt * omt * x1 + 2 * omt * v * cx + v * v * x2,
            y: omt * omt * y1 + 2 * omt * v * cy + v * v * y2,
        };
    }

    function quadraticDerivative(x1, y1, cx, cy, x2, y2, t) {
        const v = clamp(Number(t) || 0, 0, 1);
        return {
            x: 2 * (1 - v) * (cx - x1) + 2 * v * (x2 - cx),
            y: 2 * (1 - v) * (cy - y1) + 2 * v * (y2 - cy),
        };
    }

    function routeLabelText(route, labelMode, idx) {
        const mode = String(labelMode || "none").toLowerCase();
        if (mode === "none") return "";
        const person = personNameForRoute(route, idx);
        if (mode === "detail") {
            return `${person} · ${route.category || "未分类"}`;
        }
        return person;
    }

    function normalizeRect(rectLike) {
        if (!rectLike || typeof rectLike !== "object") return null;
        const src = rectLike.box && typeof rectLike.box === "object" ? rectLike.box : rectLike;
        const x = Number(src.x);
        const y = Number(src.y);
        const w = Number(src.w);
        const h = Number(src.h);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
        if (w <= 0 || h <= 0) return null;
        return { x, y, w, h };
    }

    function rectOverlap(a, b) {
        const ra = normalizeRect(a);
        const rb = normalizeRect(b);
        if (!ra || !rb) return false;
        return !(ra.x + ra.w <= rb.x || rb.x + rb.w <= ra.x || ra.y + ra.h <= rb.y || rb.y + rb.h <= ra.y);
    }

    function buildLabelCandidate(x, y, text, fontSize, paddingX, paddingY) {
        const safeText = String(text || "");
        const width = Math.max(40, safeText.length * (fontSize * 0.58) + paddingX * 2);
        const height = fontSize + paddingY * 2;
        return {
            x,
            y,
            text: safeText,
            w: width,
            h: height,
            box: {
                x: x - width / 2,
                y: y - height / 2,
                w: width,
                h: height,
            },
        };
    }

    function canPlaceLabel(candidate, existingBoxes) {
        const rect = normalizeRect(candidate);
        if (!rect) return false;
        return !(existingBoxes || []).some((box) => rectOverlap(rect, box));
    }

    function createColorResolver(routes, options = {}) {
        const categoryColors = options.categoryColors || {};
        const mode = String(options.colorMode || options.colorBy || "category").toLowerCase();
        const palette = ["#2563eb", "#0891b2", "#7c3aed", "#f97316", "#0f766e", "#dc2626", "#14b8a6", "#4f46e5", "#ea580c", "#059669"];
        const randomSeed = String(options.randomSeed || Date.now());
        const byPerson = mode === "person-random" || mode === "person-palette";
        const personColorMap = new Map();
        const categoryColorMap = new Map();

        return {
            mode: byPerson ? "person" : "category",
            colorForRoute(route, idx) {
                if (!byPerson) {
                    const cat = route.category || "未分类";
                    if (!categoryColorMap.has(cat)) {
                        categoryColorMap.set(cat, colorForCategory(cat, categoryColorMap.size, categoryColors));
                    }
                    return categoryColorMap.get(cat);
                }
                const key = personKeyForRoute(route, idx);
                if (!personColorMap.has(key)) {
                    if (mode === "person-random") {
                        const h = hashToUInt32(`${randomSeed}|${key}`) % 360;
                        const s = 64 + (hashToUInt32(`s|${key}`) % 15);
                        const l = 45 + (hashToUInt32(`l|${key}`) % 8);
                        personColorMap.set(key, hslToHex(h, s, l));
                    } else {
                        const index = hashToUInt32(key) % palette.length;
                        personColorMap.set(key, palette[index]);
                    }
                }
                return personColorMap.get(key);
            },
        };
    }

    function buildLegendEntries(routes, colorResolver, maxItems = 10) {
        if (colorResolver.mode === "person") {
            const counter = new Map();
            routes.forEach((route, idx) => {
                const key = personKeyForRoute(route, idx);
                const item = counter.get(key) || {
                    label: personNameForRoute(route, idx),
                    count: 0,
                    color: colorResolver.colorForRoute(route, idx),
                };
                item.count += 1;
                counter.set(key, item);
            });
            const items = Array.from(counter.values()).sort((a, b) => b.count - a.count).slice(0, maxItems);
            return {
                title: "人员图例",
                items,
            };
        }

        const counter = new Map();
        routes.forEach((route, idx) => {
            const key = route.category || "未分类";
            const item = counter.get(key) || {
                label: key,
                count: 0,
                color: colorResolver.colorForRoute(route, idx),
            };
            item.count += 1;
            counter.set(key, item);
        });
        const items = Array.from(counter.values()).sort((a, b) => b.count - a.count).slice(0, maxItems);
        return {
            title: "分类图例",
            items,
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
    if (!map || typeof map.latLngToContainerPoint !== "function") return null;
    const p1 = map.latLngToContainerPoint([route.origin_lat, route.origin_lon]);
    const p2 = map.latLngToContainerPoint([route.destination_lat, route.destination_lon]);
    if (!p1 || !p2) return null;
    if (![p1.x, p1.y, p2.x, p2.y].every((n) => Number.isFinite(n))) return null;
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

function drawNorthArrowCanvas(ctx, x, y, size, isDark = false) {
    const half = size / 2;
    ctx.save();
    // Circle background
    ctx.beginPath();
    ctx.arc(x, y, half + 8, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)";
    ctx.fill();
    ctx.strokeStyle = isDark ? "#475569" : "#bfdbfe";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // North half (red)
    ctx.beginPath();
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half * 0.38, y);
    ctx.lineTo(x, y - half * 0.18);
    ctx.lineTo(x - half * 0.38, y);
    ctx.closePath();
    ctx.fillStyle = "#dc2626";
    ctx.fill();

    // South half (grey)
    ctx.beginPath();
    ctx.moveTo(x, y + half);
    ctx.lineTo(x - half * 0.38, y);
    ctx.lineTo(x, y + half * 0.18);
    ctx.lineTo(x + half * 0.38, y);
    ctx.closePath();
    ctx.fillStyle = "#94a3b8";
    ctx.fill();

    // Center pivot
    ctx.beginPath();
    ctx.arc(x, y, Math.max(2, size * 0.07), 0, Math.PI * 2);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // "N" label
    ctx.fillStyle = isDark ? "#fca5a5" : "#dc2626";
    ctx.font = `900 ${Math.max(10, Math.round(size * 0.32))}px "MiSans","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("N", x, y - half - 7);
    ctx.restore();
}

function drawScaleBarCanvas(ctx, spec, x, y, isDark = false) {
    const width = spec.barPx;
    ctx.save();

    // Gradient ruler bar
    const grad = ctx.createLinearGradient(x, y, x + width, y);
    if (isDark) {
        grad.addColorStop(0, "#93c5fd");
        grad.addColorStop(1, "#60a5fa");
    } else {
        grad.addColorStop(0, "#1e3a8a");
        grad.addColorStop(1, "#3b82f6");
    }
    drawRoundedRect(ctx, x, y - 2, width, 4, 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // End notches
    const notchColor = isDark ? "#93c5fd" : "#1e3a8a";
    drawRoundedRect(ctx, x, y - 5, 2, 10, 1);
    ctx.fillStyle = notchColor;
    ctx.fill();
    drawRoundedRect(ctx, x + width - 2, y - 5, 2, 10, 1);
    ctx.fillStyle = notchColor;
    ctx.fill();

    // Labels
    const textColor = isDark ? "#bfdbfe" : "#1e3a8a";
    ctx.fillStyle = textColor;
    ctx.font = `700 ${Math.round(11 * (spec.drawScale || 1))}px "MiSans","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("0", x, y - 9);
    ctx.textAlign = "right";
    ctx.fillText(spec.label, x + width, y - 9);
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

    // Dark mode detection
    const isDark = !!(options.darkMode || (typeof document !== "undefined" && document.documentElement.classList.contains("theme-dark")));

    const mapScale = clamp(safeNumber(options.mapScale, 2.2), 1.2, 4);
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) ? window.devicePixelRatio : 1;
    const qualityScale = clamp(safeNumber(options.qualityScale, dpr), 1, 2);
    const drawScale = clamp(mapScale * qualityScale, 1.4, 5);

    const pad = 28 * drawScale;
    const headerH = 86 * drawScale;
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

    // Background gradient (theme-aware)
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    if (isDark) {
        bgGrad.addColorStop(0, "#0f172a");
        bgGrad.addColorStop(0.58, "#162033");
        bgGrad.addColorStop(1, "#1e293b");
    } else {
        bgGrad.addColorStop(0, "#f8fbff");
        bgGrad.addColorStop(0.58, "#edf4ff");
        bgGrad.addColorStop(1, "#e4eeff");
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Map card
    drawRoundedRect(ctx, mapX, mapY, mapW, mapH, cornerRadius);
    ctx.fillStyle = isDark ? "#1e293b" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = isDark ? "#334155" : "#bfdbfe";
    ctx.lineWidth = 1.2 * drawScale;
    ctx.stroke();

    await drawLeafletTiles(ctx, map, mapX, mapY, drawScale, cornerRadius);

    ctx.save();
    drawRoundedRect(ctx, mapX, mapY, mapW, mapH, cornerRadius);
    ctx.clip();
    const overlay = ctx.createLinearGradient(mapX, mapY, mapX + mapW, mapY + mapH);
    if (isDark) {
        overlay.addColorStop(0, "rgba(14,165,233,0.04)");
        overlay.addColorStop(1, "rgba(30,64,175,0.03)");
    } else {
        overlay.addColorStop(0, "rgba(30,64,175,0.06)");
        overlay.addColorStop(1, "rgba(14,165,233,0.05)");
    }
    ctx.fillStyle = overlay;
    ctx.fillRect(mapX, mapY, mapW, mapH);
    ctx.restore();

    // Density-adaptive line rendering
    const lineStyleMode = String(options.lineStyle || "flow").toLowerCase();
    const labelMode = String(options.labelMode || "none").toLowerCase();
    const labelLimit = clamp(safeNumber(options.labelLimit, 180), 0, 1200);
    const showLegend = options.showLegend !== false;
    const endpointLabelMode = String(options.endpointLabelMode || "none").toLowerCase();
    const showDistance = !!options.showDistance;
    const colorResolver = createColorResolver(routes, options);
    const routeBoxes = [];
    const lineWidth = clamp(3.1 - routes.length * 0.008, 1.4, 3.5) * drawScale;
    const lineAlpha = clamp(0.82 - routes.length * 0.002, 0.28, 0.82);
    const oRadius = clamp(3.2 - routes.length * 0.006, 1.5, 3.5) * drawScale;
    const dRadius = clamp(4.2 - routes.length * 0.008, 2, 4.5) * drawScale;
    const labelFontSize = Math.round(11 * drawScale);
    const labels = [];
    const labelBoxes = [];

    routes.forEach((route, idx) => {
        const color = colorResolver.colorForRoute(route, idx);
        const style = lineStyleSpec(lineStyleMode, idx);
        const curve = routeCurvePoints(route, map);
        if (!curve) return;
        const { p1, p2, c } = curve;
        const x1 = mapX + p1.x * drawScale;
        const y1 = mapY + p1.y * drawScale;
        const x2 = mapX + p2.x * drawScale;
        const y2 = mapY + p2.y * drawScale;
        const cx = mapX + c.x * drawScale;
        const cy = mapY + c.y * drawScale;

        // Arc halo
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.strokeStyle = colorWithAlpha(color, style.haloAlpha);
        ctx.lineWidth = lineWidth * 2.1;
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        ctx.stroke();

        // Arc core
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cx, cy, x2, y2);
        ctx.strokeStyle = colorWithAlpha(color, clamp(lineAlpha * style.lineAlphaBoost, 0.12, 0.92));
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.setLineDash(style.canvasDashArray.map((n) => n * drawScale));
        ctx.stroke();
        ctx.setLineDash([]);

        routeBoxes.push(curveBox(x1, y1, cx, cy, x2, y2, 8 * drawScale));

        // Arrow head near destination
        const arrowAt = quadraticPoint(x1, y1, cx, cy, x2, y2, 0.95);
        const deriv = quadraticDerivative(x1, y1, cx, cy, x2, y2, 0.95);
        const norm = Math.hypot(deriv.x, deriv.y);
        if (norm > 1e-3) {
            const ux = deriv.x / norm;
            const uy = deriv.y / norm;
            const arrowLen = clamp(lineWidth * 3.3, 5 * drawScale, 10.5 * drawScale);
            const wing = arrowLen * 0.48;
            const tipX = arrowAt.x + ux * (2.3 * drawScale);
            const tipY = arrowAt.y + uy * (2.3 * drawScale);
            const baseX = tipX - ux * arrowLen;
            const baseY = tipY - uy * arrowLen;
            const leftX = baseX + (-uy) * wing;
            const leftY = baseY + ux * wing;
            const rightX = baseX - (-uy) * wing;
            const rightY = baseY - ux * wing;
            ctx.beginPath();
            ctx.moveTo(tipX, tipY);
            ctx.lineTo(leftX, leftY);
            ctx.lineTo(rightX, rightY);
            ctx.closePath();
            ctx.fillStyle = colorWithAlpha(color, clamp(lineAlpha + 0.12, 0.25, 1));
            ctx.fill();
        }

        // O point (origin) — small filled circle
        ctx.beginPath();
        ctx.arc(x1, y1, oRadius, 0, Math.PI * 2);
        ctx.fillStyle = colorWithAlpha(color, 0.65);
        ctx.fill();

        // D point (destination) — larger circle with white border
        ctx.beginPath();
        ctx.arc(x2, y2, dRadius, 0, Math.PI * 2);
        ctx.fillStyle = colorWithAlpha(color, 0.95);
        ctx.fill();
        ctx.strokeStyle = isDark ? "rgba(15,23,42,0.7)" : "rgba(255,255,255,0.85)";
        ctx.lineWidth = 1.2 * drawScale;
        ctx.stroke();

        if (labelMode !== "none" && labels.length < labelLimit) {
            const text = routeLabelText(route, labelMode, idx);
            if (text) {
                const center = quadraticPoint(x1, y1, cx, cy, x2, y2, 0.56);
                const tangent = quadraticDerivative(x1, y1, cx, cy, x2, y2, 0.56);
                const tangentLen = Math.hypot(tangent.x, tangent.y) || 1;
                const nx = -tangent.y / tangentLen;
                const ny = tangent.x / tangentLen;
                const sign = idx % 2 === 0 ? 1 : -1;
                const offset = (13 + (idx % 3) * 2.2) * drawScale;
                const lx = center.x + nx * offset * sign;
                const ly = center.y + ny * offset * sign;
                ctx.save();
                ctx.font = `700 ${labelFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
                const textWidth = ctx.measureText(text).width;
                ctx.restore();
                const w = Math.max(58 * drawScale, textWidth + 16 * drawScale);
                const h = Math.max(24 * drawScale, labelFontSize + 10 * drawScale);
                const candidate = {
                    x: lx,
                    y: ly,
                    w,
                    h,
                    text,
                    color,
                    box: {
                        x: lx - w / 2,
                        y: ly - h / 2,
                        w,
                        h,
                    },
                };
                const inMap = candidate.box.x >= (mapX + 10 * drawScale)
                    && candidate.box.y >= (mapY + 10 * drawScale)
                    && (candidate.box.x + candidate.box.w) <= (mapX + mapW - 10 * drawScale)
                    && (candidate.box.y + candidate.box.h) <= (mapY + mapH - 10 * drawScale);
                if (inMap && canPlaceLabel(candidate, labelBoxes)) {
                    labelBoxes.push(candidate.box);
                    labels.push(candidate);
                }
            }
        }
    });

    labels.forEach((label) => {
        drawRoundedRect(ctx, label.box.x, label.box.y, label.box.w, label.box.h, label.h * 0.42);
        ctx.fillStyle = isDark ? "rgba(15,23,42,0.88)" : "rgba(255,255,255,0.92)";
        ctx.fill();
        ctx.strokeStyle = colorWithAlpha(label.color, 0.4);
        ctx.lineWidth = 1.1 * drawScale;
        ctx.stroke();

        ctx.fillStyle = isDark ? "#e2e8f0" : "#0f172a";
        ctx.font = `700 ${labelFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label.text, label.x, label.y + 0.5 * drawScale);
    });

    // — Endpoint place-name labels (de-duplicated) —
    if (endpointLabelMode !== "none") {
        const seen = new Set();
        const epFontSize = Math.round(10 * drawScale);
        routes.forEach((route) => {
            const pairs = [];
            if (endpointLabelMode === "origin" || endpointLabelMode === "both") {
                pairs.push({ name: route.origin_name, lat: route.origin_lat, lon: route.origin_lon });
            }
            if (endpointLabelMode === "destination" || endpointLabelMode === "both") {
                pairs.push({ name: route.destination_name, lat: route.destination_lat, lon: route.destination_lon });
            }
            pairs.forEach((p) => {
                if (!p.name) return;
                const key = `${p.name}|${Math.round(p.lat * 100)}|${Math.round(p.lon * 100)}`;
                if (seen.has(key)) return;
                seen.add(key);
                const pointCurve = routeCurvePoints({ origin_lat: p.lat, origin_lon: p.lon, destination_lat: p.lat, destination_lon: p.lon }, map);
                if (!pointCurve) return;
                const { p1 } = pointCurve;
                const px = mapX + p1.x * drawScale;
                const py = mapY + p1.y * drawScale;
                ctx.save();
                ctx.font = `600 ${epFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
                const tw = ctx.measureText(p.name).width;
                ctx.restore();
                const w = Math.max(40 * drawScale, tw + 12 * drawScale);
                const h = epFontSize + 6 * drawScale;
                const bx = px - w / 2;
                const by = py - (dRadius + 8 * drawScale) - h;
                const cand = { x: bx, y: by, w, h };
                if (canPlaceLabel(cand, labelBoxes)) {
                    labelBoxes.push(cand);
                    drawRoundedRect(ctx, bx, by, w, h, 4 * drawScale);
                    ctx.fillStyle = isDark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.86)";
                    ctx.fill();
                    ctx.strokeStyle = isDark ? "#334155" : "#dbeafe";
                    ctx.lineWidth = 0.8 * drawScale;
                    ctx.stroke();
                    ctx.fillStyle = isDark ? "#cbd5e1" : "#334155";
                    ctx.font = `600 ${epFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(p.name, px, by + h / 2);
                }
            });
        });
    }

    // — Distance labels on arcs —
    if (showDistance) {
        const dFontSize = Math.round(9 * drawScale);
        routes.forEach((route) => {
            const km = haversineKm(route.origin_lat, route.origin_lon, route.destination_lat, route.destination_lon);
            const text = fmtKm(km);
            if (!text) return;
            const curve = routeCurvePoints(route, map);
            if (!curve) return;
            const { p1, p2, c } = curve;
            const x1 = mapX + p1.x * drawScale;
            const y1 = mapY + p1.y * drawScale;
            const x2 = mapX + p2.x * drawScale;
            const y2 = mapY + p2.y * drawScale;
            const cx = mapX + c.x * drawScale;
            const cy = mapY + c.y * drawScale;
            const pt = quadraticPoint(x1, y1, cx, cy, x2, y2, 0.45);
            ctx.save();
            ctx.font = `800 ${dFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
            const tw = ctx.measureText(text).width;
            ctx.restore();
            const w = Math.max(36 * drawScale, tw + 12 * drawScale);
            const h = dFontSize + 6 * drawScale;
            const cand = { x: pt.x - w / 2, y: pt.y - h / 2, w, h };
            if (canPlaceLabel(cand, labelBoxes)) {
                labelBoxes.push(cand);
                drawRoundedRect(ctx, cand.x, cand.y, w, h, 8 * drawScale);
                ctx.fillStyle = isDark ? "rgba(30,27,75,0.9)" : "rgba(238,242,255,0.94)";
                ctx.fill();
                ctx.strokeStyle = isDark ? "#4338ca" : "#e0e7ff";
                ctx.lineWidth = 0.8 * drawScale;
                ctx.stroke();
                ctx.fillStyle = isDark ? "#a5b4fc" : "#3730a3";
                ctx.font = `800 ${dFontSize}px "MiSans","Microsoft YaHei",sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(text, pt.x, pt.y);
            }
        });
    }

    // ── Enhanced header: title + subtitle + stats + timestamp ──
    const title = options.title || "OD 流向图";
    const subtitle = options.subtitle || "";
    const owner = options.owner || "";
    const allLegendUniqueCount = colorResolver.mode === "person"
        ? new Set(routes.map((route, idx) => personKeyForRoute(route, idx))).size
        : new Set(routes.map((route) => route.category || "未分类")).size;
    const stamp = nowStamp().replace("_", " ");
    const dateStr = stamp.slice(0, 4) + "-" + stamp.slice(4, 6) + "-" + stamp.slice(6, 8) + " " + stamp.slice(9, 11) + ":" + stamp.slice(11, 13);

    ctx.fillStyle = isDark ? "#e2e8f0" : "#1e3a8a";
    ctx.font = `900 ${Math.round(32 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(title, pad, 38 * drawScale);

    // Subtitle line: stats + owner + date
    const statsLine = [
        `共 ${routes.length} 条线路`,
        `${allLegendUniqueCount} ${colorResolver.mode === "person" ? "位人员" : "种分类"}`,
        labelMode === "none" ? null : `标签 ${labels.length}`,
        owner ? owner : null,
        dateStr,
    ].filter(Boolean).join(" · ");
    ctx.fillStyle = isDark ? "#94a3b8" : "#64748b";
    ctx.font = `600 ${Math.round(13 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
    ctx.fillText(subtitle || statsLine, pad, 58 * drawScale);
    if (subtitle) {
        ctx.fillText(statsLine, pad, 74 * drawScale);
    }

    // Date on right side
    ctx.fillStyle = isDark ? "#64748b" : "#94a3b8";
    ctx.font = `600 ${Math.round(12 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(dateStr, width - pad, 38 * drawScale);

    // ── Legend panel ──
    const maxLegendItems = Math.max(3, Math.min(10, Math.floor((mapH - 120 * drawScale) / (22 * drawScale))));
    const legendData = buildLegendEntries(routes, colorResolver, maxLegendItems);
    const shownLegendItems = legendData.items || [];
    const legendPadX = 14 * drawScale;
    const legendPadY = 10 * drawScale;
    const legendRowH = 20 * drawScale;

    if (showLegend && shownLegendItems.length > 0) {
        ctx.save();
        ctx.font = `${Math.round(12 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        const maxTextWidth = shownLegendItems.reduce((maxW, item) => {
            const label = `${item.label}  ${item.count} 条`;
            return Math.max(maxW, ctx.measureText(label).width);
        }, 90 * drawScale);
        ctx.restore();

        const legendPanelW = clamp(legendPadX * 2 + 30 * drawScale + maxTextWidth, 160 * drawScale, mapW * 0.45);
        const legendFooterH = 18 * drawScale;
        const legendPanelH = clamp(legendPadY * 2 + 26 * drawScale + shownLegendItems.length * legendRowH + legendFooterH, 82 * drawScale, mapH - 30 * drawScale);
        const legendRect = pickBottomRightLegendBox(mapX, mapY, mapW, mapH, legendPanelW, legendPanelH, routeBoxes, 16 * drawScale);

        drawRoundedRect(ctx, legendRect.x, legendRect.y, legendRect.w, legendRect.h, 12 * drawScale);
        ctx.fillStyle = isDark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.93)";
        ctx.fill();
        ctx.strokeStyle = isDark ? "#334155" : "#bfdbfe";
        ctx.lineWidth = 1.1 * drawScale;
        ctx.stroke();

        ctx.fillStyle = isDark ? "#e2e8f0" : "#1e3a8a";
        ctx.font = `900 ${Math.round(14 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(legendData.title, legendRect.x + legendPadX, legendRect.y + legendPadY + 12 * drawScale);

        shownLegendItems.forEach((item, idx) => {
            const y = legendRect.y + legendPadY + 28 * drawScale + idx * legendRowH;
            const lineX = legendRect.x + legendPadX;

            // Line segment icon instead of dot
            ctx.beginPath();
            ctx.moveTo(lineX, y - 3 * drawScale);
            ctx.lineTo(lineX + 16 * drawScale, y - 3 * drawScale);
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 2.5 * drawScale;
            ctx.lineCap = "round";
            ctx.stroke();

            ctx.fillStyle = isDark ? "#e2e8f0" : "#1f2937";
            ctx.font = `${Math.round(12 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
            ctx.textAlign = "left";
            ctx.fillText(item.label, lineX + 20 * drawScale, y);

            ctx.fillStyle = isDark ? "#94a3b8" : "#475569";
            ctx.textAlign = "right";
            ctx.fillText(`${item.count} 条`, legendRect.x + legendRect.w - legendPadX, y);
        });

        // Legend footer: timestamp
        ctx.fillStyle = isDark ? "#475569" : "#94a3b8";
        ctx.font = `500 ${Math.round(9 * drawScale)}px "MiSans","Microsoft YaHei",sans-serif`;
        ctx.textAlign = "left";
        ctx.fillText(`generated ${dateStr}`, legendRect.x + legendPadX, legendRect.y + legendRect.h - 6 * drawScale);
    }

    // ── Scale bar & North arrow ──
    const kmPerPixel = estimateKmPerPixelFromMap(map, mapSize) || estimateKmPerPixelFromBounds(computeBounds(routes), mapSize.x);
    const scaleSpec = createScaleSpec(kmPerPixel, mapSize.x * 0.22, 70, 220);
    drawScaleBarCanvas(
        ctx,
        { barPx: scaleSpec.barPx * drawScale, label: scaleSpec.label, drawScale },
        mapX + 28 * drawScale,
        mapY + mapH - 18 * drawScale,
        isDark
    );
    drawNorthArrowCanvas(ctx, mapX + mapW - 40 * drawScale, mapY + 40 * drawScale, 28 * drawScale, isDark);

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
    if (!options.map) {
        throw new Error("导出需要地图实例，请确保 map 参数已传入");
    }
    const canvas = await renderMapPosterCanvas(options.map, routes, options);
    const blob = await canvasToBlob(canvas, "image/png", 1);
    downloadBlob(blob, `${filename}.png`);
}

window.odExport = {
    downloadPoster,
    renderMapPosterCanvas,
};
}) ();
