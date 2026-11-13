import { afterEach, expect, test } from "bun:test";
import { executionGroupAction } from "../../../src/queue/execution-groups";
import { queueHarness } from "../../helpers/queue-server.ts";

const member = (patch = {}) => ({ implemented: false, archived: false, acceptanceOpen: false, busy: false, ...patch });
const harness = queueHarness("aide-execution-group-actions-");
afterEach(() => harness.cleanup());

test("prepared and stopped groups can start only their next member (AC-6)", () => {
  expect(executionGroupAction({ state: "prepared" }, [member(), member()])).toBe("start");
  expect(executionGroupAction({ state: "stopped" }, [member({ implemented: true }), member()])).toBe("start");
});

test("queued and running groups offer Stop instead of Start (AC-7, AC-8)", () => {
  expect(executionGroupAction({ state: "queued" }, [member()])).toBe("stop");
  expect(executionGroupAction({ state: "running" }, [member({ busy: true })])).toBe("stop");
});

test("Archive requires every member to be implemented accepted and idle (AC-9)", () => {
  expect(executionGroupAction({ state: "waiting-acceptance" }, [member({ implemented: true })])).toBe("archive");
  expect(executionGroupAction({ state: "waiting-acceptance" }, [member({ implemented: true, acceptanceOpen: true })])).toBeUndefined();
});

test("a completed group's one action is Remove (AC-1)", () => {
  expect(executionGroupAction({ state: "completed" }, [member({ implemented: true, archived: true })])).toBe("remove");
  expect(executionGroupAction({ state: "completed" }, [])).toBe("remove");
});

test("no state but completed answers Remove (AC-2)", () => {
  for (const state of ["prepared", "queued", "running", "stopped", "waiting-acceptance", "archiving"] as const) {
    expect(executionGroupAction({ state }, [member(), member()])).not.toBe("remove");
    expect(executionGroupAction({ state }, [member({ implemented: true })])).not.toBe("remove");
    expect(executionGroupAction({ state }, [member({ implemented: true, archived: true })])).not.toBe("remove");
  }
});

test("legacy membership becomes one prepared Running card without a registry record (AC-4)", async () => {
  const description = (folder: string, position: number) =>
    `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** ${position}\n`;
  const { base } = harness.start({
    description: description("81-queue-and-runner", 2),
    alsoSpecs: ["82-first"],
    alsoDescriptions: { "82-first": description("82-first", 1) },
  });
  const html = await (await fetch(`${base}/?rows=1`)).text();
  expect(html.match(/data-spec-group="aide\nRelease"/g)).toHaveLength(1);
  expect(html).toContain('name="action" value="start"');
});

test("a failed member keeps its execution card in the Failed filter (AC-4, AC-11)", async () => {
  const description = `# Queue\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Release\`\n- **Group position:** 1\n`;
  const failed = {
    id: "j1", project: "aide", specFolder: "81-queue-and-runner", steps: ["analyze"], stepIndex: 0,
    state: "failed", timeoutSec: {}, permissionMode: {}, model: {}, results: [], executionGroupId: "group-1",
    createdAt: "2026-11-11T10:00:00Z", startedAt: "2026-11-11T10:30:00Z", finishedAt: "2026-11-11T12:00:00Z",
  };
  const { base } = harness.start({
    description,
    queueMirror: JSON.stringify([failed]),
    executionGroups: [{
      id: "group-1", project: "aide", name: "Release", members: ["81-queue-and-runner"], branch: "aide/group-81",
      state: "stopped", createdAt: "2026-11-11T10:00:00Z", startedAt: "2026-11-11T10:30:00Z",
      completedMembers: [], jobs: [],
    }],
  });
  const html = await (await fetch(`${base}/?rows=1&state=failed`)).text();
  expect(html).toContain('data-spec-group="aide\nRelease"');
});

test("archived specs that share a group name with no record draw no card", async () => {
  const description = (folder: string, position: number) =>
    `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n- **Group:** \`Old\`\n- **Group position:** ${position}\n`;
  const done = (specFolder: string) => ({
    id: `j-${specFolder}`, project: "aide", specFolder, steps: ["archive"], stepIndex: 0, state: "done",
    timeoutSec: {}, permissionMode: {}, model: {}, results: [],
    createdAt: "2026-11-11T10:00:00Z", startedAt: "2026-11-11T10:30:00Z", finishedAt: "2026-11-11T11:00:00Z",
  });
  const { base } = harness.start({
    archivedSpecs: { "01-first": { description: description("01-first", 1) }, "02-second": { description: description("02-second", 2) } },
    queueMirror: JSON.stringify([done("01-first"), done("02-second")]),
  });
  const html = await (await fetch(`${base}/?rows=1`)).text();
  expect(html).toContain("01-first");
  expect(html).not.toContain('data-spec-group="aide\nOld"');
});
