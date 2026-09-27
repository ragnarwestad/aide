// The job-level API routes: listing/creating a job at /api/queue,
// cancel, and the two tail-edit routes (steps, model). Extracted
// from routes.ts (split of split serve.ts step 2).
import { readFileSync } from "node:fs";
import { signalGroup } from "../serve-helpers/signal-group.ts";
import { cancelLanding } from "../land-branch/cancel-landing.ts";
import { join } from "node:path";
import { FROM_LIST_FIELD, specPagePath } from "../../render";
import { readSpecState } from "../../project/parse-spec-state.ts";
import { parseStatus } from "../../project/parse-status";
import { isLegalMove, phaseFromState } from "../../queue/spec-transitions.ts";
import { bodyToObject, json, logRefusal, readBounded, specsRedirect } from "../serve-helpers";
import type { RoutesContext } from "./";
import { isWikiBuild } from "../../queue/steps.ts";

// A spec analyzed before spec 355 landed carries no 4-status.json yet —
// the same gap schedules.ts's own `proseSteps` falls back for
// (`blockedForMissingAnalyze`'s doc comment). Reading that absence as
// "nothing has run" would refuse this spec's own, perfectly legal next
// step, so the prose line is the fallback here too.
function proseSteps(dir: string): string[] {
  try {
    return parseStatus(readFileSync(join(dir, "4-status.md"), "utf-8")).workflowSteps;
  } catch {
    return [];
  }
}

/** The steps a spec's phase moves through: the ones the run route checks
 *  against the transition table. */
const PHASE_STEPS = new Set(["create", "analyze", "implement", "archive"]);

export async function handleJobActionRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
  wantsJson: boolean,
): Promise<Response | null> {
  if (path === "/api/queue") {
    if (req.method === "GET") {
      return json({ generatedAt: new Date().toISOString(), jobs: ctx.queue.list() });
    }
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const body = await readBounded(req);
    if ("refusal" in body) return body.refusal;
    let raw: unknown;
    try {
      raw = bodyToObject(body.text, req.headers.get("content-type"));
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // Where a no-script form POST comes back to: the page the press
    // came FROM, because a redirect is the only answer such a form
    // gets and a reader dropped somewhere else cannot tell whether the
    // button did anything (spec 157).
    //
    // Reopen is the one control offered in two places (spec 198, and
    // spec 221 for the row). An archived spec's own page still gets
    // its answer there; a press on the list's own reader row says so
    // with `FROM_LIST_FIELD` and is answered on the list, filter and
    // all — `specsRedirect` rebuilds the view from the `view.*` fields
    // the same form carries. The marker is what decides it, never a
    // destination taken from the browser.
    const askedFor = raw as Record<string, unknown> | null;
    const backTo =
      askedFor?.[FROM_LIST_FIELD] !== "1" &&
      typeof askedFor?.project === "string" &&
      typeof askedFor?.specFolder === "string" &&
      ctx.specRef(askedFor.project, askedFor.specFolder)?.archived
        ? specPagePath(askedFor.project, askedFor.specFolder)
        : "/";
    // REQ-9 (spec 356): a backward move — `analyze` or `create`
    // requested on a spec that has already reached a later phase — is
    // refused before the job ever reaches the queue, naming `reset` (or
    // `reopen`, for an archived spec) as the way back. This is the one
    // HTTP-reachable path both the spec-page Reopen control and the
    // specs-list row's Run/Reopen forms post through, and `ctx.specDir`
    // is the same resolver `backTo`, above, already uses — no new
    // resolver plumbing. A spec with no state file yet reads as
    // `created`, which the table refuses nothing forward-legal from.
    if (
      typeof askedFor?.project === "string" &&
      typeof askedFor?.specFolder === "string" &&
      Array.isArray(askedFor?.steps)
    ) {
      const dir = ctx.specDir(askedFor.project, askedFor.specFolder);
      if (dir) {
        // The default branch's record, and what the spec's own branch and
        // history prove (the row's `done`): implement lands nothing, so its
        // step is on the branch alone until archive merges it, and read off
        // main alone an archive was refused as "not reached implement yet".
        const onMain = readSpecState(dir)?.completedPhases ?? proseSteps(dir);
        const row = ctx.withFreshness(
          ctx.targets().filter((t) => t.project === askedFor.project && t.specFolder === askedFor.specFolder),
        )[0];
        const completedPhases = [...new Set([...onMain, ...(row?.done ?? [])])];
        // ctx.specRef, not a fresh **Archived:** prose scan: it is the
        // same resolved answer `backTo`, above, already reads off this
        // request's own project/specFolder, so an archived spec's phase
        // here can never disagree with what `backTo` decided a request
        // for it was answered on.
        const archived = ctx.specRef(askedFor.project, askedFor.specFolder)?.archived
          ? { date: "" }
          : null;
        // spec 406: the same ref, the same reasoning — closed is a fact
        // about this request's own project/specFolder, read off the one
        // resolved answer rather than a second, independent check.
        const closed = ctx.specRef(askedFor.project, askedFor.specFolder)?.closed
          ? { date: "" }
          : null;
        // A bundled job (e.g. analyze+implement+archive queued together
        // for a fresh spec, spec-lifecycle.md's "Into create") asks for
        // several steps at once, each meant to run only once the one
        // before it has landed — so each step is checked against the
        // phase the ones before it in THIS request would reach, not all
        // against today's snapshot. Only a step this request itself
        // would make illegal is refused; a spec already mid-workflow
        // (implement queued alone while analyzed) starts from its real
        // phase, unaffected by steps it was not asked to run.
        let phase = phaseFromState(completedPhases, archived, closed);
        // Implement starts from main: an analysis that ran but never merged
        // there (its landing failed) is refused as that, not as "not analyzed".
        const analyzedOnMain = onMain.includes("analyze") || askedFor.steps.includes("analyze");
        // An archived or closed spec answers to the queue's own rules —
        // reopen, or archive again while its branch is still on origin
        // (`parse-request.ts`) — not to the phase table.
        for (const step of archived || closed ? [] : askedFor.steps) {
          if (typeof step !== "string") continue;
          if (step === "implement" && phase === "analyzed" && !analyzedOnMain && completedPhases.includes("analyze")) {
            const spec = `${askedFor.project}/${askedFor.specFolder}`;
            const message = `${askedFor.specFolder}'s analysis has run, but it has not been merged into main, which implement starts from — press Analyze again to merge it.`;
            logRefusal("run", spec, message);
            return wantsJson ? json({ error: message, spec }, 400) : specsRedirect(raw, { error: message, spec }, backTo);
          }
          const move = isLegalMove(phase, step, askedFor.specFolder);
          // Refused here, at the press, with the table's own sentence:
          // a start the runner would refuse — implement before analyze,
          // archive before implement — used to be queued and fail there,
          // minutes later and out of sight. The state is the one the
          // runner reads, the default branch's, so the two cannot differ.
          // Only the four phases: a step the table has no row for
          // (explore, manifest, wiki …) is not a phase move at all.
          if (!move.ok && !PHASE_STEPS.has(step)) continue;
          if (!move.ok) {
            const spec = `${askedFor.project}/${askedFor.specFolder}`;
            logRefusal("run", spec, move.message);
            return wantsJson
              ? json({ error: move.message, spec }, 400)
              : specsRedirect(raw, { error: move.message, spec }, backTo);
          }
          phase = move.next;
        }
      }
    }

    const result = ctx.queue.enqueue(raw);
    // Spec 439: the row's own Run form is the one HTTP route a reader's
    // phase-checkbox tick actually reaches after create, so it is the
    // ordinary-run counterpart to `enqueueCreate()`'s own seeding
    // (`store.ts`) — only on a SUCCESSFUL enqueue, and only here: `reset`
    // (`run-controls.ts`), `close` (`close-controls.ts`) and the
    // scheduler each call `ctx.queue.enqueue()` too, with synthetic step
    // lists that carry no reader's own tick, and must never overwrite a
    // recorded choice with one.
    if (result.ok) {
      ctx.queue.setPendingSteps(result.job.project, result.job.specFolder, result.job.steps.filter((s) => s !== "create"));
    }
    if (!result.ok) {
      // Which spec was asked for, off the SUBMITTED fields — the two
      // `parseJobRequest` already requires, so this adds no trust
      // surface. It is never rendered as text either: the page only
      // compares it against a row's own key.
      const asked = raw as Record<string, unknown> | null;
      const spec =
        typeof asked?.project === "string" && typeof asked?.specFolder === "string"
          ? `${asked.project}/${asked.specFolder}`
          : undefined;
      logRefusal("run", spec, result.error);
      // A person who pressed a button gets the reason on the page
      // they pressed it from; an API caller gets a status code.
      // `spec` for the same reason merge's answer carries it: the page
      // shows a refusal on the row it belongs to and no longer
      // navigates to find out which, so the answer has to say.
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(raw, { error: result.error, spec }, backTo);
    }
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(raw, undefined, backTo);
  }

  const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/cancel$/);
  if (action) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = action;
    const job = ctx.queue.get(id);
    if (!job) return json({ error: "no such job" }, 404);
    // The body is read for ONE thing: the view the press came from,
    // so the redirect can put the reader back on it. A JSON caller
    // sends no body at all, and an unparseable one is not a reason to
    // refuse an action that needs nothing from it.
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let view: unknown = {};
    try {
      if (sent.text) view = bodyToObject(sent.text, req.headers.get("content-type"));
    } catch {
      view = {};
    }
    // Only a job that still owns its work can be cancelled. A finished
    // job's state is history — done, failed, stopped — and writing
    // "cancelled" over it would say someone ended a run that had
    // already ended on its own. The table's own `queued`/`running`
    // entries for `cancel` are what draws that line now.
    const result = ctx.queue.transition(id, "cancel", {
      finishedAt: new Date().toISOString(),
      // A held-back `error`/`errorReason` describes why the job was NOT
      // running a moment ago; cancelling answers that question a different
      // way; the old reason must not survive to say the wrong thing.
      error: undefined,
      errorReason: undefined,
    });
    // A finished step whose work is being merged and tested is still
    // under way: Cancel stops that, and the job ends cancelled.
    if (!result.ok && job.state === "done" && job.landing) {
      cancelLanding(id);
      return wantsJson ? json({ ok: true, job }) : specsRedirect(view);
    }
    if (!result.ok) {
      const spec = `${job.project}/${job.specFolder}`;
      const reason = `the job is already ${result.state}; only a queued or running job can be cancelled`;
      logRefusal("cancel", spec, reason);
      return wantsJson ? json({ error: reason, spec }, 409) : specsRedirect(view, { error: reason, spec });
    }
    // SIGTERM to the GROUP, never a bare pid: claude spawns
    // children, and a kill that only reaches the parent is not a
    // bound.
    signalGroup(job.pgid);
    // A wiki build is followed on its project's Wiki tab, and that is where
    // its Cancel came from.
    if (!wantsJson && isWikiBuild(job)) {
      return new Response(null, {
        status: 303,
        headers: { location: `/projects/${encodeURIComponent(job.project)}?tab=wiki&wikitab=build` },
      });
    }
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(view);
  }

  const tailEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/steps$/);
  if (tailEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    // A form sends the tick as text, an API caller as a boolean. Both
    // say the same thing, and the box's own state is what they say:
    // ticked adds the step, unticked removes it.
    const checked = body.checked;
    const add =
      checked === true ||
      (typeof checked === "string" && ["1", "true", "on", "yes"].includes(checked.toLowerCase()));
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailStep(id!, step, add);
    if (!result.ok) {
      logRefusal("steps", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    // Now, not on the next two-second timer: a step added in the
    // instant the running one finishes would otherwise wait for it.
    await ctx.tickRunner();
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  const tailModelEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/model$/);
  if (tailModelEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailModelEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    const step = typeof body.step === "string" ? body.step : "";
    const model = typeof body.model === "string" ? body.model : "";
    const spec = `${job.project}/${job.specFolder}`;
    const result = ctx.queue.editTailModel(id!, step, model);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return wantsJson
        ? json({ error: result.error, spec }, 400)
        : specsRedirect(body, { error: result.error, spec });
    }
    // A step this job was not queued with is a choice about a job still
    // to come: kept on this job alone, it went when the job ended, and
    // the next run of the step was back on the default.
    if (!(job.steps as string[]).includes(step)) ctx.queue.setPendingModel(job.project, job.specFolder, step, model);
    return wantsJson ? json({ ok: true, job: result.job }) : specsRedirect(body);
  }

  return null;
}
