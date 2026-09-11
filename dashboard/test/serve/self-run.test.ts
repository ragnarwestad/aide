// The test board's own Run control (2026-09-11): `POST /api/self-run`
// puts the board back to its start — live jobs cancelled, the project's
// jobs dropped, the two throwaway repositories back to their first
// commit as a new commit on main — and sends the round's fixtures
// through create again.
//
// The fixture set here is EMPTY on purpose: a create job only lands
// through a real runner, which no unit test should start. What is
// proven is everything before the fixtures go in — the reset — and
// that the route then reports the round as queued.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { resetRoundState } from "../../src/serve/handle-queue/self-run.ts";

const TOKEN = "s3cret-token";
const auth = { headers: { "x-aide-token": TOKEN, accept: "application/json" } };
const TEST_BOARD = "aide-wt-run";

const harness = queueHarness("aide-self-run-");

/** An empty fixture set of its own: the harness's directory is only
 *  known once the server is up, and the option has to be given first. */
let fixtures: string;
beforeEach(() => {
  fixtures = mkdtempSync(join(tmpdir(), "aide-self-run-fixtures-"));
});
afterEach(() => {
  harness.cleanup();
  rmSync(fixtures, { recursive: true, force: true });
  resetRoundState();
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@localhost", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A repository with a bare origin, its first commit on `main` (tagged
 *  `baseline` when asked), and one more commit after it — the state a
 *  round's fixture project is in once a run has landed something. */
function repoWithHistory(dir: string, origin: string, tag: boolean): void {
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  writeFileSync(join(dir, "fact.txt"), "first\n");
  git(dir, "add", "fact.txt");
  git(dir, "commit", "-q", "-m", "start");
  if (tag) git(dir, "tag", "baseline");
  writeFileSync(join(dir, "fact.txt"), "first\nsecond\n");
  writeFileSync(join(dir, "extra.txt"), "left by a run\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "a run landed this");
  git(dir, "push", "-q", "origin", "main");
  // A branch a run left behind, on origin and here.
  git(dir, "branch", "aide/01-something");
  git(dir, "push", "-q", "origin", "aide/01-something");
}

describe("POST /api/self-run", () => {
  test("requires the token like every other queue route", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD } });
    const res = await fetch(`${base}/api/self-run`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("with no board info, answers 404 to both the press and the status", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN } });
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(404);
    expect((await fetch(`${base}/api/self-run`, auth)).status).toBe(404);
  });

  test("before any press the status is idle", async () => {
    const { base } = harness.start({ extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD } });
    const res = await fetch(`${base}/api/self-run`, auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stage: "idle", specs: [] });
  });

  test("a press resets both repositories to their start, drops the project's jobs, and queues the round", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures },
    });
    // The harness's project is `aide` at root/aide; its specs go to a
    // repository of their own, the way a round's `.aide/config` says.
    const code = join(dir, "root", "aide");
    const specs = join(dir, "specs-repo");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specs}\n`);
    repoWithHistory(code, join(dir, "code-origin.git"), true);
    repoWithHistory(specs, join(dir, "specs-origin.git"), false);
    // The queue holds a row from the last round.
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { ...auth.headers, "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
    });
    expect(queued.status).toBe(200);

    const pressed = await fetch(`${base}/api/self-run`, { method: "POST", ...auth });
    expect(pressed.status).toBe(200);
    expect(await pressed.json()).toEqual({ ok: true, stage: "resetting" });

    let state: { stage: string; startedAt?: string; error?: string; specs: unknown[] } = { stage: "resetting", specs: [] };
    for (let i = 0; i < 100 && state.stage !== "done" && state.stage !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      state = (await (await fetch(`${base}/api/self-run`, auth)).json()) as typeof state;
    }
    expect(state).toEqual({ stage: "done", startedAt: expect.any(String), specs: [] });

    // Both working trees are what the first commit held, and main IS
    // that commit again — history and all, on origin too, since the
    // spec's phases are read from the runner's commits in it; the run's
    // branch is gone.
    for (const [repo, origin] of [
      [code, join(dir, "code-origin.git")],
      [specs, join(dir, "specs-origin.git")],
    ]) {
      expect(readFileSync(join(repo, "fact.txt"), "utf8")).toBe("first\n");
      expect(git(repo, "ls-files")).toBe("fact.txt");
      expect(git(repo, "log", "--format=%s")).toBe("start");
      expect(git(repo, "rev-parse", "main")).toBe(git(origin, "rev-parse", "main"));
      expect(git(origin, "branch", "--list", "aide/*")).toBe("");
      expect(git(repo, "branch", "--list", "aide/*")).toBe("");
      // And no ref of any kind reaches the old history any more — the
      // runner reads completed steps with `git log --all`, so a stale
      // remote-tracking `origin/aide/*` would hand the next round the
      // last one's steps.
      expect(git(repo, "for-each-ref", "refs/remotes/origin/aide/")).toBe("");
      expect(git(repo, "log", "--all", "--format=%s")).toBe("start");
    }
    // The dashboard's own clones, where the landings merge, sit at the
    // same start with the same clean set of refs.
    for (const owned of [join(dir, "owned", "aide", "code"), join(dir, "owned", "aide", "specs")]) {
      if (!existsSync(join(owned, ".git"))) continue;
      expect(git(owned, "log", "--all", "--format=%s")).toBe("start");
      expect(git(owned, "for-each-ref", "refs/remotes/origin/aide/")).toBe("");
    }
    // The gitignored config a round writes stays where it was.
    expect(readFileSync(join(code, ".aide", "config"), "utf8")).toContain("AIDE_SPECS_PATH=");
    const jobs = (await (await fetch(`${base}/api/queue`, auth)).json()) as { jobs: unknown[] };
    expect(jobs.jobs).toEqual([]);
  });

  test("a second press while the first is still queueing is refused", async () => {
    const { base, dir } = harness.start({
      extra: { queueToken: TOKEN, testBoardSpec: TEST_BOARD, roundFixturesDir: fixtures },
    });
    const code = join(dir, "root", "aide");
    const specs = join(dir, "specs-repo");
    mkdirSync(specs, { recursive: true });
    writeFileSync(join(code, ".aide", "config"), `AIDE_SPECS_PATH=${specs}\n`);
    repoWithHistory(code, join(dir, "code-origin.git"), true);
    repoWithHistory(specs, join(dir, "specs-origin.git"), false);
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(200);
    expect((await fetch(`${base}/api/self-run`, { method: "POST", ...auth })).status).toBe(409);
  });
});
