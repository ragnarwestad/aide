// A specs root has to be a full path. The server reads a relative one
// from its own working directory — the dashboard's own checkout — so on
// 2026-09-24 `aide-specs/claude-plattform`, saved on a project's page,
// made a folder inside that checkout and set the project up to clone the
// dashboard's own repository as its specs. Refused where it is typed, on
// Add and on a save, before anything is written or cloned.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addProject, specsPathError, updateProjectSettings } from "../../../src/project/project-admin";
import { fakeGit } from "../../helpers/fake-git.ts";

const dirs: string[] = [];
const root = (): string => {
  const d = mkdtempSync(join(tmpdir(), "aide-specs-root-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("the rule", () => {
  test.each([["aide-specs/claude-plattform"], ["./specs"], ["../aide-specs/x"], ["~/develop/aide-specs/x"]])(
    "%p is refused, and the refusal says what to write instead",
    (value) => {
      const error = specsPathError(value);
      expect(error).toContain("full path");
      expect(error).toContain(value);
      expect(error).toContain("/Users/<you>/develop/aide-specs/<project>");
    },
  );

  test("a full path passes, and so does an empty value, which clears the setting", () => {
    expect(specsPathError("/Users/someone/develop/aide-specs/claude-plattform")).toBeNull();
    expect(specsPathError("")).toBeNull();
  });
});

describe("Add refuses it before anything is cloned", () => {
  test("no git call, no folder, and the step that refused is the specs one", async () => {
    const projectsRoot = root();
    const git = fakeGit({});
    const result = await addProject(git.run, projectsRoot, {
      name: "claude-plattform",
      gitUrl: "https://example.com/claude-plattform.git",
      specsPath: "aide-specs/claude-plattform",
      codeLanding: "pr",
    });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)!.step).toBe("specsConfig");
    expect(result.steps.at(-1)!.error).toContain("full path");
    expect(git.calls).toEqual([]);
    expect(existsSync(join(projectsRoot, "claude-plattform"))).toBe(false);
    // The folder a relative path would have made, read from this
    // process's own directory.
    expect(existsSync(join(process.cwd(), "aide-specs", "claude-plattform"))).toBe(false);
  });
});

describe("a save refuses it before either file is written", () => {
  test("the config keeps its old value, and no folder is made", async () => {
    const dir = join(root(), "claude-plattform");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: claude-plattform\n");
    writeFileSync(join(dir, ".aide", "config"), "AIDE_SPECS_PATH=/somewhere/claude-plattform\n");
    const result = await updateProjectSettings(fakeGit({}).run, dir, { specsPath: "aide-specs/claude-plattform" });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)!.error).toContain("full path");
    expect(readFileSync(join(dir, ".aide", "config"), "utf-8")).toBe("AIDE_SPECS_PATH=/somewhere/claude-plattform\n");
    expect(existsSync(join(process.cwd(), "aide-specs", "claude-plattform"))).toBe(false);
  });
});
