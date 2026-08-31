// The schedule form's AI/model pair in the browser. The phase lines and
// the New-spec form post `model.<step>`; a schedule entry has one step
// and posts a bare `model`, and `MODEL_SELECTS` is what has to reach
// both — a selector that still said `name^="model."` alone would leave
// this select silently unpaired, the AI picker writing nothing and the
// list never narrowing to its tool.
//
// `applyAiPick` and `syncAiToModel` read the global `document`, so this
// suite stands one up: two selects and a `querySelectorAll` that answers
// the two attribute selectors those functions build. Hand-built for the
// same reason `schedule-actions.test.ts` is — nothing on this page lives
// inside `#jobrows`, so the row-swap harness has nothing to offer here.
import { afterEach, describe, expect, test } from "bun:test";
import { applyAiPick, offerEachToItsTool, syncAiToModel } from "../../src/queue-client/ai-sync.ts";

const FORM = "schedule-form";
const MODELS: [string, string][] = [
  ["claude-opus-5", "claude"],
  ["codex-fast", "codex"],
];
const AI_DEFAULT: Record<string, string> = { claude: "claude-opus-5", codex: "codex-fast" };

function modelSelect(chosen: string) {
  const group = { hidden: false, tagName: "OPTGROUP" };
  const options = MODELS.map(([value, tool]) => ({
    value,
    dataset: { tool },
    hidden: false,
    disabled: false,
    selected: value === chosen,
    parentElement: group,
  }));
  const self = {
    // The bare name — one model for the whole entry.
    name: "model",
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
  return self;
}

function aiSelect(tool: string) {
  const options = ["claude", "codex"].map((t) => ({
    value: t,
    dataset: { default: AI_DEFAULT[t]! },
    selected: t === tool,
  }));
  return {
    name: "",
    options,
    tagName: "SELECT",
    getAttribute: (n: string) => (n === "form" ? FORM : n === "data-ai" ? "model" : null),
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

/** The document the two functions query: `select[name="model"][form=…]`
 *  from `applyAiPick`, and `select[data-ai="model"][form=…]` from
 *  `syncAiToModel`. */
function standUpDocument(model: unknown, ai: unknown): void {
  (globalThis as { document?: unknown }).document = {
    querySelectorAll: (sel: string) => (sel.startsWith("select[data-ai=") ? [ai] : [model]),
  };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("the schedule form's AI picker (one model for the whole entry)", () => {
  test("picking an AI writes the model that AI stands for", () => {
    const model = modelSelect("claude-opus-5");
    const ai = aiSelect("claude");
    standUpDocument(model, ai);
    ai.value = "codex";
    applyAiPick(ai as unknown as HTMLSelectElement);
    expect(model.value).toBe("codex-fast");
  });

  test("the model list is narrowed to the AI that was picked", () => {
    const model = modelSelect("claude-opus-5");
    const ai = aiSelect("claude");
    standUpDocument(model, ai);
    ai.value = "codex";
    applyAiPick(ai as unknown as HTMLSelectElement);
    expect(model.options.filter((o) => !o.hidden).map((o) => o.value)).toEqual(["codex-fast"]);
    expect(model.options.find((o) => o.value === "claude-opus-5")?.disabled).toBe(true);
  });

  test("a model picked by hand pulls the AI select after it", () => {
    const model = modelSelect("codex-fast");
    const ai = aiSelect("claude");
    standUpDocument(model, ai);
    syncAiToModel(model as unknown as HTMLSelectElement);
    expect(ai.value).toBe("codex");
  });

  test("the first paint narrows the bare `model` select too", () => {
    const model = modelSelect("codex-fast");
    // Matched the way a browser would: this select answers only to a
    // selector that asks for the bare name. A `MODEL_SELECTS` narrowed
    // back to `name^="model."` alone finds nothing here, and the list
    // goes on offering both tools' models.
    const root = { querySelectorAll: (sel: string) => (sel.includes('[name="model"]') ? [model] : []) };
    offerEachToItsTool(root as unknown as ParentNode);
    expect(model.options.filter((o) => !o.hidden).map((o) => o.value)).toEqual(["codex-fast"]);
  });
});
