// Spec 162: editing a spec's description on its own page.
//
// A description is edited constantly — a measurement added, a decision
// closed, a point the analysis got wrong — and every one of those edits
// meant leaving the dashboard for an editor and a terminal. Spec 150
// put the four files on a page; this puts one of them in a textarea and
// lets Save commit and push it.
//
// The route pair is the Update button's own shape: a GET that renders,
// a POST guarded by the token, one lock over the shared specs checkout,
// and a 303 back to a page carrying the reason. What is new is that the
// POST WRITES — so almost everything below is about what happens when
// it must not.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../src/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const SPEC = "81-queue-and-runner";
const EDIT = `/specs/aide/${SPEC}/edit`;
const SAVE = `/api/queue/specs/aide/${SPEC}/save`;
const PAGE = `/specs/aide/${SPEC}`;
const FILE_SHA = "a3f9c21aaaaaaa";
const HEAD_SHA = "1111111bbbbbbb";

const DESCRIPTION = "# Queue and runner - Description\n\n## Description\n\nAs it was.\n";

const harness = queueHarness("aide-spec-save-");
afterEach(() => harness.cleanup());

const auth = { headers: { "x-aide-token": TOKEN } };

const start = (gitRun: GitRunner, extra = {}) =>
  harness.start({ description: DESCRIPTION, extra: { queueToken: TOKEN, gitRun, ...extra } });

const descriptionPath = (dir: string, folder = SPEC) =>
  join(dir, "root", "aide", "specs", folder, "1-description.md");

// Spec 163: an archived spec is a record, and both halves of the edit
// pair have to say so — hiding the button leaves the save endpoint live
// for anyone who already has the URL.
const ARCHIVED = "150-one-page-shows-the-whole-spec";
const ARCHIVED_TEXT = "# One page shows the whole spec - Description\n";
const startArchived = (gitRun: GitRunner) =>
  harness.start({
    description: DESCRIPTION,
    archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT } },
    extra: { queueToken: TOKEN, gitRun },
  });
const archivedDescriptionPath = (dir: string) =>
  join(dir, "root", "aide", "specs", "archive", ARCHIVED, "1-description.md");

/** A specs checkout that is clean, on its default branch, reachable,
 *  and whose description last moved at `FILE_SHA`. Everything a save
 *  asks for succeeds unless a test overrides it. */
const savable = (root: string, extra: Record<string, { code: number; stdout?: string }> = {}): GitRunner => {
  const answers: Record<string, { code: number; stdout?: string }> = {
    "rev-parse --show-toplevel": { code: 0, stdout: `${root}\n` },
    // Something IS staged after the write: the ordinary case is a real
    // edit. The no-op test flips this one line.
    "diff --cached --quiet HEAD": { code: 1 },
    "diff --quiet HEAD": { code: 0 },
    "rev-parse --abbrev-ref HEAD": { code: 0, stdout: "main\n" },
    "rev-parse HEAD": { code: 0, stdout: `${HEAD_SHA}\n` },
    "symbolic-ref --quiet refs/remotes/origin/HEAD": { code: 0, stdout: "refs/remotes/origin/main\n" },
    fetch: { code: 0 },
    "merge-base --is-ancestor": { code: 0 },
    "merge -q --ff-only": { code: 0 },
    "log -1 --format=": { code: 0, stdout: `${FILE_SHA}\t2026-08-21T09:14:00+02:00\n` },
    add: { code: 0 },
    commit: { code: 0 },
    push: { code: 0 },
    "reset --hard": { code: 0 },
    ...extra,
  };
  return async (_dir, args) => {
    const line = args.join(" ");
    for (const [prefix, answer] of Object.entries(answers)) {
      if (line.startsWith(prefix)) return { code: answer.code, stdout: answer.stdout ?? "" };
    }
    return { code: 1, stdout: "" };
  };
};

const post = (base: string, body: Record<string, string>, path = SAVE, token: string | null = TOKEN) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(token ? { "x-aide-token": token } : {}),
    },
    redirect: "manual",
    body: new URLSearchParams(body).toString(),
  });

const NEW_TEXT = "# Queue and runner - Description\n\n## Description\n\nAs it is now.\n";

// --- criteria 2, 10: the page the Edit link opens ---------------------------

describe("GET the edit page", () => {
  test("holds the description's current text and the commit it was read at", async () => {
    const { base } = start(savable("/host"));
    const res = await fetch(`${base}${EDIT}`, auth);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain("As it was.");
    expect(html).toContain(FILE_SHA);
  });

  // Ten seconds is long enough to lose a paragraph.
  test("does not refresh itself under the reader", async () => {
    const { base } = start(savable("/host"));
    expect(await (await fetch(`${base}${EDIT}`, auth)).text()).not.toContain('http-equiv="refresh"');
  });

  test("a spec nobody has is a 404, not a blank editor", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}/specs/aide/99-no-such-spec/edit`, auth)).status).toBe(404);
  });

  test("it is a GET, and behind the token like every other spec path", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}${EDIT}`, { method: "POST", ...auth, redirect: "manual" })).status).toBe(405);
    expect((await fetch(`${base}${EDIT}`)).status).toBe(401);
  });

  test("the spec page offers the link that leads here", async () => {
    const { base } = start(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    expect(html).toContain(`href="${EDIT}"`);
  });

  // Criterion 11 (spec 163): the button is gone from the page, but the
  // route resolved through `specDir()` with no archived check at all,
  // so the form was one URL away.
  test("an archived spec has no edit page — it is a record", async () => {
    const { base } = startArchived(savable("/host"));
    const res = await fetch(`${base}/specs/aide/${ARCHIVED}/edit`, { ...auth, redirect: "manual" });
    expect(res.status).not.toBe(200);
    expect(await res.text()).not.toContain("<textarea");
  });
});

// --- criterion 3: a save that goes through ----------------------------------

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

  // A run works in a worktree branched when it started, so a hand edit
  // cannot corrupt it — the run simply finishes against an older
  // description, and the row says "description changed since", which is
  // exactly right. Nothing gates Save on job state.
  test("a job queued for the same spec does not gate the save", async () => {
    const { base, dir } = start(savable("/host"));
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["analyze"] }),
    });
    expect(queued.status).toBe(200);
    const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
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
    ["an unreachable origin", { fetch: { code: 128 } }, "origin"],
    ["a push that fails", { push: { code: 1 } }, "push"],
  ] as [string, Record<string, { code: number; stdout?: string }>, string][]) {
    test(`${what}: back to the editor with the reason`, async () => {
      const { base, dir } = start(savable("/host", extra));
      const res = await post(base, { text: NEW_TEXT, baseSha: FILE_SHA });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(EDIT)).toBe(true);
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
    expect(location.startsWith(EDIT)).toBe(true);
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
        // Twice per request: once to key the lock, once inside it. The
        // second is where that request's git sequence begins.
        if (seen === 2) {
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
      extra: { queueToken: TOKEN, gitRun },
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

// --- spec 166: the dependency is a field on this page, not markdown ---------
//
// The `Depends on:` line was writable only at creation. It IS a line in
// this very file, so the field belongs to the writer this file already
// has — and it is the SOLE writer: the GET strips the raw line out of
// the textarea, the POST always rebuilds it from the field. Two
// controls for one fact can disagree; one cannot.

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
      extra: { queueToken: TOKEN, gitRun },
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

  // --- criteria 1, 2: what the page opens with ------------------------------

  test("a spec that depends on nothing opens with the field empty", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).toContain('name="dependsOn"');
    expect(html).toContain('name="dependsOn" value=""');
    expect(html).not.toContain("Depends on:**");
  });

  test("an existing line pre-fills the field and leaves the textarea", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).toContain(`name="dependsOn" value="${OTHER}"`);
    // The raw markdown is gone from the box: one control for one fact.
    expect(html).not.toContain("Depends on:**");
    expect(html).toContain("As it was.");
  });

  // --- criterion 8: when the change takes effect ----------------------------

  test("the page says the change applies from the next gated step", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).toContain("next gated step");
    expect(html).toContain("already running");
  });

  // --- criteria 3, 4, 7: what a save writes ---------------------------------

  test("a spec in the project is written into Tracking info, in one commit", async () => {
    const commits: string[] = [];
    const { base, dir } = startTracked(counting(commits));
    const res = await post(base, { text: TRACKED(), dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
    expect(commits).toHaveLength(1);
  });

  // `blockedDependencies` says so itself: archiving only happens to
  // finished work, so an archived dependency is a satisfied one.
  test("an archived spec is a legitimate dependency, not an unknown one", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: ARCHIVED, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(ARCHIVED)));
  });

  // The bare number is what a person types, and it is what the runtime
  // gate resolves — save-time validation has to accept the same shapes.
  test("a bare number resolves the same way the gate resolves it", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: "99", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS("99")));
  });

  test("emptying the field removes the line", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const res = await post(base, { text: TRACKED(), dependsOn: "", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // --- criteria 5, 6: what a save refuses -----------------------------------

  test("a spec nobody has is refused by name, and nothing is written", async () => {
    const { base, dir } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const res = await post(base, { text: TRACKED(), dependsOn: "77-no-such-spec", baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(EDIT)).toBe(true);
    expect(location).toContain("77-no-such-spec");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  test("a spec cannot depend on itself, by folder or by number", async () => {
    for (const id of [SPEC, "81"]) {
      const { base, dir } = startTracked(savable("/host"));
      const res = await post(base, { text: TRACKED(), dependsOn: id, baseSha: FILE_SHA });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(EDIT)).toBe(true);
      expect(location).toContain("itself");
      expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
    }
  });

  // One bad entry refuses the lot rather than being filtered out — the
  // same discipline every other list-shaped field here keeps.
  test("one unknown entry in a list refuses the whole save", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(), dependsOn: `${OTHER}, 77-no-such`, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("77-no-such");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED());
  });

  // Every template writes `Created:`; a description hand-edited past it
  // has nowhere for the line to go, and a guess would be worse.
  test("no Created line to place it after is refused, not guessed at", async () => {
    const { base, dir } = startTracked(savable("/host"), DESCRIPTION);
    const res = await post(base, { text: DESCRIPTION, dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(EDIT)).toBe(true);
    expect(location).toContain("Created");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // The field wins over whatever the textarea says about that one line,
  // which is what "one writer" means when both arrive in one POST.
  test("a line typed into the textarea does not survive the field", async () => {
    const { base, dir } = startTracked(savable("/host"));
    const res = await post(base, { text: TRACKED(DEPENDS("77-no-such")), dependsOn: OTHER, baseSha: FILE_SHA });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });
});
