import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createServer,
  parseArgs,
  runnerArgv,
} from "../../../src/serve/serve.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "../fixtures.ts";
import { checkoutSafetyHelpers } from "./checkout-safety-fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];
const { git, realProject, recording } = checkoutSafetyHelpers(ownDirs);

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 205: the dashboard works in checkouts of its own.
//
// A run was cut from the same checkout a person edits, and the two
// collided — on 2026-08-23 three specs were archived with their code
// stranded on a branch. Everything that MUTATES a checkout now resolves
// to a clone the dashboard owns; the person's own checkout at
// `<projectsRoot>/<project>` is what the display reads and nothing else.
//
// Real git here, unlike the rest of this suite: what is under test is
// which working tree a commit lands in, and a fake that ignores the
// directory it was handed could not tell the two apart.
//
// Split out of checkout-and-render-safety.test.ts by theme: this file
// carries the write-direction tests — the argv, the flag, and the two
// end-to-end saves. The checkout-freshness (spec 216) and checkout-listing
// (spec 218) tests are their own sibling files, sharing `git`,
// `realProject` and `recording` via ./checkout-safety-fixtures.ts.
describe("the dashboard works in checkouts of its own (spec 205)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  // Criterion 6, and the whole point: `--project-dir` is what decides
  // which checkout a run branches, switches and cuts its worktree from.
  test("the runner is pointed at the dashboard's own checkout, never the person's", () => {
    const job = {
      id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
      budgetUsd: 5, model: {}, timeoutSec: {}, permissionMode: {}, state: "queued", createdAt: "", results: [],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide-dashboard-checkouts/aide/code",
      push: "branch",
    });
    expect(argv[argv.indexOf("--project-dir") + 1]).toBe("/home/dev/aide-dashboard-checkouts/aide/code");
  });

  // Spec 364, REQ-3/REQ-4: `--effort` appears only when the job actually
  // named one for this step, and is entirely absent otherwise.
  test("--effort reaches argv only when the job named one for this step", () => {
    const job = {
      id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
      budgetUsd: 5, model: {}, effort: { analyze: "high" }, timeoutSec: {}, permissionMode: {},
      state: "queued", createdAt: "", results: [],
    } as unknown as Parameters<typeof runnerArgv>[0];
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide-dashboard-checkouts/aide/code",
      push: "branch",
    });
    expect(argv[argv.indexOf("--effort") + 1]).toBe("high");

    const untouched = {
      ...job,
      effort: {},
    } as unknown as Parameters<typeof runnerArgv>[0];
    const bare = runnerArgv(untouched, "analyze", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide-dashboard-checkouts/aide/code",
      push: "branch",
    });
    expect(bare).not.toContain("--effort");
  });

  // Named on the command line, because the serving host is where these
  // clones actually take up disk and the default is a directory under
  // $HOME.
  test("the checkout root is a flag, and defaults to nothing the server invents", () => {
    expect(parseArgs(["--site", "/s", "--dashboard-checkouts", "/data/owned"]).dashboardCheckoutRoot).toBe(
      "/data/owned",
    );
    expect(parseArgs(["--site", "/s"]).dashboardCheckoutRoot).toBeUndefined();
  });

  // Criterion 8: eagerly, so no project ever pays a full clone inside
  // the request that first needs it.
  test("Add makes the dashboard's own checkout before anything asks for one", async () => {
    const { projectsRoot, site, owned } = realProject();
    const originOfSecond = join(projectsRoot, "..", "aide.git");
    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/api/queue/projects`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ name: "second", gitUrl: originOfSecond }),
      });
      expect(res.status).toBe(200);
      expect(existsSync(join(owned, "second", "code", ".git"))).toBe(true);
    } finally {
      server.stop();
    }
  });

  // Criteria 1, 2 and 4, in the shape of the incident itself: the
  // person is mid-edit on a branch of their own when the dashboard
  // writes.
  test("a Save writes in the dashboard's own checkout and leaves the person's alone", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    // Exactly what a run used to refuse over, and used to trample.
    git(person, "switch", "-q", "-c", "wip");
    writeFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "# Mine, half-written\n");
    const before = git(person, "status", "--porcelain=v1", "--branch");
    const recorded = recording();
    const server = createServer({
      siteDir: site, port: 0,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, gitRun: recorded.run,
    });
    try {
      // Through the form, not around it: the hidden `baseSha` is the
      // commit the save compares against, and reading it off the page
      // proves the form and the save agree about WHICH checkout that
      // commit came out of.
      const form = await (
        await fetch(`http://127.0.0.1:${server.port}/specs/aide/81-queue-and-runner?tab=description`, {
          headers: { "x-aide-token": TOKEN },
        })
      ).text();
      const baseSha = /name="baseSha" value="([^"]*)"/.exec(form)?.[1] ?? "";
      expect(baseSha).not.toBe("");
      const res = await fetch(
        `http://127.0.0.1:${server.port}/api/queue/specs/aide/81-queue-and-runner/save`,
        {
          method: "POST",
          headers: { "x-aide-token": TOKEN, "content-type": "application/json" },
          redirect: "manual",
          body: JSON.stringify({
            text: "# Queue - Description\n\n## Description\n\nSaved by the dashboard.\n",
            baseSha,
          }),
        },
      );
      expect(res.status).toBe(303);
      // The dashboard's own copy carries the edit...
      const saved = join(owned, "aide", "code", "specs", "81-queue-and-runner", "1-description.md");
      expect(readFileSync(saved, "utf-8")).toContain("Saved by the dashboard");
      // ...and the person's half-written file is still theirs, on their
      // own branch, with nothing committed under them.
      expect(readFileSync(join(person, "specs", "81-queue-and-runner", "1-description.md"), "utf-8")).toBe(
        "# Mine, half-written\n",
      );
      expect(git(person, "status", "--porcelain=v1", "--branch")).toBe(before);
      // And nothing their directory was ever asked can CHANGE it.
      //
      // The one question this design rests on is still there — which
      // origin to clone the dashboard's own checkout from — and since
      // spec 208 the cache schedule asks the person's spec folders the
      // same read-only questions the page render used to ask them
      // inside a request. That is the same reading, on a clock; what
      // spec 205 exists to prevent is a WRITE, and the list below is
      // every verb that would be one.
      const asked = recorded.calls
        .filter((c) => c.dir === person || c.dir.startsWith(`${person}/`))
        .map((c) => c.args.join(" "));
      expect(asked).toContain("remote get-url origin");
      const writes = ["checkout", "switch", "merge", "commit", "push", "add", "fetch", "reset", "clean"];
      expect(asked.filter((a) => writes.includes(a.split(" ")[0]!))).toEqual([]);
    } finally {
      server.stop();
    }
  });
});
