import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeSpecTotalDurationMs,
  renderQueueRows,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";
import { ran, statusSaying } from "../helpers/queue-server.ts";
import { fakeGit as gitFake } from "../helpers/fake-git.ts";
import {
  TOKEN,
  JOB,
  specControls,
  phaseDone,
  OPEN_81,
  listUntil,
  dated,
  rowSaysDone,
  setupQueueRoutesHarness,
} from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

/** Temp directories this suite makes for itself, outside the harness. */
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});


// Spec 108: the FILES say what has happened to a spec — not the queue's
// own record of what it ran. The two used to be unioned, so either one
// being true was enough, which is how an archive job that finished
// without moving anything counted as an archived spec.
// Spec 139: one record says how far a spec has got. The dashboard used
// to GUESS — 2-analysis.md over 400 bytes meant analysed, a "Plan
// review" heading in 3-solution.md meant reviewed, 100% in 4-status.md
// meant implemented. On 2026-08-20 the first of those marked spec 138
// analysed before any analyze had run: its untouched analysis template
// is 693 bytes and carries a placeholder the check did not know. The
// row then offered review-plan, and review-plan ran three times against
// an empty template.
describe("spec 139: the steps a spec has had say so themselves", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");

  test("an untouched analysis template is not an analysis (criterion 2)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Spec 138's own file, at its own size, with the placeholder
    // `/aide-create` actually writes — the exact shape that read as
    // done. The record beside it says the spec has only been created.
    writeFileSync(
      join(specDir(dir), "2-analysis.md"),
      "# X - Analysis\n\n## Findings\n\n[not analyzed yet]\n" + "Section placeholder. ".repeat(40),
    );
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create"]));
    const line = specControls(await (await fetch(`${base}/?${OPEN_81}`, auth)).text(), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // And the box that comes pre-ticked is the one that has not run.
    expect(line).toMatch(/value="analyze" checked/);
  });

  test("the recorded list is what the row marks done, and implement is next (criterion 3)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
    expect(line).not.toMatch(/value="analyze" checked/);
  });

  // Implement's mark used to be earned from the percentage, which says
  // how far the TDD phases inside the step have got — not whether the
  // step ran. A spec whose plan has 22 tasks all ticked is implemented
  // because implement SAYS so.
  test("100% without the record does not make implement done (criterion 2)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(specDir(dir), "4-status.md"),
      statusSaying(["create", "analyze"], "- **Total progress:** `100% (22 of 22 completed)`\n"),
    );
    ran(dir, ["create", "analyze"]);
    const line = specControls(await (await fetch(`${base}/?${OPEN_81}`, auth)).text(), "81-queue-and-runner");
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
  });

  test("a spec with no status file at all has had nothing, and does not throw (criterion 4)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    rmSync(join(specDir(dir), "4-status.md"));
    const line = specControls(await listUntil(base, rowSaysDone("create")), "81-queue-and-runner");
    // Spec 176: the folder is on disk, so `create` happened — whatever
    // git records. The steps this test is the guard for are the other
    // four, which stay correctly not done.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toMatch(/value="analyze" checked/);
  });
});

describe("the spec's own history says what has happened, not the queue's", () => {
  test("a step the queue completed is NOT done while the history says otherwise", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    // Analysed already; the status says 95%, so implement is what is
    // still to do.
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(["create", "analyze"], "- **Total progress:** `95% (21 of 22 completed)`\n"),
    );
    ran(dir, ["create", "analyze"]);

    let html = await listUntil(base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);

    // Record a completed implement in the queue's own history, exactly
    // as a finished step does.
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = JSON.parse(readFileSync(join(dir, "queue.json"), "utf-8")) as Record<string, unknown>[];
    // Finished, not still queued: since spec 105 a spec with a job in
    // flight pre-ticks nothing at all — every box on the row is locked.
    mirror[0].state = "done";
    mirror[0].results = [
      { step: "implement", ok: true, costUsd: 12.34, costMeasured: true,
        terminalReason: "completed", at: "2026-08-16T18:00:00Z" },
    ];
    writeFileSync(join(dir, "queue.json"), JSON.stringify(mirror));
    expect(made.job.id).toBeTruthy();

    // A fresh process reading both: the job's `ok` flag changes nothing.
    // The percentage is still 95, so implement is still what to run.
    const second = start({
      queueToken: TOKEN,
      queueMirrorPath: join(dir, "queue.json"),
      projectRoot: join(dir, "root"),
    });
    html = await listUntil(second.base, rowSaysDone("analyze"));
    expect(html).toMatch(/value="implement" checked/);
    // `archive` is ticked here too and always is (spec 200: every phase
    // the spec has left starts ticked), so what says implement is not
    // behind us is the BUTTON — it names the first ticked phase, and
    // would read "Archive" if the queue's own record counted.
    expect(html).toContain(">Implement</button>");
    // And the phase line says the same: a step the queue ran is not a
    // step the spec has HAD.
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(false);
  });

  test("the same step IS done once the runner has committed it", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (22 of 22 completed)`\n",
      ),
    );
    ran(dir, ["create", "analyze", "implement"]);

    const html = await listUntil(base, rowSaysDone("implement"));
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "implement")).toBe(true);
    expect(html).toMatch(/value="archive" checked/);
    // The button is named for the phase a press would run (spec 157) —
    // the bare word "Run" went with the again-variant that preceded it.
    expect(html).not.toContain("Run again");
    expect(html).toContain(">Archive</button>");
  });

  test("a spec whose archive run declined says why, on the row and in the sentence", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (22 of 22 completed)`\n\n" +
          "## Archive held back\n\n- the Slack webhook (Phase 4, still unchecked)\n",
      ),
    );

    // Spec 208: written after the server started, so the disk scan the
    // boot-time cache warm took is a scan of the file before this one.
    // The watcher clears it and the row catches up a tick later.
    const html = await listUntil(base, (h) => h.includes("held back"));
    expect(html).toContain("held back");
    expect(html).toContain("the Slack webhook (Phase 4, still unchecked)");
  });

  // Was "off the list entirely" (spec 86, criterion 7) until spec 221:
  // an archived spec IS a row now, on the chips that ask for one. What
  // survives that change is the DEFAULT view, which is still every spec
  // but the archived ones — and that is what this asserts.
  test("a spec whose folder has been archived is off the default view", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const archived = join(dir, "root", "aide", "specs", "archive", "80-already-archived");
    mkdirSync(archived, { recursive: true });
    writeFileSync(join(archived, "1-description.md"), "# 80 - Description\n");

    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("81-queue-and-runner");
    expect(html).not.toContain("80-already-archived");

    // And on the chip that asks for them, it is there — one list, two
    // readings of it, rather than a spec that has left the dashboard.
    // Polled, because the folder was made after the server started and
    // the disk scan it answers from is cached for a few seconds.
    const deadline = Date.now() + 3000;
    let archivedView = "";
    for (;;) {
      archivedView = await (
        await fetch(`${base}/?state=archived`, { headers: { "x-aide-token": TOKEN } })
      ).text();
      if (archivedView.includes("80-already-archived") || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(archivedView).toContain("80-already-archived");
  });
});
// --- spec 199: time becomes something worth reading -------------------------
//
// A phase says how long it TOOK. Nothing stores a per-step duration —
// a job has one `startedAt` however many steps it ran — so a step's
// own span is sliced out of the boundaries that do exist: the previous
// step's end, or the job's own start for the first one. Getting that
// wrong by reaching for the job's whole span instead is the one
// mistake this block exists to catch.
describe("a phase says how long it took", () => {
  const NOW = "2026-08-16T12:00:00Z";

  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T08:00:00Z",
    ...extra,
  });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  // `renderQueueRows`, not `renderQueuePage`: the page reads the clock
  // itself and takes no `now`, and every figure in this block is
  // measured against one.
  const page = (rows: QueueRowView[], targets: QueueTarget[] = [], spec = "aa-spec") =>
    renderQueueRows(
      rows,
      { runnerAvailable: true, targets, filter: { open: `aide/${spec}` } },
      Date.parse(NOW),
    );

  /** One phase line's Started cell — which since spec 199 holds that
   *  phase's own duration, not when it began. */
  const phaseCell = (html: string, step: string): string =>
    html
      .match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${step}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  /** The spec header row's own Started cell. */
  const headCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      ?.match(/<td data-col="started">(.*?)<\/td>/)?.[1] ?? "";

  test("a finished single-step phase shows its own span (criterion 3)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze"],
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("4m12s");
  });

  // The trap: a job that ran two steps has ONE `startedAt`, and the
  // whole job's span belongs to neither step. The second step's own
  // duration runs from where the first one ended.
  test("a two-step job's second phase shows its own slice, not the job's span (criterion 7)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        startedAt: "2026-08-16T09:00:00Z",
        results: [
          { step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:10:00Z" },
          { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:40:00Z" },
        ],
      }),
    ]);
    expect(phaseCell(html, "analyze")).toContain("10m00s");
    expect(phaseCell(html, "implement")).toContain("30m00s");
    // 40 minutes is the whole job — the answer a reach for
    // `finishedAt - startedAt` would have given.
    expect(phaseCell(html, "implement")).not.toContain("40m");
  });

  test("a phase nobody has run shows nothing at all", () => {
    const html = page([
      job("a1", "aa-spec", {
        startedAt: "2026-08-16T09:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T09:04:12Z" }],
      }),
    ]);
    expect(phaseCell(html, "archive")).toBe("");
  });

  // A running phase carries the instant it began, so the browser can
  // count up from it without waiting for the server to redraw
  // (criterion 4). The server still writes a readable figure into the
  // cell, so the page says something with script switched off.
  test("a running phase carries its start for the page's own clock (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", {
        steps: ["analyze", "implement"],
        stepIndex: 1,
        state: "running",
        startedAt: "2026-08-16T11:00:00Z",
        results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-16T11:30:00Z" }],
      }),
    ]);
    const cell = phaseCell(html, "implement");
    expect(cell).toContain('data-elapsed="2026-08-16T11:30:00Z"');
    expect(cell).toContain("30m00s");
  });

  test("a running FIRST step counts from the job's own start (criterion 4)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T11:45:00Z" }),
    ]);
    expect(phaseCell(html, "analyze")).toContain('data-elapsed="2026-08-16T11:45:00Z"');
    expect(phaseCell(html, "analyze")).toContain("15m00s");
  });

  // The work, not the calendar. These two jobs are three days apart and
  // the spec took twenty minutes (criteria 5 and 6). The TOTAL left the
  // header cell on 2026-08-24 — beside "3 d ago" it read as noise — so
  // the sum now lives only on the phase lines and in what archive
  // writes into 4-status.md; the header carries the date alone.
  test("a finished spec's phases carry their durations; the header only its date", () => {
    const html = page(
      [
        job("a1", "aa-spec", {
          steps: ["analyze"],
          startedAt: "2026-08-13T09:00:00Z",
          results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
        }),
        job("a2", "aa-spec", {
          steps: ["implement", "archive"],
          stepIndex: 1,
          startedAt: "2026-08-16T09:00:00Z",
          results: [
            { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
            { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
          ],
        }),
      ],
      [target("aa-spec", { createdAt: "2026-08-13T08:00:00Z", done: ["analyze", "implement", "archive"] })],
    );
    // 5 + 10 + 5 minutes of work, on the lines that did it; the header
    // cell says when the spec was made and nothing else.
    expect(headCell(html, "aa-spec")).not.toContain("data-total");
    expect(headCell(html, "aa-spec")).toContain("3 d ago");
    expect(phaseCell(html, "analyze")).toContain("5m00s");
    expect(phaseCell(html, "implement")).toContain("10m00s");
    expect(phaseCell(html, "archive")).toContain("5m00s");
  });

  // The header row's own cell is the spec's date, and it does not move
  // because a phase ran.
  test("the header row shows the spec's creation date, whatever its jobs did", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec", { createdAt: "2026-06-01T09:00:00Z" })],
    );
    expect(headCell(html, "aa-spec")).toContain('title="2026-06-01T09:00:00Z"');
  });

  test("a spec git could not date shows a dash rather than a job's time", () => {
    const html = page(
      [job("a1", "aa-spec", { startedAt: "2026-08-16T11:59:00Z" })],
      [target("aa-spec")],
    );
    expect(headCell(html, "aa-spec")).toContain("–");
    expect(headCell(html, "aa-spec")).not.toContain("2026-08-16T11:59:00Z");
  });
});

// Spec 207: the summing the spec list has always done, lifted out of
// the render so the archive-time write calls the SAME function. The
// figure stored in `4-status.md` and the figure the list drew cannot
// drift apart if there is only one of them.
//
// Called directly rather than through a page: what is under test is the
// math and where `done` comes from, and a route test proves neither on
// its own.
describe("computeSpecTotalDurationMs (spec 207)", () => {
  const row = (id: string, extra: Partial<QueueRowView>): QueueRowView => ({
    id,
    project: "aide",
    specFolder: "aa-spec",
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-13T08:00:00Z",
    ...extra,
  });

  /** The same three jobs the list's own "sum, not span" test uses: five
   *  minutes of analyze, ten of implement, five of archive, three days
   *  apart. */
  const rows = (): QueueRowView[] => [
    row("a1", {
      steps: ["analyze"],
      startedAt: "2026-08-13T09:00:00Z",
      results: [{ step: "analyze", ok: true, costUsd: 1, at: "2026-08-13T09:05:00Z" }],
    }),
    row("a2", {
      steps: ["implement", "archive"],
      stepIndex: 1,
      startedAt: "2026-08-16T09:00:00Z",
      results: [
        { step: "implement", ok: true, costUsd: 2, at: "2026-08-16T09:10:00Z" },
        { step: "archive", ok: true, costUsd: 1, at: "2026-08-16T09:15:00Z" },
      ],
    }),
  ];

  const ALL_DONE = ["create", "analyze", "implement", "archive"];

  test("adds the phases up, and answers in milliseconds", () => {
    expect(computeSpecTotalDurationMs(rows(), ALL_DONE)).toBe(20 * 60 * 1000);
  });

  // The whole reason `done` is a PARAMETER. These rows' own results say
  // analyze finished — and `withFreshness` takes analyze back out of
  // `done` when the description was committed after the last analyze
  // ran, which is exactly when the live list shows no total at all. A
  // function that re-derived `done` from the results would store a
  // figure the list itself would not have shown.
  test("`done` is the caller's, never re-derived from the job results", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "implement", "archive"])).toBeUndefined();
  });

  test("a phase still ahead of the spec is no total yet", () => {
    expect(computeSpecTotalDurationMs(rows(), ["create", "analyze"])).toBeUndefined();
  });

  test("a spec nothing has ever run for measures nothing", () => {
    expect(computeSpecTotalDurationMs([], ALL_DONE)).toBeUndefined();
  });

  // The list stopped drawing this figure on 2026-08-24 — beside
  // "3 d ago" it read as noise — so the function's remaining reader is
  // the archive step, which writes the same sum into 4-status.md
  // (spec 207). The list not smuggling it back in is worth a line.
  test("the spec list no longer draws the figure", () => {
    const html = renderQueueRows(
      rows(),
      {
        runnerAvailable: true,
        targets: [{ project: "aide", specFolder: "aa-spec", createdAt: "2026-08-13T08:00:00Z", done: ALL_DONE }],
        filter: { open: "aide/aa-spec" },
      },
      Date.parse("2026-08-16T12:00:00Z"),
    );
    expect(html).not.toContain('data-total="1"');
  });
});

// Spec 207: a landed archive writes what the spec cost in time.
//
// The figure the spec list shows is worked out from the queue's own job
// records, and the queue keeps two hundred jobs. The archive holds
// ninety specs and grows, so a figure that is never written down is a
// figure almost every archived row will be missing. It is written the
// moment the archive branch has actually MERGED — not when the step
// reported success — because a landing that failed leaves a spec that
// is not archived.
describe("what a spec cost in time is written when its archive lands (spec 207)", () => {
  const AUTH = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
  const SPEC = "81-queue-and-runner";
  const BRANCH = `aide/${SPEC}`;
  /** What `rev-parse --show-toplevel` answers. Faked git, so nothing
   *  runs there — it is the lock key and the directory the commit and
   *  the push are addressed to. */
  const REPO_ROOT = "/repos/aide";

  function own(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(d);
    return d;
  }

  /** The runner's own commit subjects for this spec, which is what
   *  decides `done` — `withFreshness` reads git, never the job results.
   *  Newest first, the way `git log` prints them. */
  const HISTORY = [
    `Run /aide-archive for ${SPEC} (headless)`,
    `Run /aide-implement for ${SPEC} (headless)`,
    `Run /aide-analyze for ${SPEC} (headless)`,
  ];

  /** A git that answers every question the landing AND the stamp's own
   *  save ask. The save is `saveSpecFile`, the same call the Edit page
   *  makes: pull-fast-forward, compare the file's last commit against
   *  the caller's, write, stage, commit, push.
   *
   *  `history` is what `git log --all` reports for this spec, and it is
   *  the ONLY thing that decides which steps count as done. `dirty`
   *  makes the pull refuse, which is how a stamp write is failed
   *  without failing anything else. */
  function gitFor({ history = HISTORY, dirty = false } = {}) {
    const calls: { dir: string; args: string[] }[] = [];
    const run = async (dir: string, args: string[]) => {
      calls.push({ dir, args });
      const a = args.join(" ");
      if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
      if (a.startsWith("status --porcelain")) return { code: 0, stdout: "" };
      if (a.startsWith("rev-parse --abbrev-ref @{u}")) return { code: 0, stdout: "origin/master\n" };
      if (a === "rev-parse --abbrev-ref HEAD") return { code: 0, stdout: "master\n" };
      if (a === "rev-parse --show-toplevel") return { code: 0, stdout: `${REPO_ROOT}\n` };
      if (a === "rev-parse HEAD") return { code: 0, stdout: "beefcafe1234\n" };
      // The checkout the save writes in. Clean unless a test says
      // otherwise, and a dirty one is what the pull refuses by name.
      if (a === "diff --quiet HEAD") return { code: dirty ? 1 : 0, stdout: "" };
      // Something IS staged after the write, or `saveSpecFiles` would
      // report the file unchanged and never commit.
      if (a.startsWith("diff --cached --quiet")) return { code: 1, stdout: "" };
      // Which steps this spec has HAD. `--all`, because implement's
      // commit sits on the spec's branch until archive lands it.
      if (a.startsWith("log --all")) return { code: 0, stdout: `${history.join("\n")}\n` };
      // One sha for every file, so the save's optimistic-concurrency
      // check compares the value it was handed against itself.
      if (a.startsWith("log -1 --format=%H")) return { code: 0, stdout: "c0ffee123456\t2026-08-16T09:00:00+02:00\n" };
      // The pull's own fast-forward check. Every other `merge-base`
      // question — "is this branch merged" — keeps its old answer.
      if (a === "merge-base --is-ancestor HEAD refs/remotes/origin/master") return { code: 0, stdout: "" };
      if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
      if (a.startsWith("merge -q")) return { code: 0, stdout: "" };
      return { code: 0, stdout: "" };
    };
    return { run, calls };
  }

  function serverWith(dir: string, git: { run: (d: string, a: string[]) => Promise<unknown> }) {
    const projectsRoot = join(dir, "root");
    const project = join(projectsRoot, "aide");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(join(project, ".aide", "project.yaml"), "name: aide\n");
    mkdirSync(join(project, "specs", SPEC), { recursive: true });
    writeFileSync(join(project, "specs", SPEC, "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", SPEC, "4-status.md"), statusSaying(["create", "analyze"]));
    const results = join(dir, "jobs");
    mkdirSync(results, { recursive: true });
    const { base } = harness.start({
      extra: {
        queueToken: TOKEN,
        projectRoot: projectsRoot,
        queueProjectRoot: projectsRoot,
        gitRun: git.run as never,
        queueRunnerBin: "/usr/bin/true",
        queueResultDir: results,
      },
    });
    return { base, results, statusFile: join(project, "specs", SPEC, "4-status.md") };
  }

  const RESULT = (over: Record<string, unknown> = {}) => ({
    ok: true,
    exitCode: 0,
    costUsd: 0.2,
    costMeasured: true,
    terminalReason: "completed",
    branch: BRANCH,
    branchUrls: [{ root: REPO_ROOT, url: "https://example.test/aide" }],
    repos: [],
    ...over,
  });

  async function settle(
    base: string,
    id: string,
    done: (job: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    for (let n = 0; n < 200; n++) {
      const body = (await (await fetch(`${base}/api/queue/${id}`, { headers: AUTH })).json()) as {
        job: Record<string, unknown>;
      };
      if (done(body.job)) return body.job;
      await Bun.sleep(25);
    }
    throw new Error("the job never settled");
  }

  /** One step, run to completion with the result `aide-run-spec` would
   *  have written, handed back as the queue left it. */
  async function step(
    base: string,
    results: string,
    name: string,
    settled: (j: Record<string, unknown>) => boolean = (j) => j.state === "done" && !j.landing,
  ): Promise<Record<string, unknown>> {
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ project: "aide", specFolder: SPEC, steps: [name] }),
      })
    ).json()) as { job: { id: string } };
    writeFileSync(join(results, `${made.job.id}.json`), JSON.stringify(RESULT()));
    return settle(base, made.job.id, settled);
  }

  /** The figure the file carries, or null when it carries none. The
   *  reader's own contract, spelled out again here rather than imported:
   *  a test that asked the code under test what it wrote would prove
   *  only that it agreed with itself. */
  const stampedMs = (file: string): number | null => {
    const m = readFileSync(file, "utf-8").match(/^.*\*\*Time spent \(ms\):\*\*[ \t]*(.*)$/m);
    if (!m) return null;
    const value = m[1]!.replace(/`/g, "").trim();
    return /^\d+$/.test(value) ? Number(value) : null;
  };

  /** What the phases add up to, worked out from the jobs' OWN
   *  `StepResult.at` timestamps — never from the rendered label, which
   *  is rounded to the second, and never from a hardcoded number. A
   *  job's first step counts from the job's own start; every later one
   *  from where the step before it ended. */
  const expectedMs = (jobs: Record<string, unknown>[]): number => {
    let total = 0;
    for (const job of jobs) {
      const results = (job.results ?? []) as { at: string }[];
      let boundary = Date.parse(job.startedAt as string);
      for (const r of results) {
        total += Date.parse(r.at) - boundary;
        boundary = Date.parse(r.at);
      }
    }
    return total;
  };

  // Criterion 1.
  test("a landed archive stamps 4-status.md with what the phases added up to", async () => {
    const dir = own("aide-207-stamp-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    const analyze = await step(base, results, "analyze");
    const implement = await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    const stamped = stampedMs(statusFile);
    expect(stamped).not.toBeNull();
    expect(stamped).toBe(expectedMs([analyze, implement, archive]));
    // The file is committed and pushed like any other spec edit — the
    // stamp is no use to anyone sitting in a working tree.
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "commit")).toBe(true);
    expect(git.calls.some((c) => c.dir === REPO_ROOT && c.args[0] === "push")).toBe(true);
  }, 20000);

  // Criterion 5. 133 was archived three times; a spec whose archive is
  // run again must not grow a second bullet or have its first one
  // rewritten with a figure measured over a different set of jobs.
  test("archiving a second time leaves the first figure exactly as it was", async () => {
    const dir = own("aide-207-again-");
    const git = gitFor();
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    await step(base, results, "archive");
    const first = stampedMs(statusFile);
    expect(first).not.toBeNull();

    await step(base, results, "archive");
    expect(stampedMs(statusFile)).toBe(first);
    expect(readFileSync(statusFile, "utf-8").match(/Time spent \(ms\)/g)).toHaveLength(1);
  }, 30000);

  // Criterion 6. The merge already happened. A write that cannot be
  // made is logged and left there — turning a landed archive into a
  // failed job would hand back a task nobody can act on, and the row
  // it leaves is a blank cell, which is a state the archive page
  // already draws for half its rows.
  test("a stamp that cannot be written leaves the archive landed and the job clean", async () => {
    const dir = own("aide-207-refused-");
    const git = gitFor({ dirty: true });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.state).toBe("done");
    expect(archive.error).toBeFalsy();
    expect(archive.errorReason).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);

  // Criterion 8. These jobs' own results say all three steps finished.
  // `done` does not come from them: it comes from the runner's commits,
  // through the same `withFreshness` the live list uses — which is what
  // takes `analyze` back out when the description moved on after it.
  // A spec the list would show no total for must store none either.
  test("a spec whose history is short of a phase stores nothing, whatever its jobs report", async () => {
    const dir = own("aide-207-short-");
    const git = gitFor({ history: [`Run /aide-analyze for ${SPEC} (headless)`] });
    const { base, results, statusFile } = serverWith(dir, git);

    await step(base, results, "analyze");
    await step(base, results, "implement", (j) => j.state === "done");
    const archive = await step(base, results, "archive");

    expect(archive.error).toBeFalsy();
    expect(stampedMs(statusFile)).toBeNull();
  }, 20000);
});

// Spec 154: the runner owns the record of what has run.
//
// Two incidents on 2026-08-21, in opposite directions. 147's implement
// had RED and GREEN done and every test green, and was killed by the
// step's own time limit before the model reached the part that writes
// `4-status.md` — so the row read "implement not run" about a spec
// whose code was committed on its branch. 153's four files were copied
// from a sibling whose analyze had landed, so a brand-new spec claimed
// three steps and the row offered implement first.
//
// The commits are the record now. The file's line is a claim, and a
// claim the history does not support is said out loud on the row.
describe("spec 154: what has run is what has been committed", () => {
  const specDir = (dir: string) => join(dir, "root", "aide", "specs", "81-queue-and-runner");
  /** Spec 208: every fixture here writes its `4-status.md` and makes
   *  its commits AFTER the server started, and a render reads memory
   *  now. Two things have to catch up before the row is the row this
   *  suite is about — the cache schedule has to have seen the git repo
   *  at all, and the filesystem watcher has to have cleared the disk
   *  scan the boot-time tick took — so the page is asked again until
   *  the row stops changing.
   *
   *  The Started cell is the git half's tell: `–` until git can date
   *  the folder, a real date once the repo exists. The stability of the
   *  whole row is the disk half's, since what the file claims differs
   *  per test and there is no one string to wait for. Bounded, and it
   *  falls through with the last answer so a regression reads as the
   *  assertion it broke. */
  const listPage = async (base: string): Promise<string> => {
    // Past the filesystem watcher's own 300 ms debounce (`serve.ts`,
    // `scheduleNotify`), which is what clears the disk scan the
    // boot-time warm took. Waiting for the ROW to stop changing does
    // not do it: the row is stable for those 300 ms, at the old answer.
    await new Promise((r) => setTimeout(r, 400));
    return listUntil(base, dated);
  };

  // Criterion 1: the 153 incident.
  test("a copied 4-status.md cannot make a fresh spec look analysed", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    // The folder exists, and nothing has ever run in it.
    ran(dir, []);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    // Spec 176: `create` is settled by the folder existing, so it is
    // done here and says nothing about the copy. What spec 153 is the
    // guard for is the two below it.
    expect(phaseDone(line, "create")).toBe(true);
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(phaseDone(line, "implement")).toBe(false);
    // And the phase a press would START at is analyze, not implement:
    // every un-run phase is ticked since spec 200, so the button — which
    // names the first of them — is what tells the two apart.
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).toContain(">Analyze</button>");
  });

  // Spec 176, criterion 3: a spec that appears on the dashboard has
  // been created, so "create not run yet" cannot be true. The folder
  // being on disk is a stronger source than the commit log — a spec
  // written by hand has no `Run /aide-create` commit at all — and the
  // pip has read it that way since spec 167. The phase LINE agrees now.
  test("a spec whose folder exists has had create, whatever git records", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Analyze has a commit; create never did.
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    // The create line itself, not the group: the three phases below it
    // genuinely have not run, and say so.
    const createLine = line.match(/<tr class="subrow[^"]*"[^>]*data-step="create">[\s\S]*?<\/tr>/)![0];
    expect(createLine).not.toContain("not run yet");
  });

  // And the claim carries no qualifier of its own: the status file
  // here does not name `create`, which before spec 176 would have been
  // a disagreement the moment `create` was forced into `done`.
  test("forcing create into done invents no disagreement", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["analyze"]));
    ran(dir, ["analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 3, the same fixture: the row does not swallow it.
  test("a file claiming a step the history does not have says so on the row", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze", "implement"]));
    ran(dir, ["create"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "create")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("and so does a file that has NOT caught up with a step that ran", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).toContain("the files disagree with what has run");
  });

  test("a file that agrees with the history says nothing at all", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(line).not.toContain("the files disagree with what has run");
  });

  // Criterion 2: the 147 incident. No job in the queue's memory at all
  // — the row is built from the commit alone.
  test("a step killed by the time limit reads as stopped, not as not-run", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(join(specDir(dir), "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    const implement =
      line.match(/<tr class="subrow[^"]*"[^>]*data-step="implement">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(implement).toContain("stopped: timeout");
    expect(implement).not.toContain("not run yet");
    // Stopped is not done: implement is still what the row offers.
    expect(phaseDone(line, "implement")).toBe(false);
    expect(line).toMatch(/value="implement" checked/);
  });

  // Criterion 4.
  test("a completed re-run supersedes the stop before it", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"]);
    ran(dir, ["implement"], "81-queue-and-runner", { stopped: "timeout" });
    ran(dir, ["implement"]);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).not.toContain("stopped: timeout");
    expect(line).toMatch(/value="archive" checked/);
  });

  // Criterion 5: a step run at somebody's keyboard, committed by hand
  // with the subject the four skills now offer.
  test("an interactive commit with no headless marker counts the same", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });
});

// Spec 97: a description edited after the analyze ran leaves the plan
// describing an older problem, and the row said nothing. The signal is
// asked of git at render time and never stored, so a re-run clears it
// without anything having to remember it was ever set.
describe("a description newer than the analysis is shown on the row", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const DESCRIPTION_EDITED = "2026-08-18T09:10:36+02:00";
  const SUBJECT = "Run /aide-analyze for 81-queue-and-runner (headless)";

  /** The specs repo answering for one spec: which steps it has had
   *  (spec 154), when its description was last committed, and what its
   *  analyze history looks like. */
  const gitSaying = (descriptionAt: string, analyzeLog: string, differs = true) =>
    gitFake({
      // The workflow history, first because its argv is the more
      // specific one — the table's first matching prefix wins.
      "log --all --format=%s": {
        code: 0,
        stdout: ["create", "analyze", "implement"]
          .map((step) => `Run /aide-${step} for 81-queue-and-runner (headless)`)
          .join("\n"),
      },
      "log -1 --format=%H": { code: 0, stdout: `deadbee\t${descriptionAt}\n` },
      "log --format=%H%x09%aI%x09%s": { code: 0, stdout: analyzeLog },
      // `git diff --quiet`: 1 means the description says something the
      // analysis never read, 0 means the commit changed nothing.
      "diff --quiet": { code: differs ? 1 : 0 },
    });

  /** A spec whose files agree with the history `gitSaying` reports:
   *  analyze done, and implement too. */
  const analysedSpec = (dir: string): void => {
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(
      join(spec, "4-status.md"),
      statusSaying(
        ["create", "analyze", "implement"],
        "- **Total progress:** `100% (4 of 4 completed)`\n",
      ),
    );
  };

  /** A phase's own line — an ordinary row of six cells since spec 157,
   *  with nothing spanning it. */
  const subRow = (html: string, phase: string): string =>
    html.match(new RegExp(`<tr class="subrow[^"]*"[^>]*data-step="${phase}">.*?</tr>`))?.[0] ?? "";

  /** The badge sits on the analyze phase line and the marks on the step
   *  boxes, and a collapsed row draws neither — so every fetch here
   *  asks for the spec open. */
  const listPage = (base: string) => fetch(`${base}/?${OPEN_81}`, auth).then((r) => r.text());

  test("the analyze line says the description changed since (criterion 1)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(subRow(html, "analyze")).toContain("description changed since");
    expect(subRow(html, "implement")).not.toContain("description changed since");
  });

  test("analyze stops counting as done (criteria 2, 3)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    // implement is untouched by this check: its own done-mark comes
    // from 4-status.md, and nothing here blocks running it.
    expect(phaseDone(line, "implement")).toBe(true);
    expect(line).toMatch(/value="analyze" checked/);
    expect(line).not.toMatch(/value="implement" checked/);
  });

  // Spec 139, criterion 10: the freshness check is a DISPLAY override,
  // derived at render time. It clears the two marks the stale
  // description casts doubt on; it never rewrites the record they came
  // from, so a re-analysis that proves the edit cosmetic restores the
  // marks with nothing having had to remember them.
  test("the stale row leaves the recorded list on disk untouched (spec 139, criterion 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(DESCRIPTION_EDITED, `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const statusPath = join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md");
    const before = readFileSync(statusPath, "utf-8");
    const line = specControls(await listPage(base), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(readFileSync(statusPath, "utf-8")).toBe(before);
    expect(before).toContain("- **Workflow steps completed:** create, analyze, implement");
  });

  test("a re-analyzed spec is current again (criterion 5)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying(
        DESCRIPTION_EDITED,
        [
          `2026-08-18T11:00:00+02:00\t${SUBJECT}`,
          `2026-08-18T08:57:16+02:00\t${SUBJECT}`,
        ].join("\n"),
      ).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a description older than the analysis changes nothing (criterion 4)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitSaying("2026-08-18T08:00:00+02:00", `deadbee\t2026-08-18T08:57:16+02:00\t${SUBJECT}\n`).run,
    });
    analysedSpec(dir);
    const html = await listPage(base);
    expect(html).not.toContain("description changed since");
    expect(phaseDone(specControls(html, "81-queue-and-runner"), "analyze")).toBe(true);
  });

  // A git that cannot answer must not put a badge on the page that
  // nothing can ever clear.
  //
  // What it DOES do since spec 154 is leave the phase unmarked: the
  // history is the record, and a history nothing can read proves
  // nothing has run. That direction is deliberate — a spec reading as
  // still having analyze ahead of it is visible, and running the step
  // fixes it, where a mark nothing earned is neither. The file's own
  // claim is still on the row, as the disagreement it now is.
  test("git with no answer marks nothing, and still puts no stale badge up (criteria 8, 10)", async () => {
    const { base, dir } = start({
      queueToken: TOKEN,
      gitRun: gitFake({}).run,
    });
    analysedSpec(dir);
    // Spec 208: the file's own claim reaches the row off the disk scan,
    // and that scan was taken at boot — before `analysedSpec` wrote.
    // The watcher clears it and the row catches up a tick later.
    const html = await listUntil(base, (h) =>
      specControls(h, "81-queue-and-runner").includes("the files disagree with what has run"),
    );
    expect(html).not.toContain("description changed since");
    const line = specControls(html, "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(false);
    expect(line).toContain("the files disagree with what has run");
  });
});
