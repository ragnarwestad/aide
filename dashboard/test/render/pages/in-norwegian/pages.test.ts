// Every page the Norwegian-language criteria cover, drawn with Norwegian
// chosen: a word the page writes itself instead of reading from the message
// catalogue fails the test, and the failure names the page and the word.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { t } from "../../../../src/i18n";
import { GERUND_NB } from "../../../../src/format/gerund.ts";
import { newSpecStates, projectStates, scheduleStates, settingsStates, type PageState } from "./fixtures.ts";
import { jobsStates, scheduleRunStates, specsListStates, testServerStates } from "./jobs-fixtures.ts";
import { jobPageStates, shellStates, specPageStates } from "./spec-fixtures.ts";
import { assertInNorwegian, describeFailure, wordsNotInCatalogue } from "./vocabulary.ts";

const check = (state: PageState) => () => assertInNorwegian(state.page, state.html, state.data, state.read);

/** The text of every Cancel button on the page: the one whose id says so, or a dialog's. */
const cancels = (html: string): string[] => {
  const win = new Window();
  win.document.write(html);
  const found = [...win.document.querySelectorAll('button[id$="-cancel"], dialog button[data-close], [data-cancel]')]
    .map((b) => (b.textContent ?? "").trim());
  void win.happyDOM.close();
  return found;
};

describe("the Norwegian page checker", () => {
  test("names the page and the word written in the page code (AC-6)", () => {
    const html = `<main><p>${t("nb", "dialog.cancel")}</p><p>Quokka</p></main>`;
    expect(() => assertInNorwegian("Settings › Process", html)).toThrow('Settings › Process: "quokka"');
    expect(describeFailure("p", ["a"])).toBe('p: "a"');
  });

  test("reads the placeholder, title and aria-label of an element, not only its text (AC-6)", () => {
    const html = `<main><input placeholder="Quokka" title="Oops" aria-label="Plain"></main>`;
    expect(wordsNotInCatalogue(html)).toEqual(["quokka", "oops", "plain"]);
  });

  test("a whole English text that Norwegian writes differently fails on its own (AC-6)", () => {
    expect(wordsNotInCatalogue(`<main><button>Cancel</button></main>`)).toEqual(["Cancel"]);
    expect(wordsNotInCatalogue(`<main><button>${t("nb", "dialog.cancel")}</button></main>`)).toEqual([]);
  });

  test("the page's own data and a time stamp are not words (AC-6)", () => {
    const html = `<main><p>kvitsyl 2026-11-03 08:00:00 UTC</p></main>`;
    expect(wordsNotInCatalogue(html, ["kvitsyl"])).toEqual([]);
  });
});

describe("what the Norwegian page checker lets through", () => {
  test("an English word anywhere on the page fails the suite, naming the page and the word (AC-3)", () => {
    expect(() => assertInNorwegian("Jobs", `<main><span class="badge">Failed</span></main>`)).toThrow('Jobs: "Failed"');
    expect(() => assertInNorwegian("Jobs", `<main><p>${t("nb", "dialog.cancel")} committed</p></main>`)).toThrow('Jobs: "committed"');
  });

  test("a Norwegian gerund, a duration and a pip's one-letter mark are not English words (AC-3)", () => {
    const html = `<main><p>${GERUND_NB.implement}</p><p>29m 00s</p><p>249h 02m</p><p>5s</p>` +
      `<div aria-hidden="true"><span>C</span><span>A</span></div></main>`;
    expect(wordsNotInCatalogue(html)).toEqual([]);
  });

  test("a one-letter English word outside an aria-hidden mark still fails (AC-3)", () => {
    expect(wordsNotInCatalogue(`<main><p>a</p></main>`)).toEqual(["a"]);
  });

  test("the page shell is read when asked, its About dialog included (AC-3)", () => {
    const html = `<body><header><dialog><h2>About this board</h2></dialog></header><main></main></body>`;
    expect(wordsNotInCatalogue(html)).toEqual([]);
    expect(wordsNotInCatalogue(html, [], "body")).toEqual(["about", "this", "board"]);
  });
});

describe("Settings in Norwegian", () => {
  for (const state of settingsStates()) test(`${state.page} (AC-1)`, check(state));
});

describe("Projects in Norwegian", async () => {
  for (const state of await projectStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("Schedule in Norwegian", () => {
  for (const state of scheduleStates()) test(`${state.page} (AC-3)`, check(state));
});

describe("New spec in Norwegian", () => {
  for (const state of newSpecStates()) test(`${state.page} (AC-4)`, check(state));
});

describe("the Jobs tab in Norwegian", () => {
  for (const state of jobsStates()) test(`${state.page} (AC-1, AC-2)`, check(state));
});

describe("the specs list in Norwegian", () => {
  for (const state of specsListStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("Test servers in Norwegian", () => {
  for (const state of testServerStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("a Schedule entry's runs in Norwegian", () => {
  for (const state of scheduleRunStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("the job page in Norwegian", () => {
  for (const state of jobPageStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("the spec page in Norwegian", () => {
  for (const state of specPageStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("the page shell in Norwegian", () => {
  for (const state of shellStates()) test(`${state.page} (AC-2)`, check(state));
});

describe("every Cancel reads Avbryt", async () => {
  const all = [...settingsStates(), ...(await projectStates()), ...scheduleStates(), ...newSpecStates()];
  test("a page with a Cancel button shows the catalogue's word, never Cancel (AC-5)", () => {
    const found = all.flatMap((state) => cancels(state.html).map((text) => ({ page: state.page, text })));
    expect(found.length).toBeGreaterThan(0);
    for (const { page, text } of found) expect({ page, text }).toEqual({ page, text: t("nb", "dialog.cancel") });
  });
});
