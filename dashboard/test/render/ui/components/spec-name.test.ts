import { describe, expect, test } from "bun:test";

import { jobsSentence, projectLink } from "../../../../src/render/ui/components/spec-name.ts";
import { LANGUAGES } from "../../../../src/i18n";

const strip = (html: string): string => html.replace(/<[^>]*>/g, "");

describe("projectLink", () => {
  test("encodes the address and escapes the text (AC-1)", () => {
    expect(projectLink("a&b c")).toBe('<a data-goto href="/projects/a%26b%20c">a&amp;b c</a>');
  });

  test("takes a class of its own (AC-2)", () => {
    expect(projectLink("aide", { className: "muted" })).toBe(
      '<a class="muted" data-goto href="/projects/aide">aide</a>',
    );
  });
});

describe("jobsSentence", () => {
  const names = ["aide:457-a-spec", "ab12cd34", "aide:new-1a2b3c4d", "aide:schedule-nightly"];

  test("a spec's name is two links cut to its number, the whole name as the title; anything else is text (AC-2)", () => {
    const { html } = jobsSentence("en", "shell.restartWaiting", {}, names);
    expect(html).toContain(
      '<a data-goto href="/projects/aide">aide</a><a data-goto href="/specs/aide/457-a-spec" title="aide:457-a-spec">:457</a>, ab12cd34, aide:new-1a2b3c4d, aide:schedule-nightly',
    );
    expect(html.match(/<a /g)).toHaveLength(2);
  });

  test("a short id, a create job's key and a scheduled job's key are never links (AC-2, AC-4)", () => {
    const { html } = jobsSentence("en", "shell.restartWaiting", {}, names.slice(1));
    expect(html).not.toContain("<a ");
  });

  test("the markup with its tags removed is the text, in every language (AC-3)", () => {
    for (const lang of LANGUAGES) {
      const { text, html } = jobsSentence(lang, "shell.restartWaiting", {}, names);
      expect(strip(html)).toBe(text.charAt(0).toUpperCase() + text.slice(1));
    }
  });

  test("values fill the other placeholders, and the text has the names joined, a spec cut to its number (AC-3)", () => {
    const { text, html } = jobsSentence("en", "project.deployRestartWaiting", { sha: "aaaa111" }, ["aide:070-x", "ab12cd34"]);
    expect(text).toContain("aaaa111");
    expect(text).toContain("aide:070, ab12cd34");
    expect(strip(html).toLowerCase()).toBe(text.toLowerCase());
  });

  test("a wiki build is named as the project's wiki, linked to its Wiki tab", () => {
    const { text, html } = jobsSentence("en", "shell.restartWaiting", {}, ["aide:wiki-aide"]);
    expect(text).not.toContain("wiki-aide");
    expect(html).toContain('<a data-goto href="/projects/aide?tab=wiki">');
  });

  test("nothing a job's name holds reaches the page as markup (AC-2)", () => {
    const { html } = jobsSentence("en", "shell.restartWaiting", {}, ['<script>"x"</script>', 'a"b:12-<i>']);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;script&gt;");
  });
});
