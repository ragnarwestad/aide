// The board runs a landing the last process never finished when it comes
// back: `serve.ts` calls it once, after resolving the jobs left running.
// The rule itself is proven in `test/queue/runner/cut-landing.test.ts`;
// this is the one check that the boot reaches it.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { queueHarness } from "../../../helpers/queue-server.ts";

const harness = queueHarness("aide-cut-landing-boot-");
const dirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

test("a job read back with its analyze's landing in flight has that landing run at boot", async () => {
  const results = mkdtempSync(join(tmpdir(), "aide-cut-landing-results-"));
  dirs.push(results);
  const resultFile = join(results, "j1.json");
  writeFileSync(resultFile, JSON.stringify({
    ok: true, exitCode: 0, terminalReason: "completed", repos: [], branch: "aide/81-queue-and-runner",
    // A root of the test's own: the landing works in it, and the fake git sees where.
    branchUrls: [{ root: results, url: "https://example.invalid/compare" }],
  }));
  const job = {
    id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
    state: "done", model: {}, timeoutSec: {}, permissionMode: {}, effort: {},
    createdAt: "2026-09-27T08:00:00.000Z", finishedAt: "2026-09-27T08:10:00.000Z", spentUsd: 0,
    landing: true, resultFile,
    results: [{ step: "analyze", ok: true, costUsd: 0, tool: "claude", startedAt: "2026-09-27T08:00:01.000Z" }],
  };
  const calls: string[] = [];
  const gitRun = async (dir: string, args: string[]) => {
    // Compared by name: the landing resolves the path, and macOS's temp dir is a link.
    if (dir.endsWith(basename(results))) calls.push(args.join(" "));
    return { code: 1, stdout: "" };
  };
  harness.start({ queueMirror: JSON.stringify([job]), extra: { gitRun, queueRunnerBin: "/usr/bin/true", queueResultDir: results } });
  const deadline = Date.now() + 2000;
  while (calls.length === 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
  // The landing got as far as asking git about the step's own root.
  expect(calls.length).toBeGreaterThan(0);
}, 15_000);
