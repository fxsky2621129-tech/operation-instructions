# 地点選択のデータ

取得日：2026-10-09。アプリにデータを同梱し、地点を選ぶたびに外部APIへ住所や運行データを送信しない。

## 都道府県・市区町村

Geolonia japanese-addresses-v2 の都道府県・市区町村APIを加工（city + ward、重複を除去）。47都道府県、1,897候補。政令指定都市の行政区も含むため、自治体数とは異なる。取得したAPIの meta.updated は2024-12-25。最新の行政変更を全件確認したデータとは主張しない。

- [元データ](https://japanese-addresses-v2.geoloniamaps.com/api/ja.json)
- [出典・ライセンス：Geolonia／デジタル庁アドレス・ベース・レジストリ](https://github.com/geolonia/japanese-addresses-v2)
- データ：CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
- 加工データ：src/data/municipalities.json

## SA・PA

Rest Areas Japan のダウンロード用データから service_area / parking_area の名称・路線・進行方向・IDを抽出。974件（上下線は別施設として収録）、147路線。高速・有料道路以外のSA・PAも一部含む。路線・方向を持たない項目は「未収録」と表示。全国の収録データであり、現存施設の完全網羅・路線名や方向の正確さは保証しない。施設の廃止・工事・大型車利用可否・休息可否のリアルタイム判定は行わない。

- [元データ](https://restareasjapan.com/downloads/rest-areas-japan.geojson)
- [出典とライセンス](https://restareasjapan.com/ja/data-sources/)
- © OpenStreetMap contributors、Rest Areas Japan。加工データ src/data/rest-areas.json は ODbL 1.0 https://opendatacommons.org/licenses/odbl/1-0/ により公開・再配布する。これはこの独立した地点データベースのライセンスである。

サンプル照合：海老名・足柄は [NEXCO中日本](https://sapa.c-nexco.co.jp/guide/concierge)、輪厚PAの上り・下りは [NEXCO東日本](https://www.driveplaza.com/sapa/1050/1050081/1/shisetsu_service.html)の路線・施設名を確認。全件の照合は未実施。実際の計画では道路会社の情報で利用路線・進行方向・施設利用条件を確認し、必要に応じて直接入力で補正する。

選択結果は既存の startPlace または stops[].place に文字列として保存。休息地は kind=rest の行程として開始・終了時刻とともに保存し、既存の版履歴・印刷・JSONにも反映する。発行済み版は変更しない。

