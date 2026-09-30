// The Steps table's fold arrow: the same component every other arrow on the
// board is drawn by, so its title is in the page's language.
import { describe, expect, test } from "bun:test";
import { stepResults } from "../../../../src/render/pages/job-page/steps-table.ts";
import { esc } from "../../../../src/render/ui/html.ts";
import { t } from "../../../../src/i18n";

describe("a step's fold arrow", () => {
  const html = (): string =>
    stepResults(
      [{ step: "implement", ok: true, costUsd: 0, costMeasured: false, terminalReason: "completed", at: "2026-09-30T10:00:00Z" }],
      undefined,
      { tabHref: "/jobs/j1?tab=steps", lang: "nb" },
    );

  test("says what it does in the page's language (AC-1)", () => {
    const title = t("nb", "job.stepFoldTitle", { action: t("nb", "list.foldShow") });
    expect(html()).toContain(`title="${esc(title)}"`);
  });

  test("links to the step with its address escaped once (AC-1)", () => {
    expect(html()).toContain('href="/jobs/j1?tab=steps&amp;step=0"');
  });
});
