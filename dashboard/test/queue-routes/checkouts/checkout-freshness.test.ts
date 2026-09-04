import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createServer,
} from "../../../src/serve/serve.ts";
import { createGitRunner, type GitRunner } from "../../../src/git/branch-status.ts";
import { ensureDashboardCheckout } from "../../../src/git/dashboard-checkout.ts";
import { failFetch } from "../../helpers/queue-server.ts";
import {
  TOKEN,
  setupQueueRoutesHarness,
} from "../fixtures.ts";
import { checkoutSafetyHelpers } from "./checkout-safety-fixtures.ts";

const { harness } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];
const { git, realProject } = checkoutSafetyHelpers(ownDirs);

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

// Spec 205: the dashboard works in checkouts of its own.
//
// Split out of checkout-and-render-safety.test.ts by theme: this file
// carries the checkout-freshness test (spec 216). The write-direction
// tests and the checkout-listing (spec 218) tests are their own sibling
// files, sharing `git` and `realProject` via ./checkout-safety-fixtures.ts.
describe("the dashboard works in checkouts of its own (spec 205)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };

  /** Poll until `check` says yes, or give up. Nothing here can be
   *  awaited directly: what is under test is a background tick. */
  async function until(check: () => boolean, budgetMs = 5000): Promise<boolean> {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return check();
  }

  // Spec 216: a run starts from a checkout that is current.
  //
  // `ensureCheckout` handed a caller the bring-up-to-date already in
  // flight for that project, and a fetch that began before a push
  // answers with the picture from before it. Spec 215 was pushed,
  // queued, and refused as `unknown spec` (2026-08-23).
  //
  // This is about the WIRING, not the primitive: `get` and `fresh` are
  // two methods on one object, so `tickRunner` calling the wrong one
  // type-checks and every `CheckoutEnsurer` unit test goes on passing.
  // What is asserted is what the spawned STEP actually saw on disk.
  test("a step is not started from a checkout older than the job (spec 216)", async () => {
    const { projectsRoot, person, site, owned } = realProject();
    const ownedCode = join(owned, "aide", "code");

    // Made before the server starts, so the boot-time warm is a FETCH
    // rather than a clone — that fetch is the one held open below.
    const made = await ensureDashboardCheckout(createGitRunner(), {
      base: owned,
      project: "aide",
      personDir: person,
    });
    expect(made.ok).toBe(true);

    let releaseFetch = (): void => {};
    const held = new Promise<void>((r) => (releaseFetch = r));
    let holding = false;
    let heldOnce = false;
    const real = createGitRunner();
    // The answer is TAKEN before the push and delivered after it.
    // Delaying the call instead would fetch the push itself, which is
    // the one thing this race is not.
    const gated: GitRunner = async (dir, args, timeoutMs) => {
      const result = await real(dir, args, timeoutMs);
      if (args[0] === "fetch" && dir === ownedCode && !heldOnce) {
        heldOnce = true;
        holding = true;
        await held;
        holding = false;
      }
      return result;
    };

    // The step itself, standing in for `aide-run-spec`: it records
    // whether the checkout it was pointed at had the pushed commit.
    const record = join(site, "what-the-step-saw.txt");
    const bin = join(site, "fake-run-spec");
    writeFileSync(
      bin,
      `#!/bin/sh\nif [ -f "$2/pushed.md" ]; then echo current > ${record}; else echo stale > ${record}; fi\n`,
      { mode: 0o755 },
    );

    const server = createServer({
      siteDir: site, port: 0, claudeUsageFetch: failFetch,
      mirrorPath: join(site, "runs.json"), queueMirrorPath: join(site, "queue.json"),
      projectRoot: projectsRoot, queueProjectRoot: projectsRoot, queueProjects: ["aide"], queueToken: TOKEN,
      dashboardCheckoutRoot: owned, gitRun: gated,
      queueRunnerBin: bin, queueResultDir: join(site, "jobs"),
    });
    try {
      // The boot-time warm's bring-up-to-date, in flight and going
      // nowhere: the "unrelated caller" of the incident.
      expect(await until(() => holding)).toBe(true);

      // Somebody pushes — after that fetch took its picture.
      writeFileSync(join(person, "pushed.md"), "on origin before the job was queued\n");
      git(person, "add", "-A");
      git(person, "commit", "-qm", "pushed");
      git(person, "push", "-q", "origin", "main");

      // Not awaited: enqueueing ticks the runner in the request itself,
      // and that tick is the caller this spec is about — it is still
      // holding on the stale fetch, which is exactly the state the fix
      // has to survive.
      const posted = fetch(`http://127.0.0.1:${server.port}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] }),
      });
      await new Promise((r) => setTimeout(r, 500));
      releaseFetch();
      expect((await posted).status).toBe(200);

      expect(await until(() => existsSync(record), 25000)).toBe(true);
      expect(readFileSync(record, "utf-8").trim()).toBe("current");
    } finally {
      releaseFetch();
      server.stop();
    }
  }, 45000);
});
