// The landing runs aide's own scripts (aide-create-spec for the number a
// landed create gets, the test gate's resolver and recorder) from BESIDE
// THE RUNNER the server was started with, never from PATH alone. A test
// board serving a branch runs that branch's TypeScript, and the bash
// written together with it lives in the same checkout; the copy under
// ~/.local/bin is main's, and a flag the branch added is "unknown" to it
// — which is how eleven parallel creates on spec 453's board failed with
// "unknown argument: --assign-number" (2026-09-14).
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignSpecNumberAfterMerge } from "../../../src/serve/land-branch/finalize-create.ts";
import { scriptFor } from "../../../src/serve/land-branch/run-script.ts";

const SERVE = readFileSync(new URL("../../../src/serve/serve.ts", import.meta.url), "utf8");

describe("scriptFor", () => {
  test("the copy beside the runner wins over the installed one; the override wins over both", () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-scripts-beside-"));
    try {
      writeFileSync(join(dir, "aide-create-spec"), "#!/bin/sh\n");
      expect(scriptFor("aide-create-spec", { beside: dir })).toBe(join(dir, "aide-create-spec"));
      expect(scriptFor("aide-create-spec", { beside: dir, override: "/fake/bin" })).toBe("/fake/bin");
      // Nothing beside the runner by that name: the installed copy, or the bare name.
      const r = scriptFor("aide-no-such-script", { beside: dir });
      expect([`${process.env.HOME}/.local/bin/aide-no-such-script`, "aide-no-such-script"]).toContain(r);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the landed create's number", () => {
  test("is asked of the aide-create-spec beside the runner", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-beside-runner-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const marker = join(dir, "called.txt");
      writeFileSync(
        join(bin, "aide-create-spec"),
        `#!/bin/sh\nprintf '%s\\n' "$*" > ${marker}\nprintf '{"ok":true,"specFolder":"07-x"}\\n'\n`,
      );
      chmodSync(join(bin, "aide-create-spec"), 0o755);
      const work = join(dir, "work");
      mkdirSync(work);
      const answer = await assignSpecNumberAfterMerge(work, work, work, "new-abc12345", { scriptDir: bin });
      expect(answer).toEqual({ ok: true, specFolder: "07-x" });
      expect(readFileSync(marker, "utf8")).toContain("--assign-number --folder new-abc12345");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the server wires the runner's own directory into both", () => {
  test("the numbering and the test gate get dirname(queueRunnerBin)", () => {
    const numbering = /finalizeCreateSpec:[\s\S]*?assignSpecNumberAfterMerge\([\s\S]*?scriptDir: opts\.queueRunnerBin \? dirname\(opts\.queueRunnerBin\)/;
    const gate = /landingGate:[\s\S]*?runProjectSuiteBeforePush\([\s\S]*?scriptDir: opts\.queueRunnerBin \? dirname\(opts\.queueRunnerBin\)/;
    expect(SERVE).toMatch(numbering);
    expect(SERVE).toMatch(gate);
  });
});
