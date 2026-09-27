import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type QueueDefaults } from "../../../src/queue/queue.ts";
import { analysisSessionToResume } from "../../../src/serve/serve-helpers/runner-argv.ts";

const DEFAULTS: QueueDefaults = { timeoutSec: { default: 1200 }, permissionMode: {}, model: {} };
const resolve = () => ({ specFolders: ["544-model-ids"] });

let dir: string;
let mirrorPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
  mirrorPath = join(dir, "queue.json");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A job mirrored while its analysis's landing was still in flight: the
 *  result has no `at`, and the job carries `landing`. */
function mirrorWithLandingInFlight(extra: Record<string, unknown> = {}): void {
  const job = {
    id: "j1",
    project: "aide",
    specFolder: "544-model-ids",
    steps: ["create", "analyze"],
    stepIndex: 1,
    state: "done",
    model: {},
    timeoutSec: {},
    permissionMode: {},
    effort: {},
    createdAt: "2026-09-26T18:40:50.000Z",
    spentUsd: 0,
    landing: true,
    results: [
      { step: "create", ok: true, costUsd: 0, tool: "claude", at: "2026-09-26T18:41:45.000Z" },
      { step: "analyze", ok: true, costUsd: 0, tool: "claude", sessionId: "s-analyze", startedAt: "2026-09-26T18:41:49.000Z" },
    ],
    ...extra,
  };
  writeFileSync(mirrorPath, JSON.stringify([job]));
}

describe("a step whose landing was in flight when the board stopped", () => {
  test("ends when its job did", () => {
    mirrorWithLandingInFlight({ finishedAt: "2026-09-26T19:09:06.000Z" });
    const job = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get("j1")!;
    expect(job.results.map((r) => r.at)).toEqual(["2026-09-26T18:41:45.000Z", "2026-09-26T19:09:06.000Z"]);
  });

  test("its implement continues the analysis's session", () => {
    mirrorWithLandingInFlight({ finishedAt: "2026-09-26T19:09:06.000Z" });
    const store = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve });
    const implement = { ...store.get("j1")!, id: "j2", steps: ["implement" as const], results: [] };
    expect(analysisSessionToResume(implement, store.list(), "claude", Date.parse("2026-09-26T19:12:47.000Z"))).toBe(
      "s-analyze",
    );
  });

  test("ends at the boot that reads it back when the job had not finished", () => {
    mirrorWithLandingInFlight({ state: "running" });
    const before = new Date().toISOString();
    const at = new QueueStore({ mirrorPath, defaults: DEFAULTS, resolve }).get("j1")!.results[1].at!;
    expect(at >= before).toBe(true);
  });
});
