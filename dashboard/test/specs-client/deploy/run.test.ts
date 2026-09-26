// The Deploy button's sequence (`specs-client/deploy/run.ts`), driven
// with fake effects and no timers: the order of the calls, what each
// answer does to the lines, the finish and a failure at each step.

import { describe, expect, test } from "bun:test";
import {
  FINISHED_STAYS_MS,
  PROBES,
  runDeploy,
  STEPS,
  type DeployIo,
  type DeployStep,
  type PostedStep,
  type StepAnswer,
  type StepState,
} from "../../../src/specs-client/deploy/run.ts";

interface Fakes {
  log: string[];
  states: Record<DeployStep, StepState>;
  /** Every state after each transition, to read the invariants off. */
  history: Record<DeployStep, StepState>[];
  failures: { step: DeployStep; error: string; faulty: boolean; silent: boolean }[];
}

/** `answers` per posted step (default ok); `probes` what each probe of
 *  `/api/version` does, the last one repeated — a string is a
 *  `startedAt`, `null` a probe that throws. */
function harness(
  answers: Partial<Record<PostedStep, StepAnswer>> = {},
  probes: (string | null)[] = ["new"],
) {
  const fakes: Fakes = {
    log: [],
    states: { fetch: "waiting", install: "waiting", restart: "waiting", wait: "waiting", check: "waiting" },
    history: [],
    failures: [],
  };
  let probed = 0;
  const io: DeployIo = {
    post: async (step) => {
      fakes.log.push(step);
      return answers[step] ?? (step === "restart" ? { ok: true, restart: "fired", startedAt: "old" } : { ok: true });
    },
    version: async () => {
      fakes.log.push("probe");
      const next = probes[Math.min(probed++, probes.length - 1)];
      if (next === null) throw new Error("down");
      return { startedAt: next };
    },
    sleep: async (ms) => void fakes.log.push(`sleep ${ms}`),
    reload: () => void fakes.log.push("reload"),
  };
  const ui = {
    state: (step: DeployStep, state: StepState) => {
      fakes.states[step] = state;
      fakes.history.push({ ...fakes.states });
    },
    fail: (step: DeployStep, f: { error: string; faulty: boolean; silent: boolean }) => {
      fakes.states[step] = "failed";
      fakes.history.push({ ...fakes.states });
      fakes.failures.push({ step, ...f });
    },
    finished: () => void fakes.log.push("finished"),
    close: () => void fakes.log.push("close"),
  };
  return { fakes, io, ui };
}

const posts = (log: string[]): string[] => log.filter((e) => !e.startsWith("sleep"));

describe("runDeploy", () => {
  test("posts fetch, install, restart, probes the version, then posts check (AC-2)", async () => {
    const { fakes, io, ui } = harness();
    await runDeploy(io, ui);
    expect(posts(fakes.log).slice(0, 5)).toEqual(["fetch", "install", "restart", "probe", "check"]);
  });

  test("a restart held back ends the run at once: no wait, no check, no finished message (AC-2)", async () => {
    const { fakes, io, ui } = harness({ restart: { ok: true, restart: "held" } });
    await runDeploy(io, ui);
    expect(fakes.log).toEqual(["fetch", "install", "restart", "close", "reload"]);
  });

  test("nothing to restart with ends the run the same way", async () => {
    const { fakes, io, ui } = harness({ restart: { ok: true, restart: "none", faulty: true } });
    await runDeploy(io, ui);
    expect(fakes.log).toEqual(["fetch", "install", "restart", "close", "reload"]);
  });

  test("the old process still answering does not end the wait; check runs on the first new one (AC-2, AC-7)", async () => {
    const { fakes, io, ui } = harness({}, ["old", "old", "new"]);
    await runDeploy(io, ui);
    expect(posts(fakes.log).filter((e) => e === "probe").length).toBe(3);
    expect(posts(fakes.log).indexOf("check")).toBeGreaterThan(posts(fakes.log).lastIndexOf("probe"));
  });

  test("a wait that runs out with the old process still answering calls check against it (AC-2, AC-7)", async () => {
    const { fakes, io, ui } = harness({}, ["old"]);
    await runDeploy(io, ui);
    expect(fakes.log.filter((e) => e === "probe").length).toBe(PROBES);
    expect(fakes.log).toContain("check");
    expect(fakes.failures).toEqual([]);
  });

  test("every line is in exactly one state, at most one runs, and the ones before it are done (AC-3)", async () => {
    const { fakes, io, ui } = harness({}, [null, "new"]);
    await runDeploy(io, ui);
    for (const snapshot of fakes.history) {
      const at = STEPS.map((s) => snapshot[s]);
      expect(at.filter((s) => s === "running").length).toBeLessThanOrEqual(1);
      const running = at.indexOf("running");
      if (running >= 0) {
        expect(at.slice(0, running).every((s) => s === "done")).toBe(true);
        expect(at.slice(running + 1).every((s) => s === "waiting")).toBe(true);
      }
    }
    expect(STEPS.map((s) => fakes.states[s])).toEqual(["done", "done", "done", "done", "done"]);
  });

  test("says finished, waits two seconds, closes, and only then reloads (AC-4)", async () => {
    const { fakes, io, ui } = harness();
    await runDeploy(io, ui);
    expect(FINISHED_STAYS_MS).toBe(2000);
    expect(fakes.log.slice(-4)).toEqual(["finished", "sleep 2000", "close", "reload"]);
  });

  for (const step of ["fetch", "install", "restart", "check"] as const) {
    test(`a failed ${step} is shown for two seconds, then the dialog closes; later lines wait, no reload (AC-5)`, async () => {
      const { fakes, io, ui } = harness({ [step]: { ok: false, error: "it broke", faulty: step === "check" } });
      await runDeploy(io, ui);
      const at = STEPS.indexOf(step);
      const after: StepState[] = STEPS.slice(at + 1).map(() => "waiting");
      expect(STEPS.map((s) => fakes.states[s]).slice(at)).toEqual(["failed", ...after]);
      expect(fakes.failures).toEqual([{ step, error: "it broke", faulty: step === "check", silent: false }]);
      expect(fakes.log.slice(-2)).toEqual(["sleep 2000", "close"]);
      expect(fakes.log).not.toContain("reload");
      expect(fakes.log).not.toContain("finished");
    });
  }

  test("a wait in which no probe ever answered fails the wait as silent, pauses, closes, and check is never called (AC-5)", async () => {
    const { fakes, io, ui } = harness({}, [null]);
    await runDeploy(io, ui);
    expect(fakes.failures).toEqual([{ step: "wait", error: "", faulty: false, silent: true }]);
    expect(fakes.states.check).toBe("waiting");
    expect(fakes.log).not.toContain("check");
    expect(fakes.log.slice(-2)).toEqual(["sleep 2000", "close"]);
  });

  test("a request that throws fails its step like an error answer (AC-5)", async () => {
    const { fakes, io, ui } = harness();
    io.post = async (step) => {
      if (step === "install") throw new Error("network");
      return { ok: true, restart: "fired", startedAt: "old" };
    };
    await runDeploy(io, ui);
    expect(fakes.failures.map((f) => f.step)).toEqual(["install"]);
    expect(fakes.states.restart).toBe("waiting");
    expect(fakes.log.slice(-2)).toEqual(["sleep 2000", "close"]);
  });
});
