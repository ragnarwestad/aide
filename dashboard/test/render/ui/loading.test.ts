// Spec 515: the spec page's first chunk carries a loading element, and the
// second chunk hides it with CSS. These tests pin the rules the two halves
// have to keep: what is in the head, where the hide rule sits, that the
// split page is the page it was, and that the generated site knows nothing
// of any of it.
import { describe, expect, test } from "bun:test";
import { renderSite, renderSpecPage, renderSpecPageHead, renderSpecPageRest, type ProjectView } from "../../../src/render";
import { shellHead, shellRest, pageShell } from "../../../src/render/ui/shell.ts";
import { LOADING_CSS, LOADING_HIDE_RULE, loadingBlock } from "../../../src/render/ui/loading.ts";
import { CSS } from "../../../src/render/ui/css";
import { t, type Language } from "../../../src/i18n";
import { GENERATED, NAV, NOW, view } from "../pages/spec-page-fixtures.ts";

const LANGS: Language[] = ["en", "nb", "de", "es", "fr"];
const FOLDER = "150-one-page-shows-the-whole-spec";
const REST_OPTS = { now: NOW, scriptSrc: "/spec-editor.js", lang: "en" as Language };

describe("the first chunk carries the loading element (AC-2)", () => {
  for (const lang of LANGS) {
    test(`${lang}: the element, both marks and the word (AC-2)`, () => {
      const head = renderSpecPageHead(FOLDER, lang);
      expect(head).toContain('class="pageloading"');
      expect(head).toContain('role="status"');
      // Both theme copies of the mark, four bars each.
      const element = head.slice(head.indexOf('class="pageloading"'));
      expect(element.match(/<rect/g)?.length).toBe(8);
      expect(element).toContain("mark-l");
      expect(element).toContain("mark-d");
      expect(element).toContain(t(lang, "shell.loadingPage"));
    });
  }

  test("the English word is the description's own (AC-2)", () => {
    expect(t("en", "shell.loadingPage")).toBe("Loading …");
  });

  test("the element stands above the header's own z-index of 100 (AC-2)", () => {
    const z = LOADING_CSS.match(/\.pageloading\s*\{[^}]*z-index:\s*(\d+)/)?.[1];
    expect(Number(z)).toBeGreaterThan(100);
  });

  test("the head ends with the loading block and holds no refresh (AC-1)", () => {
    const head = renderSpecPageHead(FOLDER, "en");
    expect(head).toContain("<!doctype html>");
    expect(head).toContain("<body");
    expect(head.endsWith(loadingBlock("en"))).toBe(true);
    expect(head).not.toContain("http-equiv");
  });
});

describe("the hide rule sits at the end of the body (AC-3)", () => {
  const rest = renderSpecPageRest(view(), GENERATED, NAV, REST_OPTS);
  const all = renderSpecPageHead(FOLDER, "en") + rest;

  test("it appears once, after </main> and before the first script that follows it (AC-3)", () => {
    expect(all.split(LOADING_HIDE_RULE).length - 1).toBe(1);
    const main = all.indexOf("</main>");
    const rule = all.indexOf(LOADING_HIDE_RULE);
    const script = all.indexOf("<script", main);
    expect(script).toBeGreaterThan(main);
    expect(rule).toBeGreaterThan(main);
    expect(rule).toBeLessThan(script);
  });

  test("no script in the response mentions pageloading (AC-3)", () => {
    const scripts = [...all.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((s) => s.includes("pageloading"))).toEqual([]);
  });
});

describe("the split page is the page it was (AC-1)", () => {
  test("head + rest, less the loading block and the hide rule, equals renderSpecPage (AC-1)", () => {
    const v = view();
    const whole = renderSpecPage(v, GENERATED, NAV, { ...REST_OPTS, tab: "description" });
    const head = renderSpecPageHead(FOLDER, "en").replace(loadingBlock("en"), "");
    const rest = renderSpecPageRest(v, GENERATED, NAV, { ...REST_OPTS, tab: "description" }).replace(LOADING_HIDE_RULE, "");
    expect(head + rest).toBe(whole);
  });

  test("the Steps tab's refresh is the very start of the rest, and not in the head (AC-1)", () => {
    const rest = renderSpecPageRest(view(), GENERATED, NAV, { ...REST_OPTS, tab: "steps" });
    expect(rest.startsWith("<meta http-equiv=\"refresh\" content=\"10\">") || rest.startsWith("\n<meta http-equiv=\"refresh\"")).toBe(true);
    expect(rest.indexOf("http-equiv")).toBeLessThan(rest.indexOf("<header>"));
    expect(renderSpecPageHead(FOLDER, "en")).not.toContain("http-equiv");
  });

  test("another tab has no refresh in either chunk (AC-1)", () => {
    const rest = renderSpecPageRest(view(), GENERATED, NAV, { ...REST_OPTS, tab: "description" });
    expect(rest).not.toContain("http-equiv");
  });
});

describe("the generated site is unaffected (AC-5)", () => {
  const project: ProjectView = { name: "aide", manifest: { ok: true, data: { name: "aide" } }, specs: [] };
  const pages = renderSite([project], GENERATED);

  test("pageShell is shellHead + shellRest for the same input (AC-5)", () => {
    const entries = [{ label: "Projects", path: "projects.html" }];
    const whole = pageShell("Title", entries, "projects.html", "<p>body</p>", GENERATED, undefined, { lang: "nb" });
    const parts =
      shellHead("Title", { lang: "nb" }) + shellRest(entries, "projects.html", "Title", "<p>body</p>", { lang: "nb" });
    expect(parts).toBe(whole);
  });

  test("no generated page, and not the stylesheet, holds the loading element (AC-5)", () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      for (const needle of ["pageloading", LOADING_HIDE_RULE, ...LANGS.map((l) => t(l, "shell.loadingPage"))]) {
        expect([p.path, p.html.includes(needle)]).toEqual([p.path, false]);
      }
    }
    expect(CSS).not.toContain("pageloading");
  });
});
