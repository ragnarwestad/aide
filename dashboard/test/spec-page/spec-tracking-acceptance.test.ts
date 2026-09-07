// Spec 394: the acceptance half of the banner's `/tracking` route
// (REQ-6, REQ-10). The depends-on half of this same route is covered by
// spec-depends-on-field.test.ts; this file is the acceptance switch's
// own coverage, plus the route's shared refusals (archived, busy).

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { queueHarness, statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN, SPEC, TRACKING, FILE_SHA, ARCHIVED, ARCHIVED_TEXT, archivedDescriptionPath,
  descriptionPath, savable, post,
} from "./spec-save-fixtures.ts";

const harness = queueHarness("aide-spec-tracking-");
afterEach(() => harness.cleanup());

// Its own fixture: Tracking info with a `Created:` line to anchor on.
const TRACKED = (line = "") =>
  "# Queue and runner - Description\n\n## Tracking info\n\n" +
  `- **Task:** \`${SPEC}/\`\n- **Created:** \`2026-08-21\`\n` +
  (line ? `${line}\n` : "") +
  "\n---\n\n## Description\n\nAs it was.\n";
const ACCEPT_LINE = "- **Acceptance:** not required";

const track = (base: string, body: Record<string, string>) => post(base, body, TRACKING);

describe("the acceptance switch on the spec page's tracking route", () => {
  // The box asks the POSITIVE question — "acceptance ticking required" —
  // so a CLEARED box (nothing posted beyond the editable sentinel) is
  // what writes the spec's `**Acceptance:** not required` line.
  test("REQ-10: the box CLEARED writes the not-required line", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { acceptanceEditable: "1", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(ACCEPT_LINE));
  });

  test("REQ-10: the box TICKED removes an existing not-required line", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(ACCEPT_LINE),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { acceptanceEditable: "1", acceptanceRequired: "1", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // The locked render draws no `<input>` at all (a `<span>` instead), so
  // a real browser posting that form never sends `acceptanceEditable` —
  // this is the byte-for-byte behaviour that absence must produce:
  // nothing about acceptance changes, whatever a stray field says.
  test("no acceptanceEditable sentinel leaves the acceptance record untouched", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(ACCEPT_LINE),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { acceptanceNotRequired: "0", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(ACCEPT_LINE));
  });

  // REQ-6: once analyze has already decided the question, the acceptance
  // half is refused outright — nothing is written, including any
  // depends-on change bundled in the same request.
  test("REQ-6: refused once analyze has already run, and nothing is written", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create", "analyze"]),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { acceptanceEditable: "1", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("analyze has already decided");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // REQ-7: the depends-on half stays legal after analyze — only the
  // acceptance half is locked.
  test("a depends-on-only edit still succeeds once analyze has run", async () => {
    const OTHER = "99-a-second-spec";
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create", "analyze"]),
      alsoSpecs: [OTHER],
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(`- **Depends on:** \`${OTHER}\``));
  });

  test("an archived spec refuses the route entirely", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await post(
      base,
      { acceptanceEditable: "1", baseSha: FILE_SHA },
      `/api/queue/specs/aide/${ARCHIVED}/tracking`,
    );
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("error=");
    expect(location).toContain("archived");
    expect(readFileSync(archivedDescriptionPath(dir), "utf-8")).toBe(ARCHIVED_TEXT);
  });

  test("a stale baseSha is refused, and nothing is written", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await track(base, { acceptanceEditable: "1", acceptanceNotRequired: "1", baseSha: "stale-sha" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("changed since");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  test("no token, no save", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await post(base, { acceptanceEditable: "1", baseSha: FILE_SHA }, TRACKING, null);
    expect(res.status).toBe(401);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });
});
