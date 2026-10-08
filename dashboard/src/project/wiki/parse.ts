// The wiki's page format, in one place: the front matter, the index's lines,
// the name of a page and the address a link between pages opens. The page
// state rule (`state.ts`) and the reads (`read.ts`) are built on these.
//
// The mark `wiki: generated` is also read by `core/scripts/aide-wiki`; the
// two agree on it through `test/project/wiki/state.test.ts`.

/** What a page may be called: the rule `aide-wiki write` enforces. */
export const WIKI_PAGE = /^[a-z0-9-]+\.md$/;

export interface PageMark {
  generated: boolean;
  commit: string;
  files: string[];
}

/** The address of the Wiki tab, or of one of its pages. */
export function wikiPagePath(project: string, page?: string): string {
  const tab = `/projects/${encodeURIComponent(project)}?tab=wiki`;
  return page ? `${tab}&page=${page}` : tab;
}

/** A page's front matter and the text that follows it. A page with no front
 *  matter is hand-written and is all body. */
export function splitPage(text: string): { mark: PageMark; body: string } {
  const none: PageMark = { generated: false, commit: "", files: [] };
  const lines = text.split("\n");
  if (lines[0] !== "---") return { mark: none, body: text };
  const end = lines.indexOf("---", 1);
  if (end < 0) return { mark: none, body: text };
  const front = lines.slice(1, end);
  const files: string[] = [];
  let inFiles = false;
  for (const line of front) {
    if (line.startsWith("files:")) { inFiles = true; continue; }
    if (inFiles && line.startsWith("  - ")) { files.push(line.slice(4)); continue; }
    inFiles = false;
  }
  const commit = front.find((l) => l.startsWith("commit:"))?.slice(7).trim() ?? "";
  let start = end + 1;
  while (start < lines.length && lines[start] === "") start++;
  return {
    mark: { generated: front.includes("wiki: generated"), commit, files },
    body: lines.slice(start).join("\n"),
  };
}

export interface IndexEntry {
  page: string;
  title: string;
  summary: string;
}

/** The index's lines — `- [Title](page.md) — summary` — in the order the
 *  index gives them. */
export function parseIndex(body: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const line of body.split("\n")) {
    const m = line.match(/^- \[(.+?)\]\(([a-z0-9-]+\.md)\)(?: — (.*))?$/);
    if (m) out.push({ page: m[2]!, title: m[1]!, summary: m[3] ?? "" });
  }
  return out;
}

/** A page's first heading, or its file name without `.md`. */
export function pageTitle(body: string, page: string): string {
  const heading = body.split("\n").find((l) => l.startsWith("# "));
  return heading ? heading.slice(2).trim() : page.replace(/\.md$/, "");
}

/** The first line with text after the page's heading. */
export function pageSummary(body: string): string {
  const lines = body.split("\n");
  const at = lines.findIndex((l) => l.startsWith("# "));
  return lines.slice(at + 1).find((l) => l.trim() !== "")?.trim() ?? "";
}

/** A link to another wiki page (`wiki/schema.md`, "Links"): `](name.md)`,
 *  with or without a `#fragment`. The one form a link between pages takes —
 *  shared so a second reading of it never disagrees with this one. */
export const WIKI_LINK = /\]\(([a-z0-9-]+\.md)(#[^)\s]*)?\)/g;

/** A link to another page (`](name.md)`, with or without a `#fragment`)
 *  becomes the address that opens that page on the Wiki tab. */
export function rewritePageLinks(text: string, project: string): string {
  return text.replace(WIKI_LINK, (_all, page: string, fragment?: string) =>
    `](${wikiPagePath(project, page)}${fragment ?? ""})`);
}

/** Every page a body links to, fragment cut off, in the order the links
 *  appear — duplicates included, since a caller pairing pages decides what
 *  to do with more than one link to the same page. */
export function pageLinks(body: string): string[] {
  return [...body.matchAll(WIKI_LINK)].map((m) => m[1]!);
}
