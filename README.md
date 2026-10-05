# ryosukehys.github.io

個人プロジェクトのホームページです。

## Apps

### sakenojin2026

にいがた酒の陣 2026 のアプリです。フォーク元にグループ共有機能を追加しています。

- **デプロイ先**: https://ryosukehys.github.io/sakenojin2026/
- **フォーク元**: [tsurezure-lab/niigata-sake-no-jin-26](https://github.com/tsurezure-lab/niigata-sake-no-jin-26)

> このアプリは [tsurezure-lab/niigata-sake-no-jin-26](https://github.com/tsurezure-lab/niigata-sake-no-jin-26) をフォークして作成したものです。オリジナルの作者に感謝します。

### 4区道路リスク Web版（mapCarAlart/web）

iOSアプリ「4区道路リスク」（[ryosukehys/mapCarAlart](https://github.com/ryosukehys/mapCarAlart)）と同じ判定を、ブラウザだけで動かす版です。練馬・板橋・北・豊島の道路を道幅・勾配・行き止まりで色分けし、車両ごとの要注意度と区間カルテを出します。

- **デプロイ先**: https://ryosukehys.github.io/mapCarAlart/web/
- **作り**: HTML・CSS・JavaScript（ES モジュール）のみ。ビルドなし。`js/model.js` が iOS 版の Model の移植、`js/tiles.js` が道路タイルの描画、`js/app.js` が画面。
- **地図**: `config.js` に Google Maps Platform の APIキーがあれば Google の地図（区間カルテにストリートビューを埋め込む）。なければ、または読み込めなければ地理院タイル（淡色地図、Leaflet）で動き、ストリートビューは Google マップを開くリンクになる。Google の利用規約により、ストリートビューは Google の地図と同じ画面でだけ埋め込む。
- **APIキー**: リポジトリには書かない。Settings → Secrets and variables → Actions の `MAPCARALART_WEB_GOOGLE_MAPS_KEY` を、`deploy.yml` が公開時にだけ `config.js` へ書き込む。キーは Google Cloud で「ウェブサイトの制限（`https://ryosukehys.github.io/*`）」「API の制限（Maps JavaScript API・Maps Embed API・Geocoding API）」「Maps JavaScript API と Geocoding API の1日の上限」を設定しておく。
- **住所検索**: Google の地図のときは Google（Maps JavaScript API の Geocoder）。キーで Geocoding API が許可されていない・上限に達したなどで使えないとき、または地理院の地図のときは、国土地理院の住所検索（`msearch.gsi.go.jp`、協力：東大CSIS）。結果は表示中の区の区界の内側だけに絞り、選ぶと80m以内の車道のカルテを開く。
- **テスト**: `cd mapCarAlart/web && npm test`（Node 22、依存パッケージなし）。iOS 版の単体テストと同じ期待値を使う。`mapcaralart-web-test.yml` が PR で実行。
- **データ**: `data/tokyo_north_roads.json` は iOS 版の `Data/tokyo_north_roads.json` の複製。出典は国土地理院（道路中心線・DEM5A を加工）と © OpenStreetMap contributors（ODbL）。
- **同梱ライブラリ**: Leaflet 1.9.4（BSD-2-Clause、`vendor/leaflet/LICENSE`）。
