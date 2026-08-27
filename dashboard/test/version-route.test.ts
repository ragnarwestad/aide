// Spec 269: GET /api/version — the running server's own boot-time commit,
// read once from `process.cwd()` and never refreshed for the life of the
// process. A restart that silently failed to happen looks exactly like one
// that worked until something asks what commit is actually running; this
// route is that ask, and the "Serving" line on a project's own page
// (project-detail-route.test.ts) compares it live to a checkout's HEAD.
import { afterEach, describe, expect, test } from "bun:test";
import type { GitRunner } from "../src/git/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const harness = queueHarness("aide-version-route-");

afterEach(() => {
  harness.cleanup();
});

/** Every plumbing call this server's boot makes, answering only the one
 *  under test — `rev-parse HEAD` — with `answer`. `--show-toplevel` gets a
 *  boring, unused answer so the boot read's `Promise.all` settles either
 *  way. */
function bootGit(answer: { code: number; stdout?: string }): { run: GitRunner } {
  const run: GitRunner = async (_dir, args) => {
    const cmd = args.join(" ");
    if (cmd === "rev-parse HEAD") return { code: answer.code, stdout: answer.stdout ?? "" };
    if (cmd === "rev-parse --show-toplevel") return { code: 0, stdout: "/tmp/wherever\n" };
    return { code: 1, stdout: "" };
  };
  return { run };
}

/** Poll `/api/version` until its `sha` matches `want`, or give up — the
 *  boot-time read is fire-and-forget (`.then()`, not awaited by
 *  `createServer`), so the answer can arrive a moment after the server
 *  starts rather than on the very first request. */
async function pollVersion(base: string, want: string | null, budgetMs = 2000): Promise<string | null> {
  const deadline = Date.now() + budgetMs;
  let sha: string | null = undefined as unknown as string | null;
  while (Date.now() < deadline) {
    const body = (await (await fetch(`${base}/api/version`)).json()) as { sha: string | null };
    sha = body.sha;
    if (sha === want) return sha;
    await new Promise((r) => setTimeout(r, 25));
  }
  return sha;
}

describe("GET /api/version — this process's own boot-time commit (spec 269)", () => {
  test("answers 200 with the SHA this process's own checkout is on (criterion 1)", async () => {
    const { run } = bootGit({ code: 0, stdout: "abc1234deadbeef\n" });
    const { base } = harness.start({ extra: { gitRun: run } });
    expect(await pollVersion(base, "abc1234deadbeef")).toBe("abc1234deadbeef");
  });

  test("a git that cannot answer still 200s, with sha null, never a 500 (criterion 2)", async () => {
    const { run } = bootGit({ code: 128 });
    const { base } = harness.start({ extra: { gitRun: run } });
    const res = await fetch(`${base}/api/version`);
    expect(res.status).toBe(200);
    // Not-yet-resolved and failed produce the identical `null` by
    // construction (`servingSha` starts `null` and is only ever set once
    // the read succeeds) — one short poll covers both, since neither state
    // ever becomes anything but `null` here.
    expect(await pollVersion(base, null)).toBeNull();
  });

  test("no token, no cookie — still 200, matching the unauthenticated PWA routes (criterion 6)", async () => {
    const { run } = bootGit({ code: 0, stdout: "abc1234deadbeef\n" });
    const { base } = harness.start({ extra: { gitRun: run } });
    // Deliberately no `x-aide-token` header and no cookie.
    const res = await fetch(`${base}/api/version`);
    expect(res.status).toBe(200);
  });

  test("only GET — POST is refused", async () => {
    const { run } = bootGit({ code: 0, stdout: "abc1234deadbeef\n" });
    const { base } = harness.start({ extra: { gitRun: run } });
    const res = await fetch(`${base}/api/version`, { method: "POST" });
    expect(res.status).toBe(405);
  });
});
