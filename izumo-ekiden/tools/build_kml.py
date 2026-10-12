#!/usr/bin/env python3
"""data/course.geojson から、Google マイマップや Google Earth に取り込める KML（data/course.kml）を作る。

    python3 tools/build_kml.py

コースの線（区間ごとに色分け）、中継所、通過地点を入れる。標準ライブラリだけで動く。
"""

import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "course.geojson"
OUT = ROOT / "data" / "course.kml"

# js/app.js の LEG_COLORS と同じ色
LEG_COLORS = {1: "#c62f3c", 2: "#e67e10", 3: "#2a9248", 4: "#1f6fc0", 5: "#7a4cc2", 6: "#0e7c86"}
STATION_COLOR = "#24292f"
CHECKPOINT_COLOR = "#8c959f"


def kml_color(hex_rgb, alpha="ff"):
    """#rrggbb を KML の aabbggrr にする。"""
    r, g, b = hex_rgb[1:3], hex_rgb[3:5], hex_rgb[5:7]
    return f"{alpha}{b}{g}{r}"


def coords_text(coords):
    return " ".join(f"{lon},{lat},0" for lon, lat in coords)


def placemark(name, description, style, geometry):
    return f"""      <Placemark>
        <name>{escape(name)}</name>
        <description>{escape(description)}</description>
        <styleUrl>#{style}</styleUrl>
        {geometry}
      </Placemark>"""


def main():
    features = json.loads(SRC.read_text())["features"]
    legs = sorted((f for f in features if f["properties"]["kind"] == "leg"), key=lambda f: f["properties"]["leg"])
    stations = sorted((f for f in features if f["properties"]["kind"] == "station"), key=lambda f: f["properties"]["order"])
    checkpoints = sorted((f for f in features if f["properties"]["kind"] == "checkpoint"), key=lambda f: f["properties"]["km"])

    styles = [
        f"""    <Style id="leg{leg}"><LineStyle><color>{kml_color(color)}</color><width>5</width></LineStyle></Style>"""
        for leg, color in LEG_COLORS.items()
    ]
    styles.append(f"""    <Style id="station"><IconStyle><color>{kml_color(STATION_COLOR)}</color><scale>1.1</scale></IconStyle></Style>""")
    styles.append(f"""    <Style id="checkpoint"><IconStyle><color>{kml_color(CHECKPOINT_COLOR)}</color><scale>0.7</scale></IconStyle></Style>""")

    leg_marks = []
    for f in legs:
        p = f["properties"]
        leg_marks.append(placemark(
            f"{p['leg']}区 {p['officialKm']:.1f}km",
            f"{p['from']} → {p['to']}（スタートから {p['startKm']:.1f}〜{p['startKm'] + p['officialKm']:.1f}km）",
            f"leg{p['leg']}",
            f"<LineString><tessellate>1</tessellate><coordinates>{coords_text(f['geometry']['coordinates'])}</coordinates></LineString>",
        ))

    station_marks = []
    for f in stations:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        station_marks.append(placemark(
            f"{p['title']} {p['name']}",
            f"スタートから {p['km']:.1f}km",
            "station",
            f"<Point><coordinates>{lon},{lat},0</coordinates></Point>",
        ))

    checkpoint_marks = []
    for f in checkpoints:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        checkpoint_marks.append(placemark(
            p["name"],
            f"{p['leg']}区 · スタートから {p['km']:.1f}km",
            "checkpoint",
            f"<Point><coordinates>{lon},{lat},0</coordinates></Point>",
        ))

    nl = "\n"
    kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>出雲駅伝 コース（第38回・6区間 45.1km）</name>
    <description>出雲大社正面鳥居前 → 出雲ドーム前。コースの線は OpenStreetMap の道路に沿って引いた参考図（© OpenStreetMap contributors）。https://ryosukehys.github.io/izumo-ekiden/</description>
{nl.join(styles)}
    <Folder>
      <name>コース</name>
{nl.join(leg_marks)}
    </Folder>
    <Folder>
      <name>中継所</name>
{nl.join(station_marks)}
    </Folder>
    <Folder>
      <name>通過地点</name>
{nl.join(checkpoint_marks)}
    </Folder>
  </Document>
</kml>
"""
    OUT.write_text(kml)
    print(f"書き出し: {OUT.relative_to(ROOT)}（区間 {len(legs)}・中継所 {len(stations)}・通過地点 {len(checkpoints)}）")


if __name__ == "__main__":
    main()
