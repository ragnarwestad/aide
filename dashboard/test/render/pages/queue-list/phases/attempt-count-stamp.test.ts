// Spec 341: a phase's own file remembers how many times it ran, past
// both the two-hundred-deep queue's bounded memory and archiving —
// `2-analysis.md`, "Findings" names the two gaps this file closes.
//
// The queue's own `p.attempts.length` and the file's stamped
// `p.attemptCount` are never simply one-or-the-other the way
// `timeSpentMs`/`cost`/`tokens` are: the display line takes the LARGER
// of the two (`phase-rows.ts`), since a running attempt not yet stamped
// into the file can make the queue's own count the bigger of the two
// even while the file also has something to say.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderQueueRows,
  type ArchivedSpecView,
  type QueueRowView,
  type QueueTarget,
} from "../../../../../src/render.ts";

const NOW = "2026-09-02T12:00:00Z";

const subRow = (html: string, step: string): string =>
  html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0] ?? "";

const job = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
  id,
  project: "aide",
  specFolder: "aa-spec",
  steps: ["analyze"],
  stepIndex: 0,
  state: "done",
  spentUsd: 0,
  timeoutSec: 1200,
  createdAt: "2026-09-02T08:00:00Z",
  ...extra,
});

describe("a phase's attempt count outlives the queue's memory (spec 341)", () => {
  test("an archived phase with a stamped Attempts count of 3 and no queue jobs at all shows 3 attempts (REQ-2, REQ-3)", () => {
    const archived: ArchivedSpecView = {
      project: "aide",
      folder: "aa-spec",
      archivedAt: "2026-09-02T09:00:00Z",
      done: ["create", "analyze", "implement", "archive"],
      models: {},
      phaseOutcomes: { analyze: { attempts: 3 } },
    };
    const html = renderQueueRows([], {
      runnerAvailable: true,
      targets: [],
      archivedSpecs: [archived],
      filter: { open: "aide/aa-spec" },
    });
    expect(subRow(html, "analyze")).toContain("3 attempts");
  });

  test("a phase run exactly once shows nothing, stamp included (REQ-5)", () => {
    const html = renderQueueRows(
      [
        job("a1", {
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-09-02T09:05:00Z" }],
        }),
      ],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec", done: ["analyze"] }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse(NOW),
    );
    expect(subRow(html, "analyze")).not.toContain("attempts");
  });

  test("the queue's own count wins while an attempt is still in flight, not yet stamped", () => {
    const html = renderQueueRows(
      [
        job("a1", {
          state: "failed",
          error: "boom",
          results: [{ step: "analyze", ok: false, costUsd: 1, at: "2026-09-02T09:05:00Z" }],
        }),
        job("a2", {
          state: "failed",
          error: "boom again",
          results: [{ step: "analyze", ok: false, costUsd: 1, at: "2026-09-02T10:05:00Z" }],
        }),
        job("a3", { state: "running", startedAt: "2026-09-02T11:00:00Z" }),
      ],
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec" }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse(NOW),
    );
    expect(subRow(html, "analyze")).toContain("3 attempts");
  });

  describe("the file's stamp wins once the queue has forgotten the earliest attempts (REQ-4, REQ-6)", () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), "aide-attempt-count-"));
      writeFileSync(
        join(dir, "2-analysis.md"),
        [
          "# 341 - Analysis",
          "",
          "## Tracking info",
          "",
          "- **Attempts:** 3",
          "",
          "## Findings",
          "",
        ].join("\n"),
      );
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test("shows 3 attempts, not 2, when the queue only remembers 2 of the 3 real attempts", () => {
      const target: QueueTarget = { project: "aide", specFolder: "aa-spec", dir };
      const html = renderQueueRows(
        [
          job("a1", {
            state: "failed",
            error: "boom",
            results: [{ step: "analyze", ok: false, costUsd: 1, at: "2026-09-02T09:05:00Z" }],
          }),
          job("a2", {
            results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-09-02T10:05:00Z" }],
          }),
        ],
        { runnerAvailable: true, targets: [target], filter: { open: "aide/aa-spec" } },
        Date.parse(NOW),
      );
      expect(subRow(html, "analyze")).toContain("3 attempts");
      expect(subRow(html, "analyze")).not.toContain("2 attempts");
    });
  });
});
