// GET /projects/<name>/icon: the image a project's default branch tracks,
// as the bytes git holds, under headers that keep an SVG from running
// anything on the board's own origin when the address is opened by itself.
// POST /projects/<name>/icon: a built-in icon, a file or Automatic, kept
// beside the board's checkouts and never in the project's repository.
import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  return boardAt(files, manifest).base;
}

function boardAt(files: Record<string, string | Uint8Array>, manifest = ""): { base: string; dir: string } {
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
  });
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

const choose = (base: string, fields: Record<string, string>): Promise<Response> =>
  fetch(`${base}/projects/aide/icon`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

const chooseFile = (base: string, filename: string, bytes: Uint8Array): Promise<Response> =>
  choose(base, { choice: "file", filename, data: Buffer.from(bytes).toString("base64") });

/** The one sentence a refused choice answers with. */
async function refusedWith(res: Response): Promise<string> {
  expect(res.status).toBe(400);
  const answer = (await res.json()) as { ok: boolean; results: { error?: string }[] };
  expect(answer.ok).toBe(false);
  return answer.results.map((r) => r.error).filter(Boolean).join(" ");
}

/** The icon the Projects list draws for `aide`. */
async function listedIcon(base: string): Promise<Element> {
  const window = new Window();
  window.document.body.innerHTML = await (await fetch(`${base}/projects`)).text();
  return window.document.querySelector('[data-project="aide"] .projicon') as unknown as Element;
}

const png = (size: number): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(size);
  // The signature, then the IHDR chunk's length and type.
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  // Every value, so the base64 carries the characters a form encodes longest.
  for (let i = 16; i < size; i++) bytes[i] = (i * 251) & 0xff;
  return bytes;
};

describe("POST /projects/<name>/icon", () => {
  test("a built-in icon and a colour become the project's icon, drawn in that colour (AC-2, AC-5)", async () => {
    const base = board({ "favicon.svg": "<svg/>" });
    const res = await choose(base, { choice: "glyph", glyph: "rocket", hue: "3" });
    expect(res.status).toBe(200);
    const icon = await listedIcon(base);
    expect(icon.tagName).toBe("SPAN");
    expect(icon.getAttribute("data-hue")).toBe("3");
    expect(icon.querySelector("svg")).not.toBeNull();
  });

  test("a PNG is kept beside the checkouts, served as its bytes, and drawn as an image (AC-3, AC-5)", async () => {
    const { base, dir } = boardAt({ "favicon.svg": "<svg/>" });
    const bytes = png(1024);
    expect((await chooseFile(base, "logo.png", bytes)).status).toBe(200);
    expect(existsSync(join(dir, "owned", "aide", "icon.png"))).toBe(true);
    const res = await fetch(`${base}/projects/aide/icon`);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect((await listedIcon(base)).getAttribute("src")).toMatch(/^\/projects\/aide\/icon\?v=\d+$/);
  });

  test("a file of exactly 512 KB is taken (AC-4)", async () => {
    const base = board({});
    expect((await chooseFile(base, "edge.png", png(524_288))).status).toBe(200);
  });

  test("a JPEG, a file over 512 KB and a body over the cap are each refused with why, and the icon is unchanged (AC-4)", async () => {
    const base = board({});
    const kept = png(64);
    await chooseFile(base, "kept.png", kept);
    expect(await refusedWith(await chooseFile(base, "logo.jpg", png(64)))).toBe("The file is not an SVG, PNG or ICO image.");
    expect(await refusedWith(await chooseFile(base, "big.png", png(600 * 1024)))).toBe("The file is 600 KB; an icon may be at most 512 KB.");
    expect(await refusedWith(await choose(base, { choice: "file", filename: "huge.png", data: "A".repeat(3_000_000) })))
      .toBe("The file is larger than 512 KB.");
    expect(new Uint8Array(await (await fetch(`${base}/projects/aide/icon`)).arrayBuffer())).toEqual(kept);
  });

  test("a chosen file wins over the tracked favicon, and Automatic gives the favicon back (AC-5, AC-6)", async () => {
    const { base, dir } = boardAt({ "favicon.svg": "<svg/>" });
    await chooseFile(base, "logo.png", png(64));
    expect((await fetch(`${base}/projects/aide/icon`)).headers.get("content-type")).toBe("image/png");
    expect((await choose(base, { choice: "automatic" })).status).toBe(200);
    expect(existsSync(join(dir, "owned", "aide", "icon.png"))).toBe(false);
    expect(existsSync(join(dir, "owned", "aide", "icon.json"))).toBe(false);
    expect((await fetch(`${base}/projects/aide/icon`)).headers.get("content-type")).toBe("image/svg+xml");
    expect((await listedIcon(base)).getAttribute("src")).toBe("/projects/aide/icon");
  });

  test("a chosen SVG is served sandboxed with no sniffing (AC-8)", async () => {
    const base = board({});
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    expect((await chooseFile(base, "a.svg", svg)).status).toBe(200);
    const res = await fetch(`${base}/projects/aide/icon`);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await listedIcon(base)).tagName).toBe("IMG");
  });
});
