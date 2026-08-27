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
//
// Spec 212: the GET is gone — the textarea is the spec page's own
// Description tab — and the one POST that could commit a description
// edit and a ticked check TOGETHER is two POSTs now, `/save` for the
// description and `/tick` for the checks, each committing its own one
// file. A refusal on one can no longer discard the other, because the
// other was never in the same request.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../src/git/branch-status.ts";
import { queueHarness } from "./helpers/queue-server.ts";

const TOKEN = "s3cret-token";
const SPEC = "81-queue-and-runner";
const EDIT = `/specs/aide/${SPEC}/edit`;
const SAVE = `/api/queue/specs/aide/${SPEC}/save`;
const TICK = `/api/queue/specs/aide/${SPEC}/tick`;
const DESCRIPTION_TAB = `/specs/aide/${SPEC}?tab=description`;
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

// --- spec 212, criterion 8: the second page is gone -------------------------
//
// The textarea lives on the spec page's own Description tab now, so the
// address it used to have has nothing behind it. Removed rather than
// redirected: nothing inside the dashboard linked to it once the Edit
// button went, and every other retired route here answers 404.

describe("GET the edit page", () => {
  test("the address it had answers 404, on a live spec and an archived one", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}${EDIT}`, auth)).status).toBe(404);
    const archived = startArchived(savable("/host"));
    expect((await fetch(`${archived.base}/specs/aide/${ARCHIVED}/edit`, auth)).status).toBe(404);
  });

  test("the spec page links to no such page — the tab is where the textarea is", async () => {
    const { base } = start(savable("/host"));
    const html = await (await fetch(`${base}${PAGE}`, auth)).text();
    expect(html).not.toContain(EDIT);
    expect(html).toContain(`?tab=description`);
  });

  test("the Description tab holds the text and the commit it was read at", async () => {
    const { base } = start(savable("/host"));
    const res = await fetch(`${base}${DESCRIPTION_TAB}`, auth);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<textarea");
    expect(html).toContain("As it was.");
    expect(html).toContain(FILE_SHA);
  });

  // Ten seconds is long enough to lose a paragraph. This is why the
  // form had a page of its own before spec 212.
  test("the Description tab does not refresh itself under the reader", async () => {
    const { base } = start(savable("/host"));
    expect(await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text()).not.toContain('http-equiv="refresh"');
  });

  test("a spec nobody has is a 404, not a blank editor", async () => {
    const { base } = start(savable("/host"));
    expect((await fetch(`${base}/specs/aide/99-no-such-spec?tab=description`, auth)).status).toBe(404);
  });

  // Criterion 11 (spec 163): an archived spec is a record. Hiding the
  // control is not the guard — the save endpoint is — but the tab must
  // not offer a box that only gets refused.
  test("an archived spec's Description tab is read-only", async () => {
    const { base } = startArchived(savable("/host"));
    const res = await fetch(`${base}/specs/aide/${ARCHIVED}?tab=description`, auth);
    expect(res.status).toBe(200);
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
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
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
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
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
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).toMatch(new RegExp(`value="${OTHER}"[^>]*checked`));
  });

  // A spec cannot depend on itself, and spec 166 spent a refusal saying
  // so. With a list of real specs the case mostly stops arising: the
  // one box that would say it is not drawn.
  test("the spec being edited is not among the boxes", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).not.toContain(`value="${SPEC}"`);
  });

  // The narrowing this control brings, stated as a test rather than
  // left to be discovered: `targets()` is the live list, so an archived
  // spec is not offered as a NEW dependency. One already written into
  // the line still resolves and still gates the run.
  test("an archived spec is not offered as a new dependency", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
    expect(html).not.toContain(`value="${ARCHIVED}"`);
  });

  // --- criterion 8: when the change takes effect ----------------------------

  test("the page says the change applies from the next gated step", async () => {
    const { base } = startTracked(savable("/host"));
    const html = await (await fetch(`${base}${DESCRIPTION_TAB}`, auth)).text();
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
    expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
    expect(location).toContain("77-no-such-spec");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(TRACKED(DEPENDS(OTHER)));
  });

  test("a spec cannot depend on itself, by folder or by number", async () => {
    for (const id of [SPEC, "81"]) {
      const { base, dir } = startTracked(savable("/host"));
      const res = await post(base, { text: TRACKED(), dependsOn: id, baseSha: FILE_SHA });
      expect(res.status).toBe(303);
      const location = decodeURIComponent(res.headers.get("location")!);
      expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
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
    expect(location.startsWith(DESCRIPTION_TAB)).toBe(true);
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

// --- spec 188, split in two by spec 212: ticking a check --------------------
//
// A spec's page had two ways of changing it — the description behind
// Edit and Save, a check behind a box that wrote and committed on its
// own press — and a reader had to learn both. Spec 188 answered that by
// putting the checks on the Edit form, under one Save.
//
// Spec 212 splits them again, and this time they are not two ways of
// changing one thing: the description's textarea is the Description
// tab, the checks are boxes on Overview, and each has a Save that
// commits its own single file. A person no longer has to open the
// description editor in order to tick a box.
//
// The guards spec 182 built are unchanged and are re-proven here on the
// tick route: a tick lands on the row it was drawn from, and a
// `4-status.md` a step has written to since the page was drawn refuses
// the tick instead of flipping the wrong line. What is NEW is what a
// refusal can no longer do — discard a description edit that was never
// in the same request.

describe("the checks on the Overview tab", () => {
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

  /** Spec 266: a LOW-complexity spec's `4-status.md` uses `## Checklist`
   *  instead of `## Phase N: ...` — must offer the same box on Overview
   *  and accept the same real tick. */
  const CHECKLIST_PHASE = "Checklist";
  const CHECKLIST_OPEN_ROW = "| Run the manual browser check | ⬜ | |";
  const checklistSection = (rows: string[]) => ["## Checklist", "", ...HEADER, ...rows, ""].join("\n");
  const CHECKLIST_STATUS = [
    "# Queue - Status",
    "",
    "## Tracking info",
    "",
    "- **Workflow steps completed:** create, analyze, implement",
    "",
    "---",
    "",
    checklistSection([CHECKLIST_OPEN_ROW]),
  ].join("\n");

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

  /** The checks form's own body, and nothing else: the one shared phase
   *  every box on it belongs to, `4-status.md`'s own sha, and one
   *  `tick` per ticked box. There is no `text` field — the description
   *  is not in this request and cannot be written by it. */
  const tick = (base: string, over: { ticks?: string[]; phase?: string; statusBaseSha?: string } = {}) => {
    const body = new URLSearchParams([
      ...(over.phase === null ? [] : ([["checksPhase", over.phase ?? PHASE]] as [string, string][])),
      ["statusBaseSha", over.statusBaseSha ?? FILE_SHA],
      ...(over.ticks ?? []).map((line): [string, string] => ["tick", line]),
    ]);
    return fetch(`${base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: body.toString(),
    });
  };

  /** The description form's own body: the textarea and its sha. */
  const save = (base: string, over: { text?: string; baseSha?: string } = {}) =>
    post(base, { text: over.text ?? DESCRIPTION, baseSha: over.baseSha ?? FILE_SHA });

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

  // --- criterion 1: which checks Overview offers as boxes -------------------

  describe("GET the Overview tab", () => {
    const overview = (base: string) => fetch(`${base}${PAGE}`, auth).then((r) => r.text());

    test("the current phase's open rows are boxes in a form of their own", async () => {
      const { base } = startWithChecks(savable("/host"));
      const html = await overview(base);
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html).toContain('name="tick"');
      // One shared hidden phase, not one per row: every box on this form
      // belongs to the same phase by construction.
      expect(html).toContain(`name="checksPhase"`);
      expect(html).toContain(`name="statusBaseSha"`);
      // Its own action, not the description's: two forms, two commits.
      expect(html).toContain(`action="${TICK}"`);
      expect(html).not.toContain("<textarea");
    });

    // "A check already made" — the first of the description's two
    // exclusions. The row is still SHOWN, because a list that only ever
    // shrinks says nothing about how far the spec got; it is not a box.
    test("a row already done in the current phase is shown but is not a box", async () => {
      const html = await overview(startWithChecks(savable("/host")).base);
      expect(html).toContain("Run the full test suite");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    // "A check nothing is waiting on" — the second exclusion: a phase
    // the workflow has not reached is sitting at its template default.
    test("an open row in a later phase is shown but is not a box", async () => {
      const html = await overview(startWithChecks(savable("/host")).base);
      expect(html).toContain("Watch the first real run");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    // Spec 190, criterion 1. With every open mark written in words the
    // page used to render with NO boxes at all: phase detection found
    // no `⬜` anywhere, called the whole file done, and the row filter
    // then matched nothing.
    test("an open row written in words is offered exactly as a symbol one is", async () => {
      const html = await overview(startWithChecks(savable("/host"), WORDED).base);
      expect(html).toContain('name="tick"');
      expect(html).toContain("Manual check at 375px in a real browser");
      expect(html).toContain("Read the whole diff once");
      expect(html.match(/name="tick"/g)!).toHaveLength(2);
    });

    test("a spec whose every phase is done offers no boxes at all", async () => {
      const done = ["# Queue - Status", "", phaseSection(PHASE, [DONE_ROW])].join("\n");
      const html = await overview(startWithChecks(savable("/host"), done).base);
      expect(html).not.toContain('name="tick"');
      expect(html).toContain("Run the full test suite");
    });

    // A spec never analysed: no phase sections at all is a real answer,
    // not an error.
    test("a status file with no phase sections at all opens all the same", async () => {
      const { base } = startWithChecks(savable("/host"), "# Queue - Status\n\n- [ ] something\n");
      const res = await fetch(`${base}${PAGE}`, auth);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toContain('name="tick"');
    });

    // Spec 266: a LOW-complexity spec's `## Checklist` heading used to
    // fold into the "no phase sections at all" case above and render
    // "no checks yet" — it must now offer the same box a `## Phase`
    // section's open row already gets.
    test("a ## Checklist row is offered as a box, same as a ## Phase row", async () => {
      const html = await overview(startWithChecks(savable("/host"), CHECKLIST_STATUS).base);
      expect(html).toContain("Run the manual browser check");
      expect(html).toContain('name="tick"');
      expect(html).toContain(`value="${CHECKLIST_PHASE}"`);
    });
  });

  // --- criteria 6, 7: two routes, two commits, one file each ----------------

  test("a tick commits 4-status.md alone, and never the description", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).toContain("4-status.md");
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).not.toContain("1-description.md");
  });

  // Spec 266: the real end-to-end route, not just the parser — a
  // `## Checklist` row's tick must flip it to done on disk exactly as a
  // `## Phase` row's already does.
  test("a ## Checklist row's tick flips it to done on disk through the real /tick route", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run, CHECKLIST_STATUS);
    const res = await tick(base, { ticks: [CHECKLIST_OPEN_ROW], phase: CHECKLIST_PHASE });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      CHECKLIST_STATUS.replace(CHECKLIST_OPEN_ROW, ticked(CHECKLIST_OPEN_ROW)),
    );
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
  });

  test("a queued matching job refuses a direct tick without changing 4-status.md", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: ["implement"] }),
    });
    expect(queued.status).toBe(200);

    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("still running");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  test("a description save commits 1-description.md alone, and never the status", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(1);
    expect(git.calls.find((c) => c[0] === "add")!.join(" ")).not.toContain("4-status.md");
  });

  // The point of the split: what used to be one commit carrying both is
  // two independent ones, and nothing in the request can carry the
  // other file.
  test("a tick and a description edit are two commits, each of one file", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    expect((await save(base, { text: NEW_TEXT })).status).toBe(303);
    expect((await tick(base, { ticks: [OPEN_ROW] })).status).toBe(303);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(NEW_TEXT);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)));
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(2);
    expect(git.calls.filter((c) => c[0] === "push")).toHaveLength(2);
  });

  // A `text` field posted at the tick route is a request that did not
  // come from the checks form, and it writes nothing.
  test("a text field sent to the tick route does not write the description", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([
        ["text", NEW_TEXT],
        ["baseSha", FILE_SHA],
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(readFileSync(descriptionPath(dir), "utf-8")).toBe(DESCRIPTION);
  });

  // And the reverse: the tick fields sent to the description's own
  // route flip nothing.
  test("tick fields sent to the save route do not flip a row", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${SAVE}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([
        ["text", NEW_TEXT],
        ["baseSha", FILE_SHA],
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("the tick route lands the reader back on Overview, where the boxes are", async () => {
    const { base } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!).startsWith(PAGE)).toBe(true);
  });

  test("it is a POST behind the token, like every other writing route here", async () => {
    const { base } = startWithChecks(savable("/host"));
    expect((await fetch(`${base}${TICK}`, auth)).status).toBe(405);
    expect(
      (
        await fetch(`${base}${TICK}`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          redirect: "manual",
          body: new URLSearchParams({ checksPhase: PHASE, statusBaseSha: FILE_SHA, tick: OPEN_ROW }).toString(),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/queue/specs/aide/99-no-such/tick`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
          redirect: "manual",
          body: new URLSearchParams({ checksPhase: PHASE, statusBaseSha: FILE_SHA, tick: OPEN_ROW }).toString(),
        })
      ).status,
    ).toBe(404);
  });

  test("two boxes ticked in one press both flip", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW, SECOND_OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(
      STATUS.replace(OPEN_ROW, ticked(OPEN_ROW)).replace(SECOND_OPEN_ROW, ticked(SECOND_OPEN_ROW)),
    );
  });

  // Nothing ticked at all is a press of Save with every box clear. It
  // is not a refusal and it is not a commit — there is nothing to say.
  test("Save pressed with no box ticked writes nothing", async () => {
    const git = recording();
    const { base, dir } = startWithChecks(git.run);
    const res = await tick(base);
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
    expect(git.calls.filter((c) => c[0] === "commit")).toHaveLength(0);
  });

  // --- spec 190: the hold-back note a met check leaves behind ---------------

  test("ticking a word-written row flips it to ✅ and commits like any other", async () => {
    const { base, dir } = startWithChecks(savable("/host"), WORDED);
    const row = "| Manual check at 375px in a real browser | Waiting | still outstanding |";
    const res = await tick(base, { ticks: [row] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(WORDED.replace(row, ticked(OPEN_ROW)));
  });

  test("ticking the last open check anywhere in the file clears the hold-back section", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await tick(base, { ticks: [OPEN_ROW] });
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
    const res = await tick(base, { ticks: [OPEN_ROW] });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).not.toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status.replace(OPEN_ROW, ticked(OPEN_ROW)));
  });

  // The clearing belongs to the tick route: a save that only edits the
  // description must not go rewriting a section it never touched — and
  // since spec 212 it could not reach the file if it wanted to.
  test("a description edit alone leaves the hold-back section where it is", async () => {
    const status = heldBack([DONE_ROW, OPEN_ROW]);
    const { base, dir } = startWithChecks(savable("/host"), status);
    const res = await save(base, { text: NEW_TEXT });
    expect(res.status).toBe(303);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(status);
  });

  // --- what each commit records ---------------------------------------------

  describe("the commit message", () => {
    test("a tick reads as a check made by hand, not as an edit", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await tick(base, { ticks: [OPEN_ROW] });
      expect(messageOf(git.calls)).toBe(`Tick a check in 4-status.md for ${SPEC} by hand from the dashboard`);
    });

    test("a description edit still reads exactly as it did", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT });
      expect(messageOf(git.calls)).toBe(`Edit 1-description.md for ${SPEC} from the dashboard`);
    });

    // The sentence that named both files in one commit has nothing left
    // to describe: two files can no longer arrive in one request.
    test("no commit names both files any more", async () => {
      const git = recording();
      const { base } = startWithChecks(git.run);
      await save(base, { text: NEW_TEXT });
      await tick(base, { ticks: [OPEN_ROW] });
      for (const call of git.calls.filter((c) => c[0] === "commit")) {
        expect(call.join(" ")).not.toContain("and tick a check");
      }
    });
  });

  // --- criterion 7: a tick that cannot go through changes nothing -----------

  test("a 4-status.md that moved under the reader refuses the tick", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW], statusBaseSha: "0000000ffffff" });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).toContain("changed since");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // The sha still matches — the same commit — but the row does not: the
  // reader sat on the page while a step rewrote the table around it.
  test("a tick naming a row that no longer reads as it did is refused", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, {
      ticks: ["| Manual check at 375px in a real browser | ⬜ | as it once was |"],
    });
    expect(res.status).toBe(303);
    const location = decodeURIComponent(res.headers.get("location")!);
    expect(location.startsWith(PAGE)).toBe(true);
    expect(location).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // One row that is not there refuses the whole press, the rows beside
  // it included — never applied silently while one of them is dropped.
  test("one bad row refuses every box in the same press", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW, "| No such row | ⬜ | |"] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a row that is already done is refused rather than committed again", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [DONE_ROW] });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  test("a phase the file does not have is refused", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await tick(base, { ticks: [OPEN_ROW], phase: "Phase 9: NOTHING" });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // A body with boxes but no phase to read them against is a request
  // that never came from this form.
  test("ticks with no phase named are refused rather than guessed at", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}${TICK}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([["statusBaseSha", FILE_SHA], ["tick", OPEN_ROW]]).toString(),
    });
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("error=");
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });

  // Spec 163: an archived spec is a record, and the guard is on the
  // route — hiding the boxes leaves it live for anyone with the URL.
  test("an archived spec's checks cannot be ticked", async () => {
    const { base, dir } = harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const res = await fetch(`${base}/api/queue/specs/aide/${ARCHIVED}/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams([
        ["checksPhase", PHASE],
        ["statusBaseSha", FILE_SHA],
        ["tick", OPEN_ROW],
      ]).toString(),
    });
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("archived");
    expect(readFileSync(join(dir, "root", "aide", "specs", "archive", ARCHIVED, "4-status.md"), "utf-8")).toBe(STATUS);
  });

  test("and its Overview offers no box to press", async () => {
    const { base } = harness.start({
      description: DESCRIPTION,
      status: STATUS,
      archivedSpecs: { [ARCHIVED]: { description: ARCHIVED_TEXT, status: STATUS } },
      extra: { queueToken: TOKEN, gitRun: savable("/host") },
    });
    const html = await (await fetch(`${base}/specs/aide/${ARCHIVED}`, auth)).text();
    expect(html).toContain("Manual check at 375px in a real browser");
    expect(html).not.toContain('name="tick"');
  });

  // --- the route spec 188 removed is still gone ----------------------------
  //
  // Deliberate, and a test rather than an absence: `/status/tick` wrote
  // and committed on the press of one box, with no Save at all. The
  // form spec 212 gives back is a different thing — every box on it is
  // posted by one Save — and it lives at `/tick`.
  test("the old per-box route is gone — the URL answers 404", async () => {
    const { base, dir } = startWithChecks(savable("/host"));
    const res = await fetch(`${base}/api/queue/specs/aide/${SPEC}/status/tick`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
      redirect: "manual",
      body: new URLSearchParams({ phase: PHASE, line: OPEN_ROW, baseSha: FILE_SHA }).toString(),
    });
    expect(res.status).toBe(404);
    expect(readFileSync(statusPath(dir), "utf-8")).toBe(STATUS);
  });
});
