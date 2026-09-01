/**
 * The browser half of the generator: pixels in and out of canvases.
 *
 * Everything that decides *what* the output looks like lives in `lib/`, where it is plain data and
 * can be tested. This file is only the plumbing — decoding what the user dropped, fitting it to a
 * common frame, and handing finished bytes to a download. It is imported by the island, so nothing
 * here may run at module load: the island is server-rendered first, where there is no document.
 */

/** A decoded source image, with the name it arrived under and a URL to show it at. */
export interface Source {
  readonly image: ImageBitmap;
  readonly name: string;
  /** Somewhere an `<img>` can point, so the thumbnail is the browser's problem and not ours. */
  readonly previewUrl: string;
}

/** Decodes a dropped or picked file. */
export async function loadSource(file: File): Promise<Source> {
  return {
    image: await createImageBitmap(file),
    name: file.name,
    previewUrl: URL.createObjectURL(file),
  };
}

/** Turns generated pixels into a source, as though they had been picked from disk. */
export async function sourceFromPixels(
  data: ImageData,
  name: string,
): Promise<Source> {
  const context = scratchCanvas(data.width, data.height);
  context.putImageData(data, 0, 0);

  return {
    image: await createImageBitmap(data),
    name,
    previewUrl: context.canvas.toDataURL("image/png"),
  };
}

/** Releases a source's preview URL, if it was one that needs releasing. */
export function releaseSource(source: Source): void {
  source.image.close();
  if (source.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(source.previewUrl);
  }
}

/** Creates a canvas and its 2D context, failing loudly if the browser will not give one. */
export function scratchCanvas(
  width: number,
  height: number,
): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) {
    throw new Error("This browser has no 2D canvas context.");
  }
  return context;
}

/**
 * Fits an image to a frame, cropping whatever does not fit.
 *
 * The two sources are almost never the same shape, and a lenticular pair only works if the two
 * frames line up — so both are covered to the same box and centred, the way any photo grid does it.
 *
 * @param image The decoded source
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns The fitted pixels
 */
export function fitToFrame(
  image: ImageBitmap,
  width: number,
  height: number,
): ImageData {
  const context = scratchCanvas(width, height);
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;

  context.drawImage(
    image,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  return context.getImageData(0, 0, width, height);
}

/** Wraps an RGBA buffer in an `ImageData`, without copying it. */
export function asImageData(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): ImageData {
  return new ImageData(pixels, width, height);
}

/** Paints pixels onto a canvas, resizing it to match. */
export function paint(canvas: HTMLCanvasElement, data: ImageData): void {
  if (canvas.width !== data.width) canvas.width = data.width;
  if (canvas.height !== data.height) canvas.height = data.height;

  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser has no 2D canvas context.");
  }
  context.putImageData(data, 0, 0);
}

/** Encoded image bytes and the MIME type they are in. */
export interface Encoded {
  readonly bytes: Uint8Array;
  readonly type: "image/png" | "image/jpeg";
}

/**
 * Encodes pixels as a PNG or JPEG.
 *
 * @param data The pixels
 * @param type Which encoding
 * @param quality JPEG quality in `[0, 1]`, ignored for PNG
 * @returns The encoded bytes
 */
export async function encode(
  data: ImageData,
  type: "image/png" | "image/jpeg",
  quality = 0.95,
): Promise<Encoded> {
  const context = scratchCanvas(data.width, data.height);
  context.putImageData(data, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => {
    context.canvas.toBlob(resolve, type, quality);
  });
  if (blob === null) throw new Error(`This browser could not encode ${type}.`);

  return { bytes: new Uint8Array(await blob.arrayBuffer()), type };
}

/** Hands bytes to the browser as a file to save. */
export function download(
  bytes: Uint8Array,
  type: string,
  filename: string,
): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // The click is synchronous, but the fetch of the object URL is not; give it a turn to start.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
