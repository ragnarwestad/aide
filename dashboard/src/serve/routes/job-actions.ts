import { canCancelDeploy } from "../../queue/job-rules/activity.ts";
import { handleJobRowAction } from "./job-row/index.ts";
// The job-level API routes: listing/creating a job at /api/queue,
// cancel, and the two tail-edit routes (steps, model). Extracted
// from routes.ts (split of split serve.ts step 2).
import { previousGroupMember } from "../../project/discover/group.ts";
import { isLegalMove, phaseFromState } from "../../queue/spec-transitions.ts";
import { inFlight, jobKind } from "../../queue/queue.ts";
import { getErrorMessage } from "../../messages/shared/written.ts";
import { json, logRefusal, readBounded, readObjectBody, refusal } from "../serve-helpers";
import type { RoutesContext } from "./";
import type { Job } from "../../queue/types.ts";
import type { SpecTarget } from "../../render";
import { specReference } from "../../project/spec-folder.ts";
import { workflowArc } from "../../workflow-steps.ts";
import { enqueueRequest, groupRowPicks } from "../../queue/request/index.ts";
import { type ExecutionGroup } from "../../queue/execution-groups";
import { groupBlocksIndividualRun } from "../../queue/execution-groups/actions.ts";
import { createExecutionGroup } from "./spec-edit/group.ts";
export { executionGroupForAction } from "./spec-edit/execution-group-action.ts";
import { cancelJob, groupsActionRoute } from "./spec-edit/group-action.ts";

/** The steps a spec's phase moves through: the ones the run route checks
 *  against the transition table. */
const PHASE_STEPS = new Set(workflowArc().map((step) => step.name));

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

// A backward move — `analyze` or `create`
// requested on a spec that has already reached a later phase — is
// refused before the job ever reaches the queue, naming `reset` (or
// `reopen`, for an archived spec) as the way back. This is the one
// HTTP-reachable path both the spec-page Reopen control and the
// specs-list row's Run/Reopen forms post through, and `ctx.specDir`
// is the resolver the rest of this route reads — no new
// resolver plumbing. A spec with no state file yet reads as
// `created`, which the table refuses nothing forward-legal from.
function phaseRefusal(ctx: RoutesContext, askedFor: Record<string, unknown>): Response | undefined {
  if (typeof askedFor.project !== "string" || typeof askedFor.specFolder !== "string" || !Array.isArray(askedFor.steps)) return undefined;
  const asked = askedFor as Record<string, unknown> & { project: string; specFolder: string; steps: unknown[] };
  const dir = ctx.specDir(asked.project, asked.specFolder);
  if (!dir) return undefined;
  // The phases by the rule the specs list and the runner's holds read:
  // the spec's own branch when it is settled, main otherwise, and the
  // history. Implement lands nothing, so its step is on the branch
  // alone until archive merges it; read off main alone an archive was
  // refused as "not reached implement yet".
  const { completedPhases, onMain } = ctx.specProgress(dir, asked.specFolder);
  const row = ctx.withFreshness(
    ctx.targets().filter((t) => t.project === asked.project && t.specFolder === asked.specFolder),
  )[0];
  if (row?.group) {
    const refusedForGroup = groupRunRefusal(ctx, asked, row as SpecTarget & { group: NonNullable<SpecTarget["group"]> });
    if (refusedForGroup) return refusedForGroup;
  }
  // ctx.specRef, not a fresh **Archived:** prose scan: the one
  // resolved answer for this request's own project/specFolder.
  const archived = ctx.specRef(asked.project, asked.specFolder)?.archived
    ? { date: "" }
    : null;
  // The same ref, the same reasoning — closed is a fact
  // about this request's own project/specFolder, read off the one
  // resolved answer rather than a second, independent check.
  const closed = ctx.specRef(asked.project, asked.specFolder)?.closed
    ? { date: "" }
    : null;
  return stepsRefusal(asked, { completedPhases, onMain, archived, closed });
}

/** A grouped spec runs after the member before it has implemented, and as its group's job. */
function groupRunRefusal(ctx: RoutesContext, askedFor: Record<string, unknown> & { project: string; specFolder: string }, row: SpecTarget & { group: NonNullable<SpecTarget["group"]> }): Response | undefined {
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
  return undefined;
}

/** Each step against the phase the ones before it in this request reach. */
function stepsRefusal(
  askedFor: Record<string, unknown> & { project: string; specFolder: string; steps: unknown[] },
  o: { completedPhases: string[]; onMain: string[]; archived: { date: string } | null; closed: { date: string } | null },
): Response | undefined {
  const { completedPhases, onMain, archived, closed } = o;
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
  return undefined;
}

const selected = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value]).map(String);

/** A run with peers ticked makes their execution group first, and runs as its job. */
async function groupForRun(ctx: RoutesContext, askedFor: Record<string, unknown>): Promise<ExecutionGroup | undefined | Response> {
  const peers = selected(askedFor.member);
  if (!peers.length || typeof askedFor.project !== "string" || typeof askedFor.specFolder !== "string") return undefined;
  {
    const groupName = typeof askedFor.groupName === "string" ? askedFor.groupName.trim() : "";
    if (!groupName) return json({ error: "group name is required" }, 400);
    const steps = selected(askedFor.steps).filter((step) => step !== "archive");
    if (!steps.length) return json({ error: "a group starts with Analyze or Implement; Archive runs on the group" }, 409);
    askedFor.steps = steps;
    const positions = selected(askedFor.position).map(Number);
    const orderedPeers = peers.map((member, index) => ({ member, position: positions[index] ?? index + 1 }))
      .sort((a, b) => a.position - b.position).map(({ member }) => member);
    const made = await createExecutionGroup(ctx, {
      project: askedFor.project,
      name: groupName,
      members: [askedFor.specFolder, ...orderedPeers],
      lead: askedFor.specFolder,
      sharedChoices: true,
    });
    if (!made.ok) return made.response;
    const archiveModel = typeof askedFor.model === "string" ? askedFor.model : (askedFor.model as Record<string, unknown> | undefined)?.archive;
    const archiveProvider = (askedFor.provider as Record<string, unknown> | undefined)?.archive;
    const createdGroup = ctx.queue.executionGroups.update(made.group.id, {
      ...(typeof archiveModel === "string" && archiveModel ? { archiveModel } : {}),
      ...(typeof archiveProvider === "string" && archiveProvider ? { archiveProvider } : {}),
    });
    askedFor.executionGroupId = made.group.id;
    askedFor.specFolder = made.group.members[0]!;
    return createdGroup;
  }
}

// The row's own Run form is the one HTTP route a reader's
// phase-checkbox tick actually reaches after create, so it is the
// ordinary-run counterpart to `enqueueCreate()`'s own seeding
// (`store.ts`) — only on a SUCCESSFUL enqueue, and only here. Other
// request paths carry synthetic step lists with no reader's own tick,
// and must never overwrite a recorded choice with one.
function recordRunChoices(ctx: RoutesContext, askedFor: Record<string, unknown>, job: Job, createdGroup: ExecutionGroup | undefined): void {
  ctx.queue.setPendingSteps(job.project, job.specFolder, job.steps.filter((s) => s !== "create"));
  if (createdGroup) {
    ctx.queue.executionGroups.queueMember(createdGroup.id, job.specFolder);
    for (const pick of groupRowPicks(askedFor, job)) {
      for (const folder of createdGroup.members) {
        const saved = ctx.queue.setPendingModel(createdGroup.project, folder, pick.part, pick.model, pick.provider);
        if (!saved.ok) logRefusal("model", `${createdGroup.project}/${folder}`, saved.error);
      }
    }
  }
}

// Which spec was asked for, off the SUBMITTED fields — the two
// `parseJobRequest` already requires, so this adds no trust
// surface. It is never rendered as text either: the page only
// compares it against a row's own key.
// `spec` for the same reason merge's answer carries it: the page
// shows a refusal on the row it belongs to, so the answer has to
// say which.
async function runRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  if (path === "/api/queue") {
    if (req.method === "GET") {
      return json({ generatedAt: new Date().toISOString(), jobs: ctx.queue.list() });
    }
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const askedFor = sent.body;
    if (typeof askedFor.project === "string" && typeof askedFor.specFolder === "string" &&
      groupBlocksIndividualRun(ctx.queue, askedFor.project, askedFor.specFolder)) {
      const spec = `${askedFor.project}/${askedFor.specFolder}`;
      const error = "this spec belongs to an active group — start or stop it from the group";
      logRefusal("run", spec, error);
      return json({ error, spec }, 409);
    }
    const refused = phaseRefusal(ctx, askedFor);
    if (refused) return refused;

    const created = await groupForRun(ctx, askedFor);
    if (created instanceof Response) return created;
    const createdGroup = created;
    const result = enqueueRequest(ctx.queue, askedFor, "manual");
    if (result.ok) recordRunChoices(ctx, askedFor, result.job, createdGroup);
    if (!result.ok) {
      const spec =
        typeof askedFor.project === "string" && typeof askedFor.specFolder === "string"
          ? `${askedFor.project}/${askedFor.specFolder}`
          : undefined;
      logRefusal("run", spec, result.error);
      return refusal(result, { spec });
    }
    await ctx.tickRunner();
    return json({ ok: true, job: result.job });
  }
  return null;
}

async function cancelRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

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
    // A waiting deploy observes cancellation before fetching or firing the restart.
    if (job.state === "running" && jobKind(job) === "deploy" && !canCancelDeploy(job)) {
      const reason = "a deploy cannot be stopped part-way";
      logRefusal("cancel", `${job.project}/${job.specFolder}`, reason);
      return json({ error: reason, spec: `${job.project}/${job.specFolder}` }, 409);
    }
    if (jobKind(job) === "land" && job.state === "running" && job.landPushStarted) {
      return json({ error: "Land cannot be stopped after push has begun", spec: `${job.project}/${job.specFolder}` }, 409);
    }
    // Only a job that still owns its work can be cancelled. A finished
    // job's state is history — done, failed, stopped — and writing
    // "cancelled" over it would say someone ended a run that had
    // already ended on its own. The table's own `queued`/`running`
    // entries for `cancel` draw that line, with a separate event for a scheduled quota wait.
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
  return null;
}

async function jobRowRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  const rowAction = await handleJobRowAction(ctx, req, path);
  if (rowAction) return rowAction;
  return null;
}

async function stepsRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  const tailEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/steps$/);
  if (tailEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
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
  return null;
}

async function modelRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {

  const tailModelEdit = path.match(/^\/api\/queue\/([A-Za-z0-9-]+)\/model$/);
  if (tailModelEdit) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, id] = tailModelEdit;
    const job = ctx.queue.get(id!);
    if (!job) return json({ error: "no such job" }, 404);
    const sent = await readObjectBody(req);
    if ("refusal" in sent) return sent.refusal;
    const body = sent.body;
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

export async function handleJobActionRoutes(
  ctx: RoutesContext,
  req: Request,
  path: string,
): Promise<Response | null> {
  return (
    (await groupsActionRoute(ctx, req, path)) ??
    (await runRoute(ctx, req, path)) ??
    (await cancelRoute(ctx, req, path)) ??
    (await jobRowRoute(ctx, req, path)) ??
    (await stepsRoute(ctx, req, path)) ??
    (await modelRoute(ctx, req, path)) ??
    null
  );
}

