// Google Maps Platform の APIキー。リポジトリには書かない。
// 公開するときだけ、.github/workflows/deploy.yml がリポジトリの Secrets
// （MAPCARALART_WEB_GOOGLE_MAPS_KEY）からこのファイルを書き換える。
// 空のままなら、国土地理院の地図で動く（ストリートビューは Google マップで開く）。
window.ROADRISK_CONFIG = { googleMapsApiKey: '' };
