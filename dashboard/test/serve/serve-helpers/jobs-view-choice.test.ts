// The Jobs tab's memory of its view: an address that names any view key is the
// whole view and becomes the memory, a bare address gets the memory back, and
// the Specs list's own two cookies are never read by it nor it by them.

import { describe, expect, test } from "bun:test";
import {
  cookieValue,
  jobsViewChoice,
  jobsViewCookieName,
  sortChoice,
  sortCookieName,
  stateChoice,
  stateCookieName,
} from "../../../src/serve/serve-helpers";

const PORT = 8788;

const ask = (query: string, cookies: Record<string, string> = {}, path = "/") => {
  const url = new URL(`http://127.0.0.1:${PORT}${path}${query ? `?${query}` : ""}`);
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  const req = new Request(url, { headers: cookie ? { cookie } : {} });
  return { url, req };
};

/** What the cookie a choice set holds, as the keys it names. */
const stored = (setCookie: string | undefined): Record<string, string> => {
  const value = cookieValue(setCookie ?? null, jobsViewCookieName(PORT));
  return Object.fromEntries(new URLSearchParams(value ?? ""));
};

const remembered = { [jobsViewCookieName(PORT)]: "state=stopped&q=wiki" };

describe("an address that names a view key is the view and becomes the memory (AC-7)", () => {
  test("the keys it names are the view, and a cookie of the tab's own holds them (AC-7)", () => {
    const { url, req } = ask("state=failed&project=other&sort=cost&dir=asc&q=wiki");
    const choice = jobsViewChoice(url, req, PORT);
    expect(choice.view).toEqual({ state: "failed", project: "other", sort: "cost", dir: "asc", q: "wiki" });
    expect(stored(choice.setCookie)).toEqual({ state: "failed", project: "other", sort: "cost", dir: "asc", q: "wiki" });
    expect(choice.setCookie).toContain("HttpOnly");
    expect(choice.setCookie).toContain("Path=/");
  });

  test("it replaces the memory whole: a key the address leaves out is forgotten (AC-7)", () => {
    const { url, req } = ask("state=all", remembered);
    const choice = jobsViewChoice(url, req, PORT);
    expect(choice.view).toEqual({ state: "all" });
    expect(stored(choice.setCookie)).toEqual({ state: "all" });
  });

  test("a key named empty counts as named, and is remembered as nothing (AC-7)", () => {
    const { url, req } = ask("q=", remembered);
    const choice = jobsViewChoice(url, req, PORT);
    expect(choice.view).toEqual({});
    expect(choice.setCookie).toBeDefined();
    expect(stored(choice.setCookie)).toEqual({});
    // The next bare address brings back nothing.
    const bare = ask("", { [jobsViewCookieName(PORT)]: cookieValue(choice.setCookie ?? null, jobsViewCookieName(PORT)) ?? "" });
    expect(jobsViewChoice(bare.url, bare.req, PORT).view).toEqual({});
  });

  test("an address naming none gets the view last chosen, and sets no cookie (AC-7)", () => {
    const { url, req } = ask("rows=1&open=aide/81-x", remembered);
    const choice = jobsViewChoice(url, req, PORT);
    expect(choice.view).toEqual({ state: "stopped", q: "wiki" });
    expect(choice.setCookie).toBeUndefined();
  });

  test("with no cookie and no key the view is empty: All, every project, no search, the tab's order (AC-7)", () => {
    const { url, req } = ask("");
    const choice = jobsViewChoice(url, req, PORT);
    expect(choice.view).toEqual({});
    expect(choice.setCookie).toBeUndefined();
  });

  test("only the five view keys are remembered, whatever a cookie holds (AC-7)", () => {
    const { url, req } = ask("", { [jobsViewCookieName(PORT)]: "q=x&open=aide/81-x&lang=nb&sort=cost" });
    expect(jobsViewChoice(url, req, PORT).view).toEqual({ q: "x", sort: "cost" });
  });
});

describe("the Jobs tab and the Specs list never read each other's memory (AC-5)", () => {
  test("the Specs list's state and sort cookies give the Jobs tab an empty view (AC-5)", () => {
    const { url, req } = ask("", { [stateCookieName(PORT)]: "failed", [sortCookieName(PORT)]: "cost|asc" });
    expect(jobsViewChoice(url, req, PORT).view).toEqual({});
  });

  test("the Jobs tab's cookie gives the Specs list nothing remembered (AC-5)", () => {
    const { url, req } = ask("", remembered, "/specs");
    expect(stateChoice(url, req, PORT)).toEqual({});
    expect(sortChoice(url, req, PORT)).toEqual({});
  });

  test("the cookie is named after the port, as the Specs list's two are (AC-5)", () => {
    expect(jobsViewCookieName(PORT)).toBe(`aide_jobs_view_${PORT}`);
    expect(jobsViewCookieName(PORT)).not.toBe(jobsViewCookieName(PORT + 1));
  });
});
