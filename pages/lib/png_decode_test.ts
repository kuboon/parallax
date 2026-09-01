import { assertEquals, assertRejects } from "@std/assert";

import { decodePng, encodeGreyscalePng } from "./png.ts";

Deno.test("decodePng reads back what encodeGreyscalePng wrote", async () => {
  const width = 7;
  const height = 5;
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = (i * 37) & 0xff;

  const image = await decodePng(
    await encodeGreyscalePng(pixels, width, height),
  );

  assertEquals(image.width, width);
  assertEquals(image.height, height);
  for (let i = 0; i < pixels.length; i++) {
    assertEquals(
      [
        image.data[i * 4],
        image.data[i * 4 + 1],
        image.data[i * 4 + 2],
        image.data[i * 4 + 3],
      ],
      [pixels[i], pixels[i], pixels[i], 255],
      `pixel ${i}`,
    );
  }
});

Deno.test("decodePng refuses what it cannot read", async () => {
  await assertRejects(() => decodePng(new Uint8Array(16)), Error, "Not a PNG");
});
