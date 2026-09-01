import { assertEquals, assertNotEquals } from "@std/assert";

import { sampleImages } from "./samples.ts";

Deno.test("sampleImages draws both images at the size asked for", () => {
  const [a, b] = sampleImages(64, 48);

  for (const image of [a, b]) {
    assertEquals([image.width, image.height], [64, 48]);
    assertEquals(image.data.length, 64 * 48 * 4);
  }
});

Deno.test("sampleImages draws two pictures that share nothing", () => {
  const [a, b] = sampleImages(64, 48);
  assertNotEquals(a.data, b.data);

  // Different enough that a strip of one is never mistaken for a strip of the other.
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > 32) differing++;
  }
  assertEquals(differing > (64 * 48) / 2, true);
});

Deno.test("sampleImages is opaque everywhere", () => {
  for (const image of sampleImages(32, 32)) {
    for (let i = 3; i < image.data.length; i += 4) {
      assertEquals(image.data[i], 255);
    }
  }
});
