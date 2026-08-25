import { assertAlmostEquals, assertEquals } from "@std/assert";

import {
  DEFAULT_PATTERN,
  depthProfile,
  matchedShift,
  stripSource,
} from "./pattern.ts";
import type { Pattern } from "./pattern.ts";

function pattern(overrides: Partial<Pattern> = {}): Pattern {
  return { ...DEFAULT_PATTERN, stripWidth: 4, ...overrides };
}

Deno.test("strips alternate every stripWidth columns", () => {
  const p = pattern();
  const sources = Array.from({ length: 12 }, (_, x) => stripSource(x, p));
  assertEquals(sources, [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
});

Deno.test("swap exchanges the two images without moving the cut", () => {
  const p = pattern({ swap: true });
  const sources = Array.from({ length: 8 }, (_, x) => stripSource(x, p));
  assertEquals(sources, [1, 1, 1, 1, 0, 0, 0, 0]);
});

Deno.test("phase slides the cut, and negative phase does not wrap the wrong way", () => {
  const p = pattern({ phase: -2 });
  const sources = Array.from({ length: 8 }, (_, x) => stripSource(x, p));
  assertEquals(sources, [0, 0, 1, 1, 1, 1, 0, 0]);
});

Deno.test("the triangle peaks on the seam between the two strips", () => {
  const profile = depthProfile(8, pattern());
  assertEquals([...profile], [32, 96, 159, 223, 223, 159, 96, 32]);
});

Deno.test("the square wave is flat within each strip", () => {
  const profile = depthProfile(8, pattern({ waveform: "square" }));
  assertEquals([...profile], [0, 0, 0, 0, 255, 255, 255, 255]);
});

Deno.test("the sawtooth ramps once across the whole period", () => {
  const profile = depthProfile(8, pattern({ waveform: "sawtooth" }));
  assertEquals([...profile], [16, 48, 80, 112, 143, 175, 207, 239]);
});

Deno.test("contrast keeps the pattern centred on mid grey", () => {
  const full = depthProfile(8, pattern());
  const half = depthProfile(8, pattern({ contrast: 0.5 }));

  for (let x = 0; x < 8; x++) {
    assertAlmostEquals(half[x], 128 + (full[x] - 128) / 2, 1);
  }
});

Deno.test("invert turns near into far", () => {
  const plain = depthProfile(8, pattern());
  const inverted = depthProfile(8, pattern({ invert: true }));
  // Rounding lands mid grey on 128 either way round, so the pair sums to 255 give or take one.
  for (let x = 0; x < 8; x++) {
    assertAlmostEquals(inverted[x], 255 - plain[x], 1);
  }
});

Deno.test("the matched shift scales with strip width and contrast", () => {
  assertEquals(matchedShift(pattern({ stripWidth: 8 })), 8);
  assertEquals(matchedShift(pattern({ stripWidth: 8, contrast: 0.5 })), 16);
  assertEquals(
    matchedShift(pattern({ stripWidth: 8, waveform: "sawtooth" })),
    16,
  );
  assertAlmostEquals(
    matchedShift(pattern({ stripWidth: 8, waveform: "sine" })),
    5.093,
    0.001,
  );
});

Deno.test("the diagnostic mode replaces the zigzag with one ramp across the image", () => {
  const profile = depthProfile(9, pattern({ diagnostic: true }));

  assertEquals(profile[0], 0);
  assertEquals(profile[8], 255);
  // Strictly rising: nothing repeats, so nothing can close a strip up.
  for (let x = 1; x < profile.length; x++) {
    assertEquals(profile[x] > profile[x - 1], true, `column ${x} did not rise`);
  }
});

Deno.test("the diagnostic mode leaves the strip cut alone", () => {
  const p = pattern({ diagnostic: true });
  const sources = Array.from({ length: 12 }, (_, x) => stripSource(x, p));
  assertEquals(sources, [0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0]);
});
