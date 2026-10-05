// 4区道路リスク Web版：画面に依存しない計算（iOS 版の Model/*.swift の移植）。
// ブラウザと Node（テスト）の両方から ES モジュールとして読む。

// MARK: - ラベル・出典

export const WIDTH_CLASSES = ['3m未満', '3m〜5.5m', '5.5m〜13m', '13m〜19.5m', '19.5m以上'];
export const TYPES = ['通常部', '庭園路', '徒歩道', '石段'];
export const ROAD_CATEGORIES = ['市区町村道等', '都道府県道', '国道', '高速自動車国道等'];
export const STATES = ['通常部', '橋・高架', 'トンネル'];

function label(table, i) {
  return i >= 0 && i < table.length ? table[i] : `不明(${i})`;
}

export const Labels = {
  width: (w) => label(WIDTH_CLASSES, w),
  type: (t) => label(TYPES, t),
  category: (c) => label(ROAD_CATEGORIES, c),
  state: (s) => label(STATES, s),
  /** 勾配（%×10）を「12.5%」の形に。-1 は対象外 */
  grade: (v) => (v < 0 ? '対象外' : `${(v / 10).toFixed(1)}%`),
  meters: (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${m}m`),
  kilometers: (m) => `${(m / 1000).toFixed(1)}km`,
};

export const DataInfo = {
  widthNotice: '道幅は国土地理院の5段階区分で、実測値ではありません。最終判断は必ず現地確認で行ってください。',
  gsiCredit: '国土地理院ベクトルタイル（道路中心線）・標高タイル（DEM5A）を加工して作成',
  osmCredit: '一方通行・名称・区界は © OpenStreetMap contributors（ODbL）',
  acquisitionDate: 'データ取得日: 2026年10月4日以前（リポジトリ登録日。元データの正確な取得日はファイルに未記録）',
};

// MARK: - 車両・要注意度

export const VEHICLES = [
  { id: 0, name: '軽自動車', widthMeters: 1.48, accessTable: [2, 1, 0, 0, 0] },
  { id: 1, name: '小型バン・普通車', widthMeters: 1.7, accessTable: [3, 1, 0, 0, 0] },
  { id: 2, name: '2t・高所作業車クラス', widthMeters: 1.9, accessTable: [4, 1, 0, 0, 0] },
  { id: 3, name: '中型車', widthMeters: 2.3, accessTable: [4, 2, 0, 0, 0] },
];
export const DEFAULT_VEHICLE = 1;

export function vehicleWidthLabel(v) {
  return `幅約${v.widthMeters.toFixed(2)}m`;
}

export const RISK_LEVELS = ['低', 'やや注意', '注意', '高', '最高'];

/** 合計点から要注意度（0〜4）へ */
export function levelFromScore(score) {
  if (score >= 6) return 4;
  if (score >= 4) return 3;
  if (score >= 2) return 2;
  if (score === 1) return 1;
  return 0;
}

export function access(widthClass, type, vehicle) {
  if (type >= 2) return 4;
  const table = vehicle.accessTable;
  return table[Math.min(Math.max(widthClass, 0), table.length - 1)];
}

export function gradePoints(gm) {
  if (gm >= 120) return 3;
  if (gm >= 90) return 2;
  if (gm >= 60) return 1;
  return 0;
}

export function deadEndPoints(widthClass, type, deadEnd) {
  if (!deadEnd || type >= 2) return 0;
  if (widthClass === 0) return 2;
  if (widthClass === 1) return 1;
  return 0;
}

/** 要注意度だけを求める（描画用。assess と同じ結果） */
export function riskLevel(seg, vehicle) {
  if (seg.type >= 2) return 4;
  return levelFromScore(access(seg.widthClass, seg.type, vehicle)
    + gradePoints(seg.maxGrade)
    + deadEndPoints(seg.widthClass, seg.type, seg.deadEnd));
}

export function assess(seg, vehicle) {
  const a = access(seg.widthClass, seg.type, vehicle);
  const g = gradePoints(seg.maxGrade);
  const d = deadEndPoints(seg.widthClass, seg.type, seg.deadEnd);
  const reasons = [];
  if (seg.type >= 2) {
    reasons.push({ text: `${Labels.type(seg.type)}のため車両は通行できない前提（常に「最高」）`, points: a });
  } else {
    const widthText = Labels.width(seg.widthClass);
    if (a > 0) {
      reasons.push({ text: `道幅${widthText}に${vehicle.name}（${vehicleWidthLabel(vehicle)}）で進入`, points: a });
    } else {
      reasons.push({ text: `道幅${widthText}は${vehicle.name}で問題なし`, points: 0 });
    }
  }
  if (g > 0) reasons.push({ text: `最大勾配 ${Labels.grade(seg.maxGrade)}（30m区間）`, points: g });
  if (d > 0) reasons.push({ text: '行き止まり（狭い道では切り返し・後退が必要）', points: d });
  return { access: a, gradePoints: g, deadEndPoints: d, total: a + g + d, level: riskLevel(seg, vehicle), reasons };
}

// MARK: - 色分け

export const COLOR_MODES = [
  { id: 'risk', title: '要注意度', dependsOnVehicle: true },
  { id: 'width', title: '道幅', dependsOnVehicle: false },
  { id: 'slope', title: '勾配', dependsOnVehicle: false },
];

/** 区分の定義。配列の順が描画順（後ろほど上に重なる） */
export function categories(mode) {
  switch (mode) {
    case 'risk':
      return [
        { id: 0, label: '低', rgb: 0x3a86ff, isAlert: false },
        { id: 1, label: 'やや注意', rgb: 0x2db37a, isAlert: false },
        { id: 2, label: '注意', rgb: 0xf2b705, isAlert: true },
        { id: 3, label: '高', rgb: 0xf06f1d, isAlert: true },
        { id: 4, label: '最高', rgb: 0xd62839, isAlert: true },
      ];
    case 'width':
      // id = 幅員区分。広い道を下に、狭い道を上に描く
      return [
        { id: 4, label: Labels.width(4), rgb: 0x3a86ff, isAlert: false },
        { id: 3, label: Labels.width(3), rgb: 0x00a6a6, isAlert: false },
        { id: 2, label: Labels.width(2), rgb: 0x2db37a, isAlert: false },
        { id: 1, label: Labels.width(1), rgb: 0xf2b705, isAlert: false },
        { id: 0, label: Labels.width(0), rgb: 0xd62839, isAlert: true },
      ];
    case 'slope':
      return [
        { id: 0, label: '対象外（橋・トンネル等）', rgb: 0x9aa0a6, isAlert: false },
        { id: 1, label: '6%未満', rgb: 0x3a86ff, isAlert: false },
        { id: 2, label: '6%〜9%', rgb: 0xf2b705, isAlert: false },
        { id: 3, label: '9%〜12%', rgb: 0xf06f1d, isAlert: true },
        { id: 4, label: '12%以上', rgb: 0xd62839, isAlert: true },
      ];
    default:
      throw new Error(`unknown mode ${mode}`);
  }
}

export function slopeCategory(gm) {
  if (gm < 0) return 0;
  if (gm < 60) return 1;
  if (gm < 90) return 2;
  if (gm < 120) return 3;
  return 4;
}

export function cssColor(rgb) {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

/** 全区間の区分 id */
export function categoryIDs(net, mode, vehicle) {
  const out = new Uint8Array(net.count);
  for (let i = 0; i < net.count; i++) {
    switch (mode) {
      case 'risk': out[i] = riskLevel(segment(net, i), vehicle); break;
      case 'width': out[i] = Math.min(Math.max(net.w[i], 0), 4); break;
      case 'slope': out[i] = slopeCategory(net.gm[i]); break;
      default: throw new Error(`unknown mode ${mode}`);
    }
  }
  return out;
}

/** 区分 id ごとの延長（m）。ward が null なら全区 */
export function lengthByCategory(net, ids, mode, ward) {
  const out = new Map(categories(mode).map((c) => [c.id, 0]));
  for (let i = 0; i < net.count; i++) {
    if (ward !== null && net.ward[i] !== ward) continue;
    out.set(ids[i], (out.get(ids[i]) ?? 0) + net.length[i]);
  }
  return out;
}

// MARK: - 道路網

/** tokyo_north_roads.json（iOS 版と同じファイル）から道路網を作る */
export function buildNetwork(raw) {
  const n = raw.w.length;
  const cols = { c: raw.c, t: raw.t, s: raw.s, gm: raw.gm, ga: raw.ga, L: raw.L, de: raw.de, ow: raw.ow, nm: raw.nm, z: raw.z };
  for (const [key, col] of Object.entries(cols)) {
    if (!Array.isArray(col) || col.length !== n) throw new Error(`${key} の件数が w の件数 ${n} と一致しません`);
  }
  if (!Array.isArray(raw.g) || raw.g.length !== n) throw new Error('g の件数が w の件数と一致しません');
  const sc = raw.meta.sc;
  if (!(sc > 0)) throw new Error('sc が 0 以下です');

  // 差分で書かれた形状を絶対値（メートル）に戻す
  let np = 0;
  for (let i = 0; i < n; i++) {
    const g = raw.g[i];
    if (g.length < 4 || g.length % 2 !== 0) throw new Error(`区間 ${i} の形状の点数が不正です`);
    np += g.length / 2;
  }
  const pointStart = new Uint32Array(n + 1);
  const pointX = new Float64Array(np);
  const pointY = new Float64Array(np);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const g = raw.g[i];
    pointStart[i] = k;
    let x = g[0];
    let y = g[1];
    pointX[k] = x / sc; pointY[k] = y / sc; k++;
    for (let j = 2; j < g.length; j += 2) {
      x += g[j]; y += g[j + 1];
      pointX[k] = x / sc; pointY[k] = y / sc; k++;
    }
  }
  pointStart[n] = k;

  const wards = raw.wards ?? ['練馬区'];
  const ward = raw.wd ?? new Array(n).fill(0);
  const boundaryWard = raw.bdw ?? new Array(raw.bd.length).fill(0);
  if (ward.length !== n || boundaryWard.length !== raw.bd.length) throw new Error('区番号の件数が不正です');
  for (const v of [...ward, ...boundaryWard]) {
    if (!(v >= 0 && v < wards.length)) throw new Error('区番号が区名の表の範囲外です');
  }
  const boundary = raw.bd.map((part) => {
    const pts = [];
    for (let j = 0; j + 1 < part.length; j += 2) pts.push([part[j] / sc, part[j + 1] / sc]);
    return pts;
  });

  return {
    count: n,
    projection: { lat0: raw.meta.lat0, lon0: raw.meta.lon0, mx: raw.meta.mx, my: raw.meta.my },
    w: Int8Array.from(raw.w), c: Int8Array.from(raw.c), t: Int8Array.from(raw.t), s: Int8Array.from(raw.s),
    gm: Int16Array.from(raw.gm), ga: Int16Array.from(raw.ga), length: Int32Array.from(raw.L),
    deadEnd: Uint8Array.from(raw.de), oneWay: Uint8Array.from(raw.ow), nameIndex: Int32Array.from(raw.nm),
    elevation: Int16Array.from(raw.z), names: raw.names.length ? raw.names : [''], wards, ward: Uint8Array.from(ward),
    pointStart, pointX, pointY, boundary, boundaryWard,
  };
}

export function segment(net, i) {
  return { widthClass: net.w[i], type: net.t[i], maxGrade: net.gm[i], deadEnd: net.deadEnd[i] === 1 };
}

export function segmentName(net, i) {
  return net.names[net.nameIndex[i]] ?? '';
}

/** 局所メートル座標 → 緯度経度 */
export function toLatLng(net, x, y) {
  const p = net.projection;
  return { lat: p.lat0 + y / p.my, lng: p.lon0 + x / p.mx };
}

/** 緯度経度 → 局所メートル座標 */
export function toLocal(net, lat, lng) {
  const p = net.projection;
  return { x: (lng - p.lon0) * p.mx, y: (lat - p.lat0) * p.my };
}

export function segmentLatLngs(net, i) {
  const out = [];
  for (let k = net.pointStart[i]; k < net.pointStart[i + 1]; k++) out.push(toLatLng(net, net.pointX[k], net.pointY[k]));
  return out;
}

/** 区番号 w の区界の内側か（偶奇判定） */
export function isInsideWard(net, w, x, y) {
  let inside = false;
  net.boundary.forEach((part, n) => {
    if (net.boundaryWard[n] !== w || part.length < 2) return;
    for (let k = 0; k < part.length - 1; k++) {
      const [ax, ay] = part[k];
      const [bx, by] = part[k + 1];
      if ((ay > y) !== (by > y)) {
        const xi = ax + (y - ay) * (bx - ax) / (by - ay);
        if (x < xi) inside = !inside;
      }
    }
  });
  return inside;
}

/** 点を含む区の番号。どの区の外なら null */
export function wardContaining(net, x, y) {
  for (let w = 0; w < net.wards.length; w++) if (isInsideWard(net, w, x, y)) return w;
  return null;
}

/** 区（null なら全区）の範囲（緯度経度） */
export function wardBounds(net, ward) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  net.boundary.forEach((part, n) => {
    if (ward !== null && net.boundaryWard[n] !== ward) return;
    for (const [x, y] of part) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  });
  const sw = toLatLng(net, minX, minY);
  const ne = toLatLng(net, maxX, maxY);
  return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

// MARK: - Webメルカトル

/** 世界座標（0〜1、左上原点・右と下が＋） */
export function worldPoint(lat, lng) {
  const r = Math.min(Math.max(lat, -85.05112878), 85.05112878) * Math.PI / 180;
  return { x: (lng + 180) / 360, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 };
}

export function tileBounds(x, y, zoom) {
  const n = 2 ** zoom;
  return { minX: x / n, minY: y / n, maxX: (x + 1) / n, maxY: (y + 1) / n };
}

/** 256px タイルの地図で、緯度 lat・ズーム zoom の1ピクセルあたりのメートル */
export function metersPerPixel(lat, zoom) {
  return 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
}

// MARK: - タップした点に最も近い区間（約100mの格子）

/** 東+x・北+y のベクトルの方位（0〜360度未満、北=0、時計回り） */
export function heading(dx, dy) {
  let deg = Math.atan2(dx, dy) * 180 / Math.PI;
  if (deg < 0) deg += 360;
  if (deg >= 360) deg -= 360;
  return deg;
}

export class SegmentIndex {
  constructor(net, cellSize = 100) {
    this.cellSize = cellSize;
    let mnX = Infinity; let mxX = -Infinity; let mnY = Infinity; let mxY = -Infinity;
    for (let k = 0; k < net.pointX.length; k++) {
      mnX = Math.min(mnX, net.pointX[k]); mxX = Math.max(mxX, net.pointX[k]);
      mnY = Math.min(mnY, net.pointY[k]); mxY = Math.max(mxY, net.pointY[k]);
    }
    if (!Number.isFinite(mnX)) { mnX = 0; mxX = 0; mnY = 0; mxY = 0; }
    this.minX = mnX;
    this.minY = mnY;
    this.nx = Math.max(1, Math.floor((mxX - mnX) / cellSize) + 1);
    this.ny = Math.max(1, Math.floor((mxY - mnY) / cellSize) + 1);
    const clamp = (v, n) => Math.min(Math.max(v, 0), n - 1);
    const cells = Array.from({ length: this.nx * this.ny }, () => []);
    for (let i = 0; i < net.count; i++) {
      for (let k = net.pointStart[i]; k < net.pointStart[i + 1] - 1; k++) {
        const x0 = Math.min(net.pointX[k], net.pointX[k + 1]); const x1 = Math.max(net.pointX[k], net.pointX[k + 1]);
        const y0 = Math.min(net.pointY[k], net.pointY[k + 1]); const y1 = Math.max(net.pointY[k], net.pointY[k + 1]);
        const cx0 = clamp(Math.floor((x0 - mnX) / cellSize), this.nx); const cx1 = clamp(Math.floor((x1 - mnX) / cellSize), this.nx);
        const cy0 = clamp(Math.floor((y0 - mnY) / cellSize), this.ny); const cy1 = clamp(Math.floor((y1 - mnY) / cellSize), this.ny);
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const cell = cells[cy * this.nx + cx];
            if (cell[cell.length - 1] !== i) cell.push(i);
          }
        }
      }
    }
    this.cells = cells;
  }

  /** 点 (x, y) から maxDistance 以内で最も近い区間。filter で候補を絞れる */
  nearest(net, x, y, maxDistance, filter = () => true) {
    const cs = this.cellSize;
    const cx0 = Math.floor((x - maxDistance - this.minX) / cs); const cx1 = Math.floor((x + maxDistance - this.minX) / cs);
    const cy0 = Math.floor((y - maxDistance - this.minY) / cs); const cy1 = Math.floor((y + maxDistance - this.minY) / cs);
    if (cx1 < 0 || cy1 < 0 || cx0 >= this.nx || cy0 >= this.ny) return null;
    const seen = new Set();
    let best = null;
    for (let cy = Math.max(cy0, 0); cy <= Math.min(cy1, this.ny - 1); cy++) {
      for (let cx = Math.max(cx0, 0); cx <= Math.min(cx1, this.nx - 1); cx++) {
        for (const i of this.cells[cy * this.nx + cx]) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (!filter(i)) continue;
          const hit = projectToSegment(net, x, y, i);
          if (hit && hit.distance <= maxDistance && hit.distance < (best ? best.distance : Infinity)) best = hit;
        }
      }
    }
    return best;
  }
}

/** 点を区間 i の折れ線へ射影する */
export function projectToSegment(net, x, y, i) {
  const s = net.pointStart[i];
  const e = net.pointStart[i + 1];
  if (e - s < 2) return null;
  let best = null;
  for (let k = s; k < e - 1; k++) {
    const ax = net.pointX[k]; const ay = net.pointY[k];
    const dx = net.pointX[k + 1] - ax; const dy = net.pointY[k + 1] - ay;
    const len2 = dx * dx + dy * dy;
    let u = 0;
    if (len2 > 0) u = Math.min(Math.max(((x - ax) * dx + (y - ay) * dy) / len2, 0), 1);
    const px = ax + u * dx; const py = ay + u * dy;
    const d = Math.hypot(x - px, y - py);
    if (d < (best ? best.distance : Infinity)) {
      const h = len2 > 0 ? heading(dx, dy)
        : (best ? best.heading : heading(net.pointX[e - 1] - net.pointX[s], net.pointY[e - 1] - net.pointY[s]));
      best = { segment: i, distance: d, x: px, y: py, heading: h };
    }
  }
  return best;
}

// MARK: - タイル描画用の世界座標と格子

export class TileGeometry {
  /** 格子の一辺（世界座標）。ズーム15のタイル1枚（練馬あたりで約1km） */
  static cellSize = 1 / 32768;

  constructor(net) {
    this.net = net;
    const np = net.pointX.length;
    this.worldX = new Float64Array(np);
    this.worldY = new Float64Array(np);
    for (let k = 0; k < np; k++) {
      const c = toLatLng(net, net.pointX[k], net.pointY[k]);
      const p = worldPoint(c.lat, c.lng);
      this.worldX[k] = p.x;
      this.worldY[k] = p.y;
    }
    const n = net.count;
    this.minX = new Float64Array(n); this.minY = new Float64Array(n);
    this.maxX = new Float64Array(n); this.maxY = new Float64Array(n);
    let gx0 = Infinity; let gy0 = Infinity; let gx1 = -Infinity; let gy1 = -Infinity;
    for (let i = 0; i < n; i++) {
      let a = Infinity; let b = Infinity; let c = -Infinity; let d = -Infinity;
      for (let k = net.pointStart[i]; k < net.pointStart[i + 1]; k++) {
        a = Math.min(a, this.worldX[k]); b = Math.min(b, this.worldY[k]);
        c = Math.max(c, this.worldX[k]); d = Math.max(d, this.worldY[k]);
      }
      this.minX[i] = a; this.minY[i] = b; this.maxX[i] = c; this.maxY[i] = d;
      gx0 = Math.min(gx0, a); gy0 = Math.min(gy0, b); gx1 = Math.max(gx1, c); gy1 = Math.max(gy1, d);
    }
    this.boundary = net.boundary.map((part) => part.map(([x, y]) => {
      const c = toLatLng(net, x, y);
      const p = worldPoint(c.lat, c.lng);
      return [p.x, p.y];
    }));
    this.boundaryBounds = this.boundary.map((part) => {
      const xs = part.map((p) => p[0]); const ys = part.map((p) => p[1]);
      return xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : [0, 0, 0, 0];
    });

    const s = TileGeometry.cellSize;
    if (!Number.isFinite(gx0)) { gx0 = 0; gy0 = 0; gx1 = 0; gy1 = 0; }
    this.originX = Math.floor(gx0 / s);
    this.originY = Math.floor(gy0 / s);
    this.columns = Math.max(1, Math.floor(gx1 / s) - this.originX + 1);
    this.rows = Math.max(1, Math.floor(gy1 / s) - this.originY + 1);
    const cells = Array.from({ length: this.columns * this.rows }, () => []);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(this.minX[i])) continue;
      const cx0 = Math.floor(this.minX[i] / s) - this.originX; const cx1 = Math.floor(this.maxX[i] / s) - this.originX;
      const cy0 = Math.floor(this.minY[i] / s) - this.originY; const cy1 = Math.floor(this.maxY[i] / s) - this.originY;
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) cells[cy * this.columns + cx].push(i);
    }
    this.cells = cells;
  }

  /** 世界座標の矩形に掛かりうる区間（重複なし） */
  segments(ax, ay, bx, by) {
    const s = TileGeometry.cellSize;
    const cx0 = Math.max(Math.floor(ax / s) - this.originX, 0);
    const cx1 = Math.min(Math.floor(bx / s) - this.originX, this.columns - 1);
    const cy0 = Math.max(Math.floor(ay / s) - this.originY, 0);
    const cy1 = Math.min(Math.floor(by / s) - this.originY, this.rows - 1);
    if (cx0 > cx1 || cy0 > cy1) return [];
    const seen = new Set();
    const out = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const i of this.cells[cy * this.columns + cx]) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (this.maxX[i] >= ax && this.minX[i] <= bx && this.maxY[i] >= ay && this.minY[i] <= by) out.push(i);
        }
      }
    }
    return out;
  }
}

// MARK: - Googleストリートビュー

/** Swift の rounded() と同じく、0.5 は 0 から遠い方へ丸めて 0〜359 にする */
function headingDegrees(h) {
  let v = Math.sign(h) * Math.round(Math.abs(h)) % 360;
  if (v < 0) v += 360;
  return v === 0 ? 0 : v; // -0 を 0 に
}

/** Google マップのストリートビューを開く URL（APIキー不要の Maps URLs） */
export function streetViewLink(lat, lng, h) {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}&heading=${headingDegrees(h)}`;
}

/** Maps Embed API（無料・回数無制限）のストリートビュー URL。Google の地図と同じ画面でだけ使う */
export function streetViewEmbedURL(lat, lng, h, apiKey) {
  const q = new URLSearchParams({
    key: apiKey,
    location: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    heading: String(headingDegrees(h)),
    pitch: '0',
    fov: '90',
    language: 'ja',
  });
  return `https://www.google.com/maps/embed/v1/streetview?${q.toString().replace('%2C', ',')}`;
}
