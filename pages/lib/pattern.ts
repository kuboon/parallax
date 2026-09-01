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
   * Width in pixels of the cross-fade at each strip boundary.
   *
   * A hard cut makes the colour image a field of vertical edges at one fixed frequency, which is
   * not a thing photographs contain. That turned out not to be what anything objects to — the
   * colour image is not examined at all, and a plain photograph with a zigzag depth map is refused
   * exactly like a striped one — so this is now a cosmetic control: it takes the hard seams out of
   * what a person sees when the parallax is not moving.
   *
   * It is not free: a column that is half one image and half the other stays half-and-half at every
   * viewing angle, so the fade is crosstalk that no shift can separate. Keep it small next to the
   * strip width.
   */
  feather: number;
  /**
   * Replaces the zigzag with one smooth ramp across the whole image.
   *
   * This deliberately throws the effect away: a single gradient stretches the frame and nothing
   * else, so no strip ever closes up. It exists to take the depth map out of the list of suspects
   * when a viewer refuses the pair — it is nothing a camera would ever produce, and that alone is
   * grounds for something downstream to balk. Derived from the diagnostic level the UI offers
   * rather than set directly; see `DiagnosticLevel` in `islands/pipeline.ts`.
   */
  diagnostic: boolean;
}

/**
 * Narrowest strip the warp resolves reliably on a pixel grid.
 *
 * Below this the fold between two strips lands inside a pixel and the simulated view stops being
 * a fair picture of what a viewer would do with the file.
 */
export const MIN_STRIP_WIDTH = 4;

/**
 * The width a depth map keeps when it is uploaded, past which it is shrunk.
 *
 * Facebook re-encodes what it is given, and everything below is stated relative to this width
 * because that is the space the check happens in: the same zigzag in a 2400 px map has to be
 * twice as coarse to survive arriving as a 1200 px one. Measured, not documented anywhere.
 */
export const DEPTH_REFERENCE_WIDTH = 1200;

/**
 * The narrowest strip Facebook's 3D reader accepted, per waveform, at {@link DEPTH_REFERENCE_WIDTH}.
 *
 * Measured on 2026-09-01 by attaching pairs to the composer and reading whether it made a 3D photo:
 * for each of these the value itself was accepted and the one pixel below it was refused, three
 * times each. Only the depth map decides — the colour image can be a photograph or a field of hard
 * stripes and it changes nothing — so these are properties of the zigzag alone.
 *
 * A square wave is not a zigzag at all: it has no ramp for the reader to object to and is taken at
 * any width, which is also why it barely produces the effect. Everything else is refused with
 * `Failed to create your 3D Photo` and no reason given.
 */
const ACCEPTED_STRIP_WIDTH: Record<Waveform, number> = {
  triangle: 32,
  sawtooth: 17,
  sine: 44,
  square: MIN_STRIP_WIDTH,
};

/**
 * The narrowest strip that will come back as a 3D photo.
 *
 * The limit scales with the output width, because a wider image is shrunk to
 * {@link DEPTH_REFERENCE_WIDTH} on the way in and takes its zigzag down with it. Verified at the
 * boundary: 1300 px wide needs a 35 px strip where 1200 px needs 32, which is exactly this
 * arithmetic.
 *
 * @param outputWidth Width of the generated image in pixels
 * @param waveform Depth shape across a strip pair
 * @returns The smallest strip width worth offering
 */
export function minimumStripWidth(
  outputWidth: number,
  waveform: Waveform,
): number {
  const scale = Math.max(1, outputWidth / DEPTH_REFERENCE_WIDTH);
  return Math.max(
    MIN_STRIP_WIDTH,
    Math.ceil(ACCEPTED_STRIP_WIDTH[waveform] * scale),
  );
}

/** Granularity the contrast is offered at, and so the distance to nudge off a refused value. */
export const CONTRAST_STEP = 0.05;

/** Shallowest depth range that still comes back as a 3D photo. Below this, 20% was refused. */
export const MIN_CONTRAST = 0.3;

/**
 * The one contrast inside the accepted range that is refused anyway.
 *
 * Exactly one half. Both neighbours a step away are taken, and two separately generated files at
 * this value were refused four times out of four. No idea; it is here so nothing offers it.
 */
export const REFUSED_CONTRAST = 0.5;

/**
 * The nearest contrast to `value` that Facebook will accept.
 *
 * @param value The contrast asked for
 * @returns The same number, or the nearest one that is not refused
 */
export function acceptedContrast(value: number): number {
  if (value <= MIN_CONTRAST) return MIN_CONTRAST;
  if (value === REFUSED_CONTRAST) return REFUSED_CONTRAST + CONTRAST_STEP;
  return value;
}

/**
 * A sensible starting point.
 *
 * Thirty-two pixels is the narrowest triangle Facebook will take at the default output width —
 * see {@link minimumStripWidth}. It is wider than the effect needs and there is nothing to be
 * done about that: below it the pair uploads fine and then comes back refused.
 */
export const DEFAULT_PATTERN: Pattern = {
  stripWidth: 32,
  waveform: "triangle",
  phase: 0,
  contrast: 1,
  invert: false,
  swap: false,
  feather: 0,
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
 * How much of image B a column shows, from `0` (all A) to `1` (all B).
 *
 * With no feather this is {@link stripSource} in another form. With one, the columns within half a
 * feather of a seam are mixed, in proportion to how close they are to it — so both seams in a
 * period fade the same way and the pattern stays continuous across the wrap.
 *
 * @param x Column index
 * @param pattern The strip pattern
 * @returns The blend weight for image B
 */
export function blendWeight(x: number, pattern: Pattern): number {
  const hard = stripSource(x, pattern);
  const feather = Math.max(0, pattern.feather);
  if (feather === 0) return hard;

  const period = pattern.stripWidth * 2;
  const p = positionInPeriod(x, pattern) + 0.5;
  // The seams are at 0, stripWidth and the period; a column is only ever near one of them.
  const toSeam = Math.min(
    Math.abs(p - pattern.stripWidth),
    Math.min(p, period - p),
  );
  const away = clamp(toSeam / (feather / 2), 0, 1);

  return 0.5 + (hard - 0.5) * away;
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
