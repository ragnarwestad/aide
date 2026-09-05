// Split out of projects-page.test.ts by theme.

import { describe, expect, test } from "bun:test";
import { AT, page, project } from "./projects-page-fixtures.ts";

describe("the listing on /projects", () => {
  // The same rows the generated overview drew, from the same function:
  // "same components" by construction, not by convention.
  test("one linked row per project, with its counts and description", () => {
    const html = page([
      project("alpha", {
        manifest: { ok: true, data: { name: "alpha", description: "the first one" } },
        specs: [
          { folder: "01-a", dir: "/x/01-a", archived: false, closed: false, title: "A", description: null, dependsOn: [], status: null },
          { folder: "02-b", dir: "/x/archive/02-b", archived: true, closed: false, title: "B", description: null, dependsOn: [], status: null },
        ],
      }),
      project("beta"),
    ]);
    // The word "Projects" is said once, in the tab (2026-08-21): the
    // shell's <h1> is hidden and the <h2> over the list is gone. What
    // opens the list now is the counts, beside the Add button.
    expect(html).not.toContain("<h2>Projects</h2>");
    expect(html).toContain('class="summary"');
    expect(html).toContain('class="proj-row"');
    // The served page links the page it serves. The generated site
    // still links its own files — `projectListBody` without `pageHref`.
    expect(html).toContain('href="/projects/alpha"');
    expect(html).toContain('href="/projects/beta"');
    expect(html).toContain("the first one");
    expect(html).toContain("1 active · 1 archived");
    expect(html).toContain("2 projects · 1 active · 1 archived");
  });

  test("a manifest that failed to parse is an error row, not a missing one", () => {
    const html = page([{ name: "brokenproj", manifest: { ok: false, error: "YAML parse error at line 3" }, specs: [] }]);
    expect(html).toContain("YAML parse error at line 3");
    expect(html).toMatch(/class="[^"]*error[^"]*"/);
  });

  // The link 112 left behind pointed at `/` because the management was
  // there. It is here now, so the link has nothing to point at.
  test("no Manage projects link — the management IS this page", () => {
    expect(page([project("alpha")])).not.toContain("Manage projects");
  });

  test("it carries the nav — and no stamp: the build time lives on About now", () => {
    const html = page([project("alpha")]);
    expect(html).toContain("<nav");
    expect(html).not.toContain(AT);
    expect(html).not.toContain("<h1>Projects</h1>");
  });
});

// Spec 142: code merged outside the dashboard never runs the project's
// AIDE_INSTALL_CMD, so the serving host keeps serving the old version
// and nothing says so. The banner is the saying-so: on the row, on
// every load, for as long as the drift lasts.

describe("the drift banner on /projects", () => {
  // The page renders at AT, so that is "now" for every freshness label
  // below — the render function has no clock of its own, and one
  // passed separately would be a second answer to the same question.
  const NOW = Date.parse(AT);
  /** An answer taken `secs` before the page was drawn. */
  const checkedAgo = (behind: number | null, secs: number) => ({
    behind,
    checkedAt: NOW - secs * 1000,
  });

  test("a project behind origin says so on its own row, and says how far", () => {
    const html = page([project("aide"), project("atlasaurus")], {
      driftByProject: { aide: checkedAgo(3, 240) },
    });
    expect(html).toContain("3 commits behind origin, checked 4 min ago — deploy is a hand step");
    // On aide's row, not floating above the list where a reader has to
    // work out which project it is about.
    expect(html).toMatch(/aide[\s\S]*?3 commits behind origin[\s\S]*?atlasaurus/);
    expect(html).toContain('class="rowmsg waiting"');
  });

  test("one commit behind is one commit, not 1 commits", () => {
    expect(page([project("aide")], { driftByProject: { aide: checkedAgo(1, 240) } })).toContain(
      "1 commit behind origin, checked 4 min ago — deploy is a hand step",
    );
  });

  // Spec 203: the answer comes off a background schedule now, so how
  // OLD it is decides how much of it to believe. The label is plain
  // text, not `relTime`'s <span>: this note is escaped on its way out.
  test("the freshness label is the note's own words, not markup", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(2, 3 * 86400) } });
    expect(html).toContain("2 commits behind origin, checked 3 d ago — deploy is a hand step");
    expect(html).not.toContain("&lt;span");
  });

  test("an answer taken seconds ago says just now", () => {
    expect(page([project("aide")], { driftByProject: { aide: checkedAgo(2, 5) } })).toContain(
      "2 commits behind origin, checked just now — deploy is a hand step",
    );
  });

  // Spec 203: gated for the check, but the background poll has not
  // answered for it yet — a fresh boot, or a project just added. The
  // row says so rather than showing a count nobody has taken.
  test("a project the poll has not reached yet says the drift is unchecked", () => {
    const html = page([project("aide")], {
      driftByProject: { aide: { behind: null, checkedAt: null } },
    });
    expect(html).toContain("origin drift not checked yet");
    expect(html).not.toContain("behind origin");
  });

  // Asked and unanswerable is not the same row as never asked: the
  // fail-open rule says a banner nobody can trust is worse than none.
  test("a check that could not answer leaves the row silent", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(null, 60) } });
    expect(html).not.toContain("behind origin");
    expect(html).not.toContain("not checked yet");
  });

  test("a checkout level with origin gets no banner", () => {
    const html = page([project("aide")], { driftByProject: { aide: checkedAgo(0, 60) } });
    expect(html).not.toContain("behind origin");
    expect(html).not.toContain("not checked yet");
  });

  test("a project the drift map does not name gets no banner at all (criteria 1 and 3)", () => {
    const html = page([project("aide"), project("atlasaurus")], {
      driftByProject: { aide: checkedAgo(2, 60) },
    });
    expect(html).not.toMatch(/atlasaurus[\s\S]*?behind origin/);
    // Absent from the map is not gated for the check — it says nothing,
    // where a gated-but-unchecked project says so.
    expect(html).not.toMatch(/atlasaurus[\s\S]*?not checked yet/);
  });

  test("with no drift at all the page is exactly what it was", () => {
    expect(page([project("aide")], {})).not.toContain("behind origin");
    expect(page([project("aide")], { driftByProject: {} })).not.toContain("behind origin");
  });

  // A project whose manifest will not parse is already an error row —
  // it is still a checkout that can fall behind, and losing the banner
  // there would hide drift on exactly the project someone is fixing.
  test("an unparseable manifest still gets its banner", () => {
    const html = page([{ name: "brokenproj", manifest: { ok: false, error: "YAML parse error" }, specs: [] }], {
      driftByProject: { brokenproj: checkedAgo(7, 5) },
    });
    expect(html).toContain("7 commits behind origin, checked just now");
  });
});

// Spec 259: a project's own recurring jobs get a "next scheduled run"
// badge on its overview row, following the drift banner's own pattern
// — read off what was passed in, no clock or network of the render's
// own.
describe("the next-scheduled-run badge on /projects (spec 259)", () => {
  test("a project with a schedule entry shows its next fire time", () => {
    const html = page([project("aide")], {
      scheduleByProject: { aide: [{ name: "nightly-report", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true }] },
    });
    // AT is 2026-08-19T00:00:00Z; the next 3am UTC fire is the same day.
    expect(html).toContain("next scheduled run 2026-08-19T03:00:00.000Z");
  });

  test("the soonest of several entries is the one shown", () => {
    const html = page([project("aide")], {
      scheduleByProject: {
        aide: [
          { name: "weekly", cron: "0 4 * * 0", prompt: "docs/weekly.md", enabled: true },
          { name: "nightly", cron: "0 3 * * *", prompt: "docs/nightly.md", enabled: true },
        ],
      },
    });
    expect(html).toContain("next scheduled run 2026-08-19T03:00:00.000Z");
    expect(html).not.toContain("next scheduled run 2026-08-2");
  });

  test("a project the schedule map does not name gets no badge", () => {
    expect(page([project("aide")], { scheduleByProject: {} })).not.toContain("next scheduled run");
    expect(page([project("aide")], {})).not.toContain("next scheduled run");
  });
});
