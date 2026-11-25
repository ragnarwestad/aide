// What a landing into the dashboard's OWN checkout does: log that Deploy
// installs and restarts it, doing neither itself — and what it does for
// every other project: install, and never restart the dashboard.
//
// Split out of every-step-basic-landing.test.ts 2026-09-04; the tests
// are unchanged and keep their names.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pickRefusal } from "../../../src/serve/land-branch/merge.ts";
import { setupQueueRoutesHarness } from "../fixtures.ts";

import {
  codeAndSpecsBranches, createOwnDirs, gitFor, implementDone, installs, repos, serverWith, specsBranch, stepWithResult,
} from "./every-step-lands-fixtures.ts";

const { harness } = setupQueueRoutesHarness();
const { own, cleanup: cleanupOwnDirs } = createOwnDirs();

afterEach(() => {
  harness.cleanup();
  cleanupOwnDirs();
});

// --- Every step lands the work it produced -------------------------
//
// Split out of stopped-and-every-step.test.ts by theme: the basic
// per-step landing rules. The origin re-check and the
// pull-request mode are their own sibling files.
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
const serverWithHarness = (
  dir: string,
  paths: { root: string },
  git: { run: (dir: string, args: string[]) => Promise<unknown> },
  extra: Parameters<typeof serverWith>[4] = {},
) => serverWith(harness, dir, paths, git, extra);

describe("a landing, the install and the restart", () => {
  // The restart is what killed this process, and it used to fire from
  // inside the per-repo loop the moment the code root's install was
  // through — with archive's specs root, which carries the folder move
  // to `archive/`, still ahead in that loop. The spec then stayed on
  // the active list with no error anywhere, because the code that would
  // have written one was killed too. So: every repo merges BEFORE the
  // restart is allowed to fire.
  test("a landing into the dashboard's own checkout neither installs nor restarts, and logs that Deploy does both", async () => {
    // A restart mid-run kills every job's process, and no rule for a safe
    // moment held up, so the person restarts with Deploy when it suits.
    // The install waits for that same Deploy: installed alone, the runner
    // in ~/.local/bin would be newer than the served page that calls it.
    const dir = own("aide-restart-order-");
    const paths = repos(dir);
    const git = gitFor();
    let fired = 0;
    const logged: string[] = [];
    const realError = console.error;
    console.error = (msg: unknown) => {
      logged.push(String(msg));
      realError(msg);
    };
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: paths.project,
      restart: {
        registered: async () => true,
        fire: () => {
          fired += 1;
        },
      },
    });
    installs(paths.project);

    await implementDone(base, dir, codeAndSpecsBranches(paths));
    const landed = await stepWithResult(base, dir, "archive", { branchUrls: specsBranch(paths) });

    expect(landed.error).toBeFalsy();
    const marker = join(paths.project, "installed");
    await Bun.sleep(400);
    console.error = realError;
    expect(existsSync(marker)).toBe(false);
    expect(fired).toBe(0);
    expect(logged.some((l) => l.includes("install and restart it with Deploy"))).toBe(true);
  });

  // A code merge that cannot be made stops the step: nothing
  // is left half-merged, the reason names the repo, and the spec stays in
  // the active list. `errorReason` is what makes the way out survive —
  // there is no browser attached to an automatic landing, so the one-shot
  // redirect the Merge button used cannot carry it.
  // A retry that merely refused again used to overwrite the first
  // refusal ("main moved on origin under this landing twice") with its
  // own ("cannot fast-forward main") — the words that said what
  // happened were gone.
  test("pickRefusal keeps the first refusal's words unless a retry reached a verdict", () => {
    const first = { root: "/r", ok: false, error: "main moved on origin under this landing twice", detail: "rejected" };
    const again = { root: "/r", ok: false, error: "cannot fast-forward main" };
    expect(pickRefusal(first, again)).toEqual({ ...again, error: first.error, detail: "rejected", reason: undefined });
    const conflict = { root: "/r", ok: false, error: "cannot merge — conflict", reason: "conflict" as const };
    expect(pickRefusal(first, conflict)).toBe(conflict);
    const fine = { root: "/r", ok: true };
    expect(pickRefusal(fine, again)).toBe(again);
  });

  test("a landing into a project that is not the dashboard's own never restarts it", async () => {
    // The install is that project's business — PaceUp's install restarts
    // PaceUp, if anything. Only a landing into the checkout this dashboard
    // runs from restarts the dashboard.
    const dir = own("aide-restart-other-project-");
    const paths = repos(dir);
    const git = gitFor();
    let fired = 0;
    const { base } = serverWithHarness(dir, paths, git, {
      dashboardRoot: join(dir, "somewhere-else"),
      restart: {
        registered: async () => true,
        fire: () => {
          fired += 1;
        },
      },
    });
    const marker = installs(paths.project);
    await implementDone(base, dir, codeAndSpecsBranches(paths));
    const landed = await stepWithResult(base, dir, "archive", { branchUrls: specsBranch(paths) });
    expect(landed.error).toBeFalsy();
    for (let i = 0; i < 80 && !existsSync(marker); i++) await Bun.sleep(25);
    expect(existsSync(marker)).toBe(true);
    await Bun.sleep(200);
    expect(fired).toBe(0);
  });
});
