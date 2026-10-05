// node --test mapCarAlart/web/tests/
// iOS 版（mapCarAlart リポジトリの NerimaRoadRiskTests）と同じ期待値で、移植した計算を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as M from '../js/model.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≈ ${b} (±${eps})`);
const V = (id) => M.VEHICLES[id];
const KEI = V(0); const VAN = V(1); const TWO = V(2); const MED = V(3);
const seg = (w, t = 0, gm = 0, de = false) => ({ widthClass: w, type: t, maxGrade: gm, deadEnd: de });
const level = (s, v) => M.assess(s, v).level;

// MARK: 要注意度（RiskModelTests）

test('幅員区分0・平坦', () => {
  assert.equal(level(seg(0), KEI), 2);
  assert.equal(level(seg(0), VAN), 2);
  assert.equal(level(seg(0), TWO), 3);
  assert.equal(level(seg(0), MED), 3);
});

test('幅員区分1・平坦', () => {
  assert.equal(level(seg(1), VAN), 1);
  assert.equal(level(seg(1), MED), 2);
});

test('幅員区分2は全車両で低', () => {
  for (const v of M.VEHICLES) assert.equal(level(seg(2), v), 0, v.name);
});

test('幅員区分0・行き止まり・小型バン', () => {
  const a = M.assess(seg(0, 0, 0, true), VAN);
  assert.equal(a.total, 5);
  assert.equal(a.level, 3);
});

test('幅員区分0・勾配12.5%・行き止まり・小型バン', () => {
  const a = M.assess(seg(0, 0, 125, true), VAN);
  assert.equal(a.level, 4);
  assert.equal(a.total, 8);
});

test('進入の難しさの表', () => {
  assert.deepEqual(KEI.accessTable, [2, 1, 0, 0, 0]);
  assert.deepEqual(VAN.accessTable, [3, 1, 0, 0, 0]);
  assert.deepEqual(TWO.accessTable, [4, 1, 0, 0, 0]);
  assert.deepEqual(MED.accessTable, [4, 2, 0, 0, 0]);
  assert.equal(M.DEFAULT_VEHICLE, 1);
});

test('徒歩道・石段は常に最高', () => {
  for (const v of M.VEHICLES) {
    for (const t of [2, 3]) {
      for (let w = 0; w <= 4; w++) {
        assert.equal(M.access(w, t, v), 4);
        assert.equal(level(seg(w, t), v), 4);
      }
    }
  }
});

test('勾配の点', () => {
  const cases = [[-1, 0], [0, 0], [59, 0], [60, 1], [89, 1], [90, 2], [119, 2], [120, 3], [346, 3]];
  for (const [gm, p] of cases) assert.equal(M.gradePoints(gm), p, `gm=${gm}`);
});

test('行き止まりの点は車道だけ', () => {
  assert.equal(M.deadEndPoints(0, 0, true), 2);
  assert.equal(M.deadEndPoints(1, 1, true), 1);
  assert.equal(M.deadEndPoints(2, 0, true), 0);
  assert.equal(M.deadEndPoints(0, 0, false), 0);
  assert.equal(M.deadEndPoints(0, 2, true), 0);
  assert.equal(M.deadEndPoints(0, 3, true), 0);
});

test('合計点から要注意度', () => {
  const cases = [[0, 0], [1, 1], [2, 2], [3, 2], [4, 3], [5, 3], [6, 4], [10, 4]];
  for (const [s, l] of cases) assert.equal(M.levelFromScore(s), l, `score=${s}`);
});

test('算出対象外の勾配は無視', () => {
  assert.equal(level(seg(2, 0, -1), MED), 0);
});

test('判定理由の点数の合計は total と一致', () => {
  const a = M.assess(seg(0, 0, 95, true), MED);
  assert.equal(a.reasons.reduce((s, r) => s + r.points, 0), a.total);
  assert.equal(a.total, 4 + 2 + 2);
});

test('描画用の riskLevel は assess と同じ', () => {
  for (const v of M.VEHICLES) for (let t = 0; t <= 3; t++) for (let w = 0; w <= 4; w++) {
    for (const gm of [-1, 0, 59, 60, 90, 120, 200]) for (const de of [false, true]) {
      const s = seg(w, t, gm, de);
      assert.equal(M.riskLevel(s, v), M.assess(s, v).level);
    }
  }
});

test('勾配の区分と区分 id', () => {
  assert.deepEqual([-1, 0, 60, 90, 120].map(M.slopeCategory), [0, 1, 2, 3, 4]);
  for (const mode of M.COLOR_MODES) {
    assert.deepEqual(new Set(M.categories(mode.id).map((c) => c.id)), new Set([0, 1, 2, 3, 4]), mode.title);
  }
});

// MARK: ストリートビュー・座標

test('ストリートビューのリンク', () => {
  assert.equal(M.streetViewLink(35.7356, 139.6517, 92.4),
    'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=35.735600,139.651700&heading=92');
  assert.ok(M.streetViewLink(35, 139, 359.7).endsWith('heading=0'));
  assert.ok(M.streetViewLink(35, 139, -10).endsWith('heading=350'));
});

test('ストリートビューの埋め込み URL', () => {
  assert.equal(M.streetViewEmbedURL(35.7356, 139.6517, -10, 'AIza-test_key'),
    'https://www.google.com/maps/embed/v1/streetview?key=AIza-test_key&location=35.735600,139.651700&heading=350&pitch=0&fov=90&language=ja');
});

test('Webメルカトル', () => {
  const o = M.worldPoint(0, 0);
  near(o.x, 0.5, 1e-12); near(o.y, 0.5, 1e-12);
  // 練馬区役所あたりはズーム15でタイル (29095, 12897) に入る
  const p = M.worldPoint(35.7356, 139.6517);
  assert.equal(Math.floor(p.x * 32768), 29095);
  assert.equal(Math.floor(p.y * 32768), 12897);
  const b = M.tileBounds(29095, 12897, 15);
  assert.ok(b.minX <= p.x && p.x < b.maxX && b.minY <= p.y && p.y < b.maxY);
});

test('方位', () => {
  near(M.heading(0, 1), 0, 1e-9);
  near(M.heading(1, 0), 90, 1e-9);
  near(M.heading(0, -1), 180, 1e-9);
  near(M.heading(-1, 0), 270, 1e-9);
});

// MARK: 小さな道路網（SegmentIndexTests）

function makeNetwork(lines, types) {
  const n = lines.length;
  const g = lines.map((line) => {
    const out = [line[0][0] * 2, line[0][1] * 2];
    for (let k = 1; k < line.length; k++) out.push((line[k][0] - line[k - 1][0]) * 2, (line[k][1] - line[k - 1][1]) * 2);
    return out;
  });
  const zeros = new Array(n).fill(0);
  const ring = (pts) => pts.flatMap(([x, y]) => [x * 2, y * 2]);
  return M.buildNetwork({
    meta: { lat0: 35.745, lon0: 139.62, mx: 90350.09102323752, my: 110940, sc: 2 },
    w: zeros, c: zeros, t: types ?? zeros, s: zeros, gm: zeros, ga: zeros, L: new Array(n).fill(100),
    de: zeros, ow: zeros, nm: zeros, z: zeros, names: [''], g, wards: ['A区', 'B区'], wd: zeros,
    bd: [
      ring([[-1000, -1000], [1000, -1000], [1000, 1000]]),
      ring([[1000, 1000], [-1000, 1000], [-1000, -1000]]),
      ring([[1000, -1000], [3000, -1000], [3000, 1000], [1000, 1000], [1000, -1000]]),
    ],
    bdw: [0, 0, 1],
  });
}

test('タイル用の格子で矩形に掛かる区間を拾う', () => {
  const net = makeNetwork([[[-50, 0], [50, 0]], [[2000, 0], [2100, 0]]]);
  const g = new M.TileGeometry(net);
  const c1 = M.toLatLng(net, -10, -10); const c2 = M.toLatLng(net, 10, 10);
  const a = M.worldPoint(c1.lat, c1.lng); const b = M.worldPoint(c2.lat, c2.lng);
  assert.deepEqual(g.segments(a.x, b.y, b.x, a.y), [0]);
  assert.deepEqual(new Set(g.segments(0, 0, 1, 1)), new Set([0, 1]));
  assert.equal(g.boundaryBounds.length, 3);
});

test('最寄りの区間を選び、道路上に寄せる', () => {
  const net = makeNetwork([[[0, 0], [200, 0]], [[0, 30], [0, 300]]]);
  const index = new M.SegmentIndex(net);
  const hit = index.nearest(net, 150, 8, 20);
  assert.equal(hit.segment, 0);
  near(hit.distance, 8, 1e-9); near(hit.x, 150, 1e-9); near(hit.y, 0, 1e-9); near(hit.heading, 90, 1e-9);
  const hit2 = index.nearest(net, 5, 250, 20);
  assert.equal(hit2.segment, 1);
  near(hit2.heading, 0, 1e-9);
});

test('最大距離を守る', () => {
  const net = makeNetwork([[[0, 0], [200, 0]]]);
  const index = new M.SegmentIndex(net);
  assert.equal(index.nearest(net, 100, 30, 20), null);
  assert.notEqual(index.nearest(net, 100, 30, 31), null);
  assert.equal(index.nearest(net, 50000, 50000, 80), null);
});

test('絞り込みで徒歩道を飛ばす', () => {
  const net = makeNetwork([[[0, 0], [100, 0]], [[0, 40], [100, 40]]], [2, 0]);
  const index = new M.SegmentIndex(net);
  assert.equal(index.nearest(net, 50, 5, 80).segment, 0);
  assert.equal(index.nearest(net, 50, 5, 80, (i) => net.t[i] < 2).segment, 1);
});

test('多くの格子にまたがる長い区間', () => {
  const net = makeNetwork([[[-500, -500], [500, 500]]]);
  const hit = new M.SegmentIndex(net).nearest(net, 110, 90, 20);
  near(hit.distance, 20 / Math.SQRT2, 1e-9);
  near(hit.heading, 45, 1e-9);
});

test('折れ線のどの部分かで方位が決まる', () => {
  const net = makeNetwork([[[0, 0], [100, 0], [100, -100]]]);
  const index = new M.SegmentIndex(net);
  near(index.nearest(net, 50, 3, 20).heading, 90, 1e-9);
  near(index.nearest(net, 103, -60, 20).heading, 180, 1e-9);
});

test('局所座標と緯度経度の往復', () => {
  const net = makeNetwork([[[0, 0], [1, 0]]]);
  const c = M.toLatLng(net, 1234.5, -678.9);
  const back = M.toLocal(net, c.lat, c.lng);
  near(back.x, 1234.5, 1e-6); near(back.y, -678.9, 1e-6);
  near(M.toLatLng(net, 0, 0).lat, 35.745, 1e-12);
  near(M.toLatLng(net, 0, 0).lng, 139.62, 1e-12);
});

test('区ごとの偶奇判定', () => {
  const net = makeNetwork([[[0, 0], [1, 0]]]);
  assert.ok(M.isInsideWard(net, 0, 0, 0));
  assert.ok(!M.isInsideWard(net, 1, 0, 0));
  assert.equal(M.wardContaining(net, 0, 0), 0);
  assert.equal(M.wardContaining(net, 2000, 0), 1);
  assert.equal(M.wardContaining(net, 5000, 0), null);
});

// MARK: 同梱データ（RoadDataTests）

const dataURL = new URL('../data/tokyo_north_roads.json', import.meta.url);
const net = M.buildNetwork(JSON.parse(readFileSync(fileURLToPath(dataURL), 'utf8')));
const km = (pred) => { let s = 0; for (let i = 0; i < net.count; i++) if (pred(i)) s += net.length[i]; return s / 1000; };

test('件数と列がそろっている', () => {
  assert.equal(net.count, 102527);
  assert.deepEqual(net.wards, ['練馬区', '板橋区', '北区', '豊島区']);
  assert.equal(net.pointStart.length, net.count + 1);
  assert.equal(net.pointStart[net.count], net.pointX.length);
  for (let i = 0; i < net.count; i++) assert.ok(net.pointStart[i + 1] - net.pointStart[i] >= 2);
  assert.equal(net.names[0], '');
});

test('練馬区は作成仕様の答え合わせ値と一致', () => {
  const n = net.wards.indexOf('練馬区');
  near(km((i) => net.ward[i] === n), 1608, 3);
  [397.8, 1085.0, 88.8, 10.2, 25.8].forEach((e, w) => near(km((i) => net.ward[i] === n && net.w[i] === w), e, 1, `幅員区分 ${w}`));
  near(km((i) => net.ward[i] === n && net.gm[i] >= 90 && net.gm[i] < 120), 24.6, 1);
  near(km((i) => net.ward[i] === n && net.gm[i] >= 120), 21.8, 1);
  near(km((i) => net.ward[i] === n && net.deadEnd[i] === 1), 210.9, 1);
  near(km((i) => net.ward[i] === n && net.oneWay[i] === 1), 181.7, 1);
});

test('他の3区の集計値', () => {
  for (const [name, count, total] of [['板橋区', 26867, 1040.4], ['北区', 18049, 654.2], ['豊島区', 12618, 457.3]]) {
    const w = net.wards.indexOf(name);
    assert.equal(net.ward.filter((x) => x === w).length, count, name);
    near(km((i) => net.ward[i] === w), total, 0.5, name);
  }
});

test('区分ごとの延長の合計は全延長と一致', () => {
  for (const ward of [null, 0, 1, 2, 3]) {
    const total = km((i) => ward === null || net.ward[i] === ward);
    for (const mode of M.COLOR_MODES) {
      const ids = M.categoryIDs(net, mode.id, VAN);
      const sum = [...M.lengthByCategory(net, ids, mode.id, ward).values()].reduce((a, b) => a + b, 0) / 1000;
      near(sum, total, 1e-6, `${mode.id} ${ward}`);
    }
  }
});

test('区役所はそれぞれの区の中', () => {
  for (const [name, lat, lng] of [['練馬区', 35.7356, 139.6517], ['板橋区', 35.7512, 139.7094], ['北区', 35.7528, 139.7337], ['豊島区', 35.7326, 139.7158]]) {
    const p = M.toLocal(net, lat, lng);
    assert.equal(net.wards[M.wardContaining(net, p.x, p.y)], name);
  }
  const s = M.toLocal(net, 35.69, 139.7004);
  assert.equal(M.wardContaining(net, s.x, s.y), null);
});

test('実データでタップの最寄り区間が見つかる', () => {
  const index = new M.SegmentIndex(net);
  for (let i = 0; i < net.count; i += 9999) {
    const k = net.pointStart[i];
    const hit = index.nearest(net, net.pointX[k], net.pointY[k], 5);
    near(hit.distance, 0, 1e-9);
    const w = net.ward[i];
    const inWard = index.nearest(net, net.pointX[k], net.pointY[k], 5, (j) => net.ward[j] === w);
    assert.equal(net.ward[inWard.segment], w);
  }
});

test('タイル用の格子は実データの区間を漏らさない', () => {
  const g = new M.TileGeometry(net);
  // 練馬区役所を含むズーム15のタイルに、区役所のそばの区間が入る
  const p = M.worldPoint(35.7356, 139.6517);
  const b = M.tileBounds(Math.floor(p.x * 32768), Math.floor(p.y * 32768), 15);
  const segs = new Set(g.segments(b.minX, b.minY, b.maxX, b.maxY));
  const local = M.toLocal(net, 35.7356, 139.6517);
  const hit = new M.SegmentIndex(net).nearest(net, local.x, local.y, 200);
  assert.ok(hit && segs.has(hit.segment));
});
