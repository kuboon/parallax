import { assertEquals, assertThrows } from "@std/assert";

import { DEFAULT_PATTERN } from "./pattern.ts";
import { depthImage, interlace } from "./interlace.ts";

/** A solid RGBA block of one colour. */
function solid(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out.set([r, g, b, 255], i * 4);
  }
  return out;
}

Deno.test("columns come from alternating strips", () => {
  const a = solid(8, 2, 10, 20, 30);
  const b = solid(8, 2, 40, 50, 60);
  const mixed = interlace(a, b, 8, 2, { ...DEFAULT_PATTERN, stripWidth: 2 });

  const reds = Array.from({ length: 8 }, (_, x) => mixed[x * 4]);
  assertEquals(reds, [10, 10, 40, 40, 10, 10, 40, 40]);
});

Deno.test("every row gets the same cut", () => {
  const a = solid(4, 3, 1, 1, 1);
  const b = solid(4, 3, 2, 2, 2);
  const mixed = interlace(a, b, 4, 3, { ...DEFAULT_PATTERN, stripWidth: 1 });

  for (let y = 0; y < 3; y++) {
    const row = Array.from({ length: 4 }, (_, x) => mixed[(y * 4 + x) * 4]);
    assertEquals(row, [1, 2, 1, 2]);
  }
});

Deno.test("mismatched buffers are rejected rather than silently truncated", () => {
  assertThrows(
    () =>
      interlace(
        solid(4, 2, 0, 0, 0),
        solid(2, 2, 0, 0, 0),
        4,
        2,
        DEFAULT_PATTERN,
      ),
    Error,
    "RGBA buffers",
  );
});

Deno.test("the depth image is opaque grey, constant down each column", () => {
  const image = depthImage(Uint8Array.from([0, 128, 255]), 2);

  assertEquals([...image.slice(0, 12)], [
    0,
    0,
    0,
    255,
    128,
    128,
    128,
    255,
    255,
    255,
    255,
    255,
  ]);
  assertEquals([...image.slice(12)], [...image.slice(0, 12)]);
});
