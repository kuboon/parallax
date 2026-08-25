/**
 * The tool, as one island.
 *
 * Two images go in, a strip pattern and a matching zigzag depth map come out, and in between a
 * canvas shows what a parallax viewer would do with the pair — because the only way to pick a strip
 * width and a depth contrast is to watch the flip happen.
 *
 * State lives in this closure rather than in props: the island takes none, so nothing has to be
 * serialised into the document, and the server renders the same empty frame every visitor starts
 * from. Everything expensive is deferred to the animation frame, so dragging a slider queues one
 * rebuild rather than one per pixel of travel.
 */

import { on, ref } from "remix/ui";
import type { Handle } from "remix/ui";
import { island } from "@kuboon/remix-ssg/client";

import { embedDepthMap } from "../lib/jpeg-xmp.ts";
import { encodeGreyscalePng } from "../lib/png.ts";
import {
  clamp,
  CLEAN_SHIFT_FACTOR,
  DEFAULT_PATTERN,
  matchedShift,
  WAVEFORMS,
} from "../lib/pattern.ts";
import type { Waveform } from "../lib/pattern.ts";

import type { Encoded } from "./imaging.ts";
import {
  download,
  encode,
  loadSource,
  paint,
  sampleImages,
  sourceFromPixels,
} from "./imaging.ts";
import { MAX_OUTPUT_WIDTH, MIN_STRIP_WIDTH, Pipeline } from "./pipeline.ts";
import type { Output, Settings } from "./pipeline.ts";

/** Japanese labels for the waveforms, in the order `WAVEFORMS` lists them. */
const WAVEFORM_LABELS: Record<Waveform, string> = {
  triangle: "三角波",
  sawtooth: "のこぎり波",
  square: "矩形波",
  sine: "正弦波",
};

/** How long one back-and-forth sweep takes while the view is animating, in milliseconds. */
const SWEEP_PERIOD = 3200;

/** Reads a number out of whatever input fired the event. */
function numberFrom(event: Event): number {
  return Number((event.currentTarget as HTMLInputElement).value);
}

/** Reads a checkbox out of whatever input fired the event. */
function checkedFrom(event: Event): boolean {
  return (event.currentTarget as HTMLInputElement).checked;
}

export const Simulator = island(
  "simulator",
  "Simulator",
  function Simulator(handle: Handle<Record<never, never>>) {
    const pipeline = new Pipeline();

    const settings: Settings = {
      // A copy, not the shared object: the controls below write straight into it.
      pattern: { ...DEFAULT_PATTERN },
      outputWidth: 1200,
      gain: Math.round(matchedShift(DEFAULT_PATTERN) * CLEAN_SHIFT_FACTOR),
      view: 0,
      depthBlur: 0,
      baseName: "parallax",
      depthType: "image/png",
    };

    let animating = true;
    let status = "";
    let busy = false;

    // Set when something upstream of the canvases has changed; consumed on the next frame.
    let needsRebuild = false;
    let needsRedraw = false;

    let viewCanvas: HTMLCanvasElement | undefined;
    let colourCanvas: HTMLCanvasElement | undefined;
    let depthCanvas: HTMLCanvasElement | undefined;
    let viewSlider: HTMLInputElement | undefined;
    let gainSlider: HTMLInputElement | undefined;

    /** The gain at which the strips close up cleanly, given the current pattern. */
    function suggestedGain(): number {
      return Math.round(matchedShift(settings.pattern) * CLEAN_SHIFT_FACTOR);
    }

    /** Re-cuts the strips and redraws everything, on the next frame. */
    function invalidate(): void {
      pipeline.invalidate();
      needsRebuild = true;
      needsRedraw = true;
    }

    /** Says something in the status line and re-renders to show it. */
    function say(message: string): void {
      status = message;
      handle.update();
    }

    /**
     * Runs the rebuild and the view render, at most once per animation frame.
     *
     * Both are heavy enough at full output size to drop frames if a slider drove them directly, and
     * neither is worth doing twice for two changes the user made in the same gesture.
     */
    function startFrameLoop(signal: AbortSignal): void {
      let request = 0;

      const frame = (time: number) => {
        if (signal.aborted) return;
        request = requestAnimationFrame(frame);

        if (needsRebuild) {
          needsRebuild = false;
          const output = pipeline.rebuild(settings);
          if (output !== null) {
            if (colourCanvas !== undefined) paint(colourCanvas, output.colour);
            if (depthCanvas !== undefined) paint(depthCanvas, output.depth);
            // The rest of the page reads the generated size and enables the download buttons.
            handle.update();
          }
          needsRedraw = true;
        }

        if (animating) {
          settings.view = Math.sin((time * 2 * Math.PI) / SWEEP_PERIOD);
          if (viewSlider !== undefined) {
            viewSlider.value = String(Math.round(settings.view * 100));
          }
          needsRedraw = true;
        }

        if (needsRedraw && viewCanvas !== undefined) {
          needsRedraw = false;
          pipeline.renderView(viewCanvas, settings);
        }
      };

      request = requestAnimationFrame(frame);
      signal.addEventListener("abort", () => cancelAnimationFrame(request));
    }

    /** Loads a picked or dropped file into one of the two slots. */
    async function accept(slot: 0 | 1, file: File | undefined): Promise<void> {
      if (file === undefined) return;
      if (!file.type.startsWith("image/")) {
        say(`${file.name} は画像ではないようです。`);
        return;
      }

      try {
        pipeline.setSource(slot, await loadSource(file));
        invalidate();
        say("");
      } catch {
        say(`${file.name} を読み込めませんでした。`);
      }
    }

    /** Fills both slots with the built-in pair, so the tool works before you have chosen anything. */
    async function loadSamples(): Promise<void> {
      const [a, b] = sampleImages(1200, 900);
      pipeline.setSource(0, await sourceFromPixels(a, "sample-a.png"));
      pipeline.setSource(1, await sourceFromPixels(b, "sample-b.png"));
      invalidate();
      say("サンプル画像を読み込みました。");
    }

    /**
     * Encodes the depth map.
     *
     * PNG goes through this project's own writer rather than the canvas, because a canvas only
     * emits RGBA: three copies of the same number plus an alpha channel nobody asked for. A depth
     * map is one channel, and a reader that checks is entitled to say so.
     */
    async function encodeDepth(output: Output): Promise<Encoded> {
      if (settings.depthType === "image/jpeg") {
        return await encode(output.depth, "image/jpeg");
      }

      return {
        bytes: await encodeGreyscalePng(
          output.grey,
          output.width,
          output.height,
        ),
        type: "image/png",
      };
    }

    /** Writes out the colour image and the depth map as two files. */
    async function downloadPair(): Promise<void> {
      const output = pipeline.output;
      if (output === null || busy) return;

      busy = true;
      say("書き出しています…");
      try {
        const colour = await encode(output.colour, "image/jpeg");
        const depth = await encodeDepth(output);
        const suffix = settings.depthType === "image/png" ? "png" : "jpg";

        download(colour.bytes, colour.type, `${settings.baseName}.jpg`);
        // Browsers throttle a second download fired in the same tick as the first.
        await new Promise((resolve) => setTimeout(resolve, 400));
        download(
          depth.bytes,
          depth.type,
          `${settings.baseName}_depth.${suffix}`,
        );
        say(
          `${settings.baseName}.jpg と ${settings.baseName}_depth.${suffix} を保存しました。`,
        );
      } catch (error) {
        say(`書き出しに失敗しました: ${describe(error)}`);
      } finally {
        busy = false;
        handle.update();
      }
    }

    /** Writes out a single JPEG with the depth map inside it as `GDepth` XMP. */
    async function downloadEmbedded(): Promise<void> {
      const output = pipeline.output;
      if (output === null || busy) return;

      busy = true;
      say("深度マップを埋め込んでいます…");
      try {
        const colour = await encode(output.colour, "image/jpeg");
        const depth = await encodeDepth(output);
        const bytes = embedDepthMap(colour.bytes, depth.bytes, {
          mime: depth.type,
        });

        download(bytes, "image/jpeg", `${settings.baseName}_gdepth.jpg`);
        say(
          `${settings.baseName}_gdepth.jpg を保存しました (${
            Math.round(bytes.length / 1024)
          } KB)。`,
        );
      } catch (error) {
        say(`埋め込みに失敗しました: ${describe(error)}`);
      } finally {
        busy = false;
        handle.update();
      }
    }

    /** One of the two source slots: a drop target, a file picker and a thumbnail. */
    function slot(index: 0 | 1) {
      const source = pipeline.sources[index];
      const letter = index === 0 ? "A" : "B";

      return (
        <label
          class={`slot${source === null ? " slot-empty" : ""}`}
          mix={[
            on("dragover", (event) => event.preventDefault()),
            on("drop", (event) => {
              event.preventDefault();
              void accept(index, (event as DragEvent).dataTransfer?.files[0]);
            }),
          ]}
        >
          <span class="slot-tag">画像 {letter}</span>
          {source === null
            ? <span class="slot-hint">クリックまたはドロップ</span>
            : (
              <>
                <img
                  class="slot-thumb"
                  src={source.previewUrl}
                  alt={source.name}
                />
                <span class="slot-name">{source.name}</span>
              </>
            )}
          <input
            type="file"
            accept="image/*"
            class="slot-input"
            mix={[on("change", (event) => {
              void accept(
                index,
                (event.currentTarget as HTMLInputElement).files?.[0],
              );
            })]}
          />
        </label>
      );
    }

    return () => {
      const output = pipeline.output;
      const ready = pipeline.ready;
      const suggested = suggestedGain();
      const period = settings.pattern.stripWidth * 2;

      return (
        <div class="sim">
          <section class="panel">
            <h2>1. 画像を 2 枚</h2>
            <p class="panel-note">
              同じ場所を撮った 2
              枚である必要はありません。視差のない別々の写真を、縦のストライプで交互に並べます。
            </p>
            <div class="slots">
              {slot(0)}
              {slot(1)}
            </div>
            <div class="row">
              <button
                type="button"
                class="button"
                mix={[on("click", () => void loadSamples())]}
              >
                サンプル画像を読み込む
              </button>
              <button
                type="button"
                class="button ghost"
                disabled={!ready}
                mix={[on("click", () => {
                  pipeline.swapSources();
                  invalidate();
                  handle.update();
                })]}
              >
                A と B を入れ替え
              </button>
            </div>
          </section>

          <section class="panel">
            <h2>2. ストライプと深度</h2>
            <div class="fields">
              <div class="field">
                <span class="field-label">
                  ストライプ幅
                  <output>
                    {settings.pattern.stripWidth} px（周期 {period} px）
                  </output>
                </span>
                <input
                  type="range"
                  min={String(MIN_STRIP_WIDTH)}
                  max="48"
                  step="1"
                  defaultValue={String(settings.pattern.stripWidth)}
                  mix={[on("input", (event) => {
                    settings.pattern.stripWidth = numberFrom(event);
                    settings.gain = suggestedGain();
                    if (gainSlider !== undefined) {
                      gainSlider.value = String(settings.gain);
                    }
                    invalidate();
                    handle.update();
                  })]}
                />
                <p class="field-note">
                  細いほど画素の混ざりは目立ちませんが、Facebook
                  側の再エンコードで潰れやすくなります。
                </p>
              </div>

              <div class="field">
                <span class="field-label">深度の波形</span>
                <div class="choices">
                  {WAVEFORMS.map((waveform) => (
                    <label key={waveform} class="choice">
                      <input
                        type="radio"
                        name="waveform"
                        value={waveform}
                        defaultChecked={settings.pattern.waveform === waveform}
                        mix={[on("change", () => {
                          settings.pattern.waveform = waveform;
                          settings.gain = suggestedGain();
                          if (gainSlider !== undefined) {
                            gainSlider.value = String(settings.gain);
                          }
                          invalidate();
                          handle.update();
                        })]}
                      />
                      <span>{WAVEFORM_LABELS[waveform]}</span>
                    </label>
                  ))}
                </div>
                <p class="field-note">
                  三角波が本命です。ストライプの片側で伸び、もう片側で縮むので、切れ目のないレンチキュラーになります。
                </p>
              </div>

              <div class="field">
                <span class="field-label">
                  深度コントラスト<output>
                    {Math.round(settings.pattern.contrast * 100)} %
                  </output>
                </span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  defaultValue={String(
                    Math.round(settings.pattern.contrast * 100),
                  )}
                  mix={[on("input", (event) => {
                    settings.pattern.contrast = numberFrom(event) / 100;
                    settings.gain = suggestedGain();
                    if (gainSlider !== undefined) {
                      gainSlider.value = String(settings.gain);
                    }
                    invalidate();
                    handle.update();
                  })]}
                />
                <p class="field-note">
                  深度マップが使う階調の幅です。狭めると必要な視差量が増えます。
                </p>
              </div>

              <div class="field">
                <span class="field-label">
                  位相<output>{settings.pattern.phase} px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="47"
                  step="1"
                  defaultValue={String(settings.pattern.phase)}
                  mix={[on("input", (event) => {
                    settings.pattern.phase = numberFrom(event);
                    invalidate();
                    handle.update();
                  })]}
                />
              </div>

              <div class="field">
                <span class="field-label">
                  出力幅<output>
                    {output === null
                      ? `${settings.outputWidth} px`
                      : `${output.width} × ${output.height} px`}
                  </output>
                </span>
                <input
                  type="range"
                  min="400"
                  max={String(MAX_OUTPUT_WIDTH)}
                  step="100"
                  defaultValue={String(settings.outputWidth)}
                  mix={[on("input", (event) => {
                    settings.outputWidth = numberFrom(event);
                    invalidate();
                    handle.update();
                  })]}
                />
              </div>
            </div>
            <label class="choice">
              <input
                type="checkbox"
                defaultChecked={settings.pattern.invert}
                mix={[on("change", (event) => {
                  settings.pattern.invert = checkedFrom(event);
                  invalidate();
                  handle.update();
                })]}
              />
              <span>深度を反転（白が手前 ⇄ 黒が手前）</span>
            </label>
            <label class="choice">
              <input
                type="checkbox"
                defaultChecked={settings.pattern.diagnostic}
                mix={[on("change", (event) => {
                  settings.pattern.diagnostic = checkedFrom(event);
                  invalidate();
                  handle.update();
                })]}
              />
              <span>
                診断モード:
                深度マップを全面のなだらかな勾配にする（効果は出ません）
              </span>
            </label>
            {settings.pattern.diagnostic
              ? (
                <p class="field-note">
                  ストライプはそのまま、深度マップだけを「ありふれた深度マップ」に差し替えます。
                  投稿が失敗したときに、<strong>
                    ファイルが拒否されているのか、ジグザグの中身が拒否されているのか
                  </strong>
                  を切り分けるためのものです。これが通ればファイル形式は問題なく、通らなければ形式の側を疑うことになります。
                </p>
              )
              : null}
          </section>

          <section class="panel">
            <h2>3. 見え方のシミュレーション</h2>
            <p class="panel-note">
              深度に比例して横にずらし、手前のものを優先して描いています。Facebook
              の実装は公開されていないので、
              ゲインは実測で合わせる前提の自由変数です。
            </p>
            <div
              class="stage"
              mix={[on("pointermove", (event) => {
                if (animating) return;
                const box = (event.currentTarget as HTMLElement)
                  .getBoundingClientRect();
                settings.view = clamp(
                  ((event as PointerEvent).clientX - box.left) / box.width * 2 -
                    1,
                  -1,
                  1,
                );
                if (viewSlider !== undefined) {
                  viewSlider.value = String(Math.round(settings.view * 100));
                }
                needsRedraw = true;
              })]}
            >
              <canvas
                class="stage-canvas"
                mix={[ref((node, signal) => {
                  viewCanvas = node as HTMLCanvasElement;
                  startFrameLoop(signal);
                })]}
              >
              </canvas>
              {output === null
                ? <p class="stage-empty">画像を 2 枚選ぶと、ここで動きます。</p>
                : null}
            </div>

            <div class="fields">
              <div class="field">
                <span class="field-label">
                  視差ゲイン<output>±{Math.round(settings.gain)} px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="160"
                  step="1"
                  defaultValue={String(Math.round(settings.gain))}
                  mix={[
                    ref((node) => {
                      gainSlider = node as HTMLInputElement;
                    }),
                    on("input", (event) => {
                      settings.gain = numberFrom(event);
                      needsRedraw = true;
                      handle.update();
                    }),
                  ]}
                />
                <p class="field-note">
                  ストライプがちょうど閉じるのは ±{suggested} px 付近です。{" "}
                  <button
                    type="button"
                    class="link"
                    mix={[on("click", () => {
                      settings.gain = suggested;
                      if (gainSlider !== undefined) {
                        gainSlider.value = String(suggested);
                      }
                      needsRedraw = true;
                      handle.update();
                    })]}
                  >
                    合わせる
                  </button>
                </p>
              </div>

              <div class="field">
                <span class="field-label">
                  深度マップのぼかし<output>{settings.depthBlur} px</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max="24"
                  step="1"
                  defaultValue={String(settings.depthBlur)}
                  mix={[on("input", (event) => {
                    settings.depthBlur = numberFrom(event);
                    needsRedraw = true;
                    handle.update();
                  })]}
                />
                <p class="field-note">
                  受け取り側が深度マップを平滑化した場合の想定です。上げるほど縞は効かなくなります。
                </p>
              </div>

              <div class="field">
                <span class="field-label">視点</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="1"
                  defaultValue="0"
                  mix={[
                    ref((node) => {
                      viewSlider = node as HTMLInputElement;
                    }),
                    on("input", (event) => {
                      animating = false;
                      settings.view = numberFrom(event) / 100;
                      needsRedraw = true;
                      handle.update();
                    }),
                  ]}
                />
                <label class="choice">
                  <input
                    type="checkbox"
                    defaultChecked={animating}
                    mix={[on("change", (event) => {
                      animating = checkedFrom(event);
                      needsRedraw = true;
                      handle.update();
                    })]}
                  />
                  <span>
                    自動で振る（止めるとプレビュー上のマウス位置で動かせます）
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section class="panel">
            <h2>4. 書き出し</h2>
            <div class="outputs">
              <figure>
                <canvas
                  class="thumb"
                  mix={[ref((node) => {
                    colourCanvas = node as HTMLCanvasElement;
                    if (output !== null) paint(colourCanvas, output.colour);
                  })]}
                >
                </canvas>
                <figcaption>合成画像（ストライプ）</figcaption>
              </figure>
              <figure>
                <canvas
                  class="thumb"
                  mix={[ref((node) => {
                    depthCanvas = node as HTMLCanvasElement;
                    if (output !== null) paint(depthCanvas, output.depth);
                  })]}
                >
                </canvas>
                <figcaption>深度マップ（ジグザグ）</figcaption>
              </figure>
            </div>

            <div class="fields">
              <div class="field">
                <span class="field-label">ファイル名</span>
                <input
                  type="text"
                  class="text"
                  defaultValue={settings.baseName}
                  mix={[on("input", (event) => {
                    const name = (event.currentTarget as HTMLInputElement).value
                      .trim();
                    settings.baseName = name === "" ? "parallax" : name;
                  })]}
                />
                <p class="field-note">
                  深度マップは同じ名前に <code>_depth</code>{" "}
                  を付けて保存します。
                </p>
              </div>

              <div class="field">
                <span class="field-label">深度マップの形式</span>
                <div class="choices">
                  {(["image/png", "image/jpeg"] as const).map((type) => (
                    <label key={type} class="choice">
                      <input
                        type="radio"
                        name="depth-type"
                        value={type}
                        defaultChecked={settings.depthType === type}
                        mix={[on("change", () => {
                          settings.depthType = type;
                          handle.update();
                        })]}
                      />
                      <span>
                        {type === "image/png" ? "PNG（劣化なし）" : "JPEG"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div class="row">
              <button
                type="button"
                class="button"
                disabled={output === null || busy}
                mix={[on("click", () => void downloadPair())]}
              >
                画像と深度マップを保存
              </button>
              <button
                type="button"
                class="button ghost"
                disabled={output === null || busy}
                mix={[on("click", () => void downloadEmbedded())]}
              >
                深度を埋め込んだ JPEG（実験）
              </button>
            </div>
            {status === "" ? null : <p class="status">{status}</p>}
          </section>
        </div>
      );
    };
  },
);

/** Turns whatever was thrown into something worth putting in the status line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
