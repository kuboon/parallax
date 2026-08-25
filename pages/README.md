# pages

The site. [Remix v3](https://remix.run) for rendering, and
[`@kuboon/remix-ssg`](https://jsr.io/@kuboon/remix-ssg) for everything around
it: `router.ts` composes three directories into one handler,
`deno serve router.ts` runs that handler as the dev server, and the build crawls
the very same object into static HTML for GitHub Pages.

|            |                                          |
| ---------- | ---------------------------------------- |
| `islands/` | compiled as a single code-split bundle   |
| `pages/`   | served through this site's own transform |
| `static/`  | served verbatim                          |

## Requirements

[Deno](https://deno.com) 2.x.

## Commands

```sh
deno task dev     # local dev server at http://localhost:8000
deno task test    # the generator's tests
deno task build   # generate the static site into dist/
deno task check   # type-check, lint, format-check, test
```

Neither `dev` nor `build` passes `-A` or `--unstable-bundle`. `deno.json`
carries a permission set for each (`-P=dev`, `-P=build`, `-P=test`) and the
`"unstable": ["bundle"]` the bundler needs — which is also why `deno task build`
names `-c deno.json`: a remote main module reads a project's config only when it
is told to.

## Where the tool lives

```
pages/
  router.ts            # the wiring — three directories into one handler
  layout.tsx           # the HTML document shell
  transforms/page.tsx  # .tsx → a page module
  lib/
    pattern.ts         # which strip a column is, and how deep — plus the tests' subject
    interlace.ts       # two RGBA buffers → one striped buffer, and the depth image
    warp.ts            # the viewer model: depth → a column mapping, resolved once
    jpeg-xmp.ts        # GDepth XMP, written into a JPEG
    md5.ts             # what Extended XMP keys its chunks by
    base.ts            # the deploy prefix, computed once
    link.tsx           # internal <Link> (full-document navigation)
  islands/
    simulator.tsx      # the tool's UI, and its browser entrypoint
    pipeline.ts        # sources → generated pair → rendered view, each cached
    imaging.ts         # canvases, encoding, downloads, the sample images
  pages/
    index.tsx          # the tool
    how-it-works.tsx   # why a zigzag behaves like a lenticular lens
  static/              # files served under /static/*
```

Everything that decides what the output looks like is in `lib/`, as plain
functions over typed arrays with no DOM anywhere near them — which is why
`deno task test` can check the depth profile, the strip cut, the warp and the
XMP writer without a browser. `islands/` is the plumbing that connects those to
a canvas.

## Adding a page

Drop a `.tsx` file in `pages/` and link to it. It exports a component, and
optionally `title`, `description`, and the `islands` it places.

The crawl starts at `entryPoints` in `router.ts` and follows links, so **what is
reachable is what gets generated**. A page nothing links to belongs in
`entryPoints`, or it is not part of the site.

## Islands

`islands/simulator.tsx` is server-rendered like everything else and then
hydrated — view source and the whole control panel is already in the HTML. It is
declared with `island('simulator', 'Simulator', …)` from
`@kuboon/remix-ssg/client`, where the name is the file's path under `islands/`
without the extension, and named in the page's `islands` export so the shell
loads its chunk.

An island's id is a logical name (`island:simulator#Simulator`) rather than a
URL, because that expression is evaluated in the browser too, where predicting
the bundler's output naming would be guesswork. The shell embeds the name→chunk
map the bundler produced and the runtime resolves against it.

A `.ts` file under `islands/` is a helper, not an entrypoint — only `.tsx` and
`.jsx` are compiled as browser entries.

Internal links use the `<Link>` component (`lib/link.tsx`), which marks them for
full-document navigation so pages with an active client runtime still navigate
like a normal static site.

## Base paths and GitHub Pages

A GitHub Pages _project_ site is served under a sub-path
(`https://<user>.github.io/<repo>/`), and per-PR previews add a further segment.
`lib/base.ts` turns the `BASE_URL` the deploy workflow sets into that prefix;
the shell, the pages and the router all read it from there, and the build strips
it back off when writing so the output always lands at `dist/`'s root.

Locally `BASE_URL` is unset and the site is served from `/`. To preview a
sub-path deployment:

```sh
BASE_URL=http://localhost:8000/parallax deno task dev
```

`deno serve` prints the root URL, but with `BASE_URL` set the site lives under
the prefix — open <http://localhost:8000/parallax>.

### Which file answers which URL

GitHub Pages serves `/how-it-works` from `how-it-works.html`, and 404s
`/how-it-works/` when only that file exists. `router.ts` states that rule as
`fileServer = githubPages()`, and the same object does two jobs: the build
writes the file that rule would reach for, and `serveAsHost` makes the dev
server resolve requests the way the deploy will — so a trailing slash that 404s
in production 404s locally too.

Deployment is wired up in `.github/workflows/pages.yml` at the repository root.
