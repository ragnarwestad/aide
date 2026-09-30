// No page reads a message from its own address: a refusal or a notice is
// written into the page by the page script, from the answer to the press
// that made it, and a message typed into the address is drawn nowhere.
import { afterEach, describe, expect, test } from "bun:test";
import { queueHarness } from "../helpers/queue-server.ts";

const harness = queueHarness("aide-pages-ignore-query-");
afterEach(() => harness.cleanup());

const SPEC = "aide/81-queue-and-runner";
const MARKS = {
  error: "zqxerrormark",
  notice: "zqxnoticemark",
  deployError: "zqxdeploymark",
  wikiError: "zqxwikimark",
};
const QUERY = [
  `error=${MARKS.error}`,
  `errorSpec=${encodeURIComponent(SPEC)}`,
  `notice=${MARKS.notice}`,
  "noticeOk=1",
  `deployError=${MARKS.deployError}`,
  `wikiError=${MARKS.wikiError}`,
].join("&");

const PAGES: [string, string][] = [
  ["the Specs list", "/"],
  ["the Specs list's redraw", "/?rows=1"],
  ["New spec", "/new"],
  ["Settings", "/settings"],
  ["Settings' Process tab", "/settings?tab=process"],
  ["Settings' Claude tab", "/settings?tab=claude"],
  ["Projects", "/projects"],
  ["Add project", "/projects/new"],
  ["a project's Deploy tab", "/projects/aide?tab=deploy"],
  ["a project's Config tab", "/projects/aide?tab=config"],
  ["a project's Schedule tab", "/projects/aide?tab=schedule"],
  ["a project's Wiki build panel", "/projects/aide?tab=wiki&wikitab=build"],
  ["Schedule", "/schedule"],
  ["a spec's page", `/specs/${SPEC}`],
  ["a spec's Status tab", `/specs/${SPEC}?tab=status`],
];

describe("a message in the address is drawn nowhere", () => {
  for (const [name, path] of PAGES) {
    test(`${name} draws no message from its address (AC-2)`, async () => {
      const { base } = harness.start();
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(`${base}${path}${sep}${QUERY}`);
      expect(res.status).toBe(200);
      // The text a reader sees, not the links: a page carries its own
      // address on into its links and forms, and that is not a message.
      const text = (await res.text()).replace(/<[^>]*>/g, " ").toLowerCase();
      expect(Object.values(MARKS).filter((mark) => text.includes(mark))).toEqual([]);
    });
  }
});
