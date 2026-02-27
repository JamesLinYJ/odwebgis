
const { useEffect, useMemo, useRef, useState } = React;

function buildCurve(start, end, segments = 40) {
  const [lat1, lon1] = start;
  const [lat2, lon2] = end;
  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const dx = lon2 - lon1;
  const dy = lat2 - lat1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const offset = Math.max(0.9, dist * 0.2);
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

function normalizeCoordText(raw) {
  return String(raw || "")
    .trim()
    .replace(/，/g, ",")
    .replace(/[﹣－—–]/g, "-")
    .replace(/[º˚]/g, "°")
    .replace(/[′’]/g, "'")
    .replace(/[″”]/g, '"')
    .replace(/度/g, "°")
    .replace(/分/g, "'")
    .replace(/秒/g, '"')
    .replace(/\s+/g, " ");
}

function parseFlexibleCoordinate(raw, axis) {
  const label = axis === "lat" ? "纬度" : "经度";
  let text = normalizeCoordText(raw).toUpperCase();
  if (!text) throw new Error(`${label}不能为空`);

  let hemisphere = "";
  const hemiList = text.match(/[NSEW]/g);
  if (hemiList && hemiList.length > 0) {
    hemisphere = hemiList[hemiList.length - 1];
    text = text.replace(/[NSEW]/g, " ").trim();
  }

  const parts = text.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!parts || parts.length === 0) throw new Error(`${label}格式不正确`);

  const hasDmsMark = /[°'"]/.test(text);
  let value = 0;

  if (hasDmsMark || parts.length > 1) {
    const degRaw = Number(parts[0]);
    const min = parts[1] ? Number(parts[1]) : 0;
    const sec = parts[2] ? Number(parts[2]) : 0;
    if (![degRaw, min, sec].every(Number.isFinite)) throw new Error(`${label}格式不正确`);
    if (min < 0 || min >= 60 || sec < 0 || sec >= 60) throw new Error(`${label}度分秒格式不正确`);
    const sign = degRaw < 0 ? -1 : 1;
    value = (Math.abs(degRaw) + min / 60 + sec / 3600) * sign;
  } else {
    value = Number(parts[0]);
    if (!Number.isFinite(value)) throw new Error(`${label}格式不正确`);
  }

  if (hemisphere === "S" || hemisphere === "W") value = -Math.abs(value);
  if (hemisphere === "N" || hemisphere === "E") value = Math.abs(value);

  const maxAbs = axis === "lat" ? 90 : 180;
  if (value < -maxAbs || value > maxAbs) throw new Error(`${label}超出范围`);
  return Number(value.toFixed(8));
}

function toDmsParts(value, axis) {
  const abs = Math.abs(Number(value) || 0);
  let deg = Math.floor(abs);
  let minFloat = (abs - deg) * 60;
  let min = Math.floor(minFloat);
  let sec = Number(((minFloat - min) * 60).toFixed(2));
  if (sec >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  const dir = axis === "lat" ? (Number(value) >= 0 ? "N" : "S") : (Number(value) >= 0 ? "E" : "W");
  return { deg: String(deg), min: String(min), sec: String(sec), dir };
}

function parseDmsParts(parts, axis, prefix = "") {
  const label = `${prefix}${axis === "lat" ? "纬度" : "经度"}`;
  const degText = String(parts.deg || "").trim();
  const minText = String(parts.min || "").trim();
  const secText = String(parts.sec || "").trim();
  if (!degText) throw new Error(`${label}度不能为空`);

  const deg = Number(degText);
  const min = minText ? Number(minText) : 0;
  const sec = secText ? Number(secText) : 0;
  if (![deg, min, sec].every(Number.isFinite)) throw new Error(`${label}格式不正确`);
  if (min < 0 || min >= 60 || sec < 0 || sec >= 60) throw new Error(`${label}分秒范围不正确`);

  let value = Math.abs(deg) + min / 60 + sec / 3600;
  const dir = String(parts.dir || "").toUpperCase();
  if (axis === "lat") {
    if (dir !== "N" && dir !== "S") throw new Error(`${label}方向必须为 N/S`);
    if (dir === "S") value = -value;
  } else {
    if (dir !== "E" && dir !== "W") throw new Error(`${label}方向必须为 E/W`);
    if (dir === "W") value = -value;
  }

  const maxAbs = axis === "lat" ? 90 : 180;
  if (value < -maxAbs || value > maxAbs) throw new Error(`${label}超出范围`);
  return Number(value.toFixed(8));
}

function createEndpointState() {
  return {
    name: "",
    decimal: { lat: "", lon: "" },
    dms: {
      lat: { deg: "", min: "", sec: "", dir: "N" },
      lon: { deg: "", min: "", sec: "", dir: "E" },
    },
  };
}

function formatCoord(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}
function StatCard({ title, value, hint }) {
  return (
    <div className="ios-card rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-soft">
      <div className="text-xs font-bold tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-black text-slate-800">{value}</div>
      {hint && <div className="mt-0.5 text-xs font-semibold text-slate-500">{hint}</div>}
    </div>
  );
}

function SectionCard({ title, open, onToggle, children, rightNode }) {
  return (
    <div className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-3 shadow-soft">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="text-sm font-black text-brand-700">{title}</div>
        <div className="flex items-center gap-2">
          {rightNode}
          <span className="text-xs font-bold text-slate-500">{open ? "收起" : "展开"}</span>
        </div>
      </button>
      <div className={`ios-collapse ${open ? "mt-3 max-h-[1800px] opacity-100" : "max-h-0 opacity-0"}`}>
        {children}
      </div>
    </div>
  );
}

function DmsAxisInput({ axis, value, onChange }) {
  const dirs = axis === "lat" ? ["N", "S"] : ["E", "W"];
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5">
      <input value={value.deg} onChange={(e) => onChange({ ...value, deg: e.target.value })} className="rounded-lg border border-blue-200 px-2 py-1.5 text-xs" placeholder="度" />
      <input value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} className="rounded-lg border border-blue-200 px-2 py-1.5 text-xs" placeholder="分" />
      <input value={value.sec} onChange={(e) => onChange({ ...value, sec: e.target.value })} className="rounded-lg border border-blue-200 px-2 py-1.5 text-xs" placeholder="秒" />
      <select value={value.dir} onChange={(e) => onChange({ ...value, dir: e.target.value })} className="rounded-lg border border-blue-200 px-2 py-1.5 text-xs">
        {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

function EndpointEditor({ title, endpoint, setEndpoint, coordMode }) {
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-2">
      <div className="mb-2 text-xs font-bold text-slate-600">{title}</div>
      <input value={endpoint.name} onChange={(e) => setEndpoint((p) => ({ ...p, name: e.target.value }))} className="mb-2 w-full rounded-lg border border-blue-200 px-2 py-1.5 text-sm" placeholder={`${title}名称（可选）`} />

      <div className={`ios-collapse ${coordMode === "decimal" ? "max-h-[84px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className={`grid grid-cols-2 gap-2 ios-mode-panel ${coordMode === "decimal" ? "ios-mode-panel-show" : "ios-mode-panel-hide"}`}>
          <input value={endpoint.decimal.lat} onChange={(e) => setEndpoint((p) => ({ ...p, decimal: { ...p.decimal, lat: e.target.value } }))} className="rounded-lg border border-blue-200 px-2 py-1.5 text-sm" placeholder="纬度" />
          <input value={endpoint.decimal.lon} onChange={(e) => setEndpoint((p) => ({ ...p, decimal: { ...p.decimal, lon: e.target.value } }))} className="rounded-lg border border-blue-200 px-2 py-1.5 text-sm" placeholder="经度" />
        </div>
      </div>

      <div className={`ios-collapse ${coordMode === "dms" ? "mt-2 max-h-[180px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className={`space-y-2 ios-mode-panel ${coordMode === "dms" ? "ios-mode-panel-show" : "ios-mode-panel-hide"}`}>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-500">纬度（度/分/秒）</div>
            <DmsAxisInput axis="lat" value={endpoint.dms.lat} onChange={(next) => setEndpoint((p) => ({ ...p, dms: { ...p.dms, lat: next } }))} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold text-slate-500">经度（度/分/秒）</div>
            <DmsAxisInput axis="lon" value={endpoint.dms.lon} onChange={(next) => setEndpoint((p) => ({ ...p, dms: { ...p.dms, lon: next } }))} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ExplorerApp() {
  const mapHostRef = useRef(null);
  const mapSectionRef = useRef(null);
  const mapRef = useRef(null);
  const baseTileLayersRef = useRef(null);
  const routeLayerRef = useRef(null);
  const draftLayerRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [me, setMe] = useState(null);
  const [allRoutes, setAllRoutes] = useState([]);

  const [searchKeyword, setSearchKeyword] = useState("");
  const [routeCategoryFilter, setRouteCategoryFilter] = useState("all");
  const [showOnlyMine, setShowOnlyMine] = useState(true);

  const [coordMode, setCoordMode] = useState("decimal");
  const [originInput, setOriginInput] = useState(createEndpointState());
  const [destinationInput, setDestinationInput] = useState(createEndpointState());
  const [routeCategory, setRouteCategory] = useState("课堂");

  const [pickTarget, setPickTarget] = useState(null);
  const [originPoint, setOriginPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);

  const [filterOpen, setFilterOpen] = useState(true);
  const [entryOpen, setEntryOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [exportingPoster, setExportingPoster] = useState(false);
  const [baseMapMode, setBaseMapMode] = useState("vector");

  const categoryColors = useMemo(() => ({ 课堂: "#2563eb", 通勤: "#0891b2", 调研: "#7c3aed", 实习: "#f97316", 其他: "#4b5563" }), []);

  const allCategories = useMemo(() => {
    const dynamic = Array.from(new Set(allRoutes.map((r) => r.category).filter(Boolean)));
    return Array.from(new Set(["课堂", "通勤", "调研", "实习", "其他", ...dynamic]));
  }, [allRoutes]);

  const visibleRoutes = useMemo(() => {
    let rows = allRoutes;
    if (showOnlyMine && me?.id) rows = rows.filter((r) => Number(r.user_id) === Number(me.id));
    if (routeCategoryFilter !== "all") rows = rows.filter((r) => r.category === routeCategoryFilter);
    const keyword = searchKeyword.trim().toLowerCase();
    if (keyword) {
      rows = rows.filter((r) => {
        const text = [r.origin_name, r.destination_name, r.category, r.user_name, r.origin_code, r.destination_code].filter(Boolean).join(" ").toLowerCase();
        return text.includes(keyword);
      });
    }
    return rows;
  }, [allRoutes, showOnlyMine, me, routeCategoryFilter, searchKeyword]);

  const mySummary = useMemo(() => {
    if (!me?.id) return { count: 0 };
    const mine = allRoutes.filter((r) => Number(r.user_id) === Number(me.id));
    return { count: mine.length };
  }, [allRoutes, me]);
  function syncEndpointFromDecimal(kind, lat, lon, fallbackName) {
    const lat6 = Number(lat.toFixed(6));
    const lon6 = Number(lon.toFixed(6));
    const updater = (prev) => ({
      ...prev,
      name: prev.name || fallbackName,
      decimal: { lat: String(lat6), lon: String(lon6) },
      dms: { lat: toDmsParts(lat6, "lat"), lon: toDmsParts(lon6, "lon") },
    });
    if (kind === "origin") {
      setOriginInput(updater);
      setOriginPoint([lat6, lon6]);
    } else {
      setDestinationInput(updater);
      setDestinationPoint([lat6, lon6]);
    }
  }

  function endpointHasAnyInput(endpoint) {
    if (coordMode === "decimal") {
      return String(endpoint.decimal.lat || "").trim() || String(endpoint.decimal.lon || "").trim();
    }
    return String(endpoint.dms.lat.deg || "").trim() || String(endpoint.dms.lon.deg || "").trim();
  }

  function parseEndpoint(endpoint, prefix) {
    const lat = coordMode === "decimal"
      ? parseFlexibleCoordinate(endpoint.decimal.lat, "lat")
      : parseDmsParts(endpoint.dms.lat, "lat", prefix);
    const lon = coordMode === "decimal"
      ? parseFlexibleCoordinate(endpoint.decimal.lon, "lon")
      : parseDmsParts(endpoint.dms.lon, "lon", prefix);
    return { name: endpoint.name.trim() || `${prefix}点`, lat, lon };
  }

  function parseEndpointIfFilled(endpoint, prefix) {
    if (!endpointHasAnyInput(endpoint)) return null;
    return parseEndpoint(endpoint, prefix);
  }

  function syncModeValues(targetMode) {
    if (targetMode === "dms") {
      setOriginInput((prev) => {
        try {
          const lat = parseFlexibleCoordinate(prev.decimal.lat, "lat");
          const lon = parseFlexibleCoordinate(prev.decimal.lon, "lon");
          return { ...prev, dms: { lat: toDmsParts(lat, "lat"), lon: toDmsParts(lon, "lon") } };
        } catch { return prev; }
      });
      setDestinationInput((prev) => {
        try {
          const lat = parseFlexibleCoordinate(prev.decimal.lat, "lat");
          const lon = parseFlexibleCoordinate(prev.decimal.lon, "lon");
          return { ...prev, dms: { lat: toDmsParts(lat, "lat"), lon: toDmsParts(lon, "lon") } };
        } catch { return prev; }
      });
    } else {
      setOriginInput((prev) => {
        try {
          const lat = parseDmsParts(prev.dms.lat, "lat");
          const lon = parseDmsParts(prev.dms.lon, "lon");
          return { ...prev, decimal: { lat: String(Number(lat.toFixed(6))), lon: String(Number(lon.toFixed(6))) } };
        } catch { return prev; }
      });
      setDestinationInput((prev) => {
        try {
          const lat = parseDmsParts(prev.dms.lat, "lat");
          const lon = parseDmsParts(prev.dms.lon, "lon");
          return { ...prev, decimal: { lat: String(Number(lat.toFixed(6))), lon: String(Number(lon.toFixed(6))) } };
        } catch { return prev; }
      });
    }
  }

  async function loadMe() {
    const res = await api.get("/api/auth/me");
    const user = res.user || null;
    setMe(user);
    if (user?.must_change_password) {
      api.notify("请先在账户中心修改密码");
      window.location.href = "/account";
    }
  }

  async function loadRoutes() {
    const res = await api.get("/api/routes?limit=1500");
    setAllRoutes(res.routes || []);
  }

  async function bootstrap() {
    setLoading(true);
    try {
      await Promise.all([loadMe(), loadRoutes()]);
    } catch {
      window.location.href = "/auth";
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { bootstrap(); }, []);

  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) return;
    const map = L.map(mapHostRef.current, { zoomControl: false, minZoom: 4, attributionControl: false }).setView([35.2, 104.2], 5);
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
    draftLayerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = baseTileLayersRef.current;
    if (!map || !layers) return;
    [layers.vec, layers.cva, layers.img, layers.cia].forEach((layer) => {
      if (layer && map.hasLayer(layer)) map.removeLayer(layer);
    });
    if (baseMapMode === "satellite") {
      layers.img.addTo(map);
      layers.cia.addTo(map);
    } else {
      layers.vec.addTo(map);
      layers.cva.addTo(map);
    }
  }, [baseMapMode]);

  useEffect(() => {
    if (!mapRef.current) return;
    const timer = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 320);
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
    if (!mapRef.current) return;
    const onMapClick = (e) => {
      if (!pickTarget) return;
      const { lat, lng } = e.latlng;
      if (pickTarget === "origin") {
        syncEndpointFromDecimal("origin", lat, lng, "地图起点");
        setPickTarget("destination");
        api.notify("已设置起点 O，请点击终点 D");
      } else {
        syncEndpointFromDecimal("destination", lat, lng, "地图终点");
        setPickTarget(null);
        api.notify("已设置终点 D，可以提交线路");
      }
    };
    mapRef.current.on("click", onMapClick);
    return () => mapRef.current && mapRef.current.off("click", onMapClick);
  }, [pickTarget]);
  useEffect(() => {
    if (!draftLayerRef.current) return;
    draftLayerRef.current.clearLayers();

    if (originPoint) {
      const marker = L.marker(originPoint, { draggable: true }).addTo(draftLayerRef.current);
      marker.bindTooltip("起点 O", { permanent: true, direction: "top", offset: [0, -8] });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        syncEndpointFromDecimal("origin", p.lat, p.lng, "地图起点");
      });
    }
    if (destinationPoint) {
      const marker = L.marker(destinationPoint, { draggable: true }).addTo(draftLayerRef.current);
      marker.bindTooltip("终点 D", { permanent: true, direction: "top", offset: [0, -8] });
      marker.on("dragend", () => {
        const p = marker.getLatLng();
        syncEndpointFromDecimal("destination", p.lat, p.lng, "地图终点");
      });
    }
    if (originPoint && destinationPoint) {
      L.polyline(buildCurve(originPoint, destinationPoint), { color: "#0ea5e9", weight: 3, opacity: 0.92, dashArray: "8 6" }).addTo(draftLayerRef.current);
    }
  }, [originPoint, destinationPoint]);

  useEffect(() => {
    if (!routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();

    visibleRoutes.forEach((route) => {
      const from = [route.origin_lat, route.origin_lon];
      const to = [route.destination_lat, route.destination_lon];
      const isMine = me && Number(route.user_id) === Number(me.id);
      const lineColor = isMine ? (categoryColors[route.category] || "#2563eb") : "#93c5fd";
      const line = L.polyline(buildCurve(from, to), {
        color: lineColor,
        weight: isMine ? 3.2 : 2.1,
        opacity: isMine ? 0.88 : 0.46,
        dashArray: isMine ? "10 7" : "8 9",
      }).addTo(routeLayerRef.current);

      line.bindPopup(
        `<div style="min-width:190px">` +
          `<strong>${route.origin_name} -> ${route.destination_name}</strong><br/>` +
          `分类：${route.category}<br/>` +
          `录入学生：${route.user_name || "-"}<br/>` +
          `时间：${api.fmtTime(route.created_at)}` +
        `</div>`
      );

      L.circleMarker(to, { radius: isMine ? 4.2 : 3.2, color: lineColor, fillColor: lineColor, fillOpacity: isMine ? 1 : 0.75, weight: 0 }).addTo(routeLayerRef.current);
    });
  }, [visibleRoutes, me, categoryColors]);

  function fitCurrentRoutes() {
    if (!mapRef.current) return;
    const points = [];
    visibleRoutes.forEach((r) => {
      points.push([r.origin_lat, r.origin_lon]);
      points.push([r.destination_lat, r.destination_lon]);
    });
    if (originPoint) points.push(originPoint);
    if (destinationPoint) points.push(destinationPoint);
    if (points.length >= 2) mapRef.current.fitBounds(points, { padding: [45, 45] });
  }

  function generateOdMap() {
    try {
      const origin = parseEndpointIfFilled(originInput, "起点");
      const destination = parseEndpointIfFilled(destinationInput, "终点");

      if (origin && destination) {
        syncEndpointFromDecimal("origin", origin.lat, origin.lon, origin.name);
        syncEndpointFromDecimal("destination", destination.lat, destination.lon, destination.name);
        if (mapRef.current) {
          mapRef.current.fitBounds([[origin.lat, origin.lon], [destination.lat, destination.lon]], { padding: [45, 45] });
        }
        api.notify("已生成当前录入的 OD 图");
        return;
      }

      if (visibleRoutes.length > 0) {
        fitCurrentRoutes();
        api.notify("已根据当前筛选生成 OD 图");
        return;
      }

      api.notify("请先录入线路或输入起终点坐标", true);
    } catch (err) {
      api.notify(err.message || "生成 OD 图失败", true);
    }
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
    // Fallback: 浏览器不支持 Fullscreen API 时仍保留页面内全屏体验
    setMapFullscreen((v) => !v);
  }

  function collectExportRoutes() {
    if (visibleRoutes.length > 0) {
      return visibleRoutes;
    }

    if (originPoint && destinationPoint) {
      return [
        {
          id: "draft-route",
          origin_name: originInput.name || "起点 O",
          origin_lat: originPoint[0],
          origin_lon: originPoint[1],
          destination_name: destinationInput.name || "终点 D",
          destination_lat: destinationPoint[0],
          destination_lon: destinationPoint[1],
          category: routeCategory || "课堂",
          user_name: me?.name || me?.username || "",
          created_at: new Date().toISOString(),
        },
      ];
    }
    return [];
  }

  async function exportOdPoster(format = "png") {
    if (!window.odExport || typeof window.odExport.downloadPoster !== "function") {
      api.notify("导出模块未加载", true);
      return;
    }
    const routes = collectExportRoutes();
    if (routes.length === 0) {
      api.notify("暂无可导出的线路，请先生成或筛选线路", true);
      return;
    }
    setExportingPoster(true);
    try {
      const who = me?.name || me?.username || me?.student_no || "";
      await window.odExport.downloadPoster(routes, {
        format,
        title: "OD 流向图导出",
        subtitle: showOnlyMine ? "当前筛选：仅我的线路" : "当前筛选：全部可见线路",
        owner: who,
        filename: `od_student_${new Date().toISOString().slice(0, 10)}`,
        categoryColors,
        width: 1920,
        height: 1080,
        scale: 2,
        map: format === "png" ? mapRef.current : null,
        baseMapMode,
        mapScale: 2.2,
        qualityScale: 1.8,
        labelLimit: 120,
      });
      api.notify(format === "svg" ? "OD 图 SVG 已导出" : "OD 图 PNG 已导出");
    } catch (err) {
      api.notify(err.message || "导出失败", true);
    } finally {
      setExportingPoster(false);
    }
  }

  function syncInputPointsToMap() {
    try {
      const origin = parseEndpointIfFilled(originInput, "起点");
      const destination = parseEndpointIfFilled(destinationInput, "终点");
      if (!origin && !destination) {
        api.notify("请先输入坐标", true);
        return;
      }
      if (origin) syncEndpointFromDecimal("origin", origin.lat, origin.lon, "自定义起点");
      if (destination) syncEndpointFromDecimal("destination", destination.lat, destination.lon, "自定义终点");

      const points = [];
      if (origin) points.push([origin.lat, origin.lon]);
      if (destination) points.push([destination.lat, destination.lon]);
      if (mapRef.current) {
        if (points.length >= 2) mapRef.current.fitBounds(points, { padding: [45, 45] });
        else if (points.length === 1) mapRef.current.setView(points[0], 10);
      }
    } catch (err) {
      api.notify(err.message || "坐标解析失败", true);
    }
  }

  function clearInputs() {
    setOriginInput(createEndpointState());
    setDestinationInput(createEndpointState());
    setOriginPoint(null);
    setDestinationPoint(null);
    setPickTarget(null);
  }

  function swapEndpoints() {
    setOriginInput(destinationInput);
    setDestinationInput(originInput);
    setOriginPoint(destinationPoint);
    setDestinationPoint(originPoint);
  }

  async function submitRoute(e) {
    e.preventDefault();
    if (!me?.id) {
      api.notify("请先登录", true);
      window.location.href = "/auth";
      return;
    }

    setSubmitting(true);
    try {
      const origin = parseEndpoint(originInput, "起点");
      const destination = parseEndpoint(destinationInput, "终点");

      await api.postJson("/api/routes", {
        user_id: me.id,
        origin_name: origin.name,
        origin_lat: origin.lat,
        origin_lon: origin.lon,
        destination_name: destination.name,
        destination_lat: destination.lat,
        destination_lon: destination.lon,
        category: routeCategory,
      });

      syncEndpointFromDecimal("origin", origin.lat, origin.lon, origin.name);
      syncEndpointFromDecimal("destination", destination.lat, destination.lon, destination.name);
      api.notify("线路已保存");
      await Promise.all([loadMe(), loadRoutes()]);
      setTimeout(() => fitCurrentRoutes(), 80);
    } catch (err) {
      api.notify(err.message || "提交失败", true);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRoute(id) {
    try {
      await api.del(`/api/routes/${id}`);
      api.notify("线路已删除");
      await Promise.all([loadMe(), loadRoutes()]);
    } catch (err) {
      api.notify(err.message || "删除失败", true);
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
    <div className="mx-auto max-w-[1880px] p-3 sm:p-4 ios-fade-up">
      <header className="ios-card mb-3 rounded-2xl border border-blue-100 bg-white/95 px-4 py-3 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-black text-brand-700 sm:text-2xl">OD 流向录入与分析</div>
            <div className="text-xs font-semibold text-slate-500 sm:text-sm">学生端 | 地图点选、十进制度与度分秒双模式录入</div>
            {me && <div className="text-xs font-semibold text-slate-500">当前用户：{me.username || me.student_no || "-"}</div>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => Promise.all([loadMe(), loadRoutes()])} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 sm:text-sm">刷新</button>
            <button onClick={generateOdMap} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 sm:text-sm">一键生成OD图</button>
            <button onClick={() => exportOdPoster("png")} disabled={exportingPoster} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 disabled:opacity-60 sm:text-sm">{exportingPoster ? "导出中..." : "导出OD图 PNG"}</button>
            <button onClick={() => window.location.href = "/account"} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 sm:text-sm">账户中心</button>
            <button onClick={logout} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 sm:text-sm">退出登录</button>
          </div>
        </div>
      </header>

      <main className={mapFullscreen ? "" : "grid grid-cols-1 gap-3 xl:grid-cols-[1fr_400px]"}>
        <section ref={mapSectionRef} className={`${mapFullscreen ? "fixed inset-0 z-[1300] rounded-none border-0" : "relative h-[58vh] min-h-[340px] overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-soft sm:h-[72vh] sm:min-h-[560px]"} ios-card`}>
          <div ref={mapHostRef} className="h-full w-full" />

          <div className="absolute left-3 top-3 z-[900] flex flex-col gap-2 sm:left-4 sm:top-4">
            <button onClick={() => mapRef.current && mapRef.current.zoomIn()} className="rounded-xl border border-blue-200 bg-white/95 px-3 py-1.5 text-xl font-black text-brand-700">+</button>
            <button onClick={() => mapRef.current && mapRef.current.zoomOut()} className="rounded-xl border border-blue-200 bg-white/95 px-3 py-1.5 text-xl font-black text-brand-700">-</button>
            <button onClick={() => setBaseMapMode((v) => (v === "vector" ? "satellite" : "vector"))} className="rounded-xl border border-blue-200 bg-white/95 px-3 py-1.5 text-xs font-black text-brand-700 sm:text-sm">{baseMapMode === "satellite" ? "切到矢量" : "切到卫星"}</button>
            <button onClick={fitCurrentRoutes} className="rounded-xl border border-blue-200 bg-white/95 px-3 py-1.5 text-xs font-black text-brand-700 sm:text-sm">适配</button>
            <button onClick={toggleMapFullscreen} className="rounded-xl border border-blue-200 bg-white/95 px-3 py-1.5 text-xs font-black text-brand-700 sm:text-sm">{mapFullscreen ? "退出全屏" : "全屏"}</button>
          </div>

          <div className="absolute right-3 top-3 z-[900] w-[min(90vw,320px)] rounded-xl border border-blue-100 bg-white/95 p-3 shadow-soft sm:right-4 sm:top-4">
            <div className="text-xs font-bold tracking-wide text-slate-500">地图交互状态</div>
            <div className="mt-1 text-sm font-bold text-slate-700">
              {pickTarget === "origin" && "点击地图设置起点 O"}
              {pickTarget === "destination" && "点击地图设置终点 D"}
              {!pickTarget && "可手动输入或点击下方按钮开始点选"}
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500">可拖拽 O/D 标记进行微调，操作更直观。</div>
            <div className="mt-2 text-xs font-semibold text-slate-500">O: {originPoint ? formatCoord(originPoint[0], originPoint[1]) : "未设置"}</div>
            <div className="text-xs font-semibold text-slate-500">D: {destinationPoint ? formatCoord(destinationPoint[0], destinationPoint[1]) : "未设置"}</div>
            <div className="text-xs font-semibold text-slate-500">底图：{baseMapMode === "satellite" ? "卫星影像" : "矢量地图"}</div>
          </div>
        </section>

        {!mapFullscreen && (
          <aside className="space-y-3">
            <SectionCard
              title="筛选与交互"
              open={filterOpen}
              onToggle={() => setFilterOpen((v) => !v)}
              rightNode={<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">{api.fmtNumber(visibleRoutes.length)} 条</span>}
            >
              <div className="space-y-2">
                <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} className="w-full rounded-lg border border-blue-200 px-3 py-2 text-sm" placeholder="搜索起点、终点或分类" />

                <div className="grid grid-cols-2 gap-2">
                  <label className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/50 px-2 py-1.5 text-xs font-semibold text-slate-700">
                    <input type="checkbox" checked={showOnlyMine} onChange={(e) => setShowOnlyMine(e.target.checked)} />仅看我的线路
                  </label>
                  <select value={routeCategoryFilter} onChange={(e) => setRouteCategoryFilter(e.target.value)} className="rounded-lg border border-blue-200 px-2 py-1.5 text-xs">
                    <option value="all">全部分类</option>
                    {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-2">
                  <div className="mb-2 text-xs font-bold text-slate-600">坐标输入模式</div>
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-blue-100/70 p-1">
                    <button type="button" onClick={() => { setCoordMode("decimal"); syncModeValues("decimal"); }} className={`rounded-md px-2 py-1.5 text-xs font-bold ${coordMode === "decimal" ? "bg-white text-brand-700" : "text-slate-500"}`}>十进制度</button>
                    <button type="button" onClick={() => { setCoordMode("dms"); syncModeValues("dms"); }} className={`rounded-md px-2 py-1.5 text-xs font-bold ${coordMode === "dms" ? "bg-white text-brand-700" : "text-slate-500"}`}>度分秒</button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPickTarget("origin")} className={`rounded-lg px-2 py-2 text-xs font-bold ${pickTarget === "origin" ? "bg-brand-600 text-white" : "border border-blue-200 bg-white text-brand-700"}`}>点选起点 O</button>
                  <button type="button" onClick={() => setPickTarget("destination")} className={`rounded-lg px-2 py-2 text-xs font-bold ${pickTarget === "destination" ? "bg-brand-600 text-white" : "border border-blue-200 bg-white text-brand-700"}`}>点选终点 D</button>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button type="button" onClick={syncInputPointsToMap} className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-bold text-brand-700">输入同步地图</button>
                  <button type="button" onClick={swapEndpoints} className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-bold text-brand-700">交换 O/D</button>
                  <button type="button" onClick={clearInputs} className="rounded-lg border border-blue-200 bg-white px-2 py-1.5 text-xs font-bold text-brand-700">清空输入</button>
                </div>
              </div>
            </SectionCard>
            <SectionCard title="录入 OD 线路" open={entryOpen} onToggle={() => setEntryOpen((v) => !v)}>
              <form onSubmit={submitRoute} className="space-y-2">
                <EndpointEditor title="起点 O" endpoint={originInput} setEndpoint={setOriginInput} coordMode={coordMode} />
                <EndpointEditor title="终点 D" endpoint={destinationInput} setEndpoint={setDestinationInput} coordMode={coordMode} />

                <div className="grid grid-cols-2 gap-2 rounded-xl border border-blue-100 bg-white p-2">
                  <select value={routeCategory} onChange={(e) => setRouteCategory(e.target.value)} className="rounded-lg border border-blue-200 px-2 py-1.5 text-sm">
                    {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <button disabled={submitting} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">{submitting ? "提交中..." : "保存线路"}</button>
                  <button type="button" onClick={generateOdMap} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-brand-700">一键生成OD图</button>
                  <button type="button" disabled={exportingPoster} onClick={() => exportOdPoster("svg")} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 disabled:opacity-60">导出 SVG</button>
                  <button type="button" disabled={exportingPoster} onClick={() => exportOdPoster("png")} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 disabled:opacity-60">{exportingPoster ? "导出中..." : "导出 PNG"}</button>
                </div>

                <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-2 py-2 text-[11px] font-semibold text-slate-600">
                  十进制度示例：34.0522 / -118.2437；度分秒模式为每个坐标 3 个输入框（度、分、秒）+ 方向。
                </div>
              </form>
            </SectionCard>

            <SectionCard title="最近线路" open={recentOpen} onToggle={() => setRecentOpen((v) => !v)}>
              <div className="max-h-[300px] space-y-2 overflow-auto pr-1">
                {visibleRoutes.slice(0, 12).map((route) => (
                  <div key={route.id} className="rounded-xl border border-blue-100 bg-blue-50/40 p-2">
                    <div className="truncate text-sm font-bold text-slate-700">{route.origin_name} -&gt; {route.destination_name}</div>
                    <div className="text-xs font-semibold text-slate-500">{route.category} | {api.fmtTime(route.created_at)}</div>
                    <div className="mt-1 flex items-center justify-end gap-2">
                      <button type="button" onClick={() => {
                        if (!mapRef.current) return;
                        mapRef.current.fitBounds([[route.origin_lat, route.origin_lon], [route.destination_lat, route.destination_lon]], { padding: [42, 42] });
                      }} className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-brand-700">定位</button>
                      {Number(route.user_id) === Number(me?.id) && (
                        <button type="button" onClick={() => deleteRoute(route.id)} className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-bold text-rose-600">删除</button>
                      )}
                    </div>
                  </div>
                ))}
                {visibleRoutes.length === 0 && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm font-semibold text-slate-500">暂无线路数据</div>}
              </div>
            </SectionCard>

          </aside>
        )}
      </main>

      {!mapFullscreen && (
        <footer className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard title="我的线路数" value={api.fmtNumber(mySummary.count)} hint="当前账号累计" />
          <StatCard title="当前显示线路" value={api.fmtNumber(visibleRoutes.length)} hint={showOnlyMine ? "仅我的数据" : "全体数据"} />
          <StatCard title="点选状态" value={pickTarget ? `等待设置${pickTarget === "origin" ? "起点" : "终点"}` : "未开启"} hint={coordMode === "dms" ? "当前为度分秒输入" : "当前为十进制度输入"} />
        </footer>
      )}

      {loading && (
        <div className="pointer-events-none fixed inset-0 z-[1400] flex items-center justify-center bg-white/40 backdrop-blur-[1px]">
          <div className="rounded-xl border border-blue-100 bg-white px-4 py-2 text-sm font-bold text-brand-700 shadow-soft">正在加载...</div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<ExplorerApp />);
