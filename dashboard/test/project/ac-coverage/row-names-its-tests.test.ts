// Under each acceptance row, the tests whose names carry its AC-id — or
// an amber line saying none does — so whoever ticks it sees what proves
// it without reading the code.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { readAcCoverage, withAcCoverage } from "../../../src/project/ac-coverage.ts";
import { groupBySpec, groupKey } from "../../../src/render/pages/specs-list/data-model";
import { checksPanel } from "../../../src/render/pages/specs-list/row-checks.ts";
import { checklist } from "../../../src/render/pages/spec-page/overview.ts";
import { acTestsLine, prepareAcTests } from "../../../src/render/ui/ac-tests.ts";
import { view } from "../../render/pages/spec-page-fixtures.ts";

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

  test("interleaved files keep every test in first-seen groups", () => {
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

  test("only terminal criterion annotations are shortened", () => {
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

  test("untrusted file paths and titles stay escaped text", () => {
    const html = acTestsLine({ task: "AC-1: x", tests: [
      { file: '<file>&"test".ts', name: '<title>&"name" (AC-1)' },
    ] }, "en");
    expect(html).toContain("&lt;file&gt;&amp;&quot;test&quot;.ts");
    expect(html).toContain("&lt;title&gt;&amp;&quot;name&quot;");
    expect(html).not.toContain("<file>");
    expect(html).not.toContain("<title>");
    expect(html).not.toContain("AC-1");
  });

  test("empty coverage marks a row untested", () => {
    const [ac3] = withAcCoverage([row("AC-3: It SHALL keep counting.")], readAcCoverage(dir()));
    expect(ac3?.untested).toBe(true);
    expect(acTestsLine(ac3!, "en")).toContain("No test names AC-3.");
  });

  test("a row analyze marked \"Not tested:\" already says why", () => {
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

// The files under a criterion: one shut line each, its count on the line,
// its test names inside, drawn by one function for both pages.
describe("a criterion's tests, one fold with its test kinds", () => {
  const windows: Window[] = [];
  afterEach(async () => {
    while (windows.length) await windows.pop()!.happyDOM.close();
  });
  const SCOPE = "aide/624-x";

  function drawn(html: string): HTMLElement {
    const win = new Window();
    windows.push(win);
    win.document.body.innerHTML = html;
    return win.document.body as unknown as HTMLElement;
  }

  const TESTS = [
    { file: "dashboard/test/a.test.ts", name: "the total shows (AC-1)", kind: "unit" as const },
    { file: "dashboard/test/browser/b.test.ts", name: "it fits a phone (AC-1)", kind: "browser" as const },
    { file: "dashboard/test/a.test.ts", name: "the total updates (AC-1)", kind: "unit" as const },
  ];

  test("Browser and Unit share one criterion fold with grouped files (AC-1, AC-2, AC-3, AC-7, AC-8)", () => {
    const body = drawn(acTestsLine({ task: "AC-1: x", tests: TESTS }, "en", SCOPE));
    const folds = [...body.querySelectorAll("details")];
    expect(folds).toHaveLength(1);
    expect(folds[0]!.querySelector("summary")!.textContent).toContain("Unit");
    expect(folds[0]!.querySelector("summary")!.textContent).toContain("Browser");
    expect(folds[0]!.textContent).toContain("dashboard/test/a.test.ts");
    expect(folds[0]!.textContent).toContain("dashboard/test/browser/b.test.ts");
    expect(folds[0]!.querySelector('[aria-label="Browser"]')).not.toBeNull();
  });

  test("the same test listed twice counts twice and both names are inside", () => {
    const twice = { file: "a.test.ts", name: "the total shows (AC-1)" };
    const body = drawn(acTestsLine({ task: "AC-1: x", tests: [twice, twice] }, "en", SCOPE));
    const fold = body.querySelector("details")!;
    expect(fold.textContent).toContain("a.test.ts");
    expect(fold.innerHTML.match(/the total shows/g)).toHaveLength(2);
  });

  test("the criterion fold is keyed by spec and criterion, with no AC- text", () => {
    const html = acTestsLine({ task: "AC-3: x", tests: [{ file: "a.test.ts", name: "t (AC-3)" }] }, "en", SCOPE);
    expect(html).toContain(`data-testcriterion="${SCOPE}|3"`);
    expect(html).not.toContain("AC-");
  });

  test("the closed kind line ends with its fold arrow (AC-8)", () => {
    const body = drawn(acTestsLine({ task: "AC-1: x", tests: TESTS }, "en", SCOPE));
    expect(body.querySelector("summary")!.lastElementChild?.tagName).toBe("svg");
  });

  test("an old record is classified from an existing file and a missing file stays unknown (AC-6)", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-ac-code-"));
    dirs.push(root);
    writeFileSync(join(root, "browser.test.ts"), 'import { test } from "@playwright/test";\n');
    const rows = withAcCoverage([row("AC-1: x")], { "AC-1": [
      { file: "browser.test.ts", name: "browser (AC-1)" },
      { file: "gone.test.ts", name: "gone (AC-1)" },
    ] }, root);
    expect(rows[0]!.tests).toEqual([
      { file: "browser.test.ts", name: "browser (AC-1)", kind: "browser" },
      { file: "gone.test.ts", name: "gone (AC-1)" },
    ]);
  });

  test("an old record recognises a multiline Playwright import (AC-6)", () => {
    const root = mkdtempSync(join(tmpdir(), "aide-ac-code-"));
    dirs.push(root);
    const module = ["play", "wright"].join("");
    writeFileSync(join(root, "browser.test.ts"), `import {\n  test\n} from "${module}";\n`);
    const [covered] = withAcCoverage([row("AC-1: x")], { "AC-1": [
      { file: "browser.test.ts", name: "browser (AC-1)" },
    ] }, root);
    expect(covered!.tests![0]!.kind).toBe("browser");
  });

  test("kind icons have translated accessible names in every language (AC-11, AC-12)", () => {
    const expected = { en: ["Unit", "Browser"], nb: ["Enhet", "Nettleser"], es: ["Unidad", "Navegador"], de: ["Unit", "Browser"], fr: ["Unitaire", "Navigateur"] } as const;
    for (const [lang, labels] of Object.entries(expected)) {
      const body = drawn(acTestsLine({ task: "AC-11: x", tests: TESTS }, lang as keyof typeof expected, SCOPE));
      expect([...body.querySelectorAll("summary [aria-label]")].map((el) => el.getAttribute("aria-label"))).toEqual([...labels]);
    }
  });

  test("the Status tab and the Specs list draw exactly the shared markup (AC-10)", () => {
    const folder = "624-x";
    const key = groupKey("aide", folder);
    const task = "AC-1: it counts";
    const line = `| ${task} | ⬜ | |`;
    const row = { phase: "Acceptance criteria", line, task, done: false, note: "", tests: TESTS };
    const expected = acTestsLine(row, "en", key);
    expect(expected).toContain("<details");

    const group = { ...groupBySpec([], [{ project: "aide", specFolder: folder }])[0]!, acceptance: [row] };
    expect(checksPanel(group, { checks: key }, "en")).toContain(expected);

    const page = view({ project: "aide", specFolder: folder, checks: { rows: [row], phase: "Acceptance criteria" } });
    expect(checklist(page, "en")).toContain(expected);
  });

  test("a criterion no test names still shows its warning and no fold (AC-9)", () => {
    const body = drawn(acTestsLine({ task: "AC-4: x", untested: true }, "en", SCOPE));
    expect(body.querySelector(".checktests.untested")?.textContent).toBe("No test names AC-4.");
    expect(body.querySelector("details")).toBeNull();
  });
});
