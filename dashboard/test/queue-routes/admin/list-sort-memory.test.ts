import { afterEach, describe, expect, test } from "bun:test";
import { TOKEN, setupQueueRoutesHarness } from "../fixtures.ts";

const { harness, start } = setupQueueRoutesHarness();

afterEach(() => {
  harness.cleanup();
});

// The sort lived in the query string alone, and every plain link to
// `/` there is threw it away: the Specs tab, the redirect after
// Create, a bookmark, the installed app's launch. The reader picked
// Started, went to a spec, came back, and was on the default again
// (asked for 2026-08-23).
describe("the column the reader sorted by is remembered", () => {
  /** The `Set-Cookie` this route writes for the sort, if any. */
  const sortCookie = (res: Response, port: number | undefined): string =>
    res.headers.getSetCookie().find((c) => c.startsWith(`aide_sort_${port}=`)) ?? "";
  /** Which column the rendered table says it is sorted by. */
  const sortedBy = (html: string): string =>
    /<a class="sortlink on[^"]*"[^>]*>([A-Za-z]+)</.exec(html)?.[1] ?? "";

  test("choosing one writes it down, and a bare / gets it back", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const chosen = await fetch(`${base}/?token=${TOKEN}&sort=started`);
    expect(sortCookie(chosen, server.port)).toContain(`aide_sort_${server.port}=started`);
    expect(sortedBy(await chosen.text())).toBe("Time");
    const jar = sortCookie(chosen, server.port).split(";")[0]!;
    // The Specs tab: `/` with nothing on it. The token rides along
    // because every request needs it, not because the sort does.
    const plain = await fetch(`${base}/`, { headers: { cookie: `aide_token_${server.port}=${TOKEN}; ${jar}` } });
    expect(sortedBy(await plain.text())).toBe("Time");
  });

  // Pressing a heading never reloads the page — the script rewrites
  // the address and fetches the rows alone. A cookie written only on
  // the whole page would never be written by the act of choosing.
  test("the rows-only fetch writes it too", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}&sort=cost&rows=1`);
    expect(sortCookie(res, server.port)).toContain(`aide_sort_${server.port}=cost`);
  });

  test("a link that names a sort still wins over what is remembered", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?sort=state`, {
      headers: { cookie: `aide_token_${server.port}=${TOKEN}; aide_sort_${server.port}=started|desc` },
    });
    expect(sortedBy(await res.text())).toBe("State");
    // And it becomes the new memory, so the next bare `/` agrees with
    // what the reader is looking at.
    expect(sortCookie(res, server.port)).toContain(`aide_sort_${server.port}=state`);
  });

  // Spec 317 changed the default sort from Spec to Created.
  test("with nothing remembered the default stands", async () => {
    const { base, server } = start({ queueToken: TOKEN });
    const res = await fetch(`${base}/?token=${TOKEN}`);
    expect(sortedBy(await res.text())).toBe("Created");
    expect(sortCookie(res, server.port)).toBe("");
  });
});
