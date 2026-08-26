import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JOB_STATES,
  PHASE_STEPS,
  mergeQueueDefaults,
  parseCreateRequest,
  parseJobRequest,
  persistQueueSettings,
  WORKFLOW_STEPS,
  type QueueDefaults,
} from "../../src/queue/queue.ts";
import { QUEUE_STEPS } from "../../src/render/pages/queue-list.ts";

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
// --- spec 93: a spec that does not exist yet ---------------------------------

// Every other request names a spec folder the server has already
// discovered on disk. A create request cannot: the folder is what the
// job is FOR. So it is validated against the raw allowlist instead —
// the one set that knows about a project which has never had a spec —
// and carries a provisional key until `/aide-create` decides the real
// name.
describe("parseCreateRequest", () => {
  const allow = (project: string) => project === "aide" || project === "brandnew";
  const CREATE = { project: "brandnew", title: "A new spec", description: "Do the thing" };

  test("a project with no spec at all is accepted — the allowlist is the whole test", () => {
    // The resolver every other route uses answers null for this
    // project, which is exactly the gap that makes a project's FIRST
    // spec uncreatable today.
    expect(resolve("brandnew")).toBeNull();
    const r = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.project).toBe("brandnew");
    expect(r.job.steps).toEqual(["create"]);
    expect(r.job.createTitle).toBe("A new spec");
    expect(r.job.createDescription).toBe("Do the thing");
    // A provisional key, and one nobody could mistake for a spec folder.
    expect(r.job.specFolder).toMatch(/^new-[0-9a-f]{8}$/);
  });

  test("two create requests never share a key", () => {
    const a = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    const b = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(a.ok && b.ok && a.job.specFolder !== b.job.specFolder).toBe(true);
  });

  test("a project outside the allowlist is refused", () => {
    const r = parseCreateRequest({ ...CREATE, project: "someone-elses" }, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(false);
  });

  test("the title and the description are required and bounded", () => {
    for (const bad of [
      { ...CREATE, title: "" },
      { ...CREATE, title: "x".repeat(200) },
      { ...CREATE, description: "" },
      { ...CREATE, description: "x".repeat(5000) },
      { ...CREATE, title: 7 },
      {},
    ]) {
      expect(parseCreateRequest(bad, { allow, defaults: DEFAULTS }).ok).toBe(false);
    }
  });

  test("the caps come from the config, exactly as every other job's do", () => {
    const r = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(r.ok && r.job.budgetUsd).toBe(DEFAULTS.budgetUsd);
    expect(r.ok && r.job.jobCapUsd).toBe(DEFAULTS.jobCapUsd);
    expect(r.ok && r.job.timeoutSec).toEqual(DEFAULTS.timeoutSec);
  });
});
// --- spec 110: what a new spec builds on --------------------------------------

// A `Depends on:` line in 1-description.md (spec 92) has had a reader
// since the day it existed and no writer but a person at a shell. The
// create form names it now, so the value arrives as a request field —
// and a name a request supplies is checked against server-known truth,
// never against whatever chips the browser happened to render.
describe("parseCreateRequest — dependsOn", () => {
  const allow = (project: string) => project === "aide" || project === "brandnew";
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };

  test("a same-project active spec is accepted and stored on the job", () => {
    const r = parseCreateRequest(
      { ...CREATE, dependsOn: ["81-queue-and-runner"] },
      { allow, resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.createDependsOn).toEqual(["81-queue-and-runner"]);
  });

  test("an entry belonging to another project, or to none at all, is refused", () => {
    // `01-first` is real — it is `aide-dashboard`'s. A dependency is
    // resolved inside ONE specs root (aide-run-spec's own guard does
    // the same), so another project's folder is as unknown as a made-up
    // one.
    for (const bad of [["01-first"], ["no-such-spec"], ["../etc/passwd"], [7]]) {
      const r = parseCreateRequest({ ...CREATE, dependsOn: bad }, { allow, resolve, defaults: DEFAULTS });
      expect(r.ok).toBe(false);
    }
  });

  test("a repeat is refused, and so is a value that is not a list", () => {
    expect(
      parseCreateRequest(
        { ...CREATE, dependsOn: ["81-queue-and-runner", "81-queue-and-runner"] },
        { allow, resolve, defaults: DEFAULTS },
      ).ok,
    ).toBe(false);
    expect(
      parseCreateRequest({ ...CREATE, dependsOn: "81-queue-and-runner" }, { allow, resolve, defaults: DEFAULTS }).ok,
    ).toBe(false);
  });

  test("nothing chosen means no field at all — exactly today's behaviour", () => {
    const r = parseCreateRequest(CREATE, { allow, resolve, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.createDependsOn).toBeUndefined();
    // And a caller that passes no resolver at all still parses: the six
    // calls above this block do exactly that, and a create that names
    // nothing has nothing to look up.
    expect(parseCreateRequest(CREATE, { allow, defaults: DEFAULTS }).ok).toBe(true);
  });

  test("a project whose first spec this is has nothing to depend on", () => {
    const r = parseCreateRequest(
      { ...CREATE, project: "brandnew", dependsOn: ["81-queue-and-runner"] },
      { allow, resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
  });
});
// --- spec 228: the model a create job runs on --------------------------------

// Every step but `create` could already be pointed at a model from its
// own phase line. `create` never could — it makes the spec the phase
// lines belong to, so there is no row to pick from — and the New-spec
// form is where that choice belongs instead. The name arrives in the
// same `model.<step>` shape every phase line already posts, and is
// looked up in the same table (`lookUpModel`), so a name this parser
// accepts is a name `parseJobRequest` would accept too.
describe("parseCreateRequest — model", () => {
  const allow = (project: string) => project === "aide" || project === "brandnew";
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  // Criterion 4.
  test("a configured model is honoured, and the job carries it for the one step it runs", () => {
    const r = parseCreateRequest({ ...CREATE, model: { create: "fable" } }, { allow, defaults: WITH_CHOICES });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.model).toEqual({ create: "fable" });
    // Risk 3: the shape, not just the value. A create job runs one
    // step, so its model table names exactly that step — the same shape
    // `perStep(["create"], ...)` produces, differing only in the name.
    expect(Object.keys(r.job.model!)).toEqual(["create"]);
  });

  // Criterion 5: the same wording `parseJobRequest` refuses with.
  test("a name the config does not offer is refused, with the shared wording", () => {
    const r = parseCreateRequest(
      { ...CREATE, model: { create: "nonexistent-model" } },
      { allow, defaults: WITH_CHOICES },
    );
    expect(r).toEqual({ ok: false, error: "unknown or not-allowed model: nonexistent-model" });
  });

  // Criterion 7: nothing configured at all is a different sentence from
  // a name that is merely not on the list.
  test("a server offering no model at all says so, rather than naming the pick", () => {
    const r = parseCreateRequest({ ...CREATE, model: { create: "fable" } }, { allow, defaults: DEFAULTS });
    expect(r).toEqual({ ok: false, error: "no model choice is configured on this server" });
  });

  // Criterion 6: an untouched form and a form with no Model field at
  // all both land here, and both mean "the configuration decides".
  test("omitted, empty, or not posted at all: the config's own default for the step", () => {
    for (const body of [
      CREATE,
      { ...CREATE, model: { create: "" } },
      { ...CREATE, model: "" },
      { ...CREATE, model: {} },
    ]) {
      const r = parseCreateRequest(body, { allow, defaults: WITH_CHOICES });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // DEFAULTS.model names no `create`, so the table's own `default`
      // is what the step gets — exactly what `perStep` gave it before
      // this field existed.
      expect(r.job.model).toEqual({ create: DEFAULTS.model.default! });
      expect(Object.keys(r.job.model!)).toEqual(["create"]);
    }
  });

  test("a malformed name is refused before anything is looked up", () => {
    for (const bad of [{ create: "../etc/passwd" }, { create: 7 }, ["fable"]]) {
      expect(parseCreateRequest({ ...CREATE, model: bad }, { allow, defaults: WITH_CHOICES }).ok).toBe(false);
    }
  });

  // A create job runs one step. A name posted for any other is the
  // browser sending the whole set of phase selects, and is skipped
  // rather than refused — the rule `parseJobRequest` already follows.
  test("a name for a step this job does not run is ignored, not refused", () => {
    const r = parseCreateRequest(
      { ...CREATE, model: { implement: "fable" } },
      { allow, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.model).toEqual({ create: DEFAULTS.model.default! });
  });
});

// Spec 160: the steps a running job's tail may be given are exactly the
// ones a spec's row draws a box for. Two lists, in two layers that do
// not import each other — the render side knows nothing of the queue's
// module, deliberately — so this is what says they agree.
describe("PHASE_STEPS", () => {
  test("is the row's own box list, in the workflow's order", () => {
    expect([...PHASE_STEPS] as string[]).toEqual([...QUEUE_STEPS]);
    const ranks = PHASE_STEPS.map((s) => WORKFLOW_STEPS.indexOf(s));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).not.toContain(-1);
  });
});

// Spec 259: a project's own recurring job, queued through the same
// store as every other step. Queueable like `explore`/`manifest`/
// `reopen`/`reset`, but never a phase a spec passes through.
describe("WORKFLOW_STEPS — schedule (spec 259)", () => {
  test("is a workflow step but not a phase", () => {
    expect((WORKFLOW_STEPS as readonly string[]).includes("schedule")).toBe(true);
    expect((PHASE_STEPS as readonly string[]).includes("schedule")).toBe(false);
  });
});

describe("parseJobRequest — the schedule step (spec 259)", () => {
  test("a schedule-<name> tracking key needs no existing spec folder", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job.specFolder).toBe("schedule-nightly-report");
    expect(r.job.steps).toEqual(["schedule"]);
  });

  test("a tracking key that does not start with schedule- is refused", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "not-a-schedule-key", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("specFolder");
  });

  test("the exemption never widens another step: schedule combined with analyze still needs a real folder", () => {
    const r = parseJobRequest(
      { project: "aide", specFolder: "schedule-nightly-report", steps: ["schedule", "analyze"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("unknown specFolder");
  });

  test("a schedule job for an unallowed project is still refused", () => {
    const r = parseJobRequest(
      { project: "not-a-project", specFolder: "schedule-nightly-report", steps: ["schedule"] },
      { resolve, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("project");
  });
});

// Spec 193, criterion 11. `errorReason` is declared twice — once on the
// stored job and once on the view the render layer builds — for the
// same reason `PHASE_STEPS` is: the two layers do not import each
// other. A union widened in one place only is a reason the row cannot
// draw, and TypeScript says nothing about it because the render side
// takes its own narrower type. The declarations are read as TEXT
// because neither side has a runtime value to compare, which is the
// same thing `test_aide_run_spec.py` does to the bash and TypeScript
// copies of `WORKFLOW_STEPS`.
describe("errorReason", () => {
  /** The members of the `errorReason?: ...` union in one source file. */
  const declaredIn = (file: string): string[] => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "src", file), "utf-8");
    const line = src.match(/^\s*errorReason\?:([^;]*);/m);
    expect(line).not.toBeNull();
    return line![1]!
      .split("|")
      .map((m) => m.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .sort();
  };

  test("names the same members on the job and on the row's view", () => {
    const stored = declaredIn("queue/queue.ts");
    expect(stored).toEqual(declaredIn("render/ui/job-state.ts"));
    // Named, so widening the union without a reader is caught here
    // rather than at the page: `unlanded` is spec 193's refusal — the
    // spec was archived and a branch of its own is still on origin.
    expect(stored).toEqual(["conflict", "unlanded"]);
  });
});

// The widened validation is for ONE route. `parseJobRequest` still
// requires a project with a discovered spec — a regression guard, green
// today and green afterwards.
test("an ordinary job request still needs a project with a discovered spec", () => {
  const r = parseJobRequest(
    { project: "brandnew", specFolder: "01-first", steps: ["analyze"] },
    { resolve, defaults: DEFAULTS },
  );
  expect(r.ok).toBe(false);
});
