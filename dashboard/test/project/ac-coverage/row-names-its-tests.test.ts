// Under each acceptance row, the tests whose names carry its AC-id — or
// an amber line saying none does — so whoever ticks it sees what proves
// it without reading the code.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAcCoverage, withAcCoverage } from "../../../src/project/ac-coverage.ts";
import { acTestsLine } from "../../../src/render/ui/ac-tests.ts";
import type { SpecCheckView } from "../../../src/render";
import { page, view } from "../../render/pages/spec-page-fixtures.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function specDir(acs: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "aide-ac-coverage-"));
  dirs.push(dir);
  writeFileSync(join(dir, "ac-coverage.json"), JSON.stringify({ acs }));
  return dir;
}

const row = (task: string, note = "") => ({ phase: "## Acceptance criteria", line: `| ${task} | ⬜ | ${note} |`, task, done: false, note });

describe("the tests behind an acceptance row", () => {
  const dir = () =>
    specDir({
      "AC-1": [{ file: "dashboard/test/x.test.ts", name: "the total shows (AC-1)" }],
      "AC-2": [{ file: "dashboard/test/e2e/phone.test.ts", name: "it fits a phone (AC-2)" }],
      "AC-3": [],
      "AC-4": [],
    });

  test("a row names the tests that carry its id", () => {
    const [ac1] = withAcCoverage([row("AC-1: The total SHALL show.")], readAcCoverage(dir()));
    expect(acTestsLine(ac1!, "en")).toBe('<span class="checktests">Tests: the total shows (AC-1)</span>');
  });

  test("a browser test says it counts because implement ran it", () => {
    const [ac2] = withAcCoverage([row("AC-2: It SHALL fit a phone.")], readAcCoverage(dir()));
    expect(acTestsLine(ac2!, "en")).toContain("it fits a phone (AC-2) (browser, run in implement)");
  });

  test("a row no test names says so, in amber", () => {
    const [ac3] = withAcCoverage([row("AC-3: It SHALL keep counting.")], readAcCoverage(dir()));
    expect(acTestsLine(ac3!, "en")).toBe('<span class="checktests untested">No test names AC-3.</span>');
  });

  test("a row analyze marked \"Not tested:\" already says why, and gets no amber line", () => {
    const [ac4] = withAcCoverage([row("AC-4: It SHALL read well.", "Not tested: wording; check the page")], readAcCoverage(dir()));
    expect(acTestsLine(ac4!, "en")).toBe("");
  });

  test("with no record, and on a row with no AC-id, nothing is added", () => {
    const plain = row("Write the tests");
    expect(withAcCoverage([plain], readAcCoverage(dir()))[0]).toEqual(plain);
    const none = mkdtempSync(join(tmpdir(), "aide-ac-none-"));
    dirs.push(none);
    expect(readAcCoverage(none)).toBeNull();
    expect(acTestsLine(withAcCoverage([row("AC-1: x")], readAcCoverage(none))[0]!, "en")).toBe("");
  });
});

describe("where the person ticks", () => {
  test("the spec page draws the tests under the criterion", () => {
    const [ac1] = withAcCoverage(
      [row("AC-1: The total SHALL show.")],
      { "AC-1": [{ file: "dashboard/test/x.test.ts", name: "the total shows (AC-1)" }] },
    );
    const html = page(view({ checks: { rows: [{ ...(ac1 as SpecCheckView), phase: "Acceptance criteria" }], phase: "Acceptance criteria", baseSha: "b7c40e2" } }), "checks");
    const section = html.match(/<section class="checks">[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(section).toContain('<span class="checktests">Tests: the total shows (AC-1)</span>');
  });
});
