// Split out of spec-save.test.ts by theme.
//
// --- spec 166: the dependency is a field on this page, not markdown ---------
//
// The `Depends on:` line was writable only at creation. It IS a line in
// this very file, so the field belongs to the writer this file already
// has — and it is the SOLE writer: the GET strips the raw line out of
// the textarea, the POST always rebuilds it from the field. Two
// controls for one fact can disagree; one cannot.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  TOKEN, SPEC, SAVE, DESCRIPTION_TAB, FILE_SHA, DESCRIPTION, auth,
  ARCHIVED, ARCHIVED_TEXT, createSpecSaveHarness, descriptionPath, savable, post,
} from "./spec-save-fixtures.ts";

const { harness } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

describe("the Depends on field", () => {
  const OTHER = "99-a-second-spec";
  // Its own fixture: the suite's plain DESCRIPTION has no Tracking
  // info, and `- **Created:**` is what the line is placed after.
  const TRACKED = (line = "") =>
    "# Queue and runner - Description\n\n## Tracking info\n\n" +
    `- **Task:** \`${SPEC}/\`\n- **Created:** \`2026-08-21\`\n` +
    (line ? `${line}\n` : "") +
    "\n---\n\n## Description\n\nAs it was.\n";
  const DEPENDS = (id: string) => `- **Depends on:** \`${id}\``;

  /** The same savable checkout, plus a sibling spec to depend on and an
   *  archived one — resolving both is the point of half these tests. */
  const startTracked = (gitRun: GitRunner, description = TRACKED()) =>
    harness.start({
      description,
      alsoSpecs: [OTHER],
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
      extra: { queueToken: TOKEN, gitRun },
    });

  /** `savable`, wrapped to count what it was asked to commit: "one
   *  commit, the one saveSpecFile already makes" is the criterion, and
   *  a second write would show up here and nowhere else. */
  const counting = (commits: string[]): GitRunner => {
    const inner = savable("/host");
    return async (dir, args) => {
      if (args[0] === "commit") commits.push(args.join(" "));
      return inner(dir, args);
    };
  };

  // --- criteria 1, 2: what the page opens with ------------------------------

  test("a spec that depends on nothing opens with nothing ticked", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    // Spec 174: a box per spec in the project, as on the New-spec page
    // — never a line to type an identifier into.
    expect(html).toContain(`value="${OTHER}"`);
    expect(html).not.toContain('<input type="text" name="dependsOn"');
    // The boxes, not the whole document: the stylesheet carries a
    // `.checked` rule of its own.
    for (const box of html.match(/<input[^>]*name="dependsOn"[^>]*>/g) ?? []) {
      expect(box).not.toContain("checked");
    }
    expect(html).not.toContain("Depends on:**");
  });

  test("an existing line ticks its box and leaves the textarea", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).toMatch(new RegExp(`value="${OTHER}"[^>]*checked`));
    // The raw markdown is gone from the box: one control for one fact.
    expect(html).not.toContain("Depends on:**");
    expect(html).toContain("As it was.");
  });

  // Spec 174. The line is written by hand as often as by this page, and
  // `resolve_dependency_folder` has always taken a bare number — so the
  // box that gets ticked is the one the RUNNER would resolve the line
  // to, not the one whose folder happens to match the text.
  test("a dependency written as a bare number ticks the spec it resolves to", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS("99")));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).toMatch(new RegExp(`value="${OTHER}"[^>]*checked`));
  });

  // A spec cannot depend on itself, and spec 166 spent a refusal saying
  // so. With a list of real specs the case mostly stops arising: the
  // one box that would say it is not drawn.
  test("the spec being edited is not among the boxes", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).not.toContain(`value="${SPEC}"`);
  });

  // The narrowing this control brings, stated as a test rather than
  // left to be discovered: `targets()` is the live list, so an archived
  // spec is not offered as a NEW dependency. One already written into
  // the line still resolves and still gates the run.
  test("an archived spec is not offered as a new dependency", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).not.toContain(`value="${ARCHIVED}"`);
  });

  // --- criterion 8: when the change takes effect ----------------------------

  test("the page says the change applies from the next gated step", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).toContain("next gated step");
    expect(html).toContain("already running");
  });

  // --- criteria 3, 4, 7: what a save writes ---------------------------------

  test("a spec in the project is written into Tracking info, in one commit", async () => {
    const commits: string[] = [];
    const { base, dir } = startTracked(counting(commits));
    const res = await post(base, { text: TRACKED(), dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
    expect(commits).toHaveLength(1);
  });

  // `blockedDependencies` says so itself: archiving only happens to
  // finished work, so an archived dependency is a satisfied one.
  test("an archived spec is a legitimate dependency, not an unknown one", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: ARCHIVED, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(ARCHIVED)));
  });

  // The bare number is what a person types, and it is what the runtime
  // gate resolves — save-time validation has to accept the same shapes.
  test("a bare number resolves the same way the gate resolves it", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: "99", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS("99")));
  });

  // Spec 174: what the checkbox set actually POSTs — the field repeated
  // once per ticked box, where the old text input sent one comma-joined
  // string. The route already took both shapes; this is the regression
  // check that says so out loud.
  test("two ticked boxes arrive as two fields and both are written", async () => {
    const THIRD = "88-a-third-spec";
    const { base, dir } = harness.start({
      description: TRACKED(),
      alsoSpecs: [OTHER, THIRD],
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const body = new URLSearchParams([
      ["text", TRACKED()],
      ["baseSha", FILE_SHA],
      ["dependsOn", OTHER],
      ["dependsOn", THIRD],
    ]);
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(`${DEPENDS(OTHER)}, \`${THIRD}\``));
  });

  test("emptying the field removes the line", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const res = await post(base, { text: TRACKED(), dependsOn: "", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // --- criteria 5, 6: what a save refuses -----------------------------------

  test("a spec nobody has is refused by name, and nothing is written", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const res = await post(base, { text: TRACKED(), dependsOn: "77-no-such-spec", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
    expect(location).toContain("77-no-such-spec");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  test("a spec cannot depend on itself, by folder or by number", async () => {
    for (const id of [SPEC, "81"]) {
      const { base, dir } = startTracked(savable("/host"));
      const res = await post(base, { text: TRACKED(), dependsOn: id, baseSha: FILE_SHA });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
      expect(location).toContain("itself");
      expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
    }
  });

  // One bad entry refuses the lot rather than being filtered out — the
  // same discipline every other list-shaped field here keeps.
  test("one unknown entry in a list refuses the whole save", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: `${OTHER}, 77-no-such`, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("77-no-such");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // Every template writes `Created:`; a description hand-edited past it
  // has nowhere for the line to go, and a guess would be worse.
  test("no Created line to place it after is refused, not guessed at", async () => {
    const { base, dir } = startTracked(savable("/host"), DESCRIPTION);
    const res = await post(base, { text: DESCRIPTION, dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
    expect(location).toContain("Created");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // The field wins over whatever the textarea says about that one line,
  // which is what "one writer" means when both arrive in one POST.
  test("a line typed into the textarea does not survive the field", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(DEPENDS("77-no-such")), dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });
});
