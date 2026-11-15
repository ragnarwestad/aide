// Whether the board's own project has commits on origin that this server
// does not run yet: the header's Deploy mark is shown on that answer.

import { describe, expect, test } from "bun:test";
import { deployWaiting, type DeployWaitingInputs } from "../../../src/serve/deploy-job/waiting.ts";

const inputs = (o: Partial<DeployWaitingInputs> & { ahead?: string } = {}): DeployWaitingInputs => ({
  projects: ["skjer", "aide"],
  projectDir: (p) => `/checkouts/${p}`,
  serving: { sha: "s1", repoRoot: "/checkouts/aide" },
  canDeploy: () => true,
  defaultBranch: async () => "main",
  run: async (_dir, args) =>
    args[0] === "rev-list" && args[2] === "s1..refs/remotes/origin/main"
      ? { code: 0, stdout: `${o.ahead ?? "2"}\n`, stderr: "" }
      : { code: 1, stdout: "", stderr: "" },
  ...o,
});

describe("whether the board has something to deploy", () => {
  test("names the board's own project and the commit count when origin's default branch has commits the server does not run", async () => {
    expect(await deployWaiting(inputs())).toEqual({ project: "aide", commits: 2 });
  });

  test("names nothing when the server runs what origin has", async () => {
    expect(await deployWaiting(inputs({ ahead: "0" }))).toBeUndefined();
  });

  test("names nothing where Deploy is not offered: no install command", async () => {
    expect(await deployWaiting(inputs({ canDeploy: () => false }))).toBeUndefined();
  });

  test("names nothing when no project is the one the server runs from", async () => {
    expect(await deployWaiting(inputs({ serving: { sha: "s1", repoRoot: "/elsewhere" } }))).toBeUndefined();
  });

  test("names nothing when git cannot answer", async () => {
    expect(await deployWaiting(inputs({ run: async () => ({ code: 128, stdout: "", stderr: "bad" }) }))).toBeUndefined();
    expect(await deployWaiting(inputs({ serving: { sha: null, repoRoot: "/checkouts/aide" } }))).toBeUndefined();
  });
});
