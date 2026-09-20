// Shared root fixture for the discover.ts suite, split by theme across
// discover-projects-and-owned-root.test.ts and
// discover-phase-and-duration.test.ts (split out of discover.test.ts).
//
// Criterion 1: discovery from an injectable scan root; specs-root
// resolution via .aide/config AIDE_SPECS_PATH vs the specs/ default;
// a manifest whose specs root does not exist yields zero specs, no
// error.

import { beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Registers the shared `root`/`externalSpecs` fixture on the calling
 *  file's own `beforeAll`/`afterAll` and hands back an object whose
 *  properties are filled in once `beforeAll` has run. */
export function useDiscoverRoot(): { root: string; externalSpecs: string } {
  const state = { root: "", externalSpecs: "" };

  beforeAll(() => {
    state.root = mkdtempSync(join(tmpdir(), "aide-dash-"));
    state.externalSpecs = join(state.root, "external-specs", "proj-a");

    // proj-a: manifest + .aide/config pointing at an external specs root
    const a = join(state.root, "proj-a");
    mkdirSync(join(a, ".aide"), { recursive: true });
    writeFileSync(join(a, ".aide", "project.yaml"), "name: proj-a\n");
    writeFileSync(join(a, ".aide", "config"), `AIDE_SPECS_PATH=${state.externalSpecs}\n`);
    mkdirSync(join(state.externalSpecs, "01-first-thing"), { recursive: true });
    writeFileSync(
      join(state.externalSpecs, "01-first-thing", "1-description.md"),
      "# The first thing - Description\n\n## Description\n\nIt does the first thing, thoroughly.\n\n---\n",
    );
    writeFileSync(
      join(state.externalSpecs, "01-first-thing", "4-status.md"),
      "# The first thing - Status\n\n**Total progress:** `50% (1 of 2 completed)`\n",
    );
    mkdirSync(join(state.externalSpecs, "archive", "02-old-thing"), { recursive: true });
    writeFileSync(
      join(state.externalSpecs, "archive", "02-old-thing", "1-description.md"),
      "# The old thing - Description\n",
    );

    // proj-b: manifest, no config -> specs/ in the project root
    const b = join(state.root, "proj-b");
    mkdirSync(join(b, ".aide"), { recursive: true });
    writeFileSync(join(b, ".aide", "project.yaml"), "name: proj-b\n");
    mkdirSync(join(b, "specs", "03-b-thing"), { recursive: true });
    writeFileSync(
      join(b, "specs", "03-b-thing", "1-description.md"),
      "# The b thing - Description\n",
    );

    // proj-c: manifest, config pointing at a directory that does not exist
    const c = join(state.root, "proj-c");
    mkdirSync(join(c, ".aide"), { recursive: true });
    writeFileSync(join(c, ".aide", "project.yaml"), "name: proj-c\n");
    writeFileSync(join(c, ".aide", "config"), `AIDE_SPECS_PATH=${join(state.root, "nowhere")}\n`);

    // not a project: no manifest
    mkdirSync(join(state.root, "plain-dir"), { recursive: true });
  });

  afterAll(() => {
    rmSync(state.root, { recursive: true, force: true });
  });

  return state;
}
