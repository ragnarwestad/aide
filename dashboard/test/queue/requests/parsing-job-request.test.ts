// Split out of parsing.test.ts by theme.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOB_STATES,
  mergeQueueDefaults,
  parseJobRequest,
  persistQueueSettings,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";

const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152: an implement is not an analyze, and one
  // number for both stopped 149 mid-sentence with its tests green.
  timeoutSec: { default: 1200, implement: 5400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("persistQueueSettings", () => {
  test("changes only owned step/budget/job-cap/timeout values in JSONC and keeps fallback, unknown entries and other text", () => {
    const file = join(dir, "queue-config.json");
    const before = `{
  // keep this comment
  "concurrency": 2,
  "model": {
    "default": "sonnet",
    "future": "leave-me",
    "analyze": "old"
  }
}\n`;
    writeFileSync(file, before);
    const model = Object.fromEntries(
      ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"].map((step) => [step, "codex-fast"]),
    );
    const timeoutSec = Object.fromEntries(
      ["explore", "create", "analyze", "implement", "archive", "manifest", "reopen"].map((step) => [step, 1800]),
    );

    expect(persistQueueSettings(file, { model, budgetUsd: 7, jobCapUsd: 20, timeoutSec })).toBeNull();
    const after = readFileSync(file, "utf-8");
    expect(after).toContain("// keep this comment");
    expect(after).toContain('"concurrency": 2');
    expect(after).toContain('"default": "sonnet"');
    expect(after).toContain('"future": "leave-me"');
    for (const step of Object.keys(model)) expect(after).toContain(`"${step}": "codex-fast"`);
    expect(after).toContain('"budgetUsd": 7');
    expect(after).toContain('"jobCapUsd": 20');
    for (const step of Object.keys(timeoutSec)) expect(after).toContain(`"${step}": 1800`);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe("parseJobRequest", () => {
  test("a valid request becomes a job with the configured defaults", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.project).toBe("aide");
    expect(r.job.specFolder).toBe("81-queue-and-runner");
    expect(r.job.steps).toEqual(["analyze", "implement"]);
    expect(r.job.state).toBe("queued");
    expect(r.job.budgetUsd).toBe(3);
    expect(r.job.jobCapUsd).toBe(10);
    expect(r.job.timeoutSec).toEqual({ analyze: 1200, implement: 5400 });
    expect(r.job.spentUsd).toBe(0);
    expect(r.job.stepIndex).toBe(0);
  });

  // Spec 149. A gate was a stop between steps, and no form on this page
  // could ever set one — the only three jobs that ever had one were
  // posted as JSON by hand. The stop is gone, so the field is gone with
  // it: a request that still names it is not refused, it is ignored, the
  // same way every other unknown key on this route already is.
  test("gateAfter is an unknown field now — ignored, not refused, and never stored", () => {
    const named = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], gateAfter: ["analyze"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect("gateAfter" in named.job).toBe(false);
    // Not even the shapes that used to be REFUSED: a step not in the
    // job, or a value that is not a list at all.
    for (const bad of [["archive"], "analyze", 7]) {
      const r = parseJobRequest({ ...REQ, gateAfter: bad }, { resolve, defaults: DEFAULTS });
      expect(`${JSON.stringify(bad)}: ${r.ok}`).toBe(`${JSON.stringify(bad)}: true`);
    }
  });

  // Criterion 9. Nothing a request can say puts a job into the state
  // that no longer exists.
  test("awaiting-approval is not a job state any more", () => {
    expect((JOB_STATES as readonly string[]).includes("awaiting-approval")).toBe(false);
  });

  test("the permission mode and model come from the config, per step", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze", "implement"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.permissionMode).toEqual({ analyze: "acceptEdits", implement: "bypassPermissions" });
    expect(r.job.model).toEqual({ analyze: "sonnet", implement: "opus" });
  });

  test("unknown fields are ignored", () => {
    const r = parseJobRequest({ ...REQ, nonsense: 1, permissionMode: "bypassPermissions" }, {
      resolve,
      defaults: DEFAULTS,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.job as unknown as Record<string, unknown>).nonsense).toBeUndefined();
    // permissionMode is config-only: a request must never be able to
    // widen what an unattended run may do.
    expect(r.job.permissionMode.analyze).toBe("acceptEdits");
  });

  // --- spec 152: the wall clock is per step -----------------------------
  //
  // One number covered analyze (minutes) and implement (the better part
  // of an hour on a twenty-file change) alike, and the only place it
  // could be changed was the config file on the serving host. It is a
  // table now, resolved exactly as `permissionMode` and `model` are.
  test("each step gets its own configured limit", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement", "archive"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.timeoutSec.implement).toBe(5400);
    // Every step the config does not name falls to `default`, the same
    // fallback the other two per-step tables have.
    expect(r.job.timeoutSec.analyze).toBe(1200);
    expect(r.job.timeoutSec.archive).toBe(1200);
  });

  test("an override tightens every step against that step's OWN ceiling", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], timeoutSec: 600 },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job.timeoutSec).toEqual({ analyze: 600, implement: 600 });

    // 3000 is well inside implement's 5400 and well outside analyze's
    // 1200. The job holds both steps, so it is refused: a request may
    // only tighten, and it does not get to loosen one step by naming
    // another that could have afforded it.
    const mixed = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], timeoutSec: 3000 },
      { resolve, defaults: DEFAULTS },
    );
    expect(mixed.ok).toBe(false);
    if (!mixed.ok) expect(mixed.error).toContain("timeoutSec");

    // The same number on an implement-only job is a tightening, and is
    // taken.
    const alone = parseJobRequest(
      { ...REQ, steps: ["implement"], timeoutSec: 3000 },
      { resolve, defaults: DEFAULTS },
    );
    expect(alone.ok && alone.job.timeoutSec).toEqual({ implement: 3000 });
  });

  test("an override may tighten a cap but never loosen it", () => {
    const tighter = parseJobRequest({ ...REQ, budgetUsd: 1, timeoutSec: 60 }, { resolve, defaults: DEFAULTS });
    expect(tighter.ok).toBe(true);
    if (tighter.ok) {
      expect(tighter.job.budgetUsd).toBe(1);
      expect(tighter.job.timeoutSec).toEqual({ analyze: 60 });
    }
    const looser = parseJobRequest({ ...REQ, budgetUsd: 50 }, { resolve, defaults: DEFAULTS });
    expect(looser.ok).toBe(false);
    if (!looser.ok) expect(looser.error).toContain("budgetUsd");
  });

  // --- spec 364: a step runs at a chosen effort level --------------------

  test("REQ-3: a per-step effort choice is accepted", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze", "implement"], effort: { analyze: "high", implement: "low" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.effort).toEqual({ analyze: "high", implement: "low" });
  });

  test("REQ-4: an empty/untouched entry is skipped, not stored as a choice", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], effort: { analyze: "" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.effort).toEqual({});
  });

  test("no effort field at all leaves the job with no effort chosen (REQ-4)", () => {
    const r = parseJobRequest({ ...REQ, steps: ["analyze"] }, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.effort).toEqual({});
  });

  test("an effort posted for a step not ticked is skipped, not refused", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], effort: { analyze: "high", implement: "low" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.effort).toEqual({ analyze: "high" });
  });

  test("an unknown effort level is refused", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], effort: { analyze: "turbo" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("turbo");
  });

  test("ultracode is refused — not a plain effort level", () => {
    const r = parseJobRequest(
      { ...REQ, steps: ["analyze"], effort: { analyze: "ultracode" } },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
  });

  test.each([
    ["an unknown project", { ...REQ, project: "atlasaurus" }, "project"],
    ["a project not in the allowlist", { ...REQ, project: "claude-usage" }, "project"],
    ["a path instead of a name", { ...REQ, project: "../../etc" }, "project"],
    ["an unknown spec folder", { ...REQ, specFolder: "99-nope" }, "specFolder"],
    ["a step that is not a workflow step", { ...REQ, steps: ["deploy"] }, "steps"],
    ["no steps at all", { ...REQ, steps: [] }, "steps"],
    ["a non-object body", "hello", "object"],
  ])("%s is rejected", (_label, body, field) => {
    const r = parseJobRequest(body, { resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(field);
  });
});

describe("mergeQueueDefaults", () => {
  test("a config file overrides what it names and keeps the rest", () => {
    const merged = mergeQueueDefaults(DEFAULTS, {
      budgetUsd: 15,
      jobCapUsd: 50,
      model: { implement: "opus", archive: "sonnet" },
    });
    expect(merged.budgetUsd).toBe(15);
    expect(merged.jobCapUsd).toBe(50);
    expect(merged.dailyCapUsd).toBe(20); // untouched
    expect(merged.timeoutSec).toEqual(DEFAULTS.timeoutSec);
    expect(merged.model.archive).toBe("sonnet");
    expect(merged.permissionMode.implement).toBe("bypassPermissions");
  });

  test("a per-step timeoutSec table is merged like the other two (spec 152)", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { timeoutSec: { implement: 7200, archive: 900 } });
    expect(merged.timeoutSec).toEqual({ default: 1200, implement: 7200, archive: 900 });
  });

  test("a config still carrying the old flat timeoutSec falls back rather than crashing", () => {
    // The shape changed in spec 152 and the file is edited by hand on
    // the serving host. A number where a table is expected is dropped,
    // the same direction every other malformed key here fails in — the
    // built-in per-step defaults stand until someone edits the file.
    const merged = mergeQueueDefaults(DEFAULTS, { timeoutSec: 2700 });
    expect(merged.timeoutSec).toEqual(DEFAULTS.timeoutSec);
  });

  test("nonsense is ignored rather than obeyed — failing towards spending less", () => {
    const merged = mergeQueueDefaults(DEFAULTS, { budgetUsd: -5, dailyCapUsd: "lots", model: 7 });
    expect(merged.budgetUsd).toBe(3);
    expect(merged.dailyCapUsd).toBe(20);
    expect(merged.model).toEqual(DEFAULTS.model);
  });
});
