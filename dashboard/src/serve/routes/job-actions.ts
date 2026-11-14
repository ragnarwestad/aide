// The job-level API routes: listing/creating a job at /api/queue,
// cancel, dismiss, and the two tail-edit routes (steps, model). Extracted
// from routes.ts (split of split serve.ts step 2).
import { previousGroupMember } from "../../project/discover/group.ts";
import { signalGroup } from "../serve-helpers/signal-group.ts";
import { cancelLanding } from "../land-branch/cancel-landing.ts";
import { isLegalMove, phaseFromState } from "../../queue/spec-transitions.ts";
import { inFlight, jobKind, type Job } from "../../queue/queue.ts";
import { endStep } from "../../queue/runner/step-result.ts";
import { cancelCleanupJob } from "../process-cleanup/job.ts";
import { getErrorMessage } from "../../messages/shared/written.ts";
import { bodyToObject, json, logRefusal, readBounded, refusal } from "../serve-helpers";
import type { RoutesContext } from "./";
import { specReference } from "../../project/spec-folder.ts";
import { workflowArc } from "../../workflow-steps.ts";
import { groupBranch } from "../../project/spec-names.ts";
import { enqueueRequest, withRowPicks } from "../../queue/request/index.ts";
import { ExecutionGroupStore, executionGroupAction, type ExecutionGroup, type ExecutionGroupAction } from "../../queue/execution-groups";
import type { SpecTarget } from "../../render";

/** The steps a spec's phase moves through: the ones the run route checks
 *  against the transition table. */
const PHASE_STEPS = new Set(workflowArc().map((step) => step.name));

export function executionGroupForAction(
  store: ExecutionGroupStore,
  id: string,
  targets: Pick<SpecTarget, "project" | "specFolder" | "group">[],
): ExecutionGroup | undefined {
  const registered = store.get(id);
  if (registered) return registered;
  if (!id.startsWith("membership:")) return undefined;
  const rest = id.slice("membership:".length);
  const split = rest.indexOf(":");
  if (split < 1) return undefined;
  const project = rest.slice(0, split);
  const name = rest.slice(split + 1);
  const members = targets
    .filter((target) => target.project === project && target.group?.name === name)
    .sort((a, b) => a.group!.position - b.group!.position || a.specFolder.localeCompare(b.specFolder));
  if (members.length < 2) return undefined;
  return store.prepare({
    project, name, members: members.map((member) => member.specFolder),
    branch: groupBranch(members[0]!.specFolder, name),
  });
}

/** A press on a grouped spec's own row runs as its group's job: the card
 *  follows it, it waits while the group already has a job, and it never
 *  archives the spec alone, since the group lands its shared branch once.
 *  Answers the refusal, or rewrites `askedFor` and answers nothing. */
function joinExecutionGroup(ctx: RoutesContext, askedFor: Record<string, unknown>, name: string): Response | undefined {
  const project = String(askedFor.project);
  const spec = `${project}/${String(askedFor.specFolder)}`;
  const refuse = (reason: string): Response => { logRefusal("run", spec, reason); return json({ error: reason, spec }, 409); };
  const steps = (askedFor.steps as unknown[]).filter((step) => step !== "archive");
  if (steps.length === 0) return refuse(`a spec in the group ${name} is archived with the group: press Archive on the group`);
  askedFor.steps = steps;
  const execution = ctx.queue.executionGroups.findUnfinished(project, name);
  if (!execution) return undefined;
  const busy = ctx.queue.list().some((job) => job.project === project && execution.members.includes(job.specFolder) && inFlight(job));
  if (busy) return refuse(`the group ${name} already has a job queued or running`);
  if (steps.every((step) => step === "analyze" || step === "implement")) askedFor.executionGroupId = execution.id;
  return undefined;
}

export async function handleJobActionRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  const groupAction = path.match(/^\/api\/queue\/groups\/([^/]+)\/action$/);
  if (groupAction) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    let askedAction: ExecutionGroupAction | undefined;
    try {
      const body = sent.text ? bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown> : {};
      if (body.action === "start" || body.action === "stop" || body.action === "archive" || body.action === "remove") askedAction = body.action;
    } catch { return json({ error: "malformed body" }, 400); }
    let groupId: string;
    try { groupId = decodeURIComponent(groupAction[1]!); } catch { return json({ error: "invalid group" }, 400); }
    if (askedAction === "remove") {
      // The record alone decides: a completed group's members are archived, so
      // the member check below would refuse it, and a group known only from its
      // members' `Group:` lines is never completed and must get no record here.
      const recorded = ctx.queue.executionGroups.get(groupId);
      if (!recorded || executionGroupAction(recorded, []) !== "remove") {
        return json({ error: "only a completed group can be removed" }, 409);
      }
      return json({ ok: true, group: ctx.queue.executionGroups.remove(recorded.id) });
    }
    const execution = executionGroupForAction(ctx.queue.executionGroups, groupId, ctx.withFreshness(ctx.targets()));
    if (!execution) return json({ error: "the group no longer exists" }, 409);
    const { project, name } = execution;
    const members = ctx.withFreshness(ctx.targets())
      .filter((target) => target.project === project && target.group?.name === name)
      .sort((a, b) => a.group!.position - b.group!.position || a.specFolder.localeCompare(b.specFolder));
    // A member already archived is done with, not gone: the rest still archive.
    const archived = execution.members.filter((folder) =>
      !members.some((member) => member.specFolder === folder) && ctx.specRef(project, folder)?.archived);
    if (members.length === 0 || members.length + archived.length < 2) return json({ error: "the group no longer exists" }, 409);
    const next = members.find((member) => !(member.done ?? []).includes("implement"));
    const input = {
      project,
      name,
      members: members.map((member) => member.specFolder),
      branch: groupBranch(members[0]!.specFolder, name),
    };
    const historical = ctx.queue.list().filter((job) => job.project === project && input.members.includes(job.specFolder));
    const available = executionGroupAction(execution, [...members.map((member) => ({
      implemented: (member.done ?? []).includes("implement"),
      archived: false,
      acceptanceOpen: !!member.acceptanceOpen,
      busy: historical.some((job) => job.specFolder === member.specFolder && inFlight(job)),
    })), ...archived.map(() => ({ implemented: true, archived: true, acceptanceOpen: false, busy: false }))])
      ?? (execution.state === "prepared" ? "start" : undefined);
    // A POST that names no action never removes, and is refused as before.
    const action = askedAction ?? (available === "remove" ? undefined : available);
    if (!action || action !== available) return json({ error: `the execution group cannot ${askedAction ?? "run"} while it is ${execution.state}` }, 409);
    if (action === "stop") {
      ctx.queue.executionGroups.stop(execution.id);
      const current = historical.find((job) => job.id === execution.jobs.at(-1)?.id)
        ?? historical.find(inFlight);
      if (current) cancelJob(ctx, current);
      return json({ ok: true, group: ctx.queue.executionGroups.get(execution.id) });
    }
    const raw = action === "start"
      ? next ? withRowPicks({ project, specFolder: next.specFolder, steps: ["analyze", "implement"], executionGroupId: execution.id }, ctx.queue) : null
      : action === "archive" && !members.some((member) => member.acceptanceOpen)
        ? {
            project,
            specFolder: members[0]!.specFolder,
            steps: ["archive"],
            // One member left archives as an ordinary spec, on the group's
            // branch through its record: a group archive moves two or more.
            ...(members.length > 1 ? { groupMembers: members.map((member) => member.specFolder), groupBranch: execution.branch } : {}),
            executionGroupId: execution.id,
          }
        : null;
    if (!raw) return json({ error: "every acceptance criterion in the group must be ticked before Archive" }, 409);
    const result = enqueueRequest(ctx.queue, raw, "manual");
    if (!result.ok) return refusal(result, { spec: `${project}/${raw.specFolder}` });
    ctx.queue.executionGroups.update(execution.id, { state: action === "start" ? "queued" : "archiving", currentMember: raw.specFolder, error: undefined });
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }

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
    const askedFor = raw as Record<string, unknown> | null;
    // A backward move — `analyze` or `create`
    // requested on a spec that has already reached a later phase — is
    // refused before the job ever reaches the queue, naming `reset` (or
    // `reopen`, for an archived spec) as the way back. This is the one
    // HTTP-reachable path both the spec-page Reopen control and the
    // specs-list row's Run/Reopen forms post through, and `ctx.specDir`
    // is the resolver the rest of this route reads — no new
    // resolver plumbing. A spec with no state file yet reads as
    // `created`, which the table refuses nothing forward-legal from.
    if (
      typeof askedFor?.project === "string" &&
      typeof askedFor?.specFolder === "string" &&
      Array.isArray(askedFor?.steps)
    ) {
      const dir = ctx.specDir(askedFor.project, askedFor.specFolder);
      if (dir) {
        // The phases by the rule the specs list and the runner's holds read:
        // the spec's own branch when it is settled, main otherwise, and the
        // history. Implement lands nothing, so its step is on the branch
        // alone until archive merges it; read off main alone an archive was
        // refused as "not reached implement yet".
        const { completedPhases, onMain } = ctx.specProgress(dir, askedFor.specFolder);
        const row = ctx.withFreshness(
          ctx.targets().filter((t) => t.project === askedFor.project && t.specFolder === askedFor.specFolder),
        )[0];
        if (row?.group) {
          const earlier = previousGroupMember(
            ctx.withFreshness(ctx.targets()).filter((target) => target.project === askedFor.project), row,
          );
          if (earlier) {
            const spec = `${askedFor.project}/${askedFor.specFolder}`;
            const implemented = earlier.done?.includes("implement");
            if (!implemented) {
              const reason = `${earlier.specFolder} must finish Implement before this grouped spec can start`;
              logRefusal("run", spec, reason);
              return json({ error: reason, spec }, 409);
            }
          }
          const joined = joinExecutionGroup(ctx, askedFor, row.group.name);
          if (joined) return joined;
        }
        // ctx.specRef, not a fresh **Archived:** prose scan: the one
        // resolved answer for this request's own project/specFolder.
        const archived = ctx.specRef(askedFor.project, askedFor.specFolder)?.archived
          ? { date: "" }
          : null;
        // The same ref, the same reasoning — closed is a fact
        // about this request's own project/specFolder, read off the one
        // resolved answer rather than a second, independent check.
        const closed = ctx.specRef(askedFor.project, askedFor.specFolder)?.closed
          ? { date: "" }
          : null;
        // A bundled job (e.g. analyze+implement+archive queued together
        // for a fresh spec, spec-transitions.md's "Into create") asks for
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
            const said = getErrorMessage({
              what: `${specReference(askedFor.project, askedFor.specFolder)}'s analysis has run, but it has not been merged into main, which implement starts from`,
              resolve: "press Analyze again to merge it",
            });
            logRefusal("run", spec, said.text);
            return refusal(said.solution ? { error: said.problem, solution: said.solution } : { error: said.problem }, { spec });
          }
          const move = isLegalMove(phase, step, askedFor.specFolder);
          // Refused here, at the press, with the table's own sentence:
          // a start the runner would refuse — implement before analyze,
          // archive before implement — used to be queued and fail there,
          // minutes later and out of sight. The state is the one the
          // runner reads, the default branch's, so the two cannot differ.
          // Only the four phases: a step the table has no row for
          // (explore …) is not a phase move at all.
          if (!move.ok && !PHASE_STEPS.has(step)) continue;
          if (!move.ok) {
            const spec = `${askedFor.project}/${askedFor.specFolder}`;
            logRefusal("run", spec, move.message);
            return json({ error: move.message, spec }, 400);
          }
          phase = move.next;
        }
      }
    }

    const result = enqueueRequest(ctx.queue, raw, "manual");
    // The row's own Run form is the one HTTP route a reader's
    // phase-checkbox tick actually reaches after create, so it is the
    // ordinary-run counterpart to `enqueueCreate()`'s own seeding
    // (`store.ts`) — only on a SUCCESSFUL enqueue, and only here. Other
    // request paths carry synthetic step lists with no reader's own tick,
    // and must never overwrite a recorded choice with one.
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
      // `spec` for the same reason merge's answer carries it: the page
      // shows a refusal on the row it belongs to, so the answer has to
      // say which.
      return refusal(result, { spec });
    }
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }

  const action = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/cancel$/);
  if (action) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = action;
    const job = ctx.queue.get(id);
    if (!job) return json({ error: "no such job" }, 404);
    // Cancel needs nothing from the body; it is read only so its size
    // is bounded like every other request's.
    const sent = await readBounded(req);
    if ("refusal" in sent) return sent.refusal;
    // A running deploy is this process itself: marked cancelled, it would
    // go on fetching and restarting under a row that says it ended. A
    // queued one has no run yet and is cancelled like any queued job.
    if (job.state === "running" && jobKind(job) === "deploy") {
      const reason = "a deploy cannot be stopped part-way";
      logRefusal("cancel", `${job.project}/${job.specFolder}`, reason);
      return json({ error: reason, spec: `${job.project}/${job.specFolder}` }, 409);
    }
    // Only a job that still owns its work can be cancelled. A finished
    // job's state is history — done, failed, stopped — and writing
    // "cancelled" over it would say someone ended a run that had
    // already ended on its own. The table's own `queued`/`running`
    // entries for `cancel` are what draws that line now.
    const result = cancelJob(ctx, job);
    // A finished step whose work is being merged and tested is still
    // under way: Cancel stops that, and the job ends cancelled.
    if (!result.ok && job.state === "done" && job.landing) return json({ ok: true, job });
    if (!result.ok) {
      const spec = `${job.project}/${job.specFolder}`;
      const reason = `the job is already ${result.state}; only a queued or running job can be cancelled`;
      logRefusal("cancel", spec, reason);
      return json({ error: reason, spec }, 409);
    }
    return json({ ok: true, job: result.job });
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
      return refusal(result, { spec });
    }
    // Now, not on the next two-second timer: a step added in the
    // instant the running one finishes would otherwise wait for it.
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
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
    const provider = typeof body.provider === "string" && body.provider ? body.provider : undefined;
    const result = ctx.queue.editTailModel(id!, step, model, provider);
    if (!result.ok) {
      logRefusal("model", spec, result.error);
      return refusal(result, { spec });
    }
    // A step this job was not queued with is a choice about a job still
    // to come: kept on this job alone, it went when the job ended, and
    // the next run of the step was back on the default.
    if (!(job.steps as string[]).includes(step)) ctx.queue.setPendingModel(job.project, job.specFolder, step, model, provider);
    return json({ ok: true, job: result.job });
  }

  return null;
}

function cancelJob(ctx: RoutesContext, job: Job): ReturnType<typeof endStep> {
  const result = endStep(ctx.queue, job.id, "cancel", {
    finishedAt: new Date().toISOString(), error: undefined, errorReason: undefined,
  });
  if (!result.ok && job.state === "done" && job.landing) cancelLanding(job.id);
  if (result.ok) {
    if (jobKind(job) === "cleanup") cancelCleanupJob(job.id);
    signalGroup(job.pgid);
  }
  return result;
}
