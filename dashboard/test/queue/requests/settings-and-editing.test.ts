import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  QueueStore,
  persistQueueProjects,
  tailEdits,
  type QueueDefaults,
} from "../../../src/queue/queue.ts";
import { parseArgs } from "../../../src/serve/serve.ts";
import { renderSentence } from "../../../src/i18n/message.ts";

/** What a reader would see: since spec 380 a message is stored as
 *  its key and the values that fill its blanks, and composed when
 *  the page is drawn. */
function sentence(s: unknown): string {
  return renderSentence("en", s as Parameters<typeof renderSentence>[1]) ?? "";
}


const DEFAULTS: QueueDefaults = {
  budgetUsd: 3,
  jobCapUsd: 10,
  dailyCapUsd: 20,
  // Per step since spec 152: an implement is not an analyze, and one
  // number for both stopped 149 mid-sentence with its tests green.
  timeoutSec: { default: 1200, implement: 5400 },
  permissionMode: { implement: "bypassPermissions", default: "acceptEdits" },
  model: { implement: "opus", default: "sonnet" },
};

// The server resolves a project NAME to its real spec folders; the
// request never carries a path. Two allowlisted projects here.
const resolve = (project: string) =>
  project === "aide"
    ? { specFolders: ["81-queue-and-runner"] }
    : project === "aide-dashboard"
      ? { specFolders: ["01-first"] }
      : null;

const REQ = { project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"] };

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aide-queue-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));


// --- spec 112: the allowlist lives in the config file ------------------------
//
// It used to be a `--queue-projects` argument baked into the launchd
// plist, so adding a project meant re-rendering the plist and
// restarting the server. The list moves into `queue-config.json`, which
// the server already reads: `--queue-projects` stays, as the seed for a
// first install where that file does not exist yet.
describe("the project allowlist round-trips through queue-config.json", () => {
  const configDirs: string[] = [];
  const configFile = (contents?: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "aide-queue-projects-"));
    configDirs.push(dir);
    const file = join(dir, "queue-config.json");
    if (contents) writeFileSync(file, JSON.stringify(contents, null, 2));
    return file;
  };

  afterEach(() => {
    while (configDirs.length) rmSync(configDirs.pop()!, { recursive: true, force: true });
  });

  test("a written list is read back as the allowlist (criterion 9)", () => {
    const file = configFile({ concurrency: 3 });
    expect(persistQueueProjects(file, ["aide", "atlasaurus"])).toBeNull();
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
    expect(opts.queueProjects).toEqual(["aide", "atlasaurus"]);
  });

  test("the file's other keys survive the write", () => {
    const file = configFile({ concurrency: 3, push: "none", notifyCommand: ["/bin/echo", "hi"] });
    persistQueueProjects(file, ["aide"]);
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    expect(raw).toEqual({
      concurrency: 3,
      push: "none",
      notifyCommand: ["/bin/echo", "hi"],
      projects: ["aide"],
    });
    const opts = parseArgs(["--queue-config", file]);
    expect(opts.queueConcurrency).toBe(3);
    expect(opts.queuePush).toBe("none");
    expect(opts.queueNotifyCommand).toEqual(["/bin/echo", "hi"]);
  });

  test("the config beats a conflicting --queue-projects (criterion 10)", () => {
    const file = configFile({ projects: ["atlasaurus"] });
    const opts = parseArgs([
      "--queue-config", file,
      "--queue-projects", "aide,aide-dashboard",
    ]);
    expect(opts.queueProjects).toEqual(["atlasaurus"]);
  });

  test("no projects field means the CLI flag still seeds a first install", () => {
    const file = configFile({ concurrency: 2 });
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide,aide-dashboard"]);
    expect(opts.queueProjects).toEqual(["aide", "aide-dashboard"]);
  });

  test("an empty list is a real answer, not a missing one", () => {
    const file = configFile({ projects: [] });
    const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
    expect(opts.queueProjects).toEqual([]);
  });

  test("a malformed projects field is ignored, and the flag is kept", () => {
    for (const projects of ["aide", [1, 2], ["../escape"], ["a/b"], {}]) {
      const file = configFile({ projects });
      const opts = parseArgs(["--queue-config", file, "--queue-projects", "aide"]);
      expect([projects, opts.queueProjects]).toEqual([projects, ["aide"]]);
    }
  });

  test("the config file path reaches the server, so a route can write it", () => {
    const file = configFile({ projects: ["aide"] });
    expect(parseArgs(["--queue-config", file]).queueConfigFile).toBe(file);
  });

  // Criterion 15: the write is derived from the caller's list and lands
  // synchronously, so two in a row cannot interleave — the second sees
  // the first's file, and neither reads a copy taken before the other
  // wrote.
  test("two writes in immediate succession both land", () => {
    const file = configFile({ concurrency: 2 });
    const allowed = new Set(["aide"]);
    allowed.add("atlasaurus");
    persistQueueProjects(file, [...allowed]);
    allowed.delete("aide");
    persistQueueProjects(file, [...allowed]);
    expect(parseArgs(["--queue-config", file]).queueProjects).toEqual(["atlasaurus"]);
  });

  test("a config file that does not exist yet is created", () => {
    const file = configFile();
    expect(existsSync(file)).toBe(false);
    expect(persistQueueProjects(file, ["aide"])).toBeNull();
    expect(parseArgs(["--queue-config", file]).queueProjects).toEqual(["aide"]);
  });

  test("a path that cannot be written is reported, never thrown", () => {
    // A file where a directory would have to be: mkdir -p cannot help.
    const blocked = configFile({});
    const error = persistQueueProjects(join(blocked, "c.json"), ["aide"]);
    expect(typeof error).toBe("string");
  });
});

// --- spec 363: a proxy that can vouch for the reader --------------------------
//
// `headerAuth` arrives through `queue-config.json` like every other
// optional key here — never a dedicated CLI flag. A malformed block
// fails toward "off", the same direction every sibling key does; a
// well-formed one on the wrong bind is `createServer`'s refusal to
// throw, not this parser's job.
describe("headerAuth in queue-config.json", () => {
  const configDirs: string[] = [];
  const configFile = (contents?: Record<string, unknown>): string => {
    const dir = mkdtempSync(join(tmpdir(), "aide-header-auth-"));
    configDirs.push(dir);
    const file = join(dir, "queue-config.json");
    if (contents) writeFileSync(file, JSON.stringify(contents, null, 2));
    return file;
  };

  afterEach(() => {
    while (configDirs.length) rmSync(configDirs.pop()!, { recursive: true, force: true });
  });

  test("a well-formed block is read into opts.headerAuth", () => {
    const file = configFile({ headerAuth: { header: "Tailscale-User-Login", users: ["alice@example.com"] } });
    const opts = parseArgs(["--queue-config", file]);
    expect(opts.headerAuth).toEqual({ header: "Tailscale-User-Login", users: ["alice@example.com"] });
  });

  test("no headerAuth field at all leaves it unset", () => {
    const file = configFile({ concurrency: 2 });
    const opts = parseArgs(["--queue-config", file]);
    expect(opts.headerAuth).toBeUndefined();
  });

  test("a malformed block is ignored, the same direction every sibling key fails in", () => {
    for (const headerAuth of [
      { header: "", users: ["a"] },
      { header: "X-User", users: [] },
      { header: "X-User", users: [1, 2] },
      { users: ["a"] },
      { header: "X-User" },
      "X-User",
      [],
    ]) {
      const file = configFile({ headerAuth });
      const opts = parseArgs(["--queue-config", file]);
      expect(opts.headerAuth).toBeUndefined();
    }
  });
});

// --- spec 160: a later phase can be added while the job runs ------------------

// A run started with too few phases meant waiting for it to end and
// pressing Run again; one started with too many meant Cancel and start
// over. Both are the reader knowing more at minute ten than at minute
// zero. The tail of a RUNNING job's step list is editable — and only
// the tail: what has run, and what is running, is not up for a second
// opinion.
describe("editing a running job's tail (spec 160)", () => {
  /** A job in the store, running the step at `stepIndex`. The state is
   *  set through `update()` rather than by a runner: what these tests
   *  are about is the store's own rule, and a runner would only make
   *  the fixture slower to state. */
  let made_ = 0;
  const running = (steps: string[], stepIndex = 0) => {
    // A mirror of its own per job: a second store on the same file
    // loads the first one's job and refuses the enqueue as a clash.
    const mirror = join(dir, `queue-${(made_ += 1)}.json`);
    const store = new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath: mirror });
    const made = store.enqueue({ ...REQ, steps });
    if (!made.ok) throw new Error(made.error);
    store.update(made.job.id, { state: "running", stepIndex });
    return { store, mirror, id: made.job.id, steps: () => store.get(made.job.id)!.steps };
  };

  test("an added step lands in WORKFLOW_STEPS order, not at the array end (criterion 1)", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep(job.id, "archive", true).ok).toBe(true);
    expect(job.store.editTailStep(job.id, "implement", true).ok).toBe(true);
    expect(job.steps()).toEqual(["analyze", "implement", "archive"]);
    // The running step is where it was: the head of the list is not
    // touched by an edit to the tail.
    expect(job.store.get(job.id)!.stepIndex).toBe(0);
  });

  test("a not-yet-started step can be removed (criterion 2)", () => {
    const job = running(["analyze", "implement", "archive"]);
    const answer = job.store.editTailStep(job.id, "implement", false);
    expect(answer.ok).toBe(true);
    expect(job.steps()).toEqual(["analyze", "archive"]);
    expect(job.store.get(job.id)!.stepIndex).toBe(0);
  });

  test("the running step and everything behind it are closed (criterion 3)", () => {
    const job = running(["analyze", "implement"], 1);
    for (const [step, add] of [
      ["implement", false], ["implement", true],
      ["analyze", false], ["analyze", true],
    ] as const) {
      const answer = job.store.editTailStep(job.id, step, add);
      expect(`${step} ${add}: ${answer.ok}`).toBe(`${step} ${add}: false`);
      // Named, never a bare "no": the row has one line to say why.
      if (!answer.ok) expect(sentence(answer.error)).toContain(step);
    }
    expect(job.steps()).toEqual(["analyze", "implement"]);
  });

  // The step the reader is looking at may finish between the page
  // rendering and the tick arriving. The store decides against the job
  // as it is at that instant, never against what the page believed.
  test("a step the runner has walked past since the page drew it is refused by name (criterion 4)", () => {
    const job = running(["analyze", "implement"]);
    // What the page believed: implement has not started, so its box is
    // live and unticking it would drop it. Then the runner moves on.
    job.store.update(job.id, { stepIndex: 1 });
    const answer = job.store.editTailStep(job.id, "implement", false);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(sentence(answer.error)).toContain("implement");
    expect(job.steps()).toEqual(["analyze", "implement"]);
  });

  test("a job that is not running is closed altogether (criterion 6)", () => {
    for (const state of ["queued", "done", "failed", "cancelled", "stopped", "interrupted"] as const) {
      const job = running(["analyze"]);
      job.store.update(job.id, { state });
      const answer = job.store.editTailStep(job.id, "implement", true);
      expect(`${state}: ${answer.ok}`).toBe(`${state}: false`);
      expect(job.steps()).toEqual(["analyze"]);
    }
  });

  test("a step already in the job cannot be added a second time", () => {
    const job = running(["analyze", "archive"]);
    const answer = job.store.editTailStep(job.id, "archive", true);
    expect(answer.ok).toBe(false);
    expect(job.steps()).toEqual(["analyze", "archive"]);
  });

  // A job created without every earlier step ticked would otherwise
  // show the missing one as live, and adding it would run it AFTER the
  // step now running — out of the only order these steps have.
  test("a step that ranks earlier than the one running is refused (criterion 9)", () => {
    const job = running(["implement", "archive"]);
    const answer = job.store.editTailStep(job.id, "analyze", true);
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(sentence(answer.error)).toContain("analyze");
    expect(job.steps()).toEqual(["implement", "archive"]);
  });

  test("an unknown job is not found", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep("no-such-job", "implement", true).ok).toBe(false);
  });

  // The mirror is what survives a restart, and a tail edited only in
  // memory would be undone by one.
  test("the edit reaches the mirror", () => {
    const job = running(["analyze"]);
    expect(job.store.editTailStep(job.id, "implement", true).ok).toBe(true);
    const stored = JSON.parse(readFileSync(job.mirror, "utf-8")) as { id: string; steps: string[] }[];
    expect(stored.find((j) => j.id === job.id)!.steps).toEqual(["analyze", "implement"]);
  });

  // What the ROW needs to know before it draws a box: which steps are
  // still open to a tick. One function answers it for the store's own
  // refusal and for the page alike, so the two cannot drift apart.
  describe("tailEdits", () => {
    test("names the tail and every later step the job does not have, in workflow order", () => {
      const job = running(["analyze", "archive"]);
      expect(tailEdits(job.store.get(job.id)!)).toEqual(["implement", "archive"]);
    });

    test("a job that is not running has nothing open (criterion 8)", () => {
      const job = running(["analyze", "archive"]);
      job.store.update(job.id, { state: "queued" });
      expect(tailEdits(job.store.get(job.id)!)).toEqual([]);
    });

    test("nothing earlier than the running step is offered (criterion 9)", () => {
      const job = running(["implement", "archive"]);
      expect(tailEdits(job.store.get(job.id)!)).not.toContain("analyze");
    });
  });
});
// --- spec 254: an enqueue is refused while the spec's last step lands ---------

// `Runner.complete()` writes `state: "done"` and `landing: true` in the
// same update — the merge into the default branch has not happened yet.
// Nothing before this refused a fresh job for that same spec: `clashing()`
// only fires on an OVERLAPPING step name, and "done" is not in
// `UNFINISHED`. A job could enqueue and sit `queued` behind a landing it
// never named.
describe("refusing an enqueue while the spec's last job is still landing (spec 254)", () => {
  const store = () => new QueueStore({ defaults: DEFAULTS, resolve, mirrorPath: join(dir, "queue.json") });

  test("a new job for the same spec is refused while the prior one is landing (criterion 2)", () => {
    const s = store();
    const create = s.enqueue({ ...REQ, steps: ["create"] });
    if (!create.ok) throw new Error(create.error);
    s.update(create.job.id, { state: "done", landing: true });
    const answer = s.enqueue({ ...REQ, steps: ["analyze"] });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(sentence(answer.error)).toContain(REQ.specFolder);
  });

  test("an unrelated spec is unaffected while this one is landing", () => {
    const s = store();
    const create = s.enqueue({ ...REQ, steps: ["create"] });
    if (!create.ok) throw new Error(create.error);
    s.update(create.job.id, { state: "done", landing: true });
    const answer = s.enqueue({ project: "aide-dashboard", specFolder: "01-first", steps: ["analyze"] });
    expect(answer.ok).toBe(true);
  });

  test("once landing has cleared, a new job enqueues as before", () => {
    const s = store();
    const create = s.enqueue({ ...REQ, steps: ["create"] });
    if (!create.ok) throw new Error(create.error);
    s.update(create.job.id, { state: "done", landing: false });
    const answer = s.enqueue({ ...REQ, steps: ["analyze"] });
    expect(answer.ok).toBe(true);
  });
});
