#!/usr/bin/env python3
"""出雲駅伝のコース（data/course.geojson）を OpenStreetMap の道路から組み立てる。

公開されている中継所・通過地点（交差点名など）を順に道路網の最短経路でつなぎ、
区間ごとの線の長さと通過地点の累計距離が公式の値と合っているかを確かめてから書き出す。

    python3 tools/build_course.py            # Overpass API から取得して組み立てる
    python3 tools/build_course.py --cache X  # 取得結果を X に保存し、次回から再利用する

標準ライブラリだけで動く。
"""

import argparse
import heapq
import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "course.geojson"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# 出雲市の大社・今市・斐川・平田を含む範囲（南, 西, 北, 東）
BBOX = (35.34, 132.66, 35.46, 132.86)

# ランナーが走れる道。駅伝は通行止めにして走るので一方通行は見ない。
ROAD_TYPES = (
    "trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|"
    "unclassified|residential|living_street|service|pedestrian|road"
)

# 中継所（順番どおり）。区間 n は STATIONS[n-1] から STATIONS[n] まで。
STATIONS = [
    {"title": "スタート", "label": "S", "role": "start", "name": "出雲大社正面鳥居前（勢溜）"},
    {"title": "第1中継所", "label": "1", "role": "relay", "name": "出雲市役所・JAしまね前"},
    {"title": "第2中継所", "label": "2", "role": "relay", "name": "ゆめタウン斐川前"},
    {"title": "第3中継所", "label": "3", "role": "relay", "name": "JAラピタひらた店前"},
    {"title": "第4中継所", "label": "4", "role": "relay", "name": "鳶巣コミュニティセンター前"},
    {"title": "第5中継所", "label": "5", "role": "relay", "name": "島根ワイナリー前"},
    {"title": "フィニッシュ", "label": "G", "role": "finish", "name": "出雲ドーム前"},
]
OFFICIAL_KM = [8.0, 5.8, 8.5, 6.2, 6.4, 10.2]

# 通過地点と大会スタートからの累計距離（km）。日本語版 Wikipedia「出雲全日本大学選抜駅伝競走」の
# コースの節と、大会公式サイトの選手通過時刻予定表による。線の検証と地図上の表示に使う。
CHECKPOINTS = [
    (1, "ローソン浜山店前", 2.1),
    (1, "浜山公園陸上競技場前", 3.1),
    (1, "小山園西側交差点", 6.1),
    (1, "渡橋中央交差点", 7.0),
    (2, "神立橋西詰交差点", 10.5),
    (2, "神立交差点", 11.5),
    (2, "富村交差点", 12.4),
    (3, "直江交差点", 15.1),
    (3, "中部小学校前", 15.8),
    (3, "西代橋南詰交差点", 17.8),
    (3, "西代交差点", 19.0),
    (3, "本田橋交差点", 19.5),
    (3, "平田本田（国交省出張所前）", 20.0),
    (3, "京町交差点", 20.4),
    (3, "雲州平田駅前", 20.9),
    (4, "平田本田", 23.8),
    (4, "本田橋交差点", 24.3),
    (4, "太田医院前", 25.1),
    (4, "美談・東林木境", 27.4),
    (5, "オムロン出雲西側交差点", 29.9),
    (5, "矢尾交差点", 31.6),
    (5, "松井銘木前", 32.6),
    (5, "遙堪（荘厳寺南側）交差点", 33.5),
    (6, "小山園西側交差点", 43.3),
    (6, "おやま保育園南側交差点", 44.1),
]

# 経路の通り道。区間ごとに、通る順の地点（緯度, 経度）を並べる。先頭と末尾は中継所。
# 各点は道路網のいちばん近い交差点・頂点に寄せてから、その間を最短経路でつなぐ。
VIAS = {}  # OSM のデータを確かめて埋める

# 線の長さが公式距離からこれ以上ずれたら失敗にする
LEG_TOLERANCE = 0.03
CHECKPOINT_TOLERANCE_KM = 0.3


def fetch_overpass(cache: Path | None):
    if cache and cache.exists():
        return json.loads(cache.read_text())
    s, w, n, e = BBOX
    query = f"""
[out:json][timeout:120];
(
  way["highway"~"^({ROAD_TYPES})$"]({s},{w},{n},{e});
);
(._;>;);
out body;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "ryosukehys.github.io izumo-ekiden"})
    with urllib.request.urlopen(req, timeout=180) as res:
        body = json.loads(res.read())
    if cache:
        cache.write_text(json.dumps(body))
    return body


def haversine_m(a, b):
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1, math.sqrt(h)))


class RoadGraph:
    def __init__(self, osm):
        self.pos = {}
        self.adj = {}
        for el in osm["elements"]:
            if el["type"] == "node":
                self.pos[el["id"]] = (el["lat"], el["lon"])
        for el in osm["elements"]:
            if el["type"] != "way":
                continue
            nodes = [n for n in el["nodes"] if n in self.pos]
            for a, b in zip(nodes, nodes[1:]):
                d = haversine_m(self.pos[a], self.pos[b])
                self.adj.setdefault(a, []).append((b, d))
                self.adj.setdefault(b, []).append((a, d))

    def nearest(self, latlon):
        return min(self.adj, key=lambda n: haversine_m(self.pos[n], latlon))

    def shortest(self, src, dst):
        dist = {src: 0.0}
        prev = {}
        heap = [(0.0, src)]
        while heap:
            d, u = heapq.heappop(heap)
            if u == dst:
                break
            if d > dist[u]:
                continue
            for v, w in self.adj[u]:
                nd = d + w
                if nd < dist.get(v, math.inf):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(heap, (nd, v))
        if dst not in dist:
            raise RuntimeError(f"経路が見つからない: {src} -> {dst}")
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return path[::-1]


def leg_path(graph, vias):
    nodes = [graph.nearest(v) for v in vias]
    path = [nodes[0]]
    for a, b in zip(nodes, nodes[1:]):
        path += graph.shortest(a, b)[1:]
    return path


def path_length_m(graph, path):
    return sum(haversine_m(graph.pos[a], graph.pos[b]) for a, b in zip(path, path[1:]))


def project(graph, path, latlon):
    """latlon にいちばん近い線上の点と、そこまでの線に沿った距離（m）。"""
    best = (math.inf, None, 0.0)
    along = 0.0
    for a, b in zip(path, path[1:]):
        pa, pb = graph.pos[a], graph.pos[b]
        seg = haversine_m(pa, pb)
        # 区間が短いので、緯度経度を平面とみなして射影する
        kx = math.cos(math.radians(pa[0]))
        ax, ay = pa[1] * kx, pa[0]
        bx, by = pb[1] * kx, pb[0]
        px, py = latlon[1] * kx, latlon[0]
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        q = (pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t)
        d = haversine_m(q, latlon)
        if d < best[0]:
            best = (d, q, along + seg * t)
        along += seg
    return best


def shared_ranges(path, earlier_edges):
    """先の区間と同じ道（同じ辺）を通る部分を、座標の添字の範囲 [from, to] で返す。"""
    ranges = []
    for i, (a, b) in enumerate(zip(path, path[1:])):
        if frozenset((a, b)) in earlier_edges:
            if ranges and ranges[-1][1] == i:
                ranges[-1][1] = i + 1
            else:
                ranges.append([i, i + 1])
    return ranges


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, help="Overpass の取得結果を保存・再利用するファイル")
    args = parser.parse_args()

    if len(VIAS) != len(OFFICIAL_KM):
        sys.exit("VIAS（区間ごとの通り道）が未設定です")

    graph = RoadGraph(fetch_overpass(args.cache))
    features = []
    earlier_edges = set()
    start_km = 0.0
    failures = []
    station_points = []

    for leg_no, official in enumerate(OFFICIAL_KM, start=1):
        path = leg_path(graph, VIAS[leg_no])
        length_km = path_length_m(graph, path) / 1000
        diff = (length_km - official) / official
        print(f"{leg_no}区: 公式 {official:.1f}km / 線 {length_km:.2f}km ({diff:+.1%})")
        if abs(diff) > LEG_TOLERANCE:
            failures.append(f"{leg_no}区の長さが公式距離と {diff:+.1%} ずれている")

        coords = [[round(graph.pos[n][1], 6), round(graph.pos[n][0], 6)] for n in path]
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "kind": "leg",
                "leg": leg_no,
                "from": STATIONS[leg_no - 1]["name"],
                "to": STATIONS[leg_no]["name"],
                "officialKm": official,
                "startKm": round(start_km, 1),
                "lineKm": round(length_km, 2),
                "shared": shared_ranges(path, earlier_edges),
            },
        })
        earlier_edges |= {frozenset(e) for e in zip(path, path[1:])}
        if leg_no == 1:
            station_points.append(coords[0])
        station_points.append(coords[-1])
        start_km += official

    legs = {f["properties"]["leg"]: f for f in features}
    for leg_no, name, km in CHECKPOINTS:
        latlon = CHECKPOINT_POS[(leg_no, name)]
        path = leg_path(graph, VIAS[leg_no])
        off_m, q, along_m = project(graph, path, latlon)
        leg = legs[leg_no]["properties"]
        # 線の長さを公式距離に按分して、通過地点の累計距離と比べる
        line_km = leg["startKm"] + along_m / 1000 * leg["officialKm"] / leg["lineKm"]
        gap = line_km - km
        print(f"  {leg_no}区 {name}: 公式 {km:.1f}km / 線 {line_km:.2f}km ({gap:+.2f}km, 線から {off_m:.0f}m)")
        if abs(gap) > CHECKPOINT_TOLERANCE_KM or off_m > 60:
            failures.append(f"{leg_no}区 {name} が合わない（{gap:+.2f}km, 線から {off_m:.0f}m）")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(q[1], 6), round(q[0], 6)]},
            "properties": {"kind": "checkpoint", "leg": leg_no, "name": name, "km": km},
        })

    cum = 0.0
    for order, (station, coord) in enumerate(zip(STATIONS, station_points)):
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": coord},
            "properties": {"kind": "station", "order": order, "km": round(cum, 1), **station},
        })
        if order < len(OFFICIAL_KM):
            cum += OFFICIAL_KM[order]

    if failures:
        sys.exit("検証に失敗:\n" + "\n".join(failures))

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"書き出し: {OUT.relative_to(ROOT)}")


CHECKPOINT_POS = {}  # OSM のデータを確かめて埋める

if __name__ == "__main__":
    main()
