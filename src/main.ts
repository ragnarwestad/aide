// CLI: generate [--root DIR] [--out DIR]
// Default root: ~/develop. Default out: out/ — the site directory
// (index.html + one page per project).

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverProjects } from "./discover.ts";
import { parseManifest } from "./parse-manifest.ts";
import { parseStatus } from "./parse-status.ts";
import { renderSite, type Page, type ProjectView } from "./render.ts";

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
    console.error("usage: main.ts generate [--root DIR] [--out DIR]");
    return 2;
  }
  let root = join(homedir(), "develop");
  let out = "out";
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) root = argv[++i]!;
    else if (argv[i] === "--out" && argv[i + 1]) out = argv[++i]!;
    else {
      console.error(`unknown argument: ${argv[i]}`);
      return 2;
    }
  }

  const projects: ProjectView[] = discoverProjects(root).map((p) => ({
    name: p.name,
    manifest: parseManifest(readFileSync(p.manifestPath, "utf-8")),
    specs: p.specs.map((s) => {
      const statusPath = join(s.dir, "4-status.md");
      return {
        ...s,
        status: existsSync(statusPath)
          ? parseStatus(readFileSync(statusPath, "utf-8"))
          : null,
      };
    }),
  }));

  const pages = renderSite(projects, new Date().toISOString());
  writeSite(pages, out);
  console.log(`wrote ${pages.length} pages to ${out}/ (${projects.length} projects)`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
