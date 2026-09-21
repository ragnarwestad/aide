// The Steps tab's reload timer: it reloads the page every N seconds, but
// not while a dialog is open (spec 525).
import { describe, expect, test } from "bun:test";
import { reloadTick } from "../../../src/specs-client/reload-while-idle/index.ts";

describe("reloadTick (AC-1)", () => {
  test("reloads the page when no dialog is open (AC-1)", () => {
    const calls: string[] = [];
    reloadTick({ querySelector: () => null } as unknown as Document, () => calls.push("reload"));
    expect(calls).toEqual(["reload"]);
  });

  test("does not reload while a dialog is open (AC-1)", () => {
    const calls: string[] = [];
    const doc = { querySelector: (sel: string) => (sel === "dialog[open]" ? {} : null) } as unknown as Document;
    reloadTick(doc, () => calls.push("reload"));
    expect(calls).toEqual([]);
  });
});
