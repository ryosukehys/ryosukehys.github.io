import { cumulativeM, kmMarks, nearestOnLine } from "./geo.js";

const LEG_COLORS = {
  1: "#c62f3c",
  2: "#e67e10",
  3: "#2a9248",
  4: "#1f6fc0",
  5: "#7a4cc2",
  6: "#0e7c86",
};
const KM_MARK_MIN_ZOOM = 13;
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

const statusEl = document.getElementById("status");
const hereEl = document.getElementById("here");
const locateHelpEl = document.getElementById("locate-help");
const legsEl = document.getElementById("legs");
const showAllBtn = document.getElementById("show-all");
const kmToggle = document.getElementById("toggle-km");
const checkpointToggle = document.getElementById("toggle-checkpoints");
const locateBtn = document.getElementById("locate");

const map = L.map("map", { zoomSnap: 0.25, zoomControl: true, attributionControl: true }).setView([35.39, 132.75], 12);
// 現在地はコースの線や中継所より上に描く
map.createPane("here").style.zIndex = 630;
map.attributionControl.setPrefix(false);
map.attributionControl.addAttribution(
  'コース: &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>',
);

const baseLayers = {
  淡色地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    attribution: GSI_ATTRIBUTION,
    maxZoom: 18,
  }),
  標準地図: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    attribution: GSI_ATTRIBUTION,
    maxZoom: 18,
  }),
  写真: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
    attribution: GSI_ATTRIBUTION,
    maxZoom: 18,
  }),
};
baseLayers["淡色地図"].addTo(map);
L.control.layers(baseLayers, null, { position: "topright" }).addTo(map);
L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

const toLatLng = ([lon, lat]) => [lat, lon];
const fmtKm = (km) => `${km.toFixed(1)}km`;

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// 先に走る区間と同じ道を通る部分（shared）とそれ以外に線を分ける。
// 分け目の頂点は両方に入れて、線が途切れないようにする。
function splitRuns(coords, sharedRanges = []) {
  const shared = new Array(coords.length - 1).fill(false);
  for (const [from, to] of sharedRanges) {
    for (let i = from; i < to; i++) shared[i] = true;
  }
  const runs = [];
  let current = null;
  for (let i = 0; i < shared.length; i++) {
    if (!current || current.shared !== shared[i]) {
      current = { shared: shared[i], coords: [coords[i]] };
      runs.push(current);
    }
    current.coords.push(coords[i + 1]);
  }
  return runs;
}

function stationIcon(props) {
  return L.divIcon({
    className: `station station-${props.role}`,
    html: `<span>${escapeHtml(props.label)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  });
}

function kmIcon(km, color) {
  return L.divIcon({
    className: "km-mark",
    html: `<span style="border-color:${color};color:${color}">${km}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

// ピンの吹き出しに付ける Google マップへのリンク（スマホではアプリが開く）
function googleLinks([lon, lat]) {
  const q = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `
    <span class="gmap-links">
      <a href="https://www.google.com/maps/search/?api=1&amp;query=${q}" target="_blank" rel="noopener">Googleマップで開く</a>
      <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${q}" target="_blank" rel="noopener">ここへの経路</a>
    </span>`;
}

function stationPopup(props, legs, coord) {
  const arriving = legs.find((l) => l.props.leg === props.order);
  const leaving = legs.find((l) => l.props.leg === props.order + 1);
  const roles = [];
  if (arriving) roles.push(`${arriving.props.leg}区のゴール`);
  if (leaving) roles.push(`${leaving.props.leg}区のスタート`);
  return `
    <strong>${escapeHtml(props.title)}</strong><br>
    ${escapeHtml(props.name)}<br>
    <span class="muted">スタートから ${fmtKm(props.km)}${roles.length ? ` · ${roles.join(" / ")}` : ""}</span>
    ${googleLinks(coord)}`;
}

const state = {
  legs: [],
  selected: null,
  kmLayers: new Map(), // 区間番号 → 1kmごとの目印
  checkpointLayer: L.layerGroup(),
  courseBounds: null,
};

function styleLegs() {
  for (const leg of state.legs) {
    const dimmed = state.selected !== null && state.selected !== leg.props.leg;
    const focused = state.selected === leg.props.leg;
    const opacity = dimmed ? 0.18 : 1;
    leg.casing.setStyle({ opacity: dimmed ? 0.3 : 0.95, weight: focused ? 11 : 9 });
    leg.solid.setStyle({ opacity, weight: focused ? 7 : 5 });
    leg.dashed?.setStyle({
      opacity,
      weight: focused ? 7 : 5,
      dashArray: focused ? null : "8 10",
    });
    leg.item.classList.toggle("is-selected", focused);
    leg.item.querySelector("button").setAttribute("aria-expanded", String(focused));
  }
  showAllBtn.classList.toggle("is-active", state.selected === null);
  updateKmLayer();
  const focusedLeg = state.legs.find((l) => l.props.leg === state.selected);
  if (focusedLeg) {
    focusedLeg.casing.bringToFront();
    focusedLeg.solid.bringToFront();
    focusedLeg.dashed?.bringToFront();
  }
}

function selectLeg(legNo) {
  state.selected = state.selected === legNo ? null : legNo;
  styleLegs();
  const leg = state.legs.find((l) => l.props.leg === state.selected);
  map.fitBounds(leg ? leg.bounds : state.courseBounds, { padding: [24, 24] });
}

// 区間を選んでいるときは、その区間の目印だけを出す（1区と6区は同じ道を走るので重なる）
function updateKmLayer() {
  const zoomOk = kmToggle.checked && map.getZoom() >= KM_MARK_MIN_ZOOM;
  for (const [legNo, layer] of state.kmLayers) {
    if (zoomOk && (state.selected === null || state.selected === legNo)) layer.addTo(map);
    else layer.remove();
  }
}

function updateCheckpointLayer() {
  if (checkpointToggle.checked) state.checkpointLayer.addTo(map);
  else state.checkpointLayer.remove();
}

function renderLegList(legs, checkpoints) {
  legsEl.replaceChildren();
  for (const leg of legs) {
    const p = leg.props;
    const li = document.createElement("li");
    li.className = "leg";
    li.style.setProperty("--leg-color", LEG_COLORS[p.leg]);

    const points = checkpoints
      .filter((c) => c.leg === p.leg)
      .map(
        (c) =>
          `<li><span class="cp-km">${fmtKm(c.km - p.startKm)}</span>${escapeHtml(c.name)}<span class="cp-total">累計 ${fmtKm(c.km)}</span></li>`,
      )
      .join("");

    li.innerHTML = `
      <button type="button" class="leg-head" aria-expanded="false">
        <span class="leg-name">${p.leg}区</span>
        <span class="leg-km">${fmtKm(p.officialKm)}</span>
        <span class="leg-route">${escapeHtml(p.from)} → ${escapeHtml(p.to)}</span>
      </button>
      <div class="leg-detail">
        <p class="muted">スタートから ${fmtKm(p.startKm)} 〜 ${fmtKm(p.startKm + p.officialKm)}</p>
        ${points ? `<ol class="checkpoints">${points}</ol>` : ""}
      </div>`;
    li.querySelector("button").addEventListener("click", () => selectLeg(p.leg));
    legsEl.append(li);
    leg.item = li;
  }
}

function drawCourse(geojson) {
  const features = geojson.features;
  const legFeatures = features
    .filter((f) => f.properties.kind === "leg")
    .sort((a, b) => a.properties.leg - b.properties.leg);
  const stations = features
    .filter((f) => f.properties.kind === "station")
    .sort((a, b) => a.properties.order - b.properties.order);
  const checkpoints = features.filter((f) => f.properties.kind === "checkpoint");

  const legs = legFeatures.map((f) => {
    const p = f.properties;
    const color = LEG_COLORS[p.leg];
    const runs = splitRuns(f.geometry.coordinates, p.shared);
    const own = runs.filter((r) => !r.shared).map((r) => r.coords.map(toLatLng));
    const shared = runs.filter((r) => r.shared).map((r) => r.coords.map(toLatLng));
    const all = f.geometry.coordinates.map(toLatLng);

    const casing = L.polyline(own, { color: "#ffffff", weight: 9, opacity: 0.95, interactive: false }).addTo(map);
    const solid = L.polyline(own, { color, weight: 5, lineCap: "round", lineJoin: "round" }).addTo(map);
    const dashed = shared.length
      ? L.polyline(shared, { color, weight: 5, dashArray: "8 10", lineCap: "butt" }).addTo(map)
      : null;
    for (const layer of [solid, dashed]) {
      layer?.on("click", () => selectLeg(p.leg));
      layer?.bindTooltip(`${p.leg}区 ${fmtKm(p.officialKm)}`, { sticky: true });
    }

    const kmLayer = L.layerGroup();
    for (const mark of kmMarks(f.geometry.coordinates, p.officialKm)) {
      L.marker(toLatLng(mark.coord), { icon: kmIcon(mark.km, color), keyboard: false })
        .bindPopup(
          `<strong>${p.leg}区 ${mark.km}km地点の目安</strong><br><span class="muted">スタートから ${fmtKm(p.startKm + mark.km)}</span>${googleLinks(mark.coord)}`,
        )
        .addTo(kmLayer);
    }
    state.kmLayers.set(p.leg, kmLayer);

    const coords = f.geometry.coordinates;
    const lineM = cumulativeM(coords).at(-1);
    return { props: p, coords, lineM, casing, solid, dashed, bounds: L.latLngBounds(all) };
  });
  state.legs = legs;

  for (const f of checkpoints) {
    const p = f.properties;
    L.circleMarker(toLatLng(f.geometry.coordinates), {
      radius: 4,
      color: "#57606a",
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1,
    })
      .bindPopup(
        `<strong>${escapeHtml(p.name)}</strong><br><span class="muted">${p.leg}区 · スタートから ${fmtKm(p.km)}</span>${googleLinks(f.geometry.coordinates)}`,
      )
      .addTo(state.checkpointLayer);
  }

  for (const f of stations) {
    const p = f.properties;
    L.marker(toLatLng(f.geometry.coordinates), {
      icon: stationIcon(p),
      title: `${p.title} ${p.name}`,
      zIndexOffset: 1000,
    })
      .bindPopup(stationPopup(p, legs, f.geometry.coordinates))
      .addTo(map);
  }

  renderLegList(
    legs,
    checkpoints.map((f) => f.properties).sort((a, b) => a.km - b.km),
  );

  state.courseBounds = legs.reduce((b, l) => b.extend(l.bounds), L.latLngBounds(legs[0].bounds));
  map.fitBounds(state.courseBounds, { padding: [24, 24] });
  updateCheckpointLayer();
  styleLegs();
}

showAllBtn.addEventListener("click", () => {
  state.selected = null;
  styleLegs();
  if (state.courseBounds) map.fitBounds(state.courseBounds, { padding: [24, 24] });
});
kmToggle.addEventListener("change", updateKmLayer);
checkpointToggle.addEventListener("change", updateCheckpointLayer);
map.on("zoomend", updateKmLayer);

// 全画面: 地図だけを画面いっぱいに出す。iPhone の Safari はページの全画面表示に対応していないので、
// CSS で地図を広げ、対応しているブラウザ（Android・パソコン）ではブラウザの枠も消す。
const ICONS = {
  expand:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  collapse:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
  locate:
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg>',
};

function mapButton(bar, label, onClick) {
  const btn = L.DomUtil.create("button", "", bar);
  btn.type = "button";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  L.DomEvent.on(btn, "click", onClick);
  return btn;
}

const mapButtons = {};
const MapButtons = L.Control.extend({
  options: { position: "topleft" },
  onAdd() {
    const bar = L.DomUtil.create("div", "leaflet-bar map-buttons");
    mapButtons.full = mapButton(bar, "地図を全画面で見る", () => setFull(!isFull()));
    mapButtons.full.innerHTML = ICONS.expand;
    mapButtons.locate = mapButton(bar, "現在地", () => locateBtn.click());
    mapButtons.locate.innerHTML = ICONS.locate;
    mapButtons.locate.setAttribute("aria-pressed", "false");
    L.DomEvent.disableClickPropagation(bar);
    return bar;
  },
});
new MapButtons().addTo(map);

// 全画面のときだけ地図の上に出す、区間の色の凡例と現在地の文
function mapOverlay(className) {
  const el = L.DomUtil.create("div", className, map.getContainer());
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  return el;
}
const legendEl = mapOverlay("map-legend");
legendEl.innerHTML = Object.entries(LEG_COLORS)
  .map(([leg, color]) => `<span style="--leg-color:${color}">${leg}区</span>`)
  .join("");
const mapHereEl = mapOverlay("map-here");
// 地図の上の文から「現在地が出ないとき」へ飛ぶときは、全画面をやめて手順を見せる
mapHereEl.addEventListener("click", (e) => {
  if (e.target.closest('a[href="#locate-help"]')) setFull(false);
});

function setHere(content, { html = false } = {}) {
  for (const el of [hereEl, mapHereEl]) {
    if (html) el.innerHTML = content;
    else el.textContent = content;
  }
}

const isFull = () => document.body.classList.contains("map-full");

function setFull(on) {
  document.body.classList.toggle("map-full", on);
  const label = on ? "全画面をやめる" : "地図を全画面で見る";
  mapButtons.full.innerHTML = on ? ICONS.collapse : ICONS.expand;
  mapButtons.full.title = label;
  mapButtons.full.setAttribute("aria-label", label);
  map.invalidateSize();
  const root = document.documentElement;
  if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// ブラウザ側で全画面が解かれた（Android の戻る・Esc など）ら、地図も元に戻す
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && isFull()) setFull(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isFull()) setFull(false);
});

// 現在地: ボタンを押している間は位置を追い続ける。最初の1回だけ、コースと現在地が両方入るように地図を合わせる。
const tracking = { on: false, fitted: false, accuracy: null, dot: null };

function fmtDistance(m) {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)}km`;
}

// 現在地にいちばん近いコース上の地点を文にする。1区と6区のように同じ道を走る区間はまとめて挙げる。
function describePosition(latlng) {
  const here = [latlng.lng, latlng.lat];
  const near = state.legs
    .map((leg) => ({ leg, ...nearestOnLine(leg.coords, here) }))
    .sort((a, b) => a.distM - b.distM);
  if (!near.length) return "";
  const best = near[0];
  if (best.distM > 1500) {
    return `現在地からコースまで約${fmtDistance(best.distM)}（いちばん近いのは${best.leg.props.leg}区）`;
  }
  const spots = near
    .filter((n) => n.distM <= best.distM + 30)
    .sort((a, b) => a.leg.props.leg - b.leg.props.leg)
    .map((n) => {
      const p = n.leg.props;
      const km = (n.alongM / n.leg.lineM) * p.officialKm;
      const total = p.startKm > 0 ? `（スタートから${fmtKm(p.startKm + km)}）` : "";
      return `${p.leg}区の${fmtKm(km)}地点${total}`;
    });
  return `いちばん近いのは ${spots.join("・")} 付近、コースまで約${fmtDistance(best.distM)}`;
}

function setTrackingButton(on) {
  for (const btn of [locateBtn, mapButtons.locate]) {
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

function stopTracking() {
  map.stopLocate();
  tracking.on = false;
  tracking.accuracy?.remove();
  tracking.dot?.remove();
  tracking.accuracy = tracking.dot = null;
  setTrackingButton(false);
}

locateBtn.addEventListener("click", () => {
  if (tracking.on) {
    stopTracking();
    setHere("");
    return;
  }
  tracking.on = true;
  tracking.fitted = false;
  setTrackingButton(true);
  setHere("現在地を取得しています…");
  map.locate({ watch: true, setView: false, enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
});

map.on("locationfound", (e) => {
  if (!tracking.on) return;
  if (tracking.dot) {
    tracking.accuracy.setLatLng(e.latlng).setRadius(e.accuracy);
    tracking.dot.setLatLng(e.latlng);
  } else {
    tracking.accuracy = L.circle(e.latlng, {
      pane: "here",
      radius: e.accuracy,
      color: "#0969da",
      weight: 1,
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(map);
    tracking.dot = L.circleMarker(e.latlng, {
      pane: "here",
      radius: 8,
      color: "#ffffff",
      weight: 3,
      fillColor: "#0969da",
      fillOpacity: 1,
    })
      .bindPopup("現在地")
      .addTo(map);
  }
  setHere(describePosition(e.latlng));
  if (!tracking.fitted) {
    tracking.fitted = true;
    const leg = state.legs.find((l) => l.props.leg === state.selected);
    const base = leg ? leg.bounds : state.courseBounds;
    const bounds = base ? L.latLngBounds(base.getSouthWest(), base.getNorthEast()).extend(e.latlng) : null;
    if (bounds) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    else map.setView(e.latlng, 15);
  }
});

map.on("locationerror", (e) => {
  if (!tracking.on) return;
  // 一度取れていれば、トンネルなどでの一時的な失敗（取得できない・時間切れ）は無視して追い続ける
  if (tracking.dot && (e.code === 2 || e.code === 3)) return;
  if (e.code === 3) {
    setHere("現在地を取得しています…（時間がかかっています。屋外や窓際だと早く取れます）");
    return;
  }
  stopTracking();
  if (e.code === 1) {
    setHere(
      '位置情報の利用が許可されていません。<a href="#locate-help">現在地が出ないとき</a>の手順で許可してから、もう一度押してください。',
      { html: true },
    );
    locateHelpEl.open = true;
  } else if (e.code === 2) {
    setHere(
      '現在地を取得できませんでした。端末の位置情報サービスがオンになっているか（<a href="#locate-help">現在地が出ないとき</a>）確かめて、もう一度押してください。',
      { html: true },
    );
    locateHelpEl.open = true;
  } else {
    setHere("このブラウザでは現在地を取得できません。");
  }
});

fetch("data/course.geojson")
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(drawCourse)
  .catch((err) => {
    statusEl.textContent = `コースのデータを読み込めませんでした（${err.message}）`;
  });
