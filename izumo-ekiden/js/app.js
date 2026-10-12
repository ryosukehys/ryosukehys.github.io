import { kmMarks } from "./geo.js";

const LEG_COLORS = {
  1: "#c62f3c",
  2: "#e67e10",
  3: "#2a9248",
  4: "#1f6fc0",
  5: "#7a4cc2",
  6: "#d1307f",
};
const KM_MARK_MIN_ZOOM = 13;
const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';

const statusEl = document.getElementById("status");
const legsEl = document.getElementById("legs");
const showAllBtn = document.getElementById("show-all");
const kmToggle = document.getElementById("toggle-km");
const checkpointToggle = document.getElementById("toggle-checkpoints");
const locateBtn = document.getElementById("locate");

const map = L.map("map", { zoomControl: true, attributionControl: true }).setView([35.39, 132.75], 12);
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

function stationPopup(props, legs) {
  const arriving = legs.find((l) => l.props.leg === props.order);
  const leaving = legs.find((l) => l.props.leg === props.order + 1);
  const roles = [];
  if (arriving) roles.push(`${arriving.props.leg}区のゴール`);
  if (leaving) roles.push(`${leaving.props.leg}区のスタート`);
  return `
    <strong>${escapeHtml(props.title)}</strong><br>
    ${escapeHtml(props.name)}<br>
    <span class="muted">スタートから ${fmtKm(props.km)}${roles.length ? ` · ${roles.join(" / ")}` : ""}</span>`;
}

const state = {
  legs: [],
  selected: null,
  kmLayer: L.layerGroup(),
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

function updateKmLayer() {
  const visible = kmToggle.checked && map.getZoom() >= KM_MARK_MIN_ZOOM;
  if (visible) state.kmLayer.addTo(map);
  else state.kmLayer.remove();
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

    for (const mark of kmMarks(f.geometry.coordinates, p.officialKm)) {
      L.marker(toLatLng(mark.coord), { icon: kmIcon(mark.km, color), keyboard: false })
        .bindTooltip(`${p.leg}区 ${mark.km}km地点の目安（累計 ${fmtKm(p.startKm + mark.km)}）`)
        .addTo(state.kmLayer);
    }

    return { props: p, casing, solid, dashed, bounds: L.latLngBounds(all) };
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
        `<strong>${escapeHtml(p.name)}</strong><br><span class="muted">${p.leg}区 · スタートから ${fmtKm(p.km)}</span>`,
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
      .bindPopup(stationPopup(p, legs))
      .addTo(map);
  }

  renderLegList(
    legs,
    checkpoints.map((f) => f.properties).sort((a, b) => a.km - b.km),
  );

  state.courseBounds = legs.reduce((b, l) => b.extend(l.bounds), L.latLngBounds(legs[0].bounds));
  map.fitBounds(state.courseBounds, { padding: [24, 24] });
  updateKmLayer();
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

let locationLayer = null;
locateBtn.addEventListener("click", () => {
  statusEl.textContent = "現在地を取得しています…";
  map.locate({ setView: false, enableHighAccuracy: true, timeout: 15000 });
});
map.on("locationfound", (e) => {
  statusEl.textContent = "";
  locationLayer?.remove();
  locationLayer = L.layerGroup([
    L.circle(e.latlng, { radius: e.accuracy, color: "#0969da", weight: 1, fillOpacity: 0.1, interactive: false }),
    L.circleMarker(e.latlng, { radius: 7, color: "#ffffff", weight: 2, fillColor: "#0969da", fillOpacity: 1 }).bindPopup(
      "現在地",
    ),
  ]).addTo(map);
  map.setView(e.latlng, Math.max(map.getZoom(), 15));
});
map.on("locationerror", (e) => {
  statusEl.textContent = `現在地を取得できませんでした（${e.message}）`;
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
