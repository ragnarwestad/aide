// Spec 394 (REQ-8): `analyze`'s own invocation reads the spec's
// RECORDED acceptance choice fresh off disk at spawn time, rather than
// the job's own (now `create`-only) field — so a second job queued
// later for the same spec, with no checkbox of its own to tick, still
// reflects what was decided at creation.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptanceNotRequiredForAnalyze } from "../../src/serve/runner-setup.ts";
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
