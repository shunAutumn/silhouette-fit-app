---
project: silhouette-fit-app
status: active
tags: [web-app, github-pages]
---

# silhouette-fit-app（シルエット試着のスマホ用ウェブアプリ）

GitHub Pages（main ブランチの直下）で公開している。https://shunautumn.github.io/silhouette-fit-app/

- **ここのファイルは直接編集しない。** 本体は `C:\Users\major\AI\1-Projects\silhouette-fit\extension\`。
  そちらを直してから `silhouette-fit\tools\deploy-app.ps1` を実行すると、必要なファイルをここへコピーして commit・push する。
- `index.html` は `studio.html` のコピー（ホーム画面のアプリはここから開く）。
- 公開リポジトリなので、トークン・体のデータなど個人の情報は置かない。データは非公開リポジトリ `shunAutumn/silhouette-fit-data` に同期され、トークンは各端末のブラウザの中にだけ保存する。
- 人体モデル（`assets/human.*`）は MakeHuman の CC0 データを変換したもの。
- 反映まで数分かかる。利用者には「ホーム画面のアプリを完全に閉じて開き直してください」と伝える。
