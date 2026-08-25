# remix3-ssg-gh-pages

A [Remix v3](https://remix.run) static-site starter built on
[`@kuboon/remix-ssg`](https://jsr.io/@kuboon/remix-ssg) and deployed to GitHub
Pages with per-PR previews.

The site is content and one `router.ts` that wires three directories into a
handler. `deno serve router.ts` is the dev server; the build crawls the same
handler straight from JSR, so there is no build script in this repository.
Islands are code-split out of one graph, so a module two of them share is
emitted once — and the home page shows what that buys.

The site lives in [`pages/`](./pages) — see [`pages/README.md`](./pages/README.md)
for how it works and how to develop it.

```sh
cd pages
deno task dev     # local dev server
deno task build   # generate the static site into pages/dist
```

## Deployment

`.github/workflows/pages.yml` calls the reusable
`kuboon/workflows/.github/workflows/github-page-with-preview.yaml` workflow. It
builds `main` at the Pages root and each pull request under a preview sub-path,
deploys both to GitHub Pages, and comments the preview URL on the PR. The build
runs via [`mise`](https://mise.jdx.dev) (`mise.toml`), which installs Deno and
runs `deno task build` with the correct `BASE_URL`.

To enable it: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
