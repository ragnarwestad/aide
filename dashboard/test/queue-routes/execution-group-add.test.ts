// Add spec on a group's card: the route that writes one more spec's group
// lines at the end of the order and appends it to the group's record.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { queueHarness } from "../helpers/queue-server.ts";
import { makeSpecsRepo } from "../helpers/specs-repo.ts";
import { listUntil, rowSaysDone } from "./fixtures.ts";

const harness = queueHarness("aide-execution-group-add-");
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

const add = (base: string, member: string) =>
  fetch(`${base}/api/queue/groups/group-1/members`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ member }) });
const description = (dir: string, folder: string) => readFileSync(join(dir, "root", "aide", "specs", folder, "1-description.md"), "utf-8");
const stored = (dir: string) => JSON.parse(readFileSync(join(dir, "execution-groups.json"), "utf-8"))[0] as { members: string[]; state: string };

describe("adding a spec to a group that has started", () => {
  test("places it last and leaves the members that have run as they were (AC-3)", async () => {
    const { base, dir } = await groupOfTwo("running");
    const before = [description(dir, FIRST), description(dir, SECOND)];
    const res = await add(base, ADDED);
    expect(res.status).toBe(200);
    expect(description(dir, ADDED)).toContain("- **Group:** `Release`\n- **Group position:** 3\n");
    expect(stored(dir)).toMatchObject({ members: [FIRST, SECOND, ADDED], state: "running" });
    expect([description(dir, FIRST), description(dir, SECOND)]).toEqual(before);
  });

  test("on a queued group, takes the position after the member that was last (AC-4)", async () => {
    const { base, dir } = await groupOfTwo("queued");
    expect((await add(base, ADDED)).status).toBe(200);
    expect(description(dir, ADDED)).toContain("- **Group position:** 3\n");
  });

  test("on a stopped group, Start runs the member before it, and the added spec follows (AC-5)", async () => {
    const { base, dir } = await groupOfTwo("stopped");
    expect((await add(base, ADDED)).status).toBe(200);
    const start = await fetch(`${base}/api/queue/groups/group-1/action`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ action: "start" }) });
    expect(start.status).toBe(200);
    const { job } = await start.json() as { job: { specFolder: string; executionGroupId?: string } };
    expect(job).toMatchObject({ specFolder: SECOND, executionGroupId: "group-1" });
    expect(description(dir, ADDED)).toContain("- **Group position:** 3\n");
  });

  test("is refused, with why and what to do, once every member has finished Implement (AC-6)", async () => {
    const { base, dir } = await groupOfTwo("waiting-acceptance", { implemented: [FIRST, SECOND] });
    const res = await add(base, ADDED);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; solution?: string };
    expect(body.error).toContain("Release");
    expect(body.solution).toBeTruthy();
    expect(description(dir, ADDED)).toBe(plain(ADDED));
    expect(stored(dir).members).toEqual([FIRST, SECOND]);
  });

  test("refuses a spec a member depends on, naming both (AC-2)", async () => {
    const { base, dir } = await groupOfTwo("running", { second: grouped(SECOND, 2, `- **Depends on:** \`${ADDED}\`\n`) });
    const res = await add(base, ADDED);
    expect(res.status).toBe(409);
    const { error } = await res.json() as { error: string };
    expect(error).toContain(SECOND);
    expect(error).toContain(ADDED);
    expect(description(dir, ADDED)).toBe(plain(ADDED));
    expect(stored(dir).members).toEqual([FIRST, SECOND]);
  });
});

test("two adds of one spec at the same moment add it once (AC-3)", async () => {
  const { base, dir } = await groupOfTwo("running");
  const answers = await Promise.all([add(base, ADDED), add(base, ADDED)]);
  expect(answers.map((res) => res.status).sort()).toEqual([200, 409]);
  expect(stored(dir).members).toEqual([FIRST, SECOND, ADDED]);
  expect(description(dir, ADDED).match(/Group position/g)).toHaveLength(1);
});
