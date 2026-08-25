# parallax

Facebook のパララックス（3D 写真）表示で、レンチキュラー印刷のような
「見る角度で 2 枚の写真が入れ替わる」画像が作れるかを試すためのツールです。

2 枚の画像を縦のストライプに切って交互に並べ、その切れ目に合わせたジグザグの深度マップを
生成します。深度に比例して画素を横にずらす表示側の挙動をブラウザ上でシミュレートし、
どのくらいの視差量でストライプがきれいに切り替わるかを確かめてから書き出せます。

処理はすべてブラウザの中で完結します。画像はどこにも送信されません。

## 何をしているのか

深度が一定の傾きで変化する区間は、パララックス表示のもとでは
`1 + ゲイン × 傾き` 倍に拡縮されるだけのアフィン変換になります。
ストライプ A の上で深度を上げ、B の上で同じ傾きで下げる——三角波にすると、
A と B は必ず逆向きに拡縮します。ある角度で A が 2 倍に広がって B が幅 0 に潰れ、
反対の角度では役割が入れ替わる。これがレンチキュラーです。

詳細はサイトの「仕組み」ページと [`pages/lib/pattern.ts`](./pages/lib/pattern.ts) に書いてあります。

## 開発

```sh
cd pages
deno task dev     # http://localhost:8000
deno task test    # 生成ロジックのテスト
deno task check   # 型検査・lint・fmt・テスト
deno task build   # dist/ に静的サイトを生成
```

[Deno](https://deno.com) 2.x が必要です。サイトの構成は
[`pages/README.md`](./pages/README.md) を参照してください。

## デプロイ

`.github/workflows/pages.yml` が
`kuboon/workflows/.github/workflows/github-page-with-preview.yaml` を呼び出し、
`main` を GitHub Pages のルートに、各プルリクエストをプレビュー用のサブパスに配置します。
ビルドは [`mise`](https://mise.jdx.dev)（`mise.toml`）経由で Deno を入れ、
`BASE_URL` を渡して `deno task build` を実行します。

有効化するには **Settings → Pages → Build and deployment → Source: GitHub Actions**。
