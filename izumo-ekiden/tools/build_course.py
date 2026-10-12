#!/usr/bin/env python3
"""出雲駅伝のコース（data/course.geojson）を OpenStreetMap の道路から組み立てる。

区間ごとに決めた通り道の点（VIAS）を、道路網の最短経路で順につなぐ。
つないだ線の長さと通過地点の累計距離が公式の値と合っているかを確かめてから書き出す。

    python3 tools/build_course.py                # Overpass API から道路を取得して組み立てる
    python3 tools/build_course.py --cache X.gz   # 取得結果を X.gz に保存し、次回から再利用する

標準ライブラリだけで動く。
"""

import argparse
import gzip
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
ROAD_TYPES = {
    "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
    "service", "pedestrian", "road",
}

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

# 区間ごとの通り道（緯度, 経度）。どれも OSM の道路の頂点で、隣り合う点の最短経路がそのまま
# コースになるように置いている（間隔は 1km 以内）。先頭と末尾は中継所。
#   1区: 勢溜 → 神門通り → 吉兆館前 → 旧大社駅前 → 荒木小東側 → 浜山公園 → 県道28号（出雲大社線）
#        → 小山園西側 → 渡橋中央で左折 → 出雲市役所・JAしまね前
#   2区: 東へ → 神立橋（斐伊川）→ 国道9号 → ゆめタウン斐川前（直江交差点の 1.3km 手前）
#   3区: 直江交差点で左折 → 県道275号を北へ → 西代橋（斐伊川）→ 本田橋で右折 → 国道431号
#        → 雲州平田駅前 → JAラピタひらた店前
#   4区: 小伊津港線 → 平田本田で国道431号 → 本田橋 → 美談 → 鳶巣コミュニティセンター前
#   5区: 国道431号を西へ → 矢尾 → 遙堪 → 島根ワイナリー前
#   6区: 国道431号 → 古代出雲歴史博物館・みせん広場前 → 勢溜で左折（1区と同じ道）
#        → 小山園西側で左折 → おやま保育園南側で左折 → 出雲ドーム前
VIAS = {
    1: [
        (35.396495, 132.6864069), (35.3874895, 132.6890097), (35.3823847, 132.6975369),
        (35.3819228, 132.7090085), (35.3788272, 132.7168613), (35.376643, 132.7297908),
        (35.3717117, 132.7367043), (35.3663114, 132.7464531), (35.367482, 132.7542063),
    ],
    2: [
        (35.367482, 132.7542063), (35.368346, 132.7665449), (35.3702715, 132.7773317),
        (35.3714332, 132.7884261), (35.3773785, 132.7969322), (35.3842389, 132.8053124),
        (35.3867398, 132.8092807),
    ],
    3: [
        (35.3867398, 132.8092807), (35.3906664, 132.8194874), (35.3905468, 132.8225432),
        (35.3995733, 132.8201518), (35.4088786, 132.8172279), (35.4147323, 132.8147664),
        (35.4202179, 132.8135094), (35.427651, 132.812831), (35.4302474, 132.8212289),
        (35.4385854, 132.8286637), (35.4396446, 132.8231038),
    ],
    4: [
        (35.4396446, 132.8231038), (35.4365988, 132.8203375), (35.4305674, 132.8161052),
        (35.423167, 132.807796), (35.4167722, 132.8011316), (35.4093774, 132.7937681),
        (35.4051508, 132.7824241), (35.4041229, 132.7780224),
    ],
    5: [
        (35.4041229, 132.7780224), (35.4026942, 132.7671448), (35.3983429, 132.7576636),
        (35.3957812, 132.7472745), (35.3946515, 132.736625), (35.3959529, 132.7243858),
        (35.3967897, 132.7138034), (35.3965805, 132.711019),
    ],
    6: [
        (35.3965805, 132.711019), (35.3967827, 132.6997828), (35.3971578, 132.688928),
        (35.392053, 132.6872033), (35.3846485, 132.6921437), (35.382622, 132.7026967),
        (35.3799474, 132.7126473), (35.3771121, 132.7237558), (35.3738753, 132.7350102),
        (35.3717117, 132.7367043), (35.3742393, 132.7443524), (35.3815373, 132.7399524),
    ],
}

# 通過地点: (区間, 名前, 大会スタートからの累計km, 位置)。累計距離は日本語版 Wikipedia
# 「出雲全日本大学選抜駅伝競走」のコースの節による（勢溜の再通過は 6区の小山園西側 43.3km と
# 1区の 6.1km の差）。位置は OSM の交差点・施設か、名前のない交差点は道のつながりと距離から決めた。
CHECKPOINTS = [
    (1, "浜山公園陸上競技場前", 3.1, (35.383522, 132.707709)),
    (1, "小山園西側交差点", 6.1, (35.3717117, 132.7367043)),
    (1, "渡橋中央交差点", 7.0, (35.3653431, 132.7427901)),
    (2, "神立橋西詰交差点", 10.5, (35.369698, 132.782126)),
    (2, "神立交差点", 11.5, (35.3733439, 132.791161)),
    (3, "直江交差点", 15.1, (35.3905468, 132.8225432)),
    (3, "西代橋南詰交差点", 17.8, (35.4147323, 132.8147664)),
    (3, "西代交差点", 19.0, (35.4230682, 132.8151979)),
    (3, "本田橋交差点", 19.5, (35.427014, 132.812419)),
    (3, "平田本田", 20.0, (35.4305674, 132.8161052)),
    (3, "雲州平田駅前", 20.9, (35.432176, 132.823728)),
    (4, "平田本田", 23.8, (35.4305674, 132.8161052)),
    (4, "本田橋交差点", 24.3, (35.427014, 132.812419)),
    (5, "矢尾交差点", 31.6, (35.395775, 132.747389)),
    (5, "遙堪（荘厳寺南側）交差点", 33.5, (35.395506, 132.727184)),
    (6, "出雲大社正面鳥居前（勢溜）を再び通過", 37.2, (35.396495, 132.6864069)),
    (6, "小山園西側交差点", 43.3, (35.3717117, 132.7367043)),
    (6, "おやま保育園南側交差点", 44.1, (35.3742393, 132.7443524)),
]

# 線の長さと公式距離のずれの許容範囲。公式距離は走路の内側を測るので、道路の中心線より少し短い。
LEG_TOLERANCE = 0.03
CHECKPOINT_TOLERANCE_KM = 0.3
CHECKPOINT_MAX_OFFSET_M = 200  # 施設の中心から道路まで。浜山公園陸上競技場はスタンドの中心から 160m ほどある


def fetch_overpass(cache: Path | None):
    if cache and cache.exists():
        return json.loads(gzip.decompress(cache.read_bytes()))
    s, w, n, e = BBOX
    query = f"""
[out:json][timeout:180];
way["highway"~"^({'|'.join(sorted(ROAD_TYPES))})$"]({s},{w},{n},{e});
(._;>;);
out body;
"""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, headers={"User-Agent": "ryosukehys.github.io izumo-ekiden"})
    with urllib.request.urlopen(req, timeout=240) as res:
        raw = res.read()
    if cache:
        cache.write_bytes(gzip.compress(raw))
    return json.loads(raw)


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
            if el["type"] == "node" and "lat" in el:
                self.pos[el["id"]] = (el["lat"], el["lon"])
        for el in osm["elements"]:
            tags = el.get("tags") or {}
            if el["type"] != "way" or "nodes" not in el:
                continue
            if tags.get("highway") not in ROAD_TYPES or tags.get("access") in ("private", "no"):
                continue
            nodes = [n for n in el["nodes"] if n in self.pos]
            for a, b in zip(nodes, nodes[1:]):
                d = haversine_m(self.pos[a], self.pos[b])
                self.adj.setdefault(a, []).append((b, d))
                self.adj.setdefault(b, []).append((a, d))

    def nearest(self, latlon):
        node = min(self.adj, key=lambda n: haversine_m(self.pos[n], latlon))
        gap = haversine_m(self.pos[node], latlon)
        if gap > 5:
            raise RuntimeError(f"{latlon} の近くに道路の頂点がない（最寄り {gap:.0f}m）。OSM のデータが変わった可能性がある")
        return node

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
            raise RuntimeError(f"経路が見つからない: {self.pos[src]} -> {self.pos[dst]}")
        path = [dst]
        while path[-1] != src:
            path.append(prev[path[-1]])
        return path[::-1]

    def route(self, vias):
        nodes = [self.nearest(v) for v in vias]
        path = [nodes[0]]
        for a, b in zip(nodes, nodes[1:]):
            path += self.shortest(a, b)[1:]
        return path

    def length_m(self, path):
        return sum(haversine_m(self.pos[a], self.pos[b]) for a, b in zip(path, path[1:]))

    def project(self, path, latlon):
        """latlon にいちばん近い線上の点、線からの距離（m）、線の始点からその点までの距離（m）。"""
        best = (math.inf, None, 0.0)
        along = 0.0
        for a, b in zip(path, path[1:]):
            pa, pb = self.pos[a], self.pos[b]
            seg = haversine_m(pa, pb)
            # 短い区間なので、緯度経度を平面とみなして射影する
            kx = math.cos(math.radians(pa[0]))
            dx, dy = (pb[1] - pa[1]) * kx, pb[0] - pa[0]
            px, py = (latlon[1] - pa[1]) * kx, latlon[0] - pa[0]
            t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, (px * dx + py * dy) / (dx * dx + dy * dy)))
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


def lonlat(latlon):
    return [round(latlon[1], 6), round(latlon[0], 6)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, help="Overpass の取得結果（gzip）を保存・再利用するファイル")
    args = parser.parse_args()

    graph = RoadGraph(fetch_overpass(args.cache))
    failures = []
    features = []
    paths = {}
    earlier_edges = set()
    start_km = 0.0

    for leg_no, official in enumerate(OFFICIAL_KM, start=1):
        path = graph.route(VIAS[leg_no])
        for i in range(len(path) - 2):
            if path[i] == path[i + 2]:
                failures.append(f"{leg_no}区の線が {graph.pos[path[i]]} で折り返している")
        length_km = graph.length_m(path) / 1000
        diff = (length_km - official) / official
        print(f"{leg_no}区: 公式 {official:.1f}km / 線 {length_km:.2f}km ({diff:+.1%})")
        if abs(diff) > LEG_TOLERANCE:
            failures.append(f"{leg_no}区の長さが公式距離と {diff:+.1%} ずれている")
        paths[leg_no] = path
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [lonlat(graph.pos[n]) for n in path]},
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
        start_km += official

    legs = {f["properties"]["leg"]: f["properties"] for f in features}
    for leg_no, name, km, latlon in CHECKPOINTS:
        off_m, q, along_m = graph.project(paths[leg_no], latlon)
        leg = legs[leg_no]
        # 線の長さを公式距離に按分して、通過地点の累計距離と比べる
        line_km = leg["startKm"] + along_m / 1000 * leg["officialKm"] / leg["lineKm"]
        gap = line_km - km
        print(f"  {leg_no}区 {name}: 公式 {km:.1f}km / 線 {line_km:.2f}km ({gap:+.2f}km, 線から {off_m:.0f}m)")
        if abs(gap) > CHECKPOINT_TOLERANCE_KM or off_m > CHECKPOINT_MAX_OFFSET_M:
            failures.append(f"{leg_no}区 {name} が合わない（{gap:+.2f}km, 線から {off_m:.0f}m）")
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": lonlat(q)},
            "properties": {"kind": "checkpoint", "leg": leg_no, "name": name, "km": km},
        })

    cum = 0.0
    for order, station in enumerate(STATIONS):
        node = paths[1][0] if order == 0 else paths[order][-1]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": lonlat(graph.pos[node])},
            "properties": {"kind": "station", "order": order, "km": round(cum, 1), **station},
        })
        if order < len(OFFICIAL_KM):
            cum += OFFICIAL_KM[order]

    if failures:
        sys.exit("検証に失敗:\n" + "\n".join(failures))

    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"書き出し: {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
