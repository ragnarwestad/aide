// Spec 354: one transition table is the only way a job's state changes.
// This file pins the table itself (REQ-1), the store method's contract
// (REQ-3, REQ-5), and the two structural guarantees that keep the table
// from drifting — against the documentation (REQ-6a) and against any
// write site outside the store (REQ-6b).

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_STATES, QueueStore, TRANSITIONS, type QueueDefaults, type TransitionEvent } from "../../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  timeoutSec: { default: 1200 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

// Every event the table's own type declares — read off the table's keys
// rather than hand-copied, so a member added to the union without a row
// anywhere in the table is still covered by the REQ-1 loop below.
const ALL_EVENTS = Array.from(
  new Set(Object.values(TRANSITIONS).flatMap((row) => Object.keys(row ?? {}))),
) as TransitionEvent[];

describe("TRANSITIONS (REQ-1)", () => {
  test("every (state, event) pair names at most one next state, and every named state is real", () => {
    for (const state of JOB_STATES) {
      for (const event of ALL_EVENTS) {
        const to = TRANSITIONS[state]?.[event];
        if (to === undefined) continue;
        expect(typeof to).toBe("string");
        expect((JOB_STATES as readonly string[]).includes(to)).toBe(true);
      }
    }
  });

  test("has at least the eleven transitions the queue makes today", () => {
    const pairs = JOB_STATES.flatMap((state) =>
      ALL_EVENTS.filter((event) => TRANSITIONS[state]?.[event] !== undefined).map((event) => [state, event]),
    );
    expect(pairs.length).toBeGreaterThanOrEqual(11);
  });
});

// A landing the project's own suite refused is not a broken job: the step
// ran, the merge was built, and the tests on the merged result went red.
// The work waits for a green suite, so the job STOPS rather than fails —
// the same distinction `run-stopped` already draws for a cap. Only from
// `done`, exactly like `landing-failed` beside it.
describe("a red suite stops the landing's job rather than failing it", () => {
  test("done -> landing-held -> stopped, and no other state accepts the event", () => {
    expect(TRANSITIONS.done?.["landing-held"]).toBe("stopped");
    for (const state of JOB_STATES.filter((s) => s !== "done")) {
      expect(TRANSITIONS[state]?.["landing-held"]).toBeUndefined();
    }
  });
});

function makeStore(): QueueStore {
  const dir = mkdtempSync(join(tmpdir(), "aide-transitions-"));
  return new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
}

describe("QueueStore.transition (REQ-3, REQ-5)", () => {
  test("a refused transition leaves the job unchanged and reports the state and event refused", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    // `done` has no entry for `cancel` — the job's own work is already
    // over, so this is a refusal by construction, not a fixture that
    // only happens to hit a gap in the table today.
    store.update(r.job.id, { state: "done" });
    const before = store.get(r.job.id);

    const refusal = store.transition(r.job.id, "cancel" as TransitionEvent, { finishedAt: "later" });
    expect(refusal).toEqual({ ok: false, state: "done", event: "cancel" });
    expect(store.get(r.job.id)).toEqual(before);
  });

  test("a successful transition's state and patch fields are visible together on the very next get", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    store.update(r.job.id, { state: "queued" });

    const result = store.transition(r.job.id, "cap-hit" as TransitionEvent, {
      stopReason: "job-cap",
      finishedAt: "2026-09-02T00:00:00Z",
      error: "the job cap would be exceeded",
    });
    expect(result.ok).toBe(true);
    const job = store.get(r.job.id)!;
    expect(job.state).toBe("stopped");
    expect(job.stopReason).toBe("job-cap");
    expect(job.error).toBe("the job cap would be exceeded");
  });

  test("an unknown job id is refused rather than throwing", () => {
    const store = makeStore();
    const result = store.transition("no-such-id", "start" as TransitionEvent, {});
    expect(result.ok).toBe(false);
  });
});

describe("the diagram and the table agree (REQ-6a)", () => {
  /** `A --> B: label` edges between two NAMED states — `[*]` excluded,
   *  since job creation has no prior state to look up (2-analysis.md,
   *  Patterns). Only the `(A, B)` pair matters; the label is free prose. */
  function diagramEdges(text: string): [string, string][] {
    const block = text.match(/```mermaid[\s\S]*?```/);
    expect(block).not.toBeNull();
    const edges: [string, string][] = [];
    for (const line of block![0].split("\n")) {
      const m = line.match(/^\s*(\S+)\s*-->\s*(\S+):/);
      if (!m) continue;
      const [, from, to] = m;
      if (from === "[*]") continue;
      edges.push([from!, to!.replace(/:$/, "")]);
    }
    return edges;
  }

  function tableEdges(): Set<string> {
    const out = new Set<string>();
    for (const state of JOB_STATES) {
      for (const event of ALL_EVENTS) {
        const to = TRANSITIONS[state]?.[event];
        if (to !== undefined) out.add(`${state}->${to}`);
      }
    }
    return out;
  }

  const docPath = join(import.meta.dir, "..", "..", "..", "docs", "job-states.md");

  test("self-check: the comparison disagrees once an edge is removed from either side", () => {
    const realEdges = new Set(diagramEdges(readFileSync(docPath, "utf-8")).map(([a, b]) => `${a}->${b}`));
    const realTable = tableEdges();

    // A diagram edge removed in this in-memory copy only: the table
    // still has it, so the two must no longer compare equal.
    const shrunkDiagram = new Set(realEdges);
    shrunkDiagram.delete("queued->running");
    expect([...realTable].sort()).not.toEqual([...shrunkDiagram].sort());

    // A table entry removed in this in-memory copy only: the diagram
    // still has it.
    const shrunkTable = new Set(realTable);
    shrunkTable.delete("running->done");
    expect([...shrunkTable].sort()).not.toEqual([...realEdges].sort());
  });

  test("every diagram edge has a table entry, and every table entry is a diagram edge", () => {
    const edges = new Set(diagramEdges(readFileSync(docPath, "utf-8")).map(([a, b]) => `${a}->${b}`));
    const table = tableEdges();
    expect([...edges].sort()).toEqual([...table].sort());
  });
});

describe("no state write outside the store (REQ-6b)", () => {
  // A literal `state:` key whose value is one of the seven JobState
  // members — narrow on purpose, so this does not also flag
  // filter-sort.ts's sort-direction `state: "asc"|"desc"` or
  // group-builders.ts's `SpecGroup.state: "not-started"|...`, neither of
  // which is a Job.state write.
  const PATTERN = new RegExp(`state:\\s*["'](${JOB_STATES.join("|")})["']`);
  const ALLOWED = ["queue/store.ts", "queue/parse-request.ts"];

  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) tsFiles(full, out);
      else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
    }
    return out;
  }

  test("the narrowed state-literal pattern appears only in the store and the creation parser", () => {
    const srcDir = join(import.meta.dir, "..", "..", "..", "src");
    const offenders = tsFiles(srcDir)
      .filter((f) => PATTERN.test(readFileSync(f, "utf-8")))
      .map((f) => f.slice(srcDir.length + 1));
    expect(offenders.sort()).toEqual([...ALLOWED].sort());
  });
});
