// Split out of queue-detail.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGitRunner, type GitRunner } from "../../src/git/process/index.ts";
import { IMPLEMENTED } from "../helpers/queue-server.ts";
import { DESCRIPTION, detailHarness } from "./queue-detail-fixtures.ts";

const { harness, start } = detailHarness(IMPLEMENTED);

// --- A page for the SPEC, not for one of its runs ------------------
//
// `/specs/<project>/<specFolder>` is the spec itself: the four files as they stand on this host's checkout,
// each stamped with its own last commit, plus an Update button that
// pulls the specs repository so a change pushed a moment ago is on the
// screen at once.

describe("GET /specs/<project>/<specFolder>", () => {
  const SPEC = "81-queue-and-runner";
  const PATH = `/specs/aide/${SPEC}`;

  /** The three files the harness does not write. */
  const fillSpec = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", SPEC);
    writeFileSync(join(spec, "2-analysis.md"), "# Q - Analysis\n\n## Findings\n\nSeven files.\n");
    writeFileSync(
      join(spec, "3-solution.md"),
      "# Q - Solution\n\n## Plan review\n\nOne must-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
  };

  // All four are still there, one TAB each, rather than
  // stacked in full on Overview. Overview itself carries no file text —
  // it is where the spec stands.
  test("offers all four files, whether or not anything has ever run", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const overview = await res.text();
    for (const tab of ["description", "analysis", "solution", "status"]) {
      expect([tab, new RegExp(`[?&](?:amp;)?tab=${tab}(?:[&#"])`).test(overview)]).toEqual([tab, true]);
    }
    expect(overview).not.toContain("Seven files.");

    const analysis = await (await fetch(`${base}${PATH}?tab=analysis`)).text();
    expect(analysis).toContain("2-analysis.md");
    expect(analysis).toContain("Seven files.");
    const solution = await (await fetch(`${base}${PATH}?tab=solution`)).text();
    expect(solution).toContain("3-solution.md");
    expect(solution).toContain("One must-fix.");
  });

  // The spec's address is the Specs list with that row open, and
  // the spec drawn in the row.
  test("answers the Specs list with the spec's row open and the whole spec in it", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="jobrows"');
    expect(html).toContain(`data-spec-detail="aide/${SPEC}"`);
    // The tabs, each a link to the spec's own address, and the Description panel.
    for (const tab of ["description", "analysis", "solution", "status"]) {
      expect([tab, new RegExp(`href="/specs/aide/${SPEC}\\?[^"]*tab=${tab}`).test(html)]).toEqual([tab, true]);
    }
    expect(html).toContain("It shows nothing about");
  });

  test("a live spec offers Close and an archived spec offers Reopen", async () => {
    const live = harness.start({ description: DESCRIPTION, archivedSpecs: { "70-an-old-spec": {} } });
    const open = await (await fetch(`${live.base}${PATH}`)).text();
    expect(open).toContain(`data-ask="closeask-aide/${SPEC}"`);
    const archived = await (await fetch(`${live.base}/specs/aide/70-an-old-spec`)).text();
    expect(archived).toContain('data-ask="reopenask-aide/70-an-old-spec"');
  });

  test("a spec archived while the list shows only the active ones is still the open row", async () => {
    const { base } = harness.start({ description: DESCRIPTION, archivedSpecs: { "70-an-old-spec": {} } });
    const html = await (await fetch(`${base}/specs/aide/70-an-old-spec`)).text();
    expect(html).toContain('id="spec-aide/70-an-old-spec"');
    expect(html).toContain('data-spec-detail="aide/70-an-old-spec"');
  });

  test("/specs?open= leads to the spec's address with the rest of the query", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs?open=${encodeURIComponent(`aide/${SPEC},aide/82-other`)}&q=queue`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/specs/aide/${SPEC}?q=queue`);
  });

  test("/specs draws every row shut, without the spec", async () => {
    const { base } = start();
    const html = await (await fetch(`${base}/specs`)).text();
    // The loading-row template holds a detail row of its own, outside the rows.
    const rows = html.slice(html.indexOf('<div id="jobrows">'), html.indexOf('<template id="refusal-row">'));
    expect(rows).not.toContain('<tr class="specdetail"');
    expect(html).not.toMatch(/<a class="fold"[^>]*aria-expanded="true"/);
    expect(html).toMatch(/<a class="fold shut"[^>]*aria-expanded="false"/);
  });

  // The page script opens a shut row in place: it asks for the spec's rows with
  // the spec drawn in, and adds the tab's script itself.
  test("?detail=1 answers that spec's rows with the spec in its row and the editor's script tag", async () => {
    const { base, dir } = start();
    fillSpec(dir);
    const res = await fetch(`${base}${PATH}?detail=1`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("<html");
    expect(html).toContain(`data-spec-detail="aide/${SPEC}"`);
    expect(html).toContain("It shows nothing about");
    expect(html).toMatch(/<script src="\/spec-editor\.js"><\/script>\s*$/);
  });

  // The page script copies this template for the row it draws while it waits.
  test("/specs and a spec's address carry the loading-row template the page script reads", async () => {
    const { base } = start();
    const { SPEC_LOADING_ROW_ID } = await import("../../src/specs-client/spec-detail/open.ts");
    for (const path of ["/specs", PATH]) {
      const html = await (await fetch(`${base}${path}`)).text();
      expect([path, html.includes(`<template id="${SPEC_LOADING_ROW_ID}">`)]).toEqual([path, true]);
    }
  });

  // The spec's view reads its files through git; the list's answers must not.
  test("the spec is loaded when its row is opened, not when the list is drawn", async () => {
    const real = createGitRunner();
    const hits: string[] = [];
    const gitRun: GitRunner = (cwd, args, timeoutMs, env) => {
      hits.push(args.join(" "));
      return real(cwd, args, timeoutMs, env);
    };
    const { base } = start({ gitRun });
    const reads = (): number => hits.filter((h) => /\d-(description|analysis|solution|status)\.md/.test(h)).length;

    await (await fetch(`${base}/specs`)).text();
    await (await fetch(`${base}/specs?rows=1`)).text();
    const stand = await (await fetch(`${base}${PATH}?rows=1`)).text();
    const none = reads();
    expect(stand).toContain(`data-spec-detail="aide/${SPEC}"`);
    expect(stand).not.toContain("specform");

    await (await fetch(`${base}${PATH}`)).text();
    expect(reads()).toBeGreaterThan(none);
  });

  test("a spec nobody has is a 404, not a blank page", async () => {
    const { base } = start();
    expect((await fetch(`${base}/specs/aide/99-no-such-spec`)).status).toBe(404);
    expect((await fetch(`${base}/specs/no-such-project/${SPEC}`)).status).toBe(404);
  });

  test("the spec's files are re-read on every request, never served from the 5 s scan", async () => {
    const { base, dir } = start();
    const spec = join(dir, "root", "aide", "specs", SPEC);
    const analysis = `${PATH}?tab=analysis`;
    // Distinctive sentinels, not English words: the stylesheet is
    // inlined into every page, and a comment in it saying "before"
    // failed this test for a week's worth of head-scratching
    // (2026-08-24) while the files were being re-read just fine.
    writeFileSync(join(spec, "2-analysis.md"), "sentinel-first-write\n");
    expect(await (await fetch(`${base}${analysis}`)).text()).toContain("sentinel-first-write");
    writeFileSync(join(spec, "2-analysis.md"), "sentinel-second-write\n");
    const html = await (await fetch(`${base}${analysis}`)).text();
    expect(html).toContain("sentinel-second-write");
    expect(html).not.toContain("sentinel-first-write");
  });
});

