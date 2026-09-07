// The page the test-server link opens. Two states, and no navigation of
// its own: this tab was opened from the spec page, which is still
// standing in the one behind it.

import { describe, expect, test } from "bun:test";
import { boardFailedPage, waitingForBoardPage } from "../../src/serve/handle-queue/spec-edit/board-waiting.ts";

const body = (r: Response) => r.text();

describe("waiting for a test server", () => {
  test("names the spec in quotes, so it reads apart from the sentence", async () => {
    const html = await body(waitingForBoardPage("aide", "415-specs-og-new-spec-side-layout"));
    expect(html).toContain('Starting a test server for "415-specs-og-new-spec-side-layout"');
  });

  test("comes back by itself, and says something is coming", async () => {
    const html = await body(waitingForBoardPage("aide", "415-x"));
    expect(html).toMatch(/http-equiv="refresh"/);
    expect(html).toContain('class="spin"');
    expect(html).toContain("leave it open");
  });

  // The reader clicked a link in the spec page; that page is still open.
  test("offers no way back to the spec", async () => {
    const html = await body(waitingForBoardPage("aide", "415-x"));
    expect(html).not.toContain("Back to the spec");
    expect(html).not.toContain("<a ");
  });
});

describe("a test server that could not start", () => {
  test("says so, with the round's own words, and stops refreshing", async () => {
    const html = await body(boardFailedPage("415-x", "port already held"));
    expect(html).toContain('Could not start a test server for "415-x"');
    expect(html).toContain("port already held");
    expect(html).not.toMatch(/http-equiv="refresh"/);
    // The ELEMENT, not the word: the stylesheet is shared, so its own
    // `.spin` rule is in both pages either way.
    expect(html).not.toContain('class="spin"');
  });

  test("with nothing to quote, it still says what happened", async () => {
    const html = await body(boardFailedPage("415-x"));
    expect(html).toContain("did not report an address");
  });

  // Arbitrary text off a log reaches this page.
  test("the round's words are escaped", async () => {
    const html = await body(boardFailedPage("415-x", "<script>alert(1)</script>"));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
