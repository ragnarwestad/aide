// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying } from "../../helpers/queue-server.ts";
import {
  TOKEN,
  specControls,
  OPEN_81,
  listUntil,
  rowSaysDone,
  setupQueueRoutesHarness,
} from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// The row is where you SEE which phases have run; spec 94 makes it
// where you run them. Any subset of the four, one job, on the model the
// row picked.
describe("running a spec's phases from its own row (criteria 1-4, 11)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** Exactly what the row's form posts: no target, no caps. */
  const postRow = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields).toString(),
    });

  // Spec 171: there was a Resolve form here that posted a fixed
  // `steps=resolve`. The step is retired, and the route is where that
  // is enforced for anything still holding the old body — a bookmark,
  // a script, a stale page left open in a tab.
  test("a body still naming the retired resolve step is refused (spec 171)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "resolve",
    });
    expect(res.status).toBe(400);
  });

  test("the row's fields queue the step it ticked, on the model it picked (criteria 1-3)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { steps: string[]; gateAfter?: string[]; model: Record<string, string> };
    };
    expect(body.job.steps).toEqual(["implement"]);
    expect(body.job.model).toEqual({ implement: "fable" });
    // Spec 149: there is no gate to name at all any more, so the field
    // is not on the job the queue hands back.
    expect(body.job.gateAfter).toBeUndefined();
  });

  test("the default option queues no override at all (criterion 4)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  // Spec 181, criterion 7: the review of the plan runs inside analyze
  // now, so the step is two steps' worth of work. The shipped table
  // gives it more clock than the fallback every unnamed step falls to
  // — `archive` is not in the table, so its limit IS that fallback.
  test("analyze's own time limit is longer than the default (spec 181)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "archive"] }),
    });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { timeoutSec: Record<string, number> } };
    expect(job.timeoutSec.analyze!).toBeGreaterThan(job.timeoutSec.archive!);
  });

  test("every row offers all three steps — the row is the way a spec starts (criterion 11)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const line = specControls(html, "81-queue-and-runner");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
    }
  });

  // Spec 116 gave create a phase line of its own; spec 139 gave it the
  // same source as every other step. `/aide-create` writes
  // `Workflow steps completed: create` into 4-status.md, so a created
  // spec says so — and the line is a report, never a box to tick.
  // Its box is ticked and disabled since 2026-08-21 — the hole where
  // the other four have one made the line read as a different kind of
  // thing. What must still hold is that no press can post it.
  test("a created spec reads create as done, and its box cannot be posted (spec 116)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create"]);
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const create = html.match(/<tr class="subrow[^"]*"[^>]*data-step="create">.*?<\/tr>/)?.[0] ?? "";
    expect(create).toContain("b-done");
    const controls = specControls(html, "81-queue-and-runner");
    expect(controls).toContain('data-phase="create"');
    // Ticked, disabled, and carrying no field name — three reasons a
    // press can never send `steps=create`.
    expect(controls).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(controls).not.toContain('name="steps" value="create"');
  });

  test("ticking two phases queues ONE job with both, in workflow order (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // A browser sends one `steps` value per ticked box, in the order the
    // boxes are drawn — never in the order they were clicked.
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { job: { steps: string[]; gateAfter?: string[] } };
    expect(made.job.steps).toEqual(["analyze", "implement"]);
    expect(made.job.gateAfter).toBeUndefined();
  });

  // The checkbox that used to send this key went in spec 133 and the
  // gate itself in spec 149, so a urlencoded body naming `gate` is a
  // stray from somewhere else. It is ignored, like any other unknown
  // key, and the job runs straight through.
  test("a stray gate key is ignored (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    body.append("gate", "on");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    const made = (await res.json()) as { job: { gateAfter?: string[]; state: string } };
    expect(made.job.gateAfter).toBeUndefined();
    expect(made.job.state).toBe("queued");
  });

  // Spec 267 reverses this row's own offer: a done phase's box is now
  // ticked and locked, the same treatment `create` already had (see
  // "a created spec reads create as done" above). The API route itself
  // is untouched (2-analysis.md, "API dependencies: None") — a rerun
  // sent straight to it, bypassing the row's own box, still succeeds.
  test("a done phase's box is locked on the row; a direct rerun still reaches the queue (criterion 4)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const analyze = specControls(html, "81-queue-and-runner")
      .match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0];
    expect(analyze).toContain('class="badge b-done"');
    // Ticked, disabled, and carrying no field name — the row no longer
    // offers this phase for a rerun.
    expect(analyze).toContain('<input type="checkbox" value="analyze" checked disabled');
    expect(analyze).not.toContain('name="steps" value="analyze"');
    expect(analyze).toContain("already done");
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { steps: string[] } }).job.steps).toEqual(["analyze"]);
  });

  // Spec 87's criterion 10 said the opposite — "a spec nothing has ever
  // run gets no row, so the form is its only way in". Spec 90 reverses
  // it deliberately: the dropdown and the list held the same things, and
  // a spec crossing from one to the other told the reader nothing.
  test("a spec nothing has ever run is a row, and analyze starts from it (spec 90, criterion 16)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    expect(html).toContain('<tr class="spechead');
    expect(html).toContain('data-folder="81-queue-and-runner"');
    const line = specControls(html, "81-queue-and-runner");
    // Nothing has ever run for it, so analyze is ticked — the step
    // every spec here is actually started as.
    expect(line).toContain('value="analyze" checked');
    // Spec 176: the State column says what the process says comes
    // next, on a row nothing has run as on one that has.
    expect(html).toContain('class="badge b-ready"');
    expect(html).toContain(">ready<");
    expect(html).not.toContain("not started");
  });

  test("the fold survives the refresh the page performs on itself (spec 90, criterion 17)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // The refresh the page performs on itself sends `location.search`
    // back, so the row the reader opened is still open in the swap —
    // and a row nobody opened is still shut (spec 103's default).
    const shut = await (await fetch(`${base}/?rows=1`, auth)).text();
    expect(shut).toContain('data-folder="81-queue-and-runner"');
    expect(shut).not.toContain('<tr class="subrow');
    const opened = await (await fetch(`${base}/?rows=1&${OPEN_81}`, auth)).text();
    expect(opened).toContain('data-folder="81-queue-and-runner"');
    expect(opened).toContain('<tr class="subrow');
  });
});
