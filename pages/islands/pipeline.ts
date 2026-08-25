/**
 * The generator, as one object the UI can poke at.
 *
 * Three things happen at three different rates, and keeping them apart is the whole reason this is
 * not just a function: loading a source is rare and expensive, re-cutting the strips happens when a
 * setting moves, and re-rendering the view happens on every animation frame. Each step keeps its
 * result until something upstream of it changes.
 */

import { depthGrey, depthImage, interlace } from "../lib/interlace.ts";
import { clamp, depthProfile } from "../lib/pattern.ts";
import type { Pattern } from "../lib/pattern.ts";
import { applyColumnMapping, blurProfile, columnMapping } from "../lib/warp.ts";

import { asImageData, fitToFrame, paint, releaseSource } from "./imaging.ts";
import type { Source } from "./imaging.ts";

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
  /** Stem for the downloaded file names. */
  baseName: string;
  /** Encoding for the separate depth map file. */
  depthType: "image/png" | "image/jpeg";
}

/** Widest output the tool will generate; past this the browser is doing megapixels for nothing. */
export const MAX_OUTPUT_WIDTH = 2400;

/** Narrowest strip the warp resolves reliably on a pixel grid. */
export const MIN_STRIP_WIDTH = 4;

/** The generated pair, once both sources are in. */
export interface Output {
  readonly width: number;
  readonly height: number;
  /** The interlaced colour image. */
  readonly colour: ImageData;
  /** The zigzag, as a greyscale image for the screen. */
  readonly depth: ImageData;
  /** The same map as one luminance byte per pixel, which is what gets written to a file. */
  readonly grey: Uint8Array;
}

/**
 * Holds the sources, the generated pair, and the scratch buffer the view is drawn into.
 */
export class Pipeline {
  #sources: [Source | null, Source | null] = [null, null];
  #output: Output | null = null;
  #profile: Uint8Array | null = null;
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
    this.#profile = null;
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

    const colour = asImageData(
      interlace(
        fitToFrame(a.image, width, height).data,
        fitToFrame(b.image, width, height).data,
        width,
        height,
        settings.pattern,
      ),
      width,
      height,
    );

    this.#profile = depthProfile(width, settings.pattern);
    this.#output = {
      width,
      height,
      colour,
      depth: asImageData(depthImage(this.#profile, height), width, height),
      grey: depthGrey(this.#profile, height),
    };
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
    const profile = this.#profile;
    const frame = this.#frame;
    if (output === null || profile === null || frame === null) return;

    const radius = Math.round(settings.depthBlur);
    if (this.#blurred === null || this.#blurRadius !== radius) {
      this.#blurred = blurProfile(profile, radius);
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
