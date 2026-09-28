// Spec 511: the Reopen confirmation page — one unticked box, and the answer
// posted as an ordinary queue request.

import { afterEach, describe, expect, test } from "bun:test";
import { ARCHIVED, STAMPED, harness, start } from "../../../archived/archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

describe("GET /specs/<project>/<spec>/reopen", () => {
  test("answers for an archived spec, handing the list's fields on AC-1", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/${STAMPED}/reopen?fromList=1&view.state=archived&junk=x`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Also reset the analysis, the plan and the status");
    expect(html).toContain('name="fromList" value="1"');
    expect(html).toContain('name="view.state" value="archived"');
    expect(html).not.toContain('name="junk"');
  });

  test("answers for a closed spec too AC-1", async () => {
    const closed = { [STAMPED]: { ...ARCHIVED[STAMPED], status: "- **Closed:** 2026-08-13 — not needed\n" } };
    const { base } = start({}, closed);
    const res = await fetch(`${base}/specs/aide/${STAMPED}/reopen`);
    expect(res.status).toBe(200);
  });

  test("answers 404 for an active spec AC-1", async () => {
    const { base } = start();
    const res = await fetch(`${base}/specs/aide/81-queue-and-runner/reopen`);
    expect(res.status).toBe(404);
  });
});
