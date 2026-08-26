import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  renderQueuePage,
  type QueuePageOptions,
  type QueueRowView,
  type QueueTarget,
} from "../../src/render.ts";
import { ran, statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  specHead,
  specPanel,
  specControls,
  phaseDone,
  OPEN_81,
  listUntil,
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


describe("GET / (the spec list, HTML)", () => {
  test("layout, forms, labels, and the runner notice", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html).toContain("<nav");
    expect(html).toContain("81-queue-and-runner");
    expect(html).toContain('<form id="rowrun-aide/81-queue-and-runner" method="post"');
    expect(html).toContain('<a class="brand" href="/">');
    // Every control says what it is: an unlabelled checkbox next to some
    // buttons tells the reader nothing. The steps, the row's one button
    // and what is left of the fields nobody sets every time are all on
    // the one line an open row grows (spec 117) — nothing waits behind
    // a second click. 81a ships no runner, so the job posted above is
    // sitting in "queued": the row's one control is the way to stop it,
    // named for the step it would stop (spec 157).
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toContain(">Cancel</button>");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`name="steps" value="${step}"`);
      expect(line).toContain(`aria-label="${step}"`);
    }
    expect(html).not.toContain(">more</summary>");
    // 81a ships no runner: the page must say so rather than leave a
    // job sitting in "queued" with no explanation.
    expect(html.toLowerCase()).toContain("no runner");
  });

  test("the blunt meta refresh is a no-JS fallback, not the mechanism", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    // A page with a form must not reload underneath someone filling it
    // in; the script swaps the table body instead.
    expect(html).toContain("<noscript><meta http-equiv=\"refresh\"");
    expect(html).toContain("<script");
    expect(html).toContain('id="jobrows"');
  });

  // Spec 107 narrowed this, deliberately and by exactly one script. A
  // theme the reader chose has to be applied before the page paints,
  // and a generated page is a FILE — there is no server in front of it
  // to have decided. So every page now carries the theme switcher, and
  // this test says which script that is rather than allowing scripts
  // in general: anything else appearing here is still the drift the
  // test was written to stop.
  //
  // Spec 115 widened it by exactly one more, on exactly one page: the
  // overview is a redirect now, and sending a reader on is what that
  // page is FOR. Named here rather than allowed in general — the rule
  // for every other page is unchanged, and this one's second script is
  // asserted to be the redirect and nothing else.
  test("the generated pages carry no page code beyond the shared theme switcher", async () => {
    const { renderSite, OVERVIEW_PAGE } = await import("../../src/render.ts");
    for (const page of renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "x")) {
      const scripts = [...page.html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
      const allowed = page.path === OVERVIEW_PAGE ? 2 : 1;
      expect([page.path, scripts.length]).toEqual([page.path, allowed]);
      expect(scripts[0]).toContain("data-theme-choice");
      if (allowed === 2) expect(scripts[1]).toBe("location.replace('/projects' + location.search);");
      expect(page.html.match(/<script/g)).toHaveLength(allowed);
    }
  });

  test("?rows=1 returns the table body alone, for the script to swap in", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (
      await fetch(`${base}/?rows=1&${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(rows).toContain("<tr");
    expect(rows).toContain("81-queue-and-runner");
    expect(rows).not.toContain("<html");
    // The row's own control belongs to a ROW, so unlike the retired top
    // form it must survive the swap: without it, every five seconds the
    // page would lose the only way to act on a spec (criterion 8). The
    // job posted above is queued with no runner to take it, so that
    // control is Cancel.
    const line = specControls(rows, "81-queue-and-runner");
    expect(line).toContain('method="post" action="/api/queue"');
    expect(line).toContain('<input type="checkbox" name="steps" value="analyze"');
    expect(line).toContain(">Cancel</button>");
  });

  // A generated page is a FILE, and the list it points at is served.
  // Both ways there are absolute: the wordmark and, since spec 119, the
  // Specs tab — which is never the current one on a generated page.
  test("generated pages reach the list through the wordmark and the Specs tab", async () => {
    const { renderSite } = await import("../../src/render.ts");
    const pages = renderSite([{ name: "p", manifest: { ok: true, data: { name: "p" } }, specs: [] }], "2026-08-16");
    for (const p of pages) {
      expect(p.html).toContain('<a class="brand" href="/">');
      expect(p.html).toContain('<a class="tab" data-nav data-goto href="/">Specs</a>');
    }
  });
});

describe("renderQueuePage state labels", () => {
  // Every job gets its own spec: the list holds one line per SPEC, so
  // nine jobs sharing a folder would be nine attempts at one phase, of
  // which only the latest shows — and this test is about how each state
  // is put into WORDS, not about which of them the list picks.
  let seq = 0;
  const row = (state: string, extra: Partial<QueueRowView> = {}): QueueRowView => {
    const n = ++seq;
    return {
      id: `id-${state}-${n}`,
      project: "aide",
      specFolder: `81-queue-and-runner-${n}`,
      steps: ["analyze"],
      stepIndex: 0,
      state: state as QueueRowView["state"],
      spentUsd: 0,
      timeoutSec: 1200,
      createdAt: "2026-08-16T00:00:00Z",
      ...extra,
    };
  };

  test("stopped is never rendered as failed", () => {
    const html = renderQueuePage(
      [
        row("stopped", { stopReason: "budget" }),
        row("stopped", { stopReason: "timeout" }),
        row("failed", { error: "boom" }),
        row("queued"),
        row("running"),
        row("done"),
        row("cancelled"),
        row("interrupted"),
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: false, targets: [] },
    );
    expect(html).toContain("stopped — budget");
    expect(html).toContain("stopped — 20 min");
    expect(html).toContain("failed");
    expect(html).not.toContain("stopped — failed");
  });
});

describe("every row answers for itself", () => {
  // The title and the phase left the row on 2026-08-21 — the folder name
  // says the one and the pips say the other — and the percentage left it
  // in spec 167. The point of the test is unchanged: the row answers for
  // itself, server-rendered, with no selection and no data block for a
  // script to read. This is the one test that follows the percentage all
  // the way from a real 4-status.md on disk to the served HTML, so it is
  // the one that can still go red if the figure ever creeps back.
  test("a spec's progress stays off its own row (criterion 9)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // A status file that DOES carry a percentage: the row must ignore it.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(
        ["create", "analyze"],
        "- **Total progress:** `64% (14 of 22 completed)`\n\n## Phase 2: GREEN\n\n| t | ⬜ |\n",
      ),
    );
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    // Server-rendered on the row itself: there is no selection left to
    // answer, and no data block for a script to answer it from.
    const line = specHead(html, "81-queue-and-runner");
    // The figure counted the checkbox rows implement ticks, so it was 0
    // with analyze done and 90-something the moment implement ended. The pips say how far the spec has got and the
    // State column says what is happening now.
    expect(line).not.toContain("% done");
    expect(line).not.toContain("64%");
    expect(line).not.toContain("Phase 2: GREEN");
    // What the row DOES still read off this same file: the steps behind
    // it, as green pips. The percentage is gone; the file is still read.
    expect(line).toContain('class="pips"');
    expect(html).not.toContain('id="targetdata"');
    expect(html).not.toContain('<select name="target"');
  });

  // Spec 93 put this reason in ONE place, above the table, and said so:
  // "it belongs to the PAGE, not to one control". That held while the
  // page had one form; it lists up to 25 rows, and a reason attached to
  // none of them does not say which button was pressed. Spec 99 moved
  // it onto the row that posted it — the same reason, read off the same
  // query string, one row further down.
  test("a refusal is shown once, on the row that posted it (criterion 6)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const post = () =>
      fetch(`${base}/api/queue`, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-aide-token": TOKEN },
        body: new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner", steps: "analyze" }),
      });
    await post();
    const refused = await post();
    expect(refused.status).toBe(303);
    const location = refused.headers.get("location") ?? "";
    expect(location.startsWith("/?error=")).toBe(true);
    const html = await (await fetch(`${base}${location}`, { headers: { "x-aide-token": TOKEN } })).text();
    // In the row's own panel since spec 151, not in the name cell.
    expect(specPanel(html, "81-queue-and-runner")).toContain("already queued");
    expect(specHead(html, "81-queue-and-runner")).not.toContain("already queued");
    // Once, not twice: the banner is the fallback for a refusal that
    // belongs to no row.
    expect(html).not.toContain('<p class="refusal">');
  });

  test("state is a chip with its own class, so a failure is not a wall of grey", async () => {
    const { base } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    await fetch(`${base}/api/queue`, { method: "POST", headers, body: JSON.stringify(JOB) });
    const rows = await (await fetch(`${base}/?rows=1`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(rows).toContain('class="badge b-idle"');
    expect(rows).toContain("queued");
  });
});

describe("page code placement", () => {
  /** Where the <script> whose code contains `needle` starts. The served
   *  page has carried two inline scripts since spec 107 — the theme
   *  switcher in <head> and the list's own code at the end of <body> —
   *  so "the first one" stopped naming either of them. */
  const scriptAt = (html: string, needle: string): number => {
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      if (m[1]!.includes(needle)) return m.index!;
    }
    return -1;
  };

  test("the script comes AFTER the elements it wires up", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const rows = html.indexOf('id="jobrows"');
    const script = scriptAt(html, "jobrows");
    expect(rows).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    // An inline script in <head> runs before the DOM exists, so every
    // listener attaches to nothing — and the failure is silent.
    expect(script).toBeGreaterThan(rows);
    expect(html.indexOf("</head>")).toBeLessThan(script);
  });

  // Spec 107. The other placement, and the opposite reason for it: the
  // theme has to be on the html element before the first paint, so this
  // script deliberately goes where the one above must not.
  test("the theme switcher comes BEFORE anything it could be seen to change", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const theme = scriptAt(html, "data-theme-choice");
    expect(theme).toBeGreaterThan(-1);
    expect(theme).toBeLessThan(html.indexOf("</head>"));
    expect(theme).toBeLessThan(html.indexOf("<body>"));
    expect(theme).toBeLessThan(html.indexOf('id="jobrows"'));
  });

  test("the two scripts are two, and each is found by what it says", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(html.match(/<script/g)).toHaveLength(2);
    expect(scriptAt(html, "jobrows")).not.toBe(scriptAt(html, "data-theme-choice"));
  });
});

describe("the step boxes on a row follow that spec", () => {
  test("a step the spec has already had is marked done and left unticked (criterion 1)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const line = specControls(html, "81-queue-and-runner");
    // analyze is done; implement is what you came for.
    expect(line).toMatch(/data-phase="analyze"[^]*?value="analyze"(?![^>]*checked)/);
    expect(line).toMatch(/data-phase="implement"[^]*?value="implement"[^>]*checked/);
    expect(phaseDone(line, "analyze")).toBe(true);
  });

  test("a spec nothing has run yet offers analyze (criterion 1a)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "2-analysis.md"),
      "# Analysis\n\n[filled in by /aide-analyze]\n",
    );
    // Created and nothing else: the record, not the file's size, is
    // what says so (spec 139).
    const html = await (await fetch(`${base}/?${OPEN_81}`, { headers: { "x-aide-token": TOKEN } })).text();
    const line = specControls(html, "81-queue-and-runner");
    expect(line).toMatch(/value="analyze" checked/);
    expect(phaseDone(line, "analyze")).toBe(false);
  });

  test("with the analysis already on disk, implement is pre-ticked (criterion 1b)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    // Analysed by hand and committed with the subject the runner uses
    // (spec 154), so the row must not tick and mark the same box at
    // once.
    writeFileSync(
      join(dir, "root", "aide", "specs", "81-queue-and-runner", "4-status.md"),
      statusSaying(["create", "analyze"]),
    );
    ran(dir, ["create", "analyze"], "81-queue-and-runner", { headless: false });
    const line = specControls(await listUntil(base, rowSaysDone("analyze")), "81-queue-and-runner");
    expect(phaseDone(line, "analyze")).toBe(true);
    expect(line).not.toMatch(/value="analyze" checked/);
    expect(line).toMatch(/value="implement" checked/);
  });
});

// One list, with the sorting and filtering that makes a fixed "Active"
// section unnecessary: asking for the running jobs is a filter, not a
// second table.
describe("the job list sorts and filters", () => {
  const row = (id: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: `${id}-spec`,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  /** A spec on disk, as the server hands it to the page. `createdAt` is
   *  what git answered for the folder's first commit (spec 199). */
  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });

  /** The specs down the page, in the order they are drawn — off the
   *  header rows alone: `data-folder` is written more than once per
   *  spec, and a bare match counts a row twice. */
  const specOrder = (html: string): (string | undefined)[] =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  /** One spec's own Started cell, off its header row. */
  const startedCell = (html: string, folder: string): string =>
    html
      .match(new RegExp(`<tr class="spechead[^"]*"[^>]*data-folder="${folder}">.*?</tr>`))?.[0]
      .match(/<td data-col="started">.*?<\/td>/)?.[0] ?? "";

  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    // Spec 199: "Started" is the spec's own creation date, and a
    // creation date comes off the TARGET (git), never off a job — so a
    // test about that column has to be able to give one.
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter,
    });

  test("one table holds every job — no fixed section above it", () => {
    const html = page([row("a", { state: "running" }), row("b")]);
    expect(html.match(/<table class="list speclist"/g)).toHaveLength(1);
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  test("the state filter is offered with a count on each choice", () => {
    const html = page([row("a", { state: "running" }), row("b"), row("c", { state: "failed" })]);
    expect(html).toMatch(/>All \(3\)</);
    expect(html).toMatch(/>Running \(1\)</);
    expect(html).toMatch(/>Done \(1\)</);
    expect(html).toMatch(/>Problems \(1\)</);
  });

  test("asking for active work leaves the finished jobs out", () => {
    const rows = [row("a", { state: "running" }), row("b"), row("c", { state: "queued" })];
    const html = page(rows, { state: "active" });
    expect(html).toContain("a-spec");
    expect(html).toContain("c-spec");
    expect(html).not.toContain("b-spec");
  });

  test("a stopped job is a problem, not a success", () => {
    const html = page([row("a", { state: "stopped" }), row("b")], { state: "problem" });
    expect(html).toContain("a-spec");
    expect(html).not.toContain("b-spec");
  });

  // A chip per project stood above the list until 2026-08-23: one
  // control that grew with the machine, and nobody had asked to filter
  // by project. Every spec is listed now, whatever project it is from.
  test("no project filter is drawn, however many projects there are", () => {
    const rows = [row("a"), row("b", { project: "aide-dashboard" })];
    const html = page(rows);
    expect(html).not.toContain('data-filter="project"');
    expect(html).toContain("a-spec");
    expect(html).toContain("b-spec");
  });

  // The default view is the newest SPEC at the top — by number, not by
  // last activity (chosen 2026-08-19: activity order put a spec that
  // had just been created at the bottom, under everything that had
  // ever run). Started is still one click away.
  test("newest spec first is the default order", () => {
    const html = page([
      row("104", { startedAt: "2026-08-16T11:00:00Z" }),
      row("109", { startedAt: "2026-08-16T09:00:00Z" }),
    ]);
    expect(html.indexOf("109-spec")).toBeLessThan(html.indexOf("104-spec"));
    // The Spec heading spans two columns since spec 165 — the phase
    // name's and the row's AI — which is why the attribute is not
    // pinned to sitting straight after the class.
    expect(html).toMatch(
      /<th class="[^"]*" colspan="2" aria-sort="descending"><a class="sortlink on"[^>]*>Spec<svg/,
    );
  });

  // Spec 199: it used to put the most recent ACTIVITY first, so a spec
  // made months ago and re-run an hour ago outranked one made this
  // morning. The column and the sort hold when the spec was MADE now,
  // and a run does not move it.
  test("sorting by started puts the most recently CREATED spec first", () => {
    const html = page(
      // The older spec has the NEWER run, which is what used to decide
      // this order and no longer does.
      [row("old", { startedAt: "2026-08-16T11:00:00Z" }), row("new", { startedAt: "2026-08-16T09:00:00Z" })],
      { sort: "started" },
      [
        target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
        target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["new-spec", "old-spec"]);
  });

  // The literal requirement: a phase being started, finished or run
  // again must not move the row. The older spec has the newer run.
  test("a run on an older spec does not move it up the started sort (criterion 1)", () => {
    const targets = [
      target("old-spec", { createdAt: "2026-08-10T09:00:00Z" }),
      target("new-spec", { createdAt: "2026-08-14T09:00:00Z" }),
    ];
    const before = page([row("old"), row("new")], { sort: "started" }, targets);
    const after = page(
      [
        row("old", { state: "running", startedAt: "2026-08-16T11:00:00Z" }),
        row("new", { startedAt: "2026-08-11T09:00:00Z" }),
      ],
      { sort: "started" },
      targets,
    );
    expect(specOrder(after)).toEqual(specOrder(before));
    expect(specOrder(after)).toEqual(["new-spec", "old-spec"]);
  });

  // The 200-job cap is what makes git the only possible source: a spec
  // older than two hundred jobs has no `Job` record left to read a date
  // off. `createdAt` comes off the target and touches no job at all, so
  // a target with NO rows is, for this code, exactly a spec whose job
  // was evicted (criterion 2).
  test("a spec with no job rows at all still shows its Started date (criterion 2)", () => {
    const html = page([], { sort: "started" }, [
      target("77-evicted", { createdAt: "2026-03-01T09:00:00Z" }),
    ]);
    expect(html).toContain("77-evicted");
    expect(html).toContain('title="2026-03-01T09:00:00Z"');
    expect(startedCell(html, "77-evicted")).not.toContain("–");
  });

  // Neither spec can be dated and neither has ever run: the same
  // folder-name-descending fallback the old `activityAt === 0`
  // tie-break gave, and no throw (criterion 8). It passes before the
  // change as well as after — deliberately: the criterion is that this
  // order is PRESERVED while the field the tie-break reads is replaced.
  test("two specs git cannot date fall back to folder order (criterion 8)", () => {
    const html = page([], { sort: "started" }, [target("88-undatable"), target("89-undatable")]);
    expect(specOrder(html)).toEqual(["89-undatable", "88-undatable"]);
  });

  test("sorting by cost puts the expensive job on top", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
    });
    expect(html.indexOf("dear-spec")).toBeLessThan(html.indexOf("cheap-spec"));
  });

  test("the same column clicked again turns the order round", () => {
    const html = page([row("cheap", { spentUsd: 0.5 }), row("dear", { spentUsd: 12 })], {
      sort: "cost",
      dir: "asc",
    });
    expect(html.indexOf("cheap-spec")).toBeLessThan(html.indexOf("dear-spec"));
  });

  test("sorting by spec ascending is alphabetical", () => {
    const html = page([row("zz"), row("aa")], { sort: "spec", dir: "asc" });
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("zz-spec"));
  });

  // Spec folders lead with a number, and the first three-digit one
  // (100, on 2026-08-18) sorted BEFORE 81 as text. The number is what a
  // person reads the column by, so it is what the column sorts by.
  test("sorting by spec orders by the leading number, not by text", () => {
    const html = page([row("103"), row("81"), row("9"), row("104")], { sort: "spec", dir: "asc" });
    const at = (n: string) => html.indexOf(`${n}-spec"`);
    expect(at("9")).toBeLessThan(at("81"));
    expect(at("81")).toBeLessThan(at("103"));
    expect(at("103")).toBeLessThan(at("104"));
  });

  test("a column header is a link that keeps the filter you are already in", () => {
    const html = page([row("a", { state: "running" })], { state: "active" });
    expect(html).toContain('href="/?state=active&amp;sort=cost"');
  });

  test("the sorted column says which way it is going", () => {
    const html = page([row("a")], { sort: "cost" });
    expect(html).toMatch(/aria-sort="descending"/);
  });

  // The direction was a text glyph (▴/▾) glued to the label: faint, and
  // no larger than the letters. It is an SVG chevron now, turned by a
  // class, and the header link is a control with a hover flat.
  test("the sort direction is a chevron, not a glyph", () => {
    const desc = page([row("a")], { sort: "cost" });
    expect(desc).toMatch(
      /<th class="[^"]*" data-col="cost" aria-sort="descending"><a class="sortlink on"[^>]*><span class="u-usd">Cost<\/span>/,
    );
    expect(desc).not.toContain("▾");
    const asc = page([row("a")], { sort: "cost", dir: "asc" });
    expect(asc).toMatch(/<a class="sortlink on asc"[^>]*><span class="u-usd">Cost<\/span>/);
    expect(asc).not.toContain("▴");
    // An unsorted column carries the chevron too (faint in CSS), pointing
    // the way its first click will sort: Started defaults to descending.
    expect(desc).toMatch(/<a class="sortlink"[^>]*>Started<svg/);
    // …and State to ascending, so its chevron is already turned.
    expect(desc).toMatch(/<a class="sortlink asc"[^>]*>State<svg/);
  });

  test("a filter that matches nothing says so instead of showing a bare table", () => {
    const html = page([row("a")], { state: "active" });
    // "spec", not "job": the table has been one line per spec since
    // spec 86, and since spec 90 it lists specs that have no job at all.
    expect(html).toContain("No spec matches");
  });

  test("the list shows everything, with no cap (spec 226)", () => {
    const html = page(Array.from({ length: 29 }, (_, i) => row(`j${i}`)), { sort: "started" });
    expect(html).toContain("j0-spec");
    expect(html).toContain("j24-spec");
    expect(html).toContain("j28-spec");
  });

  test("the partial refresh carries the controls too, so the filter survives a tick", async () => {
    const { base } = start({ queueToken: TOKEN });
    await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-aide-token": TOKEN, accept: "application/json" },
      body: JSON.stringify(JOB),
    });
    const rows = await (
      await fetch(`${base}/?rows=1&state=active`, { headers: { "x-aide-token": TOKEN } })
    ).text();
    expect(rows).toContain('data-filter="state"');
    expect(rows).toMatch(/aria-current="true"[^>]*>Running/);
  });
});

// Spec 86: the list is one line per SPEC, so filtering and sorting are
// questions about specs — "which spec has something running?" — not
// about the individual jobs a spec happens to have been split into.
describe("filtering and sorting work on specs, not jobs", () => {
  const job = (id: string, spec: string, extra: Partial<QueueRowView> = {}): QueueRowView => ({
    id,
    project: "aide",
    specFolder: spec,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    spentUsd: 0,
    timeoutSec: 1200,
    createdAt: "2026-08-16T00:00:00Z",
    ...extra,
  });

  // `open` names the specs whose phase lines are drawn: this block
  // asserts that a filtered spec keeps every job it has had, and those
  // are read off the lines an open row draws.
  const page = (
    rows: QueueRowView[],
    filter?: QueuePageOptions["filter"],
    targets: QueueTarget[] = [],
  ) =>
    renderQueuePage(rows, "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets,
      filter: { open: "aide/aa-spec", ...filter },
    });

  const target = (specFolder: string, extra: Partial<QueueTarget> = {}): QueueTarget => ({
    project: "aide",
    specFolder,
    ...extra,
  });


  test("a spec with one job in flight is active, one with only finished jobs is not (criterion 8)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
        job("a2", "aa-spec", {
          state: "running",
          steps: ["implement"],
          startedAt: "2026-08-16T11:00:00Z",
        }),
        job("b1", "bb-spec", { state: "done" }),
      ],
      { state: "active" },
    );
    expect(html).toContain("aa-spec");
    expect(html).not.toContain("bb-spec");
    // Its finished job comes along with it — the spec is one line, and
    // that line carries every phase it has had, filter or no filter.
    // Since spec 237 a phase line names no job: it opens the tab that
    // shows what the phase MADE, on this spec's own page. The finished
    // analyze and the running implement are therefore read off their
    // two tabs, not off two job pages.
    expect(html.match(/<tr class="spechead/g)).toHaveLength(1);
    expect(html).toContain('href="/specs/aide/aa-spec?tab=solution"');
    expect(html).toContain('href="/specs/aide/aa-spec?tab=status"');
    expect(html).not.toContain('href="/specs/a1"');
    expect(html).not.toContain('href="/specs/a2"');
  });

  test("the filter tabs count specs, not jobs (criterion 9)", () => {
    const html = page([
      job("a1", "aa-spec", { state: "done", startedAt: "2026-08-16T09:00:00Z" }),
      job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      job("b1", "bb-spec", { state: "running" }),
    ]);
    expect(html).toMatch(/>All \(2\)</);
    expect(html).toMatch(/>Running \(1\)</);
    expect(html).toMatch(/>Done \(1\)</);
  });

  test("sorting by cost uses the spec's total, not one job's (criterion 10)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { spentUsd: 2.5 }),
        job("a2", "aa-spec", { spentUsd: 2.5 }),
        // Dearer than either aa job on its own, cheaper than the two together.
        job("b1", "bb-spec", { spentUsd: 4 }),
      ],
      { sort: "cost" },
    );
    expect(html.indexOf("aa-spec")).toBeLessThan(html.indexOf("bb-spec"));
    expect(html).toContain("$5.00");
  });

  // Spec 226 inverted this. It used to pin a 25-row cap and the "N
  // older specs not shown" line that counted what the cap had dropped.
  // Hiding rows is wrong in every view: the reader cannot find what is
  // not on the page, and the browser's own find is the search the
  // archived and combined views are read with. The cap was a
  // performance guess, and the answer to a payload that turns out to
  // matter is server-side — render only what changed, or cache the
  // fragment — never a cap again.
  test("every spec a filter matches is on the page (criterion 1)", () => {
    const rows = Array.from({ length: 26 }, (_, i) => [
      job(`x${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:00:00Z`,
      }),
      job(`y${i}`, `s${String(i).padStart(2, "0")}-spec`, {
        startedAt: `2026-08-16T${String(i % 24).padStart(2, "0")}:30:00Z`,
      }),
    ]).flat();
    const html = page(rows, { sort: "spec", dir: "asc" });
    expect(html).toContain("s00-spec");
    expect(html).toContain("s24-spec");
    // The 26th, the one the cap used to cut.
    expect(html).toContain("s25-spec");
    // The note the cap wrote, by its shape rather than by a word: this
    // is the WHOLE page, and "older" is inside "folder" and inside a
    // comment in the inlined stylesheet.
    expect(html).not.toMatch(/\d+ older specs? not shown/);
    expect(html).not.toContain("not shown.");
  });

  // Spec 261 moved the "?" and New spec off the chips' own row and onto
  // the search field's row beside it — readers look for them next to
  // the field they are about to use, not above it. This replaces the
  // spec-226 guard for the OLD placement: the chips' `<div class="row">`
  // now holds only the chips, and both controls live inside
  // `<form class="specsearch">`, help before New spec.
  test('the "?" and New spec sit on the search field\'s own row (spec 261)', () => {
    const html = renderQueuePage(
      [job("a1", "aa-spec")],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      { runnerAvailable: true, targets: [], createProjects: ["aide"] },
    );
    const formStart = html.indexOf('<form class="specsearch"');
    expect(formStart).toBeGreaterThan(-1);
    const formEnd = html.indexOf("</form>", formStart);
    expect(formEnd).toBeGreaterThan(-1);
    const form = html.slice(formStart, formEnd);
    // The chips' own row, read by its two ends rather than by a regex:
    // `<div class="row">` occurs elsewhere on the page, and a pattern
    // that backtracked past one of those would be reading a region
    // nobody meant.
    const opens = html.lastIndexOf('<div class="row">', formStart);
    expect(opens).toBeGreaterThan(-1);
    const chipsRow = html.slice(opens, formStart);
    expect(chipsRow).toContain('data-filter="state"');
    expect(chipsRow).not.toContain('<details class="intro">');
    expect(chipsRow).not.toContain(">New spec</a>");
    // Both controls now live inside the search form's own row, help
    // before New spec.
    expect(form).toContain('<details class="intro">');
    expect(form).toContain(">New spec</a>");
    expect(form.indexOf('<details class="intro">')).toBeLessThan(form.indexOf(">New spec</a>"));
    // And the whole row is still ahead of the list it labels.
    expect(html.indexOf('<form class="specsearch"')).toBeLessThan(
      html.indexOf('<div class="tablewrap">'),
    );
  });

  // Every spec is ONE line, so its place in the order is the group's —
  // it can no longer have one job near the top and another near the
  // bottom of the same list.
  const specOrder = (html: string) =>
    [...html.matchAll(/<tr class="[^"]*spechead[^"]*"[^>]*data-folder="([^"]+)"/g)].map((m) => m[1]);

  // Spec 199: the group's place is its spec's CREATION date. `aa-spec`
  // has the newest run of the three jobs here and is still second,
  // because it was made first.
  test("sorting by started uses the spec's creation date, not its jobs (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "started" },
      [
        target("aa-spec", { createdAt: "2026-08-01T09:00:00Z" }),
        target("bb-spec", { createdAt: "2026-08-05T09:00:00Z" }),
      ],
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });

  test("sorting by state uses the spec's representative state (criterion 13)", () => {
    const html = page(
      [
        job("a1", "aa-spec", { state: "running", startedAt: "2026-08-16T08:00:00Z" }),
        job("a2", "aa-spec", { state: "done", startedAt: "2026-08-16T12:00:00Z" }),
        job("b1", "bb-spec", { state: "done", startedAt: "2026-08-16T10:00:00Z" }),
      ],
      { sort: "state" },
    );
    expect(specOrder(html)).toEqual(["bb-spec", "aa-spec"]);
  });
});
// --- spec 95: the preview link is read from the project's own manifest -------

// The pure render functions are tested next to the markup they produce.
// What only the server can answer is which repo a preview belongs to:
// the manifest lives in the project's checkout, and the specs repo
// beside it carries a plan with nothing to try.
describe("GET /queue and /specs/<id>: the preview link (criteria 1-4)", () => {
  const AUTH = { "x-aide-token": TOKEN };
  const TEMPLATE = "https://{branch}.example.pages.dev";
  const EXPECTED = "https://aide-81-queue-and-runner.example.pages.dev";

  /** A project root holding the project's own checkout and a specs repo
   *  beside it — the shape an `aide` spec actually pushes to. Only the
   *  project's checkout gets a manifest; the specs repo has none, which
   *  is what makes it a plan repo rather than deployable code. */
  function roots(preview?: string): { root: string; repo: string; specsRepo: string } {
    const root = mkdtempSync(join(tmpdir(), "aide-preview-"));
    ownDirs.push(root);
    const repo = join(root, "aide");
    mkdirSync(join(repo, ".aide"), { recursive: true });
    writeFileSync(
      join(repo, ".aide", "project.yaml"),
      `name: aide\ndeployment:\n  host: somewhere\n` + (preview ? `  preview: "${preview}"\n` : ""),
    );
    const specsRepo = join(root, "aide-specs");
    mkdirSync(specsRepo, { recursive: true });
    return { root, repo, specsRepo };
  }

  const gitQuiet = async (_dir: string, args: string[]) => {
    const a = args.join(" ");
    if (a.startsWith("symbolic-ref")) return { code: 0, stdout: "refs/remotes/origin/master\n" };
    if (a.startsWith("merge-base")) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  };

  async function seed(branchUrls: { root: string; url: string }[]): Promise<{ mirror: string; id: string }> {
    const { base, dir } = start({ queueToken: TOKEN });
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...AUTH },
        body: JSON.stringify(JOB),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "done";
    job.branchUrls = branchUrls;
    writeFileSync(mirror, JSON.stringify(jobs));
    return { mirror, id: made.job.id };
  }

  const startWith = (root: string, mirror: string) =>
    start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjectRoot: root, gitRun: gitQuiet }).base;

  test("the row carries the manifest's preview link for the project's own repo (criterion 1)", async () => {
    const { root, repo, specsRepo } = roots(TEMPLATE);
    const { mirror, id } = await seed([
      { root: repo, url: "https://example.test/aide" },
      { root: specsRepo, url: "https://example.test/aide-specs" },
    ]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).toContain(`href="${EXPECTED}"`);
    // One link, not two: the specs repo pushed a branch of the same
    // name, and there is nothing to try in a plan (criterion 4).
    expect(html.match(/>preview<\/a>/g)).toHaveLength(1);
    expect(id).toBeTruthy();
  });

  // Spec 150: the Work row left the job page, and the preview link went
  // with it — both are on the row this page is opened from, and the
  // Overview is now what is said nowhere else.
  test("the job page carries neither link — the row has both (spec 150)", async () => {
    const { root, repo } = roots(TEMPLATE);
    const { mirror, id } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/specs/${id}`, { headers: AUTH })).text();
    expect(html).not.toContain(`href="${EXPECTED}"`);
    expect(html).not.toContain('href="https://example.test/aide"');
  });

  test("a manifest without the key adds nothing at all (criterion 3)", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const html = await (await fetch(`${startWith(root, mirror)}/queue?rows=1`, { headers: AUTH })).text();
    expect(html).not.toContain(">preview</a>");
    expect(html).toContain('href="https://example.test/aide"');
  });

  // The manifest is read per render, not once at startup: adding the key
  // must show up on the next page load, not the next deploy.
  test("a manifest edited while the server runs is picked up on the next render", async () => {
    const { root, repo } = roots();
    const { mirror } = await seed([{ root: repo, url: "https://example.test/aide" }]);
    const base = startWith(root, mirror);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).not.toContain(">preview</a>");
    writeFileSync(join(repo, ".aide", "project.yaml"), `name: aide\ndeployment:\n  preview: "${TEMPLATE}"\n`);
    expect(await (await fetch(`${base}/queue?rows=1`, { headers: AUTH })).text()).toContain(`href="${EXPECTED}"`);
  });
});

// A project taken out of the queue's allowlist (aide-dashboard, folded
// into aide by spec 85) still has its jobs in the 200-job history, and
// the page kept them as rows: three specs of a project that no longer
// exists, with a Run button that could only be refused. The row list is
// what the queue may run; a dead project's history is not on it.
describe("jobs of a project no longer in the allowlist are not rows", () => {
  const AUTH = { headers: { "x-aide-token": TOKEN } };

  test("a mirror carrying a retired project's jobs renders none of them", async () => {
    const dead = { ...JOB, project: "aide-dashboard", specFolder: "01-first" };
    // Enqueued while the project was still allowed and had a spec, then
    // served by a queue that no longer lists it — the shape of a
    // project retired after the fact.
    const first = start({ queueToken: TOKEN, queueProjects: ["aide", "aide-dashboard"] }, ["aide-dashboard"]);
    await fetch(`${first.base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...AUTH.headers },
      body: JSON.stringify(dead),
    });
    const mirror = join(first.dir, "queue.json");
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: mirror, queueProjects: ["aide"] });
    const html = await (await fetch(`${base}/?rows=1`, AUTH)).text();
    expect(html).not.toContain("01-first");
    expect(html).not.toContain("aide-dashboard");
    // The API keeps the history: this is a page rule, not a deletion.
    const api = (await (await fetch(`${base}/api/queue`, AUTH)).json()) as { jobs: { project: string }[] };
    expect(api.jobs.some((j) => j.project === "aide-dashboard")).toBe(true);
  });
});
