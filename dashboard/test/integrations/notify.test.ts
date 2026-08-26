// Criterion 7 (spec 81, slice 81c): the notifier. A job that stops at
// 02:00 — or fails there — must be visible without reading a log.
//
// The contract is claude-usage's, copied deliberately so one wrapper
// script can serve both: an argv array run with NO shell, one line of
// JSON on stdin, spawn-and-forget, SIGTERM at 10 s and SIGKILL a second
// later, and absent entirely unless configured.
import { describe, expect, test } from "bun:test";
import { Notifier, type NotifyEvent, type NotifyChild } from "../../src/integrations/notify.ts";

const EVENT: NotifyEvent = {
  event: "finished",
  project: "aide",
  spec: "81-queue-and-runner",
  step: "analyze",
  jobId: "job-1",
  costUsd: 2.1,
  branchUrl: "https://github.com/ragnarwestad/aide/compare/main...aide/81-queue-and-runner",
  at: "2026-08-16T22:00:00Z",
};

function recorder() {
  const calls: { argv: string[]; line: string }[] = [];
  const killed: string[] = [];
  const child: NotifyChild = { kill: (sig) => void killed.push(sig) };
  return {
    calls,
    killed,
    spawn: (argv: string[], line: string) => {
      calls.push({ argv, line });
      return child;
    },
  };
}

// A schedule that records instead of waiting, so the 10 s contract is
// testable in a millisecond.
function fakeSchedule() {
  const timers: { ms: number; fn: () => void }[] = [];
  return {
    timers,
    schedule: (fn: () => void, ms: number) => {
      timers.push({ ms, fn });
      return timers.length;
    },
    runAll: () => timers.forEach((t) => t.fn()),
  };
}

describe("absent unless configured", () => {
  test("no command → nothing is spawned, and notify() still returns", () => {
    const r = recorder();
    new Notifier({ spawn: r.spawn }).notify(EVENT);
    expect(r.calls.length).toBe(0);
  });

  test("an empty command list is the same as none", () => {
    const r = recorder();
    new Notifier({ command: [], spawn: r.spawn }).notify(EVENT);
    expect(r.calls.length).toBe(0);
  });
});

describe("the contract", () => {
  test("the argv array is passed verbatim — no shell anywhere", () => {
    const r = recorder();
    const command = ["/Users/x/aide-dashboard/notify-slack.sh", "--channel", "aide runs"];
    new Notifier({ command, spawn: r.spawn }).notify(EVENT);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]!.argv).toEqual(command);
  });

  test("the payload is ONE line of JSON on stdin", () => {
    const r = recorder();
    new Notifier({ command: ["notify"], spawn: r.spawn }).notify(EVENT);
    const line = r.calls[0]!.line;
    expect(line.trimEnd()).not.toContain("\n");
    expect(JSON.parse(line)).toEqual(EVENT as unknown as Record<string, unknown>);
  });

  test("a spawn that throws never reaches the caller", () => {
    const notifier = new Notifier({
      command: ["notify"],
      spawn: () => {
        throw new Error("ENOENT");
      },
    });
    expect(() => notifier.notify(EVENT)).not.toThrow();
  });
});

describe("a notification may never outlive the job it reports", () => {
  test("SIGTERM at 10 s, SIGKILL a second later", () => {
    const r = recorder();
    const clock = fakeSchedule();
    new Notifier({ command: ["notify"], spawn: r.spawn, schedule: clock.schedule }).notify(EVENT);
    expect(clock.timers.map((t) => t.ms)).toEqual([10_000, 11_000]);
    clock.runAll();
    expect(r.killed).toEqual(["SIGTERM", "SIGKILL"]);
  });

  test("a wrapper that finishes on its own is never signalled", async () => {
    const clock = fakeSchedule();
    const killed: string[] = [];
    const notifier = new Notifier({
      command: ["notify"],
      spawn: () => ({ kill: (s) => void killed.push(s), exited: Promise.resolve(0) }),
      schedule: clock.schedule,
    });
    notifier.notify(EVENT);
    await Promise.resolve(); // let the exit settle
    await Promise.resolve();
    clock.runAll();
    expect(killed).toEqual([]);
  });
});
