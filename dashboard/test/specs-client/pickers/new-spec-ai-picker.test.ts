// Spec 465, AC-1: the New page draws every phase line on ONE form
// (`new-spec-form`), unlike the Specs list's own row (one form PER
// row, one name shared across rows). `applyAiPick`'s lookup —
// `select[name="${name}"][form="${form}"]` — is scoped by `name` AND
// `form` together, so two lines sharing a form id stay apart as long as
// their `name`/`data-ai` differ, which `aiPicker`/`modelPicker` already
// derive from the per-line `step` (`model.${step}`). This pins that:
// picking the AI on one phase line's select must never reach a
// sibling line's model select. Modeled on
// `schedule-ai-picker.test.ts`'s hand-built DOM, the closest existing
// pattern for a pair outside the row-swap harness (`#jobrows`), which
// the New page has none of.
import { afterEach, describe, expect, test } from "bun:test";
import { applyAiPick } from "../../../src/specs-client/ai-sync.ts";

const FORM = "new-spec-form";

function modelSelect(step: string, chosen: string) {
  const options = [
    { value: "sonnet", dataset: { tool: "claude" }, hidden: false, disabled: false, selected: chosen === "sonnet" },
    { value: "codex-fast", dataset: { tool: "codex" }, hidden: false, disabled: false, selected: chosen === "codex-fast" },
  ];
  return {
    name: `model.${step}`,
    options,
    tagName: "SELECT",
    getAttribute: (n: string) => (n === "form" ? FORM : null),
    get selectedOptions() {
      return options.filter((o) => o.selected);
    },
    get value() {
      return options.find((o) => o.selected)?.value ?? "";
    },
    set value(v: string) {
      for (const o of options) o.selected = o.value === v;
    },
  };
}

function aiSelect(step: string, tool: string) {
  const options = [
    { value: "claude", dataset: { default: "sonnet" }, selected: tool === "claude" },
    { value: "codex", dataset: { default: "codex-fast" }, selected: tool === "codex" },
  ];
  return {
    name: "",
    options,
    tagName: "SELECT",
    getAttribute: (n: string) => (n === "form" ? FORM : n === "data-ai" ? `model.${step}` : null),
    get selectedOptions() {
      return options.filter((o) => o.selected);
    },
    get value() {
      return options.find((o) => o.selected)?.value ?? "";
    },
    set value(v: string) {
      for (const o of options) o.selected = o.value === v;
    },
  };
}

/** Both phase lines' model selects live on the one document
 *  `applyAiPick` queries, matched the way a real attribute selector
 *  would — every `[attr="value"]` clause ANDed together — rather than
 *  always answering with one fixed select. A selector loosened to
 *  `form` alone (dropping the `name` clause) would then match BOTH
 *  lines' selects here too, the same way it would in a real DOM, which
 *  is what makes this stand-in able to catch that regression rather
 *  than paper over it. */
function standUpDocument(elements: Record<string, string>[]): void {
  const getAttr = (el: Record<string, unknown>, attr: string): string | null =>
    attr === "name" ? ((el.name as string) ?? null) : (el.getAttribute as (n: string) => string | null)(attr);
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: (sel: string) => {
      const conditions = [...sel.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [m[1]!, m[2]!] as const);
      return elements.filter((el) => conditions.every(([attr, value]) => getAttr(el, attr) === value));
    },
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("the New page's AI picker stays on its own phase line (spec 465, AC-1)", () => {
  test("picking the Implement line's AI writes only Implement's model select", () => {
    const implementModel = modelSelect("implement", "sonnet");
    const archiveModel = modelSelect("archive", "sonnet");
    const implementAi = aiSelect("implement", "claude");
    standUpDocument([implementModel, archiveModel] as unknown as Record<string, string>[]);

    implementAi.value = "codex";
    applyAiPick(implementAi as unknown as HTMLSelectElement);

    expect(implementModel.value).toBe("codex-fast");
    expect(archiveModel.value).toBe("sonnet");
  });

  test("picking the Archive line's AI writes only Archive's model select", () => {
    const implementModel = modelSelect("implement", "sonnet");
    const archiveModel = modelSelect("archive", "sonnet");
    const archiveAi = aiSelect("archive", "claude");
    standUpDocument([implementModel, archiveModel] as unknown as Record<string, string>[]);

    archiveAi.value = "codex";
    applyAiPick(archiveAi as unknown as HTMLSelectElement);

    expect(archiveModel.value).toBe("codex-fast");
    expect(implementModel.value).toBe("sonnet");
  });
});
