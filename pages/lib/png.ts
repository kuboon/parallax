/**
 * An 8-bit greyscale PNG encoder, because a canvas will not write one.
 *
 * `canvas.toBlob('image/png')` always emits 8-bit RGBA: three identical colour channels and a fully
 * opaque alpha channel, for an image that carries one number per pixel. Every depth map a camera
 * produces is single-channel greyscale, so a reader that validates what it is handed has grounds to
 * refuse the canvas version — and a strict one is exactly the kind we are trying to satisfy here.
 *
 * Writing the file directly settles that, and costs a quarter of the bytes on the way out. Deflate
 * comes from `CompressionStream('deflate')`, which is the zlib wrapper PNG asks for rather than the
 * raw stream — `deflate-raw` is the other one, and is not what goes in an `IDAT`.
 */

/** The eight bytes every PNG opens with. */
// deno-fmt-ignore
const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Greyscale, one channel, no palette. */
const COLOUR_TYPE_GREYSCALE = 0;

/** Row filters: leave the first row alone, then say "same as above". */
const FILTER_NONE = 0;
const FILTER_UP = 2;

/**
 * Encodes one byte per pixel as a greyscale PNG.
 *
 * @param pixels One luminance byte per pixel, row-major
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @returns The PNG file
 */
export async function encodeGreyscalePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (pixels.length !== width * height) {
    throw new Error(
      `encodeGreyscalePng() needs ${
        width * height
      } bytes for ${width}x${height}, ` +
        `got ${pixels.length}.`,
    );
  }

  return concat(
    SIGNATURE,
    chunk("IHDR", header(width, height)),
    chunk("IDAT", await deflate(filtered(pixels, width, height))),
    chunk("IEND", new Uint8Array(0)),
  );
}

/** The `IHDR` body: dimensions, then the five bytes describing the format. */
function header(width: number, height: number): Uint8Array {
  const body = new Uint8Array(13);
  const view = new DataView(body.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  body[8] = 8; // Bit depth.
  body[9] = COLOUR_TYPE_GREYSCALE;
  body[10] = 0; // Compression method: deflate, the only one there is.
  body[11] = 0; // Filter method: the adaptive five, the only one there is.
  body[12] = 0; // Not interlaced.
  return body;
}

/**
 * Prefixes each row with its filter byte.
 *
 * `Up` subtracts the row above, which is legal for any image and happens to be free here: this
 * generator's depth map is constant down every column, so every row but the first becomes zeros.
 */
function filtered(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array((width + 1) * height);

  for (let y = 0; y < height; y++) {
    const from = y * width;
    const to = y * (width + 1);
    out[to] = y === 0 ? FILTER_NONE : FILTER_UP;

    for (let x = 0; x < width; x++) {
      const here = pixels[from + x];
      out[to + 1 + x] = y === 0
        ? here
        : (here - pixels[from - width + x]) & 0xff;
    }
  }

  return out;
}

/** Compresses with the zlib wrapper an `IDAT` expects. */
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new CompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Wraps a body in a length-type-body-CRC chunk. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);

  view.setUint32(0, body.length);
  out.set(name, 4);
  out.set(body, 8);
  // The CRC covers the type and the body, but not the length.
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));

  return out;
}

/** The CRC-32 table PNG specifies, built once. */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** CRC-32 of a byte string, as PNG defines it. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Joins byte arrays into one. */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
