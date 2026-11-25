// Land uses the same live-recorder capacity calculation as Implement.

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { runProjectSuiteBeforePush } from "../../../../src/serve/land-branch/test-gate.ts";
import { gateTemps, git, commitAll } from "./gate-fixtures.ts";

const RESOLVER = join(import.meta.dir, "../../../../../core/scripts/aide-resolve-test-cmd");

const { temp } = gateTemps();

describe("the landing's test run", () => {
  test("shares cores with live test recorders, ignoring AI jobs", async () => {
    const root = temp("aide-gate-workers-");
    mkdirSync(join(root, ".aide"));
    writeFileSync(join(root, ".aide", "project.yaml"), `name: demo\nAIDE_TEST_CMD: printf '%s' "$AIDE_TEST_WORKERS" > "${join(root, "workers.txt")}"\n`);
    writeFileSync(join(root, "app.py"), "print(0)\n");
    commitAll(root, "first");
    git(root, "switch", "-q", "-c", "aide/1-x");
    writeFileSync(join(root, "app.py"), "print(1)\n");
    git(root, "commit", "-qam", "the spec's change");

    const bin = temp("aide-gate-workers-bin-");
    const seen = join(root, "workers.txt");
    process.env.AIDE_RESOLVE_TEST_CMD_BIN = RESOLVER;
    process.env.AIDE_RECORD_TEST_RUN_BIN = join(import.meta.dir, "../../../../../core/scripts/aide-record-test-run");
    process.env.AIDE_TEST_GATE_LOG = join(bin, "gate.log");

    const queueMirrorPath = join(bin, "queue.json");
    writeFileSync(queueMirrorPath, JSON.stringify(Array.from({ length: 10 }, () => ({ state: "running" }))));
    const options = { queueMirrorPath, button: "Archive" };
    const first = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", options);
    expect(first.ok).toBe(true);
    expect(readFileSync(seen, "utf-8").trim()).toBe(String(availableParallelism()));
    const activity = `${queueMirrorPath}.test-runs`;
    writeFileSync(join(activity, `run.${process.pid}`), "");
    const shared = await runProjectSuiteBeforePush(root, { project: "demo", specFolder: "1-x" }, "aide/1-x", options);
    expect(shared.ok).toBe(true);
    expect(readFileSync(seen, "utf-8").trim()).toBe(String(Math.max(1, Math.floor(availableParallelism() / 2))));

  });
});
