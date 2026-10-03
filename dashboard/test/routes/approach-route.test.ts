// The Save under a row's approach warning: what it writes into
// 3-solution.md, what it does to a job held for the choice, and what it
// refuses.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { SPEC, savable, specFilePath } from "../spec-page/spec-save-fixtures.ts";
import { queueHarness, statusSaying } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-approach-route-");
afterEach(() => harness.cleanup());

const ROUTE = `/api/queue/specs/aide/${SPEC}/approach`;
const DEFAULTS = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
  modelChoices: { sonnet: {}, fable: {} },
};

const description = (optedIn = true): string =>
  "# Queue - Description\n\n## Tracking info\n\n- **Created:** `2026-10-03 07:00 UTC`\n" +
  `- **Let me choose the approach:** ${optedIn ? "yes" : "no"}\n\n---\n\n## Description\n\nText.\n`;

const SOLUTION =
  "# Queue - Solution\n\n## Approaches\n\n" +
  "**Approach A: Hold it (recommended).** a\n\n" +
  "**Approach B: End it (real alternative).** b\n\n" +
  "**Approach C: Hold all (considered and rejected).** c\n\n" +
  "### Recommended: Approach A\n\nWhy.\n";

type MirrorJob = Record<string, unknown>;
const heldJob = (over: MirrorJob = {}): MirrorJob => ({
  id: "held", project: "aide", specFolder: SPEC, steps: ["analyze", "implement", "archive"], stepIndex: 1,
  state: "queued", model: { analyze: "sonnet", implement: "fable", archive: "sonnet" }, timeoutSec: {},
  permissionMode: {}, effort: {}, createdAt: "2026-10-03T08:00:00.000Z", spentUsd: 0, results: [],
  error: { key: "runner.approachChoice" }, errorReason: "held-back",
  ...over,
});

function startWith(opts: { jobs?: MirrorJob[]; optedIn?: boolean; solution?: string; gitRun?: GitRunner } = {}) {
  const started = harness.start({
    description: description(opts.optedIn),
    status: statusSaying(["create", "analyze"]),
    extra: { gitRun: opts.gitRun ?? savable("/host"), queueDefaults: DEFAULTS } as never,
    ...(opts.jobs ? { queueMirror: JSON.stringify(opts.jobs) } : {}),
  });
  writeFileSync(specFilePath(started.dir, "3-solution.md"), opts.solution ?? SOLUTION);
  return started;
}

const save = (base: string, approach: string) =>
  fetch(`${base}${ROUTE}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ approach }).toString(),
  });

const jobs = async (base: string): Promise<{ id: string; state: string; steps: string[]; model: Record<string, string> }[]> =>
  (await (await fetch(`${base}/api/queue`, { headers: { accept: "application/json" } })).json()).jobs;

const solutionOf = (dir: string): string => readFileSync(specFilePath(dir, "3-solution.md"), "utf-8");

describe("saving the recommended approach", () => {
  test("records it as the chosen approach under Approaches and leaves the held job to carry on (AC-5)", async () => {
    const { base, dir } = startWith({ jobs: [heldJob()] });
    const res = await save(base, "A");
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(solutionOf(dir)).toContain("## Approaches\n\n**Chosen approach:** Approach A\n\n**Approach A:");
    const after = await jobs(base);
    expect(after.map((j) => [j.id, j.state])).toEqual([["held", "queued"]]);
  });
});

describe("saving another approach", () => {
  test("cancels the held job, records the choice, and queues analyze with the held job's later steps and models (AC-6)", async () => {
    const { base, dir } = startWith({ jobs: [heldJob()] });
    const res = await save(base, "B");
    expect(res.status).toBe(200);
    expect(solutionOf(dir)).toContain("**Chosen approach:** Approach B");
    const after = await jobs(base);
    expect(after.find((j) => j.id === "held")?.state).toBe("cancelled");
    const fresh = after.find((j) => j.id !== "held");
    expect(fresh?.state).toBe("queued");
    expect(fresh?.steps).toEqual(["analyze", "implement", "archive"]);
    expect(fresh?.model).toMatchObject({ analyze: "sonnet", implement: "fable", archive: "sonnet" });
  });

  test("with no held job, queues analyze alone (AC-6)", async () => {
    const { base, dir } = startWith();
    expect((await save(base, "B")).status).toBe(200);
    expect(solutionOf(dir)).toContain("**Chosen approach:** Approach B");
    expect((await jobs(base)).map((j) => j.steps)).toEqual([["analyze"]]);
  });
});

describe("a save that is refused writes, cancels and queues nothing", () => {
  test("a letter that is not a real alternative (AC-5, AC-6)", async () => {
    const { base, dir } = startWith({ jobs: [heldJob()] });
    const res = await save(base, "C");
    expect(res.status).toBe(409);
    expect(solutionOf(dir)).toBe(SOLUTION);
    expect((await jobs(base)).map((j) => [j.id, j.state])).toEqual([["held", "queued"]]);
  });

  test("no choice is pending any more (AC-7)", async () => {
    const chosen = SOLUTION.replace("## Approaches\n\n", "## Approaches\n\n**Chosen approach:** Approach A\n\n");
    const { base, dir } = startWith({ solution: chosen });
    expect((await save(base, "B")).status).toBe(409);
    expect(solutionOf(dir)).toBe(chosen);
    expect(await jobs(base)).toEqual([]);
  });

  test("a spec that did not ask to choose (AC-9)", async () => {
    const { base, dir } = startWith({ optedIn: false });
    expect((await save(base, "B")).status).toBe(409);
    expect(solutionOf(dir)).toBe(SOLUTION);
    expect(await jobs(base)).toEqual([]);
  });

  test("a step of the spec is running (AC-5, AC-6)", async () => {
    const { base, dir } = startWith({ jobs: [heldJob({ id: "run", state: "running", stepIndex: 0, error: undefined, errorReason: undefined })] });
    expect((await save(base, "B")).status).toBe(409);
    expect(solutionOf(dir)).toBe(SOLUTION);
    expect((await jobs(base)).map((j) => [j.id, j.state])).toEqual([["run", "running"]]);
  });
});
