import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = (path: string): string => readFileSync(new URL(`../../../src/serve/${path}`, import.meta.url), "utf8");

test("Deploy does not depend on route or landing implementations (AC-3)", () => {
  const deploy = source("deploy-job/run.ts");
  expect(deploy).not.toMatch(/\.\.\/routes\//);
  expect(deploy).not.toContain("RepoMergeResult");
});

test("process-only modules do not depend on landing orchestration (AC-4)", () => {
  const paths = [
    "providers/status.ts",
    "setup/schedules.ts",
    "tool-check.ts",
    "tool-models/index.ts",
    "tool-usage/index.ts",
  ];
  for (const path of paths) expect(source(path)).not.toContain("land-branch/run-script");
});

test("landing passes its configured install timeout to deployment (AC-2)", () => {
  expect(source("land-branch/merge.ts")).toContain("installCheckout(repo.root, ctx.queueInstallTimeoutMs)");
});
