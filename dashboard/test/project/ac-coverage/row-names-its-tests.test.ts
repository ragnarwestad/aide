// Under each acceptance row, the tests whose names carry its AC-id — or
// an amber line saying none does — so whoever ticks it sees what proves
// it without reading the code.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAcCoverage, withAcCoverage } from "../../../src/project/ac-coverage.ts";
import { acTestsLine, prepareAcTests } from "../../../src/render/ui/ac-tests.ts";

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

  test("interleaved files keep every test in first-seen groups (AC-1, AC-6)", () => {
    const tests = [
      { file: "a.test.ts", name: "first (AC-1)" },
      { file: "test/e2e/b.test.ts", name: "second (AC-1)" },
      { file: "a.test.ts", name: "first (AC-1)" },
    ];
    const original = structuredClone(tests);
    expect(prepareAcTests(tests)).toEqual([
      { file: "a.test.ts", names: ["first", "first"] },
      { file: "test/e2e/b.test.ts", names: ["second"] },
    ]);
    expect(tests).toEqual(original);
  });

  test("only terminal criterion annotations are shortened (AC-2)", () => {
    const cases = [
      ["total (AC-1)", "total"],
      ["total (ac_1, AC2; AC-6)", "total"],
      ["total AC-1, ac_2", "total"],
      ["total — AC1 / AC-2", "total"],
      ["def test_total_ac_1():", "def test_total():"],
      ["def test_total_ac_1_ac_2(value):", "def test_total(value):"],
      ["AC-1", "AC-1"],
      ["(AC-1)", "(AC-1)"],
      ["total (phone)", "total (phone)"],
      ["AC-1 stays meaningful here", "AC-1 stays meaningful here"],
      ["total AC-1 (phone)", "total AC-1 (phone)"],
      ["total 123", "total 123"],
      ["totalAC1", "totalAC1"],
      ["total (browser)", "total (browser)"],
    ];
    for (const [name, expected] of cases) {
      expect(prepareAcTests([{ file: "test/e2e/phone.test.ts", name: name! }])[0]?.names).toEqual([expected!]);
    }
  });

  test("untrusted file paths and titles stay escaped text (AC-1, AC-2)", () => {
    const html = acTestsLine({ task: "AC-1: x", tests: [
      { file: '<file>&"test".ts', name: '<title>&"name" (AC-1)' },
    ] }, "en");
    expect(html).toContain("&lt;file&gt;&amp;&quot;test&quot;.ts");
    expect(html).toContain("&lt;title&gt;&amp;&quot;name&quot;");
    expect(html).not.toContain("<file>");
    expect(html).not.toContain("<title>");
    expect(html).not.toContain("AC-1");
  });

  test("empty coverage marks a row untested (AC-3)", () => {
    const [ac3] = withAcCoverage([row("AC-3: It SHALL keep counting.")], readAcCoverage(dir()));
    expect(ac3?.untested).toBe(true);
    expect(acTestsLine(ac3!, "en")).toContain("No test names AC-3.");
  });

  test("a row analyze marked \"Not tested:\" already says why (AC-3)", () => {
    const [ac4] = withAcCoverage([row("AC-4: It SHALL read well.", "Not tested: wording; check the page")], readAcCoverage(dir()));
    expect(acTestsLine(ac4!, "en")).toBe("");
  });

  test("with no record, and on a row with no AC-id, nothing is added (AC-3)", () => {
    const plain = row("Write the tests");
    expect(withAcCoverage([plain], readAcCoverage(dir()))[0]).toEqual(plain);
    const none = mkdtempSync(join(tmpdir(), "aide-ac-none-"));
    dirs.push(none);
    expect(readAcCoverage(none)).toBeNull();
    expect(acTestsLine(withAcCoverage([row("AC-1: x")], readAcCoverage(none))[0]!, "en")).toBe("");
  });
});
