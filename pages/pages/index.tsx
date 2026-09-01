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
          <strong>見られているのは深度マップだけです。</strong>{" "}
          普通の写真にジグザグの深度を付ければ失敗し、縞の合成画像になだらかな勾配を付ければ
          <strong>3D 写真になります</strong>。
          色画像は何でも構いません——縦縞も、継ぎ目のぼかしも、結果を動かしませんでした。
        </p>
        <p class="panel-note">
          条件はジグザグの細かさひとつです。Facebook は深度マップを幅{" "}
          <code>1200 px</code>{" "}
          まで縮めてから読むので、そこへ換算したストライプ幅が波形ごとの下限
          （三角波なら <code>32 px</code>）を下回ると、
          <code>Failed to create your 3D Photo</code>{" "}
          で返ってきます。出力幅を広げれば下限も比例して上がるので、
          <strong>解像度を上げても縞の本数は増えません</strong>。
          このツールのスライダーは、その下限より細い値を選べないようにしてあります。詳しくは
          {" "}
          <Link href={`${base}/how-it-works`}>仕組みのページ</Link>に。
        </p>
        <ol class="steps">
          <li>
            <strong>まず既定のまま上げてみる。</strong>{" "}
            三角波・幅 1200 px・ストライプ 32 px
            は、通ることが確かめてあります。 コンポーザに 2 枚を添付した時点で
            3D 写真になるかどうかが出るので、投稿しなくても判定は読めます。
          </li>
          <li>
            <strong>細くしたいなら鋸歯波にする。</strong> 下限が{" "}
            <code>17 px</code>{" "}
            と最も細く、三角波の半分の本数まで詰められます。 ただし 1
            周期に一度、深度が崖のように落ちます。
          </li>
          <li>
            <strong>互いに似た 2 枚の実写で試す。</strong>{" "}
            受理には関係ありませんが、見え方には効きます。サンプル画像は青とオレンジで、
            混ぜるとバーコードになります。同じ場所を撮った 2
            枚のように元が似ていれば、
            傾けていない状態でも普通の写真に見えます。
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
          深度を埋め込んだ単一 JPEG（<code>GDepth</code>{" "}
          XMP）は 3D
          写真として検出されません。検出の経路はファイルのペアだけです。
        </p>
      </section>
    </>
  );
}
