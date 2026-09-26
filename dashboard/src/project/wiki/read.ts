// The wiki as the specs repository's default branch holds it: read with
// `git show` off the branch's ref, never off the working tree, which lags
// origin and can sit on another branch.

import { join, relative } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { real } from "../../git/branch-file.ts";
import {
  WIKI_PAGE, pageSummary, pageTitle, parseIndex, rewritePageLinks, splitPage, type PageMark,
} from "./parse.ts";
import { pageStates } from "./state.ts";
import type { WikiPageLine, WikiView } from "./types.ts";

export interface WikiSource {
  project: string;
  /** The specs repository's top, and the project's specs root inside it. */
  top: string;
  dir: string;
  /** The default branch's remote-tracking ref. */
  ref: string;
  /** The project's own checkout, which page states are judged against. */
  projectDir: string;
}

/** The wiki's list, and the page `requested` names when it is a page name.
 *  Null when the branch has no `wiki/index.md`: the project has no wiki. */
export async function readWiki(run: GitRunner, src: WikiSource, requested: string | null): Promise<WikiView | null> {
  // Both sides resolved first: git answers with symlinks resolved, and a
  // path off the scan of the projects root does not.
  const wiki = relative(real(src.top), join(real(src.dir), "wiki")).split("\\").join("/");
  const show = async (name: string): Promise<string | null> => {
    const out = await run(src.top, ["show", `${src.ref}:${wiki}/${name}`]);
    return out.code === 0 ? out.stdout : null;
  };
  const indexText = await show("index.md");
  if (indexText === null) return null;

  const listing = await run(src.top, ["ls-tree", "--name-only", src.ref, `${wiki}/`]);
  const names = listing.code === 0
    ? listing.stdout.split("\n").map((l) => l.slice(l.lastIndexOf("/") + 1)).filter((n) => WIKI_PAGE.test(n))
    : [];
  const texts = new Map<string, string>([["index.md", indexText]]);
  await Promise.all(names.filter((n) => n !== "index.md").map(async (n) => {
    const text = await show(n);
    if (text !== null) texts.set(n, text);
  }));

  const split = new Map([...texts].map(([name, text]) => [name, splitPage(text)]));
  const marks = new Map<string, PageMark>([...split].map(([name, s]) => [name, s.mark]));
  const states = await pageStates(run, src.projectDir, marks);

  const line = (page: string, title: string, summary: string): WikiPageLine =>
    ({ page, title, summary, state: states.get(page) ?? "unknown" });
  const listed = parseIndex(split.get("index.md")!.body).filter((e) => split.has(e.page) && e.page !== "index.md");
  const seen = new Set<string>();
  const pages: WikiPageLine[] = [];
  for (const e of listed) {
    if (seen.has(e.page)) continue;
    seen.add(e.page);
    pages.push(line(e.page, e.title, e.summary));
  }
  for (const page of [...split.keys()].filter((n) => n !== "index.md" && !seen.has(n)).sort()) {
    const body = split.get(page)!.body;
    pages.push(line(page, pageTitle(body, page), pageSummary(body)));
  }

  if (requested === null || !WIKI_PAGE.test(requested)) return { pages };
  const found = split.get(requested);
  if (!found) return { pages, open: { page: requested, missing: true } };
  return {
    pages,
    open: { page: requested, state: states.get(requested) ?? "unknown", text: rewritePageLinks(found.body, src.project) },
  };
}
