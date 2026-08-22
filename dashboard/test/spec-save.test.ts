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

  test("a spec that depends on nothing opens with nothing ticked", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    // Spec 174: a box per spec in the project, as on the New-spec page
    // — never a line to type an identifier into.
    expect(html).toContain(`value="${OTHER}"`);
    expect(html).not.toContain('<input type="text" name="dependsOn"');
    // The boxes, not the whole document: the stylesheet carries a
    // `.checked` rule of its own.
    for (const box of html.match(/<input[^>]*name="dependsOn"[^>]*>/g) ?? []) {
      expect(box).not.toContain("checked");
    }
    expect(html).not.toContain("Depends on:**");
  });

  test("an existing line ticks its box and leaves the textarea", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS(OTHER)));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).toMatch(new RegExp(`value="${OTHER}"[^>]*checked`));
    // The raw markdown is gone from the box: one control for one fact.
    expect(html).not.toContain("Depends on:**");
    expect(html).toContain("As it was.");
  });

  // Spec 174. The line is written by hand as often as by this page, and
  // `resolve_dependency_folder` has always taken a bare number — so the
  // box that gets ticked is the one the RUNNER would resolve the line
  // to, not the one whose folder happens to match the text.
  test("a dependency written as a bare number ticks the spec it resolves to", async () => {
    const { base } = startTracked(savable("/host"), TRACKED(DEPENDS("99")));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).toMatch(new RegExp(`value="${OTHER}"[^>]*checked`));
  });

  // A spec cannot depend on itself, and spec 166 spent a refusal saying
  // so. With a list of real specs the case mostly stops arising: the
  // one box that would say it is not drawn.
  test("the spec being edited is not among the boxes", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).not.toContain(`value="${SPEC}"`);
  });

  // The narrowing this control brings, stated as a test rather than
  // left to be discovered: `targets()` is the live list, so an archived
  // spec is not offered as a NEW dependency. One already written into
  // the line still resolves and still gates the run.
  test("an archived spec is not offered as a new dependency", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${EDIT}`, auth)).text();
    expect(html).not.toContain(`value="${ARCHIVED}"`);
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

  // Spec 174: what the checkbox set actually POSTs — the field repeated
  // once per ticked box, where the old text input sent one comma-joined
  // string. The route already took both shapes; this is the regression
  // check that says so out loud.
  test("two ticked boxes arrive as two fields and both are written", async () => {
    const THIRD = "88-a-third-spec";
    const { base, dir } = harness.start({
      description: TRACKED(),
      alsoSpecs: [OTHER, THIRD],
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const body = new URLSearchParams([
      ["text", TRACKED()],
      ["baseSha", FILE_SHA],
      ["dependsOn", OTHER],
      ["dependsOn", THIRD],
    ]);
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(`${DEPENDS(OTHER)}, \`${THIRD}\``));
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

// --- spec 188: ticking a check is part of editing the spec -------------------
//
// A spec's page had two ways of changing it — the description behind
// Edit and Save, a check behind a box that wrote and committed on its
// own press — and a reader had to learn both. The box is gone from the
// spec's page; the checks that are still holding the spec back are on
// the Edit form instead, under the textarea, and Save commits them
// together with whatever the description text changed to.
//
// The guards spec 182 built are unchanged and are re-proven here on the
// save route: a tick lands on the row it was drawn from, and a
// `4-status.md` a step has written to since the page was drawn refuses
// the save instead of flipping the wrong line. What is new is that a
// refusal on EITHER file discards BOTH — "nothing was saved" is what
// every refusal on this route already promises.

describe("the checks on the Edit form", () => {
  const PHASE = "Phase 4: REFACTOR - Test suite";
  const EARLIER_PHASE = "Phase 3: GREEN - Implement";
  const LATER_PHASE = "Phase 5: SHIP - After the merge";
  const OPEN_ROW = "| Manual check at 375px in a real browser | ⬜ | still outstanding |";
  const SECOND_OPEN_ROW = "| Read the whole diff once | ⬜ | |";
  const DONE_ROW = "| Run the full test suite | ✅ | 1742 pass |";
  const EARLIER_DONE_ROW = "| Write the code | ✅ | |";
  const LATER_ROW = "| Watch the first real run | ⬜ | |";
  const ticked = (row: string) => row.replace("| ⬜ |", "| ✅ |");

  const HEADER = ["| Task | Status | Notes |", "|------|--------|-------|"];
  const phaseSection = (heading: string, rows: string[]) =>
    [`## ${heading}`, "", "### Tasks", "", ...HEADER, ...rows, ""].join("\n");

  /** Three phases: one settled, the current one, and one the workflow
   *  has not reached. `parseStatus` calls the first section still
   *  carrying an open mark the current phase, which is Phase 4 here. */
  const STATUS = [
    "# Queue - Status",
    "",
    "## Tracking info",
    "",
    "- **Workflow steps completed:** create, analyze, implement",
    "",
    "---",
    "",
    phaseSection(EARLIER_PHASE, [EARLIER_DONE_ROW]),
    phaseSection(PHASE, [DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW]),
    phaseSection(LATER_PHASE, [LATER_ROW]),
  ].join("\n");

  /** Spec 190: the same three phases, with every open mark spelled out
   *  the way a step actually wrote one — `Waiting`, not `⬜`. Nothing
   *  else differs. */
  const WORDED = STATUS.replace(/\| ⬜ \|/g, "| Waiting |");

  /** A spec a headless archive run declined: the hold-back section it
   *  wrote, and exactly one open row left anywhere in the file. */
  const HELD_BACK_REASON = "- the manual browser check (Phase 4, still unchecked) — tick it on the spec's page";
  const heldBack = (rows: string[]) =>
    [
      "# Queue - Status",
      "",
      "## Tracking info",
      "",
      "- **Workflow steps completed:** create, analyze, implement",
      "",
      "---",
      "",
      "## Archive held back",
      "",
      HELD_BACK_REASON,
      "",
      "---",
      "",
      phaseSection(EARLIER_PHASE, [EARLIER_DONE_ROW]),
      phaseSection(PHASE, rows),
    ].join("\n");

  const startWithChecks = (gitRun: GitRunner, status = STATUS) =>
    harness.start({ description: DESCRIPTION, status, extra: { queueToken: TOKEN, gitRun } });

  const statusPath = (dir: string, folder = SPEC) => join(dir, "root", "aide", "specs", folder, "4-status.md");

  /** The form's own body: the textarea, the description's sha, the one
   *  shared phase every box on the form belongs to, and `4-status.md`'s
   *  own sha. `tick` is repeated once per ticked box, exactly as the
   *  `dependsOn` boxes above already arrive. */
  const save = (base: string, over: { text?: string; ticks?: string[]; baseSha?: string; statusBaseSha?: string } = {}) => {
    const body = new URLSearchParams([
      ["text", over.text ?? DESCRIPTION],
      ["baseSha", over.baseSha ?? FILE_SHA],
      ["checksPhase", PHASE],
      ["statusBaseSha", over.statusBaseSha ?? FILE_SHA],
      ...(over.ticks ?? []).map((line): [string, string] => ["tick", line]),
    ]);
    return fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
  };

  /** Every git command the run was given, so the ONE commit and its
   *  message can both be read back. */
  const recording = (extra: Record<string, { code: number; stdout?: string }> = {}) => {
    const calls: string[][] = [];
    const inner = savable("/host", extra);
    const run: GitRunner = async (dir, args) => {
      calls.push(args);
      return inner(dir, args);
    };
    return { run, calls };
  };
  const messageOf = (calls: string[][]): string => {
    const commit = calls.find((c) => c[0] === "commit")!;
    return commit[commit.indexOf("-m") + 1]!;
  };

  // --- criterion 4: which checks the form offers ----------------------------

  describe("GET the edit page", () => {
    test("the current phase's open rows are boxes in the same form as the textarea", async () => {
      const { base } = startWithChecks(savable("/host"));
      const html = await (await fetch(`${base}${EDIT}`, auth)).text();
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html).toContain('name="tick"');
      // One shared hidden phase, not one per row: every box on this form
      // belongs to the same phase by construction.
      expect(html).toContain(`name="checksPhase"`);
      expect(html).toContain(`name="statusBaseSha"`);
      // Inside the one form that Save posts — there is no second one.
      expect(html.match(/<form method="post"/g)!).toHaveLength(1);
    });

    // "A check already made" — the first of the description's two
    // exclusions, tested on its own inside the CURRENT phase, so it is
    // not merely a by-product of the phase filter.
    test("a row already done in the current phase is not offered", async () => {
      const { base } = startWithChecks(savable("/host"));
      const html = await (await fetch(`${base}${EDIT}`, auth)).text();
      expect(html).not.toContain("Run the full test suite");
    });

    // "A check nothing is waiting on" — the second exclusion: a phase
    // the workflow has not reached is sitting at its template default.
    test("an open row in a later phase is not offered", async () => {
      const { base } = startWithChecks(savable("/host"));
      const html = await (await fetch(`${base}${EDIT}`, auth)).text();
      expect(html).not.toContain("Watch the first real run");
      expect(html).not.toContain(LATER_PHASE);
    });

    // Spec 190, criterion 1. With every open mark written in words the
    // page used to render with NO boxes at all: phase detection found
    // no `⬜` anywhere, called the whole file done, and the row filter
    // then matched nothing.
    test("an open row written in words is offered exactly as a symbol one is", async () => {
      const { base } = startWithChecks(savable("/host"), WORDED);
      const html = await (await fetch(`${base}${EDIT}`, auth)).text();
      expect(html).toContain('name="tick"');
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html).not.toContain("Watch the first real run");
    });

    test("a spec whose every phase is done offers no checks at all", async () => {
      const done = [
        "# Queue - Status",
        "",
        phaseSection(PHASE, [DONE_ROW]),
      ].join("\n");
      const { base } = startWithChecks(savable("/host"), done);
      const html = await (await fetch(`${base}${EDIT}`, auth)).text();
      expect(html).not.toContain('name="tick"');
      expect(html).toContain("<textarea");
    });

    // A LOW-complexity spec on the simple checklist layout, or one never
    // analysed: no phase sections at all is a real answer, not an error.
    test("a status file with no phase sections at all opens all the same", async () => {
      const { base } = startWithChecks(savable("/host"), "# Queue - Status\n\n- [ ] something\n");
      const res = await fetch(`${base}${EDIT}`, auth);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).not.toContain('name="tick"');
      expect(html).toContain("<textarea");
    });
  });

  // --- criteria 1, 2, 3: what one Save writes -------------------------------

  test("a tick with the description unchanged commits 4-status.md alone", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await save(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  test("a description edit with no box ticked leaves 4-status.md untouched", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  test("a tick and a description edit in the same Save are ONE commit", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await save(base, { text: NEW_TEXT, ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(1);
  });

  test("two boxes ticked in one Save both flip", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await save(base, { ticks: [OPEN_ROW, SECOND_OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)).replace(SECOND_OPEN_ROW, ticked(SECOND_OPEN_ROW)),
    );
  });

  // --- spec 190: the hold-back note a met check leaves behind ---------------

  test("ticking a word-written row flips it to ✅ and commits like any other", async () => {
    const { base, dir } = startWithChecks(savable("/host"), WORDED);
    const row = "| Manual check at 375px in a real browser | Waiting | still outstanding |";
    const res = await save(base, { ticks: [row] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(WORDED.replace(row, ticked(OPEN_ROW)));
  });

  test("ticking the last open check anywhere in the file clears the hold-back section", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await save(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    const written = readFileSync(statusPath(dir), "utf-8");
    expect(written).toContain(ticked(OPEN_ROW));
    expect(written).not.toContain("## Archive held back");
    expect(written).not.toContain(HELD_BACK_REASON);
    // Everything the section sat between is still there.
    expect(written).toContain("- **Workflow steps completed:** create, analyze, implement");
    expect(written).toContain(EARLIER_DONE_ROW);
  });

  test("a spec still carrying open work keeps its hold-back section", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW, SECOND_OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await save(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status.replace(OPEN_ROW, ticked(OPEN_ROW)));
  });

  // The clearing is scoped to the tick path: a save that only edits the
  // description must not go rewriting a section it never touched.
  test("a description edit alone leaves the hold-back section where it is", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status);
  });

  // --- what the commit records ----------------------------------------------

  describe("the commit message", () => {
    test("a tick alone reads as a check made by hand, not as an edit", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { ticks: [OPEN_ROW] });
      const message = messageOf(git.calls);
      expect(message).toBe(`Tick a check in 4-status.md for ${SPEC} by hand from the dashboard`);
    });

    test("a description edit alone still reads exactly as it did", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT });
      expect(messageOf(git.calls)).toBe(`Edit 1-description.md for ${SPEC} from the dashboard`);
    });

    // Both halves, in the order the fields are read — a commit that both
    // edited the prose and ticked a box says so on both counts.
    test("both together say both, in one message", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT, ticks: [OPEN_ROW] });
      expect(messageOf(git.calls)).toBe(
        `Edit 1-description.md and tick a check in 4-status.md for ${SPEC} by hand from the dashboard`,
      );
    });
  });

  // --- criterion 5: a refusal discards BOTH halves --------------------------

  test("a 4-status.md that moved under the editor refuses the whole save", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await save(base, { text: NEW_TEXT, ticks: [OPEN_ROW], statusBaseSha: "0000000ffffff" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(EDIT)).toBe(true);
    expect(location).toContain("changed since");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // The sha still matches — the same commit — but the row does not: the
  // reader sat on the page while a step rewrote the table around it.
  test("a tick naming a row that no longer reads as it did refuses the whole save", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await save(base, {
      text: NEW_TEXT,
      ticks: ["| Manual check at 375px in a real browser | ⬜ | as it once was |"],
    });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(EDIT)).toBe(true);
    expect(location).toContain("error=");
    // The description edit goes with it — never silently applied while
    // the tick is dropped.
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a row that is already done is refused rather than committed again", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await save(base, { ticks: [DONE_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a phase the file does not have is refused", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const body = new URLSearchParams([
      ["text", DESCRIPTION],
      ["baseSha", FILE_SHA],
      ["checksPhase", "Phase 9: NOTHING"],
      ["statusBaseSha", FILE_SHA],
      ["tick", OPEN_ROW],
    ]);
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // A body with boxes but no phase to read them against is a request
  // that never came from this form.
  test("ticks with no phase named are refused rather than guessed at", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const body = new URLSearchParams([
      ["text", DESCRIPTION],
      ["baseSha", FILE_SHA],
      ["tick", OPEN_ROW],
    ]);
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("an archived spec's checks cannot be ticked either", async () => {
    const { base, dir } = harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const body = new URLSearchParams([
      ["text", ARCHIVED_TEXT],
      ["baseSha", FILE_SHA],
      ["checksPhase", PHASE],
      ["statusBaseSha", FILE_SHA],
      ["tick", OPEN_ROW],
    ]);
    const res = await fetch(`${base}/api/queue/specs/aide/${ARCHIVED}/save`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("archived");
    expect(readFileSync(join(dir, "root", "aide", "specs", "archive", ARCHIVED, "4-status.md"), "utf-8")).toBe(STATUS);
  });

  // --- criterion 7: the box that wrote on its own press is gone -------------
  //
  // Deliberate, and a test rather than an absence: the route's removal
  // has to be visible to the next refactor, not something to be
  // rediscovered.
  test("the old tick route is gone — the URL answers 404", async () => {
    const { base } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}/api/queue/specs/aide/${SPEC}/status/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams({ phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA }).toString(),
    });
    expect(res.status).toBe(404);
    expect(readFileSync(statusPath((await startWithChecks(savable("/host"))).dir), "utf-8")).toBe(STATUS);
  });

  test("the spec's own page carries no control that writes on its press", async () => {
    const { base } = startWithChecks(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    // The rows are still there — the banner is a summary, and that is
    // not what changed.
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).not.toContain("/status/tick");
    const banner = html.match(/<section class="checks">[\s\S]*?<\/section>/)![0];
    expect(banner).not.toContain("<form");
    expect(banner).not.toContain("action=");
  });
});
