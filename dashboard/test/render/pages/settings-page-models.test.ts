// What an AI's tab says of its models: the ones it offers that are not
// choices, each with Add, and the choices it no longer offers, each with
// Remove. Worked out each time the tab is drawn, from the last reading and
// the live choices, so nothing is changed by drawing it.

import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { modelLists, toolPanel, type ToolModels } from "../../../src/render";
import type { ModelChoice } from "../../../src/queue/types.ts";

const AT = "2026-10-03T13:30:00.000Z";
const ADD = "/api/queue/settings/models/add";
const REMOVE = "/api/queue/settings/models/remove";

const windows: Window[] = [];
afterEach(async () => {
  while (windows.length) await windows.pop()!.happyDOM.close();
});

function parse(html: string): Document {
  const win = new Window();
  windows.push(win);
  win.document.write(html);
  return win.document as unknown as Document;
}

/** Each form on the panel that posts to `action`, as the fields it posts. */
function posted(html: string, action: string): Record<string, string>[] {
  return Array.from(parse(html).querySelectorAll("form"))
    .filter((f) => f.getAttribute("action") === action)
    .map((f) => Object.fromEntries(
      Array.from(f.querySelectorAll("input")).map((i) => [i.getAttribute("name") ?? "", i.getAttribute("value") ?? ""]),
    ));
}

const text = (html: string): string => parse(html).body.textContent ?? "";

const CODEX: ToolModels = {
  tool: "codex",
  at: AT,
  offered: [{ model: "gpt-6.1-sol", name: "GPT-6.1-Sol" }, { model: "gpt-5.5", name: "GPT-5.5" }],
};
const CLAUDE: ToolModels = {
  tool: "claude",
  at: AT,
  offered: [
    { model: "opus", name: "Opus 5.5", id: "claude-opus-5-5" },
    { model: "sonnet", name: "Sonnet 5.5", id: "claude-sonnet-5-5" },
    { model: "fable", name: "Fable 5.1", id: "claude-fable-5-1" },
    { model: "haiku", name: "Haiku 4.5", id: "claude-haiku-4-5-20251001" },
  ],
};

describe("modelLists", () => {
  test("a model the AI offers that is no choice of it is offered to add (AC-1)", () => {
    const choices: Record<string, ModelChoice> = { "gpt-6.1-sol": { tool: "codex" } };
    expect(modelLists("codex", choices, CODEX).offered.map((m) => m.model)).toEqual(["gpt-5.5"]);
  });

  test("a choice of the AI that it no longer offers is listed to remove (AC-2)", () => {
    const choices: Record<string, ModelChoice> = {
      "gpt-6.1-sol": { tool: "codex" },
      "gpt-5.6-luna": { tool: "codex" },
      "gpt-reserve": { tool: "codex" },
    };
    expect(modelLists("codex", choices, CODEX).gone.map((c) => c.name)).toEqual(["gpt-5.6-luna", "gpt-reserve"]);
  });

  test("a Claude choice matches its family without case, and other names are no longer offered (AC-3)", () => {
    const choices: Record<string, ModelChoice> = {
      Opus: { model: "opus" },
      Sonnet: {},
      plan: { model: "opusplan" },
      best: {},
      "opus[1m]": {},
    };
    const lists = modelLists("claude", choices, CLAUDE);
    expect(lists.offered.map((m) => m.model)).toEqual(["fable", "haiku"]);
    expect(lists.gone.map((c) => c.name)).toEqual(["plan", "best", "opus[1m]"]);
  });

  test("OpenCode's models compare exactly, each as its provider/model (AC-10)", () => {
    const reading: ToolModels = {
      tool: "opencode", at: AT, offered: [{ model: "opencode/gemini-3.1-pro" }, { model: "opencode/glm-5" }],
    };
    const choices: Record<string, ModelChoice> = {
      "gemini-3.1-pro": { tool: "opencode", model: "opencode/gemini-3.1-pro" },
      "gemini-2-pro": { tool: "opencode", model: "opencode/gemini-2-pro" },
      "glm": { tool: "opencode", model: "opencode/GLM-5" },
    };
    const lists = modelLists("opencode", choices, reading);
    expect(lists.offered.map((m) => m.model)).toEqual(["opencode/glm-5"]);
    expect(lists.gone.map((c) => c.name)).toEqual(["gemini-2-pro", "glm"]);
  });

  test("another AI's choice and a stand-in's belong to no list of this one (AC-2)", () => {
    const choices: Record<string, ModelChoice> = {
      "gpt-5.5": { tool: "codex" },
      stand: { tool: "fake-claude", model: "opus" },
    };
    expect(modelLists("claude", choices, CLAUDE)).toEqual({ offered: CLAUDE.offered, gone: [] });
  });
});

describe("the models on an AI's tab", () => {
  test("each model offered and no choice has an Add that posts the AI and the model (AC-1)", () => {
    const html = toolPanel("codex", undefined, undefined, Date.parse(AT), {
      reading: CODEX, choices: { "gpt-6.1-sol": { tool: "codex" } },
    });
    expect(posted(html, ADD)).toEqual([{ tool: "codex", model: "gpt-5.5" }]);
  });

  test("each choice no longer offered has a Remove that posts its name (AC-2)", () => {
    const html = toolPanel("codex", undefined, undefined, Date.parse(AT), {
      reading: CODEX, choices: { "gpt-6.1-sol": { tool: "codex" }, "gpt-5.5": { tool: "codex" }, "gpt-5.6-luna": { tool: "codex" } },
    });
    expect(posted(html, REMOVE)).toEqual([{ name: "gpt-5.6-luna" }]);
  });

  test("Claude's families are offered with the version each gives today (AC-3)", () => {
    const html = toolPanel("claude", undefined, undefined, Date.parse(AT), { reading: CLAUDE, choices: {} });
    expect(posted(html, ADD).filter((f) => f.model)).toContainEqual({ tool: "claude", model: "opus" });
    expect(text(html)).toContain("opus → Opus 5.5");
    expect(text(html)).toContain("haiku → Haiku 4.5");
  });

  test("a reading that failed says so, and offers nothing to add or remove (AC-3)", () => {
    const failed: ToolModels = { tool: "claude", at: AT, offered: [], error: "claude did not finish in time." };
    const html = toolPanel("claude", undefined, undefined, Date.parse(AT), {
      reading: failed, choices: { plan: { model: "opusplan" } },
    });
    expect(text(html)).toContain("could not be read");
    expect(posted(html, REMOVE)).toEqual([]);
    expect(posted(html, ADD).filter((f) => f.model)).toEqual([]);
  });

  test("with no reading, the Claude tab still names each choice by its version (AC-6)", () => {
    const html = toolPanel("claude", undefined, undefined, Date.parse(AT), {
      choices: { Fable: { model: "fable" }, "claude-opus-4-8": { model: "claude-opus-4-8" } },
      options: [{ name: "Fable", ranAs: "claude-fable-5-1" }, { name: "claude-opus-4-8" }],
    });
    expect(text(html)).toContain("Fable 5.1");
    expect(text(html)).toContain("Opus 4.8");
  });

  test("the Claude tab always has a field to add a fixed version by its full id (AC-4)", () => {
    const html = toolPanel("claude", undefined, undefined, Date.parse(AT), { choices: {} });
    const form = Array.from(parse(html).querySelectorAll("form")).find(
      (f) => f.getAttribute("action") === ADD && f.querySelector('input[name="model"]:not([type="hidden"])'),
    );
    expect(form).toBeDefined();
    expect(form!.querySelector('input[name="tool"]')?.getAttribute("value")).toBe("claude");
  });
});
