/**
 * The generator on the command line.
 *
 * The island exists to *watch* the effect — drag a slider, see the strips flip. This exists for the
 * other half of the job, which is finding out what a viewer will accept: that means dozens of files
 * differing in one setting each, named so the file itself says what it is, and a record of which
 * ones were uploaded and what happened. A browser is the wrong tool for that.
 *
 * Everything about what comes out is `lib/`, exactly as it is for the island — `generate()` is the
 * same function on both paths, so a difference between a file written here and one saved from the
 * page is a difference in settings and nothing else.
 *
 *     deno task gen --strip 52
 *     deno task gen --sweep strip=8,16,24,32,52 --out out/strips
 *
 * Files are written in the pair the uploader wants: `<name>.jpg` beside `<name>_depth.png`. Every
 * run also writes a `manifest.json` recording what each pair was made with, with a `result` field
 * left empty to be filled in once the pair has been somewhere.
 */

import { fitToFrame } from "./lib/frame.ts";
import { generate } from "./lib/generate.ts";
import { decodeJpeg, DEFAULT_QUALITY, encodeJpeg } from "./lib/jpeg.ts";
import { embedDepthMap } from "./lib/jpeg-xmp.ts";
import {
  DEFAULT_PATTERN,
  MIN_CONTRAST,
  minimumStripWidth,
  REFUSED_CONTRAST,
  WAVEFORMS,
} from "./lib/pattern.ts";
import type { Pattern, Waveform } from "./lib/pattern.ts";
import { decodePng, encodeGreyscalePng } from "./lib/png.ts";
import { sampleImages } from "./lib/samples.ts";

/** How much of the tool's own strangeness to leave in. Mirrors the island's ladder. */
type Diagnostic = "off" | "depth" | "both";

/** One generated pair's worth of settings. */
interface Config {
  pattern: Pattern;
  width: number;
  height: number | null;
  diagnostic: Diagnostic;
  depthType: "png" | "jpg";
  quality: number;
  embed: boolean;
  sources: [string | null, string | null];
  name: string;
  out: string;
}

/** The sample pair's shape, and so the output's when nothing else decides it. */
const SAMPLE_ASPECT = 3 / 4;

const HELP = `画像と深度マップのペアを書き出します。

  deno task gen [オプション]

  --out DIR         出力先ディレクトリ (既定: out)
  --name STEM       ファイル名の幹 (既定: parallax)
  --a FILE          画像 A。JPEG か PNG (既定: 生成されるサンプル)
  --b FILE          画像 B
  --width N         出力幅 px (既定: 1200)
  --height N        出力高さ px (既定: 画像 A の比率から)
  --strip N         ストライプ幅 px (既定: ${DEFAULT_PATTERN.stripWidth})
  --waveform W      ${WAVEFORMS.join(" | ")} (既定: ${DEFAULT_PATTERN.waveform})
  --phase N         パターンのずらし px
  --contrast F      深度の振れ幅 0..1 (既定: 1)
  --feather N       継ぎ目のクロスフェード幅 px (既定: 0)
  --invert          深度の near と far を入れ替える
  --swap            どちらの画像が先に広がるかを入れ替える
  --diagnostic L    off | depth | both (既定: off)
  --depth-type T    png | jpg (既定: png)
  --quality F       JPEG 品質 0..1 (既定: ${DEFAULT_QUALITY})
  --embed           GDepth XMP を埋め込んだ 1 枚も書き出す
  --sweep KEY=A,B   そのオプションを振って全通り書き出す。複数指定で総当たり
  --help            この使い方

例:
  deno task gen --strip 52
  deno task gen --sweep strip=8,16,24,32,52 --sweep feather=0,4 --out out/matrix
`;

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    console.log(HELP);
    Deno.exit(0);
  }
  await main();
}

/** Parses the arguments, expands the sweeps, and writes every combination. */
async function main(): Promise<void> {
  const { options, sweeps } = parse(Deno.args);
  const combinations = expand(sweeps);

  const base = config(options);
  const sources = await load(base.sources);
  const manifest: Record<string, unknown>[] = [];

  await Deno.mkdir(base.out, { recursive: true });

  for (const combination of combinations) {
    const settings = config(new Map([...options, ...combination]));
    const name = settings.name + suffix(combination);
    manifest.push(await write(settings, name, sources));
  }

  await Deno.writeTextFile(
    `${base.out}/manifest.json`,
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`${manifest.length} 組を ${base.out}/ に書き出しました。`);
}

/** Generates one pair and writes its files. */
async function write(
  settings: Config,
  name: string,
  sources: [ImageData, ImageData] | null,
): Promise<Record<string, unknown>> {
  const width = settings.width;
  const height = settings.height ??
    Math.round(
      sources === null
        ? width * SAMPLE_ASPECT
        : (width * sources[0].height) / sources[0].width,
    );

  const [a, b] = sources === null ? sampleImages(width, height) : [
    fitToFrame(sources[0], width, height),
    fitToFrame(sources[1], width, height),
  ];

  const output = generate(
    a,
    b,
    { ...settings.pattern, diagnostic: settings.diagnostic !== "off" },
    settings.diagnostic === "both",
  );

  const colour = encodeJpeg(output.colour, settings.quality);
  const depth = settings.depthType === "png"
    ? await encodeGreyscalePng(output.grey, width, height)
    : encodeJpeg(output.depth, settings.quality);

  const files: Record<string, string> = {
    colour: `${name}.jpg`,
    depth: `${name}_depth.${settings.depthType}`,
  };
  await Deno.writeFile(`${settings.out}/${files.colour}`, colour);
  await Deno.writeFile(`${settings.out}/${files.depth}`, depth);

  if (settings.embed) {
    files.embedded = `${name}_gdepth.jpg`;
    await Deno.writeFile(
      `${settings.out}/${files.embedded}`,
      embedDepthMap(colour, depth, {
        mime: settings.depthType === "png" ? "image/png" : "image/jpeg",
      }),
    );
  }

  const refusal = whyFacebookWillRefuse(settings, width);
  console.log(
    `${files.colour} + ${files.depth}${
      refusal === null ? "" : `  ← ${refusal}`
    }`,
  );

  return {
    files,
    width,
    height,
    source: sources === null ? "sample" : settings.sources,
    quality: settings.quality,
    ...settings.pattern,
    // The ladder's rung, not the flag the pattern derives from it.
    diagnostic: settings.diagnostic,
    result: null,
  };
}

/**
 * Why Facebook will refuse this pair, if it will.
 *
 * A warning and not a refusal: finding these limits took writing files that break them, and the
 * next limit will be found the same way. The page is where the settings are fenced off; here they
 * are only labelled.
 *
 * @param settings The settings the pair was made with
 * @param width The width it came out at
 * @returns What is wrong, or `null` when nothing is
 */
function whyFacebookWillRefuse(
  settings: Config,
  width: number,
): string | null {
  const { pattern } = settings;
  const floor = minimumStripWidth(width, pattern.waveform);

  if (settings.diagnostic !== "off") return null;
  if (pattern.stripWidth < floor) {
    return `ストライプ幅 ${pattern.stripWidth} px は幅 ${width} px では細すぎます（下限 ${floor} px）`;
  }
  if (pattern.contrast < MIN_CONTRAST) {
    return `深度コントラスト ${pattern.contrast} は浅すぎます（下限 ${MIN_CONTRAST}）`;
  }
  if (pattern.contrast === REFUSED_CONTRAST) {
    return `深度コントラスト ${REFUSED_CONTRAST} ちょうどは必ず拒否されます`;
  }
  return null;
}

/** Reads the two source images, or `null` when the generated samples are to be used. */
async function load(
  paths: [string | null, string | null],
): Promise<[ImageData, ImageData] | null> {
  if (paths[0] === null && paths[1] === null) return null;
  if (paths[0] === null || paths[1] === null) {
    throw new Error("--a と --b は両方指定してください。");
  }

  return [await decode(paths[0]), await decode(paths[1])];
}

/** Reads one image, by what its bytes say it is rather than what it is called. */
async function decode(path: string): Promise<ImageData> {
  const bytes = await Deno.readFile(path);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return await decodePng(bytes);
  throw new Error(`${path} は JPEG でも PNG でもありません。`);
}

/** Command-line options, before any of them mean anything. */
type Options = Map<string, string>;

/** One option and the values a run is to be repeated over. */
type Sweep = readonly [key: string, values: string[]];

/**
 * Splits the arguments into plain options and the sweeps.
 *
 * `--flag` with no value that follows is `"true"`, so the flags and the valued options can share
 * one map — and so `--sweep invert=true,false` works like every other sweep.
 */
export function parse(args: string[]): { options: Options; sweeps: Sweep[] } {
  const options: Options = new Map();
  const sweeps: Sweep[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) throw new Error(`余計な引数: ${arg}`);

    const equals = arg.indexOf("=");
    const key = (equals === -1 ? arg : arg.slice(0, equals)).slice(2);
    const inline = equals === -1 ? null : arg.slice(equals + 1);
    const next = args[i + 1];
    const value = inline ??
      (next !== undefined && !next.startsWith("--") ? args[++i] : "true");

    if (key === "sweep") {
      const at = value.indexOf("=");
      if (at === -1) throw new Error(`--sweep は KEY=A,B の形です: ${value}`);
      sweeps.push([value.slice(0, at), value.slice(at + 1).split(",")]);
    } else {
      options.set(key, value);
    }
  }

  return { options, sweeps };
}

/**
 * Every combination of the sweeps, in order.
 *
 * Each round multiplies what is there by one sweep's values, so with no sweeps at all the single
 * empty override that starts it off is the answer — one run with the options exactly as given.
 */
export function expand(sweeps: Sweep[]): Options[] {
  let combinations: Options[] = [new Map()];

  for (const [key, values] of sweeps) {
    combinations = combinations.flatMap((combination) =>
      values.map((value) => new Map([...combination, [key, value]]))
    );
  }

  return combinations;
}

/** What a combination adds to the file name, so a directory listing reads as the matrix it is. */
export function suffix(combination: Options): string {
  return [...combination]
    .map(([key, value]) => `-${key}${value.replace(/[^\w.-]/g, "")}`)
    .join("");
}

/** Turns the options into settings, rejecting anything that is not one. */
export function config(options: Options): Config {
  const known = new Set([
    "out",
    "name",
    "a",
    "b",
    "width",
    "height",
    "strip",
    "waveform",
    "phase",
    "contrast",
    "feather",
    "invert",
    "swap",
    "diagnostic",
    "depth-type",
    "quality",
    "embed",
  ]);
  for (const key of options.keys()) {
    if (!known.has(key)) throw new Error(`知らないオプション: --${key}`);
  }

  const waveform = options.get("waveform") ?? DEFAULT_PATTERN.waveform;
  if (!WAVEFORMS.includes(waveform as Waveform)) {
    throw new Error(`--waveform は ${WAVEFORMS.join(" | ")} のどれかです。`);
  }

  const diagnostic = options.get("diagnostic") ?? "off";
  if (!["off", "depth", "both"].includes(diagnostic)) {
    throw new Error("--diagnostic は off | depth | both のどれかです。");
  }

  const depthType = options.get("depth-type") ?? "png";
  if (depthType !== "png" && depthType !== "jpg") {
    throw new Error("--depth-type は png | jpg のどちらかです。");
  }

  return {
    pattern: {
      stripWidth: number(options, "strip", DEFAULT_PATTERN.stripWidth),
      waveform: waveform as Waveform,
      phase: number(options, "phase", DEFAULT_PATTERN.phase),
      contrast: number(options, "contrast", DEFAULT_PATTERN.contrast),
      feather: number(options, "feather", DEFAULT_PATTERN.feather),
      invert: flag(options, "invert"),
      swap: flag(options, "swap"),
      diagnostic: false,
    },
    width: number(options, "width", 1200),
    height: options.has("height") ? number(options, "height", 0) : null,
    diagnostic: diagnostic as Diagnostic,
    depthType,
    quality: number(options, "quality", DEFAULT_QUALITY),
    embed: flag(options, "embed"),
    sources: [options.get("a") ?? null, options.get("b") ?? null],
    name: options.get("name") ?? "parallax",
    out: options.get("out") ?? "out",
  };
}

/** One option as a number. */
function number(options: Options, key: string, fallback: number): number {
  const raw = options.get(key);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${key} は数値です: ${raw}`);
  return value;
}

/** One option as a flag: present and not `false`. */
function flag(options: Options, key: string): boolean {
  const raw = options.get(key);
  return raw !== undefined && raw !== "false";
}
