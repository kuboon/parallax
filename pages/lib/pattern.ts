/**
 * The pattern: which strip a column belongs to, and how deep that column is.
 *
 * Everything the generator does is decided per *column*. Two source images are cut into vertical
 * strips and interleaved, and the depth map is a zigzag whose slope is aligned to those same
 * strips. Nothing varies down a column, so the whole design is one width-long profile — which is
 * also why the viewer in `warp.ts` can resolve visibility once and then reuse it for every row.
 *
 * ## Why a zigzag
 *
 * A parallax viewer displaces a pixel horizontally by an amount proportional to its depth. Over a
 * run of columns whose depth ramps linearly, that displacement is an affine map: the run is
 * stretched or squeezed by `1 + shift * slope`, where `slope` is the depth change per column.
 *
 * Give strip A a rising ramp and strip B the mirrored falling one — a triangle wave with one strip
 * per flank — and the two flanks scale in opposite directions. At the view angle where
 * `shift * slope` reaches 1, strip A doubles in width while strip B collapses to nothing: A covers
 * the pair entirely. At the opposite angle the roles swap. That is a lenticular print, expressed as
 * a depth map.
 *
 * The other waveforms are here to compare against: a sawtooth ramps across the whole pair and so
 * carries a depth discontinuity at every period, a square wave is pure occlusion with no stretch at
 * all, and a sine is a triangle with its corners rounded off — closer to what survives a viewer
 * that blurs the depth map before using it.
 */

/** Shape of the depth pattern across one strip pair. */
export type Waveform = "triangle" | "sawtooth" | "square" | "sine";

/** Every waveform, in the order the UI offers them. */
export const WAVEFORMS: readonly Waveform[] = [
  "triangle",
  "sawtooth",
  "square",
  "sine",
];

/** How the two images are cut up and how deep the result is claimed to be. */
export interface Pattern {
  /** Width in pixels of a single strip. One strip pair — the pattern's period — is twice this. */
  stripWidth: number;
  /** Depth shape across a strip pair. */
  waveform: Waveform;
  /** Pattern offset in pixels, shifting both the cut and the depth together. */
  phase: number;
  /** Fraction of the 0–255 depth range the pattern uses, centred on mid grey. */
  contrast: number;
  /** Swaps near and far, for a viewer that reads a depth map the other way round. */
  invert: boolean;
  /** Swaps which image lands on the flank that widens first. */
  swap: boolean;
  /**
   * Replaces the zigzag with one smooth ramp across the whole image.
   *
   * This deliberately throws the effect away: a single gradient stretches the frame and nothing
   * else, so no strip ever closes up. It is here to separate two failures that look the same from
   * the outside. A viewer that refuses the pair can be refusing the *files* — the encoding, the
   * metadata, the dimensions — or it can be refusing this particular depth *content*, which is
   * nothing a camera would ever produce. Ship the same colour image with an ordinary-looking
   * gradient instead: if that is accepted, the files are fine and the zigzag is the problem.
   */
  diagnostic: boolean;
}

/**
 * A sensible starting point.
 *
 * Sixteen pixels is wider than the effect needs and that is the point: the strips have to survive
 * being downscaled and re-compressed by whatever they are uploaded to, and they are exactly the
 * high frequencies that step throws away. A gentler ramp is also a less alarming thing to hand a
 * depth reader. Go narrower once something has been seen to work, not before.
 */
export const DEFAULT_PATTERN: Pattern = {
  stripWidth: 16,
  waveform: "triangle",
  phase: 0,
  contrast: 1,
  invert: false,
  swap: false,
  diagnostic: false,
};

/** Position within the strip pair, always in `[0, period)`. */
function positionInPeriod(x: number, pattern: Pattern): number {
  const period = pattern.stripWidth * 2;
  return ((x - pattern.phase) % period + period) % period;
}

/**
 * Which of the two source images a column is taken from.
 *
 * The first flank of the period — the one the triangle ramps *up* across — is image A, so a
 * positive shift is the view that widens A.
 *
 * @param x Column index
 * @param pattern The strip pattern
 * @returns `0` for image A, `1` for image B
 */
export function stripSource(x: number, pattern: Pattern): 0 | 1 {
  const first = positionInPeriod(x, pattern) < pattern.stripWidth;
  return (first !== pattern.swap ? 0 : 1);
}

/**
 * Depth in `[0, 1]` before contrast and inversion are applied.
 *
 * The waveform is evaluated at the *centre* of the column, half a pixel in. That is not a detail:
 * it puts the triangle's peak on the seam between the two strips rather than on a column of one of
 * them, so the fold the warp closes up falls between pixels and neither strip owns it.
 */
function rawDepth(x: number, pattern: Pattern): number {
  const { stripWidth, waveform } = pattern;
  const period = stripWidth * 2;
  const c = positionInPeriod(x, pattern) + 0.5;

  switch (waveform) {
    case "triangle": {
      const t = c / stripWidth;
      return t <= 1 ? t : 2 - t;
    }
    case "sawtooth":
      return c / period;
    case "square":
      return c < stripWidth ? 0 : 1;
    case "sine":
      return (1 - Math.cos((2 * Math.PI * c) / period)) / 2;
  }
}

/**
 * The depth map, as one byte per column.
 *
 * Larger is nearer, which is the convention every "make your own 3D photo" pipeline uses: white
 * comes towards the viewer. {@link Pattern.invert} flips it for a viewer that disagrees.
 *
 * @param width Image width in pixels
 * @param pattern The strip pattern
 * @returns One depth byte per column, left to right
 */
export function depthProfile(width: number, pattern: Pattern): Uint8Array {
  const profile = new Uint8Array(width);
  const contrast = clamp(pattern.contrast, 0, 1);
  const span = Math.max(1, width - 1);

  for (let x = 0; x < width; x++) {
    const unit = pattern.diagnostic ? x / span : rawDepth(x, pattern);
    const raw = pattern.invert ? 1 - unit : unit;
    profile[x] = Math.round(255 * (0.5 + (raw - 0.5) * contrast));
  }

  return profile;
}

/**
 * The shift, in pixels, that makes one strip collapse and its neighbour cover the pair.
 *
 * A triangle's flank climbs the whole depth range across `stripWidth` columns, so its slope is
 * `255 * contrast / stripWidth` per column and the displacement gradient cancels the column
 * spacing exactly when the shift equals `stripWidth / contrast`. A sine reaches that slope only at
 * its steepest point — the flank midpoint — where it is `π/2` times the triangle's average, so it
 * needs proportionally less shift to pinch shut there. A sawtooth spreads one ramp over the whole
 * period and so wants twice the triangle's shift.
 *
 * A square wave has no ramp anywhere: it never stretches, it only slides one set of strips over the
 * other, which lines up when the shift equals a strip width.
 *
 * This is the continuous answer, and a pixel grid is not continuous: at exactly this shift the fold
 * between two strips still resolves to about one column per period of the strip that should have
 * vanished. Pushing the shift half again as far buries that column behind the stretched neighbour,
 * which is why the simulator's gain runs well past the matched value.
 *
 * @param pattern The strip pattern
 * @returns The shift in pixels the simulator's gain should reach at full deflection
 */
export function matchedShift(pattern: Pattern): number {
  const contrast = clamp(pattern.contrast, 0, 1);
  if (contrast === 0) return Infinity;

  const base = pattern.stripWidth / contrast;
  switch (pattern.waveform) {
    case "triangle":
      return base;
    case "square":
      return pattern.stripWidth;
    case "sawtooth":
      return base * 2;
    case "sine":
      return base * (2 / Math.PI);
  }
}

/**
 * How far past {@link matchedShift} to go for a view with no trace of the other strip left.
 *
 * The matched shift is the continuous answer; on a pixel grid it leaves roughly one column per
 * period of the strip that was supposed to close up. Overshooting stretches the surviving strip
 * across that column and the depth buffer keeps it there. A triangle four pixels wide or more is
 * clean anywhere from about 1.25 to 1.75 times matched, so this sits in the middle of that window;
 * below that the grid is too coarse for the window to be reliable.
 */
export const CLEAN_SHIFT_FACTOR = 1.5;

/** Restricts a number to a range. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
