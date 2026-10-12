// 線の長さと、線上の指定した距離の位置を求める。座標は GeoJSON と同じ [経度, 緯度]。

const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg) => (deg * Math.PI) / 180;

export function distanceM([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// 各頂点までの累計距離（m）。先頭は 0。
export function cumulativeM(coords) {
  const out = [0];
  for (let i = 1; i < coords.length; i++) {
    out.push(out[i - 1] + distanceM(coords[i - 1], coords[i]));
  }
  return out;
}

// 線の始点から distance m 進んだ位置。線より長い・短いときは端に寄せる。
export function pointAlong(coords, cum, distance) {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, distance));
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const t = span > 0 ? (d - cum[lo]) / span : 0;
  const [lon1, lat1] = coords[lo];
  const [lon2, lat2] = coords[hi];
  return [lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t];
}

// point にいちばん近い線上の点。distM は線までの距離、alongM は線の始点からその点までの距離（m）。
export function nearestOnLine(coords, point) {
  let best = { distM: Infinity, alongM: 0 };
  let along = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const seg = distanceM(a, b);
    // 1本の辺は短いので、経度を緯度で縮めた平面とみなして射影する
    const kx = Math.cos(toRad(a[1]));
    const dx = (b[0] - a[0]) * kx;
    const dy = b[1] - a[1];
    const px = (point[0] - a[0]) * kx;
    const py = point[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const d = distanceM([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], point);
    if (d < best.distM) best = { distM: d, alongM: along + seg * t };
    along += seg;
  }
  return best;
}

// 区間の k km 地点の目安。線の実測長を公式距離に合わせて按分する。
export function kmMarks(coords, officialKm) {
  const cum = cumulativeM(coords);
  const total = cum[cum.length - 1];
  const marks = [];
  for (let k = 1; k < officialKm - 0.05; k++) {
    marks.push({ km: k, coord: pointAlong(coords, cum, (total * k) / officialKm) });
  }
  return marks;
}
