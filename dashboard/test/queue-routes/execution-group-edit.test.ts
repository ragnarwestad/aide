// Edit on a group's card: one checked save of its name, members and order.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { makeSpecsRepo } from "../helpers/specs-repo.ts";
import { listUntil, rowSaysDone } from "./fixtures.ts";

const harness = queueHarness("aide-execution-group-edit-");
afterEach(() => harness.cleanup());

const JSON_HEADERS = { "content-type": "application/json" };
const FIRST = "81-queue-and-runner";
const SECOND = "82-next";
const ADDED = "83-added";

const plain = (folder: string, extra = "") => `# ${folder}\n\n## Tracking info\n\n- **Created:** \`2026-11-11\`\n${extra}`;
const grouped = (folder: string, position: number, extra = "") =>
  plain(folder, `- **Group:** \`Release\`\n- **Group position:** ${position}\n${extra}`);
const record = (state: string) => [{
  id: "group-1", project: "aide", name: "Release", members: [FIRST, SECOND],
  branch: `aide/group-${FIRST}-release`, state, createdAt: "2026-11-11T10:00:00Z",
  completedMembers: [FIRST], jobs: [],
}];

const git = (cwd: string, ...args: string[]): void => {
  const out = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
};

/** A specs repository that can save, in which the runner has implemented `implemented`. */
const repoWith = (implemented: string[]) => (dir: string): void => {
  makeSpecsRepo(dir);
  const project = join(dir, "root", "aide");
  for (const folder of implemented) {
    for (const step of ["analyze", "implement"]) git(project, "commit", "-q", "--allow-empty", "-m", `Run /aide-${step} for ${folder} (headless)`);
  }
  git(project, "push", "-q", "origin", "main");
};

/** A group of two, the first through Implement, and a spec in no group. */
async function groupOfTwo(state: string, opts: { implemented?: string[]; second?: string } = {}) {
  const implemented = opts.implemented ?? [FIRST];
  const started = harness.start({
    description: grouped(FIRST, 1),
    alsoSpecs: [SECOND, ADDED],
    alsoDescriptions: { [SECOND]: opts.second ?? grouped(SECOND, 2), [ADDED]: plain(ADDED) },
    executionGroups: record(state),
    before: repoWith(implemented),
  });
  // Every commit is made before the server starts, so the first member's
  // Implement read off git means the others' have been read too.
  await listUntil(started.base, rowSaysDone("implement"), undefined, "81's Implement done");
  return started;
}

const edit = (base: string, members: string[], name = "Release") =>
  fetch(`${base}/api/queue/groups/group-1`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, member: members, position: members.map((_, index) => index + 1) }) });
const description = (dir: string, folder: string) => readFileSync(join(dir, "root", "aide", "specs", folder, "1-description.md"), "utf-8");
const stored = (dir: string) => JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf-8"))[0] as { members: string[]; state: string };

describe("editing a group", () => {
  test("adds and moves unlocked specs while leaving locked files unchanged (AC-5, AC-6, AC-9)", async () => {
    const { base, dir } = await groupOfTwo("running");
    const before = description(dir, FIRST);
    const res = await edit(base, [FIRST, ADDED, SECOND]);
    expect(res.status).toBe(200);
    expect(description(dir, ADDED)).toContain("- **Group:** `Release`\n- **Group position:** 2\n");
    expect(description(dir, SECOND)).toContain("- **Group position:** 3\n");
    expect(stored(dir)).toMatchObject({ members: [FIRST, ADDED, SECOND], state: "running" });
    expect(description(dir, FIRST)).toBe(before);
  });

  test("removes an unlocked spec and strips its group lines (AC-8)", async () => {
    const { base, dir } = await groupOfTwo("stopped");
    expect((await edit(base, [FIRST, ADDED])).status).toBe(200);
    expect(description(dir, SECOND)).not.toContain("Group:");
    expect(stored(dir).members).toEqual([FIRST, ADDED]);
  });

  test("refuses moving a locked spec and writes nothing (AC-4, AC-7)", async () => {
    const { base, dir } = await groupOfTwo("running");
    const before = [description(dir, FIRST), description(dir, SECOND), stored(dir)];
    const res = await edit(base, [SECOND, FIRST]);
    expect(res.status).toBe(409);
    expect([description(dir, FIRST), description(dir, SECOND), stored(dir)]).toEqual(before);
  });

  test("refuses dependency order and leaves the group unchanged (AC-7)", async () => {
    const { base, dir } = await groupOfTwo("running", { second: grouped(SECOND, 2, `- **Depends on:** \`${ADDED}\`\n`) });
    const res = await edit(base, [FIRST, SECOND, ADDED]);
    expect(res.status).toBe(409);
    const { error } = await res.json() as { error: string };
    expect(error).toContain(`${SECOND} depends on ${ADDED}`);
    expect(description(dir, ADDED)).toBe(plain(ADDED));
    expect(stored(dir).members).toEqual([FIRST, SECOND]);
  });

  test("refuses renaming once a member is locked (AC-9)", async () => {
    const { base, dir } = await groupOfTwo("running");
    const res = await edit(base, [FIRST, SECOND], "Renamed");
    expect(res.status).toBe(409);
    expect(description(dir, FIRST)).toContain("`Release`");
    expect(stored(dir).members).toEqual([FIRST, SECOND]);
  });
});
