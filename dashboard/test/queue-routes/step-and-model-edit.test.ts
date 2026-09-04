// Split out of step-and-dependency-routes.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TOKEN, JOB, specControls, OPEN_81, setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// Spec 118: the token count is recorded by the run, stored on the job,
// and has to survive every hop between the mirror on disk and the cell
// in the page. The render tests prove the cell; this one proves the
// hops — a field the server forgets to forward renders a dash forever,
// and nothing else would notice.
describe("a job's token count reaches the page", () => {
  async function seeded(): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.spentUsd = 0.54;
    job.spentTokens = 1_234_000;
    job.results = [
      {
        step: "analyze", ok: true, costUsd: 0.54, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T10:01:00Z",
        tokens: { input: 100, output: 900, cacheRead: 1_000_000, cacheCreation: 233_000, total: 1_234_000 },
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  test("the spec list shows both figures, and the model dropdown stays in dollars", async () => {
    const { mirror } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M</span>');
  });

  test("the job page shows both figures for the step and the job", async () => {
    const { mirror, id } = await seeded();
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror });
    const html = await (
      await fetch(`${base}/specs/${id}?tab=steps`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(html).toContain('<span class="u-usd">$0.54</span>');
    expect(html).toContain('<span class="u-tok">1.2M</span>');
  });
});

// --- spec 160: a later phase can be added while the job runs ------------------

// Not a second job for the same spec — the clash check refuses that,
// and rightly. This is an edit to the job that exists, so it has a
// route of its own, and every decision it makes is against the job as
// it stands at that instant rather than against whatever the page
// believed when the box was ticked.
describe("POST /api/queue/:id/steps (spec 160)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** One job in the mirror, RUNNING the step at `stepIndex`, served by
   *  a second server started on that mirror. No runner is configured,
   *  so nothing reconciles the seeded state out from under the test —
   *  the same trick the view-carrying suite above uses for Cancel. */
  async function running(
    steps: string[],
    stepIndex = 0,
    opts: { description?: string; alsoSpecs?: string[] } = {},
  ): Promise<{ base: string; id: string }> {
    const first = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${first.base}/api/queue`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...JOB, steps }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "running";
    job.stepIndex = stepIndex;
    writeFileSync(mirror, JSON.stringify(jobs));
    const second = harness.start({
      extra: { queueToken: TOKEN, queueMirrorPath: mirror },
      ...(opts.description ? { description: opts.description } : {}),
      ...(opts.alsoSpecs ? { alsoSpecs: opts.alsoSpecs } : {}),
    });
    return { base: second.base, id: made.job.id };
  }

  const edit = (base: string, id: string, step: string, checked: boolean, body?: BodyInit) =>
    fetch(`${base}/api/queue/${id}/steps`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, checked }),
    });

  const stepsOf = async (base: string, id: string): Promise<string[]> => {
    const listed = (await (await fetch(`${base}/api/queue`, { headers: JSON_HEADERS })).json()) as {
      jobs: { id: string; steps: string[] }[];
    };
    return listed.jobs.find((j) => j.id === id)!.steps;
  };

  test("a later step is added, in workflow order (criterion 1)", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; job: { steps: string[] } };
    expect(answer.ok).toBe(true);
    expect(answer.job.steps).toEqual(["analyze", "archive"]);
    expect((await edit(base, id, "implement", true)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement", "archive"]);
  });

  test("a not-yet-started step is removed (criterion 2)", async () => {
    const { base, id } = await running(["analyze", "implement", "archive"]);
    expect((await edit(base, id, "implement", false)).status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  test("the form encoding the page posts is understood too", async () => {
    const { base, id } = await running(["analyze"]);
    const res = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "1" }));
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
    const off = await edit(base, id, "", false, new URLSearchParams({ step: "archive", checked: "0" }));
    expect(off.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze"]);
  });

  test("the running step is refused, by name (criterion 3)", async () => {
    const { base, id } = await running(["analyze", "archive"], 1);
    const res = await edit(base, id, "archive", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("archive");
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The page drew `implement` as a live box; by the time the tick
  // arrived the runner had walked onto it. The server answers about the
  // job it has, not about the one the page remembers.
  test("a step the runner has walked past since the page drew it is refused (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"], 1);
    const res = await edit(base, id, "implement", false);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("implement");
    expect(await stepsOf(base, id)).toEqual(["analyze", "implement"]);
  });

  test("a job that is not running is refused (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await edit(base, made.job.id, "implement", true);
    expect(res.status).toBe(400);
    expect(await stepsOf(base, made.job.id)).toEqual(["analyze"]);
  });

  test("a step earlier than the one running is refused (criterion 9)", async () => {
    const { base, id } = await running(["implement", "archive"]);
    const res = await edit(base, id, "analyze", true);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("analyze");
    expect(await stepsOf(base, id)).toEqual(["implement", "archive"]);
  });

  test("an unknown job is a 404, and GET is not a way in", async () => {
    const { base, id } = await running(["analyze"]);
    expect((await edit(base, "nope", "archive", true)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/queue/${id}/steps`, { headers: JSON_HEADERS })).status,
    ).toBe(405);
  });

  // Criterion 5. The gate is not the route's question: a gated step
  // added to a tail is accepted the same way one named at job creation
  // is, and is held back only once it becomes the job's current step —
  // which is what `runner.test.ts` pins from the other side.
  test("a gated step is accepted even though the spec's dependency has not landed", async () => {
    const { base, id } = await running(["analyze"], 0, {
      description: "# Queue - Description\n\n## Tracking info\n\n- **Depends on:** `80-dependency`\n",
      alsoSpecs: ["80-dependency"],
    });
    const res = await edit(base, id, "archive", true);
    expect(res.status).toBe(200);
    expect(await stepsOf(base, id)).toEqual(["analyze", "archive"]);
  });

  // The other half of the wiring: the row the reader is looking at has
  // to draw those boxes live, and point them at this route.
  test("the row draws the live boxes and points them here", async () => {
    const { base, id } = await running(["analyze"]);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    expect(group).toContain(`data-post-to="/api/queue/${id}/steps"`);
    const live = (step: string) =>
      (group.match(new RegExp(`<label class="phase[^"]*" data-phase="${step}"[^>]*>.*?</label>`))?.[0] ?? "");
    expect(live("archive")).toContain("data-post-to");
    expect(live("archive")).not.toContain("disabled");
    expect(live("analyze")).toContain("disabled");
  });
});
// --- spec 225: a phase still ahead takes a model too --------------------------

// The sibling of the route above, and named after the one thing it
// does. A box tick and a select change are two different events at two
// different moments; folding them into one body would make `/steps`
// branch on which fields it was handed, and `checked`'s absence would
// have to mean something other than `false`.
describe("POST /api/queue/:id/model (spec 225)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEFAULTS = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** One job in the mirror, RUNNING the step at `stepIndex`, served by
   *  a second server started on that mirror — the same trick the
   *  `/steps` suite above uses, so no runner reconciles the seeded
   *  state out from under the test. */
  async function running(steps: string[], stepIndex = 0): Promise<{ base: string; id: string }> {
    const first = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const made = (await (
      await fetch(`${first.base}/api/queue`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ ...JOB, steps }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(first.dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "running";
    job.stepIndex = stepIndex;
    writeFileSync(mirror, JSON.stringify(jobs));
    const second = harness.start({
      extra: { queueToken: TOKEN, queueMirrorPath: mirror, queueDefaults: DEFAULTS },
    });
    return { base: second.base, id: made.job.id };
  }

  const pick = (base: string, id: string, step: string, model: string, body?: BodyInit) =>
    fetch(`${base}/api/queue/${id}/model`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, model }),
    });

  const modelOf = async (base: string, id: string): Promise<Record<string, string>> => {
    const listed = (await (await fetch(`${base}/api/queue`, { headers: JSON_HEADERS })).json()) as {
      jobs: { id: string; model: Record<string, string> }[];
    };
    return listed.jobs.find((j) => j.id === id)!.model;
  };

  test("a step still ahead takes the model (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "implement", "fable");
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean; job: { model: Record<string, string> } };
    expect(answer.ok).toBe(true);
    expect(answer.job.model.implement).toBe("fable");
    expect((await modelOf(base, id)).implement).toBe("fable");
  });

  test("the form encoding the page posts is understood too (criterion 4)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "", "", new URLSearchParams({ step: "implement", model: "fable" }));
    expect(res.status).toBe(200);
    expect((await modelOf(base, id)).implement).toBe("fable");
  });

  test("the running step is refused, by name (criterion 3)", async () => {
    const { base, id } = await running(["analyze", "implement"], 1);
    const res = await pick(base, id, "implement", "fable");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("implement");
    expect((await modelOf(base, id)).implement).toBe("opus");
  });

  test("a model the server does not offer is refused (criterion 7)", async () => {
    const { base, id } = await running(["analyze", "implement"]);
    const res = await pick(base, id, "implement", "haiku");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("haiku");
    expect((await modelOf(base, id)).implement).toBe("opus");
  });

  test("a job that is not running is refused (criterion 8)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const made = (await (
      await fetch(`${base}/api/queue`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(JOB) })
    ).json()) as { job: { id: string } };
    const res = await pick(base, made.job.id, "analyze", "fable");
    expect(res.status).toBe(400);
    expect((await modelOf(base, made.job.id)).analyze).toBe("sonnet");
  });

  test("an unknown job is a 404, and GET is not a way in", async () => {
    const { base, id } = await running(["analyze"]);
    expect((await pick(base, "nope", "archive", "fable")).status).toBe(404);
    expect((await fetch(`${base}/api/queue/${id}/model`, { headers: JSON_HEADERS })).status).toBe(405);
  });

  // The other half of the wiring: the row the reader is looking at has
  // to draw those selects live, and point them at this route.
  test("the row draws the live model select and points it here (criteria 1-3)", async () => {
    const { base, id } = await running(["analyze"]);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    const select = (step: string) =>
      group.match(new RegExp(`<select name="model\\.${step}"[^>]*>`))?.[0] ?? "";
    expect(select("implement")).toContain(`data-post-to="/api/queue/${id}/model"`);
    expect(select("implement")).not.toContain("disabled");
    expect(select("analyze")).toContain("disabled");
    expect(select("analyze")).not.toContain("data-post-to");
  });
});

// --- spec 308: a model picked for a phase survives leaving the page ----------

// A phase that has NOT started has no job to attach a pick to — this is
// the spec-scoped sibling of `POST /api/queue/:id/model` above, recording
// a pick before any run exists for it to ride along on.
describe("POST /api/queue/specs/:project/:folder/model (spec 308)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEFAULTS = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  const pick = (base: string, project: string, folder: string, step: string, model: string, body?: BodyInit) =>
    fetch(`${base}/api/queue/specs/${project}/${folder}/model`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, model }),
    });

  test("REQ-1: records a pick for a phase that has no job yet", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const res = await pick(base, "aide", "81-queue-and-runner", "analyze", "fable");
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean };
    expect(answer.ok).toBe(true);
  });

  test("the form encoding the page posts is understood too", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const res = await pick(
      base, "aide", "81-queue-and-runner", "", "", new URLSearchParams({ step: "analyze", model: "fable" }),
    );
    expect(res.status).toBe(200);
  });

  test("REQ-2: the pick is reflected back on the very next render", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    await pick(base, "aide", "81-queue-and-runner", "analyze", "fable");
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    const group = specControls(html, "81-queue-and-runner");
    const select = group.match(/<select name="model\.analyze"[\s\S]*?<\/select>/)?.[0] ?? "";
    expect(select).toMatch(/<option value="fable"[^>]*selected/);
  });

  test("an unknown spec is a 404, and GET is not a way in", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    expect((await pick(base, "aide", "nope", "analyze", "fable")).status).toBe(404);
    expect(
      (await fetch(`${base}/api/queue/specs/aide/81-queue-and-runner/model`, { headers: JSON_HEADERS })).status,
    ).toBe(405);
  });

  test("an archived spec's phases are locked", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN, queueDefaults: DEFAULTS },
      archivedSpecs: { "82-archived": {} },
    });
    const res = await pick(base, "aide", "82-archived", "analyze", "fable");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("archived");
  });
});

// --- spec 364: a step runs at a chosen effort level -------------------------

// The spec-scoped sibling of the model pending-pick route above, mirrored
// on the same terms: a pick made before any job exists, persisted the
// same way. No tail-edit counterpart (scope decision, 3-solution.md).
describe("POST /api/queue/specs/:project/:folder/effort (spec 364)", () => {
  const JSON_HEADERS = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const DEFAULTS = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 } },
  };

  const pick = (base: string, project: string, folder: string, step: string, effort: string, body?: BodyInit) =>
    fetch(`${base}/api/queue/specs/${project}/${folder}/effort`, {
      method: "POST",
      headers: body
        ? { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "x-aide-token": TOKEN }
        : JSON_HEADERS,
      body: body ?? JSON.stringify({ step, effort }),
    });

  test("REQ-2: records a pick for a phase that has no job yet", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const res = await pick(base, "aide", "81-queue-and-runner", "analyze", "high");
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { ok: boolean };
    expect(answer.ok).toBe(true);
  });

  // The row draws no effort control — the level a step runs at is a
  // configuration answer, not a per-row pick — so there is no select to
  // reflect a pick back into. What the route still owes is the record
  // itself, which the runner reads: a second pick lands on the same
  // phase without complaint, and the page renders as it did before.
  test("REQ-2: the pick is recorded, and the row draws no effort control", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    expect((await pick(base, "aide", "81-queue-and-runner", "analyze", "high")).status).toBe(200);
    expect((await pick(base, "aide", "81-queue-and-runner", "analyze", "low")).status).toBe(200);
    const html = await (
      await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(specControls(html, "81-queue-and-runner")).not.toContain('name="effort.analyze"');
  });

  test("an unknown level is refused", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: DEFAULTS });
    const res = await pick(base, "aide", "81-queue-and-runner", "analyze", "turbo");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("turbo");
  });

  test("an archived spec's phases are locked", async () => {
    const { base } = harness.start({
      extra: { queueToken: TOKEN, queueDefaults: DEFAULTS },
      archivedSpecs: { "82-archived": {} },
    });
    const res = await pick(base, "aide", "82-archived", "analyze", "high");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("archived");
  });
});
