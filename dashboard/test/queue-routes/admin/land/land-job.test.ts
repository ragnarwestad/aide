import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QueueStore } from "../../../../src/queue/store/index.ts";
import { handleLandSteps } from "../../../../src/serve/routes/land/index.ts";

function context(found: boolean) {
  const dir = mkdtempSync(join(tmpdir(), "aide-land-route-"));
  const queue = new QueueStore({
    mirrorPath: join(dir, "queue.json"),
    defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
    resolve: (project: string) => project === "aide" ? { specFolders: [] } : null,
  });
  const ctx = {
    allowed: new Set(["aide"]),
    opts: { projectRoot: join(dir, "projects") },
    queue,
    machineryProjectDir: (project: string) => join(dir, "projects", project),
    branchStatus: { defaultBranch: async () => "main" },
    gitRun: async (_dir: string, _args: string[]) => ({ code: found ? 0 : 2, stdout: found ? "abc\trefs/heads/topic\n" : "", stderr: "" }),
    tickRunner: async () => {},
  };
  return { ctx, queue, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("POST /api/queue/projects/:project/land", () => {
  test("queues the exact origin branch and answers that it is queued (AC-1)", async () => {
    const { ctx, queue, cleanup } = context(true);
    try {
      const req = new Request("http://board/api/queue/projects/aide/land", {
        method: "POST", body: JSON.stringify({ branch: "topic" }),
      });
      const res = await handleLandSteps(ctx as never, req, "/api/queue/projects/aide/land");
      expect(res?.status).toBe(200);
      expect(await res?.json()).toMatchObject({ ok: true, message: "Queued Merge for topic in aide." });
      expect(queue.list()).toHaveLength(1);
      expect(queue.list()[0]).toMatchObject({ project: "aide", specFolder: "land", branch: "topic", steps: ["land"] });
    } finally { cleanup(); }
  });

  test("names a branch absent from origin and queues nothing (AC-2)", async () => {
    const { ctx, queue, cleanup } = context(false);
    try {
      const req = new Request("http://board/api/queue/projects/aide/land", {
        method: "POST", body: JSON.stringify({ branch: "missing" }),
      });
      const res = await handleLandSteps(ctx as never, req, "/api/queue/projects/aide/land");
      expect(res?.status).toBe(400);
      expect(String((await res?.json()).error)).toContain("origin has no branch named missing");
      expect(queue.list()).toEqual([]);
    } finally { cleanup(); }
  });
});

for (const state of ["queued", "running", "done"] as const) {
  test(`a different branch can queue behind a ${state} Land`, async () => {
    const { ctx, queue, cleanup } = context(true);
    try {
      const first = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "first" });
      if (!first.ok) throw new Error(first.error);
      queue.update(first.job.id, { state, landing: state !== "queued" });
      const res = await handleLandSteps(ctx as never, new Request("http://board/api/queue/projects/aide/land", {
        method: "POST", body: JSON.stringify({ branch: "second" }),
      }), "/api/queue/projects/aide/land");
      expect(res?.status).toBe(200);
      expect(queue.list().map((job) => job.branch).sort()).toEqual(["first", "second"]);
      for (const branch of ["first", "second"]) {
        const duplicate = await handleLandSteps(ctx as never, new Request("http://board/api/queue/projects/aide/land", {
          method: "POST", body: JSON.stringify({ branch }),
        }), "/api/queue/projects/aide/land");
        expect(duplicate?.status).toBe(400);
        expect(queue.list()).toHaveLength(2);
      }
    } finally { cleanup(); }
  });
}


test("Merge retries a cancelled job with the same branch and kind (AC-1)", async () => {
  const { ctx, queue, cleanup } = context(true);
  try {
    const old = queue.enqueue({ project: "aide", specFolder: "land", steps: ["land"], branch: "topic" });
    if (!old.ok) throw new Error(old.error);
    queue.update(old.job.id, { state: "cancelled" });
    const res = await handleLandSteps(ctx as never, new Request("http://board/api/queue/projects/aide/land", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ branch: "topic" }),
    }), "/api/queue/projects/aide/land");
    expect(res?.status).toBe(200);
    expect(queue.get(old.job.id)?.state).toBe("cancelled");
    const fresh = queue.list().find((job) => job.id !== old.job.id)!;
    expect(fresh).toMatchObject({ state: "queued", branch: "topic", steps: ["land"] });
  } finally { cleanup(); }
});

describe("the checkout aide merge was run in", () => {
  /** git as the route asks it: `given` is a repository whose origin is
   *  `theirs`; the project's own origin is the board's. */
  function asking(given: string, theirs: string) {
    const { ctx, queue, cleanup } = context(true);
    ctx.gitRun = async (dir: string, args: string[]) => {
      if (args[0] === "rev-parse") return { code: 0, stdout: `${given}/.git\n`, stderr: "" };
      if (args.join(" ") === "remote get-url origin") {
        return { code: 0, stdout: `${dir === given ? theirs : "git@example.com:me/aide.git"}\n`, stderr: "" };
      }
      return { code: 0, stdout: "abc\trefs/heads/topic\n", stderr: "" };
    };
    return { ctx, queue, cleanup };
  }
  const post = (ctx: unknown, checkout: string) => handleLandSteps(ctx as never, new Request("http://board/api/queue/projects/aide/land", {
    method: "POST", body: JSON.stringify({ branch: "topic", checkout }),
  }), "/api/queue/projects/aide/land");

  test("is kept on the job when it is a clone of the project's origin", async () => {
    const given = mkdtempSync(join(tmpdir(), "aide-land-from-"));
    const { ctx, queue, cleanup } = asking(given, "git@example.com:me/aide.git");
    try {
      expect((await post(ctx, given))?.status).toBe(200);
      expect(queue.list()[0]?.landFrom).toBe(given);
    } finally { cleanup(); rmSync(given, { recursive: true, force: true }); }
  });

  test("is ignored when it is a clone of something else", async () => {
    const given = mkdtempSync(join(tmpdir(), "aide-land-from-"));
    const { ctx, queue, cleanup } = asking(given, "git@example.com:me/other.git");
    try {
      expect((await post(ctx, given))?.status).toBe(200);
      expect(queue.list()[0]?.landFrom).toBeUndefined();
    } finally { cleanup(); rmSync(given, { recursive: true, force: true }); }
  });
});
