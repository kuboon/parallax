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
          ここまでに分かっていること。<code>名前.jpg</code> と{" "}
          <code>名前_depth.png</code>{" "}
          を同時に投稿すると、ペアとしては<strong>検出されます</strong>——
          Facebook 側の 3D 写真作成が実際に呼ばれます。ただしその作成が
          <strong>サーバー側で失敗します</strong>。深度マップをジグザグから
          ありふれた勾配に差し替えても同じでした。深度を埋め込んだ単一 JPEG
          （<code>GDepth</code>{" "}
          XMP）のほうは、そもそも 3D 写真として検出されません。
        </p>
        <ol class="steps">
          <li>
            <strong>まず、3D 写真の作成そのものが今も動くかを確かめる。</strong>
            {" "}
            iPhone のポートレートモードで撮った写真など、Facebook が 3D
            写真化を提案してくれる既知の素材で 1 枚試します。
            これが失敗するなら、こちらが何を作っても通りません。機能自体の問題です。
            道具を使わずに今すぐ確かめられて、いちばん情報量が大きい一手です。
          </li>
          <li>
            <strong>診断モードを「画像も深度も平凡に」にして投稿する。</strong>
            {" "}
            画像 A がそのまま出て、深度マップは勾配になります。
            このツールらしさは、エンコーダとファイル名以外に何も残りません。
            それでも拒否されるなら、拒否の理由はこちらが作ったものの側にはありません。
          </li>
          <li>
            <strong>通ったら、診断モードを戻していく。</strong>{" "}
            「深度だけ平凡に」で通れば縞の画像は受け入れられており、
            「オフ」で落ちるならジグザグの中身が原因です。
            どこで落ちるかが、そのまま原因の場所です。
          </li>
          <li>
            <strong>3D になったら、ゲインを詰める。</strong>{" "}
            平坦に見えるならストライプが細すぎるか、深度が効いていません。 2
            枚が混ざって見えるなら、視差の量がストライプ幅に足りていません。
            シミュレータのゲインを動かして、どのくらいの視差量ならきれいに切り替わるかを先に把握しておくと、
            ストライプ幅の当たりが付けやすくなります。
          </li>
        </ol>
        <p class="panel-note">
          どの経路でも、投稿時に画像は縮小・再圧縮されます。ストライプが細いほどそこで消えます。
          デフォルトの 16 px
          より細くするのは、何かが通ることを確認してからにしてください。
        </p>
      </section>
    </>
  );
}
