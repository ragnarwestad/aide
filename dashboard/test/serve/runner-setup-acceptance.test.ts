// Spec 394 (REQ-8): `analyze`'s own invocation reads the spec's
// RECORDED acceptance choice fresh off disk at spawn time, rather than
// the job's own (now `create`-only) field — so a second job queued
// later for the same spec, with no checkbox of its own to tick, still
// reflects what was decided at creation.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceNotRequiredForAnalyze, forgetSpecCachesFor, stepDoneHandler } from "../../src/serve/runner-setup.ts";
import type { Job } from "../../src/queue/queue.ts";

const job = (over: Partial<Job> = {}): Job =>
  ({
    project: "aide",
    specFolder: "81-queue-and-runner",
    ...over,
  }) as Job;

describe("acceptanceNotRequiredForAnalyze", () => {
  test("true when the spec's own 1-description.md carries the line", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-runner-setup-"));
    try {
      const dir = join(root, "81-queue-and-runner");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "1-description.md"),
        "# X\n\n## Tracking info\n\n- **Created:** `2026-08-19`\n- **Acceptance:** not required\n",
      );
      const ctx = {
        specDir: (_project: string, folder: string) => folder,
        peekMachinerySpecDir: (_project: string, found: string) => join(root, found),
      };
      expect(acceptanceNotRequiredForAnalyze(ctx, job())).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("false when the file carries no such line", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-runner-setup-"));
    try {
      const dir = join(root, "81-queue-and-runner");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "1-description.md"), "# X\n\n## Tracking info\n\n- **Created:** `2026-08-19`\n");
      const ctx = {
        specDir: (_project: string, folder: string) => folder,
        peekMachinerySpecDir: (_project: string, found: string) => join(root, found),
      };
      expect(acceptanceNotRequiredForAnalyze(ctx, job())).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("false, never a throw, when the spec cannot be resolved at all", () => {
    const ctx = {
      specDir: () => undefined,
      peekMachinerySpecDir: (_project: string, found: string) => found,
    };
    expect(acceptanceNotRequiredForAnalyze(ctx, job())).toBe(false);
  });
});

describe("forgetSpecCachesFor", () => {
  test("names the spec's machinery dir and folder", () => {
    const forgotten: [string, string][] = [];
    const ctx = {
      specDir: (_project: string, folder: string) => folder,
      peekMachinerySpecDir: (_project: string, found: string) => `/machinery/${found}`,
      forgetSpecCaches: (dir: string, folder: string) => void forgotten.push([dir, folder]),
    };
    forgetSpecCachesFor(ctx, job());
    expect(forgotten).toEqual([["/machinery/81-queue-and-runner", "81-queue-and-runner"]]);
  });

  test("a spec no scan knows forgets nothing", () => {
    const forgotten: [string, string][] = [];
    const ctx = {
      specDir: () => undefined,
      peekMachinerySpecDir: (_p: string, found: string) => found,
      forgetSpecCaches: (dir: string, folder: string) => void forgotten.push([dir, folder]),
    };
    forgetSpecCachesFor(ctx, job());
    expect(forgotten).toEqual([]);
  });
});

// A step with no landing leaves the spec's cached answers as they were
// before it ran until the schedule's next pass — up to half a minute of
// the row saying nothing reached the files. The handler reads them
// again itself for such a step, and leaves it to the landing otherwise.
describe("stepDoneHandler", () => {
  const harness = () => {
    const calls: string[] = [];
    const ctx = {
      specDir: (_project: string, folder: string) => folder,
      peekMachinerySpecDir: (_project: string, found: string) => `/machinery/${found}`,
      machineryProjectDir: () => "/machinery",
      forgetSpecCaches: (dir: string) => void calls.push(`forget ${dir}`),
      rereadSpecCaches: (dir: string) => void calls.push(`reread ${dir}`),
      landStepBranch: () => {
        calls.push("land");
        return Promise.resolve();
      },
      store: { forgetPendingSteps: () => {} },
    };
    return { calls, handle: stepDoneHandler(ctx as unknown as Parameters<typeof stepDoneHandler>[0]) };
  };

  test("an implement that finished is read again at once", () => {
    const { calls, handle } = harness();
    expect(handle(job() as never, "implement", { ok: true, terminalReason: "completed" })).toBeUndefined();
    expect(calls).toEqual(["forget /machinery/81-queue-and-runner", "reread /machinery/81-queue-and-runner"]);
  });

  test("a step that failed is read again too", () => {
    const { calls, handle } = harness();
    handle(job() as never, "analyze", { ok: false, terminalReason: "cli-error" });
    expect(calls).toContain("reread /machinery/81-queue-and-runner");
  });

  test("an analyze that lands leaves the reading to its landing", () => {
    const { calls, handle } = harness();
    expect(handle(job() as never, "analyze", { ok: true, terminalReason: "completed" })).toBeInstanceOf(Promise);
    expect(calls).toEqual(["forget /machinery/81-queue-and-runner", "land"]);
  });
});
