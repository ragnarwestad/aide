// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import { sourceWithParts } from "../helpers/source-with-parts.ts";
import { ALL_VIEW, ARCHIVED, ARCHIVED_VIEW, STAMPED, harness, order, specsList, stamp, start } from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- The default view does not pay for the archive -----------

describe("building the archived rows", () => {
  const specViewsSrc = sourceWithParts("serve/spec-views");

  test("skips a row before it reads anything for it", () => {
    const body = specViewsSrc.slice(specViewsSrc.indexOf("function archivedSpecRows"));
    const fn = body.slice(0, body.indexOf("\n}\n"));
    // The gate is the resolved filter's own answer...
    expect(fn).toContain("filterShowsArchived(state)");
    // ...and it stands in front of the per-row file reads, which is what
    // makes it a gate rather than a filter over work already done: the
    // phase lines a locked row opens come off `4-status.md`'s own claim.
    // The reads are in the row builder (`archivedRow`, through
    // `openedRowFields`), which is only called after the gate.
    const bodyOf = (name: string) => {
      const from = specViewsSrc.slice(specViewsSrc.indexOf(`function ${name}(`));
      return from.slice(0, from.indexOf("\n}\n"));
    };
    expect(bodyOf("archivedRow")).toContain("openedRowFields(");
    expect(bodyOf("openedRowFields")).toContain("archivedSteps(ref.dir)");
    const gate = fn.search(/if \(!everyOne\b[^\n]*continue;/);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(fn.indexOf("archivedRow("));
  });

  test("and the gate answers for every chip there is", async () => {
    const { filterShowsArchived } = await import("../../src/render/pages/specs-list");
    // Absent resolves to the default chip, which is All.
    expect(filterShowsArchived(undefined)).toBe(true);
    expect(filterShowsArchived("all")).toBe(true);
    expect(filterShowsArchived("archived")).toBe(true);
    // A closed spec's folder is under archive/ too: the Closed chip
    // needs the walk, or it counts rows it never lists.
    expect(filterShowsArchived("closed")).toBe(true);
    expect(filterShowsArchived("not-verified")).toBe(true);
    expect(filterShowsArchived("not-archived")).toBe(false);
    for (const key of ["active", "created", "idle", "reopened"]) {
      expect(filterShowsArchived(key)).toBe(false);
    }
    // A stale bookmark falls back to the same default.
    expect(filterShowsArchived("nonsense")).toBe(true);
  });

  test("the rows fragment the live refresh asks for is gated the same way", async () => {
    const { base } = start();
    // Default (All): the fragment carries the archived rows too.
    const rows = await (await fetch(`${base}/specs?rows=1`)).text();
    for (const folder of Object.keys(ARCHIVED)) expect(rows).toContain(folder);
    // Active: the chip that cuts them cuts them here as well.
    const activeRows = await (await fetch(`${base}/specs?rows=1&state=not-archived`)).text();
    for (const folder of Object.keys(ARCHIVED)) expect(activeRows).not.toContain(folder);
    const archivedRows = await (await fetch(`${base}/specs?rows=1&state=archived`)).text();
    expect(archivedRows).toContain(STAMPED);
  });
});

describe("an archive that fits in the first batch", () => {
  /** Thirty archived specs. aide alone has about 150 of them. */
  const MANY = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `${100 + i}-archived-spec`,
      { description: `# Spec ${100 + i} - Description\n`, status: stamp("2026-08-13") },
    ]),
  );

  test("the archived view shows all thirty", async () => {
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
    const rows = await (await fetch(`${base}/specs?rows=1&state=archived`)).text();
    expect(order(rows)).toHaveLength(30);
    expect(rows).not.toContain("not shown");
  });
});
