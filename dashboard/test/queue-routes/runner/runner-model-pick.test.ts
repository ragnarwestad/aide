// Split out of runner-invocation.test.ts by theme.

import { IMPLEMENTED } from "../../helpers/queue-server.ts";
import { afterEach, describe, expect, test } from "bun:test";
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

  /** Posts `body` to the queue as the page's form does, on a server
   *  configured with CHOICES. */
  async function postForm(body: string): Promise<Response> {
    const { base } = start({ queueDefaults: CHOICES });
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    return fetch(`${base}/api/queue`, { method: "POST", headers, body });
  }

  const modelOf = async (res: Response): Promise<Record<string, string>> =>
    ((await res.json()) as { job: { model: Record<string, string> } }).job.model;

  // The choice moved onto the phase lines, so a form now
  // posts one field PER PHASE — `model.analyze=…&model.implement=…`.
  // A urlencoded body cannot carry a nested object, so the dotted keys
  // are folded back into one on the way in. Tested through the real
  // route rather than against the two functions separately: they are
  // only proven to AGREE if something drives an actual wire body from
  // one end to the other.
  test("one press can run two phases on two different models", async () => {
    const res = await postForm(new URLSearchParams({
      target: "aide/81-queue-and-runner",
      steps: "analyze",
      "model.analyze": "sonnet",
    }).toString() + "&steps=implement&model.implement=fable");
    expect(res.status).toBe(200);
    expect(await modelOf(res)).toEqual({ analyze: "sonnet", implement: "fable" });
  });

  // Every select on the page posts, including the ones left alone —
  // a browser sends `model.implement=` for a phase whose picker still
  // reads "default". Passed through as an empty string it would be
  // refused as an invalid model name; it has to be dropped instead.
  test("a phase left on 'default' posts a blank that is dropped, not refused", async () => {
    const res = await postForm(
      "target=aide%2F81-queue-and-runner&steps=analyze&steps=implement" +
      "&model.analyze=fable&model.implement=",
    );
    expect(res.status).toBe(200);
    expect(await modelOf(res)).toEqual({ analyze: "fable", implement: "opus" });
  });
});
// The Merge button is gone, and this whole block with it. What it
// covered — the per-repo merge, the plan-before-code order, the install
// afterwards, the conflict that offers a resolve — is what a step's own
// landing does now, and is covered in "every step lands its own work" below.
