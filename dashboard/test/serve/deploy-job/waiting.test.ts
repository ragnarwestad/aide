import { deployUnderWay, type Job } from "../../../src/queue/queue.ts";
// Whether the board's own project has commits on origin that this server
// does not run yet: the header's Deploy mark is shown on that answer.

import { describe, expect, test } from "bun:test";
import { deployWaiting, type DeployWaitingInputs } from "../../../src/serve/deploy-job/waiting.ts";

const inputs = (o: Partial<DeployWaitingInputs> & { ahead?: string } = {}): DeployWaitingInputs => ({
  projects: ["skjer", "aide"],
  projectDir: (p) => `/checkouts/${p}`,
  serving: { sha: "s1", repoRoot: "/checkouts/aide" },
  canDeploy: () => true,
  reachedOrigin: () => true,
  defaultBranch: async () => "main",
  run: async (_dir, args) =>
    args[0] === "rev-list" && args[2] === "s1..refs/remotes/origin/main"
      ? { code: 0, stdout: `${o.ahead ?? "2"}\n`, stderr: "" }
      : { code: 1, stdout: "", stderr: "" },
  ...o,
});

describe("whether the board has something to deploy", () => {
  test("names the board's own project, branch and commit count when origin has new commits (AC-3)", async () => {
    expect(await deployWaiting(inputs())).toEqual({ project: "aide", commits: 2, branch: "main" });
  });

  test("names the project as up to date after origin was reached (AC-4)", async () => {
    expect(await deployWaiting(inputs({ ahead: "0" }))).toEqual({ project: "aide", commits: 0, branch: "main" });
  });

  test("names nothing at zero commits when origin was not reached (AC-5)", async () => {
    expect(await deployWaiting(inputs({ ahead: "0", reachedOrigin: () => false }))).toBeUndefined();
  });

  test("names nothing from an old positive count when origin was not reached (AC-5)", async () => {
    expect(await deployWaiting(inputs({ ahead: "2", reachedOrigin: () => false }))).toBeUndefined();
  });

  test("names nothing where Deploy is not offered: no install command", async () => {
    expect(await deployWaiting(inputs({ canDeploy: () => false }))).toBeUndefined();
  });

  test("names nothing when no project is the one the server runs from", async () => {
    expect(await deployWaiting(inputs({ serving: { sha: "s1", repoRoot: "/elsewhere" } }))).toBeUndefined();
  });

  test("names nothing when git cannot answer (AC-5)", async () => {
    expect(await deployWaiting(inputs({ run: async () => ({ code: 128, stdout: "", stderr: "bad" }) }))).toBeUndefined();
    expect(await deployWaiting(inputs({ serving: { sha: null, repoRoot: "/checkouts/aide" } }))).toBeUndefined();
  });
});

test("only queued and running deploys for this project disable its start controls", () => {
  for (const state of ["queued", "running", "done", "failed", "cancelled", "stopped"] as const) {
    const jobs = [{ id: "d", project: "aide", specFolder: "deploy", steps: ["deploy"], stepIndex: 0, state }] as Job[];
    expect(deployUnderWay(jobs, "aide")).toBe(state === "queued" || state === "running" ? state : undefined);
    expect(deployUnderWay(jobs, "other")).toBeUndefined();
  }
});
