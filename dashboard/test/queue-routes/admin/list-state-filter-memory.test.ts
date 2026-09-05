import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// The State filter lived in the query string alone too, and every
// plain link to `/` threw it away the same way the sort was until the
// fix above — the Specs tab, a bookmark, the back button (spec 338).
describe("the state filter the reader chose is remembered", () => {
  /** The `Set-Cookie` this route writes for the state filter, if any. */
  const stateCookie = (res: Response, port: number | undefined): string =>
    res.headers.getSetCookie().find((c) => c.startsWith(`aide_state_${port}=`)) ?? "";
  /** Which state the rendered trigger says is chosen — its label,
   *  without the count beside it (spec 374 dropped the "States:"
   *  prefix in favour of the label and count alone). */
  const triggerLabel = (html: string): string =>
    /<summary[^>]*>([^<]*) \(\d+\)/.exec(html)?.[1] ?? "";

  test("choosing one writes it down, and a bare / gets it back", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const chosen = await fetch(`${base}/?token=${TOKEN}&state=not-archived`);
    expect(stateCookie(chosen, server.port)).toContain(`aide_state_${server.port}=not-archived`);
    expect(triggerLabel(await chosen.text())).toBe("Active");
    const jar = stateCookie(chosen, server.port).split(";")[0]!;
    // The Specs tab: `/` with nothing on it.
    const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
    expect(triggerLabel(await plain.text())).toBe("Active");
  });

  // Pressing an option never reloads the page — the script rewrites
  // the address and fetches the rows alone. A cookie written only on
  // the whole page would never be written by the act of choosing.
  test("the rows-only fetch writes it too", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}&state=done&rows=1`);
    expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=done`);
  });

  test("a link that names a state still wins over what is remembered, including All", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?state=all`, {
      headers: { cookie: `aide_token_${server.port}=${TOKEN}; aide_state_${server.port}=not-archived` },
    });
    expect(triggerLabel(await res.text())).toBe("All");
    // And it becomes the new memory, so the next bare `/` agrees with
    // what the reader is looking at.
    expect(stateCookie(res, server.port)).toContain(`aide_state_${server.port}=all`);
  });

  test("with nothing remembered the default (All) stands", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`);
    expect(triggerLabel(await res.text())).toBe("All");
    expect(stateCookie(res, server.port)).toBe("");
  });

  // REQ-5: the search term is not a citizen of this mechanism.
  test("a remembered search term never comes back on a bare /, even while a remembered state does", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const chosen = await fetch(`${base}/?token=${TOKEN}&state=not-archived&q=foo`);
    const jar = stateCookie(chosen, server.port).split(";")[0]!;
    const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
    const html = await plain.text();
    expect(triggerLabel(html)).toBe("Active");
    expect(html).not.toContain('value="foo"');
  });
});
