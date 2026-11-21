// GET /projects/<name>/icon: the image a project's default branch tracks,
// as the bytes git holds, under headers that keep an SVG from running
// anything on the board's own origin when the address is opened by itself.
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createGitRunner } from "../../../../src/git/process/index.ts";
import { queueHarness } from "../../../helpers/queue-server.ts";

const harness = queueHarness("aide-project-icon-route-");
afterEach(() => harness.cleanup());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x80]);

/** A board whose project `aide` is a repository tracking `files` on the
 *  default branch origin last answered for, with `manifest` appended to
 *  its `.aide/project.yaml`. */
function board(files: Record<string, string | Uint8Array>, manifest = ""): string {
  return harness.start({
    extra: { gitRun: createGitRunner(10_000) },
    before: (dir) => {
      const project = join(dir, "root", "aide");
      if (manifest) appendFileSync(join(project, ".aide", "project.yaml"), manifest);
      for (const [path, body] of Object.entries(files)) {
        mkdirSync(dirname(join(project, path)), { recursive: true });
        writeFileSync(join(project, path), body);
      }
      const git = (...args: string[]) => {
        const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: project });
        if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
      };
      git("init", "-q", "-b", "main");
      git("add", "-A");
      git("commit", "-qm", "files");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
    },
  }).base;
}

describe("GET /projects/<name>/icon", () => {
  test("answers the configured icon's exact bytes as its image type (AC-13)", async () => {
    const base = board({ "assets/logo.png": PNG, "favicon.svg": "<svg/>" }, "icon: assets/logo.png\n");
    const res = await fetch(`${base}/projects/aide/icon`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  test("an SVG comes with a sandboxing policy and no sniffing, so it runs nothing (AC-17)", async () => {
    const base = board({ "favicon.svg": "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>" });
    const res = await fetch(`${base}/projects/aide/icon`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a project with no icon and no tracked favicon answers 404 (AC-15)", async () => {
    const base = board({});
    expect((await fetch(`${base}/projects/aide/icon`)).status).toBe(404);
  });

  test("a project the board does not serve answers 404", async () => {
    const base = board({ "favicon.svg": "<svg/>" });
    expect((await fetch(`${base}/projects/nosuch/icon`)).status).toBe(404);
  });
});
