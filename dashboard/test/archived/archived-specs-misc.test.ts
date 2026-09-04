// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { sourceWithParts } from "../helpers/source-with-parts.ts";
import { ALL_VIEW, ARCHIVED, ARCHIVED_VIEW, STAMPED, auth, harness, order, specsList, stamp, start } from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- criteria 7, 8: the Archive tab retires --------------------------------

describe("the Archive tab", () => {
  test("is no longer in the navigation (criterion 7)", async () => {
    const html = await specsList(start().base);
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav).not.toContain('href="/archive"');
    expect(nav).not.toContain(">Archive<");
  });

  test("and its route is gone (criterion 8)", async () => {
    const { base } = start();
    expect((await fetch(`${base}/archive`, auth)).status).toBe(404);
  });
});

// --- criterion 10: the default view does not pay for the archive -----------

describe("building the archived rows", () => {
  // Asserted on the CODE, not on the response: a response that happened
  // to be fast, or one whose rows were built and then filtered out,
  // would both pass a test that only read the HTML. The repo does this
  // elsewhere for the same reason — `queue.test.ts` reads two
  // `errorReason` declarations as text and asserts they agree.
  // The declaration and its body live in spec-views.ts; the one call
  // site is handleQueue's, extracted into its own file since spec:
  // split serve.ts, step 2. Both moved out of serve.ts itself in step 3.
  // handleQueue's own body moved on again into handle-queue/page-routes.ts
  // (split of split serve.ts, step 3) — that is where the call site lives now.
  const specViewsSrc = sourceWithParts("serve/spec-views");
  const pageRoutesSrc = sourceWithParts("serve/handle-queue/page-routes");

  test("is asked for by the reader's own chip and by nothing else", () => {
    const calls = [...(specViewsSrc + pageRoutesSrc).matchAll(/\barchivedSpecRows\(([^)]*)\)/g)]
      .map((m) => m[1]!)
      // Its own declaration reads the same as a call; it is not one.
      .filter((arg) => !arg.includes(":"));
    expect(calls).toEqual(["chosenState"]);
  });

  test("skips a row before it reads anything for it (criterion 10)", () => {
    const body = specViewsSrc.slice(specViewsSrc.indexOf("function archivedSpecRows"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    // The gate is the resolved filter's own answer...
    expect(fn).toContain("filterShowsArchived(state)");
    // ...and it stands in front of the per-row file reads, which is what
    // makes it a gate rather than a filter over work already done.
    expect(fn.indexOf("continue;")).toBeLessThan(fn.indexOf("archivedAt(ctx, ref.dir)"));
    // Spec 224 added a SECOND read behind the same gate: the phase lines
    // a locked row now opens come off `4-status.md`'s own claim.
    expect(fn.indexOf("continue;")).toBeLessThan(fn.indexOf("archivedSteps(ref.dir)"));
  });

  test("and the gate answers for every chip there is", async () => {
    const { filterShowsArchived } = await import("../../src/render/pages/queue-list.ts");
    // Absent resolves to the default chip, which is All.
    expect(filterShowsArchived(undefined)).toBe(true);
    expect(filterShowsArchived("all")).toBe(true);
    expect(filterShowsArchived("archived")).toBe(true);
    expect(filterShowsArchived("not-archived")).toBe(false);
    for (const key of ["active", "done", "problem"]) {
      expect(filterShowsArchived(key)).toBe(false);
    }
    // A stale bookmark falls back to the same default.
    expect(filterShowsArchived("nonsense")).toBe(true);
  });

  test("the rows fragment the live refresh asks for is gated the same way", async () => {
    const { base } = start();
    // Default (All): the fragment carries the archived rows too.
    const rows = await (await fetch(`${base}/?rows=1`, auth)).text();
    for (const folder of Object.keys(ARCHIVED)) expect(rows).toContain(folder);
    // Active: the chip that cuts them cuts them here as well.
    const activeRows = await (await fetch(`${base}/?rows=1&state=not-archived`, auth)).text();
    for (const folder of Object.keys(ARCHIVED)) expect(activeRows).not.toContain(folder);
    const archivedRows = await (await fetch(`${base}/?rows=1&state=archived`, auth)).text();
    expect(archivedRows).toContain(STAMPED);
  });
});

// --- spec 226, criterion 1: no view leaves a spec off the page -------------
//
// This block pinned the opposite until spec 226: exactly 25 rows, and a
// line counting the rest. The archived and the combined views exist to
// be browsed and searched with the browser's own find, and find cannot
// reach a row the server never sent.

describe("an archive bigger than the page", () => {
  /** Thirty archived specs. aide alone has about 150 of them. */
  const MANY = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `${100 + i}-archived-spec`,
      { description: `# Spec ${100 + i} - Description\n`, status: stamp("2026-08-13") },
    ]),
  );

  test("the archived view shows all thirty (criterion 1)", async () => {
    const html = await specsList(start({}, MANY).base, ARCHIVED_VIEW);
    expect(order(html)).toHaveLength(30);
    expect(html).not.toContain("not shown");
  });

  test("and so does a combined view", async () => {
    const html = await specsList(start({}, MANY).base, ALL_VIEW);
    // Thirty archived plus the two live specs.
    expect(order(html)).toHaveLength(32);
    expect(html).not.toContain("not shown");
  });

  // The live-refresh route renders the same fragment, so a cap left in
  // one of the two would have shown as a list that shrank five seconds
  // after it was drawn.
  test("the five-second refresh sends the same thirty", async () => {
    const { base } = start({}, MANY);
    const rows = await (await fetch(`${base}/?rows=1&state=archived`, auth)).text();
    expect(order(rows)).toHaveLength(30);
    expect(rows).not.toContain("not shown");
  });
});
