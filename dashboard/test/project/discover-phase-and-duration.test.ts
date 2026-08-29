// Split out of discover.test.ts by theme.

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSchedule, specArchivedDate, specPhaseFile } from "../../src/project/discover.ts";
import { useDiscoverRoot } from "./discover-fixtures.ts";

const fx = useDiscoverRoot();

// --- spec 150: what a phase MADE --------------------------------------------
//
// "A phase's page shows what that phase made": analyze wrote
// 3-solution.md (the plan, and since spec 181 the "Plan review" section
// too — the reviewer-perspectives routine that used to be its own
// `review-plan` step runs inside `analyze` now), implement wrote
// 4-status.md, and archive either moved the folder or said why it did
// not. Nothing else of the spec is repeated there.

describe("specPhaseFile", () => {
  let dir: string;
  const STATUS_HEAD = "# S - Status\n\n## Tracking info\n\n- **Task:** `x`\n";

  const write = (name: string, text: string) => writeFileSync(join(dir, name), text);

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-phase-"));
    write("1-description.md", "# S - Description\n\n## Description\n\nWhat it is about.\n");
    write("2-analysis.md", "# S - Analysis\n\n## Findings\n\nSeven files.\n");
    write(
      "3-solution.md",
      "# S - Solution\n\n## Recommended solution\n\nApproach 1.\n\n## Plan review\n\n" +
        "One must-fix, five should-fix.\n\n## Risk analysis\n\nMedium.\n",
    );
    write("4-status.md", `${STATUS_HEAD}\n## Phase 1: RED\n\nNothing yet.\n`);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("create shows the description it wrote", () => {
    expect(specPhaseFile(dir, "create")).toEqual({
      label: "1-description.md",
      text: "# S - Description\n\n## Description\n\nWhat it is about.\n",
    });
  });

  // Spec 181, criterion 3: the reviewer-perspectives routine that used
  // to be its own `review-plan` step runs inside `analyze` now, writing
  // a "Plan review" section into 3-solution.md in the same run that
  // writes the plan — so the job page shows the WHOLE file, plan and
  // review together, not a slice of it.
  test("analyze shows the whole 3-solution.md, plan and review together", () => {
    expect(specPhaseFile(dir, "analyze")?.label).toBe("3-solution.md");
    expect(specPhaseFile(dir, "analyze")?.text).toContain("Approach 1.");
    expect(specPhaseFile(dir, "analyze")?.text).toContain("One must-fix, five should-fix.");
    expect(specPhaseFile(dir, "analyze")?.text).toContain("Medium.");
  });

  test("implement shows 4-status.md (criterion 7)", () => {
    expect(specPhaseFile(dir, "implement")?.label).toBe("4-status.md");
    expect(specPhaseFile(dir, "implement")?.text).toContain("Phase 1: RED");
  });

  test("a step that writes no file of its own has nothing to show", () => {
    expect(specPhaseFile(dir, "resolve")).toBeNull();
    expect(specPhaseFile(dir, "")).toBeNull();
  });

  test("a phase whose file is not written yet keeps its name and says nothing was written", () => {
    const empty = mkdtempSync(join(tmpdir(), "aide-phase-empty-"));
    expect(specPhaseFile(empty, "analyze")).toEqual({ label: "3-solution.md", text: null });
    rmSync(empty, { recursive: true, force: true });
  });

  // Criterion 8. `archive` is the one phase whose answer is not a whole
  // file: it either moved the folder or declined to, and the two must
  // never both be on the page.
  describe("archive shows one of its two outcomes, never both", () => {
    test("a spec held back shows the reason", () => {
      const held = mkdtempSync(join(tmpdir(), "aide-phase-held-"));
      writeFileSync(
        join(held, "4-status.md"),
        `${STATUS_HEAD}\n## Archive held back\n\n- the Slack webhook (Phase 4, still unchecked)\n`,
      );
      const phase = specPhaseFile(held, "archive");
      expect(phase?.text).toContain("the Slack webhook (Phase 4, still unchecked)");
      expect(phase?.text).not.toContain("Archived:");
      rmSync(held, { recursive: true, force: true });
    });

    test("a spec that was archived shows the stamp", () => {
      const done = mkdtempSync(join(tmpdir(), "aide-phase-done-"));
      writeFileSync(join(done, "4-status.md"), `${STATUS_HEAD}\n**Archived:** 2026-08-21\n`);
      const phase = specPhaseFile(done, "archive");
      expect(phase?.text).toContain("2026-08-21");
      expect(phase?.text).not.toContain("held back");
      rmSync(done, { recursive: true, force: true });
    });

    // A folder that MOVED is archived whatever an earlier attempt wrote,
    // so the stamp is the later fact and the one that is shown.
    test("a file carrying both shows the stamp alone", () => {
      const both = mkdtempSync(join(tmpdir(), "aide-phase-both-"));
      writeFileSync(
        join(both, "4-status.md"),
        `${STATUS_HEAD}\n## Archive held back\n\n- the Slack webhook\n\n**Archived:** 2026-08-21\n`,
      );
      const phase = specPhaseFile(both, "archive");
      expect(phase?.text).toContain("2026-08-21");
      expect(phase?.text).not.toContain("Slack webhook");
      rmSync(both, { recursive: true, force: true });
    });

    test("an archive that has run neither way says nothing was written", () => {
      expect(specPhaseFile(dir, "archive")).toEqual({ label: "4-status.md", text: null });
    });
  });
});

// Spec 163: the archive listing needs a DATE per row, and `4-status.md`
// carries one for every spec the archive step stamped. A second reader
// of the same line as `specPhaseFile`'s, deliberately: that one returns
// the whole line for a phase panel to show, this one returns the value
// for a listing to sort on, and neither shape serves the other's
// caller.
describe("specArchivedDate", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "aide-archived-date-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const withStatus = (name: string, text: string): string => {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "4-status.md"), text);
    return d;
  };

  test("reads the stamp the archive step wrote", () => {
    const d = withStatus("plain", "# Status\n\n**Archived:** 2026-08-20\n");
    expect(specArchivedDate(d)).toBe("2026-08-20");
  });

  // Both shapes are on disk in aide's own archive today: the newer
  // template writes it as a Tracking-info bullet, in backticks.
  test("reads it as a Tracking info bullet, backticks and all", () => {
    const d = withStatus("bullet", "# Status\n\n## Tracking info\n\n- **Archived:** `2026-08-21`\n");
    expect(specArchivedDate(d)).toBe("2026-08-21");
  });

  test("a status file with no stamp answers null, not a blank string", () => {
    const d = withStatus("nostamp", "# Status\n\n## Tracking info\n\n- **Created:** 2026-08-01\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("a stamp with nothing after it is no stamp", () => {
    const d = withStatus("empty", "# Status\n\n**Archived:**\n");
    expect(specArchivedDate(d)).toBeNull();
  });

  test("no 4-status.md at all answers null", () => {
    expect(specArchivedDate(join(dir, "nothing-here"))).toBeNull();
  });
});

// Spec 259: a project's own recurring jobs, read the same way
// `resolveCodeLanding` reads codeLanding — the committed manifest only,
// no `.aide/config` fallback, absent/unparseable/missing all falling to
// "no schedule" rather than a guess.
describe("resolveSchedule (spec 259)", () => {
  test("a manifest with entries returns them", () => {
    const dir = join(fx.root, "proj-schedule-a");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(
      join(dir, ".aide", "project.yaml"),
      'name: x\nschedule:\n  - name: nightly\n    cron: "0 3 * * *"\n    prompt: docs/nightly.md\n',
    );
    expect(resolveSchedule(dir)).toEqual([{ name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true }]);
  });

  test("a project with no manifest at all has no schedule", () => {
    const dir = join(fx.root, "proj-schedule-nomanifest");
    mkdirSync(dir, { recursive: true });
    expect(resolveSchedule(dir)).toEqual([]);
  });

  test("a manifest with no schedule key has no schedule", () => {
    const dir = join(fx.root, "proj-schedule-none");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: x\n");
    expect(resolveSchedule(dir)).toEqual([]);
  });

  test("an unparseable manifest has no schedule rather than guessing", () => {
    const dir = join(fx.root, "proj-schedule-broken");
    mkdirSync(join(dir, ".aide"), { recursive: true });
    writeFileSync(join(dir, ".aide", "project.yaml"), "name: [x\n  - broken\n");
    expect(resolveSchedule(dir)).toEqual([]);
  });
});
