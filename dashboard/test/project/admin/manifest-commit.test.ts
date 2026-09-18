// A Settings save's manifest keys are committed and pushed in the
// dashboard's own checkout, never left on disk. Left there, the next
// pull into that checkout — every tick on every spec of the project —
// was refused over "uncommitted changes" (paceup, 2026-09-18).
//
// Real git, a real bare origin: the rule is about what origin holds and
// whether the checkout is clean afterwards, and a fake git can answer
// both whatever the code does.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { commitManifestEdits, updateProjectSettings } from "../../../src/project/project-admin";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const res = Bun.spawnSync(["git", ...args], { cwd });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr.toString()}`);
  return res.stdout.toString();
}

/** A checkout on `main`, cloned from a bare origin, with a manifest. */
function checkout(): { root: string; origin: string } {
  const base = mkdtempSync(join(tmpdir(), "aide-manifest-commit-"));
  dirs.push(base);
  const origin = join(base, "origin.git");
  const seed = join(base, "seed");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(join(seed, ".aide"), { recursive: true });
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "T");
  writeFileSync(join(seed, ".aide", "project.yaml"), "name: demo\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const root = join(base, "code");
  git(base, "clone", "-q", origin, root);
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "T");
  return { root, origin };
}

const gitSeam = { run: createGitRunner(30_000), resolveBase: async () => "main" };
const onOrigin = (origin: string) => git(origin, "show", "main:.aide/project.yaml");
const dirty = (root: string) => git(root, "status", "--porcelain").trim();

describe("a Settings save commits the manifest", () => {
  test("the edit reaches origin and leaves the checkout clean", async () => {
    const { root, origin } = checkout();

    const saved = await commitManifestEdits(gitSeam, root, [{ key: "previewCmd", value: "pnpm dev --port $PORT" }]);

    expect(saved).toEqual({ ok: true });
    expect(onOrigin(origin)).toContain("previewCmd: pnpm dev --port $PORT");
    expect(dirty(root)).toBe("");
  });

  test("several keys in one save are one commit", async () => {
    const { root, origin } = checkout();
    const before = git(origin, "rev-list", "--count", "main").trim();

    await commitManifestEdits(gitSeam, root, [
      { key: "previewCmd", value: "pnpm dev" },
      { key: "worktreeLinks", value: "node_modules .env.local" },
    ]);

    expect(Number(git(origin, "rev-list", "--count", "main").trim())).toBe(Number(before) + 1);
    expect(onOrigin(origin)).toContain("worktreeLinks: node_modules .env.local");
  });

  // The dashboard's own checkout can lag origin: another machine pushed,
  // and nothing here has pulled yet. The edit is worked out against the
  // manifest as origin has it, or a save finds "nothing to change" in
  // a copy that is out of date and commits nothing at all.
  test("a checkout behind origin is brought up before the edit is worked out", async () => {
    const { root, origin } = checkout();
    const other = join(root, "..", "other");
    git(join(root, ".."), "clone", "-q", origin, other);
    git(other, "config", "user.email", "o@example.com");
    git(other, "config", "user.name", "O");
    writeFileSync(join(other, ".aide", "project.yaml"), "name: demo\ncodeLanding: pr\n");
    git(other, "commit", "-qam", "pr from elsewhere");
    git(other, "push", "-q", "origin", "main");

    const saved = await commitManifestEdits(gitSeam, root, [{ key: "codeLanding", value: "" }]);

    expect(saved).toEqual({ ok: true });
    expect(onOrigin(origin)).not.toContain("codeLanding");
    expect(dirty(root)).toBe("");
  });

  test("nothing changed is nothing committed", async () => {
    const { root, origin } = checkout();
    const before = git(origin, "rev-parse", "main").trim();

    const saved = await commitManifestEdits(gitSeam, root, [{ key: "codeLanding", value: "" }]);

    expect(saved).toEqual({ ok: true });
    expect(git(origin, "rev-parse", "main").trim()).toBe(before);
  });

  test("through updateProjectSettings, nothing is left on disk either", async () => {
    const { root, origin } = checkout();

    const result = await updateProjectSettings(
      gitSeam.run,
      root,
      { specsPath: "", worktreeLinks: "node_modules", previewCmd: "pnpm dev" },
      { saveManifest: (edits) => commitManifestEdits(gitSeam, root, edits) },
    );

    expect(result.steps.filter((s) => !s.ok)).toEqual([]);
    expect(onOrigin(origin)).toContain("previewCmd: pnpm dev");
    expect(readFileSync(join(root, ".aide", "project.yaml"), "utf-8")).toContain("worktreeLinks: node_modules");
    expect(dirty(root)).toBe("");
  });
});
