// Saving a project's Models per phase card: the choices go to the board's
// own queue-config.json, never into the project's repository, and a step
// left on Board default has the project's choice removed.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { queueHarness, stateSaying, statusSaying } from "../../helpers/queue-server.ts";
import { defaultsOf, ownFiles, JSON_HEADERS } from "./fixtures.ts";

const harness = queueHarness("aide-project-models-save-");
const ownDirs: string[] = [];

afterEach(() => {
  harness.cleanup();
  while (ownDirs.length) rmSync(ownDirs.pop()!, { recursive: true, force: true });
});

const CHOICES = { Opus: { model: "opus" }, Sonnet: { model: "sonnet" }, "gpt-5.5": { tool: "codex" as const } };
const MODEL = { default: "Opus", implement: "Opus" };
const CONFIG = `{
  // the operator's own note
  "model": { "default": "Opus", "implement": "Opus" },
  "projectModels": { "aide": { "model": { "implement": "Sonnet", "review": "Sonnet" }, "provider": { "implement": "Claude" } } }
}
`;

const git = (cwd: string, ...args: string[]): string =>
  new TextDecoder().decode(Bun.spawnSync(["git", ...args], { cwd }).stdout).trim();

/** A server whose project `aide` is a git repository with one commit. */
function serve(config = CONFIG) {
  const { file } = ownFiles(config, ownDirs);
  const defaults = {
    ...defaultsOf(CHOICES, MODEL),
    projectModels: { aide: { model: { implement: "Sonnet", review: "Sonnet" }, provider: { implement: "Claude" } } },
  };
  let project = "";
  const { base } = harness.start({
    extra: { queueDefaults: defaults, queueConfigFile: file },
    status: statusSaying(["create", "analyze"]),
    liveState: stateSaying(["create", "analyze"]),
    before: (dir) => {
      project = join(dir, "root", "aide");
      for (const args of [["init", "-q"], ["add", "-A"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"]]) git(project, ...args);
    },
  });
  return { base, file, project };
}

const save = (base: string, name: string, body: Record<string, unknown>) =>
  fetch(`${base}/api/queue/projects/${name}/models`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });

const projectsIn = (file: string): unknown => (parse(readFileSync(file, "utf-8")) as { projectModels?: unknown }).projectModels;

describe("saving a project's Models per phase card", () => {
  test("a step on Board default has the project's choice removed, and the next job runs on the board's (AC-5)", async () => {
    const { base, file } = serve();
    const res = await save(base, "aide", { model: { review: "Sonnet" }, provider: { implement: "Claude" } });
    expect(res.status).toBe(200);
    expect(projectsIn(file)).toEqual({ aide: { model: { review: "Sonnet" } } });
    const queued = await fetch(`${base}/api/queue`, {
      method: "POST", headers: JSON_HEADERS,
      body: JSON.stringify({ project: "aide", specFolder: "81-queue-and-runner", steps: ["implement"] }),
    });
    expect(((await queued.json()) as { job: { model: Record<string, string> } }).job.model.implement).toBe("Opus");
  });

  test("the choices are saved in the board's file with no commit and no changed file in the project (AC-6)", async () => {
    const { base, file, project } = serve();
    const before = git(project, "rev-parse", "HEAD");
    const res = await save(base, "aide", { model: { implement: "gpt-5.5", create: "Sonnet" }, provider: { implement: "Codex", create: "Claude" } });
    expect(res.status).toBe(200);
    expect(projectsIn(file)).toEqual({
      aide: { model: { implement: "gpt-5.5", create: "Sonnet" }, provider: { implement: "Codex", create: "Claude" } },
    });
    expect(readFileSync(file, "utf-8")).toContain("// the operator's own note");
    expect(git(project, "rev-parse", "HEAD")).toBe(before);
    expect(git(project, "status", "--porcelain")).toBe("");
  });

  test("an unknown model, an AI that does not run the model, or an unknown project is refused and changes nothing (AC-6)", async () => {
    const { base, file } = serve();
    const was = readFileSync(file, "utf-8");
    for (const [name, body] of [
      ["aide", { model: { implement: "Nonesuch" } }],
      ["aide", { model: { implement: "Sonnet" }, provider: { implement: "Codex" } }],
      ["nonesuch", { model: { implement: "Sonnet" } }],
      ["aide", { model: { nonesuch: "Sonnet" } }],
    ] as const) {
      const res = await save(base, name, body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error?: string }).error).toBeTruthy();
    }
    expect(readFileSync(file, "utf-8")).toBe(was);
  });
});

describe("keeping a project's choices valid", () => {
  test("a model a project's choice names is not removed from under it", async () => {
    const { base, file } = serve();
    const res = await fetch(`${base}/api/queue/settings/models/remove`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name: "Sonnet" }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("in aide");
    expect(Object.keys((parse(readFileSync(file, "utf-8")) as { projectModels: Record<string, unknown> }).projectModels)).toEqual(["aide"]);
  });

  test("removing the project removes its choices, so a project added again later under its name starts without them", async () => {
    // The allowlist is saved to the same file, read as plain JSON.
    const { base, file } = serve(CONFIG.replace("  // the operator's own note\n", ""));
    const res = await fetch(`${base}/api/queue/projects/aide/remove`, { method: "POST", headers: JSON_HEADERS, body: "{}" });
    expect(res.status).toBe(200);
    expect(projectsIn(file)).toBeUndefined();
  });
});
