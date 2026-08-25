/**
 * The viewer: what a parallax renderer does with an image and a depth map.
 *
 * Facebook has never published how its parallax view is rendered, so this is the simplest model
 * that reproduces the behaviour you can observe — a horizontal displacement proportional to depth,
 * with nearer surfaces winning where two of them land on the same pixel. Everything the simulator
 * shows follows from those two rules and nothing else; treat the gain in pixels as the one free
 * parameter to be found by experiment.
 *
 * ## Resolving visibility once
 *
 * Displacement is a forward warp: it says where a source pixel *goes*, not where a destination
 * pixel comes from, so it needs a depth buffer to settle overlaps and a rule for the gaps. Doing
 * that per pixel every frame would be wasteful here, because this generator's depth map is constant
 * down every column. So {@link columnMapping} resolves the whole thing in one pass over the width —
 * overlaps, stretching, gaps and all — and {@link applyColumnMapping} then paints any number of
 * rows through the answer.
 */

/**
 * Resolves, for every destination column, which source column ends up visible there.
 *
 * Each source column is spread over the destination interval half way to each of its neighbours.
 * That interval widens where depth rises steeply and closes to nothing where the gradient cancels
 * the column spacing — which is exactly the strip collapsing that makes the pattern lenticular.
 * Where intervals overlap, the nearer column wins; where none lands, the nearest resolved column
 * to the side is carried in, which is the cheapest stand-in for the inpainting a real viewer does.
 *
 * @param profile One depth byte per column, larger meaning nearer
 * @param shift Displacement in pixels applied at full depth; negative looks the other way
 * @returns Source column index for each destination column
 */
export function columnMapping(
  profile: Uint8Array,
  shift: number,
): Int32Array {
  const width = profile.length;
  const mapping = new Int32Array(width).fill(-1);
  if (width === 0) return mapping;

  const landing = new Float64Array(width);
  for (let x = 0; x < width; x++) landing[x] = x + shift * (profile[x] / 255);

  const zBuffer = new Float64Array(width).fill(-1);

  for (let x = 0; x < width; x++) {
    const here = landing[x];
    const left = x > 0 ? (landing[x - 1] + here) / 2 : here - 0.5;
    const right = x < width - 1 ? (here + landing[x + 1]) / 2 : here + 0.5;
    const lo = Math.min(left, right);
    const hi = Math.max(left, right);

    const first = Math.max(0, Math.round(lo));
    const last = Math.min(width - 1, Math.round(hi) - 1);
    const depth = profile[x];

    for (let i = first; i <= last; i++) {
      if (depth > zBuffer[i]) {
        zBuffer[i] = depth;
        mapping[i] = x;
      }
    }
  }

  fillGaps(mapping);
  return mapping;
}

/**
 * Carries the nearest resolved column into any destination column nothing landed on.
 *
 * Gaps appear at the edges, where the whole image has slid inward, and behind a depth
 * discontinuity — a square wave produces one at every strip boundary. A real viewer inpaints them;
 * stretching the neighbour is the honest cheap version, and it makes the cost of a discontinuous
 * waveform visible rather than hiding it behind a plausible guess.
 */
function fillGaps(mapping: Int32Array): void {
  let last = -1;
  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i] >= 0) last = mapping[i];
    else if (last >= 0) mapping[i] = last;
  }

  last = -1;
  for (let i = mapping.length - 1; i >= 0; i--) {
    if (mapping[i] >= 0) last = mapping[i];
    else if (last >= 0) mapping[i] = last;
  }
}

/**
 * Paints an image through a column mapping.
 *
 * @param source RGBA pixels of the flat image
 * @param width Image width in pixels
 * @param height Image height in pixels
 * @param mapping Destination column to source column, from {@link columnMapping}
 * @param target RGBA buffer to write, the same size as `source`
 */
export function applyColumnMapping(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  mapping: Int32Array,
  target: Uint8ClampedArray,
): void {
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      const from = mapping[x];
      if (from < 0) continue;
      const src = row + from * 4;
      const dst = row + x * 4;
      target[dst] = source[src];
      target[dst + 1] = source[src + 1];
      target[dst + 2] = source[src + 2];
      target[dst + 3] = source[src + 3];
    }
  }
}

/**
 * Smooths a depth profile with a box blur, to stand in for a viewer that does not trust the map.
 *
 * A depth map arriving over the wire has been resized and re-encoded, and a renderer may well
 * soften it further before use. A strip pattern lives entirely in the high frequencies that step
 * throws away, so this control is where you find out how much of it survives.
 *
 * @param profile One depth byte per column
 * @param radius Blur radius in pixels; `0` returns an unchanged copy
 * @returns A new blurred profile
 */
export function blurProfile(profile: Uint8Array, radius: number): Uint8Array {
  const width = profile.length;
  const out = new Uint8Array(width);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) {
    out.set(profile);
    return out;
  }

  // Running sum over a window clamped at both edges, so the cost is independent of the radius.
  let sum = 0;
  for (let i = -r; i <= r; i++) sum += profile[clampIndex(i, width)];

  for (let x = 0; x < width; x++) {
    out[x] = Math.round(sum / (2 * r + 1));
    sum -= profile[clampIndex(x - r, width)];
    sum += profile[clampIndex(x + r + 1, width)];
  }

  return out;
}

/** Clamps an index onto a buffer, repeating its edge values. */
function clampIndex(i: number, width: number): number {
  return i < 0 ? 0 : i >= width ? width - 1 : i;
}
