// The landing's own git runs no hooks. It runs outside the sandbox, on a
// tree a step wrote, and a hook that reads the working tree (a relative
// `core.hooksPath`, lefthook's `lefthook.yml`) would run what the step
// wrote there. `aide-run-spec` makes the same decision in bash
// (`core/scripts/lib/run-spec/setup/git-hooks.sh`).

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../src/git/branch-status.ts";
import { NO_GIT_HOOKS } from "../../src/integrations/no-git-hooks.ts";
import { assignSpecNumberAfterMerge } from "../../src/serve/land-branch/finalize-create.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A repository whose hooks live in its working tree, with a
 *  `pre-commit` that leaves a mark when it runs. */
function repoWithPlantedHook(): { repo: string; marker: string } {
  const dir = mkdtempSync(join(tmpdir(), "aide-no-git-hooks-"));
  dirs.push(dir);
  const repo = join(dir, "repo");
  const marker = join(dir, "hook-ran.txt");
  mkdirSync(join(repo, ".githooks"), { recursive: true });
  const git = (...args: string[]) => Bun.spawnSync({ cmd: ["git", ...args], cwd: repo });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.hooksPath", ".githooks");
  writeFileSync(join(repo, ".githooks", "pre-commit"), `#!/bin/sh\necho ran >> ${marker}\n`);
  chmodSync(join(repo, ".githooks", "pre-commit"), 0o755);
  return { repo, marker };
}

describe("the landing's git runs no hooks", () => {
  test("a commit through the dashboard's git runner", async () => {
    const { repo, marker } = repoWithPlantedHook();
    const result = await createGitRunner()(repo, ["commit", "-q", "--allow-empty", "-m", "landed"]);
    expect(result.code).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("a commit aide-create-spec makes while the landing numbers a new spec", async () => {
    const { repo, marker } = repoWithPlantedHook();
    const bin = join(repo, "..", "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "aide-create-spec"),
      `#!/bin/sh\ngit commit -q --allow-empty -m numbered || exit 1\nprintf '{"ok":true,"specFolder":"07-x"}\\n'\n`,
    );
    chmodSync(join(bin, "aide-create-spec"), 0o755);
    const answer = await assignSpecNumberAfterMerge(repo, repo, repo, "new-abc12345", { scriptDir: bin });
    expect(answer).toEqual({ ok: true, specFolder: "07-x" });
    expect(existsSync(marker)).toBe(false);
  });
});

describe("the runner and the landing turn hooks off the same way", () => {
  test("the bash side's git function passes the same setting", () => {
    const bash = readFileSync(
      new URL("../../../core/scripts/lib/run-spec/setup/git-hooks.sh", import.meta.url),
      "utf8",
    );
    expect(bash).toContain(`git() { command git ${NO_GIT_HOOKS.join(" ")} "$@"; }`);
  });
});

describe("every git the landing starts itself carries the setting", () => {
  test("no git command line under src/serve/land-branch goes without it", () => {
    const dir = new URL("../../src/serve/land-branch/", import.meta.url).pathname;
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const bare: string[] = [];
    for (const f of files) {
      for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
        if (line.includes('["git",') && !line.includes('["git", ...NO_GIT_HOOKS')) bare.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
