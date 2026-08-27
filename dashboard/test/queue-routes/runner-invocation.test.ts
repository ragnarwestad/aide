import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseQueueConcurrency,
} from "../../src/serve/serve.ts";
import {
  renderQueuePage,
} from "../../src/render.ts";
import { ran, statusSaying } from "../helpers/queue-server.ts";
import {
  TOKEN,
  JOB,
  specHead,
  specControls,
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


// The row is where you SEE which phases have run; spec 94 makes it
// where you run them. Any subset of the four, one job, on the model the
// row picked.
describe("running a spec's phases from its own row (criteria 1-4, 11)", () => {
  const auth = { headers: { "x-aide-token": TOKEN } };
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  /** Exactly what the row's form posts: no target, no caps. */
  const postRow = (base: string, fields: Record<string, string>) =>
    fetch(`${base}/api/queue`, {
      method: "POST",
      redirect: "manual",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields).toString(),
    });

  // Spec 171: there was a Resolve form here that posted a fixed
  // `steps=resolve`. The step is retired, and the route is where that
  // is enforced for anything still holding the old body — a bookmark,
  // a script, a stale page left open in a tab.
  test("a body still naming the retired resolve step is refused (spec 171)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "resolve",
    });
    expect(res.status).toBe(400);
  });

  test("the row's fields queue the step it ticked, on the model it picked (criteria 1-3)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { steps: string[]; gateAfter?: string[]; model: Record<string, string> };
    };
    expect(body.job.steps).toEqual(["implement"]);
    expect(body.job.model).toEqual({ implement: "fable" });
    // Spec 149: there is no gate to name at all any more, so the field
    // is not on the job the queue hands back.
    expect(body.job.gateAfter).toBeUndefined();
  });

  test("the default option queues no override at all (criterion 4)", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "implement",
      model: "",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  // Spec 181, criterion 7: the review of the plan runs inside analyze
  // now, so the step is two steps' worth of work. The shipped table
  // gives it more clock than the fallback every unnamed step falls to
  // — `archive` is not in the table, so its limit IS that fallback.
  test("analyze's own time limit is longer than the default (spec 181)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze", "archive"] }),
    });
    expect(res.status).toBe(200);
    const { job } = (await res.json()) as { job: { timeoutSec: Record<string, number> } };
    expect(job.timeoutSec.analyze!).toBeGreaterThan(job.timeoutSec.archive!);
  });

  test("every row offers all three steps — the row is the way a spec starts (criterion 11)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const line = specControls(html, "81-queue-and-runner");
    for (const step of ["analyze", "implement", "archive"]) {
      expect(line).toContain(`<input type="checkbox" name="steps" value="${step}"`);
    }
  });

  // Spec 116 gave create a phase line of its own; spec 139 gave it the
  // same source as every other step. `/aide-create` writes
  // `Workflow steps completed: create` into 4-status.md, so a created
  // spec says so — and the line is a report, never a box to tick.
  // Its box is ticked and disabled since 2026-08-21 — the hole where
  // the other four have one made the line read as a different kind of
  // thing. What must still hold is that no press can post it.
  test("a created spec reads create as done, and its box cannot be posted (spec 116)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    ran(dir, ["create"]);
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    const create = html.match(/<tr class="subrow[^"]*"[^>]*data-step="create">.*?<\/tr>/)?.[0] ?? "";
    expect(create).toContain("b-done");
    const controls = specControls(html, "81-queue-and-runner");
    expect(controls).toContain('data-phase="create"');
    // Ticked, disabled, and carrying no field name — three reasons a
    // press can never send `steps=create`.
    expect(controls).toMatch(/<input type="checkbox" value="create" checked disabled/);
    expect(controls).not.toContain('name="steps" value="create"');
  });

  test("ticking two phases queues ONE job with both, in workflow order (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // A browser sends one `steps` value per ticked box, in the order the
    // boxes are drawn — never in the order they were clicked.
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    const made = (await res.json()) as { job: { steps: string[]; gateAfter?: string[] } };
    expect(made.job.steps).toEqual(["analyze", "implement"]);
    expect(made.job.gateAfter).toBeUndefined();
  });

  // The checkbox that used to send this key went in spec 133 and the
  // gate itself in spec 149, so a urlencoded body naming `gate` is a
  // stray from somewhere else. It is ignored, like any other unknown
  // key, and the job runs straight through.
  test("a stray gate key is ignored (criterion 3)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const body = new URLSearchParams({ project: "aide", specFolder: "81-queue-and-runner" });
    body.append("steps", "analyze");
    body.append("steps", "implement");
    body.append("gate", "on");
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    const made = (await res.json()) as { job: { gateAfter?: string[]; state: string } };
    expect(made.job.gateAfter).toBeUndefined();
    expect(made.job.state).toBe("queued");
  });

  // Spec 267 reverses this row's own offer: a done phase's box is now
  // ticked and locked, the same treatment `create` already had (see
  // "a created spec reads create as done" above). The API route itself
  // is untouched (2-analysis.md, "API dependencies: None") — a rerun
  // sent straight to it, bypassing the row's own box, still succeeds.
  test("a done phase's box is locked on the row; a direct rerun still reaches the queue (criterion 4)", async () => {
    const { base, dir } = start({ queueToken: TOKEN });
    const spec = join(dir, "root", "aide", "specs", "81-queue-and-runner");
    writeFileSync(join(spec, "4-status.md"), statusSaying(["create", "analyze"]));
    ran(dir, ["create", "analyze"]);
    const html = await listUntil(base, rowSaysDone("analyze"));
    const analyze = specControls(html, "81-queue-and-runner")
      .match(/<tr class="subrow[^"]*"[^>]*data-step="analyze">[\s\S]*?<\/tr>/)![0];
    expect(analyze).toContain('class="badge b-done"');
    // Ticked, disabled, and carrying no field name — the row no longer
    // offers this phase for a rerun.
    expect(analyze).toContain('<input type="checkbox" value="analyze" checked disabled');
    expect(analyze).not.toContain('name="steps" value="analyze"');
    expect(analyze).toContain("already done");
    const res = await postRow(base, {
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: "analyze",
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { job: { steps: string[] } }).job.steps).toEqual(["analyze"]);
  });

  // Spec 87's criterion 10 said the opposite — "a spec nothing has ever
  // run gets no row, so the form is its only way in". Spec 90 reverses
  // it deliberately: the dropdown and the list held the same things, and
  // a spec crossing from one to the other told the reader nothing.
  test("a spec nothing has ever run is a row, and analyze starts from it (spec 90, criterion 16)", async () => {
    const { base } = start({ queueToken: TOKEN });
    const html = await (await fetch(`${base}/?${OPEN_81}`, auth)).text();
    expect(html).toContain('<tr class="spechead');
    expect(html).toContain('data-folder="81-queue-and-runner"');
    const line = specControls(html, "81-queue-and-runner");
    // Nothing has ever run for it, so analyze is ticked — the step
    // every spec here is actually started as.
    expect(line).toContain('value="analyze" checked');
    // Spec 176: the State column says what the process says comes
    // next, on a row nothing has run as on one that has.
    expect(html).toContain('class="badge b-ready"');
    expect(html).toContain(">ready<");
    expect(html).not.toContain("not started");
  });

  test("the fold survives the refresh the page performs on itself (spec 90, criterion 17)", async () => {
    const { base } = start({ queueToken: TOKEN });
    // The refresh the page performs on itself sends `location.search`
    // back, so the row the reader opened is still open in the swap —
    // and a row nobody opened is still shut (spec 103's default).
    const shut = await (await fetch(`${base}/?rows=1`, auth)).text();
    expect(shut).toContain('data-folder="81-queue-and-runner"');
    expect(shut).not.toContain('<tr class="subrow');
    const opened = await (await fetch(`${base}/?rows=1&${OPEN_81}`, auth)).text();
    expect(opened).toContain('data-folder="81-queue-and-runner"');
    expect(opened).toContain('<tr class="subrow');
  });
});

// Slice 81c: what the server actually hands the runner. The binary is a
// recording stub — one tiny local process, no claude, no network.
describe("the runner invocation", () => {
  function stub(dir: string): { bin: string; argvFile: string; envFile: string } {
    const argvFile = join(dir, "runner-argv.txt");
    const envFile = join(dir, "runner-env.txt");
    const bin = join(dir, "fake-run-spec");
    // The environment first, the argv last: `argvOf` is what most of
    // these tests poll for, and a file written after it would be read
    // half-empty on a slow machine.
    writeFileSync(
      bin,
      `#!/usr/bin/env bash\nprintf '%s\\n' "$AIDE_RUN_URL" "$PATH" > ${envFile}\nprintf '%s\\n' "$*" > ${argvFile}\n`,
      { mode: 0o755 },
    );
    return { bin, argvFile, envFile };
  }

  async function fileOnceWritten(path: string, what: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        await Bun.sleep(50);
      }
    }
    throw new Error(what);
  }

  async function argvOf(argvFile: string): Promise<string> {
    return fileOnceWritten(argvFile, "the runner was never invoked");
  }

  /** What the spawned child actually had in its environment: the run
   *  URL on the first line, PATH on the second. */
  async function envOf(envFile: string): Promise<{ runUrl: string; path: string }> {
    const [runUrl = "", path = ""] = (await fileOnceWritten(envFile, "the runner was never invoked")).split("\n");
    return { runUrl, path };
  }

  /** Spec 222. The variable belongs to the SERVER's process while the
   *  spawn happens, so it is set and restored around the whole test,
   *  not merely before `start()`. A developer whose own shell exports
   *  it would otherwise get a false pass on the derived-URL test. */
  async function withRunUrlEnv<T>(value: string | null, body: () => Promise<T>): Promise<T> {
    const before = process.env.AIDE_RUN_URL;
    if (value === null) delete process.env.AIDE_RUN_URL;
    else process.env.AIDE_RUN_URL = value;
    try {
      return await body();
    } finally {
      if (before === undefined) delete process.env.AIDE_RUN_URL;
      else process.env.AIDE_RUN_URL = before;
    }
  }

  /** Queues one implement step against a stub runner and hands back
   *  what the child was given, plus the port the server actually bound
   *  (`port: 0` here, so it is never `opts.port`). */
  async function envHandedToTheRunner(prefix: string): Promise<{ env: { runUrl: string; path: string }; port: number }> {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    const { bin, envFile } = stub(dir);
    const { base, server } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    // `port: 0` above means "let the OS pick", so the bound port is the
    // only one worth asserting against — and a server that never bound
    // one would otherwise quietly compare against `undefined`.
    const port = server.port;
    if (!port) throw new Error("the test server never bound a port");
    return { env: await envOf(envFile), port };
  }

  test("the push mode, the permission mode and the model all reach the command line", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-spawn-"));
    ownDirs.push(dir);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush: "branch",
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    const argv = await argvOf(argvFile);
    expect(argv).toContain("--push branch");
    expect(argv).toContain("--permission-mode bypassPermissions");
    expect(argv).toContain("--model opus");
    expect(argv).toContain("--command implement");
  });

  // Spec 222. `aide-emit-run` reports each TDD phase, and does nothing
  // at all unless `AIDE_RUN_URL` is set — so a headless step reported
  // its phases into silence, because nothing on the chain from launchd
  // to the spawned `claude` ever set it. The dashboard knows its own
  // address, so the runner tells the step where to report.
  test("a spawned step is told to report its phases back to this server", async () => {
    await withRunUrlEnv(null, async () => {
      const { env, port } = await envHandedToTheRunner("aide-queue-run-url-");
      expect(env.runUrl).toBe(`http://127.0.0.1:${port}/api/aide-run`);
    });
  });

  // The derived URL is a default, never an override: an operator who
  // has pointed reporting at another sink keeps it.
  test("and an AIDE_RUN_URL the server was started with wins over the derived one", async () => {
    await withRunUrlEnv("http://example.test/elsewhere", async () => {
      const { env } = await envHandedToTheRunner("aide-queue-run-url-explicit-");
      expect(env.runUrl).toBe("http://example.test/elsewhere");
    });
  });

  // `Bun.spawn`'s `env`, once given at all, REPLACES the child's
  // environment rather than layering onto it. The call passed none
  // before this spec, so the child inherited everything implicitly;
  // dropping the spread would take PATH away from `claude` and `git`
  // and break every headless step — worse than the silence it fixes.
  test("and the rest of the environment still reaches it", async () => {
    await withRunUrlEnv(null, async () => {
      const { env } = await envHandedToTheRunner("aide-queue-run-url-inherit-");
      expect(env.path.length).toBeGreaterThan(0);
      expect(env.path).toBe(process.env.PATH ?? "");
    });
  });

  // Spec 220, acceptance criterion 2. The global `push` setting speaks
  // for every project on the host at once; a project that reviews its
  // code says so in its own committed manifest, and that answer wins.
  // Both halves have to travel together — a landing left open with no
  // pull request describing it is worse than either behaviour alone —
  // so the choice reaches the runner as `--push pr` rather than only
  // gating the merge on this side.
  //
  // A projects root of the test's own, because the shared harness
  // leaves `queueProjectRoot` unset and the runner is then handed a bare
  // relative name — there is no manifest at the end of that.
  function projectSaying(prefix: string, landing: string | null): { root: string; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    ownDirs.push(dir);
    const root = join(dir, "root");
    const project = join(root, "aide");
    mkdirSync(join(project, ".aide"), { recursive: true });
    writeFileSync(
      join(project, ".aide", "project.yaml"),
      `name: aide\n${landing ? `codeLanding: ${landing}\n` : ""}`,
    );
    mkdirSync(join(project, "specs", "81-queue-and-runner"), { recursive: true });
    writeFileSync(join(project, "specs", "81-queue-and-runner", "1-description.md"), "# 81 - Description\n");
    writeFileSync(join(project, "specs", "81-queue-and-runner", "4-status.md"), statusSaying(["create"]));
    return { root, dir };
  }

  async function pushArgOf(landing: string | null, queuePush: "none" | "branch" | "pr"): Promise<string> {
    const { root, dir } = projectSaying(`aide-queue-landing-${landing ?? "unset"}-`, landing);
    const { bin, argvFile } = stub(dir);
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: bin,
      queueResultDir: join(dir, "jobs"),
      queuePush,
      projectRoot: root,
      queueProjectRoot: root,
      dashboardCheckoutRoot: join(dir, "owned"),
    });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "x-aide-token": TOKEN, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(res.status).toBe(200);
    return (await argvOf(argvFile)).match(/--push (\S+)/)![1]!;
  }

  test("a project whose manifest says pr is run with --push pr, whatever the global setting", async () => {
    expect(await pushArgOf("pr", "branch")).toBe("pr");
  });

  test("and one that says nothing keeps the global setting it always had", async () => {
    // `merge` never overrides anything DOWNWARDS: it is the absence of
    // an opinion, and the host's own config keeps deciding.
    expect(await pushArgOf(null, "pr")).toBe("pr");
    expect(await pushArgOf("merge", "branch")).toBe("branch");
    expect(await pushArgOf(null, "none")).toBe("none");
  });
});

// Reserving the heaviest model for the heaviest jobs. The page offers
// exactly what the config lists — a dropdown that could name a model
// the server has not granted a budget to would be a way to spend more
// than the machine agreed to.
describe("picking a model for a job", () => {
  const CHOICES = {
    budgetUsd: 3,
    jobCapUsd: 10,
    dailyCapUsd: 20,
    timeoutSec: { default: 1200 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
    modelChoices: { sonnet: { budgetUsd: 3 }, fable: { budgetUsd: 12, jobCapUsd: 30 } },
  };

  // The choice belongs to a row the reader has opened (spec 103), so
  // every page here opens the one spec it renders.
  const OPEN = { open: "aide/81-queue-and-runner" };

  test("the form offers the configured models, one picker per phase", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [
        { name: "sonnet", budgetUsd: 3 },
        { name: "fable", budgetUsd: 12 },
      ],
    });
    expect(html).toContain('name="model.analyze"');
    expect(html).toContain('name="model.implement"');
    expect(html).toContain("fable");
    // What each is granted is still said — in the option's tooltip
    // since spec 123, not read out on every label.
    expect(html).toContain('title="$12 per step"');
    // No "default" entry any more (2026-08-19): the select is pre-filled
    // with a real name, and only real names are offered.
    for (const step of ["analyze", "implement"]) {
      const select = html.match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))![0];
      expect([step, select.includes('<option value=""')]).toEqual([step, false]);
    }
  });

  // The "default" option is gone (asked for 2026-08-19): the select is
  // pre-filled with a real name instead, and every option's figure lives
  // in its tooltip — never on the label.
  test("no default option, no figure on any label; the tooltips keep them", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
      modelChoices: [{ name: "fable", budgetUsd: 12 }],
      defaultModels: { default: "fable" },
    });
    expect(html).not.toContain('<option value=""');
    expect(html).toMatch(/<option value="fable"[^>]*title="[^"]*\$12[^"]*"[^>]*>/);
    expect(html).not.toMatch(/<option[^>]*>[^<]*\$/);
  });

  test("with nothing configured the page offers no model at all", () => {
    const html = renderQueuePage([], "2026-08-16T00:00:00Z", [{ label: "Overview", path: "projects.html" }], {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: "81-queue-and-runner" }],
      filter: OPEN,
    });
    expect(html).not.toContain('name="model"');
  });

  test("a row says which model it ran on — as the select's pre-filled value", () => {
    const html = renderQueuePage(
      [
        {
          id: "a", project: "aide", specFolder: "81-queue-and-runner",
          steps: ["implement"], stepIndex: 0, state: "done", spentUsd: 24.5,
          timeoutSec: 1200, createdAt: "2026-08-16T00:00:00Z", model: "fable",
        },
      ],
      "2026-08-16T00:00:00Z",
      [{ label: "Overview", path: "projects.html" }],
      {
        runnerAvailable: true, targets: [], filter: OPEN,
        modelChoices: [{ name: "sonnet", budgetUsd: 3 }, { name: "fable", budgetUsd: 12 }],
        defaultModels: { default: "sonnet" },
      },
    );
    expect(html).toMatch(/<select name="model\.implement"[^>]*>[^]*?<option value="fable"[^>]*selected/);
  });

  test("posting a chosen model runs every step on it, with the config's budget", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "fable",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number; jobCapUsd: number } };
    expect(body.job.model).toEqual({ implement: "fable" });
    expect(body.job.budgetUsd).toBe(12);
    expect(body.job.jobCapUsd).toBe(30);
  });

  test("an empty model field means 'use the configuration', not an error", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "implement",
        model: "",
      }).toString(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  // Spec 123: the choice moved onto the phase lines, so a form now
  // posts one field PER PHASE — `model.analyze=…&model.implement=…`.
  // A urlencoded body cannot carry a nested object, so the dotted keys
  // are folded back into one on the way in. Tested through the real
  // route rather than against the two functions separately: they are
  // only proven to AGREE if something drives an actual wire body from
  // one end to the other.
  test("one press can run two phases on two different models", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        target: "aide/81-queue-and-runner",
        steps: "analyze",
        "model.analyze": "sonnet",
      }).toString() + "&steps=implement&model.implement=fable",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: { model: Record<string, string>; budgetUsd: number; jobCapUsd: number };
    };
    expect(body.job.model).toEqual({ analyze: "sonnet", implement: "fable" });
    // The more generous of the two grants, not the two added together.
    expect(body.job.budgetUsd).toBe(12);
    expect(body.job.jobCapUsd).toBe(30);
  });

  // Every select on the page posts, including the ones left alone —
  // a browser sends `model.implement=` for a phase whose picker still
  // reads "default". Passed through as an empty string it would be
  // refused as an invalid model name; it has to be dropped instead.
  test("a phase left on 'default' posts a blank that is dropped, not refused", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body:
        "target=aide%2F81-queue-and-runner&steps=analyze&steps=implement" +
        "&model.analyze=fable&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string> } };
    expect(body.job.model).toEqual({ analyze: "fable", implement: "opus" });
  });

  test("every phase left on 'default' queues no override at all", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { job: { model: Record<string, string>; budgetUsd: number } };
    expect(body.job.model).toEqual({ implement: "opus" });
    expect(body.job.budgetUsd).toBe(3);
  });

  test("a per-phase field naming a model the config does not list is refused", async () => {
    const { base } = start({ queueToken: TOKEN, queueDefaults: CHOICES });
    const res = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: {
        "x-aide-token": TOKEN,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: "target=aide%2F81-queue-and-runner&steps=implement&model.implement=gpt-9",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("gpt-9");
  });
});
// Spec 149: the Merge button is gone, and this whole block with it. What it
// covered — the per-repo merge, the plan-before-code order, the install
// afterwards, the conflict that offers a resolve — is what a step's own
// landing does now, and is covered in "every step lands its own work" below.

// --- Spec 91, criterion 26: how many at once -------------------------------
// The slot count is a number, and a number that turns out wrong should
// cost a config edit and a restart, not a release (`queue.ts:325-327`).
describe("the queue config decides how many run at once", () => {
  test("a number in 1-4 is taken; anything else falls back to two", () => {
    expect(parseQueueConcurrency(3)).toBe(3);
    expect(parseQueueConcurrency(1)).toBe(1);
    expect(parseQueueConcurrency(4)).toBe(4);
    // FALLS BACK, does not clamp: `concurrency: 9` would otherwise have
    // to be both 4 and 2 depending on which rule you read.
    expect(parseQueueConcurrency(9)).toBe(2);
    expect(parseQueueConcurrency(0)).toBe(2);
    expect(parseQueueConcurrency(-1)).toBe(2);
    expect(parseQueueConcurrency(2.5)).toBe(2);
    expect(parseQueueConcurrency("3")).toBe(2);
    expect(parseQueueConcurrency(undefined)).toBe(2);
  });

  test("with concurrency 3, three jobs for three specs really do run at once", async () => {
    // Not a unit test of the option: this starts three real runner
    // processes through the server's own spawn path, because "the number
    // reaches the runner" is not the same claim as "three run".
    const own = mkdtempSync(join(tmpdir(), "aide-concurrency-"));
    ownDirs.push(own);
    const go = join(own, "go");
    const fakeRunner = join(own, "fake-run-spec");
    writeFileSync(fakeRunner, `#!/bin/sh\nwhile [ ! -f ${go} ]; do sleep 0.05; done\n`, { mode: 0o755 });
    const specs = ["82-second", "83-third"];
    const { base } = start({
      queueToken: TOKEN,
      queueRunnerBin: fakeRunner,
      queueResultDir: join(own, "jobs"),
      queueConcurrency: 3,
    }, [], specs);
    try {
      for (const specFolder of ["81-queue-and-runner", ...specs]) {
        const res = await fetch(`${base}/api/queue`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-aide-token": TOKEN },
          body: JSON.stringify({ project: "aide", specFolder, steps: ["analyze"] }),
        });
        expect(res.status).toBe(200);
      }
      // The runner ticks on a 2s timer.
      const deadline = Date.now() + 15000;
      let running: unknown[] = [];
      while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/queue`, { headers: { "x-aide-token": TOKEN } });
        const body = (await res.json()) as { jobs: { state: string }[] };
        running = body.jobs.filter((j) => j.state === "running");
        if (running.length >= 3) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(running.length).toBe(3);
    } finally {
      writeFileSync(go, "");
    }
  }, 30000);
});

// Spec 125: the argv is where a tool choice becomes real. Two rules, and
// the second one is the reason this is testable at all: the flag is
// appended ONLY when the resolved tool is not claude, so every config
// that predates this spec produces byte-for-byte the argv it always did.
describe("a model choice's tool reaches the runner", () => {
  const job = (model: Record<string, string>) =>
    ({
      project: "aide",
      specFolder: "81-queue-and-runner",
      steps: ["implement"],
      budgetUsd: 15,
      timeoutSec: 2700,
      permissionMode: { implement: "bypassPermissions" },
      model,
    }) as unknown as Parameters<typeof import("../../src/serve/serve.ts").runnerArgv>[0];

  test("a codex choice passes --tool and its own model name", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex", model: "gpt-5.6" } },
    });
    expect(argv[argv.indexOf("--tool") + 1]).toBe("codex");
    // The real model, not the picker's display key.
    expect(argv[argv.indexOf("--model") + 1]).toBe("gpt-5.6");
    expect(argv).not.toContain("codex-fast");
  });

  test("a choice with no model of its own keeps using its key", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "codex-fast" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
      modelChoices: { "codex-fast": { budgetUsd: 5, tool: "codex" } },
    });
    expect(argv[argv.indexOf("--model") + 1]).toBe("codex-fast");
  });

  test("a choice with no tool field is claude, and the argv is unchanged", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const before = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", o);
    const after = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      ...o,
      modelChoices: { opus: { budgetUsd: 15 } },
    });
    expect(after).not.toContain("--tool");
    expect(after).toEqual(before);
    expect(after[after.indexOf("--model") + 1]).toBe("opus");
  });

  test("a server with no choices configured at all still runs claude", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(job({ implement: "opus" }), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec",
      projectDir: "/home/dev/aide",
      push: "branch",
    });
    expect(argv).not.toContain("--tool");
  });
});

// --- spec 152: the wall clock is per step, and a stand-in cost says so -------
//
// 149's implement was killed at its own 45-minute limit with its tests
// already green, and was booked at the full budget because a SIGKILLed
// run prints no usage. Two seams in this file carried that: the argv the
// runner is started with (one number for every step), and the `Job` →
// `QueueRowView` mapping, which dropped `costMeasured` on the floor so
// the totals built on it could not tell a measurement from a ceiling.
describe("a step's own time limit reaches the runner", () => {
  const jobWith = (timeoutSec: unknown, steps: string[] = ["analyze", "implement"]) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner", steps,
      budgetUsd: 3, timeoutSec, permissionMode: {}, model: {},
    }) as unknown as Parameters<typeof import("../../src/serve/serve.ts").runnerArgv>[0];

  const timeoutArg = (argv: string[]): string => argv[argv.indexOf("--timeout-sec") + 1]!;

  test("an implement is spawned with implement's number, not default's", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const o = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
    const job = jobWith({ analyze: 1200, implement: 5400 });
    expect(timeoutArg(runnerArgv(job, "implement", "/tmp/r.json", o))).toBe("5400");
    expect(timeoutArg(runnerArgv(job, "analyze", "/tmp/r.json", o))).toBe("1200");
  });

  // A job created before the shape changed is still sitting in the
  // store across the deploy. Read as an index it would give `undefined`
  // and the runner would be handed the string "undefined" as its
  // deadline — a crash-adjacent read, not a cosmetic one.
  test("a job persisted with the old flat number is still given a real deadline", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(2700), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("2700");
  });

  test("a step the table does not name falls to its default", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith({ default: 1200, implement: 5400 }, ["archive"]), "archive", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
    });
    expect(timeoutArg(argv)).toBe("1200");
  });

  // Spec 177: the shape `parseJobRequest` actually produces. `perStep`
  // resolves the config's `default` into a concrete entry for each step
  // the request named, so a job's own table never carries a `default`
  // key of its own — and a step ticked onto the tail afterwards (spec
  // 160) has no entry at all. Both fallbacks above are therefore
  // `undefined` for it, and the runner is handed the string
  // "undefined" as its deadline.
  test("a tail-added step the job's table cannot name falls to the live config", async () => {
    const { resolveTimeoutSec } = await import("../../src/serve/serve.ts");
    const live = { default: 1200, implement: 5400 };
    expect(resolveTimeoutSec({ analyze: 1200 }, "implement", live)).toBe(5400);
    expect(resolveTimeoutSec({ analyze: 1200 }, "archive", live)).toBe(1200);
  });

  test("the argv for a tail-added step carries a real number, not \"undefined\"", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith({ analyze: 1200 }, ["analyze", "implement"]), "implement", "/tmp/r.json", {
      runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch",
      timeoutSec: { default: 1200, implement: 5400 },
    });
    expect(timeoutArg(argv)).toBe("5400");
  });
});

// --- spec 177: a step added later brings its settings with it ---------------
//
// Spec 160 lets a reader tick a phase onto a job that is already
// running. The job's three per-step tables are built at CREATION from
// the steps it had then, so the added step has no entry in any of them
// — and each miss costs something different when the step comes up:
// no deadline, `acceptEdits` where `implement` needs bypassPermissions
// (specs 105 and 112 were each stamped-but-not-moved by exactly that),
// and no `--model` flag at all.
describe("a tail-added step is spawned on the same terms as its siblings", () => {
  const jobWith = (over: Record<string, unknown> = {}) =>
    ({
      project: "aide", specFolder: "81-queue-and-runner",
      steps: ["analyze", "implement"], budgetUsd: 3,
      timeoutSec: { analyze: 1200 }, permissionMode: { analyze: "acceptEdits" },
      model: { analyze: "sonnet" },
      ...over,
    }) as unknown as Parameters<typeof import("../../src/serve/serve.ts").runnerArgv>[0];

  const base = { runnerBin: "/bin/aide-run-spec", projectDir: "/home/dev/aide", push: "branch" };
  const live = {
    timeoutSec: { default: 1200, implement: 5400 },
    permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
    model: { implement: "opus", default: "sonnet" },
  };

  test("it gets the config's permission mode, not the acceptEdits literal", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  test("it gets the config's model, instead of no --model flag at all", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const argv = runnerArgv(jobWith(), "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
  });

  // A whole-job pick is already copied into every ORIGINAL step's own
  // `model` entry at creation, so a step added afterwards has to match
  // its siblings rather than fall through to what the config says for
  // that step in isolation.
  test("a whole-job model choice still wins over the config's per-step default", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const job = jobWith({ modelChoice: "sonnet", model: { analyze: "sonnet" } });
    const argv = runnerArgv(job, "implement", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--model") + 1]).toBe("sonnet");
  });

  // Criterion 7: the fallback never overrides an entry the job already
  // has. Every step present at creation keeps running on exactly the
  // terms it was created with, config changes since then included.
  test("a step the job's own table names is untouched by the fallback", async () => {
    const { runnerArgv } = await import("../../src/serve/serve.ts");
    const job = jobWith({
      timeoutSec: { analyze: 900 }, permissionMode: { analyze: "plan" }, model: { analyze: "haiku" },
    });
    const argv = runnerArgv(job, "analyze", "/tmp/r.json", { ...base, ...live });
    expect(argv[argv.indexOf("--timeout-sec") + 1]).toBe("900");
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(argv[argv.indexOf("--model") + 1]).toBe("haiku");
  });
});

describe("an over-charged cost survives the row mapping", () => {
  async function seeded(costMeasured: boolean): Promise<string> {
    const { base, dir } = start({ queueToken: TOKEN });
    const headers = { "content-type": "application/json", accept: "application/json", "x-aide-token": TOKEN };
    const made = (await (
      await fetch(`${base}/api/queue`, {
        method: "POST", headers, body: JSON.stringify({ ...JOB, steps: ["implement"] }),
      })
    ).json()) as { job: { id: string } };
    const mirror = join(dir, "queue.json");
    const jobs = JSON.parse(readFileSync(mirror, "utf-8")) as Record<string, unknown>[];
    const job = jobs.find((j) => j.id === made.job.id)!;
    job.state = "stopped";
    job.stopReason = "timeout";
    job.spentUsd = 35;
    job.results = [
      {
        step: "implement", ok: false, costUsd: 35, costMeasured,
        terminalReason: "timeout", at: "2026-08-21T07:58:00Z",
      },
    ];
    writeFileSync(mirror, JSON.stringify(jobs));
    return mirror;
  }

  const MARKER = '<span class="muted small">est.</span>';

  test("the spec row marks a total it could not measure", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(false) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    expect(specHead(html, "81-queue-and-runner")).toContain(MARKER);
  });

  test("a measured total through the same seam carries no mark", async () => {
    const { base } = start({ queueToken: TOKEN, queueMirrorPath: await seeded(true) });
    const html = await (await fetch(`${base}/`, { headers: { "x-aide-token": TOKEN } })).text();
    const head = specHead(html, "81-queue-and-runner");
    expect(head).toContain("$35.00");
    expect(head).not.toContain(MARKER);
  });
});
