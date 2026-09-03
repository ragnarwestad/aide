// Split out of queue-detail.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerOptions } from "../src/serve/serve.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";

const DESCRIPTION =
  "# A running job is a black box - Description\n\n" +
  "## Table of contents\n\n- [Description](#description)\n\n---\n\n" +
  "## Description\n\nThe queue shows state, step and cost. It shows nothing about " +
  "what the job IS, and nothing about what it is doing.\n\n---\n\n" +
  "## Related documents\n\n- [2-analysis.md](./2-analysis.md)\n";

const harness = queueHarness("aide-queue-detail-");

const start = (extra: Partial<ServerOptions> = {}) =>
  harness.start({ description: DESCRIPTION, extra: { queueToken: TOKEN, ...extra } });

afterEach(() => harness.cleanup());

const auth = { headers: { "x-aide-token": TOKEN } };

async function enqueue(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

// A phase's own page shows what that phase made, and nothing else of
// the spec (criteria 5-7).
describe("a phase job's page shows that phase's file", () => {
  const SPEC = "81-queue-and-runner";

  const withFiles = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\n## Findings\n\nSeven files.\n");
    writeFileSync(
      join(spec, "3-solution.md"),
      "# Q - Solution\n\n## Plan review\n\nOne must-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
  };

  // Spec 181: the plan and the review of it are one step's work, so
  // the analyze job's page is 3-solution.md whole — both sections, and
  // not the analysis the step wrote on the way there.
  test("an analyze job shows 3-solution.md, review section and all", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["analyze"]);
    const html = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(html).toContain("One must-fix.");
    expect(html).toContain("Medium.");
    expect(html).not.toContain("Seven files.");
    expect(html).not.toContain("It shows nothing about what the job IS");
  });

  test("an implement job shows 4-status.md", async () => {
    const { base, dir } = start();
    withFiles(dir);
    const id = await enqueue(base, ["implement"]);
    const html = await (await fetch(`${base}/specs/${id}`, auth)).text();
    expect(html).toContain("Workflow steps completed");
  });
});

// --- criteria 3, 4: the Update button ---------------------------------------

describe("POST the Update action", () => {
  const SPEC = "81-queue-and-runner";
  const UPDATE = `/api/queue/specs/aide/${SPEC}/update`;
  const PATH = `/specs/aide/${SPEC}`;

  const press = (base: string) =>
    fetch(`${base}${UPDATE}`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: "",
    });

  /** A specs checkout that is clean, on its default branch and behind.
   *
   *  `rev-parse HEAD`'s before/after answer is counted PER DIRECTORY, not
   *  globally (spec 269): the server now reads its own boot-time commit
   *  with the same bare command, in `process.cwd()` — a global counter
   *  would let that one extra call shift the specs checkout's own
   *  before/after pair by one and report "already up to date". */
  const pullable = (extra: Record<string, { code: number; stdout?: string }> = {}) => {
    const headCallsByDir = new Map<string, number>();
    const answers: Record<string, { code: number; stdout?: string }> = {
      "rev-parse --show-toplevel": { code: 0, stdout: "/host/aide-specs\n" },
      "diff --quiet HEAD": { code: 0 },
      "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
      "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 0, stdout: "refs/remotes/origin/main\n" },
      fetch: { code: 0 },
      "merge-base --is-ancestor": { code: 0 },
      "merge -q --ff-only origin/": { code: 0 },
      "merge -q --ff-only": { code: 0 },
      "log -1 --format=%H": { code: 0, stdout: "a3f9c21\t2026-08-21T09:14:00+02:00\n" },
      ...extra,
    };
    return async (dir: string, args: string[]) => {
      const line = args.join(" ");
      if (line === "rev-parse HEAD") {
        const seen = headCallsByDir.get(dir) ?? 0;
        headCallsByDir.set(dir, seen + 1);
        return { code: 0, stdout: `${seen === 0 ? "a3f9c21" : "7b1e004"}\n` };
      }
      for (const [prefix, answer] of Object.entries(answers)) {
        if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
      }
      return { code: 1, stdout: "" };
    };
  };

  test("a fast-forwardable checkout is pulled and the reader lands back on the spec page", async () => {
    const { base } = start({ gitRun: pullable() });
    const res = await press(base);
    expect(res.status).toBe(303);
    const location = res.headers.get("location")!;
    expect(location.startsWith(PATH)).toBe(true);
    expect(decodeURIComponent(location)).toContain("7b1e004");
  });

  for (const [what, extra, expected] of [
    ["uncommitted changes", { "diff --quiet HEAD": { code: 1 } }, "uncommitted"],
    [
      "a checkout on another branch",
      { "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/150-one-page\n" } },
      "aide/150-one-page",
    ],
    ["a checkout that has diverged", { "merge-base --is-ancestor": { code: 1 } }, "fast-forward"],
    ["a directory that is not a git tree", { "rev-parse --show-toplevel": { code: 128 } }, "git working tree"],
  ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
    test(`${what} changes nothing and says which one applied (criterion 4)`, async () => {
      const { base } = start({ gitRun: pullable(extra) });
      const res = await press(base);
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(PATH)).toBe(true);
      expect(location).toContain("error=");
      expect(location).toContain(expected);
    });
  }

  test("the refusal is on the page the button was pressed from, not in a JSON body", async () => {
    const { base } = start({ gitRun: pullable({ "diff --quiet HEAD": { code: 1 } }) });
    const location = decodeURIComponent((await press(base)).headers.get("location")!);
    const html = await (await fetch(`${base}${location}`, auth)).text();
    expect(html).toContain("uncommitted");
  });

  test("a spec nobody has cannot be pulled for", async () => {
    const { base } = start({ gitRun: pullable() });
    const res = await fetch(`${base}/api/queue/specs/aide/99-no-such-spec/update`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN },
      redirect: "manual",
    });
    expect(res.status).toBe(404);
  });

  test("GET is not an update — a pull is a POST like every other action", async () => {
    const { base } = start({ gitRun: pullable() });
    expect((await fetch(`${base}${UPDATE}`, auth)).status).toBe(405);
  });

  test("it is behind the token like every other queue path", async () => {
    const { base } = start({ gitRun: pullable() });
    expect((await fetch(`${base}${UPDATE}`, { method: "POST", redirect: "manual" })).status).toBe(401);
  });

  test("approve, cancel and merge still answer — the new action does not swallow them", async () => {
    const { base } = start({ gitRun: pullable() });
    const id = await enqueue(base);
    const res = await fetch(`${base}/api/queue/${id}/cancel`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, accept: "application/json" },
    });
    expect(res.status).toBe(200);
  });
});

// --- spec 210: the phase report reaches the row that is running -------------
//
// `wordPhase` and `pips()` can be asked about a `tddPhase` in a fixture;
// nothing but a running server can say whether the JOIN is wired — the
// lookup lives in `jobRow`, a closure inside `createServer`, and the key
// is the job's own live `sessionId` against the store's row.
describe("a running implement's TDD phase reaches the page", () => {
  const seedRunning = (dir: string, id: string, sessionId: string): string => {
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === id)!;
    job.state = "running";
    job.startedAt = "2026-08-23T10:00:00Z";
    job.sessionId = sessionId;
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  };

  const report = (base: string, sessionId: string, phase: string) =>
    fetch(`${base}/api/aide-run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: "laptop", sessionId, command: "implement", phase }),
    });

  // Criterion 2 and criterion 8 in one: the fetch happens IMMEDIATELY
  // after the report, with no wait. The store write and the row's lookup
  // are both synchronous, so nothing in this feature adds a delay of its
  // own on top of whatever already carries a queue change to a reader.
  test("a phase reported a moment ago is on the very next render", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const mirror = seedRunning(dir, id, "sess-210-green");

    const { base: base2 } = start({ queueMirrorPath: mirror });
    expect((await report(base2, "sess-210-green", "green")).status).toBe(200);
    const html = await (
      await fetch(`${base2}/?open=aide/81-queue-and-runner`, auth)
    ).text();
    expect(html).toContain("running (green)");
    expect(html).toContain('data-third="1"');
  });

  // Criterion 6: no report ever arrived. The row is exactly what it was
  // before this feature existed.
  //
  // `?rows=1` is the ROWS alone, without the page's inlined stylesheet —
  // which names `data-third` in its own selectors, and would answer an
  // absence assertion about the markup with a rule about how to draw it.
  test("a running implement nobody reported on is unchanged", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["implement"]);
    const mirror = seedRunning(dir, id, "sess-210-silent");

    const { base: base2 } = start({ queueMirrorPath: mirror });
    const rows = await (
      await fetch(`${base2}/?rows=1&open=aide/81-queue-and-runner`, auth)
    ).text();
    expect(rows).toContain("running");
    expect(rows).not.toContain("running (");
    expect(rows).not.toContain("data-third");
  });

  // Criterion 5, where the rule that decides it actually lives: only
  // `implement` reports its thirds, and only `implement` is looked up.
  // An analyze step running in a session the store HAS an answer for is
  // the case that would go wrong quietly — the join key is the session,
  // and a session runs one step after another.
  test("a running analyze is not given a phase, even when its session reported one", async () => {
    const { base, dir } = start();
    const id = await enqueue(base, ["analyze"]);
    const mirror = seedRunning(dir, id, "sess-210-analyze");

    const { base: base2 } = start({ queueMirrorPath: mirror });
    expect((await report(base2, "sess-210-analyze", "green")).status).toBe(200);
    const rows = await (
      await fetch(`${base2}/?rows=1&open=aide/81-queue-and-runner`, auth)
    ).text();
    expect(rows).toContain("running");
    expect(rows).not.toContain("running (");
    expect(rows).not.toContain("data-third");
  });
});
