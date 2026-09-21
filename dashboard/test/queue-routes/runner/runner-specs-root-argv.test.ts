// Where a run makes a spec folder is the dashboard's answer, not the
// script's own.
//
// On 2026-09-21 a create wrote its folder at the specs repository's ROOT
// while the landing looked for it under the project's own directory
// inside that repository, so the spec could not be given its number and
// nothing reached main. The two had worked it out separately: the run
// from `AIDE_SPECS_PATH` in `.aide/config` — a file the dashboard
// rewrites itself — and the landing from `machinerySpecsRoot`. One
// answer now, handed over as `--specs-root`.

import { describe, expect, test } from "bun:test";
import { runnerArgv } from "../../../src/serve/serve.ts";

const job = {
  id: "j1", project: "aide", specFolder: "new-0cdf3db8", steps: ["create"], stepIndex: 0,
  model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
} as unknown as Parameters<typeof runnerArgv>[0];

const argv = (specsRoot?: string): string[] =>
  runnerArgv(job, "create", "/tmp/r.json", {
    runnerBin: "/bin/aide-run-spec",
    projectDir: "/checkouts/aide/code",
    specsRoot,
    push: "branch",
  });

describe("the specs root the run is given", () => {
  test("is passed as --specs-root, with the value the landing will use", () => {
    const args = argv("/checkouts/aide/specs/aide");

    expect(args).toContain("--specs-root");
    expect(args[args.indexOf("--specs-root") + 1]).toBe("/checkouts/aide/specs/aide");
  });

  test("is left out when the dashboard cannot resolve one", () => {
    // The script works it out itself then, which is what a run started
    // by hand has always done.
    expect(argv(undefined)).not.toContain("--specs-root");
  });

  test("comes before the command, so the script's own parser sees it", () => {
    const args = argv("/checkouts/aide/specs/aide");

    expect(args.indexOf("--specs-root")).toBeLessThan(args.indexOf("--command"));
  });
});
