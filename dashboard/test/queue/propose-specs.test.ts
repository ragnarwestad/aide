// What the board does when a scheduled run ends green: read the proposals the
// run left, and queue a Create job for each one that passes.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore, type Job } from "../../src/queue/queue.ts";
import { proposeSpecs, type ProposeDeps } from "../../src/queue/propose-specs.ts";
import { PROPOSALS_FILE, PROPOSALS_RESULT_FILE, readProposalsRecord } from "../../src/queue/spec-proposals.ts";
import { scheduleRunOutputDir } from "../../src/queue/schedule.ts";

const DEFAULTS = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "sonnet" },
};

let root: string;
let outputRoot: string;
let specsRoot: string;
let store: QueueStore;
let logged: string[];

const KEY = "schedule-nyhetssjekk";
const RUN = "run-1";

const runJob = (over: Partial<Job> = {}): Job =>
  ({
    id: RUN,
    project: "aide",
    specFolder: KEY,
    steps: ["schedule"],
    stepIndex: 0,
    state: "running",
    createdAt: "2026-09-26T18:00:00Z",
    startedAt: "2026-09-26T18:00:04Z",
    results: [],
    spentUsd: 0,
    ...over,
  }) as Job;

function spec(dir: string, folder: string, title: string, status = ""): void {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, "1-description.md"), `# ${title} - Description\n`);
  if (status) writeFileSync(join(dir, folder, "4-status.md"), status);
}

const outDir = (id = RUN) => scheduleRunOutputDir(outputRoot, "aide", KEY, id);

function leave(proposals: unknown, id = RUN): void {
  mkdirSync(outDir(id), { recursive: true });
  writeFileSync(join(outDir(id), PROPOSALS_FILE), typeof proposals === "string" ? proposals : JSON.stringify(proposals));
}

const deps = (over: Partial<ProposeDeps> = {}): ProposeDeps => ({
  store,
  outputRoot,
  specsRoot: () => specsRoot,
  reportPath: (name, runId) => `/schedule/aide/${name}?run=${runId}#report`,
  now: () => "2026-09-26T18:00:09Z",
  log: (action, spec, reason) => void logged.push(`${action}|${spec}|${reason}`),
  ...over,
});

const record = (id = RUN) => readProposalsRecord(outputRoot, "aide", KEY, id);
const queued = () => store.list().filter((j) => j.steps[0] === "create");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "aide-propose-"));
  outputRoot = join(root, "out");
  specsRoot = join(root, "specs");
  mkdirSync(join(specsRoot, "archive"), { recursive: true });
  logged = [];
  store = new QueueStore({
    defaults: DEFAULTS,
    resolve: () => ({ specFolders: [] }),
    allowCreateProject: (p) => p === "aide",
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("proposeSpecs", () => {
  test("two valid proposals become two Create jobs for the job's project and nothing after Create (AC-2, AC-1)", () => {
    leave([
      { title: "First", description: "Do the first" },
      { title: "Second", description: "Do the second" },
    ]);
    proposeSpecs(deps(), runJob());
    const jobs = queued();
    expect(jobs.map((j) => j.createTitle).sort()).toEqual(["First", "Second"]);
    for (const j of jobs) {
      expect(j.project).toBe("aide");
      expect(j.steps).toEqual(["create"]);
      expect(j.state).toBe("queued");
    }
    expect(record()?.proposals.map((p) => p.result)).toEqual(["created", "created"]);
  });

  test("a description begins with the proposal's own text and ends with the source block (AC-5)", () => {
    leave([{ title: "First", description: "Do the first\n\n- with a list" }]);
    proposeSpecs(deps(), runJob());
    const d = queued()[0]!.createDescription!;
    expect(d.startsWith("Do the first\n\n- with a list\n\n### Source")).toBe(true);
    expect(d).toContain("`nyhetssjekk`");
    expect(d).toContain(`\`${RUN}\``);
    expect(d).toContain(`/schedule/aide/nyhetssjekk?run=${RUN}#report`);
  });

  test("no file means nothing is queued and no record is written (AC-1)", () => {
    mkdirSync(outDir(), { recursive: true });
    proposeSpecs(deps(), runJob());
    expect(queued()).toEqual([]);
    expect(existsSync(join(outDir(), PROPOSALS_RESULT_FILE))).toBe(false);
  });

  test("a second call for the same run queues nothing more (AC-2)", () => {
    leave([{ title: "First", description: "d" }]);
    proposeSpecs(deps(), runJob());
    proposeSpecs(deps(), runJob());
    expect(queued()).toHaveLength(1);
  });

  test("titles of active, archived and closed specs are skipped as existing, with folder and kind (AC-3)", () => {
    spec(specsRoot, "01-alpha", "Alpha");
    spec(join(specsRoot, "archive"), "02-beta", "Beta");
    spec(join(specsRoot, "archive"), "03-gamma", "Gamma", "- **Closed:** 2026-09-01 — declined\n");
    leave([
      { title: "  alpha ", description: "d" },
      { title: "BETA", description: "d" },
      { title: "Gamma", description: "d" },
      { title: "Fresh", description: "d" },
    ]);
    proposeSpecs(deps(), runJob());
    expect(queued().map((j) => j.createTitle)).toEqual(["Fresh"]);
    const why = record()!.proposals.map((p) => (p.result === "skipped" ? p.why : null));
    expect(why[0]).toEqual({ code: "exists", folder: "01-alpha", kind: "active" });
    expect(why[1]).toEqual({ code: "exists", folder: "02-beta", kind: "archived" });
    expect(why[2]).toEqual({ code: "exists", folder: "03-gamma", kind: "closed" });
  });

  test("a title listed twice is created once and the second names the first's job (AC-3)", () => {
    leave([
      { title: "Same", description: "one" },
      { title: "same ", description: "two" },
    ]);
    proposeSpecs(deps(), runJob());
    expect(queued()).toHaveLength(1);
    const [a, b] = record()!.proposals;
    expect(a).toMatchObject({ result: "created" });
    expect(b).toMatchObject({ result: "skipped", why: { code: "queued", jobId: (a as { jobId: string }).jobId } });
  });

  test("a Create job queued by an earlier run blocks the same title (AC-3)", () => {
    store.enqueueCreate({ project: "aide", title: "Wanted", description: "d" });
    leave([{ title: "wanted", description: "d" }]);
    proposeSpecs(deps(), runJob());
    expect(queued()).toHaveLength(1);
    expect(record()!.proposals[0]).toMatchObject({ result: "skipped", why: { code: "queued" } });
  });

  test("an invalid entry is skipped with what is wrong and the rest are still created (AC-3)", () => {
    leave([{ description: "no title" }, { title: "Good", description: "d" }]);
    proposeSpecs(deps(), runJob());
    expect(queued().map((j) => j.createTitle)).toEqual(["Good"]);
    expect(record()!.proposals[0]).toMatchObject({ result: "skipped", why: { code: "invalid", what: "title-missing" } });
  });

  test("a description too long to leave room for the source block is skipped, one that fits is created (AC-3)", () => {
    leave([
      { title: "Too long", description: "x".repeat(5000) },
      { title: "Fits", description: "x".repeat(4500) },
    ]);
    proposeSpecs(deps(), runJob());
    expect(queued().map((j) => j.createTitle)).toEqual(["Fits"]);
    expect(record()!.proposals[0]).toMatchObject({ result: "skipped", why: { code: "invalid", what: "description-long" } });
  });

  test("a refusal from the queue is logged, recorded without its words, and the entries after it are created (AC-3)", () => {
    leave([
      { title: "Has\u0007control", description: "d" },
      { title: "After", description: "d" },
    ]);
    proposeSpecs(deps(), runJob());
    expect(queued().map((j) => j.createTitle)).toEqual(["After"]);
    expect(record()!.proposals[0]).toEqual({ title: "Has\u0007control", result: "skipped", why: { code: "refused" } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("aide/nyhetssjekk");
  });

  test("a file that is not a list writes a record saying so and queues nothing (AC-3)", () => {
    leave("[{ nope");
    proposeSpecs(deps(), runJob());
    expect(queued()).toEqual([]);
    const r = record()!;
    expect(r.problem).toBe("unreadable");
    expect(r.detail?.length).toBeGreaterThan(0);
    expect(r.proposals).toEqual([]);
  });

  test("no specs root, or one that is not a directory, queues nothing and says so (AC-3)", () => {
    leave([{ title: "First", description: "d" }]);
    proposeSpecs(deps({ specsRoot: () => undefined }), runJob());
    expect(record()!.problem).toBe("no-specs-root");
    rmSync(join(outDir(), PROPOSALS_RESULT_FILE));
    proposeSpecs(deps({ specsRoot: () => join(root, "missing") }), runJob());
    expect(record()!.problem).toBe("no-specs-root");
    expect(queued()).toEqual([]);
  });

  test("a store that throws while queuing leaves a record of what was decided and does not throw (AC-3)", () => {
    leave([
      { title: "First", description: "d" },
      { title: "Second", description: "d" },
    ]);
    let calls = 0;
    const throwing = {
      list: () => store.list(),
      enqueueCreate: (raw: unknown) => {
        if (++calls === 2) throw new Error("disk full");
        return store.enqueueCreate(raw);
      },
    };
    expect(() => proposeSpecs(deps({ store: throwing }), runJob())).not.toThrow();
    const r = record()!;
    expect(r.problem).toBe("failed");
    expect(r.detail).toContain("disk full");
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ title: "First", result: "created" });
  });

  test("the only queue write is enqueueCreate, and no other step is queued (AC-7)", () => {
    leave([{ title: "First", description: "d" }]);
    const writes: string[] = [];
    const spy = {
      list: () => store.list(),
      enqueueCreate: (raw: unknown) => {
        writes.push("enqueueCreate");
        return store.enqueueCreate(raw);
      },
    };
    proposeSpecs(deps({ store: spy }), runJob());
    expect(writes).toEqual(["enqueueCreate"]);
    expect(store.list().flatMap((j) => j.steps).filter((s) => s !== "create")).toEqual([]);
  });
});
