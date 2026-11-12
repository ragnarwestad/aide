import { describe, expect, test } from "bun:test";
import { getJobMessage } from "../../../src/messages/jobs/get.ts";
import { t } from "../../../src/i18n/index.ts";
import { formatSentence } from "../../../src/messages/format.ts";
import { stepLabel } from "../../../src/format/step-label.ts";
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

  test("a failed schedule's message has no dismiss action", () => {
    const m = message(schedule({ id: "failed-schedule", specFolder: "schedule-nightly", state: "failed" }));
    expect((m as { dismiss?: string })?.dismiss).toBeUndefined();
  });

  test("a failed job of any kind says why, in its own sentence, red, with its log's address", () => {
    for (const [, make] of kinds) {
      const row = make({ id: "f1", state: "failed", error: said });
      expect(message(row)).toEqual({ variant: "failed", text: sentenceOf, log: "/jobs/f1?tab=steps" });
    }
  });

  test("a stopped job says why in amber, an interrupted one in red, each with the log's address", () => {
    expect(message(schedule({ id: "s1", state: "stopped", error: said }))).toEqual({
      variant: "waiting", text: sentenceOf, log: "/jobs/s1?tab=steps",
    });
    expect(message(schedule({ id: "i1", state: "interrupted", error: said }))).toEqual({
      variant: "failed", text: sentenceOf, log: "/jobs/i1?tab=steps",
    });
  });

  test("with no sentence of its own, a failed, stopped or interrupted job says how it ended", () => {
    const ended = [
      ["failed", "jobs.endedFailed"],
      ["stopped", "jobs.endedStopped"],
      ["interrupted", "jobs.endedInterrupted"],
    ] as const;
    for (const [state, key] of ended) {
      for (const [, make] of kinds) {
        const m = message(make({ id: "e1", state }));
        expect(m?.text).toBe(t("en", key));
        expect(m?.log).toBe("/jobs/e1?tab=steps");
      }
    }
    expect(message(schedule({ state: "failed" }))?.text).not.toBe(message(schedule({ state: "stopped" }))?.text);
  });

  test("the sentence it falls back on is the reader's language", () => {
    const m = getJobMessage(schedule({ state: "failed" }) as never, "nb");
    expect(m?.text).toBe(t("nb", "jobs.endedFailed"));
  });

  test("a queued or running job, or a done one landing, offers no log, with or without a sentence", () => {
    for (const [, make] of kinds) {
      for (const row of [make({ state: "queued" }), make({ state: "running" }), make({ state: "done", landing: true })]) {
        expect(message(row)?.log).toBeUndefined();
        expect(message({ ...row, error: said } as J)?.log).toBeUndefined();
      }
    }
    for (const make of [schedule, close, reopen]) {
      expect(message(make({ state: "running", error: said }))).toBeUndefined();
      expect(message(make({ state: "queued" }))).toBeUndefined();
    }
  });

  test("a cancelled job has no line: a person ended it", () => {
    for (const make of [schedule, close, reopen]) expect(message(make({ state: "cancelled", error: said }))).toBeUndefined();
  });

  test("a deploy held back for a landing says so in the info colour, with no log", () => {
    const error = { key: "runner.landingPause" } as const;
    for (const state of ["queued", "running"] as const) {
      const m = message(deploy({ state, errorReason: "held-back", error }));
      expect(m).toEqual({ variant: "info", text: formatSentence("en", error) as string });
    }
  });

  test("a deploy held back for a hold that does not clear on its own is amber, with no log", () => {
    const error = { key: "landing.deployServiceOlder", values: { served: "9999999", head: "abc1234" } } as const;
    const m = message(deploy({ state: "queued", errorReason: "held-back", error }));
    expect(m?.variant).toBe("waiting");
    expect(m?.log).toBeUndefined();
  });

  test("a held-back job shows its reason instead of its provider", () => {
    const error = { key: "runner.scheduleWaitsOnJob", values: { doing: "implement", spec: "aide:756" } } as const;
    const notice = getJobMessage({
      id: "held", state: "queued", steps: ["schedule"], stepIndex: 0,
      errorReason: "held-back", error, provider: "Claude-Capra",
    } as never, "en");
    expect(notice).toEqual({ variant: "info", text: formatSentence("en", error)! });
  });


  describe("the provider a step ran on", () => {
    const ranOn = (step: string, who: string): string =>
      t("en", "notice.providerRan", { step: stepLabel(step, "en"), who });
    const onWork = [
      { step: "analyze", ok: true },
      { step: "implement", ok: true, provider: { key: "Work", name: "Work" } },
    ];

    test("a done job whose newest result ran on a provider says so in the info colour, with no log (AC-10)", () => {
      expect(message(schedule({ state: "done", results: onWork } as never))).toEqual({ variant: "info", text: ranOn("implement", "Work") });
    });

    test("a failed job names the provider after its own sentence and keeps its log (AC-10)", () => {
      const row = schedule({ id: "f2", state: "failed", error: said, results: onWork } as never);
      expect(message(row)).toEqual({
        variant: "failed", text: `${sentenceOf}\n${ranOn("implement", "Work")}`, log: "/jobs/f2?tab=steps",
      });
    });

    test("a cancelled job names no ran-on sentence, since no step ran on a provider (AC-10)", () => {
      const row = schedule({ state: "cancelled", provider: "Work", results: [{ step: "analyze", ok: true }] } as never);
      expect(message(row)).toBeUndefined();
    });

    test("a done job whose steps ran on no provider names none (AC-10)", () => {
      expect(message(schedule({ state: "done", results: [{ step: "implement", ok: true }] } as never))).toBeUndefined();
    });

    test("a job stopped on a usage limit keeps the usage-limit sentence alone, which names the provider once (AC-10)", () => {
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const row = schedule({
        id: "u1", state: "stopped", stopReason: "provider-limit", provider: "Work",
        usageLimitWait: { until, resetKnown: true },
        results: [{ step: "implement", ok: false, provider: { key: "Work", name: "Work" }, providerLimit: { tool: "claude", window: "five-hour" } }],
      } as never);
      const m = message(row);
      expect(m?.text.split("Work").length).toBe(2);
      expect(m?.text).not.toContain(ranOn("implement", "Work"));
      expect(m?.variant).toBe("info");
      expect(m?.log).toBeUndefined();
    });
  });
});

test("running schedules show no provider caption", () => {
  const row = { id: "j", state: "running", steps: ["schedule"], stepIndex: 0, provider: "Work" };
  expect(getJobMessage(row as never, "en")).toBeUndefined();
  expect(getJobMessage({ ...row, steps: ["implement"] } as never, "en")?.variant).toBe("info");
});
