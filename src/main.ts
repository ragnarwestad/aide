// CLI: generate [--root DIR] [--out FILE]
// Default root: ~/develop. Default out: out/index.html.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { discoverProjects } from "./discover.ts";
import { parseManifest } from "./parse-manifest.ts";
import { parseStatus } from "./parse-status.ts";
import { renderPage, type ProjectView } from "./render.ts";

export function main(argv: string[]): number {
  if (argv[0] !== "generate") {
    console.error("usage: main.ts generate [--root DIR] [--out FILE]");
    return 2;
  }
  let root = join(homedir(), "develop");
  let out = join("out", "index.html");
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

  const html = renderPage(projects, new Date().toISOString());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`wrote ${out} (${projects.length} projects)`);
  return 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
