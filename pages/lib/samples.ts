/**
 * Two obviously different pictures, drawn from nothing.
 *
 * The point of the tool is to see one image replace the other, and that is hard to judge with two
 * holiday snaps of the same beach. These two share nothing — colour, shape or texture — so the flip
 * is unmistakable, and the tool is usable before you have chosen what to upload.
 *
 * `islands/imaging.ts` draws the same pair with a canvas. This one is arithmetic per pixel, because
 * the command line has no canvas to draw with, and it antialiases everything it draws for a reason
 * that is not cosmetic: a hard-edged shape is a column of pixels that jumps from one value to
 * another in one step, which is precisely the kind of edge the strip cut is already under suspicion
 * for. The sample images must not add any of their own.
 */

/** Stroke coverage falls off across this much of a pixel, which is as sharp as an edge should be. */
const EDGE = 1;

/**
 * The pair, ready to interlace.
 *
 * @param width Frame width in pixels
 * @param height Frame height in pixels
 * @returns Image A — blue, with rings — and image B — warm, with diagonals
 */
export function sampleImages(
  width: number,
  height: number,
): [ImageData, ImageData] {
  return [
    render(width, height, {
      background: ["#0b3b6f", "#1e88e5"],
      ink: "#e3f2fd",
      label: "A",
      texture: rings,
    }),
    render(width, height, {
      background: ["#7f1d1d", "#f59e0b"],
      ink: "#fff7ed",
      label: "B",
      texture: diagonals,
    }),
  ];
}

/** What one of the two looks like. */
interface Style {
  /** Gradient endpoints, top-left to bottom-right. */
  background: [string, string];
  /** Colour of the texture and the letter. */
  ink: string;
  /** The letter across the middle. */
  label: "A" | "B";
  /** How much ink covers a pixel, from `0` to `1`. */
  texture: (x: number, y: number, width: number, height: number) => number;
}

/** A gradient, a texture at a third of its strength, and a very large letter. */
function render(width: number, height: number, style: Style): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  const from = parseHex(style.background[0]);
  const to = parseHex(style.background[1]);
  const ink = parseHex(style.ink);
  const glyph = GLYPHS[style.label];

  // The gradient runs along the diagonal, so its parameter is the projection onto it.
  const span = width * width + height * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = ((x + 0.5) * width + (y + 0.5) * height) / span;
      const texture = style.texture(x + 0.5, y + 0.5, width, height) * 0.35;
      const letter = coverage(x, y, width, height, glyph);
      const at = (y * width + x) * 4;

      for (let c = 0; c < 3; c++) {
        const base = from[c] + (to[c] - from[c]) * t;
        const textured = base + (ink[c] - base) * texture;
        data[at + c] = textured + (ink[c] - textured) * letter;
      }
      data[at + 3] = 255;
    }
  }

  return new ImageData(data, width, height);
}

/** Concentric circles, one every twelfth of the width. */
function rings(x: number, y: number, width: number, height: number): number {
  const distance = Math.hypot(x - width / 2, y - height / 2);
  const spacing = width / 12;
  const offset = distance % spacing;

  return stroke(Math.min(offset, spacing - offset), width);
}

/** Lines at 45 degrees, one every fourteenth of the width. */
function diagonals(
  x: number,
  y: number,
  width: number,
  _height: number,
): number {
  const spacing = width / 14;
  const along = ((x - y) % spacing + spacing) % spacing;

  // A line's own spacing is measured along the axis; the distance to it is across.
  return stroke(Math.min(along, spacing - along) / Math.SQRT2, width);
}

/** How much of a pixel a stroke of the usual width covers, given its distance from the centre. */
function stroke(distance: number, width: number): number {
  const half = Math.max(2, width / 120) / 2;
  return clamp01((half + EDGE / 2 - distance) / EDGE);
}

/**
 * The two letters, five columns by seven rows.
 *
 * A bitmap rather than an outline because at this size — a glyph over half the frame tall — a cell
 * is dozens of pixels across, and the only place the shape's resolution shows is the edges, which
 * {@link coverage} smooths anyway.
 */
const GLYPHS: Record<"A" | "B", readonly string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
};

/** Height of the letter as a fraction of the frame's, matching the island's font size. */
const GLYPH_HEIGHT = 0.55;

/** How many samples across a pixel the glyph is tested at, to soften its edges. */
const SUPERSAMPLE = 4;

/** How much of a pixel the letter covers, by point-sampling the bitmap over a subgrid. */
function coverage(
  x: number,
  y: number,
  width: number,
  height: number,
  glyph: readonly string[],
): number {
  const rows = glyph.length;
  const columns = glyph[0].length;
  const cell = (height * GLYPH_HEIGHT) / rows;
  const left = (width - columns * cell) / 2;
  const top = (height - rows * cell) / 2;

  let hits = 0;
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    const row = Math.floor((y + (sy + 0.5) / SUPERSAMPLE - top) / cell);
    if (row < 0 || row >= rows) continue;

    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const column = Math.floor((x + (sx + 0.5) / SUPERSAMPLE - left) / cell);
      if (column < 0 || column >= columns) continue;
      if (glyph[row][column] === "1") hits++;
    }
  }

  return hits / (SUPERSAMPLE * SUPERSAMPLE);
}

/** `#rrggbb` as three numbers. */
function parseHex(colour: string): [number, number, number] {
  const value = parseInt(colour.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Restricts a number to `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
