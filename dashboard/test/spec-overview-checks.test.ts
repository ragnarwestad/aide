// Split out of spec-save.test.ts by theme.
//
// --- spec 188, split in two by spec 212: ticking a check --------------------
//
// A spec's page had two ways of changing it — the description behind
// Edit and Save, a check behind a box that wrote and committed on its
// own press — and a reader had to learn both. Spec 188 answered that by
// putting the checks on the Edit form, under one Save.
//
// Spec 212 splits them again, and this time they are not two ways of
// changing one thing: the description's textarea is the Description
// tab, the checks are boxes on Overview, and each has a Save that
// commits its own single file. A person no longer has to open the
// description editor in order to tick a box.
//
// The guards spec 182 built are unchanged and are re-proven here on the
// tick route: a tick lands on the row it was drawn from, and a
// `4-status.md` a step has written to since the page was drawn refuses
// the tick instead of flipping the wrong line. What is NEW is what a
// refusal can no longer do — discard a description edit that was never
// in the same request.
//
// The commit message and the refusal paths are their own sibling file,
// spec-checks-refusals-and-commit.test.ts.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../src/git/branch-status.ts";
import { PAGE, TICK, SAVE, TOKEN, FILE_SHA, DESCRIPTION, NEW_TEXT, auth, createSpecSaveHarness, descriptionPath, savable } from "./spec-save-fixtures.ts";
import {
  PHASE, OPEN_ROW, SECOND_OPEN_ROW, DONE_ROW, EARLIER_DONE_ROW, WORDED, CHECKLIST_PHASE,
  CHECKLIST_OPEN_ROW, CHECKLIST_STATUS, STATUS, HELD_BACK_REASON, ticked, phaseSection,
  heldBack, statusPath, startWithChecks as start, tick, save, recording,
  ACCEPTANCE_PHASE, ACCEPTANCE_OPEN_ROW, STATUS_WITH_OPEN_ACCEPTANCE, TDD_OPEN_ROW,
} from "./spec-checks-fixtures.ts";

const { harness } = createSpecSaveHarness();
afterEach(() => harness.cleanup());
const startWithChecks = (gitRun: GitRunner, status = STATUS) => start(harness, gitRun, status);

describe("the checks on the Overview tab", () => {
  // --- criterion 1: which checks Overview offers as boxes -------------------

  describe("GET the Overview tab", () => {
    const overview = (base: string) => fetch(`${base}${PAGE}?tab=checks`, auth).then((r) => r.text());

    // The Phase tables are the implement RUN's own record, not a
    // person's to tick: nothing anywhere gates on them (archive's only
    // gate is the Acceptance section, and has been since spec 268), so
    // drawing them as boxes with a Save invited work that changed
    // nothing and made the page look like it was holding the spec back.
    // They stay in the file, and the Status tab is where they are read.
    test("a Phase row is not offered as a box at all — only Acceptance criteria are", async () => {
      const { base } = startWithChecks(savable("/host"), STATUS_WITH_OPEN_ACCEPTANCE);
      const html = await overview(base);
      expect(html).toContain("REQ-1: something testable");
      expect(html).not.toContain("Re-read the whole diff once");
      // One Save for the one section that is the person's, never one
      // per phase heading.
      expect(html.match(/name="tick"/g)?.length).toBe(1);
      expect(html.match(/<form[^>]+\/tick"/g)?.length).toBe(1);
      expect(html).toContain(ACCEPTANCE_PHASE);
    });

    test("the current phase's open rows are boxes in a form of their own", async () => {
      const { base } = startWithChecks(savable("/host"));
      const html = await overview(base);
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html).toContain('name="tick"');
      // One shared hidden phase, not one per row: every box on this form
      // belongs to the same phase by construction.
      expect(html).toContain(`name="checksPhase"`);
      expect(html).toContain(`name="statusBaseSha"`);
      // Its own action, not the description's: two forms, two commits.
      expect(html).toContain(`action="/api/queue/specs/aide/81-queue-and-runner/tick"`);
      expect(html).not.toContain("<textarea");
    });

    // "A check already made" — the first of the description's two
    // exclusions. The row is still SHOWN, because a list that only ever
    // shrinks says nothing about how far the spec got; it is not a box.
    test("a row already done in the current phase is shown but is not a box", async () => {
      const html = await overview(startWithChecks(savable("/host")).base);
      expect(html).toContain("Run the full test suite");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    // A Phase section the workflow has not reached carries the run's own
    // rows, so it is not on this page at all.
    test("an open row in a later phase is not on the page", async () => {
      const html = await overview(startWithChecks(savable("/host")).base);
      expect(html).not.toContain("Watch the first real run");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    // Spec 190, criterion 1. With every open mark written in words the
    // page used to render with NO boxes at all: phase detection found
    // no `⬜` anywhere, called the whole file done, and the row filter
    // then matched nothing.
    test("an open row written in words is offered exactly as a symbol one is", async () => {
      const html = await overview(startWithChecks(savable("/host"), WORDED).base);
      expect(html).toContain('name="tick"');
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    test("a spec whose every phase is done offers no boxes at all", async () => {
      const done = ["# Queue - Status", "", phaseSection(PHASE, [DONE_ROW])].join("\n");
      const html = await overview(startWithChecks(savable("/host"), done).base);
      expect(html).not.toContain('name="tick"');
      expect(html).toContain("Run the full test suite");
    });

    // A spec never analysed: no phase sections at all is a real answer,
    // not an error.
    test("a status file with no phase sections at all opens all the same", async () => {
      const { base } = startWithChecks(savable("/host"), "# Queue - Status\n\n- [ ] something\n");
      const res = await fetch(`${base}${PAGE}`, auth);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('name="tick"');
    });

    // Spec 266 gave a LOW-complexity spec's `## Checklist` the same box a
    // `## Phase` row got. It loses it for the same reason they all did:
    // it is the run's own record, and archive never asks about it.
    test("a ## Checklist row is not a box either — it is the run's own record", async () => {
      const html = await overview(startWithChecks(savable("/host"), CHECKLIST_STATUS).base);
      expect(html).not.toContain('name="tick"');
      expect(html).toContain("No acceptance criteria to tick.");
    });
  });

  // --- criteria 6, 7: two routes, two commits, one file each ----------------

  test("a tick commits 4-status.md alone, and never the description", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).toContain("4-status.md");
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).not.toContain("1-description.md");
  });

  // Spec 266: the real end-to-end route, not just the parser — a
  // `## Checklist` row's tick must flip it to done on disk exactly as a
  // `## Phase` row's already does.
  test("a ## Checklist row's tick flips it to done on disk through the real /tick route", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run, CHECKLIST_STATUS);
    const res = await tick(base, { ticks: [CHECKLIST_OPEN_ROW], phase: CHECKLIST_PHASE });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      CHECKLIST_STATUS.replace(CHECKLIST_OPEN_ROW, ticked(CHECKLIST_OPEN_ROW)),
    );
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  // Spec 299's follow-up, the real end-to-end route: ticking an
  // Acceptance criteria row must work even while implement's own TDD
  // phase still has open rows of its own.
  test("an Acceptance criteria row ticks through the real /tick route while its TDD phase is still open", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run, STATUS_WITH_OPEN_ACCEPTANCE);
    const res = await tick(base, { ticks: [ACCEPTANCE_OPEN_ROW], phase: ACCEPTANCE_PHASE });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      STATUS_WITH_OPEN_ACCEPTANCE.replace(ACCEPTANCE_OPEN_ROW, ticked(ACCEPTANCE_OPEN_ROW)),
    );
    // The TDD phase's own row is untouched — one tick, one row.
    expect(readFileSync(statusPath(dir), "utf-8")).toContain(TDD_OPEN_ROW);
  });

  test("a queued matching job refuses a direct tick without changing 4-status.md", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": "s3cret-token" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(queued.status).toBe(200);

    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("still running");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  test("a description save commits 1-description.md alone, and never the status", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).not.toContain("4-status.md");
  });

  // The point of the split: what used to be one commit carrying both is
  // two independent ones, and nothing in the request can carry the
  // other file.
  test("a tick and a description edit are two commits, each of one file", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    expect((await save(base, { text: NEW_TEXT })).status).toBe(303);
    expect((await tick(base, { ticks: [OPEN_ROW] })).status).toBe(303);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(2);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(2);
  });

  // A `text` field posted at the tick route is a request that did not
  // come from the checks form, and it writes nothing.
  test("a text field sent to the tick route does not write the description", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([
        ["text", NEW_TEXT],
        ["baseSha", FILE_SHA],
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // And the reverse: the tick fields sent to the description's own
  // route flip nothing.
  test("tick fields sent to the save route do not flip a row", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([
        ["text", NEW_TEXT],
        ["baseSha", FILE_SHA],
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // Spec 294 renamed Overview to Checks and made Description the
  // page's default tab — a redirect to the bare page path (with no
  // `?tab=` at all) now lands on Description instead, not "the same
  // page" as it used to before that default existed.
  test("the tick route lands the reader back on Checks, not the default Description tab", async () => {
    const { base } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain(`${PAGE}?tab=checks`);
  });

  test("it is a POST behind the token, like every other writing route here", async () => {
    const { base } = startWithChecks(savable("/host"));
    expect((await fetch(`${base}${TICK}`, auth)).status).toBe(405);
    expect(
      (
        await fetch(`${base}${TICK}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          redirect: "manual",
          body: new URLSearchParams({ checksPhase: PHASE, statusBaseSha: "a3f9c21aaaaaaa", tick: OPEN_ROW }).toString(),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/queue/specs/aide/99-no-such/tick`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": "s3cret-token" },
          redirect: "manual",
          body: new URLSearchParams({ checksPhase: PHASE, statusBaseSha: "a3f9c21aaaaaaa", tick: OPEN_ROW }).toString(),
        })
      ).status,
    ).toBe(404);
  });

  test("two boxes ticked in one press both flip", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW, SECOND_OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)).replace(SECOND_OPEN_ROW, ticked(SECOND_OPEN_ROW)),
    );
  });

  // Nothing ticked at all is a press of Save with every box clear. It
  // is not a refusal and it is not a commit — there is nothing to say.
  test("Save pressed with no box ticked writes nothing", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await tick(base);
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  // --- spec 190: the hold-back note a met check leaves behind ---------------

  test("ticking a word-written row flips it to ✅ and commits like any other", async () => {
    const { base, dir } = startWithChecks(savable("/host"), WORDED);
    const row = "| Manual check at 375px in a real browser | Waiting | still outstanding |";
    const res = await tick(base, { ticks: [row] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(WORDED.replace(row, ticked(OPEN_ROW)));
  });

  test("ticking the last open check anywhere in the file clears the hold-back section", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    const written = readFileSync(statusPath(dir), "utf-8");
    expect(written).toContain(ticked(OPEN_ROW));
    expect(written).not.toContain("## Archive held back");
    expect(written).not.toContain(HELD_BACK_REASON);
    // Everything the section sat between is still there.
    expect(written).toContain("- **Workflow steps completed:** create, analyze, implement");
    expect(written).toContain(EARLIER_DONE_ROW);
  });

  test("a spec still carrying open work keeps its hold-back section", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status.replace(OPEN_ROW, ticked(OPEN_ROW)));
  });

  // The clearing belongs to the tick route: a save that only edits the
  // description must not go rewriting a section it never touched — and
  // since spec 212 it could not reach the file if it wanted to.
  test("a description edit alone leaves the hold-back section where it is", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status);
  });
});
