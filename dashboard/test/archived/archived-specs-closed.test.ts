// Spec 406, REQ-7: a closed spec reads as closed, never as archived,
// wherever the Specs list shows a spec's state — extends the archived-
// specs suite (split by theme, like its siblings) with the one row
// shape those files never had: a folder under archive/ carrying a
// **Closed:** stamp instead of, or beside, an **Archived:** one.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ARCHIVED, LIVE, described, harness, order, specsList, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

const CLOSED_FOLDER = "70-the-idea-does-not-hold";
const CLOSED_REASON = "the idea does not hold up under real use";

const closedStamp = (date: string, reason: string) =>
  `# Status\n\n## Tracking info\n\n- **Workflow steps completed:** create, analyze\n` +
  `- **Closed:** ${date} — ${reason}\n`;

const WITH_CLOSED = {
  ...ARCHIVED,
  [CLOSED_FOLDER]: {
    description: described("The idea does not hold", "It seemed promising, then it did not."),
    status: closedStamp("2026-09-05", CLOSED_REASON),
  },
};

describe("spec 406, REQ-7: a closed spec's own row", () => {
  test("reads under the All chip, alongside the live and archived rows", async () => {
    const html = await specsList(start({}, WITH_CLOSED).base);
    expect(html).toContain(LIVE);
    expect(order(html)).toContain(CLOSED_FOLDER);
  });

  test("never appears under the Archived chip", async () => {
    const html = await specsList(start({}, WITH_CLOSED).base, "?state=archived");
    expect(order(html)).not.toContain(CLOSED_FOLDER);
    // The other, genuinely archived specs are unaffected.
    for (const folder of Object.keys(ARCHIVED)) expect(order(html)).toContain(folder);
  });

  test("never appears under the Active chip either", async () => {
    const html = await specsList(start({}, WITH_CLOSED).base, "?state=not-archived");
    expect(html).toContain(LIVE);
    expect(html).not.toContain(CLOSED_FOLDER);
  });

  test("does not inflate the Archived chip's own count", async () => {
    // WITH_CLOSED adds one closed spec beside the five archived ones —
    // the Archived chip's count must stay at 5, not climb to 6.
    const html = await specsList(start({}, WITH_CLOSED).base);
    expect(html).toMatch(/>Archived \(5\)</);
  });

  test("its row reads 'closed', never 'archived'", async () => {
    const html = await specsList(start({}, WITH_CLOSED).base, `?open=aide/${CLOSED_FOLDER}`);
    const row = html.slice(
      html.indexOf(`data-folder="${CLOSED_FOLDER}"`),
      html.indexOf(`data-folder="${CLOSED_FOLDER}"`) + 2000,
    );
    expect(row.toLowerCase()).toContain("closed");
    expect(row.toLowerCase()).not.toContain("archived");
  });
});
