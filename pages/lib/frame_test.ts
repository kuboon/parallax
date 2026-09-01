import { assertAlmostEquals, assertEquals } from "@std/assert";

import { fitToFrame } from "./frame.ts";

/** An image whose red channel is the column index and green the row, for tracing where pixels go. */
function ramp(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = x;
      data[at + 1] = y;
      data[at + 3] = 255;
    }
  }
  return new ImageData(data, width, height);
}

Deno.test("fitToFrame produces exactly the frame asked for", () => {
  const fitted = fitToFrame(ramp(37, 11), 20, 20);
  assertEquals([fitted.width, fitted.height], [20, 20]);
  assertEquals(fitted.data.length, 20 * 20 * 4);
});

Deno.test("fitToFrame covers the frame and trims the overhang evenly", () => {
  // 40x10 into a square: the height decides the scale, so 10 of the 40 columns survive, centred.
  const fitted = fitToFrame(ramp(40, 10), 10, 10);

  // The first output column is the middle of source columns 15 and 16, the last of 24 and 25.
  assertAlmostEquals(fitted.data[0], 15.5, 1);
  assertAlmostEquals(fitted.data[9 * 4], 24.5, 1);
});

Deno.test("fitToFrame averages rather than dropping pixels when it shrinks", () => {
  const fitted = fitToFrame(ramp(8, 8), 2, 2);

  // Each output pixel is the mean of a 4x4 block: columns 0-3 average 1.5, columns 4-7 average 5.5.
  assertAlmostEquals(fitted.data[0], 1.5, 0.51);
  assertAlmostEquals(fitted.data[4], 5.5, 0.51);
});

Deno.test("fitToFrame leaves a solid colour solid", () => {
  const solid = new ImageData(new Uint8ClampedArray(9 * 9 * 4).fill(200), 9, 9);
  const fitted = fitToFrame(solid, 4, 20);

  for (const value of fitted.data) assertEquals(value, 200);
});
