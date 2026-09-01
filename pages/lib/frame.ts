/**
 * Fitting a source image onto the output frame.
 *
 * `islands/imaging.ts` does this with a canvas and one `drawImage` call, which crops to fill and
 * resamples in the same step. Off the browser both halves have to be written out, and the
 * resampling half is worth doing properly: nearest-neighbour on the way up leaves stair-stepped
 * edges, and stair-stepped edges in the colour image are indistinguishable from the vertical seams
 * the strip cut already puts there — exactly the thing that is under suspicion when an upload is
 * refused. A tool for finding out what a viewer objects to must not add suspects of its own.
 *
 * So: a box filter when a run of source pixels lands in one output pixel, and linear interpolation
 * when it is the other way round. Separably, one axis at a time, which for a box filter gives the
 * same answer as doing both at once and costs far less.
 */

/**
 * Crops a source to the frame's shape and resamples it to the frame's size.
 *
 * Cover, not contain: the frame is filled and whatever hangs over the short axis is trimmed off
 * evenly at both ends, which is what `drawImage` with a centred crop rectangle does in the island.
 *
 * @param source The image to fit
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns A new raster of exactly the frame's size
 */
export function fitToFrame(
  source: ImageData,
  width: number,
  height: number,
): ImageData {
  const scale = Math.max(width / source.width, height / source.height);
  const cropWidth = width / scale;
  const cropHeight = height / scale;

  // Across every row first, then down the columns of what that produced.
  const rows = resample(
    source.data,
    source.height,
    source.width * 4,
    4,
    taps((source.width - cropWidth) / 2, cropWidth, width, source.width),
  );
  const data = resample(
    rows,
    1,
    0,
    width * 4,
    taps((source.height - cropHeight) / 2, cropHeight, height, source.height),
  );

  return new ImageData(Uint8ClampedArray.from(data), width, height);
}

/** One output element's worth of source: which elements it draws on, and how much of each. */
type Taps = ReadonlyArray<ReadonlyArray<readonly [number, number]>>;

/**
 * Works out where every output element comes from.
 *
 * A run of source elements per output element is an average; less than one is a lerp between the
 * two nearest centres. The crossover is exactly where a box filter stops having anything to
 * average. The answer depends only on the geometry, so it is worked out once and then used for
 * every row — or every column — the axis has.
 *
 * @param start Where the crop begins along this axis, in source elements
 * @param span How much of the axis the crop covers, in source elements
 * @param out How many elements to produce
 * @param count How many source elements the axis has
 * @returns The taps, one list per output element
 */
function taps(start: number, span: number, out: number, count: number): Taps {
  const step = span / out;
  const all: Array<Array<readonly [number, number]>> = [];

  for (let i = 0; i < out; i++) {
    const from = start + i * step;
    const to = from + step;
    const row: Array<readonly [number, number]> = [];

    if (step >= 1) {
      for (let s = Math.floor(from); s < Math.ceil(to); s++) {
        const weight = Math.min(to, s + 1) - Math.max(from, s);
        if (weight > 0) row.push([clampIndex(s, count), weight / step]);
      }
    } else {
      const centre = (from + to) / 2 - 0.5;
      const left = Math.floor(centre);
      const t = centre - left;
      row.push([clampIndex(left, count), 1 - t], [
        clampIndex(left + 1, count),
        t,
      ]);
    }

    all.push(row);
  }

  return all;
}

/**
 * Resamples one axis of an interleaved buffer.
 *
 * The buffer is `groups` runs of `count` elements of `stride` bytes. Along a row an element is a
 * pixel and there is one group per row; down a column an element is a whole row and the image is
 * one group. Both are the same arithmetic once the caller has said what an element is.
 *
 * @param data The samples
 * @param groups How many independent runs the buffer holds
 * @param groupStride Bytes from the start of one run to the next
 * @param stride Bytes per element
 * @param plan Where each output element comes from
 * @returns A new buffer, `groups * plan.length` elements long
 *
 * The result is floating point on purpose: a weighted sum accumulated into eight-bit samples
 * rounds every term as it lands, which for a box filter of four taps is four roundings of a
 * quarter each and an answer that is not an average of anything. Only the last step narrows.
 */
function resample(
  data: ArrayLike<number>,
  groups: number,
  groupStride: number,
  stride: number,
  plan: Taps,
): Float32Array {
  const out = plan.length;
  const result = new Float32Array(groups * out * stride);

  for (let g = 0; g < groups; g++) {
    const source = g * groupStride;
    const target = g * out * stride;

    for (let i = 0; i < out; i++) {
      const at = target + i * stride;
      for (const [index, weight] of plan[i]) {
        const from = source + index * stride;
        for (let b = 0; b < stride; b++) {
          result[at + b] += data[from + b] * weight;
        }
      }
    }
  }

  return result;
}

/** Keeps an index inside the image, so a crop that rounds outward samples the edge instead. */
function clampIndex(index: number, count: number): number {
  return index < 0 ? 0 : index >= count ? count - 1 : index;
}
