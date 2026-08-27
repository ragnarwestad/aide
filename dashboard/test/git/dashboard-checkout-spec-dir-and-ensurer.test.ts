// Split out of dashboard-checkout.test.ts by theme.
//
// Spec 205: the dashboard works in checkouts of its own — see
// dashboard-checkout-clone-and-reuse.test.ts for the full background.
//
// This file covers two pure-logic pieces that need no real git at all:
// `dashboardSpecDir`, which translates a spec folder found in the
// person's checkout into the dashboard's own copy of it, and
// `CheckoutEnsurer` (spec 216), which decides whether a caller is
// handed a run already in flight or one guaranteed to have started
// after it asked.

import { describe, expect, test } from "bun:test";
import { CheckoutEnsurer, dashboardSpecDir, type DashboardCheckout } from "../../src/git/dashboard-checkout.ts";

describe("dashboardSpecDir", () => {
  // What Save and Update need: the display found a spec folder in the
  // person's checkout, and the write has to happen in the dashboard's
  // own copy of that same folder.
  test("translates a spec folder from the person's specs root into the dashboard's", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/home/dev/aide-specs/aide/205-two-checkouts")).toBe(
      "/owned/aide/specs/aide/205-two-checkouts",
    );
  });

  test("an archived spec keeps the archive/ step of its path", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(
      dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/home/dev/aide-specs/aide/archive/149-landing"),
    ).toBe("/owned/aide/specs/aide/archive/149-landing");
  });

  // A folder that is not under the specs root at all names nothing the
  // dashboard owns a copy of, and guessing one would send a commit into
  // a directory nobody asked about.
  test("a folder outside the specs root translates to nothing", () => {
    const checkout = { code: "/owned/aide/code", specs: "/owned/aide/specs/aide", specsRepo: "/owned/aide/specs" };
    expect(dashboardSpecDir(checkout, "/home/dev/aide-specs/aide", "/somewhere/else/205-two-checkouts")).toBeNull();
  });
});

// Spec 216: a run starts from a checkout that is current.
//
// `ensureCheckout` handed a second caller the fetch already in flight
// for that project. A fetch that began before a push answers with the
// picture from before it, so a job queued after the push was started
// against a checkout that did not have it — `unknown spec:
// 215-a-run-leaves-no-branch-that-blocks-the-next-run`, on a spec that
// was on origin (2026-08-23).
//
// The sentence the old code made true was "some fetch for this project
// completed at some point". `fresh` is the second sentence: no answer
// older than the moment I asked. `get` keeps the first, because every
// other caller — a page read, the boot-time warm, a Settings save — is
// happy with it and requirement 3 says they must go on being.
//
// A fake `ensure` whose resolution the test releases by hand, not real
// git: what is under test is the ORDERING of concurrent calls, and real
// timers would make that a race rather than a test.
describe("CheckoutEnsurer (spec 216)", () => {
  const fake = (tag: string): DashboardCheckout => ({ code: tag, specs: `${tag}/specs`, specsRepo: tag });

  function deferred(): { promise: Promise<DashboardCheckout>; resolve: (v: DashboardCheckout) => void } {
    let resolve: (v: DashboardCheckout) => void = () => {};
    const promise = new Promise<DashboardCheckout>((r) => (resolve = r));
    return { promise, resolve };
  }

  /** Let every pending microtask run. A `fresh` that chains a follow-up
   *  settles several microtasks after the run it waited for, so one
   *  `await` would prove nothing either way. */
  const drain = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  // Criterion 1.
  test("fresh does not resolve from a run that was already going when it was asked", async () => {
    const first = deferred();
    const second = deferred();
    const asked: string[] = [];
    const ensurer = new CheckoutEnsurer((project) => {
      asked.push(project);
      return asked.length === 1 ? first.promise : second.promise;
    });

    const inFlight = ensurer.get("aide");
    let freshSettled = false;
    const fresh = ensurer.fresh("aide").then((v) => {
      freshSettled = true;
      return v;
    });

    // The in-flight run answers — with the picture from before the push.
    first.resolve(fake("stale"));
    expect(await inFlight).toEqual(fake("stale"));
    await drain();

    expect(freshSettled).toBe(false);
    expect(asked.length).toBe(2);
    second.resolve(fake("current"));
    expect(await fresh).toEqual(fake("current"));
  });

  // Criterion 2: today's coalescing, unchanged.
  test("get hands two concurrent callers the one run", async () => {
    const only = deferred();
    const asked: string[] = [];
    const ensurer = new CheckoutEnsurer((project) => {
      asked.push(project);
      return only.promise;
    });

    const a = ensurer.get("aide");
    const b = ensurer.get("aide");
    only.resolve(fake("one"));

    expect(await a).toEqual(fake("one"));
    expect(await b).toEqual(fake("one"));
    expect(asked.length).toBe(1);
  });

  // Criterion 3: the cost of `fresh` is bounded per overlap, not per
  // caller — three ticks that all arrive while one run is going share
  // one follow-up between them.
  test("several fresh callers waiting on one run share a single follow-up", async () => {
    const first = deferred();
    const second = deferred();
    const asked: string[] = [];
    const ensurer = new CheckoutEnsurer((project) => {
      asked.push(project);
      return asked.length === 1 ? first.promise : second.promise;
    });

    void ensurer.get("aide");
    const a = ensurer.fresh("aide");
    const b = ensurer.fresh("aide");
    const c = ensurer.fresh("aide");

    first.resolve(fake("stale"));
    await drain();
    expect(asked.length).toBe(2);

    second.resolve(fake("current"));
    expect(await a).toEqual(fake("current"));
    expect(await b).toEqual(fake("current"));
    expect(await c).toEqual(fake("current"));
    expect(asked.length).toBe(2);
  });

  // Criterion 4: nothing in flight is the ordinary case, and it must
  // not cost a second run.
  test("fresh with nothing in flight starts one run and answers from it", async () => {
    const asked: string[] = [];
    const ensurer = new CheckoutEnsurer((project) => {
      asked.push(project);
      return Promise.resolve(fake("only"));
    });

    expect(await ensurer.fresh("aide")).toEqual(fake("only"));
    expect(asked).toEqual(["aide"]);
  });

  // A project is a project: one project's slow run must not make
  // another project's caller wait, nor be answered by it.
  test("the two modes are per project", async () => {
    const held = deferred();
    const asked: string[] = [];
    const ensurer = new CheckoutEnsurer((project) => {
      asked.push(project);
      return project === "aide" ? held.promise : Promise.resolve(fake(project));
    });

    void ensurer.get("aide");
    expect(await ensurer.fresh("woodstack")).toEqual(fake("woodstack"));
    expect(asked).toEqual(["aide", "woodstack"]);
    held.resolve(fake("aide"));
  });
});
