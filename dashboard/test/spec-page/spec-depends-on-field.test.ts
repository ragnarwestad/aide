// Split out of spec-save.test.ts by theme; moved off SAVE onto TRACKING
// by spec 394 (REQ-1): the depends-on picker no longer rides on the
// Description tab's own form — it is drawn in the banner, above the tab
// row, on every tab, and posts to the banner's own route.
//
// The `Depends on:` line was writable only at creation. It IS a line in
// this very file, so the field belongs to the writer this file already
// has — and it is the SOLE writer: the GET strips the raw line out of
// the textarea, the POST always rebuilds it from the field. Two
// controls for one fact can disagree; one cannot.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../../src/git/branch-status.ts";
import { QUEUE_DEFAULTS } from "../../src/serve/serve-helpers";
import { SPEC, PAGE, SAVE, TRACKING, FILE_SHA, DESCRIPTION, ARCHIVED, ARCHIVED_TEXT, createSpecSaveHarness, descriptionPath, savable, post, answer } from "./spec-save-fixtures.ts";

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
      extra: { gitRun },
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

  const track = (base: string, body: Record<string, string>) => post(base, body, TRACKING);

  // --- what the open row's picker opens with (spec 635) ----------------------

  /** The `<input>` tags the page posts as `dependsOn`, by folder. */
  const chips = (html: string) =>
    [...html.matchAll(/<input [^>]*name="dependsOn"[^>]*>/g)].map((m) => m[0]).filter((tag) => /value="[^"]+"/.test(tag));
  const chipFor = (html: string, folder: string) => chips(html).find((tag) => tag.includes(`value="${folder}"`));
  const ticked = (html: string, folder: string) => chipFor(html, folder)?.includes(" checked") ?? false;
  const pageOf = async (base: string) => (await fetch(`${base}${PAGE}`)).text();
  /** The Specs list's rows, and this spec's own line among them. */
  const rowOf = async (base: string) => {
    const html = await (await fetch(`${base}/?rows=1`)).text();
    return html.match(new RegExp(`data-folder="${SPEC}"[\\s\\S]*?</tr>`))?.[0] ?? "";
  };

  // Spec 174. The line is written by hand as often as by this page, and
  // `resolve_dependency_folder` has always taken a bare number — so the
  // box that gets ticked is the one the RUNNER would resolve the line
  // to, not the one whose folder happens to match the text.
  test("a dependency written as a bare number ticks the spec it resolves to (AC-1)", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS("99")));
    expect(ticked(await pageOf(base), OTHER)).toBe(true);
  });

  test("the picker offers the project's active specs, not the spec itself and not an archived one (AC-2)", async () => {
    const THIRD = "88-a-third-spec";
    const { base } = harness.start({
      description: TRACKED(),
      alsoSpecs: [OTHER, THIRD],
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
      extra: { gitRun: savable("/host") },
    });
    const html = await pageOf(base);
    expect(chips(html).map((tag) => tag.match(/value="([^"]+)"/)![1])).toEqual([OTHER, THIRD].sort().reverse());
    expect(chipFor(html, SPEC)).toBeUndefined();
    expect(chipFor(html, ARCHIVED)).toBeUndefined();
  });

  test("a dependency since archived is drawn ticked, and so is one since closed (AC-4)", async () => {
    const CLOSED = "140-a-closed-one";
    const { base } = harness.start({
      description: TRACKED(`${DEPENDS(ARCHIVED)}, \`${CLOSED}\``),
      alsoSpecs: [OTHER],
      archivedSpecs: {
        [ARCHIVED]: { description: ARCHIVED_TEXT },
        [CLOSED]: { description: "# Closed - Description\n", status: "**Closed:** 2026-10-01 — did not hold\n" },
      },
      extra: { gitRun: savable("/host") },
    });
    const html = await pageOf(base);
    expect(ticked(html, ARCHIVED)).toBe(true);
    expect(ticked(html, CLOSED)).toBe(true);
    expect(ticked(html, OTHER)).toBe(false);
  });

  test("an archived spec's own page draws no Depends on field (AC-5)", async () => {
    const { base } = harness.start({
      description: TRACKED(),
      alsoSpecs: [OTHER],
      archivedSpecs: { [ARCHIVED]: { description: `${TRACKED(DEPENDS(OTHER))}` } },
      extra: { gitRun: savable("/host") },
    });
    const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}`)).text();
    expect(html).not.toContain('name="dependsOn"');
  });

  // --- criteria 3, 4, 7: what a save writes ---------------------------------

  test("a spec in the project is written into Tracking info, in one commit", async () => {
    const commits: string[] = [];
    const { base, dir } = startTracked(counting(commits));
    const { status, body } = await answer(await track(base, { dependsOn: OTHER, baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
    expect(commits).toHaveLength(1);
  });

  // `blockedDependencies` says so itself: archiving only happens to
  // finished work, so an archived dependency is a satisfied one.
  test("an archived spec is a legitimate dependency, not an unknown one", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const { status, body } = await answer(await track(base, { dependsOn: ARCHIVED, baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(ARCHIVED)));
  });

  // The bare number is what a person types, and it is what the runtime
  // gate resolves — save-time validation has to accept the same shapes.
  test("a bare number resolves the same way the gate resolves it", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const { status, body } = await answer(await track(base, { dependsOn: "99", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
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
      extra: { gitRun: savable("/host") },
    });
    const body = new URLSearchParams([
      ["baseSha", FILE_SHA],
      ["dependsOn", OTHER],
      ["dependsOn", THIRD],
    ]);
    const { status, body: answered } = await answer(await fetch(`${base}${TRACKING}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      redirect: "manual",
      body: body.toString(),
    }));
    expect(status).toBe(200);
    expect(answered.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(`${DEPENDS(OTHER)}, \`${THIRD}\``));
  });

  test("emptying the field removes the line", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const { status, body } = await answer(await track(base, { dependsOn: "", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // The picker's form is the only writer of the line, and a browser
  // posts nothing for a box left unticked: the form carries one empty
  // entry, so a picker cleared of every box still posts, and the route
  // reads it as no dependencies.
  test("the empty entry beside the boxes clears the last dependency, and the row's line follows (AC-3)", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    expect(await rowOf(base)).toContain("Depends on: 99");
    const { status } = await answer(await track(base, { dependsOn: "", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
    expect(await rowOf(base)).not.toContain("Depends on:");
  });

  test("a changed Depends on is named on the row's own line right after the save, though the rows were answered before (AC-3)", async () => {
    const { base, dir } = startTracked(savable("/host"));
    expect(await rowOf(base)).not.toContain("Depends on:");
    const body = new URLSearchParams([["baseSha", FILE_SHA], ["dependsOn", ""], ["dependsOn", OTHER]]);
    const { status } = await answer(await fetch(`${base}${TRACKING}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
    expect(await rowOf(base)).toContain("Depends on: 99");
  });

  test("a dependency since archived is kept when posted with the rest, and dropped when left out (AC-4)", async () => {
    const both = `${DEPENDS(ARCHIVED)}, \`${OTHER}\``;
    const start = () => startTracked(savable("/host"), TRACKED(both));
    const kept = start();
    await track(kept.base, { dependsOn: ARCHIVED, baseSha: FILE_SHA });
    expect(readFileSync(descriptionPath(kept.dir), "utf-8")).toContain(ARCHIVED);
    const dropped = start();
    const body = new URLSearchParams([["baseSha", FILE_SHA], ["dependsOn", ""], ["dependsOn", OTHER]]);
    await fetch(`${dropped.base}${TRACKING}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(readFileSync(descriptionPath(dropped.dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  // The Description tab shows the description without the line and posts
  // what it is given, so its save would remove the line the picker wrote.
  test("saving the Description tab keeps the spec's Depends on line (AC-3)", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const text = TRACKED().replace("As it was.", "As it is now.");
    const { status } = await answer(await post(base, { text, baseSha: FILE_SHA }, SAVE));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)).replace("As it was.", "As it is now."));
  });

  test("a Description save of a spec with no dependency gains no line, and one that has lost its Created line is refused (AC-3)", async () => {
    const plain = startTracked(savable("/host"));
    await post(plain.base, { text: TRACKED().replace("As it was.", "Changed."), baseSha: FILE_SHA }, SAVE);
    expect(readFileSync(descriptionPath(plain.dir), "utf-8")).toBe(TRACKED().replace("As it was.", "Changed."));
    harness.cleanup();

    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const { status } = await answer(await post(base, { text: DESCRIPTION, baseSha: FILE_SHA }, SAVE));
    expect(status).toBe(400);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  // --- criteria 5, 6: what a save refuses -----------------------------------

  test("a spec nobody has is refused by name, and nothing is written", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const { status, body } = await answer(await track(base, { dependsOn: "77-no-such-spec", baseSha: FILE_SHA }));
    expect(status).toBe(400);
    expect(body.error).toContain("77-no-such-spec");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  test("a spec cannot depend on itself, by folder or by number", async () => {
    for (const id of [SPEC, "81"]) {
      const { base, dir } = startTracked(savable("/host"));
      const { status, body } = await answer(await track(base, { dependsOn: id, baseSha: FILE_SHA }));
      expect(status).toBe(400);
      expect(body.error).toContain("itself");
      expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
    }
  });

  // One bad entry refuses the lot rather than being filtered out — the
  // same discipline every other list-shaped field here keeps.
  test("one unknown entry in a list refuses the whole save", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const { status, body } = await answer(await track(base, { dependsOn: `${OTHER}, 77-no-such`, baseSha: FILE_SHA }));
    expect(status).toBe(400);
    expect(body.error).toContain("77-no-such");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // Every template writes `Created:`; a description hand-edited past it
  // has nowhere for the line to go, and a guess would be worse.
  test("no Created line to place it after is refused, not guessed at", async () => {
    const { base, dir } = startTracked(savable("/host"), DESCRIPTION);
    const { status, body } = await answer(await track(base, { dependsOn: OTHER, baseSha: FILE_SHA }));
    expect(status).toBe(400);
    expect(body.error).toContain("Created");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });
  // --- an analyze stopped on shared files: saving Depends on queues Analyze --

  describe("after an analyze stopped on files another open spec changes", () => {
    const STOPPED = (stopReason = "shared-files") => ({
      id: "stopped-1", project: "aide", specFolder: SPEC,
      steps: ["analyze", "implement", "archive"], stepIndex: 0,
      state: "stopped", stopReason,
      model: { analyze: "opus", implement: "opus", archive: "sonnet" },
      effort: { analyze: "high", implement: "medium" },
      timeoutSec: {}, permissionMode: {},
      createdAt: "2026-10-05T08:00:00.000Z", spentUsd: 0,
      results: [{
        step: "analyze", ok: false, costUsd: 0, costMeasured: true, terminalReason: stopReason,
        ...(stopReason === "shared-files" ? { sharedFiles: [{ spec: OTHER, files: ["x.ts"] }] } : {}),
      }],
    });

    const startStopped = (job: Record<string, unknown>) =>
      harness.start({
        description: TRACKED(),
        alsoSpecs: [OTHER, "88-a-third-spec"],
        queueMirror: JSON.stringify([job]),
        // The queued job names its models, and a request may only name a listed one.
        extra: { gitRun: savable("/host"), queueDefaults: { ...QUEUE_DEFAULTS, modelChoices: { opus: {}, sonnet: {} } } },
      });

    const allJobs = async (base: string) =>
      ((await (await fetch(`${base}/api/queue`)).json()) as {
        jobs: { id: string; specFolder: string; state: string; steps: string[]; model?: Record<string, string>; effort?: Record<string, string> }[];
      }).jobs;
    const jobsOfSpec = async (base: string) => {
      const jobs = await allJobs(base);
      // The stopped job the fixture started with is still on the board.
      expect(jobs.find((j) => j.id === "stopped-1")?.state).toBe("stopped");
      return jobs.filter((j) => j.specFolder === SPEC && j.id !== "stopped-1");
    };

    test("naming a spec the stop named queues one Analyze with the stopped job's remaining steps, on its models and effort (AC-5)", async () => {
      const { base } = startStopped(STOPPED());
      const { status, body } = await answer(await track(base, { dependsOn: OTHER, baseSha: FILE_SHA }));
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      const queued = await jobsOfSpec(base);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.steps).toEqual(["analyze", "implement", "archive"]);
      expect(queued[0]!.model).toMatchObject({ analyze: "opus", implement: "opus", archive: "sonnet" });
      expect(queued[0]!.effort).toMatchObject({ analyze: "high", implement: "medium" });
    });

    test("naming a spec the stop named among others still queues one Analyze (AC-5)", async () => {
      const { base } = startStopped(STOPPED());
      await track(base, { dependsOn: `88-a-third-spec, ${OTHER}`, baseSha: FILE_SHA });
      expect(await jobsOfSpec(base)).toHaveLength(1);
    });

    test("naming only a spec the stop did not name queues nothing (AC-5)", async () => {
      const { base } = startStopped(STOPPED());
      const { body } = await answer(await track(base, { dependsOn: "88-a-third-spec", baseSha: FILE_SHA }));
      expect(body.ok).toBe(true);
      expect(await jobsOfSpec(base)).toHaveLength(0);
    });

    test("emptying Depends on queues nothing (AC-5)", async () => {
      const { base } = startStopped(STOPPED());
      await track(base, { dependsOn: "", baseSha: FILE_SHA });
      expect(await jobsOfSpec(base)).toHaveLength(0);
    });

    test("a lead job that stopped for another reason queues nothing (AC-5)", async () => {
      const { base } = startStopped(STOPPED("acceptance-criteria"));
      const { body } = await answer(await track(base, { dependsOn: OTHER, baseSha: FILE_SHA }));
      expect(body.ok).toBe(true);
      expect(await jobsOfSpec(base)).toHaveLength(0);
    });

    test("with no job for the spec at all, a save queues nothing (AC-5)", async () => {
      const { base } = harness.start({
        description: TRACKED(), alsoSpecs: [OTHER], extra: { gitRun: savable("/host") },
      });
      await track(base, { dependsOn: OTHER, baseSha: FILE_SHA });
      expect(await allJobs(base)).toHaveLength(0);
    });
  });
});
