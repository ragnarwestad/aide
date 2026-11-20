import { describe, expect, test } from "bun:test";
import { getJobMessage } from "../../../src/messages/jobs/get.ts";
import { t } from "../../../src/i18n/index.ts";
import { formatSentence } from "../../../src/messages/format.ts";
import type { QueueRowView } from "../../../src/render/ui/job-state/types.ts";

type J = QueueRowView;
const job = (over: Partial<J> = {}): J => ({
  id: "j", project: "aide", specFolder: "81-queue", steps: ["analyze"], stepIndex: 0,
  state: "queued", spentUsd: 0, timeoutSec: 600, createdAt: "2026-10-01T10:00:00Z", ...over,
});
const sched = (over: Partial<J> = {}): J => job({ specFolder: "schedule-nightly", steps: ["schedule"], ...over });

describe("the line under a job row's state", () => {
  type Msg = Partial<J> & { error?: unknown; errorReason?: string };
  const schedule = (o: Msg = {}): J => sched(o as Partial<J>);
  const close = (o: Msg = {}): J => job({ steps: ["close"], ...o } as Partial<J>);
  const reopen = (o: Msg = {}): J => job({ steps: ["reopen"], ...o } as Partial<J>);
  const deploy = (o: Msg = {}): J => job({ specFolder: "deploy", steps: ["deploy"], ...o } as Partial<J>);
  const kinds: [string, (o?: Msg) => J][] = [["scheduled job", schedule], ["Close", close], ["Reopen", reopen], ["Deploy", deploy]];
  const said = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
  const sentenceOf = formatSentence("en", said) as string;
  const message = (row: J) => getJobMessage(row as never, "en");

  test("a failed job of any kind says why, in its own sentence, red", () => {
    for (const [, make] of [...kinds, ["spec step", job] as const]) {
      const row = make({ id: "f1", state: "failed", error: said });
      expect(message(row)).toEqual({ variant: "failed", text: sentenceOf });
    }
  });

  test("a waiting job says why in amber", () => {
    expect(message(schedule({ id: "w1", state: "waiting", error: said }))).toEqual({ variant: "waiting", text: sentenceOf });
  });

  test("with no sentence of its own, a failed or waiting job says how it ended", () => {
    const ended = [
      ["failed", "jobs.endedFailed"],
      ["waiting", "jobs.endedWaiting"],
    ] as const;
    for (const [state, key] of ended) {
      for (const [, make] of kinds) {
        const m = message(make({ id: "e1", state }));
        expect(m?.text).toBe(t("en", key));
      }
    }
    expect(message(schedule({ state: "failed" }))?.text).not.toBe(message(schedule({ state: "waiting" }))?.text);
  });

  test("the sentence it falls back on is the reader's language", () => {
    const m = getJobMessage(schedule({ state: "failed" }) as never, "nb");
    expect(m?.text).toBe(t("nb", "jobs.endedFailed"));
  });

  test("queued and running jobs without a hold have no notice", () => {
    for (const make of [schedule, close, reopen]) {
      expect(message(make({ state: "running", error: said }))).toBeUndefined();
      expect(message(make({ state: "queued" }))).toBeUndefined();
    }
  });

  test("a cancelled job has no line: a person ended it", () => {
    for (const make of [schedule, close, reopen]) expect(message(make({ state: "cancelled", error: said }))).toBeUndefined();
  });

  test("a deploy held back for a landing says so in the info colour", () => {
    const error = { key: "runner.landingPause" } as const;
    for (const state of ["queued", "running"] as const) {
      const m = message(deploy({ state, errorReason: "held-back", error }));
      expect(m).toEqual({ variant: "info", text: formatSentence("en", error) as string });
    }
  });

  test("a deploy held back for a hold that does not clear on its own is amber", () => {
    const error = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
    const m = message(deploy({ state: "queued", errorReason: "held-back", error }));
    expect(m?.variant).toBe("waiting");
  });

  test("a held-back job shows its reason instead of its provider", () => {
    const error = { key: "runner.scheduleWaitsOnJob", values: { doing: "implement", spec: "aide:756" } } as const;
    const notice = getJobMessage({
      id: "held", state: "queued", steps: ["schedule"], stepIndex: 0,
      errorReason: "held-back", error, provider: "Claude-Capra",
    } as never, "en");
    expect(notice).toEqual({ variant: "info", text: formatSentence("en", error)! });
  });


  describe("the AI a step runs on", () => {
    const onWork = [
      { step: "analyze", ok: true },
      { step: "implement", ok: true, provider: { key: "Work", name: "Work" } },
    ];

    test("a job never says which AI its step runs or ran on: its phase line does", () => {
      for (const make of [schedule, close, reopen, (o?: Msg) => job(o as Partial<J>)]) {
        expect(message(make({ state: "running", provider: "Work", steps: ["implement"] } as Msg))).toBeUndefined();
        expect(message(make({ state: "done", results: onWork } as Msg))).toBeUndefined();
        expect(message(make({ state: "cancelled", provider: "Work", results: onWork } as Msg))).toBeUndefined();
      }
      const failed = job({ id: "f2", state: "failed", error: said, results: onWork } as never);
      expect(message(failed)).toEqual({ variant: "failed", text: sentenceOf });
    });

    test("a job stopped on a usage limit keeps the usage-limit sentence alone, which names the provider once (AC-10)", () => {
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const row = job({
        id: "u1", state: "waiting", steps: ["implement"], stopReason: "provider-limit", provider: "Work",
        usageLimitWait: { until, resetKnown: true },
        results: [{ step: "implement", ok: false, provider: { key: "Work", name: "Work" }, providerLimit: { tool: "claude", window: "five-hour" } }],
      } as never);
      const m = message(row);
      expect(m?.text.split("Work").length).toBe(2);
      expect(m?.variant).toBe("info");
    });
  });
});

test("a declined step retains the named action even with a queue position (AC-4)", () => {
  for (const terminalReason of ["acceptance-criteria-unticked", "approach-choice"]) {
    const row = job({ state: "done", queuePosition: { n: 1, total: 1, id: "job:one" },
      results: [{ step: "archive", ok: true, costUsd: 0, terminalReason }] });
    const key = terminalReason === "approach-choice" ? "runner.approachChoice" : "wordPhase.stopAcceptanceCriteriaUnticked";
    expect(getJobMessage(row, "en")).toEqual({ variant: "waiting", text: formatSentence("en", { key })! });
  }
});
