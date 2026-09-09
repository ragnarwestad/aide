// Split out of spec-save.test.ts by theme: the edit page's own retired
// address, the ordinary Save path and its refusals, the description's
// size cap, two specs sharing one checkout, and Save against an
// archived spec.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  TOKEN,
  SPEC,
  EDIT,
  DESCRIPTION_TAB,
  CHECKS_TAB,
  ANALYSIS_TAB,
  SOLUTION_TAB,
  PAGE,
  FILE_SHA,
  auth,
  ARCHIVED,
  createSpecSaveHarness,
  fillAnalysisAndSolution,
  savable,
} from "./spec-save-fixtures.ts";

const { harness, start, startArchived } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// REQ-4: a job queued or running is simulated the same way
// queue-detail-spec-page-routes.test.ts does — enqueue for real, then
// overwrite the mirror's own state, since a job in flight is not
// otherwise reachable from a fixture that answers everything else
// synchronously.
async function enqueueJob(base: string, steps: string[] = ["analyze"]): Promise<string> {
  const res = await fetch(`${base}/api/queue`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
    body: JSON.stringify({ project: "aide", specFolder: SPEC, steps }),
  });
  const body = (await res.json()) as { job: { id: string } };
  return body.job.id;
}

function seedJobState(dir: string, id: string, state: string): string {
  const mirror = join(dir, "queue.json");
  const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
  jobs.find((j) => j.id === id)!.state = state;
  writeFileSync(mirror, JSON.stringify(jobs));
  return mirror;
}

// --- spec 212, criterion 8: the second page is gone -------------------------
//
// The textarea lives on the spec page's own Description tab now, so the
// address it used to have has nothing behind it. Removed rather than
// redirected: nothing inside the dashboard linked to it once the Edit
// button went, and every other retired route here answers 404.

describe("GET the edit page", () => {
  test("the address it had answers 404, on a live spec and an archived one", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}${EDIT}`, auth)).status).toBe(404);
    const archived = startArchived(savable("/host"));
    expect((await fetch(`${archived.base}/specs/aide/${ARCHIVED}/edit`, auth)).status).toBe(404);
  });

  test("the spec page links to no such page — the tab is where the textarea is", async () => {
    const { base } = start(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    expect(html).not.toContain(EDIT);
    expect(html).toContain(`?tab=description`);
  });

  test("the Description tab holds the text and the commit it was read at", async () => {
    const { base } = start(savable("/host"));
    const res = await fetch(`${base}${DESCRIPTION_TAB}`, auth);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain("As it was.");
    expect(html).toContain(FILE_SHA);
  });

  // Ten seconds is long enough to lose a paragraph. This is why the
  // form had a page of its own before spec 212.
  test("the Description tab does not refresh itself under the reader", async () => {
    const { base } = start(savable("/host"));
    expect(await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text()).not.toContain('http-equiv="refresh"');
  });

  test("a spec nobody has is a 404, not a blank editor", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}/specs/aide/99-no-such-spec?tab=description`, auth)).status).toBe(404);
  });

  // REQ-1: the editor bundle is served from its own file and referenced
  // with <script src>, never inlined — on the ONE tab that has an
  // editable textarea and nowhere else, mirroring how
  // queueClientScript() already scopes itself.
  test("the Description tab references the editor's script by src; other tabs do not", async () => {
    const { base } = start(savable("/host"));
    const descHtml = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(descHtml).toContain("spec-editor-host");
    expect(descHtml).toContain('<script src="/spec-editor.js">');
    // REQ-1: the bundle's own source no longer travels inline at all.
    expect(descHtml).not.toContain(".toastui-editor-defaultUI");
    // Not `PAGE` (the bare URL): spec 294 made "description" the
    // default tab a bare URL resolves to (dropping "overview"), so
    // `PAGE` now serves the SAME tab this test just checked — asking
    // explicitly for another tab is what "other tabs do not" needs.
    const checksHtml = await (await fetch(`${base}${CHECKS_TAB}`, auth)).text();
    expect(checksHtml).not.toContain("spec-editor-host");
    expect(checksHtml).not.toContain('<script src="/spec-editor.js">');
    // REQ-1: with the bundle no longer inlined, a document tab's own
    // page is only a little larger than one with no editor at all —
    // nowhere near the tens of KB gap the inline bundle used to cost.
    expect(descHtml.length - checksHtml.length).toBeLessThan(2_000);
  });

  // REQ-1/REQ-5: the render side (`spec-page.ts`) already defaulted a
  // missing tab to "description"; the script-loading side did not, so a
  // bare URL — the link every spec row and every "back to spec" link on
  // this dashboard uses — rendered the mount markup with no script to
  // fill it. `PAGE` (no `?tab=`) is the exact URL that bug lived on,
  // and this is also REQ-5's page-level cold-start case: a fresh
  // server's very first request to this URL already carries a working
  // reference, not just the asset route in isolation.
  test("a fresh server's first request to the bare spec page carries the editor's script src", async () => {
    const { base } = start(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    expect(html).toContain("spec-editor-host");
    expect(html).toContain('<script src="/spec-editor.js">');
    // REQ-5: the browser's own follow-up fetch of that reference works
    // too, on the same freshly started process.
    const asset = await fetch(`${base}/spec-editor.js`);
    expect(asset.status).toBe(200);
  });

  // REQ-1/REQ-4: Analysis and Solution carry the same editable
  // mount/textarea pair Description's own form does (spec 310) — proven
  // by matching the exact markup shape
  // `spec-page-description-and-depends.test.ts` already pins for
  // Description, and the raw sibling keeps the `spec-editor-raw` class
  // so field.css's existing fallback CSS still pairs the two.
  //
  // Status is not among them: `4-status.md` is the run's own record and
  // its tab is read-only, so there is nothing to mount an editor over.
  describe("the Analysis and Solution tabs", () => {
    for (const [tab, path, needle] of [
      ["analysis", ANALYSIS_TAB, "Seven files."],
      ["solution", SOLUTION_TAB, "One must-fix."],
    ] as const) {
      test(`the ${tab} tab shows its WYSIWYG mount and the editor's script src on the first request`, async () => {
        const { base, dir } = start(savable("/host"));
        fillAnalysisAndSolution(dir);
        const html = await (await fetch(`${base}${path}`, auth)).text();
        expect(html).toContain("spec-editor-host");
        expect(html).toContain('<script src="/spec-editor.js">');
        expect(html).toContain('<div class="spec-editor-mount" id="spec-editor-host"></div>');
        expect(html).toContain('class="spec-editor-raw">');
        expect(html.indexOf('id="spec-editor-host"')).toBeLessThan(html.indexOf('class="spec-editor-raw"'));
        expect(html).toContain(needle);
      });
    }

    // REQ-4: before /aide-analyze has ever run, Analysis and Solution's
    // panels have no mount point at all — so they carry no reference to
    // either bundle. (4-status.md is always written by the harness
    // fixture, so the Status tab has no "unwritten" state to test here.)
    for (const [tab, path] of [
      ["analysis", ANALYSIS_TAB],
      ["solution", SOLUTION_TAB],
    ] as const) {
      test(`an unwritten ${tab} tab carries no editor script and no viewer script`, async () => {
        const { base } = start(savable("/host"));
        const html = await (await fetch(`${base}${path}`, auth)).text();
        expect(html).not.toContain('<script src="/spec-editor.js">');
        expect(html).not.toContain('<script src="/spec-viewer.js">');
      });
    }
  });

  // Criterion 11 (spec 163) / REQ-1/REQ-4: an archived spec is a record.
  // Hiding the control is not the guard — the save endpoint is — but the
  // tab must not offer a box that only gets refused, or load the full
  // editor bundle for a page that cannot be edited. It still has to
  // render the document, not its markdown — the viewer script is what
  // does that (REQ-1).
  test("an archived spec's Description tab is read-only, renders the document and carries no editor script", async () => {
    const { base } = startArchived(savable("/host"));
    const res = await fetch(`${base}/specs/aide/${ARCHIVED}?tab=description`, auth);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('<script src="/spec-editor.js">');
    expect(html).toContain('<script src="/spec-viewer.js">');
  });

  // REQ-4: a job queued or running makes every document tab read-only
  // on the render side already (panels.ts); the script-loading side
  // must agree, or a read-only page would load an editor it never
  // mounts. REQ-1: it must still render the document via the viewer.
  test("a document tab carries no editor script but the viewer script while a job is queued or running", async () => {
    const { base, dir } = start(savable("/host"));
    const id = await enqueueJob(base);
    const mirror = seedJobState(dir, id, "running");
    const { base: base2 } = start(savable("/host"), { queueMirrorPath: mirror });
    const html = await (await fetch(`${base2}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).not.toContain('<script src="/spec-editor.js">');
    expect(html).toContain('<script src="/spec-viewer.js">');
  });

  // REQ-7: this applies to all four document tabs, not just Description
  // — an archived spec with every file written.
  describe("REQ-7: every document tab of an archived spec carries the viewer script", () => {
    for (const [tab, needle] of [
      ["description", "Archived"],
      ["analysis", "Seven files."],
      ["solution", "One must-fix."],
      ["status", "Workflow steps completed"],
    ] as const) {
      test(`the ${tab} tab`, async () => {
        const { base } = harness.start({
          description: "# Archived - Description\n",
          archivedSpecs: {
            [ARCHIVED]: {
              description: "# Archived - Description\n",
              analysis: "# Q - Analysis\n\nSeven files.\n",
              solution: "# Q - Solution\n\nOne must-fix.\n",
            },
          },
          extra: { queueToken: TOKEN, gitRun: savable("/host") },
        });
        const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}?tab=${tab}`, auth)).text();
        expect(html).toContain('<script src="/spec-viewer.js">');
        expect(html).not.toContain('<script src="/spec-editor.js">');
        expect(html).toContain(needle);
      });
    }
  });

  // REQ-7: and both locked states, not just archived — a job in flight
  // for the active spec, all four tabs.
  describe("REQ-7: every document tab carries the viewer script while a job is queued or running", () => {
    for (const [tab, needle] of [
      ["description", "As it was."],
      ["analysis", "Seven files."],
      ["solution", "One must-fix."],
      ["status", "Workflow steps completed"],
    ] as const) {
      test(`the ${tab} tab`, async () => {
        const { base, dir } = start(savable("/host"));
        const id = await enqueueJob(base);
        const mirror = seedJobState(dir, id, "running");
        const { base: base2, dir: dir2 } = start(savable("/host"), { queueMirrorPath: mirror });
        fillAnalysisAndSolution(dir2);
        const html = await (await fetch(`${base2}/specs/aide/${SPEC}?tab=${tab}`, auth)).text();
        expect(html).toContain('<script src="/spec-viewer.js">');
        expect(html).not.toContain('<script src="/spec-editor.js">');
        expect(html).toContain(needle);
      });
    }
  });
});

// --- criterion 3: a save that goes through ----------------------------------
