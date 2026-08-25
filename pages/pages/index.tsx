import type { RemixNode } from "remix/ui";

import { base } from "../lib/base.ts";
import { Link } from "../lib/link.tsx";
import { Simulator } from "../islands/simulator.tsx";

export const title = "Facebook パララックス画像シミュレータ";
export const description =
  "2 枚の画像を縦ストライプで交互に並べ、ジグザグの深度マップを付けた「レンチキュラー風」パララックス画像を、ブラウザだけで生成します。";

/** The whole tool is one island; the page around it is static. */
export const islands: readonly string[] = ["simulator"];

export default function Home(): RemixNode {
  return (
    <>
      <h1>Facebook パララックス画像シミュレータ</h1>
      <p class="lead">
        2
        枚の画像を縦に細く切り刻んで交互に並べ、その切れ目に合わせたジグザグの深度マップを添えます。
        深度に応じて横にずらす描画をされると、見る角度によって一方の画像がもう一方を覆い隠す
        ——レンチキュラー印刷と同じことが起きるはずです。それを Facebook
        で試すための、 生成器と見え方のシミュレータです。
      </p>
      <p>
        処理はすべてブラウザの中で完結します。アップロードも通信も行いません。仕組みの詳細は
        {" "}
        <Link href={`${base}/how-it-works`}>仕組みのページ</Link>にあります。
      </p>

      <Simulator />

      <section class="panel">
        <h2>Facebook に上げてみる</h2>
        <p class="panel-note">
          Facebook
          がどの形式の深度マップを、いつ受け付けるのかは公開されていません。
          以下は確実な手順ではなく、試す順番の提案です。
        </p>
        <ol class="steps">
          <li>
            <strong>2 ファイルを同時に投稿する。</strong> <code>名前.jpg</code>
            {" "}
            と <code>名前_depth.jpg</code>{" "}
            を 1 つの投稿にまとめて添付します。この命名の組を 3D
            写真として扱う挙動が、
            以前から知られている一番手軽な方法です。深度マップの形式を JPEG
            にしてから保存してください。
          </li>
          <li>
            <strong>深度を埋め込んだ 1 枚を投稿する。</strong>{" "}
            <code>名前_gdepth.jpg</code> は、Google カメラ由来の{" "}
            <code>GDepth</code>{" "}
            XMP として深度マップを JPEG の中に入れたものです。ファイルは 1
            つで済みます。
          </li>
          <li>
            <strong>結果を見て、ゲインを詰める。</strong>{" "}
            平坦に見えるならストライプが細すぎるか、深度が効いていません。 2
            枚が混ざって見えるなら、視差の量がストライプ幅に足りていません。
            シミュレータのゲインを動かして、どのくらいの視差量ならきれいに切り替わるかを先に把握しておくと、
            ストライプ幅の当たりが付けやすくなります。
          </li>
        </ol>
        <p class="panel-note">
          どの経路でも、投稿時に画像は縮小・再圧縮されます。ストライプが細いほどそこで消えます。
          まずは太め（16 px 前後）から始めるのが安全です。
        </p>
      </section>
    </>
  );
}
