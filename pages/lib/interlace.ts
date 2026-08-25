/**
 * Cutting two images into vertical strips and interleaving them.
 *
 * Both inputs are RGBA pixel buffers of the same size — the caller has already fitted whatever the
 * user dropped onto a common canvas. The strip a column comes from is decided by `pattern.ts`, so
 * the cut and the depth map can never drift apart.
 */

import { stripSource } from "./pattern.ts";
import type { Pattern } from "./pattern.ts";

/**
 * Views an RGBA buffer one pixel per element.
 *
 * Whole pixels are copied and never taken apart, so the byte order inside an element is nobody's
 * business here — only that there are a quarter as many of them. An `ImageData` buffer is always
 * aligned, but a hand-made subarray need not be, hence the fallback.
 *
 * @param bytes An RGBA buffer
 * @returns A 32-bit view of it, or a copy when the buffer is not 4-byte aligned
 */
function pixelView(bytes: Uint8ClampedArray): Uint32Array {
  if (bytes.byteOffset % 4 === 0) {
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  }
  return new Uint32Array(bytes.slice().buffer);
}

/**
 * Interleaves two same-sized RGBA buffers column by column.
 *
 * @param a Image on the flank the depth ramps up across
 * @param b Image on the other flank
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param pattern The strip pattern
 * @returns A new RGBA buffer of the interlaced image
 */
export function interlace(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  pattern: Pattern,
): Uint8ClampedArray<ArrayBuffer> {
  const expected = width * height * 4;
  if (a.length !== expected || b.length !== expected) {
    throw new Error(
      `interlace() needs two ${width}x${height} RGBA buffers (${expected} bytes), ` +
        `got ${a.length} and ${b.length}.`,
    );
  }

  const out = new Uint8ClampedArray(expected);
  const source = [pixelView(a), pixelView(b)];
  const target = new Uint32Array(out.buffer);

  // The pattern repeats every column, so decide the source once per column and reuse it per row.
  const from = new Uint8Array(width);
  for (let x = 0; x < width; x++) from[x] = stripSource(x, pattern);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      target[row + x] = source[from[x]][row + x];
    }
  }

  return out;
}

/**
 * Expands a per-column depth profile into one luminance byte per pixel.
 *
 * This is the depth map as a depth map — a single channel, which is what the file written for a
 * viewer should carry. {@link depthImage} is the RGBA sibling, for putting on a canvas.
 *
 * @param profile One depth byte per column
 * @param height Image height in pixels
 * @returns A new buffer of `profile.length * height` bytes
 */
export function depthGrey(
  profile: Uint8Array,
  height: number,
): Uint8Array {
  const width = profile.length;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) out.set(profile, y * width);
  return out;
}

/**
 * Expands a per-column depth profile into a greyscale RGBA image.
 *
 * @param profile One depth byte per column
 * @param height Image height in pixels
 * @returns A new opaque RGBA buffer, each column filled with its depth value
 */
export function depthImage(
  profile: Uint8Array,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const width = profile.length;
  const stride = width * 4;
  const out = new Uint8ClampedArray(stride * height);

  for (let x = 0; x < width; x++) {
    const v = profile[x];
    out[x * 4] = v;
    out[x * 4 + 1] = v;
    out[x * 4 + 2] = v;
    out[x * 4 + 3] = 255;
  }

  const firstRow = out.subarray(0, stride);
  for (let y = 1; y < height; y++) out.set(firstRow, y * stride);

  return out;
}
