// A fold arrow, a tab strip, a table of facts, a form holding one button and
// a checkbox with its words beside it each have one component. A copy written
// out by hand beside it is how the two drift — the job page's step arrow had
// an English title where every other arrow's was translated — so the sources
// are scanned for markup only the component may write.
import { describe, expect, test } from "bun:test";
import { read } from "./source.ts";

const FOLD = "src/render/ui/components/fold-arrow.ts";
const TABS = "src/render/ui/tabs.ts";
const FACTS = "src/render/ui/components/facts.ts";
const BUTTON = "src/render/ui/components/button.ts";
const CHECKBOX = "src/render/ui/components/checkbox.ts";
// The phase chip is a component of its own, with its own lock and tick.
const PHASE_CHIP = "src/render/ui/components/phase-chip.ts";

const matching = (files: { file: string; text: string }[], hit: (text: string) => boolean, except: string[]): string[] =>
  files.filter((f) => !except.includes(f.file) && hit(f.text)).map((f) => f.file);

/** `name(…)` with its parentheses balanced, from `start` (the name's first character). */
function callEnd(text: string, start: number): number {
  let depth = 0;
  for (let i = text.indexOf("(", start); i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i + 1;
  }
  return text.length;
}

/** Each `name(…)` call in `text` replaced by `token`. */
function replaceCalls(text: string, name: string, token: string): string {
  const re = new RegExp(`\\b${name}\\(`);
  let out = text;
  for (let m = re.exec(out); m; m = re.exec(out)) out = out.slice(0, m.index) + token + out.slice(callEnd(out, m.index));
  return out;
}

/** Whether a source writes a form whose only control is one button — a
 *  `btn(…)` or a `<button>` written out — once
 *  its opening tag, hidden fields, the helpers that draw hidden fields, a
 *  message line or a dialog, and the concatenation between them are taken
 *  away, one button is all that is left. */
function writesOneButtonForm(text: string): boolean {
  for (let at = text.indexOf("<form"); at !== -1; at = text.indexOf("<form", at + 1)) {
    const close = text.indexOf("</form>", at);
    if (close === -1) break;
    const inner = text.slice(text.indexOf(">", at) + 1, close);
    let rest = replaceCalls(inner, "btn", "§BTN§").replace(/<button\b[\s\S]*?<\/button>/g, "§BTN§");
    for (const helper of ["filterFields", "messageSlot", "deployDialog"]) rest = replaceCalls(rest, helper, "");
    rest = rest
      .replace(/<input type=\\?"hidden\\?"[^>]*>/g, "")
      .replace(/<div class=\\?"configactions\\?">|<\/div>/g, "")
      .replace(/\bhidden\b/g, "")
      .replace(/[`+\s]|\$\{|\}/g, "");
    if (rest === "§BTN§") return true;
  }
  return false;
}

/** Whether a source writes a checkbox followed, in the same template
 *  expression, directly by the `<span>` of its words. */
const writesLabelledCheckbox = (text: string): boolean =>
  /<input\b[^>]*type=\\?"checkbox\\?"[^>]*>(?:`\s*\+\s*`)?<span>/.test(text);

describe("one fold arrow, one tab strip, one table of facts, one one-button form, one labelled checkbox", () => {
  const render = read("src/render/**/*.ts");
  const serve = read("src/serve/**/*.ts");
  const client = read("src/specs-client/**/*.ts");
  const all = [...render, ...serve, ...client];

  test("the globs found the sources at all", () => {
    // A guard that silently matches nothing passes forever.
    expect(render.length).toBeGreaterThan(15);
    expect(serve.length).toBeGreaterThan(15);
    expect(client.length).toBeGreaterThan(15);
  });

  test("no file but the fold-arrow component writes an element with the fold class (AC-1)", () => {
    expect(matching(all, (text) => /class=\\?"fold\b/.test(text), [FOLD])).toEqual([]);
  });

  test("no file but the tab strip writes an element with the tab class (AC-2)", () => {
    expect(matching(all, (text) => /class=\\?"tab\b/.test(text), [TABS])).toEqual([]);
  });

  test("no file but the facts component writes a table of facts (AC-3)", () => {
    expect(matching(all, (text) => /class=\\?"facts\b/.test(text), [FACTS])).toEqual([]);
  });

  test("no file but the button component writes a form holding one button (AC-4)", () => {
    expect(matching(all, writesOneButtonForm, [BUTTON])).toEqual([]);
  });

  test("the one-button rule flags a hand-written one and passes a form with other controls (AC-4)", () => {
    expect(
      writesOneButtonForm('`<form class="actionform" method="post" action="${esc(a)}">` + btn({ label: "Go" }) + `</form>`'),
    ).toBe(true);
    // A button written out rather than drawn by btn(), as the About box's close was.
    expect(
      writesOneButtonForm('`<form method="dialog"><button class="aboutclose" aria-label="Close">` + `${ICON}</button></form>`'),
    ).toBe(true);
    // Controls that come in through a variable, as the criteria list's boxes do.
    expect(
      writesOneButtonForm('`<form class="rowchecks" method="post" action="/x">` + list + btn({ label: "Save" }) + `</form>`'),
    ).toBe(false);
    expect(
      writesOneButtonForm(
        '`<form class="specsearch" method="get" action="/"><input class="q" type="search" name="q">` + ' +
          'btn({ label: "Search" }) + `</form>`',
      ),
    ).toBe(false);
  });

  test("no file but the checkbox component writes a checkbox with its words beside it (AC-5)", () => {
    expect(matching(all, writesLabelledCheckbox, [CHECKBOX, PHASE_CHIP])).toEqual([]);
  });

  test("the labelled-checkbox rule flags a hand-written line and passes the model picker's box (AC-5)", () => {
    expect(writesLabelledCheckbox('`<label class="row"><input type="checkbox" name="x" value="1">` +\n  `<span>Words</span></label>`')).toBe(
      true,
    );
    expect(writesLabelledCheckbox('`<input type="checkbox" class="aimodelopen" id="${esc(id)}">` + `<label for="x">`')).toBe(false);
  });
});
