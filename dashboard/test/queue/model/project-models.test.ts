// A project's own AI and model per step: kept in `queue-config.json`
// beside the board's, and laid over the board's table for that project's
// jobs. The order a step resolves in is the spec's own pick, the
// project's choice, the board's step, the board's default model.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { QueueStore, mergeQueueDefaults, persistQueueSettingsResult, type QueueDefaults } from "../../../src/queue/queue.ts";
import { boardChoiceFor, forProject, projectSets } from "../../../src/queue/providers/project-defaults.ts";
import { providerUses } from "../../../src/queue/providers/index.ts";

const PROVIDERS = {
  "claude-max": { name: "Claude Max", tool: "claude" as const },
  "codex-pro": { name: "Codex Pro", tool: "codex" as const },
};

const BOARD: QueueDefaults = {
  timeoutSec: { default: 1200 },
  permissionMode: { default: "acceptEdits" },
  model: { default: "Haiku", analyze: "Opus", implement: "Opus" },
  modelChoices: { Opus: {}, Sonnet: {}, Haiku: {}, "gpt-5.5": { tool: "codex" } },
  providers: PROVIDERS,
  provider: { implement: "claude-max" },
  projectModels: {
    woodstack: { model: { implement: "Sonnet", review: "gpt-5.5" }, provider: { review: "codex-pro" } },
  },
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aide-project-models-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const resolve = (project: string) =>
  project === "woodstack" || project === "aide" ? { specFolders: ["01-first"] } : null;

function store(defaults: QueueDefaults = BOARD): QueueStore {
  return new QueueStore({ mirrorPath: join(dir, "queue.json"), resolve, defaults: structuredClone(defaults) });
}

describe("the order a step's model is chosen in", () => {
  test("a project's job with no pick runs Implement on the project's choice (AC-3)", () => {
    const result = store().enqueue({ project: "woodstack", specFolder: "01-first", steps: ["implement"] });
    if (!result.ok) throw new Error(result.error);
    expect(result.job.model.implement).toBe("Sonnet");
  });

  test("the spec's own pick wins over the project's choice (AC-3)", () => {
    const result = store().enqueue({ project: "woodstack", specFolder: "01-first", steps: ["implement"], model: { implement: "Haiku" } });
    if (!result.ok) throw new Error(result.error);
    expect(result.job.model.implement).toBe("Haiku");
  });

  test("another project's job runs on the board's choice (AC-3)", () => {
    const result = store().enqueue({ project: "aide", specFolder: "01-first", steps: ["implement"] });
    if (!result.ok) throw new Error(result.error);
    expect(result.job.model.implement).toBe("Opus");
  });

  test("a step neither the project nor the board sets runs on the default model (AC-3)", () => {
    const board = { ...BOARD, model: { default: "Haiku", implement: "Opus" } };
    const result = store(board).enqueue({ project: "woodstack", specFolder: "01-first", steps: ["analyze"] });
    if (!result.ok) throw new Error(result.error);
    expect(result.job.model.analyze).toBe("Haiku");
  });
});

describe("forProject", () => {
  test("lays the project's entries over the board's, and leaves the default as the board's", () => {
    const own = forProject(BOARD, "woodstack");
    expect(own.model).toEqual({ default: "Haiku", analyze: "Opus", implement: "Sonnet", review: "gpt-5.5" });
    expect(own.provider).toEqual({ implement: "claude-max", review: "codex-pro" });
    expect(own.modelChoices).toBe(BOARD.modelChoices);
  });

  test("a project with no choices, or no project, gets the board's table", () => {
    expect(forProject(BOARD, "aide")).toBe(BOARD);
    expect(forProject(BOARD, undefined)).toBe(BOARD);
  });
});

describe("what a card row's Board default names", () => {
  test("the board's model and AI for the step, leaving the project's own out (AC-2)", () => {
    expect(boardChoiceFor(BOARD, "woodstack", "implement")).toEqual({ model: "Opus", provider: "claude-max" });
    expect(boardChoiceFor(BOARD, "woodstack", "review")).toEqual({ model: "Haiku" });
  });

  test("Review under Analyze follows the project's Analyze when the board sets none (AC-2)", () => {
    const defaults = { ...BOARD, projectModels: { woodstack: { model: { analyze: "Sonnet" }, provider: { analyze: "claude-max" } } } };
    expect(boardChoiceFor(defaults, "woodstack", "plan-review")).toEqual({ model: "Sonnet", provider: "claude-max" });
    const boardSets = { ...defaults, model: { ...defaults.model, "plan-review": "Haiku" } };
    expect(boardChoiceFor(boardSets, "woodstack", "plan-review")).toEqual({ model: "Haiku" });
  });

  test("projectSets says whether the project's own table names the step", () => {
    expect(projectSets(BOARD, "woodstack", "implement")).toBe(true);
    expect(projectSets(BOARD, "woodstack", "analyze")).toBe(false);
    expect(projectSets(BOARD, "aide", "implement")).toBe(false);
  });
});

describe("the projectModels section of queue-config.json", () => {
  const file = () => join(dir, "queue-config.json");
  const read = () => parse(readFileSync(file(), "utf-8")) as Record<string, unknown>;
  const own = () => read().projectModels;

  test("is read into the live defaults, string entries only and no default", () => {
    const merged = mergeQueueDefaults(BOARD, {
      projectModels: {
        woodstack: { model: { implement: "Sonnet", default: "Opus", review: 3 }, provider: { implement: "claude-max" } },
        empty: { model: {} },
        broken: "nonsense",
      },
    });
    expect(merged.projectModels).toEqual({ woodstack: { model: { implement: "Sonnet" }, provider: { implement: "claude-max" } } });
  });

  test("a file without it reads as no project choices", () => {
    expect(mergeQueueDefaults({ ...BOARD, projectModels: undefined }, { model: { default: "Opus" }, projects: ["aide"] }).projectModels).toBeUndefined();
  });

  test("a project's choices are written under its name, keeping the rest of the file", () => {
    writeFileSync(file(), `{\n  // the operator's note\n  "model": { "default": "Opus" }\n}\n`);
    const result = persistQueueSettingsResult(file(), {
      projectModels: { woodstack: { model: { implement: "Sonnet" }, provider: { implement: "claude-max" } } },
    });
    expect("error" in result).toBe(false);
    expect(own()).toEqual({ woodstack: { model: { implement: "Sonnet" }, provider: { implement: "claude-max" } } });
    expect(readFileSync(file(), "utf-8")).toContain("// the operator's note");
  });

  test("a null removes the project's model and AI for the step (AC-5)", () => {
    writeFileSync(file(), JSON.stringify({
      model: { default: "Opus" },
      projectModels: { woodstack: { model: { implement: "Sonnet", review: "Haiku" }, provider: { implement: "claude-max" } } },
    }));
    persistQueueSettingsResult(file(), { projectModels: { woodstack: { model: { implement: null }, provider: { implement: null } } } });
    expect(own()).toEqual({ woodstack: { model: { review: "Haiku" } } });
  });

  test("a project left with no choice at all is removed, and so is an emptied section (AC-5)", () => {
    writeFileSync(file(), JSON.stringify({
      model: { default: "Opus" },
      projectModels: { woodstack: { model: { implement: "Sonnet" }, provider: { implement: "claude-max" } } },
    }));
    persistQueueSettingsResult(file(), { projectModels: { woodstack: { model: { implement: null }, provider: { implement: null } } } });
    expect(own()).toBeUndefined();
  });

  test("a null project removes its whole entry", () => {
    writeFileSync(file(), JSON.stringify({ projects: ["woodstack", "aide"], projectModels: { woodstack: { model: { implement: "Sonnet" } }, aide: { model: { create: "Opus" } } } }));
    persistQueueSettingsResult(file(), { projectModels: { woodstack: null } });
    expect(own()).toEqual({ aide: { model: { create: "Opus" } } });
    expect(read().projects).toEqual(["woodstack", "aide"]);
  });
});

describe("a provider a project's choice names", () => {
  test("is in use, so it is not removed from under the project", () => {
    expect(providerUses("codex-pro", BOARD, {}, [])).toEqual(["the Review choice of woodstack"]);
  });
});
