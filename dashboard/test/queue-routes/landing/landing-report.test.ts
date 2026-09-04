// What a landing reports to the world outside: the request it sends,
// what it says about each repo it merged, and what happens when the
// sink throws or refuses.
//
// Split out of every-step-basic-landing.test.ts 2026-09-04 (702 lines);
// the tests are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { mergeEventSink, setupQueueRoutesHarness } from "../fixtures.ts";

/** The message a job carries, as text. Since spec 380 a job stores
 *  WHICH message and what fills its blanks; the reader composes it.
 *  These tests assert on what a reader would see, so they compose it
 *  the same way, in English. */
import { renderSentence } from "../../../src/i18n/message.ts";

function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}

import { BRANCH, SPEC, createOwnDirs, gitFor, installs, merges, repos, serverWith, stepWithResult } from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();


afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

// --- spec 149: every step lands the work it produced -------------------------
//
// Split out of stopped-and-every-step.test.ts by theme: the basic
// per-step landing rules. The origin re-check (spec 193) and the
// pull-request mode (spec 220) are their own sibling files.
//
// Every step that touched only a repo it is safe to merge lands ITSELF,
// the moment it finishes — with no press and no browser attached. The
// six phases used to end with the spec archived and the code still on a
// branch, waiting for someone to press Merge; the same steps run one at
// a time piled "ready to merge" buttons on the row for the specs repo
// and one for the code. None of those buttons exist any more. Every step
// lands the work it produced, and `implement` is the one exception ON
// PURPOSE: its branch is where a person tests the code, by leaving
// `archive` unticked.
//
// `archive` is therefore the one step that sends CODE to a default
// branch — so it is the one landing that has to look past its own
// outcome (the code branch moved during implement, not during archive)
// and the one that has to install afterwards, exactly as the Merge
// button did.

/** The same wiring the sibling suite uses: a server on this harness,
 *  pointed at the repos a test just made. */
const serverWithHarness = (
  dir: string,
  paths: ReturnType<typeof repos>,
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Parameters<typeof serverWith>[4] = {},
) => serverWith(harness, dir, paths, git, extra);

describe("what a landing reports", () => {
  // Criterion 1. Every other test in this file is the other half of this
  // proof: none of them configures a URL, and none of them would issue a
  // request even with a live fetch in the harness.
  test("no url configured means no request, whatever lands", async () => {
    const dir = own("aide-158-inert-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, { mergeEventFetch: sink.mergeEventFetch });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted).toEqual([]);
  });

  // Criteria 2, 5 and 7 at once. The step name is threaded through from
  // the call site rather than stubbed — `archive` says "archive" — and
  // the specs repo is not a code root, so an event for it proves the
  // report is not gated the way the install is.
  test.each(["analyze", "archive"])(
    "a landed %s step reports the merge of a specs-only repo",
    async (step) => {
      const dir = own(`aide-158-${step}-`);
      const paths = repos(dir);
      const git = gitFor();
      const sink = mergeEventSink();
      const { base } = serverWithHarness(dir, paths, git, sink);
      // A code root that is never landed here: an event for it would
      // mean the report followed the install's gate after all.
      installs(paths.project);

      const landed = await stepWithResult(base, dir, step, {
        branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
      });

      expect(landed.error).toBeFalsy();
      expect(sink.posted.length).toBe(1);
      expect(sink.posted[0]).toEqual({
        project: "aide",
        specFolder: SPEC,
        branch: BRANCH,
        repoRoot: paths.specs,
        step,
        jobId: landed.id,
        timestamp: expect.any(String),
      });
      const stamp = sink.posted[0].timestamp as string;
      expect(new Date(stamp).toISOString()).toBe(stamp);
    },
  );

  // Criterion 4. One run, two repos, two events — each naming its own
  // root. A single event per landing would leave the code merge, the
  // one that matters most, unreported whenever a specs merge preceded it.
  test("a landing that merges two repos reports both, each by its own root", async () => {
    const dir = own("aide-158-two-repos-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "archive", {
      branchUrls: [
        { root: paths.project, url: "https://example.test/aide" },
        { root: paths.specs, url: "https://example.test/aide-specs" },
      ],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.map((e) => e.repoRoot).sort()).toEqual([paths.project, paths.specs].sort());
    expect(sink.posted.every((e) => e.step === "archive" && e.branch === BRANCH)).toBe(true);
  });

  // Criterion 3. The same rule `installAfterMerge` already keeps: the
  // merge happened, so a report that cannot be delivered is noted beside
  // it and never turns a completed merge into a failed one.
  test("a report that throws leaves the landing successful", async () => {
    const dir = own("aide-158-report-fails-");
    const paths = repos(dir);
    const git = gitFor();
    const thrower = (async () => {
      throw new Error("claude-usage is down");
    }) as unknown as typeof fetch;
    const { base } = serverWithHarness(dir, paths, git, {
      mergeEventUrl: "http://claude-usage.test/api/merge-event",
      mergeEventFetch: thrower,
    });

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(landed.branchUrls).toEqual([]);
  });

  // And the same for a sink that answers but refuses.
  test("a report the sink refuses leaves the landing successful", async () => {
    const dir = own("aide-158-report-refused-");
    const paths = repos(dir);
    const git = gitFor();
    const sink = mergeEventSink(() => new Response("no", { status: 500 }));
    const { base } = serverWithHarness(dir, paths, git, sink);

    const landed = await stepWithResult(base, dir, "analyze", {
      branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
    });

    expect(landed.error).toBeFalsy();
    expect(sink.posted.length).toBe(1);
  });

  // A merge that never happened is not an event. The ledger's whole
  // question is "was this merge reviewed?" — a refused merge reported as
  // one would be an answer about work that is not on the default branch.
  test("a landing that conflicts reports nothing for the repo it could not merge", async () => {
    const dir = own("aide-158-conflict-");
    const paths = repos(dir);
    const git = gitFor({ conflicting: [paths.specs] });
    const sink = mergeEventSink();
    const { base } = serverWithHarness(dir, paths, git, sink);

    const failed = await stepWithResult(
      base,
      dir,
      "analyze",
      { branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }] },
      (j) => !!j.error,
    );

    expect(sentence(failed.error)).toContain(paths.specs);
    expect(sink.posted).toEqual([]);
  }, 20000);
});
