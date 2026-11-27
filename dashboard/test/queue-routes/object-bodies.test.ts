// Every route that expects an object in its body, posted a JSON body that
// is not one: each answers the shared reader's own 400 and changes
// nothing. And each keeps the size limit it had.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_BODY, MAX_CREATE_BODY, MAX_SAVE_BODY } from "../../src/serve/serve-helpers/config.ts";
import { setupQueueRoutesHarness } from "./fixtures.ts";

const { harness, start } = setupQueueRoutesHarness("aide-object-bodies-");
const ownDirs: string[] = [];
afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const SPEC = "81-queue-and-runner";
const OTHER = "82-other";
const NOT_AN_OBJECT = "the request body is not an object";

/** Each converted JSON route, with the cap it reads its body under. The
 *  job and group paths name the job queued for another spec, so nothing
 *  queued for SPEC stands in front of its own routes. */
const ROUTES: { name: string; path: (job: string) => string; cap: number }[] = [
  { name: "aide-run", path: () => "/api/aide-run", cap: MAX_BODY },
  { name: "create", path: () => "/api/queue/create", cap: MAX_CREATE_BODY },
  { name: "settings", path: () => "/api/queue/settings", cap: MAX_BODY },
  { name: "concurrency", path: () => "/api/queue/settings/concurrency", cap: MAX_BODY },
  { name: "add a model choice", path: () => "/api/queue/settings/models/add", cap: MAX_BODY },
  { name: "remove a model choice", path: () => "/api/queue/settings/models/remove", cap: MAX_BODY },
  { name: "add a provider", path: () => "/api/queue/settings/providers/add", cap: MAX_BODY },
  { name: "edit a provider", path: () => "/api/queue/settings/providers/edit", cap: MAX_BODY },
  { name: "switch a provider", path: () => "/api/queue/settings/providers/switch", cap: MAX_BODY },
  { name: "remove a provider", path: () => "/api/queue/settings/providers/remove", cap: MAX_BODY },
  { name: "add project", path: () => "/api/queue/projects", cap: MAX_BODY },
  { name: "test command", path: () => "/api/queue/projects/test-command", cap: MAX_BODY },
  { name: "project settings", path: () => "/api/queue/projects/aide/settings", cap: MAX_BODY },
  { name: "project models", path: () => "/api/queue/projects/aide/models", cap: MAX_BODY },
  { name: "project merge", path: () => "/api/queue/projects/aide/land", cap: MAX_BODY },
  { name: "enqueue", path: () => "/api/queue", cap: MAX_BODY },
  { name: "a running job's steps", path: (job) => `/api/queue/${job}/steps`, cap: MAX_BODY },
  { name: "a running job's model", path: (job) => `/api/queue/${job}/model`, cap: MAX_BODY },
  { name: "group create", path: () => "/api/queue/groups", cap: MAX_BODY },
  { name: "group edit", path: () => "/api/queue/groups/g1", cap: MAX_BODY },
  { name: "group action", path: () => "/api/queue/groups/g1/action", cap: MAX_BODY },
  { name: "schedule create", path: () => "/api/queue/schedule", cap: MAX_BODY },
  { name: "schedule edit", path: () => "/api/queue/schedule/aide/nightly", cap: MAX_BODY },
  { name: "schedule enabled", path: () => "/api/queue/schedule/aide/nightly/enabled", cap: MAX_BODY },
  { name: "schedule delete", path: () => "/api/queue/schedule/aide/nightly/delete", cap: MAX_BODY },
  { name: "queue editor", path: () => "/api/queue/waiting/open", cap: MAX_SAVE_BODY },
  { name: "a spec's model", path: () => `/api/queue/specs/aide/${SPEC}/model`, cap: MAX_BODY },
  { name: "close", path: () => `/api/queue/specs/aide/${SPEC}/close`, cap: MAX_BODY },
  { name: "approach", path: () => `/api/queue/specs/aide/${SPEC}/approach`, cap: MAX_BODY },
  { name: "tick", path: () => `/api/queue/specs/aide/${SPEC}/tick`, cap: MAX_SAVE_BODY },
  { name: "tracking", path: () => `/api/queue/specs/aide/${SPEC}/tracking`, cap: MAX_SAVE_BODY },
  { name: "save", path: () => `/api/queue/specs/aide/${SPEC}/save`, cap: MAX_SAVE_BODY },
];

const postJson = (base: string, path: string, text: string) =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: text,
  });

/** A board with a config file, a schedule entry and a job queued for
 *  another spec, as the routes in the table need to reach their body. */
async function board() {
  const own = mkdtempSync(join(tmpdir(), "aide-object-bodies-config-"));
  ownDirs.push(own);
  const configFile = join(own, "queue-config.json");
  writeFileSync(configFile, "{}\n");
  const { base, dir } = start({ queueConfigFile: configFile }, [], [OTHER]);
  const res = await postJson(base, "/api/queue", JSON.stringify({ project: "aide", specFolder: OTHER, steps: ["analyze"] }));
  const job = ((await res.json()) as { job: { id: string } }).job.id;
  return { base, job, stored: () => stored([dir, own], base) };
}

function files(root: string, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) files(path, out);
    else out[path] = readFileSync(path, "utf-8");
  }
  return out;
}

/** Every file the board keeps, and its job list. */
async function stored(roots: string[], base: string): Promise<unknown> {
  const jobs = ((await (await fetch(`${base}/api/queue`)).json()) as { jobs: unknown }).jobs;
  return { files: Object.assign({}, ...roots.map((root) => files(root))), jobs };
}

describe("a JSON body that is not an object", () => {
  for (const route of ROUTES) {
    test(`${route.name} answers the reader's 400 to null and [] and changes nothing (AC-1, AC-4)`, async () => {
      const b = await board();
      const path = route.path(b.job);
      const before = await b.stored();
      for (const text of ["null", "[]"]) {
        const res = await postJson(b.base, path, text);
        expect({ text, status: res.status, error: ((await res.json()) as { error?: string }).error })
          .toEqual({ text, status: 400, error: NOT_AN_OBJECT });
      }
      expect(await b.stored()).toEqual(before);
    });
  }
});

describe("each route keeps its own size limit", () => {
  for (const route of ROUTES.filter((r) => r.cap !== MAX_BODY)) {
    test(`${route.name} answers 413 one byte over its cap and changes nothing (AC-3)`, async () => {
      const b = await board();
      const before = await b.stored();
      const res = await postJson(b.base, route.path(b.job), "x".repeat(route.cap + 1));
      expect(res.status).toBe(413);
      expect(await b.stored()).toEqual(before);
    });
  }

  for (const route of ROUTES.filter((r) => r.cap > MAX_BODY)) {
    test(`${route.name} reads a body of MAX_BODY + 1 bytes (AC-3)`, async () => {
      const b = await board();
      const text = JSON.stringify({ pad: "x".repeat(MAX_BODY) }).slice(0, MAX_BODY + 1);
      const padded = `${text.slice(0, -2)}"}`;
      expect(padded.length).toBe(MAX_BODY + 1);
      const res = await postJson(b.base, route.path(b.job), padded);
      expect(res.status).not.toBe(413);
    });
  }
});
