// "← Back" on a page with tabs: the page script remembers, for the browser
// tab, where Back led when the page was opened from somewhere else, and
// puts it back when the page is loaded from itself — a tab, an Edit link,
// a save that loads the page again.
import { describe, expect, test } from "bun:test";
import { keepBack, keptBack, type Here } from "../../../src/specs-client/back-link";

const HERE: Here = { href: "http://dash.test/projects/aide?tab=config", host: "dash.test", pathname: "/projects/aide" };

describe("keptBack", () => {
  test("loaded from itself, it answers what was remembered and remembers nothing new (AC-1)", () => {
    const got = keptBack({
      served: "/projects", referrer: "http://dash.test/projects/aide?tab=deploy", here: HERE, stored: "/",
    });
    expect(got).toEqual({ href: "/" });
  });

  test("opened with no referrer, it keeps the default and remembers it for the next tab (AC-2)", () => {
    const first = keptBack({ served: "/projects", referrer: "", here: HERE, stored: "/" });
    expect(first).toEqual({ href: "/projects", remember: "/projects" });
    const next = keptBack({
      served: "/projects", referrer: "http://dash.test/projects/aide", here: HERE, stored: first.remember!,
    });
    expect(next.href).toBe("/projects");
  });

  test("opened again from another page, that page replaces what was remembered (AC-3)", () => {
    const got = keptBack({
      served: "/settings", referrer: "http://dash.test/settings", here: HERE, stored: "/specs/aide/81-queue-and-runner",
    });
    expect(got).toEqual({ href: "/settings", remember: "/settings" });
  });

  test("a remembered value off the board, or on the page itself, is never used (AC-4)", () => {
    const bad = [
      "https://evil.example/",
      "//evil.example/x",
      "/\\evil.example",
      "/projects\u0000/x",
      "/projects/aide",
      "/projects/aide?tab=config",
    ];
    for (const stored of bad) {
      const got = keptBack({ served: "/projects", referrer: "http://dash.test/projects/aide?tab=deploy", here: HERE, stored });
      expect(got.href).toBe("/projects");
    }
  });

  test("a referrer on the page's own path on another host counts as opened from elsewhere (AC-4)", () => {
    const got = keptBack({ served: "/projects", referrer: "http://evil.example/projects/aide", here: HERE, stored: "/" });
    expect(got).toEqual({ href: "/projects", remember: "/projects" });
  });
});

/** A page whose Back link the server drew to `served`, or a page with none. */
function page(served: string | null) {
  const link = {
    href: served,
    getAttribute: (name: string) => (name === "href" ? link.href : null),
    setAttribute: (name: string, value: string) => {
      if (name === "href") link.href = value;
    },
  };
  const doc = {
    querySelector: (sel: string) => (served !== null && sel === "a.backlink[data-keep]" ? link : null),
  } as unknown as Document;
  return { doc, link };
}

/** Storage that holds what it is given, and records every call. */
function memory(held: Record<string, string> = {}) {
  const calls: string[] = [];
  const storage = {
    getItem: (key: string) => {
      calls.push(`get ${key}`);
      return held[key] ?? null;
    },
    setItem: (key: string, value: string) => {
      calls.push(`set ${key}`);
      held[key] = value;
    },
  } as unknown as Storage;
  return { storage, held, calls };
}

describe("keepBack", () => {
  test("puts the remembered Back on the link when the page is loaded from itself (AC-1)", () => {
    const { doc, link } = page("/projects");
    const { storage } = memory({ "back:/projects/aide": "/" });
    keepBack(doc, { referrer: () => "http://dash.test/projects/aide?tab=deploy", here: () => HERE, storage: () => storage });
    expect(link.href).toBe("/");
  });

  test("opened from elsewhere, it remembers the Back the server drew (AC-1)", () => {
    const { doc, link } = page("/");
    const { storage, held } = memory();
    keepBack(doc, { referrer: () => "http://dash.test/", here: () => HERE, storage: () => storage });
    expect(link.href).toBe("/");
    expect(held["back:/projects/aide"]).toBe("/");
  });

  test("storage that cannot be reached leaves the link as drawn and throws nothing (AC-2)", () => {
    const loadedFromItself = () => "http://dash.test/projects/aide?tab=deploy";
    const throwing = () => {
      throw new Error("blocked");
    };
    const { doc, link } = page("/projects");
    expect(() => keepBack(doc, { referrer: loadedFromItself, here: () => HERE, storage: throwing })).not.toThrow();
    expect(link.href).toBe("/projects");

    const refusing = { getItem: throwing, setItem: throwing } as unknown as Storage;
    for (const referrer of [loadedFromItself, () => ""]) {
      const drawn = page("/projects");
      expect(() => keepBack(drawn.doc, { referrer, here: () => HERE, storage: () => refusing })).not.toThrow();
      expect(drawn.link.href).toBe("/projects");
    }
  });

  test("a page without a kept Back link is left alone, storage untouched (AC-2)", () => {
    const { doc } = page(null);
    let reached = false;
    keepBack(doc, {
      referrer: () => "http://dash.test/projects/aide",
      here: () => HERE,
      storage: () => {
        reached = true;
        return memory().storage;
      },
    });
    expect(reached).toBe(false);
  });
});
