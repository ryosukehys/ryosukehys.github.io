// 道路を区分ごとの色でタイル（canvas）に描く。iOS 版の RoadTileLayer.tileFor と同じ描き方。
// Google の地図にも国土地理院の地図（Leaflet）にも、同じ関数で描いたタイルを重ねる。

import { tileBounds, cssColor } from './model.js';

/** これより小さいズームでは要注意の区分だけ描く */
export const THINNING_ZOOM = 13;

/**
 * タイル (x, y, z) を ctx に描く。ctx は sizePx 四方の canvas（タイル1枚は 256 CSS ピクセル）。
 * style = { geometry, categoryIDs, categories, ward }。何も描かなければ false。
 */
export function drawTile(ctx, style, x, y, z, sizePx) {
  const { geometry, categoryIDs, categories, ward } = style;
  const b = tileBounds(x, y, z);
  // 世界座標1あたりのピクセル数と、CSS ピクセル→canvas ピクセルの倍率
  const scale = sizePx * 2 ** z;
  const pxPerPt = sizePx / 256;
  const thinned = z < THINNING_ZOOM;
  // 線の太さ分だけ広く拾う
  const margin = 4 * pxPerPt / scale;
  const net = geometry.net;
  const candidates = geometry.segments(b.minX - margin, b.minY - margin, b.maxX + margin, b.maxY + margin)
    .filter((i) => ward === null || net.ward[i] === ward);
  const boundaryParts = [];
  geometry.boundary.forEach((_, n) => {
    const bb = geometry.boundaryBounds[n];
    if ((ward === null || net.boundaryWard[n] === ward)
      && bb[2] >= b.minX && bb[0] <= b.maxX && bb[3] >= b.minY && bb[1] <= b.maxY) boundaryParts.push(n);
  });
  if (candidates.length === 0 && boundaryParts.length === 0) return false;

  const px = (wx) => (wx - b.minX) * scale;
  const py = (wy) => (wy - b.minY) * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 区界（道路より下）
  if (boundaryParts.length) {
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.55)';
    ctx.lineWidth = 2 * pxPerPt;
    ctx.setLineDash([6 * pxPerPt, 4 * pxPerPt]);
    ctx.beginPath();
    for (const n of boundaryParts) {
      const part = geometry.boundary[n];
      if (!part.length) continue;
      ctx.moveTo(px(part[0][0]), py(part[0][1]));
      for (let k = 1; k < part.length; k++) ctx.lineTo(px(part[k][0]), py(part[k][1]));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const byCategory = new Map();
  for (const i of candidates) {
    const id = categoryIDs[i];
    if (!byCategory.has(id)) byCategory.set(id, []);
    byCategory.get(id).push(i);
  }
  for (const cat of categories) {
    const segs = byCategory.get(cat.id);
    if (!segs || (thinned && !cat.isAlert)) continue;
    ctx.beginPath();
    for (const i of segs) {
      const s = net.pointStart[i];
      const e = net.pointStart[i + 1];
      ctx.moveTo(px(geometry.worldX[s]), py(geometry.worldY[s]));
      for (let k = s + 1; k < e; k++) ctx.lineTo(px(geometry.worldX[k]), py(geometry.worldY[k]));
    }
    ctx.strokeStyle = cssColor(cat.rgb);
    ctx.lineWidth = (cat.isAlert ? 3.5 : 2.5) * pxPerPt;
    ctx.stroke();
  }
  return true;
}

/**
 * タイルの描画を少しずつ進める待ち行列。一度に全部描くと地図の操作が止まるので、
 * 1回あたり約8ミリ秒ずつ描いて、残りは次の機会に回す。
 */
export class TileQueue {
  constructor() {
    this.jobs = [];
    this.scheduled = false;
  }

  push(job) {
    this.jobs.push(job);
    this.schedule();
  }

  /** style が古くなったタイルや、地図から外れたタイルは描かずに捨てる */
  cancel(pred) {
    this.jobs = this.jobs.filter((j) => !pred(j));
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => this.run(), 0);
  }

  run() {
    this.scheduled = false;
    const start = performance.now();
    while (this.jobs.length && performance.now() - start < 8) {
      const job = this.jobs.shift();
      if (job.cancelled) continue;
      job.run();
    }
    if (this.jobs.length) this.schedule();
  }
}
