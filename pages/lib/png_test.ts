import { assertEquals, assertRejects } from "@std/assert";

import { encodeGreyscalePng } from "./png.ts";

/**
 * Reads a greyscale PNG back, the long way round.
 *
 * A writer nobody decodes is a writer nobody has checked, and the point of this file is that a
 * strict reader will accept it — so the test does the chunk walk, the CRC and the unfiltering by
 * hand rather than handing the bytes to something forgiving.
 */
async function decodeGreyscalePng(
  png: Uint8Array,
): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  assertEquals(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "signature",
  );

  let at = 8;
  let width = 0;
  let height = 0;
  const compressed: Uint8Array[] = [];
  const seen: string[] = [];

  while (at < png.length) {
    const view = new DataView(png.buffer, png.byteOffset + at);
    const length = view.getUint32(0);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    seen.push(type);

    if (type === "IHDR") {
      const ihdr = new DataView(body.buffer, body.byteOffset);
      width = ihdr.getUint32(0);
      height = ihdr.getUint32(4);
      assertEquals([body[8], body[9], body[10], body[11], body[12]], [
        8,
        0,
        0,
        0,
        0,
      ], "IHDR flags");
    }
    if (type === "IDAT") compressed.push(body);

    at += 12 + length;
  }

  assertEquals(seen, ["IHDR", "IDAT", "IEND"]);

  const stream = new Blob(compressed as BlobPart[]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  assertEquals(raw.length, (width + 1) * height, "unfiltered scanline count");

  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)];
    for (let x = 0; x < width; x++) {
      const value = raw[y * (width + 1) + 1 + x];
      const above = y === 0 ? 0 : pixels[(y - 1) * width + x];
      pixels[y * width + x] = filter === 2 ? (value + above) & 0xff : value;
    }
  }

  return { width, height, pixels };
}

Deno.test("the pixels survive the round trip", async () => {
  const pixels = Uint8Array.from([0, 64, 128, 255, 7, 7, 200, 1]);
  const decoded = await decodeGreyscalePng(
    await encodeGreyscalePng(pixels, 4, 2),
  );

  assertEquals(decoded.width, 4);
  assertEquals(decoded.height, 2);
  assertEquals([...decoded.pixels], [...pixels]);
});

Deno.test("a depth map that repeats down its columns costs almost nothing", async () => {
  const width = 512;
  const height = 512;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels[y * width + x] = (x * 8) & 0xff;
  }

  const png = await encodeGreyscalePng(pixels, width, height);
  const decoded = await decodeGreyscalePng(png);

  assertEquals([...decoded.pixels], [...pixels]);
  // A quarter of a megapixel of repeated rows: the Up filter leaves all but the first as zeros.
  assertEquals(
    png.length < 4096,
    true,
    `${png.length} bytes is more than expected`,
  );
});

Deno.test("every chunk's CRC checks out", async () => {
  const png = await encodeGreyscalePng(Uint8Array.from([1, 2, 3, 4]), 2, 2);

  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  let at = 8;
  let chunks = 0;
  while (at < png.length) {
    const view = new DataView(png.buffer, png.byteOffset + at);
    const length = view.getUint32(0);
    assertEquals(
      view.getUint32(8 + length),
      crc(png.subarray(at + 4, at + 8 + length)),
    );
    at += 12 + length;
    chunks++;
  }
  assertEquals(chunks, 3);
});

Deno.test("a buffer that is not the stated size is rejected", async () => {
  await assertRejects(
    () => encodeGreyscalePng(new Uint8Array(5), 2, 2),
    Error,
    "needs 4 bytes",
  );
});
