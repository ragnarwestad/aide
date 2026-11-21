// Which image a project's icon is: the manifest's `icon` when its default
// branch tracks that image, else the tracked favicon nearest the root, else
// none. Read off a real repository's `refs/remotes/origin/<base>`, so a file
// that is only in the working tree is never found.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createGitRunner } from "../../../src/git/process/index.ts";
import { readBlob, resolveProjectIcon } from "../../../src/project/project-icon/index.ts";

const run = createGitRunner(10_000);
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x80, 0x0d]);

/** A repository whose default branch, as origin last answered, tracks
 *  `files`; `untracked` stand in the working tree only. */
function repo(files: Record<string, string | Uint8Array>, untracked: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-project-icon-"));
  dirs.push(dir);
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(dir, "README.md"), "x\n");
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  git("add", "-A");
  git("commit", "-qm", "files");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  for (const path of untracked) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), "<svg/>");
  }
  return dir;
}

describe("resolveProjectIcon", () => {
  test("the manifest's icon, when the default branch tracks it, and its exact bytes (AC-13)", async () => {
    const dir = repo({ "assets/logo.png": PNG, "favicon.svg": "<svg/>" });
    expect(await resolveProjectIcon(run, dir, "main", "assets/logo.png")).toBe("assets/logo.png");
    expect(await readBlob(dir, "refs/remotes/origin/main", "assets/logo.png")).toEqual(PNG);
  });

  test("without icon, the favicon nearest the root wins, then SVG before PNG before ICO (AC-14)", async () => {
    const nearest = repo({ "web/favicon.png": "p", "favicon.ico": "i", "public/favicon.svg": "s" });
    expect(await resolveProjectIcon(run, nearest, "main")).toBe("favicon.ico");
    const kinds = repo({ "a/favicon.png": "p", "b/favicon.svg": "s", "c/favicon.ico": "i" });
    expect(await resolveProjectIcon(run, kinds, "main")).toBe("b/favicon.svg");
  });

  test("a favicon under a folder named outside ASCII is found as its own path (AC-14)", async () => {
    const dir = repo({ "blå/favicon.svg": "s" });
    expect(await resolveProjectIcon(run, dir, "main")).toBe("blå/favicon.svg");
  });

  test("an untracked file is never the icon, whether named by icon or found as a favicon (AC-16)", async () => {
    const dir = repo({}, ["dist/favicon.svg", "assets/new.png"]);
    expect(await resolveProjectIcon(run, dir, "main", "assets/new.png")).toBeNull();
    expect(await resolveProjectIcon(run, dir, "main")).toBeNull();
  });

  test("an icon that is not an image type is treated as unset (AC-17)", async () => {
    const dir = repo({ "page.html": "<script>alert(1)</script>", "favicon.png": "p" });
    expect(await resolveProjectIcon(run, dir, "main", "page.html")).toBe("favicon.png");
  });

  test("two reads at one commit with different icons each answer their own (AC-13, AC-14)", async () => {
    const dir = repo({ "a.png": "a", "b.png": "b" });
    expect(await resolveProjectIcon(run, dir, "main", "a.png")).toBe("a.png");
    expect(await resolveProjectIcon(run, dir, "main", "b.png")).toBe("b.png");
  });

  test("no default branch, no icon", async () => {
    const dir = repo({ "favicon.svg": "s" });
    expect(await resolveProjectIcon(run, dir, null)).toBeNull();
  });
});
