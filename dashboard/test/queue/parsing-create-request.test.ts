// Split out of parsing.test.ts by theme.

import { describe, expect, test } from "bun:test";
import {
  parseCreateRequest,
  type QueueDefaults,
} from "../../src/queue/queue.ts";

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
// --- spec 342: running the whole workflow from the start ---------------------

// The New-spec page's phase table lets a reader tick analyze, implement
// and archive up front — the same ticks the Specs list's own row posts
// for an existing spec, reaching this same parser. `steps` widens from
// the hard-coded `["create"]` to `["create", ...ticked extras]`, and the
// model lookup widens from the single `create` key to every step the
// job actually runs.
describe("parseCreateRequest — steps (spec 342)", () => {
  const allow = (project: string) => project === "aide";
  const CREATE = { project: "aide", title: "A new spec", description: "Do the thing" };
  const WITH_CHOICES: QueueDefaults = {
    ...DEFAULTS,
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  // REQ-3, REQ-8: an untouched form posts no `steps` field at all, and
  // the job it produces is identical to today's.
  test("no steps field at all: create alone, exactly as before this existed", () => {
    const r = parseCreateRequest(CREATE, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["create"]);
  });

  // REQ-4, criterion 4.
  test("ticked extra phases are appended after create", () => {
    const r = parseCreateRequest(
      { ...CREATE, steps: ["analyze", "implement"] },
      { allow, defaults: DEFAULTS },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["create", "analyze", "implement"]);
  });

  // REQ-4, criterion 4: a name per ticked step, plus the config's own
  // default for `create` when the form's own model field for it was
  // left untouched.
  test("a per-step model map is honoured for every ticked step", () => {
    const r = parseCreateRequest(
      {
        ...CREATE,
        steps: ["analyze", "implement"],
        model: { create: "fable", analyze: "sonnet", implement: "fable" },
      },
      { allow, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.model).toEqual({ create: "fable", analyze: "sonnet", implement: "fable" });
  });

  // A name posted for a step this job does not run is skipped, not
  // refused — `parseJobRequest`'s own rule, since a phase table always
  // posts every select it drew, whichever boxes are ticked.
  test("a model named for an untouched phase is ignored", () => {
    const r = parseCreateRequest(
      { ...CREATE, steps: ["analyze"], model: { create: "sonnet", analyze: "fable", archive: "fable" } },
      { allow, defaults: WITH_CHOICES },
    );
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.model).toEqual({ create: "sonnet", analyze: "fable" });
  });

  // Bounded to the same three phases the Specs list's own row may tick
  // (`PHASE_STEPS`) — never `create` a second time, and never a step
  // outside the workflow's own vocabulary.
  test("an entry outside analyze/implement/archive is refused", () => {
    for (const bad of [["create"], ["reset"], ["explore"], ["nope"], [7]]) {
      expect(parseCreateRequest({ ...CREATE, steps: bad }, { allow, defaults: DEFAULTS }).ok).toBe(false);
    }
  });

  test("steps that is not a list is refused", () => {
    expect(parseCreateRequest({ ...CREATE, steps: "analyze" }, { allow, defaults: DEFAULTS }).ok).toBe(false);
  });

  // A repeated entry (two boxes of the same value, however that would
  // happen) never doubles a step in the job.
  test("a repeated entry is folded to one", () => {
    const r = parseCreateRequest({ ...CREATE, steps: ["analyze", "analyze"] }, { allow, defaults: DEFAULTS });
    expect(r.ok).toBe(true);
    expect(r.ok && r.job.steps).toEqual(["create", "analyze"]);
  });
});
