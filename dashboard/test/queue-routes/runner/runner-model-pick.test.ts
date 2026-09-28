// Split out of runner-invocation.test.ts by theme.

import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { renderSpecsPage } from "../../../src/render";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness(undefined, IMPLEMENTED);

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
