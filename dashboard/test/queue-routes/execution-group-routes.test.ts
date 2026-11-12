import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-execution-group-routes-");
afterEach(() => harness.cleanup());

const description = (folder: string) => `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n`;

const git = (cwd: string, ...args: string[]): void => {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
};

const makeSpecsRepo = (dir: string): void => {
  const project = join(dir, "root", "aide");
  const origin = join(dir, "specs-origin.git");
  git(project, "init", "-q", "-b", "main");
  git(project, "config", "user.name", "Test");
  git(project, "config", "user.email", "test@example.com");
  git(project, "add", ".");
  git(project, "commit", "-qm", "initial specs");
  const cloned = Bun.spawnSync(["git", "clone", "-q", "--bare", project, origin]);
  if (cloned.exitCode !== 0) throw new Error(cloned.stderr.toString());
  git(project, "remote", "add", "origin", origin);
  git(project, "fetch", "-q", "origin");
  git(project, "branch", "--set-upstream-to=origin/main", "main");
};

describe("execution-group HTTP routes", () => {
  test("create, edit and lifecycle action keep their JSON response forms (AC-2)", async () => {
    const { base, dir } = harness.start({
      description: description("81-queue-and-runner"),
      alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
    });
    makeSpecsRepo(dir);
    const create = await fetch(`${base}/api/queue/groups`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project: "aide",
        name: "Release",
        member: ["81-queue-and-runner", "82-next"],
        position: [1, 2],
      }),
    });
    expect(create.status).toBe(200);
    const created = await create.json() as { ok: boolean; group: { id: string; members: string[] } };
    expect(created).toMatchObject({ ok: true, group: { members: ["81-queue-and-runner", "82-next"] } });

    const edit = await fetch(`${base}/api/queue/groups/${created.group.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "aide", member: ["82-next", "81-queue-and-runner"], position: [1, 2] }),
    });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toMatchObject({ ok: true, group: { members: ["82-next", "81-queue-and-runner"] } });

    const grouped = (folder: string, position: number) =>
      `${description(folder)}- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
    const actionServer = harness.start({
      description: grouped("81-queue-and-runner", 1),
      alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": grouped("82-next", 2) },
      executionGroups: [{
        id: "group-1",
        project: "aide",
        name: "Release",
        members: ["81-queue-and-runner", "82-next"],
        branch: "aide/group-81-queue-and-runner-release",
        state: "prepared",
        createdAt: "2026-11-11T10:00:00Z",
        completedMembers: [],
        jobs: [],
      }],
    });
    const action = await fetch(`${actionServer.base}/api/queue/groups/group-1/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(action.status).toBe(200);
    expect(await action.json()).toMatchObject({ ok: true, job: { specFolder: "81-queue-and-runner" } });
  });

  test("all recognised group routes refuse GET with the documented response (AC-3)", async () => {
    const { base } = harness.start();
    for (const path of ["/api/queue/groups", "/api/queue/groups/group-1", "/api/queue/groups/group-1/action"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(405);
      expect(await response.text()).toBe("method not allowed");
    }
  });

  test("all group POST routes share the Origin refusal (AC-2)", async () => {
    const { base } = harness.start();
    for (const path of ["/api/queue/groups", "/api/queue/groups/group-1", "/api/queue/groups/group-1/action"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
      });
      expect(response.status).toBe(403);
    }
  });
});
