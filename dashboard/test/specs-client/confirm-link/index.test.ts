// The click on a link that has a confirmation box beside it: the box
// opens over the page instead of the link being followed. Moved from
// `bindScheduleDelete` (spec 525), which only the schedule's Delete used.
import { describe, expect, test } from "bun:test";
import { bindConfirmLink } from "../../../src/specs-client/confirm-link/index.ts";

describe("bindConfirmLink (AC-1)", () => {
  function fakeRow(o: { hasDialog?: boolean; modal?: boolean } = {}) {
    const opened: string[] = [];
    const dialog = o.modal === false ? {} : { showModal: () => void opened.push("open") };
    const cell = { querySelector: (sel: string) => (sel === "dialog" && o.hasDialog !== false ? dialog : null) };
    const listeners: ((e: Event) => void)[] = [];
    const link = {
      parentElement: cell,
      addEventListener: (_name: string, fn: (e: Event) => void) => void listeners.push(fn),
    };
    const click = () => {
      let prevented = false;
      const event = { preventDefault: () => void (prevented = true) } as unknown as Event;
      for (const fn of listeners) fn(event);
      return prevented;
    };
    return { link, click, opened, bound: () => listeners.length };
  }

  test("the click opens the dialog beside it and does not follow the link (AC-1)", () => {
    const row = fakeRow();
    bindConfirmLink(row.link as unknown as HTMLAnchorElement);
    expect(row.click()).toBe(true);
    expect(row.opened).toEqual(["open"]);
  });

  test("a link with no dialog beside it is left alone (AC-1)", () => {
    const row = fakeRow({ hasDialog: false });
    bindConfirmLink(row.link as unknown as HTMLAnchorElement);
    expect(row.bound()).toBe(0);
  });

  test("a browser without showModal is left alone too (AC-1)", () => {
    const row = fakeRow({ modal: false });
    bindConfirmLink(row.link as unknown as HTMLAnchorElement);
    expect(row.bound()).toBe(0);
  });
});
