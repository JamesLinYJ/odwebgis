/* 【中文注释】
 * 文件说明：explorer-react.jsx 为前端 React 页面源码，承载主要交互逻辑。
 * 维护约定：组件状态变更需同步检查地图与表单交互。
 */


const { useEffect, useMemo, useRef, useState } = React;

function buildCurve(start, end, segments = 40) {
  const [lat1, lon1] = start;
  const [lat2Raw, lon2Raw] = end;
  const lat2 = Number(lat2Raw);
  let lon2 = Number(lon2Raw);
  if (![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))) {
    return [start, end];
  }

  // Keep arc generation stable near the 180° meridian.
  let dxLon = lon2 - lon1;
  if (dxLon > 180) {
    lon2 -= 360;
    dxLon = lon2 - lon1;
  } else if (dxLon < -180) {
    lon2 += 360;
    dxLon = lon2 - lon1;
  }
  const dyLat = lat2 - lat1;
  const dist = Math.sqrt(dxLon * dxLon + dyLat * dyLat);

  if (dist < 1e-4) {
    return [start, end];
  }

  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  // Adaptive curvature: close points keep near-straight lines, long routes keep a gentle arc.
  const ratio = dist < 0.08 ? 0.04 : dist < 0.35 ? 0.08 : dist < 1.2 ? 0.12 : 0.16;
  const offset = Math.min(6, dist * ratio);
  const ctrlLat = midLat + (dxLon / dist) * offset;
  const ctrlLon = midLon - (dyLat / dist) * offset;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const lat = (1 - t) * (1 - t) * lat1 + 2 * (1 - t) * t * ctrlLat + t * t * lat2;
    const lon = (1 - t) * (1 - t) * lon1 + 2 * (1 - t) * t * ctrlLon + t * t * lon2;
    const normalizedLon = lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
    points.push([lat, normalizedLon]);
  }
  return points;
}

function attachMapDecorControls(map) {
  if (!map || !window.L) return;

  /* ─── Unified bottom-right container ─── */
  const decorControl = L.control({ position: "bottomright" });
  decorControl.onAdd = () => {
    const wrap = L.DomUtil.create("div", "map-decor-controls");
    wrap.innerHTML = `
      <div class="map-compass" aria-label="指北针" title="指向北方">
        <svg viewBox="0 0 40 40" width="36" height="36" class="compass-needle">
          <polygon points="20,4 24,20 20,17 16,20" fill="#dc2626"/>
          <polygon points="20,36 16,20 20,23 24,20" fill="#94a3b8"/>
          <circle cx="20" cy="20" r="2.5" fill="white" stroke="#475569" stroke-width="1"/>
        </svg>
        <span class="compass-label">N</span>
      </div>
      <div class="map-scale-bar">
        <div class="scale-line"></div>
        <div class="scale-text"></div>
      </div>
    `;
    L.DomEvent.disableClickPropagation(wrap);
    L.DomEvent.disableScrollPropagation(wrap);
    return wrap;
  };
  decorControl.addTo(map);

  /* ─── Auto-updating scale bar ─── */
  const scaleText = decorControl.getContainer().querySelector(".scale-text");
  const scaleLine = decorControl.getContainer().querySelector(".scale-line");
  
  function pickNiceScaleDistance(maxMeters) {
    if (!Number.isFinite(maxMeters) || maxMeters <= 0) return 1;
    const target = maxMeters * 0.72;
    const exponent = Math.floor(Math.log10(target));
    const base = Math.pow(10, exponent);
    const fraction = target / base;
    let niceFraction = 1;
    if (fraction >= 5) niceFraction = 5;
    else if (fraction >= 2) niceFraction = 2;
    return niceFraction * base;
  }

  function updateScale() {
    if (!scaleText || !scaleLine || !map.getSize) return;
    const mapSize = map.getSize();
    const maxWidthPx = 100;
    const point1 = map.containerPointToLatLng([mapSize.x / 2 - maxWidthPx / 2, mapSize.y / 2]);
    const point2 = map.containerPointToLatLng([mapSize.x / 2 + maxWidthPx / 2, mapSize.y / 2]);
    const distMeters = map.distance(point1, point2);
    const niceMeters = pickNiceScaleDistance(distMeters);
    const ratio = Math.max(0.12, Math.min(1, niceMeters / distMeters));
    const barWidth = Math.max(20, Math.round(maxWidthPx * ratio));
    scaleLine.style.width = `${barWidth}px`;
    scaleText.textContent = niceMeters >= 1000 ? `${(niceMeters / 1000).toFixed(niceMeters % 1000 === 0 ? 0 : 1)} km` : `${Math.round(niceMeters)} m`;
  }
  map.on("zoomend moveend resize", updateScale);
  setTimeout(updateScale, 200);
}

function normalizeCoordText(raw) {
  // Normalize symbols and unit characters to support mixed input styles.
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
  // Accept decimal and DMS-like text, then normalize to decimal degree.
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
  // Convert decimal coordinate to DMS split fields for the form.
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
  // Parse DMS split fields and return decimal degree.
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

const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLatOffset(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLonOffset(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return [Number(lat), Number(lon)];
  const dLat = transformLatOffset(lon - 105.0, lat - 35.0);
  const dLon = transformLonOffset(lon - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const mgLat = lat + (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  const mgLon = lon + (dLon * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [Number(mgLat.toFixed(8)), Number(mgLon.toFixed(8))];
}

function gcj02ToWgs84(lat, lon) {
  if (outOfChina(lat, lon)) return [Number(lat), Number(lon)];
  let wgsLat = Number(lat);
  let wgsLon = Number(lon);
  for (let i = 0; i < 2; i += 1) {
    const [tmpLat, tmpLon] = wgs84ToGcj02(wgsLat, wgsLon);
    wgsLat -= tmpLat - lat;
    wgsLon -= tmpLon - lon;
  }
  return [Number(wgsLat.toFixed(8)), Number(wgsLon.toFixed(8))];
}

function normalizeCoordSystem(value) {
  const text = String(value || "").trim().toLowerCase();
  const compact = text.replace(/[-_]/g, "");
  if (compact === "gcj02" || compact === "gcj" || text === "火星坐标" || text === "火星坐标系") return "gcj02";
  return "wgs84";
}

function convertToWgs84(lat, lon, coordSystem) {
  if (normalizeCoordSystem(coordSystem) === "gcj02") {
    return gcj02ToWgs84(lat, lon);
  }
  return [Number(lat), Number(lon)];
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
  return `${Number(lon).toFixed(6)}, ${Number(lat).toFixed(6)}`;
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
    <div className="ios-card rounded-2xl border border-blue-100 bg-white/95 p-2.5 shadow-soft">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 text-left">
        <div className="text-[13px] font-black text-brand-700">{title}</div>
        <div className="flex items-center gap-2">
          {rightNode}
          <span className="text-xs font-bold text-slate-500">{open ? "收起" : "展开"}</span>
        </div>
      </button>
      <div className={`ios-collapse ${open ? "mt-2.5 max-h-[1800px] opacity-100" : "max-h-0 opacity-0"}`}>
        {children}
      </div>
    </div>
  );
}

function DmsAxisInput({ axis, value, onChange }) {
  const dirs = axis === "lat" ? ["N", "S"] : ["E", "W"];
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
      <input value={value.deg} onChange={(e) => onChange({ ...value, deg: e.target.value })} className="modern-input rounded-xl px-3 py-1.5 text-xs" placeholder="度" />
      <input value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} className="modern-input rounded-xl px-3 py-1.5 text-xs" placeholder="分" />
      <input value={value.sec} onChange={(e) => onChange({ ...value, sec: e.target.value })} className="modern-input rounded-xl px-3 py-1.5 text-xs" placeholder="秒" />
      <select value={value.dir} onChange={(e) => onChange({ ...value, dir: e.target.value })} className="modern-input rounded-xl px-3 py-1.5 text-xs font-bold">
        {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

function EndpointEditor({ title, endpoint, setEndpoint, coordMode }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
      <div className="mb-2 text-[13px] font-black text-slate-700">{title}</div>
      <input value={endpoint.name} onChange={(e) => setEndpoint((p) => ({ ...p, name: e.target.value }))} className="modern-input mb-3 w-full rounded-xl px-3.5 py-2 text-xs" placeholder={`${title}名称（可选）`} />

      <div className={`ios-collapse ${coordMode === "decimal" ? "max-h-[72px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className={`grid grid-cols-2 gap-3 ios-mode-panel ${coordMode === "decimal" ? "ios-mode-panel-show" : "ios-mode-panel-hide"}`}>
          <input value={endpoint.decimal.lon} onChange={(e) => setEndpoint((p) => ({ ...p, decimal: { ...p.decimal, lon: e.target.value } }))} className="modern-input rounded-xl px-3.5 py-2 text-xs" placeholder="经度" />
          <input value={endpoint.decimal.lat} onChange={(e) => setEndpoint((p) => ({ ...p, decimal: { ...p.decimal, lat: e.target.value } }))} className="modern-input rounded-xl px-3.5 py-2 text-xs" placeholder="纬度" />
        </div>
      </div>

      <div className={`ios-collapse ${coordMode === "dms" ? "mt-2 max-h-[166px] opacity-100" : "max-h-0 opacity-0 pointer-events-none"}`}>
        <div className={`space-y-3 ios-mode-panel ${coordMode === "dms" ? "ios-mode-panel-show" : "ios-mode-panel-hide"}`}>
          <div>
            <div className="mb-2 text-xs font-bold text-slate-500">经度（度/分/秒）</div>
            <DmsAxisInput axis="lon" value={endpoint.dms.lon} onChange={(next) => setEndpoint((p) => ({ ...p, dms: { ...p.dms, lon: next } }))} />
          </div>
          <div>
            <div className="mb-2 text-xs font-bold text-slate-500">纬度（度/分/秒）</div>
            <DmsAxisInput axis="lat" value={endpoint.dms.lat} onChange={(next) => setEndpoint((p) => ({ ...p, dms: { ...p.dms, lat: next } }))} />
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
  const [inputCoordSystem, setInputCoordSystem] = useState("wgs84");
  const [originInput, setOriginInput] = useState(createEndpointState());
  const [destinationInput, setDestinationInput] = useState(createEndpointState());
  const [activeEndpoint, setActiveEndpoint] = useState("origin");
  const [selectedCampusKey, setSelectedCampusKey] = useState("hznu-cangqian");
  const [routeCategory, setRouteCategory] = useState("课堂");

  const [pickTarget, setPickTarget] = useState(null);
  const [originPoint, setOriginPoint] = useState(null);
  const [destinationPoint, setDestinationPoint] = useState(null);

  const [filterOpen, setFilterOpen] = useState(true);
  const [entryOpen, setEntryOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [baseMapMode, setBaseMapMode] = useState("vector");
  const [isCompactScreen, setIsCompactScreen] = useState(false);
  const [themeMode, setThemeMode] = useState(api.getTheme(api.getThemePreference()));
  const [mapLibError, setMapLibError] = useState("");
  const layoutAutoInitRef = useRef(false);

  const categoryColors = useMemo(() => ({ 课堂: "#2563eb", 通勤: "#0891b2", 调研: "#7c3aed", 实习: "#f97316", 其他: "#4b5563" }), []);
  const campusShortcuts = useMemo(() => ([
    { key: "hznu-cangqian", name: "杭州师范大学仓前校区", lat: 30.29577, lon: 120.01963, coord_system: "gcj02" },
    { key: "hznu-xiasha", name: "杭州师范大学下沙校区", lat: 30.315002, lon: 120.393968, coord_system: "gcj02" },
  ].map((item) => {
    const [lat_wgs84, lon_wgs84] = convertToWgs84(item.lat, item.lon, item.coord_system || "wgs84");
    return { ...item, lat_wgs84, lon_wgs84 };
  })), []);

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

  const activeEndpointInput = activeEndpoint === "origin" ? originInput : destinationInput;
  const setActiveEndpointInput = activeEndpoint === "origin" ? setOriginInput : setDestinationInput;
  const activeEndpointTitle = activeEndpoint === "origin" ? "起点 O" : "终点 D";
  const selectedCampus = useMemo(
    () => campusShortcuts.find((item) => item.key === selectedCampusKey) || campusShortcuts[0] || null,
    [campusShortcuts, selectedCampusKey]
  );

  useEffect(() => {
    const onThemeChange = (event) => {
      setThemeMode(event?.detail?.theme || api.getTheme(api.getThemePreference()));
    };
    window.addEventListener("webgis-theme-change", onThemeChange);
    return () => window.removeEventListener("webgis-theme-change", onThemeChange);
  }, []);

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

  function parseEndpointRaw(endpoint, prefix) {
    const lat = coordMode === "decimal"
      ? parseFlexibleCoordinate(endpoint.decimal.lat, "lat")
      : parseDmsParts(endpoint.dms.lat, "lat", prefix);
    const lon = coordMode === "decimal"
      ? parseFlexibleCoordinate(endpoint.decimal.lon, "lon")
      : parseDmsParts(endpoint.dms.lon, "lon", prefix);
    return { lat, lon };
  }

  function parseEndpoint(endpoint, prefix) {
    const raw = parseEndpointRaw(endpoint, prefix);
    const [lat, lon] = convertToWgs84(raw.lat, raw.lon, inputCoordSystem);
    return { name: endpoint.name.trim() || `${prefix}点`, lat, lon };
  }

  function parseEndpointIfFilled(endpoint, prefix) {
    if (!endpointHasAnyInput(endpoint)) return null;
    return parseEndpoint(endpoint, prefix);
  }

  function convertEndpointInputSystem(endpoint, fromSystem, toSystem, prefix) {
    // Keep user-entered endpoint values consistent when switching coordinate system tabs.
    try {
      const raw = parseEndpointRaw(endpoint, prefix);
      const [wgsLat, wgsLon] = convertToWgs84(raw.lat, raw.lon, fromSystem);
      const [nextLat, nextLon] = normalizeCoordSystem(toSystem) === "gcj02"
        ? wgs84ToGcj02(wgsLat, wgsLon)
        : [wgsLat, wgsLon];
      return {
        ...endpoint,
        decimal: {
          lat: String(Number(nextLat.toFixed(6))),
          lon: String(Number(nextLon.toFixed(6))),
        },
        dms: {
          lat: toDmsParts(nextLat, "lat"),
          lon: toDmsParts(nextLon, "lon"),
        },
      };
    } catch {
      return endpoint;
    }
  }

  function switchInputCoordSystem(nextSystem) {
    const normalizedNext = normalizeCoordSystem(nextSystem);
    if (normalizedNext === inputCoordSystem) return;
    const fromSystem = inputCoordSystem;
    setOriginInput((prev) => convertEndpointInputSystem(prev, fromSystem, normalizedNext, "起点"));
    setDestinationInput((prev) => convertEndpointInputSystem(prev, fromSystem, normalizedNext, "终点"));
    setInputCoordSystem(normalizedNext);
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
    const updateLayout = () => {
      const compact = window.matchMedia("(max-width: 1024px)").matches;
      setIsCompactScreen(compact);
      if (!layoutAutoInitRef.current) {
        setFilterOpen(!compact);
        setRecentOpen(!compact);
        setEntryOpen(true);
        layoutAutoInitRef.current = true;
      }
    };
    updateLayout();
    window.addEventListener("resize", updateLayout);
    return () => window.removeEventListener("resize", updateLayout);
  }, []);

  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) return;
    if (!window.L || typeof L.map !== "function") {
      setMapLibError("地图组件加载失败，请刷新页面重试");
      return;
    }
    let map;
    try {
      map = L.map(mapHostRef.current, { zoomControl: false, minZoom: 2, attributionControl: false }).setView([20, 110], 3);
    } catch (err) {
      setMapLibError((err && err.message) ? `地图初始化失败：${err.message}` : "地图初始化失败，请刷新页面重试");
      return;
    }
    const vecCfg = api.getTiandituLayerConfig("vec");
    const cvaCfg = api.getTiandituLayerConfig("cva");
    const imgCfg = api.getTiandituLayerConfig("img");
    const ciaCfg = api.getTiandituLayerConfig("cia");
    if (!vecCfg || !cvaCfg || !imgCfg || !ciaCfg) {
      setMapLibError("未配置天地图 Key，请先在部署配置中设置");
      map.remove();
      return;
    }
    setMapLibError("");
    const vec = L.tileLayer(vecCfg.url, vecCfg.options);
    const cva = L.tileLayer(cvaCfg.url, cvaCfg.options);
    const img = L.tileLayer(imgCfg.url, imgCfg.options);
    const cia = L.tileLayer(ciaCfg.url, ciaCfg.options);
    vec.addTo(map);
    cva.addTo(map);
    baseTileLayersRef.current = { vec, cva, img, cia };
    attachMapDecorControls(map);
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
    // Map click updates O/D according to the active pick target.
    const onMapClick = (e) => {
      if (!pickTarget) return;
      const { lat, lng } = e.latlng;
      if (pickTarget === "origin") {
        syncEndpointFromDecimal("origin", lat, lng, "地图起点");
        setActiveEndpoint("destination");
        setPickTarget("destination");
        api.notify("已设置起点 O，请点击终点 D");
      } else {
        syncEndpointFromDecimal("destination", lat, lng, "地图终点");
        setActiveEndpoint("destination");
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
        `录入账号：${route.user_name || "-"}<br/>` +
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
    // Priority:
    // 1) If O/D inputs are complete, fit map to that pair.
    // 2) Otherwise, fit to currently visible route set.
    try {
      const origin = parseEndpointIfFilled(originInput, "起点");
      const destination = parseEndpointIfFilled(destinationInput, "终点");

      if (origin && destination) {
        syncEndpointFromDecimal("origin", origin.lat, origin.lon, origin.name);
        syncEndpointFromDecimal("destination", destination.lat, destination.lon, destination.name);
        if (mapRef.current) {
          mapRef.current.fitBounds([[origin.lat, origin.lon], [destination.lat, destination.lon]], { padding: [45, 45] });
        }
        api.notify("已更新为当前输入的 O-D 展示");
        return;
      }

      if (visibleRoutes.length > 0) {
        fitCurrentRoutes();
        api.notify("已按当前筛选更新地图展示");
        return;
      }

      api.notify("请先录入线路或输入起终点坐标", true);
    } catch (err) {
      api.notify(err.message || "更新地图展示失败", true);
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

  function syncInputPointsToMap() {
    // Parse whatever is currently filled in the form and center/fit the map.
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
    setActiveEndpoint("origin");
    setPickTarget(null);
  }

  function swapEndpoints() {
    setOriginInput(destinationInput);
    setDestinationInput(originInput);
    setOriginPoint(destinationPoint);
    setDestinationPoint(originPoint);
    setActiveEndpoint((prev) => (prev === "origin" ? "destination" : "origin"));
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
        origin_coord_system: "wgs84",
        destination_name: destination.name,
        destination_lat: destination.lat,
        destination_lon: destination.lon,
        destination_coord_system: "wgs84",
        coord_system: "wgs84",
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

  function toggleThemeMode() {
    const next = api.toggleTheme();
    setThemeMode(next);
  }

  return (
    <div className="relative mx-auto max-w-[1880px] p-3 sm:p-4 ios-fade-up">
      <div className="pointer-events-none absolute -left-16 -top-10 h-36 w-36 rounded-full bg-cyan-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-8 top-12 h-28 w-28 rounded-full bg-blue-200/35 blur-3xl" />
      <header className="ios-card mb-4 rounded-[1.4rem] border border-blue-100 bg-white/80 px-4 py-3 sm:rounded-[2rem] sm:px-6 sm:py-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xl font-black text-brand-700 sm:text-2xl">OD 流向录入与分析</div>
            <div className="text-xs font-semibold text-slate-500 sm:text-sm">支持地图点选与十进制度/度分秒输入</div>
            {me && <div className="text-xs font-semibold text-slate-500">当前用户：{me.is_guest ? me.name : (me.username || "-")}</div>}
          </div>
          <div className="w-full sm:w-auto">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-end sm:overflow-visible sm:pb-0">
              <button onClick={() => Promise.all([loadMe(), loadRoutes()])} className="shrink-0 rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50 sm:text-sm">刷新</button>
              <button onClick={generateOdMap} className="shrink-0 rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50 sm:text-sm">按当前数据定位地图</button>
              <button onClick={() => window.location.href = "/account"} className="shrink-0 rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50 sm:text-sm">账户中心</button>
              <button onClick={toggleThemeMode} className="shrink-0 rounded-xl border border-admin-200 bg-white px-4 py-2.5 text-sm font-bold text-admin-600 transition-all hover:bg-admin-50 sm:text-sm">{themeMode === "dark" ? "浅色模式" : "深色模式"}</button>
              <button onClick={logout} className="shrink-0 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-bold text-rose-600 transition-all hover:bg-rose-50 sm:text-sm">退出登录</button>
            </div>
          </div>
        </div>
      </header>

      <main className={mapFullscreen ? "" : "grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]"}>
        <section ref={mapSectionRef} className={`${mapFullscreen ? "fixed inset-0 z-[1300] rounded-none border-0" : "relative h-[54vh] min-h-[300px] overflow-hidden rounded-[1.4rem] border border-blue-100 bg-white/80 shadow-soft sm:h-[68vh] sm:min-h-[520px] sm:rounded-[2rem] lg:h-[calc(100vh-212px)] lg:min-h-[560px] xl:min-h-[620px]"} ios-card`}>
          <div ref={mapHostRef} className="h-full w-full" />
          {mapLibError && (
            <div className="pointer-events-none absolute inset-0 z-[950] flex items-center justify-center bg-white/75 px-4 text-center">
              <div className="rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-bold text-rose-600 shadow-soft">
                {mapLibError}
              </div>
            </div>
          )}

          <div className="map-tool-stack absolute left-3 top-3 z-[900] flex flex-col gap-2 sm:left-4 sm:top-4">
            <button onClick={() => mapRef.current && mapRef.current.zoomIn()} className="ios-card rounded-xl border border-blue-100 bg-white/90 px-3 py-1.5 text-xl font-black text-admin-600 shadow-soft transition-all hover:bg-white">+</button>
            <button onClick={() => mapRef.current && mapRef.current.zoomOut()} className="ios-card rounded-xl border border-blue-100 bg-white/90 px-3 py-1.5 text-xl font-black text-admin-600 shadow-soft transition-all hover:bg-white">-</button>
            <button onClick={() => setBaseMapMode((v) => (v === "vector" ? "satellite" : "vector"))} className="ios-card rounded-xl border border-blue-100 bg-white/90 px-3 py-1.5 text-xs font-black text-admin-600 shadow-soft transition-all hover:bg-white sm:text-sm">{baseMapMode === "satellite" ? "切到矢量" : "切到卫星"}</button>
            <button onClick={fitCurrentRoutes} className="ios-card rounded-xl border border-blue-100 bg-white/90 px-3 py-1.5 text-sm font-black text-admin-600 shadow-soft transition-all hover:bg-white">适配</button>
            <button onClick={toggleMapFullscreen} className="ios-card rounded-xl border border-blue-100 bg-white/90 px-3 py-1.5 text-xs font-black text-admin-600 shadow-soft transition-all hover:bg-white sm:text-sm">{mapFullscreen ? "退出全屏" : "全屏"}</button>
          </div>

          <div className="map-detail-card absolute left-3 bottom-3 z-[900] w-[min(92vw,320px)] rounded-2xl border border-blue-100/80 bg-white/75 px-3 py-2.5 shadow-sm backdrop-blur-md sm:left-4 sm:bottom-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-bold tracking-wide text-admin-700">地图状态</div>
              <div className="text-[10px] font-semibold text-slate-500">{baseMapMode === "satellite" ? "卫星" : "矢量"} · {inputCoordSystem === "gcj02" ? "GCJ-02" : "WGS84"}</div>
            </div>
            <div className="mt-1.5 text-[11px] font-semibold text-slate-600 leading-tight">
              {pickTarget === "origin" && "正在点选起点 O"}
              {pickTarget === "destination" && "正在点选终点 D"}
              {!pickTarget && "可通过左下角按钮点选，或在右侧表单录入 O/D"}
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-2 text-[10px] font-semibold text-slate-500 leading-tight">
              <div>O: {originPoint ? formatCoord(originPoint[0], originPoint[1]) : "未设置"}</div>
              <div>D: {destinationPoint ? formatCoord(destinationPoint[0], destinationPoint[1]) : "未设置"}</div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => { setActiveEndpoint("origin"); setPickTarget("origin"); }}
                className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-all ${pickTarget === "origin" ? "border-blue-300 bg-blue-100 text-brand-700 shadow-sm" : "border-blue-200 bg-white text-brand-700"}`}
              >
                点选 O
              </button>
              <button
                type="button"
                onClick={() => { setActiveEndpoint("destination"); setPickTarget("destination"); }}
                className={`rounded-lg border px-2 py-1 text-[10px] font-bold transition-all ${pickTarget === "destination" ? "border-blue-300 bg-blue-100 text-brand-700 shadow-sm" : "border-blue-200 bg-white text-brand-700"}`}
              >
                点选 D
              </button>
              <button type="button" onClick={clearInputs} className="rounded-lg border border-blue-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 transition-all">清空</button>
            </div>
          </div>
        </section>

        {!mapFullscreen && (
          <aside className="space-y-2.5 lg:h-[calc(100vh-212px)] lg:overflow-hidden">
            <div className="space-y-2.5 lg:h-full lg:overflow-y-auto lg:pr-1">
              <SectionCard
                title="筛选与交互"
                open={filterOpen}
                onToggle={() => setFilterOpen((v) => !v)}
                rightNode={<span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">{api.fmtNumber(visibleRoutes.length)} 条</span>}
              >
                <div className="space-y-3">
                  <input value={searchKeyword} onChange={(e) => setSearchKeyword(e.target.value)} className="modern-input w-full rounded-xl px-3.5 py-2 text-xs" placeholder="搜索起点、终点或分类" />

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50/50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all hover:bg-blue-100/50">
                      <input type="checkbox" checked={showOnlyMine} onChange={(e) => setShowOnlyMine(e.target.checked)} className="h-4 w-4" />仅看我的线路
                    </label>
                    <select value={routeCategoryFilter} onChange={(e) => setRouteCategoryFilter(e.target.value)} className="modern-input rounded-xl px-3.5 py-1.5 text-xs">
                      <option value="all">全部分类</option>
                      {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                    <div className="mb-2 text-xs font-bold text-slate-600">坐标输入模式</div>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-blue-100/70 p-1.5">
                      <button type="button" onClick={() => { setCoordMode("decimal"); syncModeValues("decimal"); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${coordMode === "decimal" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}>十进制度</button>
                      <button type="button" onClick={() => { setCoordMode("dms"); syncModeValues("dms"); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${coordMode === "dms" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}>度分秒</button>
                    </div>
                    <div className="mt-3 mb-2 text-xs font-bold text-slate-600">输入坐标系</div>
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-blue-100/70 p-1.5">
                      <button type="button" onClick={() => switchInputCoordSystem("wgs84")} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${inputCoordSystem === "wgs84" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}>WGS84</button>
                      <button type="button" onClick={() => switchInputCoordSystem("gcj02")} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${inputCoordSystem === "gcj02" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}>GCJ-02</button>
                    </div>
                    <div className="mt-2 text-xs font-semibold text-slate-500">内部存储与地图展示均使用 WGS84。</div>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
                    <div className="mb-2.5 text-xs font-bold text-slate-600">快捷跳转（杭州师范大学）</div>
                    <div className="space-y-2.5">
                      <select
                        value={selectedCampus?.key || ""}
                        onChange={(e) => setSelectedCampusKey(e.target.value)}
                        className="modern-input w-full rounded-xl px-3.5 py-2 text-xs"
                      >
                        {campusShortcuts.map((campus) => (
                          <option key={campus.key} value={campus.key}>
                            {campus.name}
                          </option>
                        ))}
                      </select>
                      {selectedCampus && (
                        <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                          WGS84：{formatCoord(selectedCampus.lat_wgs84 ?? selectedCampus.lat, selectedCampus.lon_wgs84 ?? selectedCampus.lon)}
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-2">
                        <button
                          type="button"
                          disabled={!selectedCampus}
                          onClick={() => {
                            if (!mapRef.current || !selectedCampus) return;
                            mapRef.current.setView(
                              [Number.isFinite(selectedCampus.lat_wgs84) ? selectedCampus.lat_wgs84 : selectedCampus.lat, Number.isFinite(selectedCampus.lon_wgs84) ? selectedCampus.lon_wgs84 : selectedCampus.lon],
                              Math.max(mapRef.current.getZoom(), 14),
                              { animate: true }
                            );
                          }}
                          className="rounded-xl border border-blue-200 bg-white px-2.5 py-1.5 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50 disabled:opacity-60"
                        >
                          跳转到该校区
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
                    <button type="button" onClick={syncInputPointsToMap} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50">按输入定位地图</button>
                    <button type="button" onClick={swapEndpoints} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50">交换 O/D</button>
                    <button type="button" onClick={clearInputs} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50">清空输入</button>
                  </div>
                </div>
              </SectionCard>
              <SectionCard title="录入 OD 线路" open={entryOpen} onToggle={() => setEntryOpen((v) => !v)}>
                <form onSubmit={submitRoute} className="space-y-3">
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-2">
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-blue-100/70 p-1">
                      <button
                        type="button"
                        onClick={() => setActiveEndpoint("origin")}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${activeEndpoint === "origin" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}
                      >
                        编辑起点 O
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveEndpoint("destination")}
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${activeEndpoint === "destination" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/50"}`}
                      >
                        编辑终点 D
                      </button>
                    </div>
                  </div>

                  <EndpointEditor title={activeEndpointTitle} endpoint={activeEndpointInput} setEndpoint={setActiveEndpointInput} coordMode={coordMode} />

                  <div className="rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600">
                    O：{originInput.name || "未命名"} | D：{destinationInput.name || "未命名"}
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 rounded-2xl border border-blue-100 bg-white p-3">
                    <select value={routeCategory} onChange={(e) => setRouteCategory(e.target.value)} className="modern-input rounded-xl px-3.5 py-2 text-xs">
                      {allCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    <button disabled={submitting} className="btn-primary rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-60">{submitting ? "提交中..." : "保存线路"}</button>
                    <button type="button" onClick={generateOdMap} className="col-span-2 rounded-xl border border-blue-200 bg-white px-3.5 py-2 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50">预览当前线路</button>
                  </div>

                  <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-2 py-2 text-[11px] font-semibold text-slate-600">
                    支持 WGS84 与 GCJ-02 输入；内部存储与展示默认采用 WGS84。
                  </div>
                </form>
              </SectionCard>

              <SectionCard title="最近线路" open={recentOpen} onToggle={() => setRecentOpen((v) => !v)}>
                <div className="max-h-[280px] space-y-2 overflow-auto pr-1 lg:max-h-[34vh]">
                  {visibleRoutes.slice(0, isCompactScreen ? 8 : 16).map((route) => (
                    <div key={route.id} className="rounded-2xl border border-blue-100 bg-blue-50/40 p-3 shadow-sm transition-all hover:bg-white hover:shadow-md">
                      <div className="truncate text-sm font-bold text-slate-800">{route.origin_name} -&gt; {route.destination_name}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">{route.category} | {api.fmtTime(route.created_at)}</div>
                      <div className="mt-2.5 flex items-center justify-end gap-2">
                        <button type="button" onClick={() => {
                          if (!mapRef.current) return;
                          mapRef.current.fitBounds([[route.origin_lat, route.origin_lon], [route.destination_lat, route.destination_lon]], { padding: [42, 42] });
                        }} className="rounded-xl border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-brand-700 transition-all hover:bg-slate-50">定位</button>
                        {Number(route.user_id) === Number(me?.id) && (
                          <button type="button" onClick={() => deleteRoute(route.id)} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-600 transition-all hover:bg-rose-100">删除</button>
                        )}
                      </div>
                    </div>
                  ))}
                  {visibleRoutes.length === 0 && <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 text-sm font-semibold text-slate-500">暂无线路数据</div>}
                </div>
              </SectionCard>
            </div>
          </aside>
        )}
      </main>

      {!mapFullscreen && (
        <footer className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard title="我的线路数" value={api.fmtNumber(mySummary.count)} hint="当前用户累计" />
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

const explorerRootNode = document.getElementById("app");
if (ReactDOM.createRoot) {
  ReactDOM.createRoot(explorerRootNode).render(<ExplorerApp />);
} else {
  ReactDOM.render(<ExplorerApp />, explorerRootNode);
}

