// An opened step: a tab strip (Log, Changed files, Errors) and one box
// holding the current tab's content. The tab is `?steptab=` in the
// address, so it survives the page's own reload and a press keeps the step
// open.

import { describe, expect, test } from "bun:test";
import { stepResults } from "../../../../src/render/pages/job-page";
import { resolveStepTab } from "../../../../src/render/pages/job-page/step-tabs.ts";
import type { JobStepResultView } from "../../../../src/render/pages/job-page/types.ts";

const HREF = "/specs/aide/1-x?tab=steps";

const RESULT: JobStepResultView = {
  step: "implement",
  ok: true,
  costUsd: 0.4,
  costMeasured: true,
  terminalReason: "completed",
  at: "2026-09-26T10:05:00Z",
  logs: [
    { by: "aide-before", lines: ["10:45:08 +0s fetching main"] },
    { by: "ai", lines: ["Bash bun test", "Bash git status", "All done."] },
    { by: "aide-after", lines: ["10:52:13 +427s the project's tests are green"] },
  ],
  aiModel: "Claude Sonnet",
  errors: ["Bash bun test"],
  changedFiles: [
    { path: "src/queue/runner.ts", added: 4, removed: 1, binary: false },
    { path: "assets/logo.png", added: 0, removed: 0, binary: true },
  ],
};

const draw = (r: JobStepResultView, steptab?: string, extra: Record<string, unknown> = {}): string =>
  stepResults([r], undefined, { tabHref: HREF, openStep: "0", steptab, ...extra });

const tabLinks = (html: string): string[] => html.match(/<a class="tab"[^>]*>[^<]*<\/a>/g) ?? [];
const names = (html: string): string[] => tabLinks(html).map((a) => a.replace(/<[^>]+>/g, ""));
const box = (html: string): string => html.match(/<div class="logbox"><div>((?:(?!<div).)*)<\/div><\/div>/s)?.[1] ?? "";

describe("the tab strip of an opened step", () => {
  test("shows Log, Changed files and Errors in that order, the address's tab marked, and one box (AC-1)", () => {
    const html = draw(RESULT, "errors");

    expect(names(html)).toEqual(["Log", "Changed files (2)", "Errors"]);
    expect(tabLinks(html).map((a) => a.includes('aria-current="true"'))).toEqual([false, false, true]);
    expect(html.match(/class="logbox"/g)).toHaveLength(1);
    // Only the current tab's content is in the markup.
    expect(html).toContain("Bash bun test");
    expect(html).not.toContain("Bash git status");
    expect(html).not.toContain("src/queue/runner.ts");
    expect(html).not.toContain("All done.");
  });

  test("the box has exactly one child, so it opens at its end (AC-2)", () => {
    for (const tab of ["log", "files", "errors"]) {
      const html = draw(RESULT, tab);
      expect(html.match(/<div class="logbox"><div>/g)).toHaveLength(1);
      expect(html).toMatch(/<div class="logbox"><div>(?:(?!<div).)*<\/div><\/div>/s);
    }
  });

  test("no address, or one that names none of the three, shows Log (AC-2)", () => {
    for (const steptab of [undefined, "", "everything", "commands"]) {
      const html = draw(RESULT, steptab);
      expect(tabLinks(html).map((a) => a.includes('aria-current="true"'))).toEqual([true, false, false]);
      expect(html).toContain("Bash git status");
    }
    expect(resolveStepTab("files")).toBe("files");
    expect(resolveStepTab("nonsense")).toBe("log");
    expect(resolveStepTab(undefined)).toBe("log");
  });

  test("every link keeps the page's tab, the step and its own tab in the address (AC-8)", () => {
    const links = tabLinks(draw(RESULT));
    expect(links.map((a) => a.match(/href="([^"]*)"/)![1])).toEqual([
      `${HREF}&step=0&steptab=log`,
      `${HREF}&step=0&steptab=files`,
      `${HREF}&step=0&steptab=errors`,
    ]);
  });

  test("shows no Commands list and no link that carries only= (AC-9)", () => {
    for (const tab of ["log", "files", "errors"]) {
      const html = draw(RESULT, tab);
      expect(html).not.toContain("Commands");
      expect(html).not.toContain("only=");
    }
  });
});

describe("the Log tab", () => {
  test("draws each part under one separator line naming its writer, in order, in the one box (AC-4)", () => {
    const inner = box(draw(RESULT, "log"));
    const at = ["— Aide: preparing —", "— AI (Claude Sonnet) —", "— Aide: tests and commit —"].map((x) => inner.indexOf(x));

    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(inner.indexOf("fetching main")).toBeGreaterThan(at[0]!);
    expect(inner.indexOf("Bash git status")).toBeGreaterThan(at[1]!);
    expect(inner.indexOf("are green")).toBeGreaterThan(at[2]!);
  });

  test("the final message is the last line of the last AI part, once, with no heading of its own (AC-5)", () => {
    const html = draw(RESULT, "log");

    expect(html.match(/All done\./g)).toHaveLength(1);
    expect(html.indexOf("All done.")).toBeGreaterThan(html.indexOf("Bash git status"));
    expect(html.indexOf("All done.")).toBeLessThan(html.indexOf("Aide: tests and commit"));
    expect(html).not.toContain("<h4>");
    expect(html).not.toContain("Final message");
  });

  test("a part with no lines has no separator, and no model label reads AI (AC-4)", () => {
    const html = draw({ ...RESULT, aiModel: undefined, logs: [{ by: "aide-before", lines: [] }, RESULT.logs![1]!] }, "log");

    expect(html).not.toContain("Aide: preparing");
    expect(html).toContain("— AI —");
  });

  test("a step of Aide's lines only, or one line of the AI's, shows them and no missing-log sentence (AC-3)", () => {
    for (const logs of [[{ by: "aide" as const, lines: ["10:45:08 +0s fetching main"] }], [{ by: "ai" as const, lines: ["Only this."] }]]) {
      const html = draw({ ...RESULT, logs, errors: [], changedFiles: undefined });

      expect(html).not.toContain("log is missing");
      expect(html).not.toContain("Nothing has been captured");
    }
    expect(draw({ ...RESULT, logs: [{ by: "aide", lines: ["x"] }] }, "log")).toContain("— Aide —");
  });

  test("a step with no transcript still gets the strip and says nothing was captured (AC-1)", () => {
    const html = draw({
      step: "implement", ok: false, costUsd: 0.5, costMeasured: true, terminalReason: "process-gone",
      at: "2026-09-26T10:05:00Z",
    });

    expect(names(html)).toEqual(["Log", "Changed files", "Errors"]);
    expect(html).toContain("log is missing");
    expect(html).toContain("$0.50");
    expect(html).toContain("Nothing has been captured");
  });

  test("a step refused before it started says so on the Log tab (AC-1)", () => {
    const html = draw({
      step: "implement", ok: false, costUsd: 0, costMeasured: true, terminalReason: "refused",
    });

    expect(html).toContain("refused before it started");
  });

  test("the merge's refusal stays above the strip (AC-1)", () => {
    const html = stepResults([RESULT], undefined, {
      tabHref: HREF, openStep: "0", landingRefused: { step: "implement", word: "merge stopped", detail: "tests are red" },
    });

    expect(html.indexOf("tests are red")).toBeGreaterThan(-1);
    expect(html.indexOf("tests are red")).toBeLessThan(html.indexOf('<nav class="tabbar subtabs">'));
  });
});

describe("the Changed files tab", () => {
  test("lists each file with lines added and removed, a binary one marked, and the count is in the name (AC-6)", () => {
    const html = draw(RESULT, "files");

    expect(names(html)[1]).toBe("Changed files (2)");
    expect(box(html)).toContain("src/queue/runner.ts +4 -1");
    expect(box(html)).toContain("assets/logo.png");
    expect(box(html)).toContain("binary");
    expect(box(html)).not.toContain("assets/logo.png +");
  });

  test("a commit range with no change reads (0) and says no file changed (AC-6)", () => {
    const html = draw({ ...RESULT, changedFiles: [] }, "files");

    expect(names(html)[1]).toBe("Changed files (0)");
    expect(box(html)).toContain("No file changed");
  });

  test("a step with no commit range recorded has no count and says so (AC-6)", () => {
    const html = draw({ ...RESULT, changedFiles: undefined }, "files");

    expect(names(html)[1]).toBe("Changed files");
    expect(box(html)).toContain("not recorded");
  });
});

describe("the Errors tab", () => {
  test("shows only the failed command, while Log shows both (AC-7)", () => {
    const errors = box(draw(RESULT, "errors"));
    const log = box(draw(RESULT, "log"));

    expect(errors).toContain("Bash bun test");
    expect(errors).not.toContain("Bash git status");
    expect(log).toContain("Bash bun test");
    expect(log).toContain("Bash git status");
  });

  test("holds both writers' error lines in one box with no separator (AC-7)", () => {
    const inner = box(draw({ ...RESULT, errors: ["Bash bun test", "10:52:13 +427s error: the tests are red"] }, "errors"));

    expect(inner.match(/<pre/g)).toHaveLength(1);
    expect(inner).toContain("error: the tests are red");
    expect(inner).not.toContain("—");
  });

  test("says the log has no error lines when there are none (AC-7)", () => {
    const html = draw({ ...RESULT, errors: [] }, "errors");

    expect(box(html)).toContain("no error lines");
  });
});

describe("a running step", () => {
  const running = { step: "implement", logs: [{ by: "ai" as const, lines: ["Bash bun test", "Bash git status"] }], errors: ["Bash bun test"] };
  const drawRunning = (steptab?: string): string =>
    stepResults([], undefined, { tabHref: HREF, openStep: "live", runningStep: running, steptab });

  test("gets the same strip, its files known when it ends (AC-1)", () => {
    expect(names(drawRunning())).toEqual(["Log", "Changed files", "Errors"]);
    expect(tabLinks(drawRunning())[1]).toContain(`href="${HREF}&step=live&steptab=files"`);
    expect(box(drawRunning("files"))).toContain("known when the step ends");
  });

  test("answers Log and Errors from its live log (AC-1)", () => {
    expect(box(drawRunning("log"))).toContain("Bash git status");
    expect(box(drawRunning("errors"))).toContain("Bash bun test");
    expect(box(drawRunning("errors"))).not.toContain("Bash git status");
  });
});

describe("in Norwegian", () => {
  test("the tab names, the separators and the sentences read Norwegian (AC-4)", () => {
    const nb = (r: JobStepResultView, steptab: string): string =>
      stepResults([r], undefined, { tabHref: HREF, openStep: "0", steptab, lang: "nb" });

    expect(names(nb(RESULT, "log"))).toEqual(["Logg", "Endrede filer (2)", "Feil"]);
    expect(nb(RESULT, "log")).toContain("— Aide: forbereder —");
    expect(nb(RESULT, "log")).toContain("— AI (Claude Sonnet) —");
    expect(nb(RESULT, "log")).toContain("— Aide: tester og commit —");
    expect(nb(RESULT, "log")).not.toContain("Aide: preparing");
    expect(nb({ ...RESULT, changedFiles: [] }, "files")).not.toContain("No file changed");
    expect(nb({ ...RESULT, changedFiles: undefined }, "files")).not.toContain("not recorded");
    expect(nb({ ...RESULT, errors: [] }, "errors")).not.toContain("no error lines");
  });
});
