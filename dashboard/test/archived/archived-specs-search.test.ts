// Split out of archived-specs.test.ts by theme.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ALL_VIEW, ARCHIVED_VIEW, LIVE, LIVE_OTHER, LONG_TAIL, OTHER, SAME_DAY, STAMPED, UNSTAMPED,
  harness, order, specsList, start,
} from "./archived-specs-fixtures.ts";

afterEach(() => harness.cleanup());

// --- criterion 6: the search reaches both kinds of row ---------------------

describe("the search field", () => {
  test("is a GET form on the list, so searching needs no script", async () => {
    const html = await specsList(start().base);
    expect(html).toMatch(/<form[^>]*class="specsearch"[^>]*method="get"[^>]*action="\/"/);
    expect(html).toContain('name="q"');
  });

  test("says which three fields it looks in", async () => {
    const html = (await specsList(start().base)).toLowerCase();
    const note = html.slice(html.indexOf('class="specsearch"'), html.indexOf("<table"));
    for (const field of ["folder", "title", "description"]) expect(note).toContain(field);
  });

  // Spec 261: the search reads a spec's project too, in the exact
  // `project:folder` form the row's own tooltip already carries — so
  // the note under the field has to name that form, not "folder" alone.
  test("says the project:folder form it now reads (spec 261)", async () => {
    const html = await specsList(start().base);
    const note = html.slice(html.indexOf('class="specsearch"'), html.indexOf("<table"));
    expect(note).toContain("project:folder");
  });

  // Spec 261: `skjer` is the one project besides `aide` in this harness
  // (`OTHER` and `LIVE_OTHER` are its two specs), and neither spec's
  // folder, title nor description mentions that project's name — so a
  // match here can only come from the project itself joining the
  // haystack.
  test("matches a spec by its project name alone (spec 261)", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=skjer`))).toEqual([
      OTHER,
      LIVE_OTHER,
    ]);
  });

  test("matches the project name with a trailing colon (spec 261)", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=skjer:`))).toEqual([
      OTHER,
      LIVE_OTHER,
    ]);
  });

  test("matches the project name joined to a folder prefix (spec 261)", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=skjer:05-`))).toEqual([OTHER]);
  });

  // The negative half of criterion 4: a project's own name must not
  // reach into a DIFFERENT project's specs, even ones that share
  // nothing with `skjer` in their folder/title/description.
  test("does not cross into a different project (spec 261)", async () => {
    const html = await specsList(start().base, `${ALL_VIEW}&q=skjer`);
    expect(html).not.toContain(LIVE);
    expect(html).not.toContain(STAMPED);
  });

  test("finds an archived spec under the All chip (criterion 6)", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=QUEUE+REMEMBERS`))).toEqual([SAME_DAY]);
  });

  test("matches the folder name", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=push-is-branch`))).toEqual([UNSTAMPED]);
  });

  // The whole description, not the two lines the cell shows: the term
  // is in the last sentence of the long one.
  test("matches text the clamped cell cannot show", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=${LONG_TAIL}`))).toEqual([UNSTAMPED]);
  });

  test("reaches a live spec too, and cuts the archived ones out", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=queue-and-runner`))).toEqual([LIVE]);
  });

  test("keeps the term in the field, so the reader can edit it", async () => {
    expect(await specsList(start().base, `${ALL_VIEW}&q=remembers`)).toContain('value="remembers"');
  });

  test("carries the chip along, so searching does not throw the filter away", async () => {
    const html = await specsList(start().base, ARCHIVED_VIEW);
    const form = html.slice(html.indexOf('class="specsearch"'));
    expect(form.slice(0, form.indexOf("</form>"))).toContain('name="state" value="archived"');
  });

  test("a term with nothing but spaces is no search at all", async () => {
    expect(order(await specsList(start().base, `${ALL_VIEW}&q=++`))).toEqual(
      order(await specsList(start().base, ALL_VIEW)),
    );
  });

  test("a term that matches nothing empties the table and says so", async () => {
    const html = await specsList(start().base, `${ALL_VIEW}&q=zzzznotathing`);
    expect(html).toContain("No spec matches this filter.");
  });
});

// --- spec 226, criteria 4 and 5: one press back to the unfiltered view -----

describe("the search field's clear control", () => {
  /** The form's own markup, so a `×` anywhere else on the page cannot
   *  answer for the one that is supposed to be in the field. */
  const searchForm = (html: string): string => {
    const at = html.indexOf('<form class="specsearch"');
    expect(at).toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</form>", at));
  };

  test("is a link back to the same view with the term dropped (criterion 4)", async () => {
    const form = searchForm(await specsList(start().base, `${ARCHIVED_VIEW}&q=remembers`));
    expect(form).toContain('class="searchclear"');
    // A link, not script: the same "state lives in the URL" shape the
    // fold and the sort already have, so it works with JavaScript off
    // and can be pasted to someone else.
    expect(form).toMatch(/<a class="searchclear"[^>]*href="\/\?state=archived"/);
  });

  test("keeps every other filter the reader had chosen (criterion 4)", async () => {
    const form = searchForm(
      await specsList(start().base, `${ALL_VIEW}&sort=spec&dir=asc&q=remembers`),
    );
    const href = /<a class="searchclear"[^>]*href="([^"]*)"/.exec(form)?.[1] ?? "";
    expect(href).toContain("state=all");
    expect(href).toContain("sort=spec");
    expect(href).toContain("dir=asc");
    expect(href).not.toContain("q=");
  });

  test("is not in the markup when there is nothing to clear (criterion 5)", async () => {
    expect(searchForm(await specsList(start().base, ARCHIVED_VIEW))).not.toContain("searchclear");
    // Nor for a term that is no search at all.
    expect(searchForm(await specsList(start().base, `${ARCHIVED_VIEW}&q=++`))).not.toContain(
      "searchclear",
    );
  });
});
