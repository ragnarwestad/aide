// Split out of runner-invocation.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { renderSpecsPage } from "../../../src/render";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => harness.cleanup());

// The page offers exactly what the config lists — a dropdown never
// names a model the server has not configured.
describe("picking a model for a job", () => {
  const CHOICES = {
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: {}, fable: {} },
  };

  // The choice belongs to a row the reader has opened (spec 103), so
  // every page here opens the one spec it renders.
  const OPEN = { open: "aide/81-queue-and-runner" };

  test("the form offers the configured models, one picker per phase", () => {
    const html = renderSpecsPage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [
        { name: "sonnet" },
        { name: "fable" },
      ],
    });
    expect(html).toContain('name="model.analyze"');
    expect(html).toContain('name="model.implement"');
    expect(html).toContain("fable");
    // Spec 457: what each is granted is not said here any more — the
    // figure lives in Settings, read-only trivia the option's own label
    // no longer repeats — and it was never a `title` either.
    expect(html).not.toContain('title="$12 per step"');
    // No "default" entry any more (2026-08-19): the select is pre-filled
    // with a real name, and only real names are offered.
    for (const step of ["analyze", "implement"]) {
      const select = html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))![0];
      expect([step, select.includes('<option value=""')]).toEqual([step, false]);
    }
  });

  // The "default" option is gone (asked for 2026-08-19): the select is
  // pre-filled with a real name instead, and every option's label is
  // just the model's name (spec 457 dropped the budget spec 454 had
  // put there) — no `<option>` ever carries a `title`.
  test("no default option; every label carries only the model's name", () => {
    const html = renderSpecsPage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [{ name: "fable" }],
      defaultModels: { default: "fable" },
    });
    const modelSelect = html.match(/<select name="model\.analyze"[\s\S]*?<\/select>/)?.[0] ?? "";
    // Scoped to the model select: spec 364's own effort select, drawn
    // beside it, DOES carry an empty "unset" option, on its own terms.
    expect(modelSelect).not.toContain('<option value=""');
    expect(modelSelect).not.toContain("title=");
    expect(modelSelect).toMatch(/<option value="fable"[^>]*>fable<\/option>/);
  });

  test("with nothing configured the page offers no model at all", () => {
    const html = renderSpecsPage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
    });
    expect(html).not.toContain('name="model"');
  });

  test("a row says which model it ran on — as the select's pre-filled value", () => {
    const html = renderSpecsPage(
      [
        {
          id: "a", project: "aide", specFolder: "81-queue-and-runner",
          steps: ["implement"], stepIndex: 0, state: "done", spentUsd: 24.5,
          timeoutSec: 1200, createdAt: "2026-08-16T00:00:00Z", model: "fable",
        },
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true, targets: [], filter: OPEN,
        modelChoices: [{ name: "sonnet" }, { name: "fable" }],
        defaultModels: { default: "sonnet" },
      },
    );
    expect(html).toMatch(/<select name="model\.implement"[^>]*>[^]*?<option value="fable"[^>]*selected/);
  });

  test("posting a chosen model runs every step on it", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "fable",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ implement: "fable" });
  });

  test("an empty model field means 'use the configuration', not an error", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ implement: "opus" });
  });

  // Spec 123: the choice moved onto the phase lines, so a form now
  // posts one field PER PHASE — `model.analyze=…&model.implement=…`.
  // A urlencoded body cannot carry a nested object, so the dotted keys
  // are folded back into one on the way in. Tested through the real
  // route rather than against the two functions separately: they are
  // only proven to AGREE if something drives an actual wire body from
  // one end to the other.
  test("one press can run two phases on two different models", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "analyze",
        "model.analyze": "sonnet",
      }).toString() + "&steps=implement&model.implement=fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ analyze: "sonnet", implement: "fable" });
  });

  // Every select on the page posts, including the ones left alone —
  // a browser sends `model.implement=` for a phase whose picker still
  // reads "default". Passed through as an empty string it would be
  // refused as an invalid model name; it has to be dropped instead.
  test("a phase left on 'default' posts a blank that is dropped, not refused", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body:
        "target=aide%2F81-queue-and-runner&steps=analyze&steps=implement" +
        "&model.analyze=fable&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ analyze: "fable", implement: "opus" });
  });

  test("every phase left on 'default' queues no override at all", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ implement: "opus" });
  });

  test("a per-phase field naming a model the config does not list is refused", async () => {
    const { base } = start({ queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=gpt-9",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("gpt-9");
  });
});
// Spec 149: the Merge button is gone, and this whole block with it. What it
// covered — the per-repo merge, the plan-before-code order, the install
// afterwards, the conflict that offers a resolve — is what a step's own
// landing does now, and is covered in "every step lands its own work" below.
