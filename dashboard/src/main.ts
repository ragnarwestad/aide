// CLI: generate [--root DIR] [--out DIR]
// Default root: ~/develop. Default out: out/ — the site directory
// (projects.html + one page per project). The bare `/` is not a file
// here: the Bun server answers it with the spec list (spec 100).

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildProjectViews } from "./project/discover.ts";
import { renderSite, type Page } from "./render.ts";
import { setBoardInfo } from "./render/ui/board-info.ts";

// Write every page and remove ONLY .html files not in the produced
// page set — the local directory must mirror the site exactly (the
// publish step rsyncs it with --delete), but nothing else in a
// user-supplied directory is touched.
export function writeSite(pages: Page[], dir: string): void {
  mkdirSync(dir, { recursive: true });
  const produced = new Set(pages.map((p) => p.path));
  for (const entry of readdirSync(dir)) {
    if (entry.endsWith(".html") && !produced.has(entry)) rmSync(join(dir, entry));
  }
  for (const page of pages) writeFileSync(join(dir, page.path), page.html);
}

export function main(argv: string[]): number {
  if (argv[0] !== "generate") {
    console.error("usage: main.ts generate [--root DIR] [--out DIR] [--test-board SPEC]");
    return 2;
  }
  let root = join(homedir(), "develop");
  let out = "out";
  // Always called, including with `undefined` when the flag is absent —
  // `board-info.ts`'s own rule, since `bun test` runs many `main()`
  // calls in one process and a merge/leave-if-set read would let an
  // earlier call's test-board value leak into a later, ordinary one.
  let testBoardSpec: string | undefined;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = argv[++i]!;
    else if (argv[i] === "--out" && argv[i + 1]) out = argv[++i]!;
    // Spec 424: `test/round/run` generates a test board's own
    // Projects/About pages through this same command, before it starts
    // `serve.ts serve` — those two pages need to read "Test" too.
    else if (argv[i] === "--test-board" && argv[i + 1]) testBoardSpec = argv[++i]!;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      return 2;
    }
  }
  setBoardInfo(testBoardSpec);

  // The same walk the served `/projects` page makes (spec 115): one
  // function, so the generated page and the served one can never
  // disagree about what is on disk.
  const projects = buildProjectViews(root);

  const pages = renderSite(projects, new Date().toISOString());
  writeSite(pages, out);
  console.log(`wrote ${pages.length} pages to ${out}/ (${projects.length} projects)`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
