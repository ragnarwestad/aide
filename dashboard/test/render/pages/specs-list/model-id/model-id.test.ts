// The model id a Claude run reported, on the specs list: as the first line
// of a phase's unfolded row, and beside the alias in the pickers that are
// still open — never in a select that is a record of what ran.

import { describe, expect, test } from "bun:test";
import {
  renderNewSpecPage,
  renderScheduleEditPage,
  renderSettingsPage,
  renderSpecsRows,
  type ArchivedSpecView,
  type QueueRowView,
  type SpecsPageOptions,
} from "../../../../../src/render";
import { modelOptions } from "../../../../../src/render/pages/specs-list/model-picker.ts";
import { row } from "../../fixtures.ts";

const FOLDER = "544-model-ids";
const KEY = `aide/${FOLDER}`;
const CHOICES = [{ name: "Opus", ranAs: "claude-opus-5-6" }, { name: "zen-free", tool: "opencode" as const }];

const ran = (extra: Partial<QueueRowView> = {}, result: Record<string, unknown> = {}): QueueRowView =>
  row({
    id: "job-a",
    specFolder: FOLDER,
    steps: ["analyze"],
    stepIndex: 0,
    state: "done",
    model: "Opus",
    stepModels: { analyze: "Opus" },
    results: [{ step: "analyze", ok: true, tool: "claude", costUsd: 1, terminalReason: "completed", at: "2026-09-26T10:00:00Z", ...result }],
    ...extra,
  });

const render = (list: QueueRowView[], opts: Partial<SpecsPageOptions> = {}) =>
  renderSpecsRows(
    list,
    {
      runnerAvailable: true,
      targets: [{ project: "aide", specFolder: FOLDER }],
      modelChoices: CHOICES,
      defaultModels: { default: "Opus" },
      filter: { open: KEY, phases: `${KEY}:analyze` },
      phaseMessages: () => ({ messages: ["said"], running: false }),
      ...opts,
    },
    Date.parse("2026-09-26T12:00:00Z"),
  );

const unfolded = (html: string) => html.match(/<tr class="phasemsgs"[\s\S]*?<\/tr>/)?.[0] ?? "";
const line = (html: string, step: string) => html.match(new RegExp(`<tr class="subrow"[^>]*data-step="${step}">[\\s\\S]*?</tr>`))?.[0] ?? "";
const modelSelect = (html: string, step: string) => line(html, step).match(new RegExp(`<select name="model\\.${step}"[\\s\\S]*?</select>`))?.[0] ?? "";

describe("a phase's unfolded row", () => {
  test("starts with the model line from the queue's result (AC-2)", () => {
    const body = unfolded(render([ran({}, { modelId: "claude-opus-5-5" })]));
    expect(body).toContain('<p class="muted small" data-model-id>Model: Opus 5.5</p>');
    expect(body.indexOf("data-model-id")).toBeLessThan(body.indexOf("said"));
  });

  test("reads the recorded word and id from an archived phase's file (AC-2)", () => {
    const archived: ArchivedSpecView = {
      project: "aide",
      folder: "50-old",
      done: ["create", "analyze"],
      models: {},
      phaseOutcomes: { analyze: { model: "claude opus", modelId: "claude-opus-5-5" } },
    };
    const html = render([], { targets: [], archivedSpecs: [archived], filter: { state: "archived", open: "aide/50-old", phases: "aide/50-old:analyze" } });
    expect(unfolded(html)).toContain("Model: Opus 5.5");
  });

  test("a phase with no stored id has no model line (AC-2)", () => {
    expect(unfolded(render([ran()]))).not.toContain("data-model-id");
  });

  test("a Codex or OpenCode step adds no line and no id (AC-3)", () => {
    const html = render([ran({ model: "zen-free", stepModels: { analyze: "zen-free" } }, { tool: "opencode" })]);
    expect(unfolded(html)).not.toContain("data-model-id");
    expect(html).not.toContain("zen-free ·");
  });

  test("the phase line's own markup is the same with and without an id (AC-2)", () => {
    const withId = line(render([ran({}, { modelId: "claude-opus-5-5" })]), "analyze");
    const without = line(render([ran()]), "analyze");
    expect(withId).toBe(without);
  });
});

describe("the pickers", () => {
  test("an open picker offers the alias with the id its newest run reported, and a record-select does not (AC-4, AC-2)", () => {
    const html = render([ran({}, { modelId: "claude-opus-5-5" })]);
    // analyze ran on claude-opus-5-5; the alias has since moved on.
    expect(modelSelect(html, "analyze")).toContain(">Opus</option>");
    expect(modelSelect(html, "analyze")).not.toContain("claude-opus-5-6");
    // implement has not run: its select is open, and offers today's answer.
    expect(modelSelect(html, "implement")).toContain(">Opus 5.6</option>");
    // A Codex or OpenCode choice reads as its name.
    expect(modelSelect(html, "implement")).toContain(">zen-free</option>");
  });

  test("an archived phase's locked select reads the bare choice (AC-2)", () => {
    const archived: ArchivedSpecView = { project: "aide", folder: "50-old", done: ["create", "analyze"], models: { analyze: "claude Opus" }, phaseOutcomes: {} };
    const html = render([], { targets: [], archivedSpecs: [archived], filter: { state: "archived", open: "aide/50-old" } });
    expect(modelSelect(html, "analyze")).not.toContain("claude-opus-5-6");
  });

  test("modelOptions labels only an option that carries ranAs (AC-4)", () => {
    const html = modelOptions([{ name: "Opus", ranAs: "claude-opus-5-5" }, { name: "Sonnet" }]);
    expect(html).toContain('value="Opus" data-tool="claude">Opus 5.5</option>');
    expect(html).toContain('>Sonnet</option>');
  });

  test("the New-spec form, the Schedule form and the Settings page draw the same label (AC-4)", () => {
    const nav = [{ label: "Overview", path: "projects.html" }];
    const newSpec = renderNewSpecPage(nav, "2026-09-26T00:00:00Z", { createProjects: ["aide"], targets: [], modelChoices: CHOICES, defaultModels: { default: "Opus" } });
    const schedule = renderScheduleEditPage(nav, "2026-09-26T00:00:00Z", {
      project: "aide", values: { name: "", cron: "0 3 * * *", prompt: "", model: undefined, notify: undefined },
      backHref: "/projects", modelChoices: CHOICES, defaultModels: { default: "Opus" },
    });
    const settings = renderSettingsPage(nav, "2026-09-26T00:00:00Z", { modelChoices: CHOICES, defaultModels: { default: "Opus" }, timeoutSec: { default: 1200 } });
    for (const html of [newSpec, schedule, settings]) expect(html).toContain(">Opus 5.6<");
  });
});
