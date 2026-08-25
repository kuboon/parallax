import { hastToRemix, markdownToHast } from "@kuboon/md";
import type { RemixNode } from "remix/ui";

/**
 * Renders a Markdown string to a Remix UI node tree, ready to place inside a page.
 *
 * `@kuboon/md` parses GitHub-flavored Markdown into a sanitized hast tree (heading anchors,
 * Shiki-highlighted code, tables, task lists) and `hastToRemix` converts it to `remix/ui` elements.
 */
export async function renderMarkdown(markdown: string): Promise<RemixNode> {
  const hast = await markdownToHast(markdown);
  return hastToRemix(hast) as RemixNode;
}
