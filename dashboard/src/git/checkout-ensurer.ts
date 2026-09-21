// One `ensureDashboardCheckout` per project at a time, and who may ask
// for an answer no older than their own call.
//
// Split out of dashboard-checkout.ts to keep that file inside the
// 500-line limit (`dashboard/CLAUDE.md`, "Code health"): the decision
// here is its own — who waits for whose answer — and nothing else in
// that file shares it.

import type { DashboardCheckout } from "./dashboard-checkout.ts";

/** Who may be handed a bring-up-to-date that is already running, and who
 *  may not (spec 216).
 *
 *  One `git fetch` per project at a time is the right shape for almost
 *  everything here: a page read, the boot-time warm and a Settings save
 *  all want a checkout that is roughly current, and two fetches into one
 *  directory buy nothing. That is `get`, and it is what this whole area
 *  did before this class existed.
 *
 *  The runner needs a different sentence. A fetch that began before a
 *  push answers with the picture from before it, so a job queued after
 *  the push and started off that answer runs against a checkout that
 *  does not have it — `unknown spec:
 *  215-a-run-leaves-no-branch-that-blocks-the-next-run`, on a spec that
 *  was on origin (2026-08-23). With several projects going, something is
 *  usually in flight, so this is not a narrow window.
 *
 *  `fresh` is that second sentence: no answer older than the moment I
 *  asked. It waits for whatever is running and then runs once more.
 *  Every `fresh` caller that piles up while it waits shares that one
 *  follow-up, so the extra cost is one run per overlap, not one per
 *  caller — and a project with nothing in flight pays nothing at all,
 *  which is what keeps an idle project fetching exactly as often as it
 *  did before.
 *
 *  `tickRunner` is the one caller that needs `fresh`. Reaching for `get`
 *  there — it is the shorter name, and both compile — puts the race
 *  back. */
export class CheckoutEnsurer {
  /** The run going on right now, per project. */
  private readonly running = new Map<string, Promise<DashboardCheckout | undefined>>();
  /** The follow-up run promised to the `fresh` callers that arrived
   *  while `running` was busy — one per project, shared by all of them. */
  private readonly queued = new Map<string, Promise<DashboardCheckout | undefined>>();

  constructor(private readonly ensure: (project: string, mayClone: boolean) => Promise<DashboardCheckout | undefined>) {}

  /** Any answer that eventually arrives is good enough. */
  get(project: string): Promise<DashboardCheckout | undefined> {
    return this.running.get(project) ?? this.start(project);
  }

  /** The one entry that may CLONE: a press that adds a project, or saves
   *  the specs root a clone would be made of. Never joined to a run
   *  already going, because that one was told not to clone. */
  make(project: string): Promise<DashboardCheckout | undefined> {
    return this.start(project, true);
  }

  /** No answer older than this call. */
  fresh(project: string): Promise<DashboardCheckout | undefined> {
    const promised = this.queued.get(project);
    if (promised) return promised;
    const running = this.running.get(project);
    if (!running) return this.start(project);
    // Both arms, because a run that FAILED still says nothing about
    // origin as it is now — and a rejection that ended the chain would
    // leave the entry in `queued` for ever.
    const next = running.then(
      () => this.start(project),
      () => this.start(project),
    );
    this.queued.set(project, next);
    return next.finally(() => {
      if (this.queued.get(project) === next) this.queued.delete(project);
    });
  }

  private start(project: string, mayClone = false): Promise<DashboardCheckout | undefined> {
    const started = this.ensure(project, mayClone).finally(() => {
      if (this.running.get(project) === started) this.running.delete(project);
    });
    this.running.set(project, started);
    return started;
  }
}
