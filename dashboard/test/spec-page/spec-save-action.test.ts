// The Save action: what it writes, what it refuses, what two specs
// sharing one checkout do to each other, and the editor's own client.
//
// Split out of spec-edit-save-and-misc.test.ts 2026-09-04; the tests are
// unchanged and keep their names.

// Split out of spec-save.test.ts by theme: the edit page's own retired
// address, the ordinary Save path and its refusals, the description's
// size cap, two specs sharing one checkout, and Save against an
// archived spec.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { GitRunner } from "../../src/git/branch-status.ts";
import {
  TOKEN,
  SPEC,
  SAVE,
  DESCRIPTION_TAB,
  PAGE,
  FILE_SHA,
  DESCRIPTION,
  NEW_TEXT,
  auth,
  ARCHIVED,
  ARCHIVED_TEXT,
  createSpecSaveHarness,
  descriptionPath,
  archivedDescriptionPath,
  savable,
  post,
} from "./spec-save-fixtures.ts";

const { harness, start, startArchived } = createSpecSaveHarness();
afterEach(() => harness.cleanup());

// REQ-4: a job queued or running is simulated the same way
// queue-detail-spec-page-routes.test.ts does — enqueue for real, then
// overwrite the mirror's own state, since a job in flight is not
// otherwise reachable from a fixture that answers everything else
// synchronously.


// --- spec 212, criterion 8: the second page is gone -------------------------
//
// The textarea lives on the spec page's own Description tab now, so the
// address it used to have has nothing behind it. Removed rather than
// redirected: nothing inside the dashboard linked to it once the Edit
// button went, and every other retired route here answers 404.

describe("POST the Save action", () => {
  test("writes the file, commits it, pushes it and returns to the spec", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
  });

  // Its own branch in the save, and its own answer: no empty commit,
  // nothing pushed, and the reader still lands on the spec.
  test("text identical to what is committed commits nothing", async () => {
    const { base, dir } = start(savable("/host", { "diff --cached --quiet HEAD": { code: 0 } }));
    const res = await post(base, { text: DESCRIPTION, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // REQ-6: a Save is now gated on job state, the same way the tick
  // route already gates ticking a check — REQ-4 makes Save write onto
  // an active spec's own open branch, and a save racing the run's own
  // commits to it is exactly what this gate exists to prevent. (Until
  // this spec, nothing gated Save on job state; that is the behavior
  // this test used to assert and REQ-6 deliberately changes.)
  test("a job queued for the same spec gates the save", async () => {
    const { base, dir } = start(savable("/host"));
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
    });
    expect(queued.status).toBe(200);
    const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("error=");
    expect(location).toContain("another job for this spec is still running");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });
});

// --- criteria 5, 6, 7: every way a save is refused --------------------------

describe("a save that cannot go through changes nothing", () => {
  for (const [what, extra, expected] of [
    ["uncommitted changes in the checkout", { "diff --quiet HEAD": { code: 1 } }, "uncommitted"],
    [
      "a checkout parked on a spec branch",
      { "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "aide/162-edit\n" } },
      "aide/162-edit",
    ],
    ["a checkout that has diverged", { "merge-base --is-ancestor": { code: 1 } }, "fast-forward"],
    ["an unreachable origin", { fetch: { code: 128 } }, "Origin"],
    ["a push that fails", { push: { code: 1 } }, "push"],
  ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
    test(`${what}: back to the editor with the reason`, async () => {
      const { base, dir } = start(savable("/host", extra));
      const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
      expect(location).toContain(expected);
      // A refused push is rolled back by git, which is mocked here — so
      // the bytes are only asserted for the refusals that never write.
      if (!("push" in extra)) expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    });
  }

  // The page is rendered once and a reader may sit on it for minutes
  // while an analyze step lands a new version of the very file.
  test("a description that moved under the editor is refused, not merged and not clobbered", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { text: NEW_TEXT, baseSha: "0000000ffffff" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
    expect(location).toContain("changed since");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // Not just on the query string: the editor has to SHOW it, and the
  // textarea has to come back holding what is actually on disk.
  test("the reason is on the page the reader lands on, above the current text", async () => {
    const { base } = start(savable("/host", { "diff --quiet HEAD": { code: 1 } }));
    const location = decodeURIComponent((await post(base, { text: NEW_TEXT, baseSha: FILE_SHA })).headers.get("location")!);
    const html = await (await fetch(`${base}${location}`, auth)).text();
    expect(html).toContain("uncommitted");
    expect(html).toContain("As it was.");
    expect(html).not.toContain("As it is now.");
  });

  test("a body with no text field at all is refused rather than emptying the file", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  test("a spec nobody has cannot be saved to, and GET is not a save", async () => {
    const { base } = start(savable("/host"));
    expect((await post(base, { text: NEW_TEXT }, `/api/queue/specs/aide/99-no-such/save`)).status).toBe(404);
    expect((await fetch(`${base}${SAVE}`, auth)).status).toBe(405);
    expect((await post(base, { text: NEW_TEXT }, SAVE, null)).status).toBe(401);
  });
});

// --- criterion 10: a description is bigger than an action post --------------
//
// Every other POST here is a short action or a small JSON job, and the
// shared 4096-byte cap is right for those. This spec's own
// 1-description.md was over 4096 bytes raw before a single character of
// form-urlencoding overhead, so the save route — and only the save
// route — carries a cap of its own.

describe("the size of a real description", () => {
  const long = (bytes: number) => `# Queue and runner - Description\n\n${"a lorem ipsum line.\n".repeat(Math.ceil(bytes / 20))}`;

  test("a description well over the 4096-byte action cap is saved, not refused", async () => {
    const { base, dir } = start(savable("/host"));
    const text = long(5000);
    expect(text.length).toBeGreaterThan(4096);
    const res = await post(base, { text, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(text);
  });

  test("and one past the save route's own cap is still refused", async () => {
    const { base, dir } = start(savable("/host"));
    const res = await post(base, { text: long(70_000), baseSha: FILE_SHA });
    expect(res.status).toBe(413);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  test("the cap the other routes keep is unchanged", async () => {
    const { base } = start(savable("/host"));
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"], note: "x".repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });
});

// --- criterion 9: one checkout, one git sequence at a time ------------------
//
// Every project and every spec in this deployment's specs root shares
// ONE `.git`. The lock was keyed on the spec's own subfolder, so two
// specs' presses were given two different keys and ran two git
// sequences in one working tree — a lost race for `index.lock`,
// reported as "cannot fast-forward". Harmless while the only write was
// a fast-forward merge; not harmless now.
//
// The assertion is ORDER, not outcome: two independent working trees
// would also both succeed, so "neither failed" would pass with the bug
// still in place.

describe("two specs sharing one checkout", () => {
  test("their git sequences are serialized, never interleaved", async () => {
    const OTHER = "99-a-second-spec";
    const order: string[] = [];
    const probes = new Map<string, number>();
    let current = "";
    let release = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let reached = () => {};
    const firstIsInside = new Promise<void>((r) => {
      reached = r;
    });
    let holding = false;

    const answers = savable("/host");
    const gitRun: GitRunner = async (dir, args) => {
      const line = args.join(" ");
      if (line === "rev-parse --show-toplevel") {
        const seen = (probes.get(dir) ?? 0) + 1;
        probes.set(dir, seen);
        // Three times per request since spec 310: once, unlocked, for
        // REQ-4's own "is this branch open" check (`resolveOpenBranchTarget`,
        // which the save route now makes exactly as the tick route
        // already did); once to key the lock; once inside it. The third
        // is where that request's LOCKED git sequence begins.
        if (seen === 3) {
          current = dir.endsWith(OTHER) ? OTHER : SPEC;
          order.push(`start ${current}`);
        }
      }
      if (line.startsWith("fetch")) {
        if (!holding) {
          holding = true;
          reached();
          await held;
        }
      }
      if (line.startsWith("push")) order.push(`end ${current}`);
      return answers(dir, args);
    };

    const { base } = harness.start({
      description: DESCRIPTION,
      alsoSpecs: [OTHER],
      // Off (spec 298): the background schedule's own `warmSpec` asks
      // `rev-parse --show-toplevel` for every live spec on its own
      // timer, and this fake counts exactly two such calls per SAVE
      // request to tell "key the lock" from "the sequence starts" apart
      // — a third, unrelated caller would corrupt that count.
      extra: { queueToken: TOKEN, gitRun, specCachePollMs: 0 },
    });

    const first = post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
    await firstIsInside;
    const second = post(base, { text: NEW_TEXT, baseSha: FILE_SHA }, `/api/queue/specs/aide/${OTHER}/save`);
    // Long enough for an unserialized second request to have started
    // its own sequence — which is exactly what the old lock key let it do.
    await Bun.sleep(60);
    expect(order).toEqual([`start ${SPEC}`]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual([`start ${SPEC}`, `end ${SPEC}`, `start ${OTHER}`, `end ${OTHER}`]);
  });
});

// --- criterion 7 (spec 163): the save endpoint refuses an archived spec -----

describe("POST the Save action against an archived spec", () => {
  test("writes nothing, and says why on the spec's own page", async () => {
    const { base, dir } = startArchived(savable("/host"));
    const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA }, `/api/queue/specs/aide/${ARCHIVED}/save`);
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location).toContain("error=");
    expect(location).toContain("archived");
    expect(readFileSync(archivedDescriptionPath(dir), "utf-8")).toBe(ARCHIVED_TEXT);
  });
});

// --- telemetry (2-analysis.md, Risk analysis: "Telemetry left on by accident") --
//
// `usageStatistics` defaults to `true` and, per the library's own
// documentation, sends the page's hostname to Google Analytics on every
// mount — a silent regression with no visible symptom in this dashboard
// (including in tests, which run offline: the call just fails quietly)
// unless something checks for it explicitly. A source-text assertion,
// not a built-bundle grep: `minify: true` is free to rewrite the
// literal `false` as `!1`, which would make a built-output check
// fragile in a way a source-level one is not.

describe("the editor client disables Toast UI Editor's telemetry", () => {
  test("spec-editor-client.ts's own source sets usageStatistics: false", async () => {
    const source = await Bun.file(new URL("../../src/spec-editor-client.ts", import.meta.url)).text();
    expect(source).toContain("usageStatistics: false");
  });
});
