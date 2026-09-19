// Spec 511: the Reopen confirmation page — one unticked box, and the answer
// posted as an ordinary queue request.

import { afterEach, describe, expect, test } from "bun:test";
import { renderReopenSpecPage } from "../../../../src/render";
import { ARCHIVED, STAMPED, harness, start } from "../../../archived/archived-specs-fixtures.ts";
import { GENERATED, NAV } from "../spec-page-fixtures.ts";

afterEach(() => harness.cleanup());

const FOLDER = "150-one-page-shows-the-whole-spec";
const render = (handOn?: Record<string, string>) =>
  renderReopenSpecPage("aide", FOLDER, NAV, GENERATED, { handOn });

describe("the Reopen confirmation page", () => {
  test("shows the box, not ticked, with its label AC-1", () => {
    const html = render();
    expect(html).toContain("Also reset the analysis, the plan and the status");
    const box = html.match(/<input[^>]*name="resetFiles"[^>]*>/)?.[0] ?? "";
    expect(box).toContain('type="checkbox"');
    expect(box).not.toContain("checked");
  });

  test("posts to the queue as a reopen for this spec, with no resetFiles unless ticked AC-1", () => {
    const html = render();
    expect(html).toMatch(/<form[^>]*method="post"[^>]*action="\/api\/queue"|<form[^>]*action="\/api\/queue"[^>]*method="post"/);
    expect(html).toContain('name="project" value="aide"');
    expect(html).toContain(`name="specFolder" value="${FOLDER}"`);
    expect(html).toContain('name="steps" value="reopen"');
    // Only the checkbox can carry the field, and it is unticked.
    expect(html.match(/name="resetFiles"/g)).toHaveLength(1);
    expect(html).not.toContain('name="fromList"');
  });

  test("hands fromList and the filter on, so the answer comes back to the list AC-1", () => {
    const html = render({ fromList: "1", "view.state": "archived" });
    expect(html).toContain('name="fromList" value="1"');
    expect(html).toContain('name="view.state" value="archived"');
  });

  test("Cancel goes back to the spec page AC-1", () => {
    expect(render()).toContain(`href="/specs/aide/${FOLDER}"`);
  });
});

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
