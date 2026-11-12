import { afterEach, describe, expect, test } from "bun:test";
import { setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// The State filter lived in the query string alone too, and every
// plain link to `/` threw it away the same way the sort was until the
// fix above — the Specs tab, a bookmark, the back button.
describe("the state filter the reader chose is remembered", () => {
  /** The `Set-Cookie` this route writes for the state filter, if any. */
  const stateCookie = (res: Response, port: number | undefined): string =>
    res.headers.getSetCookie().find((c) => c.startsWith(`aide_state_${port}=`)) ?? "";
  const tickedLabels = (html: string): string[] =>
    [...html.matchAll(/<a data-nav href="[^"]*" role="checkbox" aria-checked="true"><span[^>]*><\/span>([^<]+) \(\d+\)<\/a>/g)]
      .map((match) => match[1]!);

  test("choosing one writes it down, and a bare / gets it back", async () => {
    const { base, server } = start();
    const chosen = await fetch(`${base}/specs?state=not-archived`);
    expect(stateCookie(chosen, server.port)).toContain(`aide_state_${server.port}=not-archived`);
    expect(tickedLabels(await chosen.text())).toEqual(["Active"]);
    const jar = stateCookie(chosen, server.port).split(";")[0]!;
    // The Specs tab: `/` with nothing on it.
    const plain = await fetch(`${base}/specs`, { headers: { cookie: `${jar}` } });
    expect(tickedLabels(await plain.text())).toEqual(["Active"]);
  });

  // Pressing an option never reloads the page — the script rewrites
  // the address and fetches the rows alone. A cookie written only on
  // the whole page would never be written by the act of choosing.
  test("the rows-only fetch writes it too", async () => {
    const { base, server } = start();
    const res = await fetch(`${base}/specs?state=waiting&rows=1`);
    expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=waiting`);
  });

  test("several states survive the cookie and a later bare visit (AC-7)", async () => {
    const { base, server } = start();
    const chosen = await fetch(`${base}/specs?state=stopped,failed`);
    const jar = stateCookie(chosen, server.port).split(";")[0]!;
    const plain = await fetch(`${base}/specs`, { headers: { cookie: jar } });
    expect(tickedLabels(await plain.text())).toEqual(["Stopped", "Failed"]);
  });

  test("a link that names a state still wins over what is remembered, including All", async () => {
    const { base, server } = start();
    const res = await fetch(`${base}/specs?state=all`, {
      headers: { cookie: `aide_state_${server.port}=not-archived` },
    });
    expect(tickedLabels(await res.text())).toEqual(["All"]);
    // And it becomes the new memory, so the next bare `/` agrees with
    // what the reader is looking at.
    expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=all`);
  });

  test("with nothing remembered the default (All) stands", async () => {
    const { base, server } = start();
    const res = await fetch(`${base}/specs`);
    expect(tickedLabels(await res.text())).toEqual(["All"]);
    expect(stateCookie(res, server.port)).toBe("");
  });

  // The search term is not a citizen of this mechanism.
  test("a remembered search term never comes back on a bare /, even while a remembered state does", async () => {
    const { base, server } = start();
    const chosen = await fetch(`${base}/specs?state=not-archived&q=foo`);
    const jar = stateCookie(chosen, server.port).split(";")[0]!;
    const plain = await fetch(`${base}/specs`, { headers: { cookie: `${jar}` } });
    const html = await plain.text();
    expect(tickedLabels(html)).toEqual(["Active"]);
    expect(html).not.toContain('value="foo"');
  });
});
