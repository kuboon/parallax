/**
 * MD5, because the Extended XMP format is keyed by one.
 *
 * A depth map is far too large for a single JPEG marker segment, so XMP splits it across several
 * and ties them together with a GUID that is defined as the MD5 digest of the payload. There is
 * nothing security-sensitive about that use — it is a content key — and `crypto.subtle` does not
 * offer MD5, so the digest is computed here.
 *
 * @module
 */

/** Per-round left-rotation amounts, four rounds of four. */
// deno-fmt-ignore
const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** The sine-derived round constants, `floor(abs(sin(i + 1)) * 2**32)`. */
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
}

/**
 * Computes the MD5 digest of a byte string.
 *
 * @param input The bytes to digest
 * @returns The digest as 32 lowercase hex characters
 */
export function md5Hex(input: Uint8Array): string {
  const bitLength = input.length * 8;
  // The message, a 0x80 terminator, zero padding to 56 mod 64, and the length as 64 little-endian bits.
  const padded = new Uint8Array((((input.length + 8) >> 6) + 1) << 6);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const block = new Uint32Array(16);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      block[i] = view.getUint32(offset + i * 4, true);
    }

    let a = a0, b = b0, c = c0, d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const sum = (a + f + K[i] + block[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0].map(littleEndianHex).join("");
}

/** Rotates a 32-bit word left. */
function rotateLeft(value: number, by: number): number {
  return ((value << by) | (value >>> (32 - by))) >>> 0;
}

/** Renders a 32-bit word as the eight hex digits of its little-endian bytes. */
function littleEndianHex(value: number): string {
  let hex = "";
  for (let i = 0; i < 4; i++) {
    hex += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return hex;
}
