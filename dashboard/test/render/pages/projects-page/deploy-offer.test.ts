// Which Deploy a project's Deploy tab offers: no button on any project but
// the board's own, and on the board's own a button that is on only when a
// press would take something in.
import { describe, expect, test } from "bun:test";
import { deployOffer } from "../../../../src/render/pages/projects-page/project-page.ts";

const CHECKED = 1_700_000_000_000;
const serving = (current: boolean) => ({ sha: "a".repeat(40), checkoutHead: (current ? "a" : "b").repeat(40), current });

describe("deployOffer", () => {
  test("a project that is not the board's own gets no button, with or without an install command", () => {
    expect(deployOffer({ boardItself: false, drift: { behind: 2, checkedAt: CHECKED } })).toEqual({ kind: "other" });
    expect(deployOffer({ drift: undefined })).toEqual({ kind: "other" });
  });

  test("the board's own project with no install command gets no button", () => {
    expect(deployOffer({ boardItself: true })).toEqual({ kind: "no-install" });
  });

  test("origin asked and unable to answer gets no button", () => {
    expect(deployOffer({ boardItself: true, drift: { behind: null, checkedAt: CHECKED } })).toEqual({ kind: "unanswerable" });
  });

  test("origin not checked yet gets a button that is off", () => {
    expect(deployOffer({ boardItself: true, drift: { behind: null, checkedAt: null } }))
      .toMatchObject({ kind: "ask", notYetChecked: true, disabled: true });
  });

  test("behind origin gets a button that is on", () => {
    expect(deployOffer({ boardItself: true, drift: { behind: 3, checkedAt: CHECKED } }))
      .toEqual({ kind: "ask", notYetChecked: false, behind: 3, stale: false, disabled: false });
  });

  test("level with origin and serving it gets a button that is off", () => {
    expect(deployOffer({ boardItself: true, drift: { behind: 0, checkedAt: CHECKED }, serving: serving(true) }))
      .toMatchObject({ kind: "ask", stale: false, disabled: true });
  });

  test("level with origin but serving an older commit gets a button that is on", () => {
    expect(deployOffer({ boardItself: true, drift: { behind: 0, checkedAt: CHECKED }, serving: serving(false) }))
      .toMatchObject({ kind: "ask", stale: true, disabled: false });
  });
});
