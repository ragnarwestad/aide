// A checkout the dashboard will not touch is said at the top of every
// page, not only in a log file.
//
// On 2026-09-21 woodstack's own checkout went missing. The queue said so
// once, at 09:03, in `~/Library/Logs/aide-dashboard/serve.log`; what the
// board showed was four rows with no spec number and the wrong state,
// and nothing anywhere said why. The board's own state belongs beside
// the install warning and the tool faults, where every visit sees it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createGitRunner } from "../../../src/git/branch-status.ts";
import { ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";

import { clearCheckoutFault, clearCheckoutFaults, setCheckoutFault } from "../../../src/render/ui/checkout-faults.ts";
import { complain } from "../../../src/serve/project-checkout.ts";
import { pageShell } from "../../../src/render/ui/shell.ts";

const ENTRIES = [{ label: "Projects", path: "/projects" }];
const AT = "2026-09-21T09:03:03Z";
const shell = () => pageShell("Projects", ENTRIES, "/projects", "<p>body</p>", AT);

// Process-lifetime state: a file that ran before this one in the same
// worker may have left a fault behind, and one left here would reach the
// next file's rendered pages.
beforeEach(() => {
  clearCheckoutFaults();
});
afterEach(() => {
  clearCheckoutFaults();
});

describe("the checkout-fault banner", () => {
  test("names the project and says what git said", () => {
    setCheckoutFault("woodstack", "/checkouts/woodstack/code is the project's own checkout, not a copy of one");

    const html = shell();

    expect(html).toContain("woodstack");
    expect(html).toContain("is the project's own checkout, not a copy of one");
    // Red, not amber: nothing about this project's rows can be trusted
    // until someone looks, unlike a tool fault, which blocks one run.
    expect(html).toContain('class="checkout-fault rowmsg failed"');
  });

  test("two broken checkouts are two lines, because they are two things to look at", () => {
    setCheckoutFault("woodstack", "one thing");
    setCheckoutFault("atlasaurus", "another thing");

    const lines = shell().match(/<p class="checkout-fault rowmsg failed">[\s\S]*?<\/p>/g) ?? [];

    expect(lines).toHaveLength(2);
  });

  test("a checkout that answers again takes its line away", () => {
    setCheckoutFault("woodstack", "one thing");
    clearCheckoutFault("woodstack");

    expect(shell()).not.toContain("checkout-fault");
  });

  test("nothing wrong is no banner at all", () => {
    expect(shell()).not.toContain("checkout-fault");
  });
});

// The wiring, at the one place that reports a checkout refusal: the
// banner has to be written by the same call that writes the log line, or
// the page and the log disagree about what is wrong right now.
describe("what complain() sets", () => {
  test("a refusal reaches the banner, and an answer afterwards clears it", () => {
    const ctx = { saidAbout: new Map<string, string>() } as Parameters<typeof complain>[0];

    complain(ctx, "woodstack", "/checkouts/woodstack/code is not there");
    expect(shell()).toContain("/checkouts/woodstack/code is not there");

    clearCheckoutFault("woodstack");
    expect(shell()).not.toContain("checkout-fault");
  });

  test("the same refusal twice is still one line", () => {
    const ctx = { saidAbout: new Map<string, string>() } as Parameters<typeof complain>[0];

    complain(ctx, "woodstack", "the same thing");
    complain(ctx, "woodstack", "the same thing");

    const lines = shell().match(/<p class="checkout-fault rowmsg failed">[\s\S]*?<\/p>/g) ?? [];
    expect(lines).toHaveLength(1);
  });
});

// Which refusals belong at the top of the page, and which are the board
// working as designed. A project whose own checkout has not been cloned
// yet is read from its own directory instead — that is the fallback every
// reader has had since spec 205, and shouting about it on every page
// would put a red line on a board where nothing is wrong.
describe("a checkout that is not there yet", () => {
  test("is the fallback, and says nothing on the page, when the project is readable", async () => {
    const where = mkdtempSync(join(tmpdir(), "aide-absent-"));
    const person = join(where, "aide");
    mkdirSync(person, { recursive: true });

    const result = await ensureDashboardCheckout(createGitRunner(), {
      base: join(where, "owned"),
      project: "aide",
      personDir: person,
    });

    expect(result.ok).toBe(false);
    expect(result.absent).toBe(true);
    rmSync(where, { recursive: true, force: true });
  });

  test("is a fault when the project's own directory is gone too", async () => {
    const where = mkdtempSync(join(tmpdir(), "aide-absent-"));

    const result = await ensureDashboardCheckout(createGitRunner(), {
      base: join(where, "owned"),
      project: "aide",
      // A checkout somebody removed by hand, or a link pointing at
      // nothing: there is no fallback left, and the board can say
      // nothing about the project's specs.
      personDir: join(where, "gone"),
    });

    expect(result.ok).toBe(false);
    expect(result.absent).toBe(false);
    rmSync(where, { recursive: true, force: true });
  });
});
