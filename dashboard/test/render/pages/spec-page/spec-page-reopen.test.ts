// Split out of spec-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { type SpecPageView } from "../../../../src/render";
import { REOPEN_SENTENCE } from "../../../../src/render/pages/spec-page/ask-dialog.ts";
import { page, view } from "../spec-page-fixtures.ts";

const FOLDER = "150-one-page-shows-the-whole-spec";

/** The dialog with this id, whole. */
const dialogById = (html: string, id: string): string =>
  html.match(new RegExp(`<dialog[^>]*id="${id}"[^>]*>[\\s\\S]*?</dialog>`))?.[0] ?? "";

// --- spec 198: reopening a spec is one action -------------------------------
//
// An archived spec whose work has to be done again was reopened by hand
// in a terminal — move the folder, overwrite three files, hunt down the
// branch in two repositories and two places each. Done twice, missed
// something both times. The control belongs where the spec is.
//
// Everything ELSE about an archived spec stays as spec 163 left it: no
// textarea on the Description tab, the same read-only note, and checks
// that are shown but cannot be ticked.
describe("spec 198: the Reopen control", () => {
  const archived = (extra: Partial<SpecPageView> = {}, tab?: string) =>
    page(view({ archived: true, ...extra }), tab);

  test("the action row's Reopen names a dialog asking the question (AC-1)", () => {
    const html = archived();
    const id = html.match(/<button type="button" class="btn" data-ask="([^"]+)">Reopen<\/button>/)?.[1];
    expect(id).toBeDefined();
    const dialog = dialogById(html, id!);
    expect(dialog).toContain("data-progress-dialog");
    expect(dialog).toContain(`<h2>Reopen ${FOLDER}?</h2>`);
    expect(dialog).toContain(REOPEN_SENTENCE);
    expect(dialog).toMatch(/<input type="checkbox" name="resetFiles" value="1"[^>]*>/);
    expect(dialog).not.toMatch(/name="resetFiles"[^>]*checked/);
    expect(dialog).toContain(">OK</button>");
    expect(dialog).toContain(">Cancel</button>");
  });

  test("OK posts the reopen to the queue, and the box belongs to that post (AC-2)", () => {
    const html = archived();
    const id = html.match(/data-ask="([^"]+)">Reopen</)?.[1] ?? "";
    const dialog = dialogById(html, id);
    const form = dialog.match(/<form id="([^"]+)" method="post" action="\/api\/queue"[^>]*>[\s\S]*?<\/form>/);
    expect(form).not.toBeNull();
    expect(form![0]).toContain('name="project" value="aide"');
    expect(form![0]).toContain(`name="specFolder" value="${FOLDER}"`);
    expect(form![0]).toContain('name="steps" value="reopen"');
    expect(form![0]).toContain(`data-progress="/specs/aide/${FOLDER}"`);
    expect(dialog).toMatch(new RegExp(`<input type="checkbox" name="resetFiles" value="1" form="${form![1]}">`));
  });

  test("a Failed criterion's Reopen opens the action row's dialog (AC-1)", () => {
    const failed = {
      phase: "Acceptance criteria",
      task: "AC-1: the page works",
      line: "| AC-1: the page works | ❌ Failed | |",
      done: false,
      failed: true,
    };
    const html = archived({ checks: { rows: [failed], phase: "Acceptance criteria" } }, "status");
    const checks = html.match(/<section class="checks">[\s\S]*?<\/section>/)?.[0] ?? "";
    const id = checks.match(/<button type="button" class="btn" data-ask="([^"]+)">Reopen<\/button>/)?.[1];
    expect(id).toBeDefined();
    expect(dialogById(html, id!)).toContain(`<h2>Reopen ${FOLDER}?</h2>`);
    expect(checks).not.toContain("<dialog");
  });

  test("nothing on an archived spec's page leads to a Reopen page (AC-6)", () => {
    const failed = { phase: "Acceptance criteria", task: "AC-1", line: "| AC-1 | ❌ Failed | |", done: false, failed: true };
    for (const html of [archived(), archived({ checks: { rows: [failed], phase: "Acceptance criteria" } }, "status")]) {
      expect(html).not.toContain(`/specs/aide/${FOLDER}/reopen`);
    }
  });

  // A live spec has the whole row on the queue list for this; the
  // archived page is the one place a reopen can be asked for.
  test("a live spec's page offers nothing of the sort", () => {
    expect(page(view({}))).not.toContain("Reopen");
  });
});
