// Spec 182: ticking one of a spec's remaining checks from its own page.
//
// A check only a person can make — look at the page at 375px and say
// whether it holds — held a spec's archive back, and saying so meant a
// terminal: the dashboard could not write `4-status.md` at all. One
// button now flips one row's Status mark, commits it and pushes it.
//
// The write itself is `saveSpecFile`, the same function the description
// editor has used since spec 162, so every refusal that suite proves is
// re-proven here against `4-status.md`. What is new is the row-level
// guard on top of it: the row's exact current text is posted back, and
// a row that no longer reads as it did is refused even when the file's
// own sha still matches.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../src/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const SPEC = "81-queue-and-runner";
const TICK = `/api/queue/specs/aide/${SPEC}/status/tick`;
const PAGE = `/specs/aide/${SPEC}`;
const FILE_SHA = "a3f9c21aaaaaaa";
const HEAD_SHA = "1111111bbbbbbb";

const OPEN_ROW = "| Manual check at 375px in a real browser | ⬜ | still outstanding |";
const DONE_ROW = "| Run the full test suite | ✅ | 1742 pass |";
const PHASE = "Phase 4: REFACTOR - Test suite";

const STATUS = [
  "# Queue - Status",
  "",
  "## Tracking info",
  "",
  "- **Workflow steps completed:** create, analyze, implement",
  "",
  "---",
  "",
  `## ${PHASE}`,
  "",
  "### Tasks",
  "",
  "| Task | Status | Notes |",
  "|------|--------|-------|",
  DONE_ROW,
  OPEN_ROW,
  "",
].join("\n");

const harness = queueHarness("aide-spec-tick-");
afterEach(() => harness.cleanup());

const auth = { headers: { "x-aide-token": TOKEN } };

const start = (gitRun: GitRunner, extra = {}) =>
  harness.start({ status: STATUS, extra: { queueToken: TOKEN, gitRun, ...extra } });

const statusPath = (dir: string, folder = SPEC) => join(dir, "root", "aide", "specs", folder, "4-status.md");

const ARCHIVED = "150-one-page-shows-the-whole-spec";
const startArchived = (gitRun: GitRunner) =>
  harness.start({
    status: STATUS,
    archivedSpecs: { [ARCHIVED]: { status: STATUS } },
    extra: { queueToken: TOKEN, gitRun },
  });
const archivedStatusPath = (dir: string) => join(dir, "root", "aide", "specs", "archive", ARCHIVED, "4-status.md");

/** The same fixture `spec-save.test.ts` uses: a checkout that is clean,
 *  on its default branch, reachable, and whose file last moved at
 *  `FILE_SHA`. */
const savable = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}): GitRunner => {
  const answers: Record<string, { code: number; stdout?: string }> = {
    "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
    "diff --cached --quiet HEAD": { code: 1 },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "rev-parse HEAD": { code: 0, stdout: `${HEAD_SHA}\n` },
    "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 0, stdout: "refs/remotes/origin/main\n" },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  };
  return async (_dir, args) => {
    const line = args.join(" ");
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
    }
    return { code: 1, stdout: "" };
  };
};

/** Every git command the run was given, so the commit's own message can
 *  be read back — the record that a PERSON made the check is the whole
 *  point of the write. */
const recording = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}) => {
  const calls: string[][] = [];
  const inner = savable(root, extra);
  const run: GitRunner = async (dir, args) => {
    calls.push(args);
    return inner(dir, args);
  };
  return { run, calls };
};

const post = (base: string, body: Record<string, string>, path = TICK, token: string | null = TOKEN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(token ? { "x-aide-token": token } : {}),
    },
    redirect: "manual",
    body: new URLSearchParams(body).toString(),
  });

const tick = (base: string, over: Record<string, string> = {}) =>
  post(base, { phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA, ...over });

// --- criterion 3: a tick that goes through ----------------------------------

describe("POST the tick action", () => {
  test("flips that one row, leaves every other byte, commits, pushes and returns to the spec", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await tick(base);
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).not.toContain("error=");
    const after = readFileSync(statusPath(dir), "utf-8");
    expect(after).toBe(STATUS.replace(OPEN_ROW, "| Manual check at 375px in a real browser | ✅ | still outstanding |"));
  });

  test("it commits once and pushes once", async () => {
    const git = recording("/host");
    const { base } = start(git.run);
    await tick(base);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(1);
  });

  test("the reader lands on the spec page with a success notice", async () => {
    const { base } = start(savable("/host"));
    const location = decodeURIComponent((await tick(base)).headers.get("location")!);
    expect(location).toContain("notice=");
    expect(location).toContain("noticeOk=1");
  });
});

// --- criterion 4: the commit says a person made the check -------------------

describe("the commit a tick writes", () => {
  const messageOf = (calls: string[][]): string => {
    const commit = calls.find((c) => c[0] === "commit")!;
    return commit[commit.indexOf("-m") + 1]!;
  };

  test("names the dashboard, the file and the spec", async () => {
    const git = recording("/host");
    const { base } = start(git.run);
    await tick(base);
    const message = messageOf(git.calls);
    expect(message).toContain("dashboard");
    expect(message).toContain("4-status.md");
    expect(message).toContain(SPEC);
  });

  // The record is that a HUMAN, not a step, made the check — which is
  // a different sentence from "someone edited a file".
  test("reads as a check made by hand, not as an edit", async () => {
    const git = recording("/host");
    const { base } = start(git.run);
    await tick(base);
    expect(messageOf(git.calls)).not.toBe(`Edit 4-status.md for ${SPEC} from the dashboard`);
    expect(messageOf(git.calls).toLowerCase()).toMatch(/tick|check/);
  });
});

// --- criteria 5, 6: the two guards -----------------------------------------

describe("a tick whose ground has moved is refused", () => {
  test("the file moved since the page was drawn: nothing written, told to open it again", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await tick(base, { baseSha: "0000000ffffff" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).toContain("changed since");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // The sha still matches — the same commit — but the row does not: the
  // reader pressed the same button twice, or two people are on the page.
  test("the row no longer reads as it did, though the sha matches: refused", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await tick(base, { line: "| Manual check at 375px in a real browser | ⬜ | as it once was |" });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a row that is already done is refused rather than committed again", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await tick(base, { line: DONE_ROW });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a phase the file does not have is refused", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await tick(base, { phase: "Phase 9: NOTHING" });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a body naming no row at all is refused rather than guessed at", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });
});

// --- the refusals inherited from saveSpecFile -------------------------------

describe("a tick that cannot go through changes nothing", () => {
  for (const [what, extra, expected] of [
    ["uncommitted changes in the checkout", { "diff --quiet HEAD": { code: 1 } }, "uncommitted"],
    [
      "a checkout parked on a spec branch",
      { "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/182-tick\n" } },
      "aide/182-tick",
    ],
    ["a checkout that has diverged", { "merge-base --is-ancestor": { code: 1 } }, "fast-forward"],
    ["an unreachable origin", { fetch: { code: 128 } }, "origin"],
    ["a push that fails", { push: { code: 1 } }, "push"],
  ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
    test(`${what}: back to the spec with the reason`, async () => {
      const { base, dir } = start(savable("/host", extra));
      const res = await tick(base);
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(PAGE)).toBe(true);
      expect(location).toContain(expected);
      // A refused push is rolled back by git, which is mocked here — so
      // the bytes are only asserted for the refusals that never write.
      if (!("push" in extra)) expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    });
  }

  test("a spec nobody has cannot be ticked, GET is not a tick, and the token still holds", async () => {
    const { base } = start(savable("/host"));
    expect((await post(base, { phase: PHASE, line: OPEN_ROW }, `/api/queue/specs/aide/99-no-such/status/tick`)).status).toBe(404);
    expect((await fetch(`${base}${TICK}`, auth)).status).toBe(405);
    expect((await post(base, { phase: PHASE, line: OPEN_ROW }, TICK, null)).status).toBe(401);
  });
});

// --- criterion 7: an archived spec is a record ------------------------------

describe("POST the tick action against an archived spec", () => {
  test("writes nothing, and says why on the spec's own page", async () => {
    const { base, dir } = startArchived(savable("/host"));
    const res = await post(
      base,
      { phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA },
      `/api/queue/specs/aide/${ARCHIVED}/status/tick`,
    );
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("error=");
    expect(location).toContain("archived");
    expect(readFileSync(archivedStatusPath(dir), "utf-8")).toBe(STATUS);
  });
});

// --- one checkout, one git sequence at a time -------------------------------
//
// Every project and every spec in this deployment's specs root shares
// ONE `.git`. The assertion is ORDER, not outcome: two independent
// working trees would also both succeed.

describe("two specs sharing one checkout", () => {
  test("their git sequences are serialized, never interleaved", async () => {
    const OTHER = "99-a-second-spec";
    const order: string[] = [];
    const probes = new Map<string, number>();
    let current = "";
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let reached = () => {};
    const firstIsInside = new Promise<void>((r) => {
      reached = r;
    });
    let holding = false;

    const answers = savable("/host");
    const gitRun: GitRunner = async (dir, args) => {
      const line = args.join(" ");
      if (line === "rev-parse --show-toplevel") {
        const seen = (probes.get(dir) ?? 0) + 1;
        probes.set(dir, seen);
        if (seen === 2) {
          current = dir.endsWith(OTHER) ? OTHER : SPEC;
          order.push(`start ${current}`);
        }
      }
      if (line.startsWith("fetch")) {
        if (!holding) {
          holding = true;
          reached();
          await held;
        }
      }
      if (line.startsWith("push")) order.push(`end ${current}`);
      return answers(dir, args);
    };

    const { base } = harness.start({
      status: STATUS,
      alsoSpecs: [OTHER],
      extra: { queueToken: TOKEN, gitRun },
    });

    const first = tick(base);
    await firstIsInside;
    const second = post(
      base,
      { phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA },
      `/api/queue/specs/aide/${OTHER}/status/tick`,
    );
    // Long enough for an unserialized second request to have started
    // its own sequence.
    await Bun.sleep(60);
    expect(order).toEqual([`start ${SPEC}`]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([`start ${SPEC}`, `end ${SPEC}`, `start ${OTHER}`, `end ${OTHER}`]);
  });
});

// --- the page's own end of it -----------------------------------------------

describe("the spec page offers the tick", () => {
  test("the open row is on the page with a form posting to the tick route", async () => {
    const { base } = start(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    expect(html).toContain(`action="${TICK}"`);
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).toContain(FILE_SHA);
  });

  test("an archived spec's page offers no tick form", async () => {
    const { base } = startArchived(savable("/host"));
    const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}`, auth)).text();
    expect(html).not.toContain("/status/tick");
  });
});
