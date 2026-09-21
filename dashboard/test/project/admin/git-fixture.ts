// A real git repository with a bare origin, for the tests that read
// what git says about a project's manifest.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString();
}

/** `<root>/projects/demo` cloned from `<root>/origin.git` with `files`
 *  committed, and an empty `<root>/checkouts` beside it.
 *
 *  `opts.clone: false` leaves the projects root EMPTY, for a test that
 *  calls `addProject` itself: a project is added by its git address now,
 *  and Add refuses a directory that is already there. */
export function projectWithOrigin(files: Record<string, string>, opts: { clone?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aide-untracked-settings-"));
  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  git(seed, "config", "user.email", "t@example.com");
  git(seed, "config", "user.name", "T");
  writeFileSync(join(seed, "README.md"), "hi\n");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(seed, path, ".."), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  git(seed, "add", "-A");
  git(seed, "commit", "-qm", "first");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  const projects = join(root, "projects");
  mkdirSync(projects);
  const dir = join(projects, "demo");
  if (opts.clone !== false) {
    git(root, "clone", "-q", origin, dir);
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "T");
  }
  const base = join(root, "checkouts");
  mkdirSync(base);
  return { root, origin, projects, dir, base, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
