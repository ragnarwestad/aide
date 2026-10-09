// Asking a git address which test command its root files point at, without
// making a checkout: every failure is `null`, and nothing is left behind.
// A real git against a bare repository on disk, through `file://` because a
// plain path ignores `--filter`.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../../../src/git/branch-status.ts";
import { detectRemoteTestCommand } from "../../../src/project/project-admin";
import { git, projectWithOrigin } from "./git-fixture.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const run = createGitRunner(30_000);

/** A bare origin holding `files`, set to serve a filtered clone. */
function originWith(files: Record<string, string>): string {
  const f = projectWithOrigin(files, { clone: false });
  cleanups.push(f.cleanup);
  git(f.origin, "config", "uploadpack.allowFilter", "true");
  return `file://${f.origin}`;
}

/** An empty directory for the probe to work in, which must be empty again afterwards. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-probe-scratch-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("detectRemoteTestCommand (AC-1)", () => {
  test("the root files of a remote reach the lockfile table (AC-1)", async () => {
    const parent = scratch();
    expect(await detectRemoteTestCommand(run, originWith({ "package-lock.json": "{}" }), parent)).toBe("npm test");
    expect(readdirSync(parent)).toEqual([]);
  });

  test("a root with no file the table knows answers null (AC-1)", async () => {
    const parent = scratch();
    expect(await detectRemoteTestCommand(run, originWith({ "notes.txt": "hi" }), parent)).toBeNull();
    expect(readdirSync(parent)).toEqual([]);
  });

  test("an empty repository answers null (AC-1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "aide-probe-empty-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const empty = join(root, "empty.git");
    mkdirSync(empty);
    git(empty, "init", "-q", "--bare");
    const parent = scratch();
    expect(await detectRemoteTestCommand(run, `file://${empty}`, parent)).toBeNull();
    expect(readdirSync(parent)).toEqual([]);
  });

  test("an address that cannot be cloned, or none at all, answers null (AC-1)", async () => {
    const parent = scratch();
    expect(await detectRemoteTestCommand(run, "file:///no/such/repository.git", parent)).toBeNull();
    expect(await detectRemoteTestCommand(run, "", parent)).toBeNull();
    expect(await detectRemoteTestCommand(run, "--upload-pack=touch /tmp/aide-probe-injected", parent)).toBeNull();
    expect(readdirSync(parent)).toEqual([]);
  });
});
