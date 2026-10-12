# ryosukehys.github.io

個人プロジェクトのホームページです。

## Apps

### izumo-ekiden

出雲駅伝（出雲全日本大学選抜駅伝競走、6区間 45.1km）のコースと中継所を地図で表示するページです。

- **デプロイ先**: https://ryosukehys.github.io/izumo-ekiden/
- **コースの線**: `izumo-ekiden/tools/build_course.py` が OpenStreetMap の道路から組み立て、区間距離と通過地点の累計距離を公式値と照らし合わせてから `izumo-ekiden/data/course.geojson` に書き出します
- **Google マップ用**: `izumo-ekiden/tools/build_kml.py` が `course.geojson` から Google マイマップに取り込める `izumo-ekiden/data/course.kml` を作ります
- **地図**: 地理院タイル + [Leaflet](https://leafletjs.com/) 1.9.4（`izumo-ekiden/vendor/leaflet`）

### sakenojin2026

にいがた酒の陣 2026 のアプリです。フォーク元にグループ共有機能を追加しています。

- **デプロイ先**: https://ryosukehys.github.io/sakenojin2026/
- **フォーク元**: [tsurezure-lab/niigata-sake-no-jin-26](https://github.com/tsurezure-lab/niigata-sake-no-jin-26)

> このアプリは [tsurezure-lab/niigata-sake-no-jin-26](https://github.com/tsurezure-lab/niigata-sake-no-jin-26) をフォークして作成したものです。オリジナルの作者に感謝します。
