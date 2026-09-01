import { assertEquals, assertThrows } from "@std/assert";

import { config, expand, parse, suffix } from "./cli.ts";

Deno.test("parse takes an option's value from either side of the space", () => {
  const { options } = parse(["--strip", "52", "--name=matrix", "--invert"]);

  assertEquals(options.get("strip"), "52");
  assertEquals(options.get("name"), "matrix");
  assertEquals(options.get("invert"), "true");
});

Deno.test("expand walks every value of every sweep", () => {
  const { sweeps } = parse([
    "--sweep",
    "strip=8,16",
    "--sweep",
    "feather=0,2,4",
  ]);
  const combinations = expand(sweeps);

  assertEquals(combinations.length, 6);
  assertEquals(
    combinations.map((c) => `${c.get("strip")}/${c.get("feather")}`),
    ["8/0", "8/2", "8/4", "16/0", "16/2", "16/4"],
  );
});

Deno.test("expand with nothing to sweep is one run of the options as given", () => {
  assertEquals(expand([]).length, 1);
});

Deno.test("suffix names a file after what was swept to make it", () => {
  assertEquals(
    suffix(new Map([["strip", "8"], ["feather", "2"]])),
    "-strip8-feather2",
  );
});

Deno.test("config refuses an option that is not one", () => {
  assertThrows(() => config(new Map([["stripe", "8"]])), Error, "--stripe");
});

Deno.test("config reads the pattern out of the options", () => {
  const settings = config(
    new Map([["strip", "52"], ["feather", "4"], ["swap", "true"]]),
  );

  assertEquals(settings.pattern.stripWidth, 52);
  assertEquals(settings.pattern.feather, 4);
  assertEquals(settings.pattern.swap, true);
  assertEquals(settings.pattern.invert, false);
});
