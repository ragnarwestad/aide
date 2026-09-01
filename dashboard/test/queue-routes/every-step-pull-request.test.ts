import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setupQueueRoutesHarness } from "./fixtures.ts";
import {
  createOwnDirs, gitFor, repos, installs, serverWith, merges, stepWithResult,
} from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

// --- spec 220: merge the code, or open a pull request ---------------------
//
// Split out of stopped-and-every-step.test.ts by theme.
//
// Everything else lands code straight onto the default branch, which
// is the only behaviour there has ever been. A project whose team
// reviews its code says so in its committed manifest, and then archive
// lands the PLAN and leaves the code on its branch for the pull
// request `aide-run-spec` opened. The specs root is never gated: an
// archive commit moving a folder is bookkeeping, not a change anyone
// reviews.
describe("a project can leave its code for a pull request (spec 220)", () => {
  const serverWithHarness = (
    dir: string,
    paths: { root: string },
    git: { run: (dir: string, args: string[]) => Promise<unknown> },
  ) => serverWith(harness, dir, paths, git);

  /** The project's manifest, with the choice written into it. `repos`
   *  writes a bare `name: aide` one; this is the same file with the
   *  spec's own key added. */
  const landsWith = (paths: { project: string }, value: string | null): void => {
    writeFileSync(
      join(paths.project, ".aide", "project.yaml"),
      `name: aide\n${value ? `codeLanding: ${value}\n` : ""}`,
    );
  };

  const onlyTheSpecsRepo = (paths: { specs: string }) => ({
    branchUrls: [{ root: paths.specs, url: "https://example.test/aide-specs" }],
  });

  /** An implement step's result, which is what puts the code branch —
   *  and, in `pr` mode, the pull request `aide-run-spec` opened for it
   *  — onto the job in the first place. Archive never touches the
   *  project root, so this is the only step that can carry them. */
  const implemented = async (
    base: string,
    dir: string,
    paths: { project: string },
    over: Record<string, unknown> = {},
  ) =>
    stepWithResult(
      base,
      dir,
      "implement",
      { branchUrls: [{ root: paths.project, url: "https://example.test/aide" }], ...over },
      (j) => j.state === "done",
    );

  // Acceptance criterion 3, and the whole point of the spec.
  test("archive merges the plan and leaves the code on its branch", async () => {
    const dir = own("aide-220-pr-mode-");
    const paths = repos(dir);
    landsWith(paths, "pr");
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);
    const marker = installs(paths.project);
    landsWith(paths, "pr"); // `installs` rewrites .aide/config, not the manifest

    await implemented(base, dir, paths);
    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.project)).toEqual([]);
    // A success, not a refusal: nothing to resolve, nothing to re-run.
    expect(landed.state).toBe("done");
    expect(landed.error).toBeFalsy();
    expect(landed.errorReason).toBeFalsy();
    // And nothing was installed from a merge that deliberately did not
    // happen — the install belongs to code reaching the default
    // branch, which is exactly what the pull request has not done yet.
    expect(existsSync(marker)).toBe(false);
  }, 20000);

  // Acceptance criterion 3's sharpest half, in isolation. The
  // archive-only origin re-check asks whether ANY of the project's
  // roots still holds the branch, and in `pr` mode the code root
  // always does — by design. Left unhandled this reports every working
  // PR-mode archive as a failed, unlanded landing.
  test("the origin re-check does not call the open code branch unlanded", async () => {
    const dir = own("aide-220-recheck-");
    const paths = repos(dir);
    landsWith(paths, "pr");
    // Open in the code root ALONE: the specs merge takes the specs
    // root out of the set, so what is left on origin afterwards is
    // exactly the branch this spec means to leave there.
    const git = gitFor({ openOn: [paths.project] });
    const { base } = serverWithHarness(dir, paths, git);

    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    // The sweep really did run and really did find it...
    expect(git.calls.some((c) => c.args.includes("refs/heads/aide/*"))).toBe(true);
    // ...and said nothing, because a root the landing chose not to
    // merge is not a root that failed to merge.
    expect(landed.state).toBe("done");
    expect(landed.errorReason).toBeFalsy();
    expect(String(landed.error ?? "")).not.toContain("has not landed");
  }, 20000);

  // Acceptance criterion 1. The regression guard, as its own case: the
  // behaviour every project on the host has today must be reachable
  // both by saying nothing and by saying `merge` out loud.
  test.each([null, "merge"])("a project that says %p merges its code exactly as before", async (value) => {
    const dir = own(`aide-220-merge-${value ?? "unset"}-`);
    const paths = repos(dir);
    landsWith(paths, value);
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    await implemented(base, dir, paths);
    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(merges(git.calls, paths.project).length).toBeGreaterThan(0);
    expect(merges(git.calls, paths.specs).length).toBeGreaterThan(0);
    expect(landed.state).toBe("done");
    expect(landed.error).toBeFalsy();
    // Landed, so the row stops advertising a branch — the behaviour
    // spec 149 gave it.
    expect(landed.branchUrls).toEqual([]);
  }, 20000);

  // Acceptance criterion 4. The row has to SAY what happened, or a
  // reader cannot tell a deliberate open branch from a stuck one. The
  // pull request comes off the step that opened it — `implement`, the
  // only step that touches the project root at all.
  test("the pull request the run opened stays on the row", async () => {
    const dir = own("aide-220-prurl-");
    const paths = repos(dir);
    landsWith(paths, "pr");
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    await implemented(base, dir, paths, { prUrl: "https://github.test/aide/pull/7" });
    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(landed.prUrl).toBe("https://github.test/aide/pull/7");
    // And the branch it points at is still named on the row: the code
    // is there and nowhere else until somebody merges the request.
    expect((landed.branchUrls as { root: string }[]).map((b) => b.root)).toContain(paths.project);
  }, 20000);

  // Acceptance criterion 7. `gh` on an unattended machine needs an
  // interactive re-auth only a person can do, and this spec gives that
  // failure teeth: the landing now trusts `pr` to mean a request
  // exists. A branch left open with nothing describing it has to say
  // so.
  test("a gh failure is reported beside the branch it left open", async () => {
    const dir = own("aide-220-prerror-");
    const paths = repos(dir);
    landsWith(paths, "pr");
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    await implemented(base, dir, paths, { prError: "gh auth login required" });
    const landed = await stepWithResult(base, dir, "archive", onlyTheSpecsRepo(paths));

    expect(landed.prError).toBe("gh auth login required");
    expect(landed.prUrl).toBeFalsy();
    // Still not a failed job: the code IS on its branch, which is
    // where PR mode wanted it. What is missing is the request.
    expect(landed.state).toBe("done");
  }, 20000);

  // Spec 328: `pushError` is `prError`'s sibling — `aide-run-spec` has
  // reported it in its result JSON since before this spec, but nothing
  // on the dashboard side ever read it, so a step whose push failed
  // reported `completed` with nothing on the row to explain why.
  test("a push failure is reported on the step's own job", async () => {
    const dir = own("aide-328-pusherror-");
    const paths = repos(dir);
    const git = gitFor({ openOn: [paths.project, paths.specs] });
    const { base } = serverWithHarness(dir, paths, git);

    const landed = await implemented(base, dir, paths, {
      pushError: "cannot push aide/81-queue-and-runner in /repos/aide: non-fast-forward",
    });

    expect(landed.pushError).toBe(
      "cannot push aide/81-queue-and-runner in /repos/aide: non-fast-forward",
    );
  }, 20000);
});
