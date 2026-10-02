// How strictly Analyze checks a spec's acceptance criteria: read from the
// manifest against the same table aide-run-spec's own test reads, and
// saved from the Config tab, where Warn, the default, removes the key.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateProjectSettings } from "../../../src/project/project-admin";
import { resolveCriteriaChecks } from "../../../src/project/discover";
import { fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** A checkout with a manifest holding `manifest` as its whole text. */
function checkout(manifest: string | null): string {
  const projectsRoot = mkdtempSync(join(tmpdir(), "aide-criteria-checks-"));
  dirs.push(projectsRoot);
  const dir = join(projectsRoot, "proj");
  mkdirSync(join(dir, ".aide"), { recursive: true });
  mkdirSync(join(dir, "specs"), { recursive: true });
  if (manifest !== null) writeFileSync(join(dir, ".aide", "project.yaml"), manifest);
  return dir;
}

const manifestText = (dir: string): string => readFileSync(join(dir, ".aide", "project.yaml"), "utf-8");

describe("where a project's criteria checks level is read from", () => {
  const CASES: { cases: { name: string; manifest: string | null; level: "off" | "warn" | "stop" }[] } = JSON.parse(
    readFileSync(join(import.meta.dir, "..", "..", "../../tests/fixtures/criteria-checks-level.json"), "utf-8"),
  );

  for (const c of CASES.cases) {
    test(`${c.name}: the level resolves to "${c.level}" (AC-1)`, () => {
      const dir = checkout(`name: x\n${c.manifest !== null ? `criteriaChecks: ${c.manifest}\n` : ""}`);
      expect(resolveCriteriaChecks(dir)).toBe(c.level);
    });
  }

  test("a project with no manifest at all is warn (AC-1)", () => {
    expect(resolveCriteriaChecks(checkout(null))).toBe("warn");
  });
});

describe("saving the criteria checks level", () => {
  test("stop and off are written, and warn takes the key out again (AC-1)", async () => {
    const dir = checkout("name: x\n");
    await updateProjectSettings(fakeGit({}).run, dir, { criteriaChecks: "stop" });
    expect(manifestText(dir)).toContain("criteriaChecks: stop");
    await updateProjectSettings(fakeGit({}).run, dir, { criteriaChecks: "off" });
    expect(manifestText(dir)).toContain("criteriaChecks: off");
    await updateProjectSettings(fakeGit({}).run, dir, { criteriaChecks: "warn" });
    expect(manifestText(dir)).not.toContain("criteriaChecks");
    expect(resolveCriteriaChecks(dir)).toBe("warn");
  });

  test("an unknown level is refused, and nothing is written (AC-1)", async () => {
    const dir = checkout("name: x\n");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { criteriaChecks: "strict" });
    expect(result.ok).toBe(false);
    expect(result.steps.some((s) => s.step === "criteriaChecks" && !s.ok)).toBe(true);
    expect(manifestText(dir)).toBe("name: x\n");
  });
});
