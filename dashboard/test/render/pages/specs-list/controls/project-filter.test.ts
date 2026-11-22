// The Project filter on Jobs and Specs: which projects it offers, and that a
// chosen project can always be cleared with All projects, even one the list
// leaves out because it is hidden.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { projectDropdown } from "../../../../../src/render/pages/specs-list/filter-bar.ts";

const offered = (project: string | undefined, projects: string[]): string[] => {
  const window = new Window();
  window.document.body.innerHTML = projectDropdown({ project }, projects, (p) => `/specs?project=${p}`, "en");
  return [...window.document.querySelectorAll("#project-filter .menupanel a")].map((a) => a.textContent!.trim());
};

describe("the Project filter", () => {
  test("is drawn for two projects or more, with All projects first, and not for one with nothing chosen", () => {
    expect(offered(undefined, ["aide", "gamma"])).toEqual(["All projects", "aide", "gamma"]);
    expect(offered(undefined, ["aide"])).toEqual([]);
  });

  test("a chosen project the list leaves out keeps its entry, and All projects clears it, with one project left (AC-3)", () => {
    expect(offered("beta", ["aide"])).toEqual(["All projects", "aide", "beta"]);
    expect(offered("beta", ["aide", "gamma"])).toEqual(["All projects", "aide", "gamma", "beta"]);
    expect(offered("aide", ["aide"])).toEqual(["All projects", "aide"]);
  });
});
