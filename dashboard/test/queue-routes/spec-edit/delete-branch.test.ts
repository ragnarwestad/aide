// The Delete branch press on an archived row whose branch merged but is
// still on origin: a real createServer, real fixture files, real HTTP,
// and a git that runs no git. The code root and the specs root below it
// are one repository, so a delete that ran once per root would fail the
// second time.
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { queueHarness, statusSaying } from "../../helpers/queue-server.ts";
import { ARCHIVED_VIEW, blockFor, listUntil } from "../../archived/archived-specs-fixtures.ts";

// A press waits for the list to show the note first, which the sweep
// fills within its own ticks.
setDefaultTimeout(15_000);

const harness = queueHarness("aide-delete-branch-");
afterEach(() => harness.cleanup());

const FOLDER = "300-left-behind";
const BRANCH = `aide/${FOLDER}`;
const NOTE = "Press Delete branch to delete it there";
const DELETE = `push -q origin --delete ${BRANCH}`;

interface Origin {
  /** The branches origin holds. */
  has: Set<string>;
  /** `ls-remote` fails: origin cannot be asked. */
  unanswerable?: boolean;
  /** The root (by path suffix) whose merged answer is "not an ancestor". */
  notMergedIn?: string;
  /** Every root's merged answer is "not an ancestor": a squash merge. */
  notMergedAnywhere?: boolean;
  /** The sha `ls-remote` prints for the branch; a placeholder if unset. */
  tip?: string;
  /** Origin refuses the delete. */
  refuseDelete?: boolean;
  /** A landing's merge waits on this, so the landing stays in flight. */
  holdMerge?: Promise<void>;
}

/** A git for the one repository at `<tmp>/root/aide`, which holds the
 *  specs root `<tmp>/root/aide/specs` too. Every call is recorded. */
function originGit(origin: Origin) {
  const calls: { dir: string; args: string[] }[] = [];
  const top = (dir: string): string => {
    const at = dir.indexOf(`${sep}root${sep}aide`);
    return at < 0 ? dir : dir.slice(0, at + `${sep}root${sep}aide`.length);
  };
  const run = async (dir: string, args: string[]) => {
    calls.push({ dir, args });
    const a = args.join(" ");
    if (a.startsWith("ls-remote")) {
      if (origin.unanswerable) return { code: 128, stdout: "", stderr: "Could not resolve host" };
      if (a.startsWith("ls-remote --exit-code")) {
        const branch = args[4]!.replace("refs/heads/", "");
        return origin.has.has(branch)
          ? { code: 0, stdout: `${origin.tip ?? "sha"}\trefs/heads/${branch}\n` }
          : { code: 2, stdout: "" };
      }
      return { code: 0, stdout: [...origin.has].map((b) => `sha\trefs/heads/${b}\n`).join("") };
    }
    if (a.startsWith("merge -q") && origin.holdMerge) await origin.holdMerge;
    if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${top(dir)}\n` };
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("merge-base --is-ancestor")) {
      const notMerged = origin.notMergedAnywhere || (origin.notMergedIn && dir.endsWith(origin.notMergedIn));
      return { code: notMerged ? 1 : 0, stdout: "" };
    }
    if (a === DELETE) {
      if (origin.refuseDelete) return { code: 1, stdout: "", stderr: "remote rejected: hook declined" };
      origin.has.delete(BRANCH);
      return { code: 0, stdout: "" };
    }
    return { code: 0, stdout: "" };
  };
  return { run, calls, deletes: () => calls.filter((c) => c.args.join(" ") === DELETE) };
}

/** A project that reviews its code: `codeLanding: pr` in its manifest, and a
 *  `gh` that says the branch's pull request merged from `mergedHead`. */
interface Reviewed {
  mergedHead: string;
}

function startWith(
  origin: Origin,
  opts: { closed?: boolean; queueMirror?: string; results?: string; reviewed?: Reviewed } = {},
) {
  const git = originGit(origin);
  const status = opts.closed
    ? `${statusSaying(["create", "analyze", "close"])}\n- **Closed:** 2026-09-20 — did not hold\n`
    : statusSaying(["create", "analyze", "implement", "archive"]);
  const runner = opts.results ? { queueRunnerBin: "/usr/bin/true", queueResultDir: opts.results } : {};
  const { mergedHead } = opts.reviewed ?? {};
  const gh = mergedHead
    ? { ghRun: async () => ({ code: 0, stdout: JSON.stringify([{ state: "MERGED", headRefOid: mergedHead }]) }) }
    : {};
  const { base, dir } = harness.start({
    archivedSpecs: { [FOLDER]: { status } },
    extra: { gitRun: git.run as never, ...runner, ...gh },
    ...(opts.queueMirror ? { queueMirror: opts.queueMirror } : {}),
  });
  // Written after the server starts, which works because `codeLanding` is read on every call.
  if (opts.reviewed) writeFileSync(join(dir, "root", "aide", ".aide", "project.yaml"), "name: aide\ncodeLanding: pr\n");
  return { base, dir, git };
}

const press = (base: string, folder = FOLDER) =>
  fetch(`${base}/api/queue/specs/aide/${folder}/delete-branch`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: "{}",
  });

/** The archived row as the list draws it next. */
const archivedBlock = async (base: string): Promise<string> => blockFor(await listUntil(base, FOLDER, ARCHIVED_VIEW), FOLDER);

describe("Delete branch deletes a merged branch left on origin (AC-3)", () => {
  test("once per repository, and the note leaves the row (AC-3)", async () => {
    const { base, git } = startWith({ has: new Set([BRANCH]) });
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    const res = await press(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(git.deletes()).toHaveLength(1);
    expect(await archivedBlock(base)).not.toContain(NOTE);
  });

  test("a branch origin no longer holds deletes nothing and answers ok (AC-3)", async () => {
    const origin: Origin = { has: new Set([BRANCH]) };
    const { base, git } = startWith(origin);
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    origin.has.delete(BRANCH);
    const res = await press(base);
    expect(await res.json()).toEqual({ ok: true });
    expect(git.deletes()).toHaveLength(0);
    expect(await archivedBlock(base)).not.toContain(NOTE);
  });
});

const REVIEW_LINES = ["waiting on a pull request", "no pull request was opened"];

// A project that reviews its code squash-merges the pull request, so git
// never calls the branch merged; only GitHub says it did. The row must read
// the Slett gren line, and the press must accept the head that merged.
describe("a squash-merged pull request's branch left on origin (AC-1, AC-3, AC-4)", () => {
  const MERGED_HEAD = "9f3c0de";
  const squashed = (over: Partial<Origin> = {}): Origin => ({
    has: new Set([BRANCH]), notMergedAnywhere: true, tip: MERGED_HEAD, ...over,
  });

  test("the row reads the Slett gren line and no review line (AC-1, AC-4)", async () => {
    const { base } = startWith(squashed(), { reviewed: { mergedHead: MERGED_HEAD } });
    const block = blockFor(await listUntil(base, NOTE, ARCHIVED_VIEW), FOLDER);
    expect(block).toContain(NOTE);
    for (const line of REVIEW_LINES) expect(block).not.toContain(line);
  });

  test("the press deletes it once per repository and leaves no amber line (AC-3)", async () => {
    const { base, git } = startWith(squashed(), { reviewed: { mergedHead: MERGED_HEAD } });
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    const res = await press(base);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(git.deletes()).toHaveLength(1);
    const block = await archivedBlock(base);
    for (const line of [NOTE, ...REVIEW_LINES]) expect(block).not.toContain(line);
  });

  test("a tip that is no longer the merged head is refused, nothing deleted (AC-3)", async () => {
    const origin = squashed();
    const { base, git } = startWith(origin, { reviewed: { mergedHead: MERGED_HEAD } });
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    origin.tip = "pushed-after-the-merge";
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not on the default branch");
    expect(git.deletes()).toHaveLength(0);
  });
});

describe("Delete branch refuses rather than lose work (AC-3)", () => {
  test("a root whose fresh answer is not merged: nothing deleted anywhere (AC-3)", async () => {
    const origin: Origin = { has: new Set([BRANCH]) };
    const { base, git } = startWith(origin);
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    origin.notMergedIn = `${sep}specs`;
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not on the default branch");
    expect(git.deletes()).toHaveLength(0);
  });

  test("origin refusing the delete leaves the branch open and the note on the row (AC-3)", async () => {
    const { base } = startWith({ has: new Set([BRANCH]), refuseDelete: true });
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("could not be deleted on origin");
    expect(await archivedBlock(base)).toContain(NOTE);
  });

  test("origin that cannot be asked deletes nothing and leaves the note (AC-3)", async () => {
    const origin: Origin = { has: new Set([BRANCH]) };
    const { base, git } = startWith(origin);
    await listUntil(base, NOTE, ARCHIVED_VIEW);
    origin.unanswerable = true;
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("could not be asked");
    expect(git.deletes()).toHaveLength(0);
    // The sweep's own ticks meanwhile could not ask either; once origin
    // answers, the row carries the note it had.
    origin.unanswerable = false;
    expect(blockFor(await listUntil(base, NOTE, ARCHIVED_VIEW), FOLDER)).toContain(NOTE);
  });
});

describe("Delete branch is only for an archived spec's leftover branch (AC-3)", () => {
  const job = (over: Record<string, unknown>) => ({
    id: "j1", project: "aide", specFolder: FOLDER, steps: ["reopen"], stepIndex: 0,
    state: "queued", model: {}, timeoutSec: {}, permissionMode: {}, effort: {},
    createdAt: "2026-09-29T08:00:00.000Z", spentUsd: 0, results: [],
    ...over,
  });

  test("a spec that is not archived is refused (AC-3)", async () => {
    const { base, git } = startWith({ has: new Set([BRANCH, "aide/81-queue-and-runner"]) });
    const res = await press(base, "81-queue-and-runner");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("not archived");
    expect(git.calls.some((c) => c.args[0] === "push")).toBe(false);
  });

  test("a closed spec is refused (AC-3)", async () => {
    const { base, git } = startWith({ has: new Set([BRANCH]) }, { closed: true });
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("closed");
    expect(git.deletes()).toHaveLength(0);
  });

  test("a queued job for the spec is refused (AC-3)", async () => {
    const { base, git } = startWith({ has: new Set([BRANCH]) }, { queueMirror: JSON.stringify([job({})]) });
    const res = await press(base);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("still running");
    expect(git.deletes()).toHaveLength(0);
  });

  test("a landing in progress in the project is refused (AC-3)", async () => {
    // A live spec's analyze, whose landing is held at its merge.
    let release = (): void => {};
    const holdMerge = new Promise<void>((r) => (release = r));
    const results = mkdtempSync(join(tmpdir(), "aide-delete-branch-results-"));
    const { base, dir, git } = startWith({ has: new Set([BRANCH]), holdMerge }, { results });
    try {
      const queued = await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
      });
      const { job: live } = (await queued.json()) as { job: { id: string } };
      writeFileSync(join(results, `${live.id}.json`), JSON.stringify({
        ok: true, exitCode: 0, costUsd: 0, costMeasured: true, terminalReason: "completed",
        branch: "aide/81-queue-and-runner", repos: [],
        branchUrls: [{ root: join(dir, "root", "aide", "specs"), url: "https://example.test/aide" }],
      }));
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { job: now } = (await (await fetch(`${base}/api/queue/${live.id}`)).json()) as { job: { landing?: boolean } };
        if (now.landing) break;
        if (Date.now() > deadline) throw new Error("the analyze never started landing");
        await new Promise((r) => setTimeout(r, 25));
      }
      const res = await press(base);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain("landing is in progress");
      expect(git.deletes()).toHaveLength(0);
    } finally {
      release();
      rmSync(results, { recursive: true, force: true });
    }
  });

  test("any method but POST is not allowed, and an unknown spec is not found (AC-3)", async () => {
    const { base } = startWith({ has: new Set([BRANCH]) });
    expect((await fetch(`${base}/api/queue/specs/aide/${FOLDER}/delete-branch`)).status).toBe(405);
    expect((await press(base, "999-nothing")).status).toBe(404);
  });
});
