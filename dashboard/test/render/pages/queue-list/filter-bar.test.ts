// Spec 311, REQ-1: `runsHelp()`'s own rendered output, pinned so
// rebuilding it on the shared `helpPopover()` component changes nothing
// a reader sees. `runsHelp()` itself is unexported, so this reaches it
// the same indirect route `state-dropdown.test.ts` already uses for the
// equally-private `stateDropdown()`: through the page it renders into.

import { describe, expect, test } from "bun:test";
import { renderQueuePage, type QueuePageOptions } from "../../../../src/render.ts";

const page = (opts: Partial<QueuePageOptions> = {}): string =>
  renderQueuePage([], "2026-08-30T00:00:00Z", [{ label: "Projects", path: "/projects" }], {
    runnerAvailable: true,
    targets: [],
    ...opts,
  });

/** The "What the search reads" popover's own markup. */
const introOf = (html: string): string =>
  html.match(/<details class="intro">[\s\S]*?<\/details>/)?.[0] ?? "";

describe("runsHelp() (spec 311, REQ-1)", () => {
  test("renders the exact popover this dashboard has always shown for the search field", () => {
    expect(introOf(page())).toBe(
      '<details class="intro"><summary title="What the search reads" ' +
        'aria-label="What the search reads">?</summary>' +
        "<p>Searches the project:folder, the title, the description — the whole " +
        "description, including the part the row does not show.</p></details>",
    );
  });
});
