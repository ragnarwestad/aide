// What is sent, to whom, and what happens to a device that stops
// answering (AC-2, AC-3, AC-6). Real store, real encryption, a fake
// `fetch`: the message is opened again with the device's own key.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createPush } from "../../src/push/index.ts";
import { renderMessage } from "../../src/i18n/message.ts";
import {
  deviceKeys, fakeFetch, makeStore, openCall, result, runningJob, tempDir, SPEC, type Answer,
} from "./fixtures.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function board(answer?: (url: string) => Answer) {
  const tmp = tempDir();
  cleanups.push(tmp.done);
  const sent = fakeFetch(answer);
  const logs: string[] = [];
  const subscriptionsPath = join(tmp.dir, "push-subscriptions.json");
  let push!: ReturnType<typeof createPush>;
  const store = makeStore(() => push.observe());
  push = createPush({
    jobs: () => store.list(),
    fetch: sent.fetch,
    subscriptionsPath,
    keyPath: join(tmp.dir, "push-key.json"),
    log: (line) => logs.push(line),
  });
  /** A device with keys of its own; `answer` sees its endpoint. */
  const device = async (n: number, lang = "en") => {
    const keys = await deviceKeys();
    const endpoint = `https://fcm.googleapis.com/fcm/send/device-${n}`;
    const made = await push.subscribe({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, lang }, "https://board.test");
    expect(made.ok).toBe(true);
    return { ...keys, endpoint };
  };
  const fail = () => {
    const job = runningJob(store);
    store.transition(job.id, "step-failed", { results: [result("implement", "error", false)] });
  };
  return { push, store, sent, logs, device, fail, subscriptionsPath };
}

describe("what a notification says (criterion 9)", () => {
  test("the title names project and spec, the body is the catalogue sentence, the url is the spec's page", async () => {
    const b = await board();
    const d = await b.device(1);
    b.fail();
    await b.push.idle();
    const sent = await openCall(b.sent.calls[0]!, d);
    expect(sent.title).toBe(`aide · ${SPEC}`);
    expect(sent.body).toBe("Implement failed — it waits for you to look at why and press Implement again.");
    expect(sent.url).toBe(`/specs/aide/${SPEC}`);
  });

  test("the body is in the language stored with the subscription", async () => {
    const b = await board();
    const en = await b.device(1, "en");
    const nb = await b.device(2, "nb");
    b.fail();
    await b.push.idle();
    const byEndpoint = (e: string) => b.sent.calls.find((c) => c.url === e)!;
    const forNb = await openCall(byEndpoint(nb.endpoint), nb);
    const forEn = await openCall(byEndpoint(en.endpoint), en);
    const want = renderMessage("nb", { key: "push.failed", values: { step: "Implementer", button: "Implement" } });
    expect(forNb.body).toBe(want);
    expect(forNb.body).not.toBe(forEn.body);
  });

  test("the request carries a signed VAPID token and the encoding the push service expects", async () => {
    const b = await board();
    await b.device(1);
    b.fail();
    await b.push.idle();
    const call = b.sent.calls[0]!;
    expect(call.headers["content-encoding"]).toBe("aes128gcm");
    expect(call.headers.authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(call.headers.ttl).toBeDefined();
  });
});

describe("a device that turned notifications off gets nothing (criterion 13)", () => {
  test("after it unsubscribes, a spec that needs a person sends nothing to its endpoint", async () => {
    const b = await board();
    const stays = await b.device(1);
    const leaves = await b.device(2);
    await b.push.unsubscribe({ endpoint: leaves.endpoint });
    b.fail();
    await b.push.idle();
    expect(b.sent.calls.map((c) => c.url)).toEqual([stays.endpoint]);
  });
});

describe("a push service that answers badly (criterion 14)", () => {
  test.each([404, 410])("%d removes the subscription, and the next push does not go to it", async (status) => {
    const gone = "https://fcm.googleapis.com/fcm/send/device-1";
    const b = await board((url) => (url === gone ? status : 201));
    await b.device(1);
    const other = await b.device(2);
    b.fail();
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(2);
    expect(readFileSync(b.subscriptionsPath, "utf-8")).not.toContain(gone);

    b.fail();
    await b.push.idle();
    expect(b.sent.calls.slice(2).map((c) => c.url)).toEqual([other.endpoint]);
  });

  test.each<[string, Answer]>([
    ["401", 401], ["403", 403], ["500", 500], ["a timeout", "hang"], ["a thrown error", new Error("socket closed")],
  ])("%s keeps the subscription, still reaches the others, and leaves the job alone", async (_name, answer) => {
    const flaky = "https://fcm.googleapis.com/fcm/send/device-1";
    const b = await board((url) => (url === flaky ? answer : 201));
    await b.device(1);
    await b.device(2);
    b.fail();
    await b.push.idle();
    expect(b.sent.calls).toHaveLength(2);
    expect(readFileSync(b.subscriptionsPath, "utf-8")).toContain(flaky);
    expect(b.store.list()[0]!.state).toBe("failed");
    expect(b.logs.some((l) => l.includes(flaky) || l.includes("device-1"))).toBe(true);
  });

  test("a failed send never puts the payload in the log", async () => {
    const b = await board(() => 500);
    await b.device(1);
    b.fail();
    await b.push.idle();
    expect(b.logs.join("\n")).not.toContain("press Implement again");
  });
});

test("with no subscription file at all, nothing is written and nothing throws", async () => {
  const b = await board();
  b.fail();
  await b.push.idle();
  expect(b.sent.calls).toHaveLength(0);
  expect(existsSync(b.subscriptionsPath)).toBe(false);
});

describe("what a scheduled run's notification says (AC-9)", () => {
  async function scheduledBoard() {
    const tmp = tempDir();
    cleanups.push(tmp.done);
    const sent = fakeFetch();
    let push!: ReturnType<typeof createPush>;
    const store = makeStore(() => push.observe());
    push = createPush({ jobs: () => store.list(), fetch: sent.fetch, scheduleNotify: () => "always" });
    const keys = await deviceKeys();
    const nb = await deviceKeys();
    await push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/en", keys: { p256dh: keys.p256dh, auth: keys.auth }, lang: "en" }, "https://board.test");
    await push.subscribe({ endpoint: "https://fcm.googleapis.com/fcm/send/nb", keys: { p256dh: nb.p256dh, auth: nb.auth }, lang: "nb" }, "https://board.test");
    return { store, push, sent, en: keys, nb };
  }

  const ENDINGS = {
    done: (s: ReturnType<typeof makeStore>, id: string) => s.transition(id, "step-succeeded-last", { results: [result("schedule")] }),
    failed: (s: ReturnType<typeof makeStore>, id: string) => s.transition(id, "step-failed", { results: [result("schedule", "error", false)] }),
    stopped: (s: ReturnType<typeof makeStore>, id: string) => s.transition(id, "run-stopped", { stopReason: "timeout", results: [result("schedule", "timeout", false)] }),
    interrupted: (s: ReturnType<typeof makeStore>, id: string) => s.transition(id, "process-gone", { finishedAt: new Date().toISOString() }),
  };
  const KEYS = { done: "push.scheduleDone", failed: "push.scheduleFailed", stopped: "push.scheduleStopped", interrupted: "push.scheduleInterrupted" } as const;

  for (const ending of Object.keys(ENDINGS) as (keyof typeof ENDINGS)[]) {
    test(`a run that ends ${ending}: the title names project and job, the body is its own sentence, the url is the job's page (AC-9)`, async () => {
      const b = await scheduledBoard();
      ENDINGS[ending](b.store, runningJob(b.store, ["schedule"], "schedule-nightly-report").id);
      await b.push.idle();
      expect(b.sent.calls).toHaveLength(2);
      const forEn = await openCall(b.sent.calls.find((c) => c.url.endsWith("/en"))!, b.en);
      const forNb = await openCall(b.sent.calls.find((c) => c.url.endsWith("/nb"))!, b.nb);
      expect(forEn.title).toBe("aide · nightly-report");
      expect(forEn.url).toBe("/schedule/aide/nightly-report");
      expect(forEn.body).toBe(renderMessage("en", { key: KEYS[ending] }));
      expect(forNb.body).toBe(renderMessage("nb", { key: KEYS[ending] }));
      expect(forNb.body).not.toBe(forEn.body);
      expect(forEn.body).not.toContain("push.schedule");
    });
  }

  test("the four outcomes each have a sentence of their own (AC-9)", () => {
    const bodies = Object.values(KEYS).map((key) => renderMessage("en", { key }));
    expect(new Set(bodies).size).toBe(4);
  });
});
