import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageUntil, queueHarness, stateSaying, statusSaying } from "../helpers/queue-server.ts";
import { makeSpecsRepo } from "../helpers/specs-repo.ts";
import { specGroup } from "../../src/project/discover/group.ts";

import { QueueStore } from "../../src/queue/queue.ts";
import { handleJobActionRoutes } from "../../src/serve/routes/job-actions.ts";
import { takeLandingCancel } from "../../src/serve/land-branch/cancel-landing.ts";

const harness = queueHarness("aide-execution-group-routes-");
afterEach(() => harness.cleanup());

const description = (folder: string) => `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n`;

describe("execution-group HTTP routes", () => {
  test("Run writes every submitted choice to every member and leaves other choices alone (AC-1, AC-3, AC-5)", async () => {
    const pendingModelsPath = join(mkdtempSync(join(tmpdir(), "aide-group-picks-")), "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({
      "aide/81-queue-and-runner": { archive: "sonnet", "plan-review": "opus" },
      "aide/82-next": { archive: "sonnet", "plan-review": "opus", review: "sonnet" },
    }));
    const { base, dir } = harness.start({
      description: description("81-queue-and-runner"), alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
      extra: { pendingModelsPath, queueDefaults: {
        timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" },
        modelChoices: { sonnet: {}, fable: {}, opus: {} },
        providers: { Claude: { name: "Claude", tool: "claude" } },
      } },
    });
    makeSpecsRepo(dir);
    const response = await fetch(`${base}/api/queue`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=Release&member=82-next&steps=analyze&steps=implement&model.analyze=fable&provider.analyze=Claude&model.implement=opus&provider.implement=Claude&model.plan-review=sonnet&provider.plan-review=Claude&model.verify=fable&provider.verify=Claude",
    });
    expect(response.status).toBe(200);
    const models = JSON.parse(readFileSync(pendingModelsPath, "utf8"));
    const providers = JSON.parse(readFileSync(join(pendingModelsPath, "../pending-providers.json"), "utf8"));
    for (const folder of ["81-queue-and-runner", "82-next"]) {
      expect(models[`aide/${folder}`]).toMatchObject({ analyze: "fable", implement: "opus", "plan-review": "sonnet", verify: "fable", archive: "sonnet" });
      expect(providers[`aide/${folder}`]).toMatchObject({ analyze: "Claude", implement: "Claude", "plan-review": "Claude", verify: "Claude" });
    }
    expect(models["aide/82-next"].review).toBe("sonnet");
  });

  test("Run clears a member's plan review when it follows Analyze (AC-1)", async () => {
    const pendingModelsPath = join(mkdtempSync(join(tmpdir(), "aide-group-plan-review-")), "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ "aide/82-next": { "plan-review": "opus" } }));
    const { base, dir } = harness.start({
      description: description("81-queue-and-runner"), alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
      extra: { pendingModelsPath, queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" }, modelChoices: { sonnet: {}, fable: {}, opus: {} } } },
    });
    makeSpecsRepo(dir);
    const response = await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=Release&member=82-next&steps=analyze&model.analyze=fable&model.plan-review=fable" });
    expect(response.status).toBe(200);
    expect(JSON.parse(readFileSync(pendingModelsPath, "utf8"))["aide/82-next"]["plan-review"]).toBeUndefined();
  });

  test("Start after Stop uses the choices Run wrote to the member row (AC-4)", async () => {
    const pendingModelsPath = join(mkdtempSync(join(tmpdir(), "aide-group-restart-")), "pending-models.json");
    writeFileSync(pendingModelsPath, JSON.stringify({ "aide/81-queue-and-runner": { analyze: "sonnet" } }));
    const { base, dir, server } = harness.start({
      description: description("81-queue-and-runner"), alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
      extra: { pendingModelsPath, queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" }, modelChoices: { sonnet: {}, fable: {} } } },
    });
    makeSpecsRepo(dir);
    await server.settle();
    const run = await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=Release&member=82-next&steps=analyze&model.analyze=fable" });
    const groupId = ((await run.json()) as { job: { executionGroupId: string } }).job.executionGroupId;
    await fetch(`${base}/api/queue/groups/${groupId}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
    const start = await fetch(`${base}/api/queue/groups/${groupId}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }) });
    expect(await start.json()).toMatchObject({ ok: true, job: { model: { analyze: "fable" } } });
  });

  test("Run creates and starts a group with the submitted choices (A810 AC-3, A810 AC-8)", async () => {
    const { base, dir } = harness.start({
      description: description("81-queue-and-runner"),
      alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
      extra: { queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, modelChoices: { sonnet: {}, fable: {} } } },
    });
    makeSpecsRepo(dir);
    const response = await fetch(`${base}/api/queue`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=+Shared+utilities+&member=82-next&position=1&steps=analyze&steps=implement&steps=archive&model.analyze=fable&model.archive=fable",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      job: {
        specFolder: "81-queue-and-runner",
        steps: ["analyze", "implement"],
        model: { analyze: "fable" },
        executionGroupId: expect.any(String),
      },
    });
    expect(JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf8"))[0]).toMatchObject({ archiveModel: "fable" });
    expect(specGroup(join(dir, "root/aide/specs/81-queue-and-runner"))).toEqual({ name: "Shared utilities", position: 1 });
    expect(specGroup(join(dir, "root/aide/specs/82-next"))).toEqual({ name: "Shared utilities", position: 2 });
  });

  test("Run refuses a missing or blank group name before creating a group or job", async () => {
    const { base, dir } = harness.start({ description: description("81-queue-and-runner"), alsoSpecs: ["82-next"], alsoDescriptions: { "82-next": description("82-next") } });
    for (const name of ["", "&groupName=+++"]) {
      const response = await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `project=aide&specFolder=81-queue-and-runner&member=82-next&steps=analyze${name}` });
      expect(response.status).toBe(400);
      expect(specGroup(join(dir, "root/aide/specs/81-queue-and-runner"))).toBeUndefined();
      expect((await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] }).jobs).toEqual([]);
    }
  });

  test("a refused Run leaves every member's choices unchanged (AC-6)", async () => {
    const pendingModelsPath = join(mkdtempSync(join(tmpdir(), "aide-group-refused-")), "pending-models.json");
    const seeded = { "aide/81-queue-and-runner": { analyze: "sonnet" }, "aide/82-next": { analyze: "opus" } };
    writeFileSync(pendingModelsPath, JSON.stringify(seeded));
    const { base, dir } = harness.start({
      description: description("81-queue-and-runner"), alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") },
      extra: { pendingModelsPath, queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" },
        model: { default: "sonnet" }, modelChoices: { sonnet: {}, opus: {} } } },
    });
    makeSpecsRepo(dir);
    const response = await fetch(`${base}/api/queue`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=Release&member=82-next&steps=analyze&model.analyze=unknown" });
    expect(response.status).toBe(400);
    expect(JSON.parse(readFileSync(pendingModelsPath, "utf8"))).toEqual(seeded);

    const cycleModelsPath = join(mkdtempSync(join(tmpdir(), "aide-group-cycle-")), "pending-models.json");
    writeFileSync(cycleModelsPath, JSON.stringify(seeded));
    const cycle = harness.start({
      description: description("81-queue-and-runner") + "- **Depends on:** `82-next`\n", alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": description("82-next") + "- **Depends on:** `81-queue-and-runner`\n" },
      extra: { pendingModelsPath: cycleModelsPath },
    });
    makeSpecsRepo(cycle.dir);
    const cycleResponse = await fetch(`${cycle.base}/api/queue`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "project=aide&specFolder=81-queue-and-runner&groupName=Release&member=82-next&steps=analyze" });
    expect(cycleResponse.status).toBe(409);
    expect(JSON.parse(readFileSync(cycleModelsPath, "utf8"))).toEqual(seeded);
  });

  test("Run starts a required peer first with the submitted choices and refuses a cycle", async () => {
    for (const cycle of [false, true]) {
      const first = "81-queue-and-runner", second = "82-next";
      const { base, dir } = harness.start({
        description: description(first) + `- **Depends on:** \`${second}\`\n`,
        alsoSpecs: [second],
        alsoDescriptions: { [second]: description(second) + (cycle ? `- **Depends on:** \`${first}\`\n` : "") },
        extra: { queueDefaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" }, modelChoices: { sonnet: {}, fable: {} } } },
      });
      makeSpecsRepo(dir);
      const response = await fetch(`${base}/api/queue`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `project=aide&specFolder=${first}&groupName=Release&member=${second}&steps=analyze&steps=implement&model.analyze=fable`,
      });
      if (cycle) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("circular dependencies") });
        const queue = await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] };
        expect(queue.jobs).toEqual([]);
      } else {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ job: {
          specFolder: second, steps: ["analyze", "implement"], model: { analyze: "fable" },
        } });
      }
    }
  });

  test("create and lifecycle action keep their JSON response forms (AC-2)", async () => {
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
    await actionServer.server.settle();
    const action = await fetch(`${actionServer.base}/api/queue/groups/group-1/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(action.status).toBe(200);
    expect(await action.json()).toMatchObject({ ok: true, job: { specFolder: "81-queue-and-runner" } });
  });

  test("Start runs the steps the member's row has ticked, and no Analyze it has done", async () => {
    const grouped = (folder: string, position: number) =>
      `${description(folder)}- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
    const group = {
      id: "group-1", project: "aide", name: "Release", members: ["81-queue-and-runner", "82-next"],
      branch: "aide/group-81-queue-and-runner-release", state: "prepared" as const,
      createdAt: "2026-11-11T10:00:00Z", completedMembers: [], jobs: [],
    };
    const ticks = mkdtempSync(join(tmpdir(), "aide-group-ticks-"));
    const start = async (pending: Record<string, string[]>) => {
      const pendingStepsPath = join(ticks, `${Object.keys(pending).length}.json`);
      writeFileSync(pendingStepsPath, JSON.stringify(pending));
      const { base, server } = harness.start({
        description: grouped("81-queue-and-runner", 1),
        status: statusSaying(["create", "analyze"]),
        liveState: stateSaying(["create", "analyze"]),
        alsoSpecs: ["82-next"],
        alsoDescriptions: { "82-next": grouped("82-next", 2) },
        executionGroups: [group],
        extra: { pendingStepsPath },
      });
      await server.settle();
      // The Active row means the specs scan has read 81. Group membership
      // removes its individual Run form, including its phase checkboxes.
      await pageUntil(base, "/specs?rows=1",
        (html) => html.includes("81-queue-and-runner") && html.includes(">Active<"));
      const action = await fetch(`${base}/api/queue/groups/group-1/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      return ((await action.json()) as { job: { specFolder: string; steps: string[] } }).job;
    };
    expect(await start({})).toMatchObject({ specFolder: "81-queue-and-runner", steps: ["implement"] });
    expect(await start({ "aide/81-queue-and-runner": ["implement"] })).toMatchObject({ steps: ["implement"] });
    rmSync(ticks, { recursive: true, force: true });
  });

  test("Start before the board's first specs sweep queues nothing and says to press again; after it, Start skips the done Analyze (AC-1, AC-3, AC-5)", async () => {
    const grouped = (folder: string, position: number) =>
      `${description(folder)}- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
    const { base, dir, server } = harness.start({
      description: grouped("81-queue-and-runner", 1),
      status: statusSaying(["create", "analyze"]),
      liveState: stateSaying(["create", "analyze"]),
      alsoSpecs: ["82-next"],
      alsoDescriptions: { "82-next": grouped("82-next", 2) },
      executionGroups: [{
        id: "group-1", project: "aide", name: "Release", members: ["81-queue-and-runner", "82-next"],
        branch: "aide/group-81-queue-and-runner-release", state: "prepared",
        createdAt: "2026-11-11T10:00:00Z", completedMembers: [], jobs: [],
      }],
      extra: { specCachePollMs: 0 },
    });
    const start = () => fetch(`${base}/api/queue/groups/group-1/action`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }),
    });
    const refused = await start();
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "The board is still reading the specs: press Start again in a moment." });
    expect((await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] }).jobs).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf8"))[0]).toMatchObject({ state: "prepared" });
    await server.settle();
    const started = await start();
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ job: { specFolder: "81-queue-and-runner", steps: ["implement"] } });
  });

  test("Start orders changed dependencies before queuing and refuses cycles without a job", async () => {
    const first = "81-queue-and-runner", second = "82-next";
    for (const cycle of [false, true]) {
      const grouped = (folder: string, position: number, dependency?: string) =>
        `${description(folder)}- **Group:** \`Release\`\n- **Group position:** ${position}\n${dependency ? `- **Depends on:** \`${dependency}\`\n` : ""}`;
      const { base, dir, server } = harness.start({
        description: grouped(first, 1, second), alsoSpecs: [second],
        alsoDescriptions: { [second]: grouped(second, 2, cycle ? first : undefined) },
        executionGroups: [{ id: "group-1", project: "aide", name: "Release", members: [first, second],
          branch: "aide/group-81", state: "prepared", createdAt: "2026-11-11T10:00:00Z", completedMembers: [], jobs: [] }],
      });
      makeSpecsRepo(dir);
      await server.settle();
      const response = await fetch(`${base}/api/queue/groups/group-1/action`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start" }),
      });
      if (cycle) {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining("circular dependencies") });
        const queue = await (await fetch(`${base}/api/queue`)).json() as { jobs: unknown[] };
        expect(queue.jobs).toEqual([]);
      } else {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ job: { specFolder: second } });
      }
    }
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

test("Stop cancels both a member's landing and the next member's queued job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aide-group-stop-"));
  try {
    const queue = new QueueStore({ mirrorPath: join(dir, "queue.json"),
      defaults: { timeoutSec: { default: 1200 }, permissionMode: { default: "acceptEdits" }, model: { default: "sonnet" } },
      resolve: () => ({ specFolders: ["81-first", "82-next"] }) });
    const group = queue.executionGroups.prepare({ project: "aide", name: "Release", members: ["81-first", "82-next"], branch: "aide/group-release" });
    const first = queue.enqueue({ project: "aide", specFolder: "81-first", steps: ["archive"], executionGroupId: group.id });
    const next = queue.enqueue({ project: "aide", specFolder: "82-next", steps: ["analyze"], executionGroupId: group.id });
    if (!first.ok || !next.ok) throw new Error("fixture jobs refused");
    queue.update(first.job.id, { state: "done", landing: true });
    queue.executionGroups.update(group.id, { state: "running", jobs: [{ id: first.job.id, specFolder: "81-first", logs: [] }, { id: next.job.id, specFolder: "82-next", logs: [] }] });
    const path = `/api/queue/groups/${group.id}/action`;
    const response = await handleJobActionRoutes({ queue,
      targets: () => group.members.map((specFolder, i) => ({ project: "aide", specFolder, group: { name: "Release", position: i + 1 } })),
      withFreshness: (targets: unknown) => targets, specRef: () => undefined,
    } as unknown as Parameters<typeof handleJobActionRoutes>[0],
      new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) }), path);
    expect(response?.status).toBe(200);
    expect(queue.list().some((job) => job.id === next.job.id && job.state === "queued")).toBe(false);
    expect(takeLandingCancel(first.job.id)).toBe(true);
    expect(queue.executionGroups.get(group.id)).toMatchObject({ state: "stopped", stoppedByUser: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
