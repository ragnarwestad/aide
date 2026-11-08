// The message for a create that ended without a spec says what to press,
// unless its reason already does: Try again opens the form with what was
// typed, and the form's Create sends it. A reason that says to press the
// create step's button is pointed at the form's own Create, in the
// reader's language. The raw detail goes behind the (?).

import { describe, expect, test } from "bun:test";
import { t } from "../../../../../src/i18n";
import { failedCreateText, renderFailedCreateNotices } from "../../../../../src/render/pages/specs-list/failed-create-notices.ts";
import type { FailedCreate } from "../../../../../src/push/failed-creates.ts";

const rec = (over: Partial<FailedCreate> = {}): FailedCreate => ({
  id: "j1", project: "aide", title: "Crop the cover", description: "d",
  reason: { key: "runner.serverRestarted", values: { button: "Create" } }, failedAt: "2026-11-05T12:00:00.000Z", ...over,
});

describe("failedCreateText", () => {
  test("a reason that says to press Create names the form's own button in the Solution line", () => {
    const text = failedCreateText(rec(), "nb");
    expect(text).toContain(t("nb", "form.create"));
    expect(text).not.toContain("Create");
    expect(text).toContain(t("nb", "list.createTryAgain"));
  });

  test("a reason in the runner's own words gets both presses", () => {
    const text = failedCreateText(rec({ reason: "cannot create the worktree" }), "en");
    expect(text).toContain("Solution: Press Try again to open the form with what you typed, then press Create");
  });

  test("a reason with advice of its own gets none added", () => {
    const text = failedCreateText(rec({ reason: { key: "landing.createNothingToLand" } }), "en");
    expect(text.split("\n")).toHaveLength(2);
    expect(text).not.toContain("Try again");
  });
});

describe("renderFailedCreateNotices", () => {
  test("puts the stored detail behind the (?)", () => {
    const html = renderFailedCreateNotices([rec({ detail: "fatal: Could not read from remote repository." })], "en");
    expect(html).toContain("fatal: Could not read from remote repository.");
  });
});
