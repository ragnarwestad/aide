// A hand-paired bash/TypeScript decision (docs/bash-typescript-decisions.md):
// which terminal reason a finished `close` reports, and which one the
// dashboard lands a close on. Nothing imports across the two, and when
// they disagreed the merge was skipped in silence — the spec was stamped
// and moved on its branch, and the default branch never saw it.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { landingPolicy } from "../../src/serve/land-branch/policy/index.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
// The runner as it runs: aide-run-spec, then the library it sources last,
// where the step's reported word is decided.
const RUN_SPEC = read("../../../core/scripts/aide-run-spec") + read("../../../core/scripts/lib/run-spec/publish/result.sh");
const RUNNER_SETUP = read("../../src/serve/runner-setup.ts");

describe("close: the word bash reports is the word the dashboard lands on", () => {
  test("aide-run-spec reports `closed` for a finished close", () => {
    expect(RUN_SPEC).toContain('terminal_reason="closed"');
    // From `aide-close-spec`, not invented: the script is what stamps
    // and moves, so it is what decides whether anything was closed.
    expect(RUN_SPEC).toContain("aide-close-spec");
  });

  test("the dashboard lands a close on that same word (AC-1)", () => {
    expect(landingPolicy("close").onOk).toEqual({ landing: "close", endings: ["closed"] });
  });

  // The other half of the pair, unchanged and pinned here beside it:
  // archive lands on `completed`, which is a session's own word.
  test("archive still lands on completed, and the two are not confused (AC-1)", () => {
    expect(landingPolicy("archive").onOk).toEqual({ landing: "archive", endings: ["completed"] });
  });

  // A close whose branch never reached origin must not report `closed`:
  // the dashboard would then try to land a branch that is not there.
  // A reopen that resets the files discards the round, and the phases
  // ticked for it go with it: the wiring drops the spec's recorded choice
  // before the step's own landing, and only on a finished one.
  test("a finished reopen with reset forgets the spec's phase choice, and nothing else does", () => {
    const okBranch = /\n( *)if \(outcome\.ok\) \{([\s\S]*?)\n\1\}/.exec(RUNNER_SETUP)?.[2] ?? "";
    expect(okBranch).toContain(
      'if (step === "reopen" && job.resetFiles) ctx.store.forgetPendingSteps(job.project, job.specFolder);',
    );
    expect(okBranch.indexOf("forgetPendingSteps")).toBeLessThan(okBranch.indexOf("startLanding("));
    expect(RUNNER_SETUP.split("forgetPendingSteps").length - 1).toBe(1);
  });

  test("the word is decided after the push is confirmed, never before", () => {
    const closedAt = RUN_SPEC.indexOf('terminal_reason="closed"');
    const unpushedAt = Math.max(RUN_SPEC.lastIndexOf('terminal_reason="unpushed"'), RUN_SPEC.lastIndexOf("stop_step unpushed"));
    expect(unpushedAt).toBeGreaterThan(-1);
    expect(closedAt).toBeGreaterThan(unpushedAt);
  });
});
