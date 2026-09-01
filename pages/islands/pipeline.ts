/**
 * The generator, as one object the UI can poke at.
 *
 * Three things happen at three different rates, and keeping them apart is the whole reason this is
 * not just a function: loading a source is rare and expensive, re-cutting the strips happens when a
 * setting moves, and re-rendering the view happens on every animation frame. Each step keeps its
 * result until something upstream of it changes.
 */

import { generate } from "../lib/generate.ts";
import type { Output } from "../lib/generate.ts";
import { clamp } from "../lib/pattern.ts";
import type { Pattern } from "../lib/pattern.ts";
import { applyColumnMapping, blurProfile, columnMapping } from "../lib/warp.ts";

import { fitToFrame, paint, releaseSource } from "./imaging.ts";
import type { Source } from "./imaging.ts";

export type { Output } from "../lib/generate.ts";

/**
 * How much of the tool's strangeness to strip out before shipping.
 *
 * The output is two unusual things at once: a colour image that is nothing but vertical stripes,
 * and a depth map that is a repeating zigzag. When something downstream refuses the pair, all it
 * says is that it refused; it does not say which half offended, or whether either did. These are
 * the rungs of a ladder that takes them away one at a time.
 *
 * - `off` — the real thing.
 * - `depth` — striped image, ordinary gradient depth map. Clears the depth map of suspicion.
 * - `both` — the first image untouched, ordinary gradient depth map. There is nothing left of this
 *   tool in the result except the encoder and the file names: a plain photograph and the sort of
 *   depth map anything would accept. If *this* is refused, the refusal is not about anything we
 *   generated.
 */
export type DiagnosticLevel = "off" | "depth" | "both";

/** The rungs, in the order the UI offers them. */
export const DIAGNOSTIC_LEVELS: readonly DiagnosticLevel[] = [
  "off",
  "depth",
  "both",
];

/** Everything the UI can set. */
export interface Settings {
  /** How the two images are cut and how deep the map claims they are. */
  pattern: Pattern;
  /** Width of the generated image in pixels; the height follows the first image's shape. */
  outputWidth: number;
  /** Displacement in pixels a viewer applies across the full depth range, at full deflection. */
  gain: number;
  /** Viewing angle, from `-1` to `1`. */
  view: number;
  /** How much the simulated viewer smooths the depth map before using it. */
  depthBlur: number;
  /** How much of the tool's own output to leave in, when working out what is being refused. */
  diagnostic: DiagnosticLevel;
  /** Stem for the downloaded file names. */
  baseName: string;
  /** Encoding for the separate depth map file. */
  depthType: "image/png" | "image/jpeg";
}

/** Widest output the tool will generate; past this the browser is doing megapixels for nothing. */
export const MAX_OUTPUT_WIDTH = 2400;

/**
 * Holds the sources, the generated pair, and the scratch buffer the view is drawn into.
 */
export class Pipeline {
  #sources: [Source | null, Source | null] = [null, null];
  #output: Output | null = null;
  #frame: ImageData | null = null;

  /** Depth profile the last view was rendered through, so a blur is not redone every frame. */
  #blurred: Uint8Array | null = null;
  #blurRadius = -1;

  /** The two sources, in the order they are interlaced. */
  get sources(): readonly [Source | null, Source | null] {
    return this.#sources;
  }

  /** The generated pair, or `null` until both sources are in and {@link rebuild} has run. */
  get output(): Output | null {
    return this.#output;
  }

  /** Whether there is enough to generate from. */
  get ready(): boolean {
    return this.#sources[0] !== null && this.#sources[1] !== null;
  }

  /** Replaces one of the two sources, discarding anything generated from the old one. */
  setSource(slot: 0 | 1, source: Source | null): void {
    const previous = this.#sources[slot];
    if (previous !== null) releaseSource(previous);
    this.#sources[slot] = source;
    this.invalidate();
  }

  /** Exchanges the two sources, so the other one is revealed first. */
  swapSources(): void {
    this.#sources = [this.#sources[1], this.#sources[0]];
    this.invalidate();
  }

  /** Drops the generated pair, so the next {@link rebuild} does the work again. */
  invalidate(): void {
    this.#output = null;
    this.#blurred = null;
    this.#blurRadius = -1;
  }

  /**
   * Cuts the two sources into strips and writes the matching depth map.
   *
   * @param settings The current settings
   * @returns The generated pair, or `null` when a source is still missing
   */
  rebuild(settings: Settings): Output | null {
    const [a, b] = this.#sources;
    if (a === null || b === null) return null;

    const width = Math.round(clamp(settings.outputWidth, 64, MAX_OUTPUT_WIDTH));
    const height = Math.max(
      1,
      Math.round((width * a.image.height) / a.image.width),
    );

    // The depth flag is derived, so the two halves of the ladder can never disagree.
    const pattern = {
      ...settings.pattern,
      diagnostic: settings.diagnostic !== "off",
    };

    this.#output = generate(
      fitToFrame(a.image, width, height),
      fitToFrame(b.image, width, height),
      pattern,
      settings.diagnostic === "both",
    );
    this.#frame = new ImageData(width, height);
    this.#blurred = null;
    this.#blurRadius = -1;

    return this.#output;
  }

  /**
   * Draws what a parallax viewer would show at the current angle.
   *
   * @param canvas Where to draw
   * @param settings The current settings
   */
  renderView(canvas: HTMLCanvasElement, settings: Settings): void {
    const output = this.#output;
    const frame = this.#frame;
    if (output === null || frame === null) return;

    const radius = Math.round(settings.depthBlur);
    if (this.#blurred === null || this.#blurRadius !== radius) {
      this.#blurred = blurProfile(output.profile, radius);
      this.#blurRadius = radius;
    }

    const mapping = columnMapping(this.#blurred, settings.gain * settings.view);
    applyColumnMapping(
      output.colour.data,
      output.width,
      output.height,
      mapping,
      frame.data,
    );
    paint(canvas, frame);
  }
}
