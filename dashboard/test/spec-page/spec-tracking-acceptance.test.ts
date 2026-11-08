// The settings half of the banner's `/tracking` route
// acceptance, the checks level and choosing the approach. The depends-on half of this same route is covered by
// spec-depends-on-field.test.ts; this file is the acceptance switch's
// own coverage, plus the route's shared refusals (archived, busy).

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness, statusSaying } from "../helpers/queue-server.ts";
import { repoOf } from "../queue-routes/landing/every-step-lands-fixtures.ts";
import { ARCHIVE_RESULT, gitFor, runStep, serverWithRunner, settle, start as startLanding } from "../queue-routes/landing/archive-landing-fixtures.ts";
import { SPEC, TRACKING, FILE_SHA, ARCHIVED, ARCHIVED_TEXT, archivedDescriptionPath, descriptionPath, savable, post, answer } from "./spec-save-fixtures.ts";

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
  test("the box CLEARED writes the not-required line", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { settingsEditable: "1", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(ACCEPT_LINE));
  });

  test("the box TICKED removes an existing not-required line", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(ACCEPT_LINE),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { settingsEditable: "1", acceptanceRequired: "1", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // The locked render draws no `<input>` at all (a `<span>` instead), so
  // a real browser posting that form never sends `settingsEditable` —
  // this is the byte-for-byte behaviour that absence must produce:
  // nothing about acceptance changes, whatever a stray field says.
  test("no settingsEditable sentinel leaves the acceptance record untouched", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(ACCEPT_LINE),
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { acceptanceNotRequired: "0", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(ACCEPT_LINE));
  });

  // The form posts the acceptance switch alone, so a save leaves the spec's
  // Depends on line as it was.
  test("saving the switch keeps the spec's Depends on line", async () => {
    const DEPENDS = "- **Depends on:** 82";
    const { base, dir } = harness.start({
      description: TRACKED(DEPENDS),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const { status } = await answer(await track(base, { settingsEditable: "1", acceptanceRequired: "1", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toContain(DEPENDS);
  });

  // Once analyze has already decided the question, the acceptance
  // half is refused outright — nothing is written, including any
  // depends-on change bundled in the same request.
  test("refused once analyze has already run, and nothing is written", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create", "analyze"]),
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { settingsEditable: "1", baseSha: FILE_SHA }));
    expect(status).toBe(400);
    expect(body.error).toContain("analyze has already run");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // The depends-on half stays legal after analyze — only the
  // acceptance half is locked.
  test("a depends-on-only edit still succeeds once analyze has run", async () => {
    const OTHER = "99-a-second-spec";
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create", "analyze"]),
      alsoSpecs: [OTHER],
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { dependsOn: OTHER, baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(`- **Depends on:** \`${OTHER}\``));
  });

  // The checks level and choosing the approach are read by analyze too,
  // and saved by the same form under the same rule.
  test("the checks level and choosing the approach are written to the description", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const sent = { settingsEditable: "1", acceptanceRequired: "1", criteriaChecks: "warn", chooseApproach: "1", baseSha: FILE_SHA };
    const { status } = await answer(await track(base, sent));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(
      TRACKED("- **Acceptance criteria checks:** warn\n- **Let me choose the approach:** yes"),
    );
  });

  test("a cleared approach box writes no, and an unchanged level stays as written", async () => {
    const LINES = "- **Acceptance criteria checks:** stop\n- **Let me choose the approach:** yes";
    const { base, dir } = harness.start({
      description: TRACKED(LINES),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const { status } = await answer(await track(base, { settingsEditable: "1", acceptanceRequired: "1", criteriaChecks: "stop", baseSha: FILE_SHA }));
    expect(status).toBe(200);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(
      TRACKED("- **Acceptance criteria checks:** stop\n- **Let me choose the approach:** no"),
    );
  });

  test("a checks level that is not one of the three is refused, and nothing is written", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      status: statusSaying(["create"]),
      extra: { gitRun: savable("/host") },
    });
    const { status } = await answer(await track(base, { settingsEditable: "1", acceptanceRequired: "1", criteriaChecks: "loud", baseSha: FILE_SHA }));
    expect(status).toBe(400);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  test("an archived spec refuses the route entirely", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await post(
      base,
      { settingsEditable: "1", baseSha: FILE_SHA },
      `/api/queue/specs/aide/${ARCHIVED}/tracking`,
    ));
    expect(status).toBe(400);
    expect(body.error).toContain("archived");
    expect(readFileSync(archivedDescriptionPath(dir), "utf-8")).toBe(ARCHIVED_TEXT);
  });

  test("a stale baseSha is refused, and nothing is written", async () => {
    const { base, dir } = harness.start({
      description: TRACKED(),
      extra: { gitRun: savable("/host") },
    });
    const { status, body } = await answer(await track(base, { settingsEditable: "1", acceptanceNotRequired: "1", baseSha: "stale-sha" }));
    expect(status).toBe(400);
    expect(body.error).toContain("changed since");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // A landing is a job in flight like a queued or a running one: the merge it
  // makes is the very race this route's gate exists to stop.
  test("Depends on posted while the spec's archive job is landing is refused with 409, and nothing is written", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let codeRoot = "";
    const needsRealMerge: string[] = [];
    const inner = gitFor({ needsRealMerge });
    // The landing is held at its gate while the save is posted, so only one of the two asks git at a time.
    let posting = false;
    const saveGit = savable("/host");
    const git = {
      run: async (dir: string, args: string[]) => {
        if (posting) return saveGit(dir, args);
        return repoOf(dir) === codeRoot && args.join(" ").startsWith("diff --quiet") ? { code: 1, stdout: "" } : inner.run(dir, args);
      },
    };
    const { base, dir, results } = serverWithRunner(startLanding, "aide-tracking-landing-", git as never, {
      landingGate: async () => {
        await held;
        return { ok: true };
      },
    });
    codeRoot = join(dir, "root", "aide");
    needsRealMerge.push(codeRoot);
    writeFileSync(descriptionPath(dir), TRACKED());
    const job = await runStep(base, "archive");
    writeFileSync(
      join(results, `${job.id}.json`),
      JSON.stringify({
        ...ARCHIVE_RESULT,
        branchUrls: [
          { root: join(dir, "root", "aide", "specs"), url: "https://example.test/aide-specs" },
          { root: codeRoot, url: "https://example.test/aide" },
        ],
      }),
    );
    await settle(base, job.id, (j) => j.state === "done" && j.landing === true);

    posting = true;
    const { status, body } = await answer(await track(base, { dependsOn: "" }));
    posting = false;
    const written = readFileSync(descriptionPath(dir), "utf-8");
    release();
    await settle(base, job.id, (j) => !j.landing);

    expect(status).toBe(409);
    expect(body.spec).toBe(`aide/${SPEC}`);
    expect(written).toBe(TRACKED());
  });
});
