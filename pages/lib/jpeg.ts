/**
 * JPEG, off the browser.
 *
 * In the island a canvas does this: `toBlob('image/jpeg')` out, `createImageBitmap` in. On the
 * command line there is no canvas, and a baseline JPEG codec is a great deal of table-driven DCT
 * that has been written correctly many times already — so this is the one place the generator takes
 * a dependency, and it is kept to a wrapper thin enough to swap.
 *
 * The quality scale differs between the two: a canvas takes `0`–`1`, `jpeg-js` takes `0`–`100`.
 * {@link encodeJpeg} keeps the canvas's, so a number that means one thing in the browser means the
 * same thing here.
 */

import jpeg from "jpeg-js";

/** What the island's `encode()` passes when nobody chose otherwise. */
export const DEFAULT_QUALITY = 0.95;

/**
 * Encodes RGBA pixels as a baseline JPEG.
 *
 * @param image The pixels
 * @param quality Quality in `[0, 1]`, on the canvas's scale
 * @returns The JPEG file
 */
export function encodeJpeg(
  image: ImageData,
  quality = DEFAULT_QUALITY,
): Uint8Array {
  const { data } = jpeg.encode({
    data: new Uint8Array(
      image.data.buffer as ArrayBuffer,
      image.data.byteOffset,
      image.data.length,
    ),
    width: image.width,
    height: image.height,
  }, Math.round(quality * 100));

  return new Uint8Array(data);
}

/**
 * Reads a JPEG into RGBA pixels.
 *
 * @param bytes The JPEG file
 * @returns The pixels
 */
export function decodeJpeg(bytes: Uint8Array): ImageData {
  const { width, height, data } = jpeg.decode(bytes, { useTArray: true });
  return new ImageData(
    new Uint8ClampedArray(
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.length,
    ),
    width,
    height,
  );
}
