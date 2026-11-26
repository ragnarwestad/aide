// One transition table is the only way a job's state changes.
// This file pins the table itself, the store method's contract
// and the two structural guarantees that keep the table
// from drifting — against the documentation and against any
// write site outside the store.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JOB_STATES, QueueStore, TRANSITIONS, type QueueDefaults, type TransitionEvent } from "../../../src/queue/queue.ts";
import { STEP_ENDINGS } from "../../../src/step-endings.ts";
import { ERROR_REASONS } from "../../../src/job-states.ts";
import { tsFilesUnder } from "../../design/source-files.ts";
import { queueStateWrites } from "./state-writes.ts";

const DEFAULTS: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

const resolve = (project: string) => (project === "aide" ? { specFolders: ["81-queue-and-runner"] } : null);

// Every event the table's own type declares — read off the table's keys
// rather than hand-copied, so a member added to the union without a row
// anywhere in the table is still covered by the per-event loop below.
const ALL_EVENTS = Array.from(
  new Set(Object.values(TRANSITIONS).flatMap((row) => Object.keys(row ?? {}))),
) as TransitionEvent[];

describe("TRANSITIONS", () => {
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

// A landing the project's own suite refused fails the job: nothing was
// pushed and nobody stopped it. Only from `done`, exactly like
// `landing-failed` beside it.
describe("a red suite fails the landing's job", () => {
  test("done -> landing-held -> failed, and no other state accepts the event", () => {
    expect(TRANSITIONS.done?.["landing-held"]).toBe("failed");
    for (const state of JOB_STATES.filter((s) => s !== "done")) {
      expect(TRANSITIONS[state]?.["landing-held"]).toBeUndefined();
    }
  });
});

function makeStore(): QueueStore {
  const dir = mkdtempSync(join(tmpdir(), "aide-transitions-"));
  return new QueueStore({ mirrorPath: join(dir, "queue.json"), defaults: DEFAULTS, resolve });
}

describe("QueueStore.transition", () => {
  test("a refused transition leaves the job unchanged and reports the state and event refused", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    // `done` has no entry for `cancel` — the job's own work is already
    // over, so this is a refusal by construction, not a fixture that
    // only happens to hit a gap in the table today.
    store.writeUnchecked(r.job.id, { state: "done" });
    const before = store.get(r.job.id);

    const refusal = store.transition(r.job.id, "cancel" as TransitionEvent, { finishedAt: "later" });
    expect(refusal).toEqual({ ok: false, state: "done", event: "cancel" });
    expect(store.get(r.job.id)).toEqual(before);
  });

  test("a successful transition's state and patch fields are visible together on the very next get", () => {
    const store = makeStore();
    const r = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!r.ok) throw new Error(r.error);
    store.writeUnchecked(r.job.id, { state: "running" });

    const result = store.transition(r.job.id, "run-stopped" as TransitionEvent, {
      stopReason: "timeout",
      finishedAt: "2026-09-02T00:00:00Z",
      error: "the step ran out of time",
    });
    expect(result.ok).toBe(true);
    const job = store.get(r.job.id)!;
    expect(job.state).toBe("failed");
    expect(job.stopReason).toBe("timeout");
    expect(job.error).toBe("the step ran out of time");
  });

  test("an unknown job id is refused rather than throwing", () => {
    const store = makeStore();
    const result = store.transition("no-such-id", "start" as TransitionEvent, {});
    expect(result.ok).toBe(false);
  });
});

// A step a usage limit ended waits, and is started again by the board
// once the limit has reset. Only from `waiting`.
describe("a usage-limit wait can be queued again", () => {
  test("running -> limit-reached -> waiting, and every other early stop fails the job", () => {
    expect(TRANSITIONS.running?.["limit-reached"]).toBe("waiting");
    expect(TRANSITIONS.running?.["run-stopped"]).toBe("failed");
  });

  test("waiting -> limit-reset -> queued, and no other state accepts the event (AC-2)", () => {
    expect(TRANSITIONS.waiting?.["limit-reset"]).toBe("queued");
    for (const state of JOB_STATES.filter((s) => s !== "waiting")) {
      expect(TRANSITIONS[state]?.["limit-reset"]).toBeUndefined();
    }
  });
});

describe("late AI-work checks can spend the same retry allowance", () => {
  test("failed, waiting and done each have one checked route back to queued (AC-4, AC-5, AC-9)", () => {
    for (const state of ["failed", "waiting", "done"] as const) expect(TRANSITIONS[state]?.["retry-late"]).toBe("queued");
    for (const state of JOB_STATES.filter((state) => !["failed", "waiting", "done"].includes(state))) {
      expect(TRANSITIONS[state]?.["retry-late"]).toBeUndefined();
    }
  });
});

describe("the diagram and the table agree", () => {
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

describe("no state write outside the store", () => {
  // The compiler refuses a job's state written through `update`,
  // `transition` or an assignment (`state-ownership.test.ts`). What it
  // cannot see is read off the text: a call to the store's raw
  // `writeUnchecked`, and a job literal, which only the creation parser
  // may build.
  const srcDir = join(import.meta.dir, "..", "..", "..", "src");
  const STORE = "queue/store/";
  const CREATION = "queue/parse-request.ts";

  function writesOutsideTheStore(): string[] {
    return tsFilesUnder(srcDir)
      .filter((f) => !f.endsWith(".test.ts"))
      .flatMap((f) => {
        const rel = f.slice(srcDir.length + 1);
        if (rel.startsWith(STORE)) return [];
        return queueStateWrites(readFileSync(f, "utf-8"))
          .filter((w) => !(w.kind === "job-literal" && rel === CREATION))
          .map((w) => `${rel}:${w.line} ${w.kind}`);
      });
  }

  test("nothing outside the store writes a job's state, or builds a job but the creation parser (AC-1)", () => {
    expect(writesOutsideTheStore()).toEqual([]);
  });

  test("the creation parser's two job literals are found, so the scan reads real code (AC-1)", () => {
    const found = queueStateWrites(readFileSync(join(srcDir, CREATION), "utf-8"));
    expect(found.filter((w) => w.kind === "job-literal")).toHaveLength(2);
  });
});

// The two reason unions drift out of the documentation the same way the
// transition table did: a member is added in code and the prose keeps
// the old list. Read both sides and compare, exactly as the diagram
// check above does.
describe("the documented reasons and the unions agree", () => {
  const docPath = join(import.meta.dir, "..", "..", "..", "docs", "job-states.md");

  /** The values the doc lists for a field: the run of `` `name` `` right
   *  after "is", up to the ", set" that starts saying when it is written.
   *  Anything backticked later in the sentence is prose, not a member. */
  function documented(field: string): string[] {
    const doc = readFileSync(docPath, "utf-8");
    const bullet = doc.match(new RegExp(`^- \\*\\*\`${field}\`\\*\\* is ([\\s\\S]*?), set`, "m"));
    expect(bullet).not.toBeNull();
    return [...bullet![1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).sort();
  }

  test("stopReason: every member is named where the field is described", () => {
    expect(documented("stopReason")).toEqual(
      STEP_ENDINGS.filter(({ jobStop }) => jobStop).map(({ name }) => name).sort(),
    );
  });

  test("errorReason: every shared member is named where the field is described (AC-8)", () => {
    expect(documented("errorReason")).toEqual([...ERROR_REASONS].sort());
  });
});

test("Cancel ends a waiting job, as the schedule wait's own event does", () => {
  for (const event of ["cancel", "cancel-schedule-wait"] as TransitionEvent[]) {
    const store = makeStore();
    const made = store.enqueue({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] });
    if (!made.ok) throw new Error(made.error);
    store.writeUnchecked(made.job.id, { state: "waiting" });
    expect(store.transition(made.job.id, event).ok).toBe(true);
    expect(store.get(made.job.id)?.state).toBe("cancelled");
  }
});
