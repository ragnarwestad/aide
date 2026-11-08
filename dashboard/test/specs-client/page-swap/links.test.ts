import { expect, test } from "bun:test";
import {
  sameAddress,
  takesLink,
} from "../../../src/specs-client/page-swap/links";

const here = "http://board.test/specs?tab=running";

function link(
  href: string,
  o: { target?: string; download?: boolean; rel?: string } = {},
) {
  return {
    target: o.target ?? "",
    hasAttribute: (name: string) => name === "download" && !!o.download,
    getAttribute: (name: string) =>
      name === "href" ? href : name === "rel" ? (o.rel ?? "") : null,
  } as unknown as HTMLAnchorElement;
}

function click(o: Partial<MouseEvent> = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...o,
  } as MouseEvent;
}

test("takes a plain board link and keeps its referrer (AC-1)", () => {
  expect(takesLink(click(), link("/settings"), here)?.url.href).toBe(
    "http://board.test/settings",
  );
  expect(
    takesLink(click(), link("/settings", { rel: "noreferrer" }), here)
      ?.referrer,
  ).toBe("none");
});

test("leaves special and external links to the browser (AC-6)", () => {
  for (const [event, anchor] of [
    [click({ ctrlKey: true }), link("/settings")],
    [click({ button: 1 }), link("/settings")],
    [click(), link("https://elsewhere.test/")],
    [click(), link("/api/version")],
    [click(), link("#part")],
    [click(), link("/file", { download: true })],
    [click(), link("/settings", { target: "_blank" })],
  ] as [MouseEvent, HTMLAnchorElement][])
    expect(takesLink(event, anchor, here)).toBeNull();
});

test("compares addresses without their hash (AC-8)", () => {
  expect(
    sameAddress(
      "/specs?tab=running#one",
      "http://board.test/specs?tab=running#two",
    ),
  ).toBe(true);
  expect(sameAddress("/specs?tab=specs", here)).toBe(false);
});
