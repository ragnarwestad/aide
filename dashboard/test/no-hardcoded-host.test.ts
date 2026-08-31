// A regression guard for spec 03's first requirement: the repository
// must not name one operator's machine. The deploy tooling and docs are
// where such a name creeps back in — a worked example pasted from a
// working setup reads as helpful right until someone else runs it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

// The deploy tooling and docs are the named files; `src/` is swept
// whole, because the analysis for this spec read it as clean and a
// comment in serve.ts still named a machine.
const FILES = [
  "Makefile",
  "README.md",
  // One level up since spec 85: the dashboard's manifest was folded
  // into aide's root one, and its `deployment.host` — the field this
  // guard was written for — went with it.
  "../.aide/project.yaml",
  "deploy/rsync-publish.sh",
  "deploy/notify-slack.sh",
  "deploy/render-plist.ts",
  // The example file is the likeliest place for a real host to be
  // pasted in "just to show what it looks like".
  ".env.deploy.example",
  ...[...new Bun.Glob("src/**/*.ts").scanSync(ROOT)],
  // `docs/` is swept whole for the same reason `src/` is: the pages
  // that carry a worked address are the ones a real host is pasted
  // into, and naming them one by one rots the moment one is added.
  ...[...new Bun.Glob("docs/**/*.md").scanSync(ROOT)],
];

// The identifying values that were in the repo when this guard was
// written. `mac mini` with a space catches the prose form; the IP is a
// specific machine's Tailscale address.
const FORBIDDEN = [/macmini/i, /mac ?mini/i, /macbook/i, /ragnarwestad/i, /100\.115\.106\.17/];

describe("no machine belonging to one operator is named in the repo", () => {
  for (const file of FILES) {
    test(`${file} names no specific host, user or address`, () => {
      const text = readFileSync(join(ROOT, file), "utf-8");
      for (const pattern of FORBIDDEN) {
        expect(text).not.toMatch(pattern);
      }
    });
  }

  test("no plist naming one operator is committed", () => {
    const files = [...new Bun.Glob("deploy/*.plist").scanSync(ROOT)];
    expect(files).toEqual([]);
  });
});
