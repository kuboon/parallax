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

/**
 * Reads an 8-bit non-interlaced PNG.
 *
 * The counterpart to {@link encodeGreyscalePng}, and here for the same reason: off the browser
 * there is no `createImageBitmap` to hand a file to. It covers what a PNG that came out of any
 * ordinary tool actually is — eight bits a channel, greyscale or colour, with or without alpha —
 * and refuses the rest rather than pretending. Adam7 and 16-bit images are the two the refusal is
 * really about; neither is worth carrying for a generator whose inputs are photographs.
 *
 * @param bytes The PNG file
 * @returns The pixels, expanded to RGBA
 */
export async function decodePng(bytes: Uint8Array): Promise<ImageData> {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("Not a PNG.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let channels = 0;

  for (let at = SIGNATURE.length; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;

    if (type === "IHDR") {
      const header = new DataView(
        body.buffer,
        body.byteOffset,
        body.byteLength,
      );
      width = header.getUint32(0);
      height = header.getUint32(4);
      const found = CHANNELS[body[9]];
      if (body[8] !== 8) throw new Error(`PNG bit depth ${body[8]} is not 8.`);
      if (found === undefined) {
        throw new Error(`PNG colour type ${body[9]} is not read here.`);
      }
      if (body[12] !== 0) throw new Error("Interlaced PNGs are not read here.");
      channels = found;
    } else if (type === "IDAT") {
      parts.push(body);
    } else if (type === "IEND") {
      break;
    }
  }

  if (width === 0 || height === 0) throw new Error("PNG has no IHDR.");

  const raw = unfilter(
    await inflate(concat(...parts)),
    width,
    height,
    channels,
  );
  return new ImageData(toRgba(raw, width * height, channels), width, height);
}

/** How many samples a pixel has, by PNG colour type. Palettes are not among them. */
const CHANNELS: Record<number, number | undefined> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** Undoes zlib's wrapper — the same one {@link deflate} puts on. */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream("deflate"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Undoes the per-row filters, in place of the caller's copy.
 *
 * Each row names its own filter and every one of them predicts a byte from its left, its
 * upstairs neighbour, or both — so the rows have to be walked in order, and the reconstructed
 * bytes, not the filtered ones, are what the next row refers back to.
 */
function unfilter(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    const above = to - stride;

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? out[to + i - channels] : 0;
      const up = y > 0 ? out[above + i] : 0;
      const upLeft = y > 0 && i >= channels ? out[above + i - channels] : 0;
      const predicted = filter === 0
        ? 0
        : filter === 1
        ? left
        : filter === 2
        ? up
        : filter === 3
        ? (left + up) >> 1
        : paeth(left, up, upLeft);
      out[to + i] = (data[from + i] + predicted) & 0xff;
    }
  }

  return out;
}

/** The filter that picks whichever neighbour the gradient points at. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Spreads however many samples a pixel had over the four an RGBA buffer wants. */
function toRgba(
  raw: Uint8Array,
  pixels: number,
  channels: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(pixels * 4);

  for (let i = 0; i < pixels; i++) {
    const from = i * channels;
    const to = i * 4;
    const grey = channels < 3;
    out[to] = raw[from];
    out[to + 1] = grey ? raw[from] : raw[from + 1];
    out[to + 2] = grey ? raw[from] : raw[from + 2];
    out[to + 3] = channels === 2
      ? raw[from + 1]
      : channels === 4
      ? raw[from + 3]
      : 255;
  }

  return out;
}
