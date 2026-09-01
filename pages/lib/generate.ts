/**
 * The generator, as one function over pixels.
 *
 * Both front ends end here: the island calls it on every settings change with pixels a canvas
 * fitted, and `cli.ts` calls it once per file it writes with pixels `frame.ts` fitted. Whatever
 * comes out of an upload experiment is therefore about the settings, never about which of the two
 * produced the file.
 */

import { depthGrey, depthImage, interlace } from "./interlace.ts";
import { depthProfile } from "./pattern.ts";
import type { Pattern } from "./pattern.ts";

/** The generated pair, in every form the callers want it in. */
export interface Output {
  readonly width: number;
  readonly height: number;
  /** The interlaced colour image. */
  readonly colour: ImageData;
  /** The zigzag, as a greyscale image for the screen. */
  readonly depth: ImageData;
  /** The same map as one luminance byte per pixel, which is what gets written to a file. */
  readonly grey: Uint8Array;
  /** The map as one byte per column, which is what the viewer model warps by. */
  readonly profile: Uint8Array;
}

/**
 * Cuts two fitted images into strips and writes the matching depth map.
 *
 * @param a Image on the flank the depth ramps up across
 * @param b Image on the other flank, the same size as `a`
 * @param pattern The strip pattern
 * @param plateOnly Leaves `a` whole instead of interlacing, for the last rung of the diagnostic
 *   ladder — a plain photograph, with only the depth map and the file names left of this tool
 * @returns The pair
 */
export function generate(
  a: ImageData,
  b: ImageData,
  pattern: Pattern,
  plateOnly = false,
): Output {
  const { width, height } = a;
  const colour = plateOnly ? a : new ImageData(
    interlace(a.data, b.data, width, height, pattern),
    width,
    height,
  );

  const profile = depthProfile(width, pattern);
  return {
    width,
    height,
    colour,
    depth: new ImageData(depthImage(profile, height), width, height),
    grey: depthGrey(profile, height),
    profile,
  };
}
