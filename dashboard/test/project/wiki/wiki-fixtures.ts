// Real repositories for the wiki's tests: a project with commits, and pages
// whose front matter names a commit of it.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function git(cwd: string, ...args: string[]): string {
  const out = Bun.spawnSync({ cmd: ["git", "-C", cwd, ...args], stdout: "pipe", stderr: "pipe" });
  if (out.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${out.stderr.toString()}`);
  return out.stdout.toString().trim();
}

export function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
}

export function commitAll(dir: string, message: string): string {
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", message);
  return git(dir, "rev-parse", "HEAD");
}

export function write(dir: string, path: string, text: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
}

/** A generated page: the mark, the commit it was written from, its files. */
export function generatedPage(commit: string, files: string[], title: string, summary: string): string {
  const list = files.length === 0 ? "files: []\n" : `files:\n${files.map((f) => `  - ${f}`).join("\n")}\n`;
  return `---\nwiki: generated\ncommit: ${commit}\n${list}---\n\n# ${title}\n\n${summary}\n`;
}

export function scratch(dirs: string[], prefix = "aide-wiki-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export function cleanup(dirs: string[]): void {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
}
