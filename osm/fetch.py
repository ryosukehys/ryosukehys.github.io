import gzip, json, time, urllib.parse, urllib.request
from pathlib import Path

BBOX = "35.34,132.66,35.46,132.86"
QUERY = f"""
[out:json][timeout:300];
way["highway"]({BBOX})->.roads;
.roads out body;
.roads >;
out skel qt;
(
  node["name"]({BBOX});
  way["name"]["highway"!~"."]({BBOX});
  relation["name"]({BBOX});
);
out center tags;
"""
ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

def fetch():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    for attempt in range(3):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=data, headers={"User-Agent": "ryosukehys.github.io izumo-ekiden course map"})
                with urllib.request.urlopen(req, timeout=360) as res:
                    body = json.loads(res.read())
                print(url, len(body["elements"]), "elements")
                return body
            except Exception as e:
                print("failed", url, e)
        time.sleep(30)
    raise SystemExit("all endpoints failed")

body = fetch()
out = Path(__file__).parent / "izumo.json.gz"
out.write_bytes(gzip.compress(json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()))
print(out, out.stat().st_size, "bytes")
