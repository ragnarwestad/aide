// Spec 512: a project added with no manifest in its repository is still a
// project. The dashboard's clone carries the manifest a run reads, and
// discovery and the project page read it from there when the project's
// own directory holds none.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProjects, discoverUnclaimedDirectories, manifestInside } from "../../../src/project/discover";
import { projectSettings } from "../../../src/project/project-settings.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A projects root with one entry that holds no manifest, and a clone
 *  that carries one. */
function world() {
  const root = mkdtempSync(join(tmpdir(), "aide-through-clone-"));
  dirs.push(root);
  const projects = join(root, "projects");
  const clone = join(root, "clone");
  mkdirSync(join(projects, "skjer"), { recursive: true });
  mkdirSync(join(clone, ".aide"), { recursive: true });
  writeFileSync(join(clone, ".aide", "project.yaml"), "name: skjer\ntestCmd: make check\n");
  return { projects, clone, fallback: manifestInside(() => clone) };
}

describe("discovery reads the manifest from the dashboard's clone", () => {
  test("a project whose own directory has no manifest is listed with the clone's (AC-4)", () => {
    const w = world();
    expect(discoverProjects(w.projects).map((p) => p.name)).toEqual([]);
    const found = discoverProjects(w.projects, undefined, w.fallback);
    expect(found.map((p) => p.name)).toEqual(["skjer"]);
    expect(found[0]!.manifestPath).toBe(join(w.clone, ".aide", "project.yaml"));
  });

  test("the directory is no longer offered as one to add (AC-4)", () => {
    const w = world();
    expect(discoverUnclaimedDirectories(w.projects)).toEqual(["skjer"]);
    expect(discoverUnclaimedDirectories(w.projects, w.fallback)).toEqual([]);
  });

  test("the settings page shows the test command from the clone (AC-4)", () => {
    const w = world();
    const own = join(w.projects, "skjer");
    const row = projectSettings(own, null, w.clone).rows.find((r) => r.key === "AIDE_TEST_CMD");
    expect(row?.value).toBe("make check");
    expect(projectSettings(own).rows.find((r) => r.key === "AIDE_TEST_CMD")?.origin).not.toBe("configured");
  });
});
