"""App Store（iTunes Search API）から、開発者のアプリ一覧とアイコンを取る（作業用）。"""
import json
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).parent
# 公開済みと分かっているアプリ（家計簿・タイム計算機）から開発者 ID を引く
SEED_IDS = ["6759987999", "6819285966"]
UA = {"User-Agent": "ryosukehys.github.io app list"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as res:
        return res.read()


def lookup(**params):
    return json.loads(get("https://itunes.apple.com/lookup?" + urllib.parse.urlencode(params)))


seed = lookup(id=",".join(SEED_IDS), country="jp")
(OUT / "seed_jp.json").write_text(json.dumps(seed, ensure_ascii=False, indent=1))
artist_ids = sorted({r["artistId"] for r in seed["results"] if "artistId" in r})
print("artist ids:", artist_ids, [r.get("artistName") for r in seed["results"]])

apps = {}
for country in ("jp", "us"):
    found = {}
    for aid in artist_ids:
        for entity in ("software", "macSoftware"):
            for r in lookup(id=aid, entity=entity, country=country, limit=200)["results"]:
                if r.get("wrapperType") == "software":
                    found[r["trackId"]] = r
    apps[country] = sorted(found.values(), key=lambda r: r.get("releaseDate", ""))
    (OUT / f"apps_{country}.json").write_text(json.dumps(apps[country], ensure_ascii=False, indent=1))

(OUT / "icons").mkdir(exist_ok=True)
for a in apps["jp"]:
    url = a.get("artworkUrl512") or a.get("artworkUrl100")
    for candidate in (url.replace("bb.jpg", "bb.png"), url):
        try:
            data = get(candidate)
        except Exception as e:  # noqa: BLE001
            print("icon failed", candidate, e)
            continue
        ext = "png" if candidate.endswith(".png") else candidate.rsplit(".", 1)[-1]
        (OUT / "icons" / f"{a['trackId']}.{ext}").write_bytes(data)
        break
    print(a["trackId"], a["trackName"], a.get("version"), a.get("releaseDate"), a.get("formattedPrice"), a["trackViewUrl"])
print("us names:", [(a["trackId"], a["trackName"]) for a in apps["us"]])
