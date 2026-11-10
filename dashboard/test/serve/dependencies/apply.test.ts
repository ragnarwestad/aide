import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOverlapDependencies } from "../../../src/serve/dependencies";
import { createRootLock } from "../../../src/serve/serve-helpers/config.ts";
import type { RoutesContext } from "../../../src/serve/routes";
import type { Job } from "../../../src/queue/queue.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const description = (deps: string[] = []) => `# X\n\n## Tracking info\n\n- **Created:** now\n${deps.length ? `- **Depends on:** ${deps.map((d) => `\`${d}\``).join(", ")}\n` : ""}`;
const setup = (dependencies: Record<string, string[]> = { "1-a": [], "2-b": [] }) => {
  const dir = mkdtempSync(join(tmpdir(), "aide-auto-deps-")); dirs.push(dir);
  const origin = join(dir, "origin.git"), code = join(dir, "code");
  const git = (cwd: string, ...args: string[]) => {
    const out = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { cwd });
    if (out.exitCode) throw new Error(out.stderr.toString());
    return out.stdout.toString().trim();
  };
  git(dir, "init", "--bare", "--initial-branch=main", origin);
  git(dir, "clone", origin, code);
  const specs = join(code, "aide");
  for (const [folder, deps] of Object.entries(dependencies)) {
    mkdirSync(join(specs, folder), { recursive: true });
    writeFileSync(join(specs, folder, "1-description.md"), description(deps));
  }
  git(code, "add", "aide"); git(code, "commit", "-m", "Seed specs"); git(code, "push", "origin", "main");
  const job = { id: "old", project: "aide", specFolder: "1-a", state: "stopped", stopReason: "shared-files",
    steps: ["analyze", "implement", "archive"], stepIndex: 0, model: { analyze: "opus" }, results: [],
  } as unknown as Job;
  const jobs = new Map([[job.id, job]]);
  const queued: Record<string, unknown>[] = [];
  const ctx = {
    gitRun: async (cwd: string, args: string[]) => {
      const out = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], { cwd });
      return { code: out.exitCode, stdout: out.stdout.toString(), stderr: out.stderr.toString() };
    },
    mergeLock: createRootLock(), branchStatus: { defaultBranch: async () => "main", openSpecBranches: async () => new Set() },
    specDir: (_project: string, folder: string) => join(specs, folder),
    machinerySpecDir: async (_project: string, folder: string) => folder,
    specsRoot: async () => code, rereadProject: async () => {}, invalidateScan: () => {}, tickRunner: async () => {},
    queue: {
      list: () => [...jobs.values()], get: (id: string) => jobs.get(id),
      update: (id: string, patch: Partial<Job>) => Object.assign(jobs.get(id)!, patch),
      transition: (id: string, event: string, patch: Partial<Job>) => {
        const found = jobs.get(id)!;
        if (event !== "retry-late" || found.state !== "stopped") return { ok: false, state: found.state, event };
        Object.assign(found, patch, { state: "queued" });
        return { ok: true, job: found };
      },
      enqueue: (request: Record<string, unknown>) => {
        queued.push(request); const next = { ...job, ...request, id: `new-${queued.length}`, state: "queued" } as Job;
        jobs.set(next.id, next); return { ok: true, job: next };
      },
    },
  } as unknown as RoutesContext;
  return { dir, code, specs, git, job, jobs, queued, ctx };
};
const outcome = { sharedFiles: [{ spec: "2-b", files: ["shared.ts"], reason: "the result contract must be updated first" }] };

test("saves the dependency and queues the remaining steps with an informational explanation", async () => {
  const h = setup();
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toContain("`2-b`");
  expect(h.git(h.code, "log", "-1", "--pretty=%s")).toBe("Add dependencies for 1-a");
  expect(h.queued[0]).toMatchObject({ project: "aide", specFolder: "1-a", steps: ["analyze", "implement", "archive"], model: { analyze: "opus" } });
  expect(h.jobs.get("new-1")?.dependencyNotice).toMatchObject({ key: "runner.dependenciesAdded" });
});

test("rejects a complete batch on a transitive cycle and leaves git unchanged", async () => {
  const h = setup({ "1-a": [], "2-b": ["3"], "3-c": ["1"], "4-d": [] });
  const before = h.git(h.code, "rev-parse", "HEAD");
  await applyOverlapDependencies(h.ctx, h.job, { sharedFiles: [
    { spec: "4-d", files: ["x.ts"], reason: "its API is needed" }, ...outcome.sharedFiles,
  ] });
  expect(h.git(h.code, "rev-parse", "HEAD")).toBe(before);
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toBe(description());
  expect(h.queued).toEqual([]);
  expect(h.job.error).toEqual({ key: "runner.dependencyCycle", values: { chain: "aide:1 → aide:2 → aide:3 → aide:1" } });
});

test("unreviewed file overlap queues analyze once more with evidence (AC-4, AC-9, AC-11)", async () => {
  const h = setup();
  await applyOverlapDependencies(h.ctx, h.job, { sharedFiles: [{ spec: "2-b", files: ["shared.ts"] }] });
  expect(h.queued).toEqual([]);
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toBe(description());
  expect(h.job).toMatchObject({ state: "queued", retry: {
    action: "analyze", attempts: 2,
    previousAttempt: { terminalReason: "overlap-decision-missing", detail: "2-b: shared.ts" },
  } });
});

test("a repeated missing overlap assessment says Analyze ran twice and does not offer the same press (AC-8, AC-9)", async () => {
  const h = setup();
  h.job.retry = {
    action: "analyze", attempts: 2,
    previousAttempt: { terminalReason: "overlap-decision-missing" },
  };
  await applyOverlapDependencies(h.ctx, h.job, { sharedFiles: [{ spec: "2-b", files: ["shared.ts"] }] });
  expect(h.job.error).toMatchObject({
    key: "runner.afterTwoAttempts",
    inner: { key: "runner.overlapDecisionMissing" },
  });
  expect(h.job.state).toBe("stopped");
});

test("the explanation includes the target and reason, and a repeated callback creates no second job", async () => {
  const h = setup();
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(h.queued).toHaveLength(1);
  expect(h.jobs.get("new-1")?.dependencyNotice).toEqual({ key: "runner.dependenciesAdded", values: {
    dependencies: ["aide:2 — the result contract must be updated first"],
  } });
});

test("simultaneous reverse requests cannot add a cycle", async () => {
  const h = setup();
  const second = { ...h.job, id: "second", specFolder: "2-b" };
  h.jobs.set(second.id, second);
  await Promise.all([
    applyOverlapDependencies(h.ctx, h.job, outcome),
    applyOverlapDependencies(h.ctx, second, { sharedFiles: [{ spec: "1-a", files: ["x.ts"], reason: "requires its API" }] }),
  ]);
  expect(h.queued).toHaveLength(1);
  expect(readFileSync(join(h.specs, "2-b", "1-description.md"), "utf8")).toBe(description());
  expect(second.error).toMatchObject({ key: "runner.dependencyCycle" });
});

test("checks the graph after pulling new dependency edits from origin", async () => {
  const h = setup();
  const run = h.ctx.gitRun;
  let changed = false;
  h.ctx.gitRun = async (cwd, args) => {
    if (!changed && args[0] === "fetch") {
      changed = true;
      const writer = join(h.dir, "writer");
      h.git(h.dir, "clone", join(h.dir, "origin.git"), writer);
      writeFileSync(join(writer, "aide", "2-b", "1-description.md"), description(["1"]));
      h.git(writer, "add", "aide"); h.git(writer, "commit", "-m", "Edit dependencies elsewhere"); h.git(writer, "push", "origin", "main");
    }
    return run(cwd, args);
  };
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(h.queued).toEqual([]);
  expect(h.job.error).toMatchObject({ key: "runner.dependencyCycle" });
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toBe(description());
});

test("includes dependency edits on another spec's open branch", async () => {
  const h = setup();
  h.git(h.code, "checkout", "-b", "aide/2-b");
  writeFileSync(join(h.specs, "2-b", "1-description.md"), description(["1"]));
  h.git(h.code, "add", "aide"); h.git(h.code, "commit", "-m", "Edit dependencies on a branch");
  h.git(h.code, "push", "origin", "aide/2-b"); h.git(h.code, "checkout", "main");
  h.ctx.branchStatus.openSpecBranches = async () => new Set(["aide/2-b"]);
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(h.queued).toEqual([]);
  expect(h.job.error).toMatchObject({ key: "runner.dependencyCycle" });
});

test("a refused push restores the description and queues nothing", async () => {
  const h = setup();
  const before = h.git(h.code, "rev-parse", "HEAD");
  const run = h.ctx.gitRun;
  h.ctx.gitRun = (cwd, args) => args[0] === "push"
    ? Promise.resolve({ code: 1, stdout: "", stderr: "push refused" }) : run(cwd, args);
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(h.git(h.code, "rev-parse", "HEAD")).toBe(before);
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toBe(description());
  expect(h.queued).toEqual([]);
  expect(h.job.error).toMatchObject({ key: "runner.autoDependenciesFailed" });
});

test("a saved dependency is explained even when the follow-up cannot be queued", async () => {
  const h = setup();
  h.ctx.queue.enqueue = () => ({ ok: false, error: "queue unavailable" });
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toContain("`2-b`");
  expect(h.job.dependencyNotice).toMatchObject({ key: "runner.dependenciesAdded" });
  expect(h.job.error).toMatchObject({ key: "runner.autoDependenciesFailed" });
});

test("an older open branch cannot hide a dependency already added on main", async () => {
  const h = setup();
  h.git(h.code, "checkout", "-b", "aide/1-a");
  h.git(h.code, "push", "origin", "aide/1-a"); h.git(h.code, "checkout", "main");
  writeFileSync(join(h.specs, "1-a", "1-description.md"), description(["2-b"]));
  h.git(h.code, "add", "aide"); h.git(h.code, "commit", "-m", "Add a dependency on main"); h.git(h.code, "push", "origin", "main");
  h.ctx.branchStatus.openSpecBranches = async () => new Set(["aide/1-a"]);
  const second = { ...h.job, id: "second", specFolder: "2-b" };
  h.jobs.set(second.id, second);
  await applyOverlapDependencies(h.ctx, second, { sharedFiles: [{ spec: "1-a", files: ["x.ts"], reason: "requires its API" }] });
  expect(h.queued).toEqual([]);
  expect(second.error).toMatchObject({ key: "runner.dependencyCycle" });
});

test("a dependency whose archive is landing counts as archived, though its open branch has moved its folder", async () => {
  const h = setup();
  // 2-b's archive step has moved its folder under archive/ on its own branch; main still has it open.
  h.git(h.code, "switch", "-q", "-c", "aide/2-b");
  mkdirSync(join(h.specs, "archive"), { recursive: true });
  h.git(h.code, "mv", join("aide", "2-b"), join("aide", "archive", "2-b"));
  h.git(h.code, "commit", "-qm", "Archive 2-b"); h.git(h.code, "push", "-q", "origin", "aide/2-b");
  h.git(h.code, "switch", "-q", "main");
  (h.ctx as unknown as { branchStatus: { openSpecBranches: () => Promise<Set<string>> } }).branchStatus.openSpecBranches =
    async () => new Set(["aide/2-b"]);
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(h.job.error).toBeUndefined();
  expect(readFileSync(join(h.specs, "1-a", "1-description.md"), "utf8")).toContain("`2-b`");
});

test("the job is marked landing while the dependency line is saved, and no longer when its follow-on job is queued (AC-6)", async () => {
  const h = setup();
  const seen: { during?: boolean; atEnqueue?: boolean } = {};
  const run = h.ctx.gitRun;
  h.ctx.gitRun = (cwd, args) => {
    if (args[0] === "push") seen.during = h.job.landing;
    return run(cwd, args);
  };
  const enqueue = h.ctx.queue.enqueue.bind(h.ctx.queue);
  h.ctx.queue.enqueue = ((request: Parameters<typeof enqueue>[0]) => {
    seen.atEnqueue = h.job.landing;
    return enqueue(request);
  }) as typeof enqueue;
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(seen).toEqual({ during: true, atEnqueue: undefined });
  expect(h.queued).toHaveLength(1);
  expect(h.job.landing).toBeUndefined();
});

test("a refused save clears the landing mark and queues nothing (AC-6)", async () => {
  const h = setup();
  let during: boolean | undefined;
  const run = h.ctx.gitRun;
  h.ctx.gitRun = (cwd, args) => {
    if (args[0] === "push") {
      during = h.job.landing;
      return Promise.resolve({ code: 1, stdout: "", stderr: "push refused" });
    }
    return run(cwd, args);
  };
  await applyOverlapDependencies(h.ctx, h.job, outcome);
  expect(during).toBe(true);
  expect(h.queued).toEqual([]);
  expect(h.job.landing).toBeUndefined();
});
