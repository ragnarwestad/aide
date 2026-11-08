// Every page the Norwegian-language criteria cover, drawn with Norwegian
// chosen: a word the page writes itself instead of reading from the message
// catalogue fails the test, and the failure names the page and the word.

import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { t } from "../../../../src/i18n";
import {
  newSpecStates,
  projectStates,
  scheduleStates,
  settingsStates,
  type PageState,
} from "./fixtures.ts";
import {
  assertInNorwegian,
  describeFailure,
  wordsNotInCatalogue,
} from "./vocabulary.ts";

const check = (state: PageState) => () =>
  assertInNorwegian(state.page, state.html, state.data);

/** The text of every Cancel button on the page: the one whose id says so, or a dialog's. */
const cancels = (html: string): string[] => {
  const win = new Window();
  win.document.write(html);
  const found = [
    ...win.document.querySelectorAll(
      'button[id$="-cancel"], dialog button[data-close], [data-cancel]',
    ),
  ].map((b) => (b.textContent ?? "").trim());
  void win.happyDOM.close();
  return found;
};

describe("the Norwegian page checker", () => {
  test("names the page and the word written in the page code (AC-6)", () => {
    const html = `<main><p>${t("nb", "dialog.cancel")}</p><p>Quokka</p></main>`;
    expect(() => assertInNorwegian("Settings › Process", html)).toThrow(
      'Settings › Process: "quokka"',
    );
    expect(describeFailure("p", ["a"])).toBe('p: "a"');
  });

  test("reads the placeholder, title and aria-label of an element, not only its text (AC-6)", () => {
    const html = `<main><input placeholder="Quokka" title="Oops" aria-label="Plain"></main>`;
    expect(wordsNotInCatalogue(html)).toEqual(["quokka", "oops", "plain"]);
  });

  test("a whole English text that Norwegian writes differently fails on its own (AC-6)", () => {
    expect(wordsNotInCatalogue(`<main><button>Cancel</button></main>`)).toEqual(
      ["Cancel"],
    );
    expect(
      wordsNotInCatalogue(
        `<main><button>${t("nb", "dialog.cancel")}</button></main>`,
      ),
    ).toEqual([]);
  });

  test("the page's own data and a time stamp are not words (AC-6)", () => {
    const html = `<main><p>kvitsyl 2026-11-03 08:00:00 UTC</p></main>`;
    expect(wordsNotInCatalogue(html, ["kvitsyl"])).toEqual([]);
  });
});

describe("Settings in Norwegian", () => {
  for (const state of settingsStates())
    test(`${state.page} (AC-1)`, check(state));
});

describe("Projects in Norwegian", async () => {
  for (const state of await projectStates())
    test(`${state.page} (AC-2)`, check(state));
});

describe("Schedule in Norwegian", () => {
  for (const state of scheduleStates())
    test(`${state.page} (AC-3)`, check(state));
});

describe("New spec in Norwegian", () => {
  for (const state of newSpecStates())
    test(`${state.page} (AC-4)`, check(state));
});

describe("every Cancel reads Avbryt", async () => {
  const all = [
    ...settingsStates(),
    ...(await projectStates()),
    ...scheduleStates(),
    ...newSpecStates(),
  ];
  test("a page with a Cancel button shows the catalogue's word, never Cancel (AC-5)", () => {
    const found = all.flatMap((state) =>
      cancels(state.html).map((text) => ({ page: state.page, text })),
    );
    expect(found.length).toBeGreaterThan(0);
    for (const { page, text } of found)
      expect({ page, text }).toEqual({ page, text: t("nb", "dialog.cancel") });
  });
});
