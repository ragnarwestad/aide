// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ran, statusSaying, IMPLEMENTED } from "../../helpers/queue-server.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness(undefined, IMPLEMENTED);

afterEach(() => harness.cleanup());

// The row is where you SEE which phases have run; spec 94 makes it
// where you run them. Any subset of the four, one job, on the model the
// row picked.
describe("running a spec's phases from its own row (criteria 1-4, 11)", () => {
  const CHOICES = {
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: {}, fable: {} },
  };

  /** Exactly what the row's form posts: no target, no caps. */
  const postRow = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields).toString(),
    });

  test("the row's fields queue the step it ticked, on the model it picked (criteria 1-3)", async () => {
    const { base } = start({ queueDefaults: CHOICES });
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
    const { base } = start({ queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ implement: "opus" });
  });

  // Spec 181, criterion 7: the review of the plan runs inside analyze
  // now, so the step is two steps' worth of work. The shipped table
  // gives it more clock than the fallback every unnamed step falls to
  // — `archive` is not in the table, so its limit IS that fallback.
  test("analyze's own time limit is longer than the default (spec 181)", async () => {
    const { base } = start();
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "archive"] }),
    });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { timeoutSec: Record<string, number> } };
    expect(job.timeoutSec.analyze!).toBeGreaterThan(job.timeoutSec.archive!);
  });

  test("ticking two phases queues ONE job with both, in workflow order (criterion 3)", async () => {
    const { base } = start();
    // A browser sends one `steps` value per ticked box, in the order the
    // boxes are drawn — never in the order they were clicked.
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
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
    const { base } = start();
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    body.append("gate", "on");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
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
  test("a rerun of a done phase reaches the queue (criterion 4)", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { steps: string[] } }).job.steps).toEqual(["analyze"]);
  });

});
