// Spec 515: through the real server and the real compressResponse, the
// spec page's head (with the loading element) reaches the client while the
// page's git calls are still held, and the rest follows when they are let
// go. Read with node:http, not fetch, so the wire chunks are seen as sent.
import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { constants, gunzipSync } from "node:zlib";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-spec-page-streams-");
afterEach(() => harness.cleanup());

const FOLDER = "81-queue-and-runner";

/** Real git, except that once `arm()` is called every call waits on `release()`. */
function gatedGit() {
  const real = createGitRunner();
  let armed = false;
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const hits: string[] = [];
  const run: GitRunner = async (dir, args, timeoutMs, env) => {
    if (armed) {
      hits.push(args.join(" "));
      await gate;
    }
    return real(dir, args, timeoutMs, env);
  };
  return { run, arm: () => { armed = true; }, release: open, hits };
}

interface Wire {
  chunks: Buffer[];
  ended: () => boolean;
  done: Promise<void>;
  headers: Record<string, string | string[] | undefined>;
  status: number;
}

/** Starts a GET and hands back what has arrived so far, on demand. */
function get(base: string, path: string, gzip: boolean): Promise<Wire> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = request(
      url,
      { agent: false, headers: gzip ? { "accept-encoding": "gzip" } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        let over = false;
        const done = new Promise<void>((r) => {
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => { over = true; r(); });
          res.on("error", () => { over = true; r(); });
        });
        resolve({ chunks, ended: () => over, done, headers: res.headers, status: res.statusCode ?? 0 });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = (chunks: Buffer[], gzip: boolean) => {
  const all = Buffer.concat(chunks);
  return gzip ? gunzipSync(all, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf-8") : all.toString("utf-8");
};

describe("the spec page is sent in two halves", () => {
  test("the head and the loading element arrive while the view is held, and the page has not ended (AC-1)", async () => {
    const git = gatedGit();
    const { base } = start({ gitRun: git.run });
    git.arm();
    const wire = await get(base, `/specs/aide/${FOLDER}?tab=description`, false);
    await sleep(400);
    try {
      expect(git.hits.length).toBeGreaterThan(0);
      const early = text(wire.chunks, false);
      expect(early).toContain("<!doctype html>");
      expect(early).toContain("<style>");
      expect(early).toContain("<body");
      expect(early).toContain('class="pageloading"');
      expect(early).not.toContain("<main>");
      expect(wire.ended()).toBe(false);
    } finally {
      git.release();
    }
    await wire.done;
    const whole = text(wire.chunks, false);
    expect(whole).toContain("<main>");
    expect(whole).toContain("</html>");
  });

  test("gzipped, the early bytes decode to the head and the loading element, and all of it after the release (AC-4)", async () => {
    const git = gatedGit();
    const { base } = start({ gitRun: git.run });
    git.arm();
    const wire = await get(base, `/specs/aide/${FOLDER}?tab=description`, true);
    await sleep(400);
    let early: string;
    try {
      expect(wire.headers["content-encoding"]).toBe("gzip");
      expect(git.hits.length).toBeGreaterThan(0);
      early = text(wire.chunks, true);
      expect(early).toContain('class="pageloading"');
      expect(early).not.toContain("<main>");
      expect(wire.ended()).toBe(false);
    } finally {
      git.release();
    }
    await wire.done;
    expect(text(wire.chunks, true)).toContain("</html>");
  });

  test("a folder that is not a spec is a 404 with no loading element (AC-1)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/999-no-such-spec`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("pageloading");
  });

  test("the Steps tab's refresh comes in the second half, before the header; other tabs have none (AC-1)", async () => {
    const { base } = start();
    const steps = await (await fetch(`${base}/specs/aide/${FOLDER}?tab=steps`)).text();
    const meta = steps.indexOf('http-equiv="refresh"');
    expect(meta).toBeGreaterThan(steps.indexOf("<body"));
    expect(meta).toBeLessThan(steps.indexOf("<header>"));
    const description = await (await fetch(`${base}/specs/aide/${FOLDER}?tab=description`)).text();
    expect(description).not.toContain('http-equiv="refresh"');
  });
});
