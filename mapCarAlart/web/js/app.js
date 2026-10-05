// 4区道路リスク Web版の画面。
// 地図は Google（APIキーがあるとき）か国土地理院（キーがない・読み込めないとき）。
// Google の利用規約により、ストリートビューの埋め込みは Google の地図を表示しているときだけ行う。

import * as M from './model.js';
import { drawTile, TileQueue, THINNING_ZOOM } from './tiles.js';

const CONFIG = window.ROADRISK_CONFIG ?? {};
const API_KEY = typeof CONFIG.googleMapsApiKey === 'string' ? CONFIG.googleMapsApiKey.trim() : '';
const STORE_KEY = 'roadrisk.web.v1';
/** タップの許容幅（CSS ピクセル） */
const TAP_TOLERANCE_PX = 22;
const WIDE_QUERY = window.matchMedia('(min-width: 900px)');

const $ = (id) => document.getElementById(id);

// MARK: - 状態

const state = {
  net: null,
  index: null,
  geometry: null,
  ward: null, // null = 4区すべて
  mode: 'risk',
  vehicle: M.DEFAULT_VEHICLE,
  engine: API_KEY ? 'google' : 'gsi',
  selection: null, // { segment, lat, lng, heading }
  pin: null, // 住所検索で選んだ地点 { lat, lng, name }
  idsCache: new Map(),
  map: null,
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    if (s.ward === null || (Number.isInteger(s.ward) && s.ward >= 0 && s.ward < 4)) state.ward = s.ward;
    if (M.COLOR_MODES.some((m) => m.id === s.mode)) state.mode = s.mode;
    if (Number.isInteger(s.vehicle) && M.VEHICLES[s.vehicle]) state.vehicle = s.vehicle;
    if (s.engine === 'gsi') state.engine = 'gsi';
  } catch { /* 保存できない環境では毎回初期値 */ }
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      ward: state.ward, mode: state.mode, vehicle: state.vehicle, engine: API_KEY ? state.engine : undefined,
    }));
  } catch { /* 無視 */ }
}

function vehicle() { return M.VEHICLES[state.vehicle]; }

function categoryIDs() {
  const key = M.COLOR_MODES.find((m) => m.id === state.mode).dependsOnVehicle ? `${state.mode}-${state.vehicle}` : state.mode;
  if (!state.idsCache.has(key)) state.idsCache.set(key, M.categoryIDs(state.net, state.mode, vehicle()));
  return state.idsCache.get(key);
}

function roadStyle() {
  return { geometry: state.geometry, categoryIDs: categoryIDs(), categories: M.categories(state.mode), ward: state.ward };
}

// MARK: - 地図（共通）

const tileQueue = new TileQueue();

/** タイル1枚分の canvas を作り、描画を待ち行列に入れる。done は描き終わり（または中止）で呼ぶ */
function makeTileCanvas(doc, style, x, y, z, done) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.round(256 * dpr);
  const canvas = doc.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = '256px';
  canvas.style.height = '256px';
  const job = {
    cancelled: false,
    run() {
      drawTile(canvas.getContext('2d'), style, x, y, z, size);
      done?.();
    },
  };
  canvas.rrJob = job;
  tileQueue.push(job);
  return canvas;
}

function outerBounds() {
  const b = M.wardBounds(state.net, null);
  const padLat = (b.north - b.south) * 0.4;
  const padLng = (b.east - b.west) * 0.4;
  return { south: b.south - padLat, west: b.west - padLng, north: b.north + padLat, east: b.east + padLng };
}

/** 撮影地点（青い点）と道の向き（水色の線）の印 */
function viewpointElement() {
  const el = document.createElement('div');
  el.className = 'viewpoint';
  el.innerHTML = '<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">'
    + '<line x1="32" y1="4" x2="32" y2="60" stroke="rgba(50,173,230,0.9)" stroke-width="4" stroke-linecap="round"/>'
    + '<circle cx="32" cy="32" r="8" fill="#fff"/><circle cx="32" cy="32" r="5.5" fill="#007aff"/></svg>';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '撮影地点と道の向き');
  return el;
}

function userElement() {
  const el = document.createElement('div');
  el.className = 'user-dot';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', '現在地');
  return el;
}

/** 住所検索で選んだ地点の印 */
function pinElement(title) {
  const el = document.createElement('div');
  el.className = 'search-pin';
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `検索した地点：${title}`);
  el.title = title;
  return el;
}

// MARK: - 国土地理院の地図（Leaflet）

let leafletLoading = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  leafletLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/leaflet/leaflet.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Leaflet を読み込めませんでした'));
    document.head.appendChild(s);
  });
  return leafletLoading;
}

class GsiMap {
  constructor(el, handlers) {
    const L = window.L;
    const outer = outerBounds();
    this.map = L.map(el, {
      minZoom: 11,
      maxZoom: 19,
      // 区全体がちょうど収まるよう、拡大率を 0.25 刻みにする
      zoomSnap: 0.25,
      maxBounds: [[outer.south, outer.west], [outer.north, outer.east]],
      maxBoundsViscosity: 0.8,
      zoomControl: true,
    });
    this.map.attributionControl.setPrefix(false);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
      minZoom: 5,
      maxNativeZoom: 18,
      maxZoom: 19,
    }).addTo(this.map);
    this.map.on('click', (e) => handlers.onClick(e.latlng.lat, e.latlng.lng));
    this.map.on('zoomend', () => handlers.onZoom(this.map.getZoom()));
    this.roads = null;
    this.selectionLine = null;
    this.viewpoint = null;
    this.user = null;
    this.pin = null;
  }

  fit(b) { this.map.fitBounds([[b.south, b.west], [b.north, b.east]], { animate: false }); }

  zoom() { return this.map.getZoom(); }

  setRoads(style) {
    const L = window.L;
    const layer = new L.GridLayer({ tileSize: 256, minZoom: 5, maxZoom: 19, zIndex: 5 });
    layer.createTile = (coords, done) => {
      const tile = makeTileCanvas(document, style, coords.x, coords.y, coords.z, () => done(null, tile));
      return tile;
    };
    layer.on('tileunload', (e) => { if (e.tile.rrJob) e.tile.rrJob.cancelled = true; });
    if (this.roads) this.map.removeLayer(this.roads);
    layer.addTo(this.map);
    this.roads = layer;
  }

  setSelection(sel, latlngs) {
    const L = window.L;
    if (this.selectionLine) this.map.removeLayer(this.selectionLine);
    if (this.viewpoint) this.map.removeLayer(this.viewpoint);
    this.selectionLine = null;
    this.viewpoint = null;
    if (!sel) return;
    this.selectionLine = L.polyline(latlngs.map((c) => [c.lat, c.lng]), {
      color: '#32ade6', opacity: 0.55, weight: 12, interactive: false,
    }).addTo(this.map);
    const el = viewpointElement();
    el.style.transform = `rotate(${sel.heading}deg)`;
    this.viewpoint = L.marker([sel.lat, sel.lng], {
      icon: L.divIcon({ html: el, className: 'viewpoint-icon', iconSize: [64, 64], iconAnchor: [32, 32] }),
      interactive: false,
      keyboard: false,
    }).addTo(this.map);
  }

  showUser(lat, lng) {
    const L = window.L;
    if (this.user) this.map.removeLayer(this.user);
    this.user = L.marker([lat, lng], {
      icon: L.divIcon({ html: userElement(), className: 'user-icon', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false,
      keyboard: false,
    }).addTo(this.map);
    this.map.setView([lat, lng], Math.max(this.map.getZoom(), 16));
  }

  showPin(pin) {
    const L = window.L;
    if (this.pin) this.map.removeLayer(this.pin);
    this.pin = null;
    if (!pin) return;
    this.pin = L.marker([pin.lat, pin.lng], {
      icon: L.divIcon({ html: pinElement(pin.name), className: 'pin-icon', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
      keyboard: false,
    }).addTo(this.map);
  }

  setView(lat, lng, zoom) { this.map.setView([lat, lng], zoom, { animate: false }); }

  /** 画面（ビューポート）上の位置 */
  clientPoint(lat, lng) {
    const p = this.map.latLngToContainerPoint([lat, lng]);
    const r = this.map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  panBy(dx, dy) { this.map.panBy([dx, dy]); }

  invalidate() { this.map.invalidateSize(); }

  destroy() { this.map.remove(); }
}

// MARK: - Google の地図

let googleLoading = null;
let onGoogleAuthFailure = () => {};
function loadGoogle() {
  googleLoading ??= new Promise((resolve, reject) => {
    // キーの制限・請求設定・上限などで使えないと、Google が呼ぶ
    window.gm_authFailure = () => onGoogleAuthFailure();
    window.rrGoogleReady = () => resolve();
    const s = document.createElement('script');
    const q = new URLSearchParams({ key: API_KEY, language: 'ja', region: 'JP', v: 'weekly', loading: 'async', callback: 'rrGoogleReady' });
    s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps を読み込めませんでした'));
    document.head.appendChild(s);
    setTimeout(() => reject(new Error('Google Maps の読み込みが時間切れになりました')), 15000);
  });
  return googleLoading;
}

/** 地図を落ち着いた色にし、店などの印を消す（iOS 版と同じ） */
const GOOGLE_STYLES = [
  { stylers: [{ saturation: -55 }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];

class GoogleMap {
  constructor(el, handlers) {
    const g = window.google.maps;
    const outer = outerBounds();
    this.map = new g.Map(el, {
      center: { lat: 35.745, lng: 139.68 },
      zoom: 13,
      minZoom: 11,
      maxZoom: 20,
      styles: GOOGLE_STYLES,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      restriction: { latLngBounds: outer, strictBounds: false },
    });
    this.map.addListener('click', (e) => { if (e.latLng) handlers.onClick(e.latLng.lat(), e.latLng.lng()); });
    this.map.addListener('zoom_changed', () => handlers.onZoom(this.map.getZoom()));

    // 地図上の HTML の印（撮影地点・現在地）と、画面上の位置を求めるための重ね合わせ
    class HtmlMarker extends g.OverlayView {
      constructor(content, position) {
        super();
        this.content = content;
        this.position = position;
        this.content.style.position = 'absolute';
      }

      onAdd() { this.getPanes().overlayLayer.appendChild(this.content); }

      draw() {
        const p = this.getProjection()?.fromLatLngToDivPixel(new g.LatLng(this.position));
        if (!p) return;
        this.content.style.left = `${p.x}px`;
        this.content.style.top = `${p.y}px`;
      }

      onRemove() { this.content.remove(); }
    }
    this.HtmlMarker = HtmlMarker;
    this.projector = new g.OverlayView();
    this.projector.onAdd = () => {};
    this.projector.draw = () => {};
    this.projector.onRemove = () => {};
    this.projector.setMap(this.map);
    this.selectionLine = null;
    this.viewpoint = null;
    this.user = null;
    this.pin = null;
  }

  fit(b) { this.map.fitBounds({ south: b.south, west: b.west, north: b.north, east: b.east }, 0); }

  zoom() { return this.map.getZoom() ?? 13; }

  setRoads(style) {
    const g = window.google.maps;
    const mapType = {
      tileSize: new g.Size(256, 256),
      maxZoom: 22,
      minZoom: 0,
      name: '道路',
      getTile(coord, zoom, doc) {
        const n = 2 ** zoom;
        const x = ((coord.x % n) + n) % n;
        return makeTileCanvas(doc, style, x, coord.y, zoom);
      },
      releaseTile(tile) { if (tile.rrJob) tile.rrJob.cancelled = true; },
    };
    this.map.overlayMapTypes.clear();
    this.map.overlayMapTypes.push(mapType);
  }

  setSelection(sel, latlngs) {
    const g = window.google.maps;
    this.selectionLine?.setMap(null);
    this.viewpoint?.setMap(null);
    this.selectionLine = null;
    this.viewpoint = null;
    if (!sel) return;
    this.selectionLine = new g.Polyline({
      path: latlngs,
      strokeColor: '#32ade6',
      strokeOpacity: 0.55,
      strokeWeight: 12,
      clickable: false,
      map: this.map,
    });
    const el = viewpointElement();
    el.style.transform = `translate(-50%, -50%) rotate(${sel.heading}deg)`;
    this.viewpoint = new this.HtmlMarker(el, { lat: sel.lat, lng: sel.lng });
    this.viewpoint.setMap(this.map);
  }

  showUser(lat, lng) {
    this.user?.setMap(null);
    const el = userElement();
    el.style.transform = 'translate(-50%, -50%)';
    this.user = new this.HtmlMarker(el, { lat, lng });
    this.user.setMap(this.map);
    this.map.setZoom(Math.max(this.zoom(), 16));
    this.map.panTo({ lat, lng });
  }

  showPin(pin) {
    this.pin?.setMap(null);
    this.pin = null;
    if (!pin) return;
    const el = pinElement(pin.name);
    el.style.transform = 'translate(-50%, -50%)';
    this.pin = new this.HtmlMarker(el, { lat: pin.lat, lng: pin.lng });
    this.pin.setMap(this.map);
  }

  setView(lat, lng, zoom) {
    this.map.setZoom(zoom);
    this.map.setCenter({ lat, lng });
  }

  clientPoint(lat, lng) {
    const proj = this.projector.getProjection();
    if (!proj) return null;
    const p = proj.fromLatLngToContainerPixel(new window.google.maps.LatLng(lat, lng));
    const r = this.map.getDiv().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  }

  panBy(dx, dy) { this.map.panBy(dx, dy); }

  invalidate() {}

  destroy() {
    this.map.overlayMapTypes.clear();
    window.google.maps.event.clearInstanceListeners(this.map);
  }
}

// MARK: - 地図の作成・切り替え

const mapHandlers = {
  onClick: (lat, lng) => handleTap(lat, lng),
  // 地理院の地図は拡大率が 0.25 刻み。タイルは四捨五入したズームで描かれる
  onZoom: (z) => updateThinnedChip(Math.round(z)),
};

async function createMap() {
  const host = $('map');
  if (state.map) {
    state.map.destroy();
    state.map = null;
  }
  host.replaceChildren();
  const el = document.createElement('div');
  el.className = 'map-canvas';
  host.appendChild(el);

  if (state.engine === 'google' && API_KEY) {
    try {
      await loadGoogle();
      state.map = new GoogleMap(el, mapHandlers);
    } catch (e) {
      console.warn(e);
      toast('Google の地図を読み込めなかったため、国土地理院の地図に切り替えました。ストリートビューは Google マップで開きます。');
      state.engine = 'gsi';
      return createMap();
    }
  } else {
    await loadLeaflet();
    state.map = new GsiMap(el, mapHandlers);
  }
  state.map.fit(M.wardBounds(state.net, state.ward));
  state.map.setRoads(roadStyle());
  if (state.selection) state.map.setSelection(state.selection, M.segmentLatLngs(state.net, state.selection.segment));
  state.map.showPin(state.pin);
  updateThinnedChip(Math.round(state.map.zoom()));
  document.body.dataset.engine = state.engine;
  renderLegend();
  renderCard();
}

onGoogleAuthFailure = () => {
  if (state.engine !== 'google') return;
  toast('Google の地図が使えない状態のため（APIキーの設定・1日の上限など）、国土地理院の地図に切り替えました。');
  state.engine = 'gsi';
  createMap();
};

// MARK: - 操作

function handleTap(lat, lng) {
  const net = state.net;
  const p = M.toLocal(net, lat, lng);
  const tolerance = TAP_TOLERANCE_PX * M.metersPerPixel(lat, state.map.zoom());
  const hit = state.index.nearest(net, p.x, p.y, tolerance, (i) => state.ward === null || net.ward[i] === state.ward);
  if (!hit) {
    select(null);
    return;
  }
  const c = M.toLatLng(net, hit.x, hit.y);
  select({ segment: hit.segment, lat: c.lat, lng: c.lng, heading: hit.heading });
}

function select(sel) {
  state.selection = sel;
  state.map.setSelection(sel, sel ? M.segmentLatLngs(state.net, sel.segment) : []);
  renderCard();
  if (sel) requestAnimationFrame(() => revealSelection(sel));
  else requestAnimationFrame(() => state.map.invalidate());
}

/** カルテを開くと地図が縮むので、選んだ地点が地図の外や端に来たら、地図の中ほどへずらす */
function revealSelection(sel) {
  state.map.invalidate();
  const p = state.map.clientPoint(sel.lat, sel.lng);
  if (!p) return;
  const r = $('map').getBoundingClientRect();
  const m = 40;
  const dx = p.x < r.left + m || p.x > r.right - m ? p.x - (r.left + r.width / 2) : 0;
  const dy = p.y < r.top + m || p.y > r.bottom - m ? p.y - (r.top + r.height / 2) : 0;
  if (dx || dy) state.map.panBy(dx, dy);
}

function setWard(w) {
  state.ward = w;
  saveSettings();
  if (state.selection && w !== null && state.net.ward[state.selection.segment] !== w) select(null);
  state.map.fit(M.wardBounds(state.net, w));
  state.map.setRoads(roadStyle());
  renderLegend();
}

function setMode(mode) {
  state.mode = mode;
  saveSettings();
  state.map.setRoads(roadStyle());
  renderControls();
  renderLegend();
}

function setVehicle(v) {
  state.vehicle = v;
  saveSettings();
  if (state.mode === 'risk') state.map.setRoads(roadStyle());
  renderLegend();
  renderCard();
}

function locate() {
  if (!navigator.geolocation) {
    toast('このブラウザでは現在地を使えません。');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => state.map.showUser(pos.coords.latitude, pos.coords.longitude),
    (err) => toast(err.code === err.PERMISSION_DENIED
      ? '位置情報が許可されていません。ブラウザの設定で、このサイトの位置情報を許可してください。'
      : '現在地を取得できませんでした。'),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
  );
}

// MARK: - 住所検索

const search = { seq: 0, noticedFallback: false };

const GEOCODER_MESSAGES = {
  OVER_QUERY_LIMIT: '今日の検索回数の上限に達しました',
  REQUEST_DENIED: 'APIキーで住所検索（Geocoding API）が許可されていません',
  INVALID_REQUEST: '検索の言葉が正しくありません',
  UNKNOWN_ERROR: 'Google のサーバーでエラーが起きました',
};

/** Google の住所検索（Google の地図のときだけ。Google の規約上、結果は Google の地図に載せる） */
function googleSearch(query) {
  const g = window.google.maps;
  return new Promise((resolve, reject) => {
    const request = {
      address: M.googleSearchQuery(state.net, query, state.ward),
      bounds: M.wardBounds(state.net, state.ward),
      region: 'jp',
      componentRestrictions: { country: 'JP' },
    };
    const done = (results, status) => {
      if (status === 'OK') {
        resolve(M.placesInArea(state.net, results.map((r) => ({
          name: M.googleDisplayName(r.formatted_address),
          lat: r.geometry.location.lat(),
          lng: r.geometry.location.lng(),
          source: 'google',
        })), state.ward));
      } else if (status === 'ZERO_RESULTS') {
        resolve([]);
      } else {
        reject(new Error(GEOCODER_MESSAGES[status] ?? status));
      }
    };
    // 新しい版は Promise も返す。失敗をコールバックで扱うので、Promise 側の失敗は握りつぶす
    new g.Geocoder().geocode(request, done)?.catch?.(() => {});
  });
}

/** 国土地理院の住所検索（キー不要・無料。住所・地名で探す。施設名は探せない） */
async function gsiSearch(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(M.gsiSearchURL(M.gsiSearchQuery(state.net, query, state.ward)), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`国土地理院の住所検索が応答しませんでした（HTTP ${res.status}）`);
    return M.placesInArea(state.net, M.parseGSISearch(await res.json()), state.ward).map((p) => ({ ...p, source: 'gsi' }));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('国土地理院の住所検索が時間切れになりました');
    if (e instanceof TypeError) throw new Error('国土地理院の住所検索に接続できませんでした');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function runSearch(query) {
  const q = query.trim();
  if (!q) return;
  const seq = ++search.seq;
  showResults({ loading: true });
  let results;
  let note = '';
  try {
    if (state.engine === 'google' && window.google?.maps?.Geocoder) {
      try {
        results = await googleSearch(q);
      } catch (e) {
        // 上限・キーの設定などで Google が使えないときは、国土地理院の住所検索で探す
        console.warn(e);
        results = await gsiSearch(q);
        if (!search.noticedFallback) {
          search.noticedFallback = true;
          note = `Google の住所検索が使えないため（${e.message}）、${M.GSI_SEARCH_CREDIT}で探しました。`;
        }
      }
    } else {
      results = await gsiSearch(q);
    }
  } catch (e) {
    if (seq === search.seq) showResults({ error: `検索できませんでした（${e.message}）。` });
    return;
  }
  if (seq === search.seq) showResults({ results, query: q, note });
}

function showResults(view) {
  const box = $('results');
  box.replaceChildren();
  box.hidden = false;
  const head = el('div', { class: 'results-head' },
    el('span', { text: view.loading ? '検索中…' : '検索結果' }),
    el('button', { type: 'button', class: 'close small', 'aria-label': '検索結果を閉じる', text: '×', onclick: () => { box.hidden = true; } }));
  box.append(head);
  if (view.loading) return;
  if (view.error) {
    box.append(el('p', { class: 'results-msg', text: view.error }));
    return;
  }
  if (view.note) box.append(el('p', { class: 'results-msg', text: view.note }));
  if (!view.results.length) {
    box.append(el('p', { class: 'results-msg', text: `${areaName()}の範囲で「${view.query}」は見つかりませんでした。住所や地名で探してください。` }));
    return;
  }
  const list = el('ul', { class: 'results-list' });
  for (const r of view.results) {
    const sub = r.source === 'gsi' ? `${r.wardName}・${M.GSI_SEARCH_CREDIT}` : r.wardName;
    list.append(el('li', {}, el('button', { type: 'button', onclick: () => chooseResult(r) },
      el('span', { class: 'result-name', text: r.name }),
      el('small', { text: sub }))));
  }
  box.append(list);
}

/** 検索結果を選ぶ。印を立てて地図を寄せ、近くの車道のカルテを開く */
function chooseResult(r) {
  $('results').hidden = true;
  $('search-input').blur();
  state.pin = { lat: r.lat, lng: r.lng, name: r.name };
  state.map.showPin(state.pin);
  state.map.setView(r.lat, r.lng, 17);
  const hit = M.snapToRoadway(state.net, state.index, r.lat, r.lng, state.ward);
  if (!hit) {
    select(null);
    toast(`検索した地点から${M.SEARCH_SNAP_METERS}m以内に車道が見つかりませんでした。`);
    return;
  }
  const c = M.toLatLng(state.net, hit.x, hit.y);
  select({ segment: hit.segment, lat: c.lat, lng: c.lng, heading: hit.heading });
}

function clearSearch() {
  search.seq++;
  $('results').hidden = true;
  state.pin = null;
  state.map?.showPin(null);
}

// MARK: - 表示

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c != null) e.append(c);
  return e;
}

function renderControls() {
  const ward = $('ward');
  ward.value = state.ward === null ? 'all' : String(state.ward);
  $('vehicle').value = String(state.vehicle);
  for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode));
}

function buildControls() {
  const ward = $('ward');
  ward.append(el('option', { value: 'all', text: '4区すべて' }));
  state.net.wards.forEach((name, i) => ward.append(el('option', { value: String(i), text: name })));
  ward.addEventListener('change', () => setWard(ward.value === 'all' ? null : Number(ward.value)));

  const veh = $('vehicle');
  M.VEHICLES.forEach((v) => veh.append(el('option', { value: String(v.id), text: v.name })));
  veh.addEventListener('change', () => setVehicle(Number(veh.value)));

  const mode = $('mode');
  M.COLOR_MODES.forEach((m) => mode.append(el('button', { type: 'button', 'data-mode': m.id, text: m.title, onclick: () => setMode(m.id) })));

  $('search').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch($('search-input').value);
  });
  $('search-input').addEventListener('input', (e) => { if (e.target.value === '') clearSearch(); });

  $('btn-locate').addEventListener('click', locate);
  $('btn-legend').addEventListener('click', () => $('legend').showModal());
  $('btn-credits').addEventListener('click', () => $('legend').showModal());
  $('legend-close').addEventListener('click', () => $('legend').close());
  $('card-close').addEventListener('click', () => select(null));
  $('sv-full-close').addEventListener('click', closeFullStreetView);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('sv-full').hidden) closeFullStreetView();
    else if (!$('results').hidden) $('results').hidden = true;
    else if (state.selection && !$('legend').open) select(null);
  });
  renderControls();
}

function updateThinnedChip(zoom) {
  $('thinned').hidden = !(zoom < THINNING_ZOOM);
}

function areaName() {
  return state.ward === null ? state.net.wards.join('・') : state.net.wards[state.ward];
}

function renderLegend() {
  const mode = M.COLOR_MODES.find((m) => m.id === state.mode);
  const ids = categoryIDs();
  const lengths = M.lengthByCategory(state.net, ids, state.mode, state.ward);
  $('legend-title').textContent = mode.dependsOnVehicle
    ? `${mode.title}（${vehicle().name}／${areaName()}）`
    : `${mode.title}（${areaName()}）`;
  const list = $('legend-list');
  list.replaceChildren();
  for (const cat of [...M.categories(state.mode)].reverse()) {
    list.append(el('li', {},
      el('span', { class: 'swatch', style: `background:${M.cssColor(cat.rgb)}` }),
      el('span', { class: 'cat-label', text: cat.label }),
      cat.isAlert ? null : el('span', { class: 'cat-note', text: '縮小時は非表示' }),
      el('span', { class: 'cat-km', text: M.Labels.kilometers(lengths.get(cat.id) ?? 0) })));
  }
  const total = [...lengths.values()].reduce((a, b) => a + b, 0);
  list.append(el('li', { class: 'total' }, el('span', { class: 'cat-label', text: '合計' }),
    el('span', { class: 'cat-km', text: M.Labels.kilometers(total) })));

  const engine = $('engine');
  engine.replaceChildren();
  if (API_KEY) {
    engine.append(el('p', { text: state.engine === 'google'
      ? '地図：Google（区間カルテにストリートビューを表示）'
      : '地図：国土地理院（ストリートビューは Google マップで開く）' }));
    const other = state.engine === 'google' ? 'gsi' : 'google';
    engine.append(el('button', {
      type: 'button',
      class: 'secondary',
      text: other === 'google' ? 'Google の地図に切り替える' : '国土地理院の地図に切り替える',
      onclick: () => {
        state.engine = other;
        saveSettings();
        $('legend').close();
        createMap();
      },
    }));
  } else {
    engine.append(el('p', { text: '地図：国土地理院（ストリートビューは Google マップで開く）' }));
  }
}

function streetViewSection(sel) {
  const wrap = el('div', { class: 'sv' });
  if (state.engine === 'google' && API_KEY) {
    const src = M.streetViewEmbedURL(sel.lat, sel.lng, sel.heading, API_KEY);
    wrap.append(el('iframe', {
      class: 'sv-frame',
      src,
      title: 'Googleストリートビュー',
      loading: 'lazy',
      allowfullscreen: '',
      referrerpolicy: 'strict-origin-when-cross-origin',
    }));
    wrap.append(el('button', { type: 'button', class: 'secondary wide', text: '大きく表示', onclick: () => openFullStreetView(src) }));
    wrap.append(el('p', { class: 'footnote', text: '地図の青い点が撮影地点、水色の線が道の向きです。ストリートビューは道の向きで開きます。画像の中を歩くと地図の印とはずれます。' }));
  } else {
    wrap.append(el('div', { class: 'sv-placeholder' },
      el('p', { text: 'ストリートビューは Google の地図を表示しているときだけ、ここに表示します（Google の利用規約により、他社の地図と同じ画面には出せません）。' })));
    wrap.append(el('a', {
      class: 'button wide',
      href: M.streetViewLink(sel.lat, sel.lng, sel.heading),
      target: '_blank',
      rel: 'noopener',
      text: 'Googleストリートビューで開く',
    }));
    wrap.append(el('p', { class: 'footnote', text: '地図の青い点が撮影地点、水色の線が道の向きです。Googleストリートビューは道の向きで開きます。' }));
  }
  return wrap;
}

function renderCard() {
  const card = $('card');
  const sel = state.selection;
  document.body.classList.toggle('card-open', Boolean(sel));
  if (!sel) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const net = state.net;
  const i = sel.segment;
  const v = vehicle();
  const a = M.assess(M.segment(net, i), v);
  const cat = M.categories('risk').find((c) => c.id === a.level);
  $('card-bar').style.background = M.cssColor(cat.rgb);
  $('card-level').textContent = `要注意度：${M.RISK_LEVELS[a.level]}`;
  $('card-vehicle').textContent = `${v.name}（${M.vehicleWidthLabel(v)}）の場合`;

  const body = $('card-body');
  body.replaceChildren();
  body.append(streetViewSection(sel));

  const reasons = el('ul', { class: 'rows' });
  for (const r of a.reasons) reasons.append(el('li', {}, el('span', { text: r.text }), el('span', { class: 'num', text: `+${r.points}` })));
  if (net.t[i] < 2) reasons.append(el('li', { class: 'total' }, el('span', { text: '合計' }), el('span', { class: 'num', text: `${a.total}点` })));
  body.append(el('section', {},
    el('h3', { text: '判定理由' }), reasons,
    el('p', { class: 'footnote', text: '合計6点以上「最高」・4〜5点「高」・2〜3点「注意」・1点「やや注意」・0点「低」' })));

  const gradeText = (v2) => (v2 < 0 ? '対象外（橋・高架・トンネル・立体交差など）' : M.Labels.grade(v2));
  const ga = net.ga[i];
  const avg = ga < 0 ? gradeText(ga) : (net.length[i] < 20 ? `${M.Labels.grade(ga)}（短い区間のため参考値）` : M.Labels.grade(ga));
  const name = M.segmentName(net, i);
  const info = [
    ['区', net.wards[net.ward[i]] ?? ''],
    ['名称', name || '（名称なし）'],
    ['道幅区分', M.Labels.width(net.w[i])],
    ['最大勾配', gradeText(net.gm[i])],
    ['平均勾配', avg],
    ['長さ', M.Labels.meters(net.length[i])],
    ['標高', net.elevation[i] < 0 ? '不明（標高データ欠測）' : `約${net.elevation[i]}m（区間平均）`],
    ['種別', M.Labels.type(net.t[i])],
    ['道路種別', M.Labels.category(net.c[i])],
    ['構造', M.Labels.state(net.s[i])],
    ['行き止まり', net.deadEnd[i] === 1 ? 'はい' : 'いいえ'],
    ['一方通行（OSM）', net.oneWay[i] === 1 ? 'あり' : '情報なし'],
  ];
  const rows = el('ul', { class: 'rows info' });
  for (const [k, val] of info) rows.append(el('li', {}, el('span', { class: 'key', text: k }), el('span', { text: val })));
  body.append(el('section', {}, el('h3', { text: '区間の情報' }), rows));
  body.append(el('p', { class: 'notice-text', text: M.DataInfo.widthNotice }));
  body.scrollTop = 0;
}

function openFullStreetView(src) {
  const frame = $('sv-full-frame');
  frame.src = src;
  $('sv-full').hidden = false;
  $('sv-full-close').focus();
}

function closeFullStreetView() {
  $('sv-full').hidden = true;
  $('sv-full-frame').src = 'about:blank';
}

let toastTimer = 0;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// MARK: - 起動

async function main() {
  loadSettings();
  try {
    const res = await fetch('data/tokyo_north_roads.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    state.net = M.buildNetwork(raw);
    state.index = new M.SegmentIndex(state.net);
    state.geometry = new M.TileGeometry(state.net);
  } catch (e) {
    console.error(e);
    $('loading').textContent = `道路データを読み込めませんでした（${e.message}）。再読み込みしてください。`;
    return;
  }
  buildControls();
  await createMap();
  $('loading').hidden = true;
  WIDE_QUERY.addEventListener('change', () => state.map?.invalidate());
}

main();
