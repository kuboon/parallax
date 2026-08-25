import { assertEquals } from "@std/assert";

import {
  CLEAN_SHIFT_FACTOR,
  DEFAULT_PATTERN,
  depthProfile,
  matchedShift,
  stripSource,
} from "./pattern.ts";
import type { Pattern } from "./pattern.ts";
import { applyColumnMapping, blurProfile, columnMapping } from "./warp.ts";

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return { ...DEFAULT_PATTERN, ...overrides };
}

/**
 * How much of the frame shows one of the two images, once the view has been warped.
 *
 * The edges are left out: there the warp has pulled content in from beyond the frame and the gap
 * filling has the last word, which says nothing about the pattern.
 */
function share(p: Pattern, shift: number, which: 0 | 1): number {
  const period = p.stripWidth * 2;
  const width = period * 16;
  const margin = period * 3;

  const mapping = columnMapping(depthProfile(width, p), shift);
  const middle = [...mapping].slice(margin, width - margin);
  return middle.filter((x) => stripSource(x, p) === which).length /
    middle.length;
}

Deno.test("a flat depth map moves nothing", () => {
  const flat = new Uint8Array(16);
  assertEquals([...columnMapping(flat, 12)], [...Array(16).keys()]);
});

Deno.test("with no shift the interlaced strips are untouched", () => {
  assertEquals(share(pattern(), 0, 0), 0.5);
});

Deno.test("overshooting the matched shift hands the whole frame to one image", () => {
  const p = pattern();
  const shift = matchedShift(p) * CLEAN_SHIFT_FACTOR;

  assertEquals(share(p, shift, 0), 1);
  assertEquals(share(p, -shift, 1), 1);
});

Deno.test("at exactly the matched shift, one column per period is still left over", () => {
  const p = pattern();
  // The fold between two strips resolves to a column of the strip that should have closed up.
  assertEquals(share(p, matchedShift(p), 0), 1 - 1 / (2 * p.stripWidth));
});

Deno.test("half way there, both images are on screen", () => {
  const visible = share(pattern(), matchedShift(pattern()) / 2, 0);
  assertEquals(
    visible > 0.5 && visible < 1,
    true,
    `expected a mix, got ${visible}`,
  );
});

Deno.test("swapping the images swaps which shift reveals which", () => {
  const p = pattern({ swap: true });
  assertEquals(share(p, matchedShift(p) * CLEAN_SHIFT_FACTOR, 1), 1);
});

Deno.test("inverting the depth map reverses the direction that reveals an image", () => {
  const p = pattern({ invert: true });
  assertEquals(share(p, -matchedShift(p) * CLEAN_SHIFT_FACTOR, 0), 1);
});

Deno.test("a finer strip pattern needs proportionally less shift", () => {
  for (const stripWidth of [4, 6, 8, 16, 24]) {
    const p = pattern({ stripWidth });
    const shift = matchedShift(p) * CLEAN_SHIFT_FACTOR;
    assertEquals(
      share(p, shift, 0),
      1,
      `strip width ${stripWidth} did not resolve cleanly`,
    );
  }
});

Deno.test("every destination column resolves to a real source column", () => {
  for (const waveform of ["triangle", "sawtooth", "square", "sine"] as const) {
    const profile = depthProfile(64, pattern({ waveform }));
    for (const shift of [-40, -3, 0, 3, 40]) {
      for (const from of columnMapping(profile, shift)) {
        assertEquals(
          from >= 0 && from < 64,
          true,
          `${waveform} at ${shift} produced ${from}`,
        );
      }
    }
  }
});

Deno.test("the mapping paints whole pixels through", () => {
  const source = new Uint8ClampedArray([
    1,
    2,
    3,
    255,
    4,
    5,
    6,
    255,
    7,
    8,
    9,
    255,
    10,
    11,
    12,
    255,
  ]);
  const target = new Uint8ClampedArray(source.length);
  applyColumnMapping(source, 2, 2, Int32Array.from([1, 1]), target);

  assertEquals([...target], [
    4,
    5,
    6,
    255,
    4,
    5,
    6,
    255,
    10,
    11,
    12,
    255,
    10,
    11,
    12,
    255,
  ]);
});

Deno.test("blurring flattens the pattern towards mid grey", () => {
  const profile = depthProfile(64, pattern());
  assertEquals([...blurProfile(profile, 0)], [...profile]);

  for (const value of blurProfile(profile, 8).slice(16, 48)) {
    assertEquals(
      Math.abs(value - 128) < 16,
      true,
      `still ${value} away from flat`,
    );
  }
});
