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
          <strong>拒否されているのは合成画像です。</strong>診断モードを
          「画像も深度も平凡に」——普通の写真＋なだらかな勾配——にすると
          <strong>3D 写真になります</strong>。深度マップだけを勾配にしても
          （縞の画像のまま）失敗します。差は色画像だけなので、Facebook
          が拒んでいるのは
          縦縞そのものです。深度マップの中身が何であれ結果が変わらなかったのも、これで説明がつきます。
        </p>
        <p class="panel-note">
          裏を返せば、<strong>ファイルの側はすべて受理されています</strong>——8
          bit グレースケールの PNG、JPEG、<code>_depth</code>{" "}
          の命名、寸法。3D 写真の作成も生きています。残っているのは、
          縞をどこまで「写真らしく」できるかという一点です。
        </p>
        <ol class="steps">
          <li>
            <strong>互いに似た 2 枚の実写で試す。</strong>{" "}
            サンプル画像は青とオレンジで、混ぜるとバーコードになります。
            同じ場所を撮った 2
            枚のように元が似ていれば、合成画像は普通の写真に近づきます。
            コードを変えずに試せて、いちばん筋がいい一手です。
          </li>
          <li>
            <strong>ストライプを太くする。</strong>{" "}
            16 px は拒否されました。32、48、64 と上げていきます。
            相手が見ているのが空間周波数なら、どこかで通ります。
          </li>
          <li>
            <strong>境界をぼかす。</strong>{" "}
            継ぎ目を数ピクセルかけて溶かすと、一定周期の縦エッジが消えます。
            溶けた列はどの角度でも半々のままなので混信は増えますが、
            「縞に見えるかどうか」が争点ならここが効きます。
          </li>
          <li>
            <strong>通ったら、ゲインを詰める。</strong>{" "}
            平坦に見えるならストライプが細すぎるか、深度が効いていません。 2
            枚が混ざって見えるなら、視差の量がストライプ幅に足りていません。
            シミュレータのゲインを動かして、どのくらいの視差量ならきれいに切り替わるかを先に把握しておくと、
            ストライプ幅の当たりが付けやすくなります。
          </li>
        </ol>
        <p class="panel-note">
          どの経路でも、投稿時に画像は縮小・再圧縮されます。ストライプが細いほどそこで消えます。
          細くするのは、何かが通ることを確認してからにしてください。
        </p>
      </section>
    </>
  );
}
