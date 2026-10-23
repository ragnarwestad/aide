// `scripts/look-at-pages.ts`: the board a step serves to photograph the pages
// it changed. It must serve the checkout's own code on throwaway data, touch
// nothing in the home folder, and say why when it cannot go on.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveScene } from "../../scripts/look-at-pages.ts";

const FOLDER = "81-queue-and-runner";
const stops: (() => void)[] = [];
const home = process.env.HOME;
afterEach(() => {
  while (stops.length) stops.pop()!();
  process.env.HOME = home;
});

const scratch = (): string => mkdtempSync(join(tmpdir(), "look-at-pages-"));

describe("serveScene", () => {
  test("serves the scene's spec and its queued job on 127.0.0.1, and leaves the home folder empty (AC-8)", async () => {
    const emptyHome = scratch();
    process.env.HOME = emptyHome;
    const board = await serveScene({
      description: "# A scene only this test wrote - Description\n",
      queueMirror: [
        {
          id: "queued1", project: "aide", specFolder: FOLDER, steps: ["analyze"], stepIndex: 0, state: "queued",
          timeoutSec: {}, permissionMode: {}, model: {}, createdAt: "2026-10-23T10:00:00Z",
        },
      ],
    });
    stops.push(board.stop);

    expect(board.base.startsWith("http://127.0.0.1:")).toBe(true);
    const page = await (await fetch(`${board.base}/`)).text();
    expect(page).toContain(FOLDER);
    const queue = (await (await fetch(`${board.base}/api/queue`)).json()) as { jobs: { id: string; state: string }[] };
    expect(queue.jobs.find((j) => j.id === "queued1")?.state).toBe("queued");
    expect(readdirSync(emptyHome)).toEqual([]);
  });

  test("an empty scene serves the default board (AC-8)", async () => {
    const board = await serveScene({});
    stops.push(board.stop);
    const res = await fetch(`${board.base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(FOLDER);
  });
});

describe("the command line", () => {
  test("a scene that does not parse writes the reason to not-taken.txt and exits 1 (AC-5)", async () => {
    const dir = scratch();
    const scene = join(dir, "scene.json");
    writeFileSync(scene, "{ not json");
    const out = join(dir, "shots");
    const run = Bun.spawnSync({
      cmd: ["bun", join(import.meta.dir, "../../scripts/look-at-pages.ts"), "--scene", scene, "--out", out, "/"],
      stdout: "pipe", stderr: "pipe",
    });
    expect(run.exitCode).toBe(1);
    expect(existsSync(join(out, "not-taken.txt"))).toBe(true);
    expect(readFileSync(join(out, "not-taken.txt"), "utf-8")).toContain("scene");
    expect(readdirSync(out).filter((f) => f.endsWith(".png"))).toEqual([]);
  });
});
