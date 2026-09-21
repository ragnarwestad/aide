// Close asks its question in a dialog on the spec page (spec 525): the
// markup of the link and the box beside it.

import { describe, expect, test } from "bun:test";
import { closeAskDialog } from "../../../../src/render/pages/spec-page/close-ask.ts";
import { CLOSE_EFFECT, CLOSE_SENTENCE } from "../../../../src/render/pages/spec-page/close-page.ts";
import { DESCRIPTION_MAX } from "../../../../src/queue/parse-request.ts";
import { closeControl } from "../../../../src/render/pages/spec-page/overview.ts";
import { view } from "../spec-page-fixtures.ts";

const FOLDER = "150-one-page-shows-the-whole-spec";
const close = "/specs/aide/" + FOLDER + "/close";

describe("the Close link and its dialog (AC-1)", () => {
  test("an active spec gets the link and a closed dialog beside it (AC-1)", () => {
    const html = closeControl(view({ closeAction: close }), "en");
    expect(html).toContain(`<a class="btn" href="${close}" data-close-ask>Close</a>`);
    const dialog = /<dialog[^>]*>/.exec(html)?.[0] ?? "";
    expect(dialog).toContain('class="confirmdialog"');
    expect(dialog).not.toContain("open");
    expect(html).toContain(`Close ${FOLDER}?`);
    expect(html).toContain('name="reason"');
  });

  test("a spec with a job, or an archived one, gets no dialog (AC-1)", () => {
    expect(closeControl(view({ closeAction: close, closeUnavailableReason: "a job is running" }), "en")).not.toContain("<dialog");
    expect(closeControl(view({ closeAction: close, archived: true }), "en")).toBe("");
  });
});

describe("the ask's markup", () => {
  const html = closeAskDialog("aide", FOLDER, "en");

  test("the Reason field is required, bounded by data, named and tied to the posting form (AC-3)", () => {
    const area = /<textarea[^>]*>/.exec(html)?.[0] ?? "";
    expect(area).toContain("required");
    expect(area).toContain(`data-maxlength="${DESCRIPTION_MAX}"`);
    expect(area).not.toContain(" maxlength=");
    expect(area).toContain('name="reason"');
    const formId = /<form id="([^"]+)" method="post"/.exec(html)?.[1];
    expect(formId).toBeTruthy();
    expect(area).toContain(`form="${formId}"`);
  });

  test("the posting form posts to the close route and names the spec page to return to (AC-3)", () => {
    expect(html).toContain(`action="/api/queue/specs/aide/${FOLDER}/close"`);
    expect(html).toContain(`data-progress="/specs/aide/${FOLDER}"`);
    expect(html).toContain("data-progress-dialog");
  });

  test("the first answer is a danger OK, the second a Cancel in a dialog form (AC-4)", () => {
    const actions = /<div class="dialogactions">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const first = /<button[^>]*>[^<]*<\/button>/.exec(actions)?.[0] ?? "";
    expect(first).toContain("danger");
    expect(first).toContain(">OK<");
    expect(first).not.toContain("Save");
    expect(first).toContain('data-pending="Closing…"');
    expect(actions).toMatch(/<form method="dialog"><button class="btn" type="submit">Cancel<\/button><\/form>/);
  });

  test("Norwegian keeps OK and says the pending word in Norwegian (AC-4)", () => {
    const nb = closeAskDialog("aide", FOLDER, "nb");
    expect(nb).toContain(">OK<");
    expect(nb).not.toContain("Save");
    expect(nb).toContain('data-pending="Lukker…"');
    expect(nb).toContain(">Lukker…<");
  });

  test("the two sentences are the close page's own, and the standing heading is drawn (AC-6)", () => {
    expect(html).toContain(CLOSE_SENTENCE);
    expect(html).toContain(CLOSE_EFFECT);
    expect(html).toContain('<h2 class="standingtitle">Closing…</h2>');
    expect(html).toContain('class="refused rowmsg failed"');
  });
});
