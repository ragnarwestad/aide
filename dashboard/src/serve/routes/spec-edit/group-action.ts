// The execution group's own action route — Start, Stop, Archive and Remove
// on the group's card — and the cancel every job route shares.

import { canCancelScheduleWait, cancelScheduleWait, scheduleCancellationFields } from "../../../queue/schedule-attempt";
import { stopLand } from "../../land-job/control.ts";
import { groupStartPlan, readGroupPhaseChoices } from "../../../queue/execution-groups/phase-plan.ts";
// The job-level API routes: listing/creating a job at /api/queue,
// cancel, and the two tail-edit routes (steps, model). Extracted
// from routes.ts (split of split serve.ts step 2).
import { lockedGroupMembers, orderGroupMembers, validateExecutionGroupEdit } from "../../../queue/execution-groups/eligibility.ts";
import { signalGroup } from "../../serve-helpers/signal-group.ts";
import { cancelLanding } from "../../land-branch/cancel-landing.ts";
import { inFlight, jobKind, type Job } from "../../../queue/queue.ts";
import { endStep } from "../../../queue/runner/step-result.ts";
import { cancelCleanupJob } from "../../process-cleanup/job.ts";
import { json, logRefusal, readObjectBody, refusal } from "../../serve-helpers";
import type { RoutesContext } from "../";
import type { SpecTarget } from "../../../render";
import { groupBranch } from "../../../project/spec-names.ts";
import { enqueueRequest, withRowPicks } from "../../../queue/request/index.ts";
import { executionGroupAction, memberImplemented, waitingGroupJob, type ExecutionGroup, type ExecutionGroupAction } from "../../../queue/execution-groups";
import { editGroup, removeExecutionGroup } from "../spec-edit/group.ts";
import { executionGroupForAction } from "../spec-edit/execution-group-action.ts";
export { executionGroupForAction } from "../spec-edit/execution-group-action.ts";


/** Start on a group before the board's first specs sweep: what each member has
 *  done is not known yet, and an unread member reads as having done nothing. */
const SPECS_NOT_READ = "The board is still reading the specs: press Start again in a moment.";

export function cancelJob(ctx: RoutesContext, job: Job): ReturnType<typeof endStep> {
  if (canCancelScheduleWait(job)) return cancelScheduleWait(ctx.queue, job);
  if (job.state === "running" && jobKind(job) === "land") stopLand(job.id);
  const result = endStep(ctx.queue, job.id, "cancel", {
    ...(jobKind(job) === "schedule" ? scheduleCancellationFields : {}),
    // A usage-limit wait cancelled is not retried when the limit resets.
    ...(job.state === "waiting" ? { usageLimitWait: undefined, usageLimitProbe: undefined, stopReason: undefined } : {}),
    finishedAt: new Date().toISOString(), error: undefined, errorReason: undefined,
  });
  if (!result.ok && job.state === "done" && job.landing) cancelLanding(job.id);
  if (result.ok) {
    if (jobKind(job) === "cleanup") cancelCleanupJob(job.id);
    signalGroup(job.pgid);
  }
  return result;
}

/** What a group action's body asks for; undefined for a body it cannot read. */
function readGroupAction(body: Record<string, unknown>) {
  let memberSteps: Record<string, string[]> = {};
  let askedAction: ExecutionGroupAction | undefined;
  let askedModel: string | undefined;
  let askedProvider: string | undefined;
  try {
    memberSteps = readGroupPhaseChoices(body.memberSteps);
    if (body.action === "start" || body.action === "stop" || body.action === "archive" || body.action === "remove") askedAction = body.action;
    if (typeof body.model === "string" && body.model) askedModel = body.model;
    if (typeof body.provider === "string" && body.provider) askedProvider = body.provider;
  } catch { return undefined; }
  return { memberSteps, askedAction, askedModel, askedProvider };
}

/** The one action the group's card offers now. */
function availableGroupAction(
  execution: ExecutionGroup,
  o: { members: SpecTarget[]; archived: string[]; memberSteps: Record<string, string[]>; historical: Job[] },
): ExecutionGroupAction | undefined {
  const { members, archived, memberSteps, historical } = o;
  const waiting = waitingGroupJob(execution, historical);
  return executionGroupAction(execution, [...members.map((member) => ({
    implemented: memberImplemented(execution, member.specFolder, member.done ?? []) && !memberSteps[member.specFolder]?.length,
    archived: false,
    acceptanceOpen: !!member.acceptanceOpen,
    automaticWaiting: waiting?.specFolder === member.specFolder,
    busy: historical.some((job) => job.specFolder === member.specFolder && inFlight(job)),
  })), ...archived.map(() => ({ implemented: true, archived: true, acceptanceOpen: false, busy: false }))])
    ?? (execution.state === "prepared" ? "start" : undefined);
}

/** Stop: the group stopped, its running jobs cancelled and its waits ended. */
function stopGroup(ctx: RoutesContext, execution: ExecutionGroup, historical: Job[]): Response {
  ctx.queue.executionGroups.stop(execution.id, true);
  for (const job of historical) {
    if (inFlight(job)) cancelJob(ctx, job);
    else if (job.state === "waiting") ctx.queue.transition(job.id, "cancel-schedule-wait", { usageLimitWait: undefined, usageLimitProbe: undefined, finishedAt: new Date().toISOString() });
  }
  return json({ ok: true, group: ctx.queue.executionGroups.get(execution.id) });
}

/** Start: refused before the specs are read, and a member order that
 *  changed is saved first and the start asked again. */
async function startRefusal(
  ctx: RoutesContext, req: Request, path: string,
  o: { execution: ExecutionGroup; members: SpecTarget[]; memberSteps: Record<string, string[]> },
): Promise<Response | undefined> {
  const { execution, members, memberSteps } = o;
  const { project, name } = execution;
  if (ctx.specsScanned?.() === false) {
    logRefusal("group start", `${project}/${name}`, SPECS_NOT_READ);
    return json({ error: SPECS_NOT_READ }, 409);
  }
  const targets = ctx.withFreshness(ctx.targets());
  const activeGroup = { ...execution, members: members.map((member) => member.specFolder) };
  const checked = members.length === 1 ? orderGroupMembers(activeGroup.members, members) : validateExecutionGroupEdit({
    project, group: activeGroup, members: activeGroup.members,
    locked: lockedGroupMembers({ group: activeGroup, targets, jobs: ctx.queue.list() }),
    targets, groups: ctx.queue.executionGroups.list(), jobs: ctx.queue.list(),
  });
  if (!checked.ok) return json({ error: checked.error }, 409);
  if (checked.members.some((folder, index) => folder !== members[index]?.specFolder)) {
    const saved = await editGroup(ctx, new Request(req.url, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, member: checked.members }),
    }), execution.id);
    if (!saved.ok) return saved;
    return (await groupsActionRoute(ctx, new Request(req.url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "start", memberSteps }),
    }), path)) ?? undefined;
  }
  return undefined;
}

/** The job an action queues: the next member's phases on Start, the group's archive on Archive. */
function groupJobRequest(
  ctx: RoutesContext,
  o: { action: ExecutionGroupAction; execution: ExecutionGroup; members: SpecTarget[]; plan: Record<string, string[]>; next: SpecTarget | undefined;
    askedModel?: string; askedProvider?: string },
) {
  const { action, execution, members, plan, next, askedModel, askedProvider } = o;
  const { project } = execution;
  return action === "start"
    ? next ? withRowPicks({
        project, specFolder: next.specFolder, executionGroupId: execution.id,
        steps: plan[next.specFolder],
      }, ctx.queue) : null
    : action === "archive" && !members.some((member) => member.acceptanceOpen)
      ? (() => {
        const base = withRowPicks({
          project,
          specFolder: members[0]!.specFolder,
          steps: ["archive"],
          // One member left archives as an ordinary spec, on the group's
          // branch through its record: a group archive moves two or more.
          ...(members.length > 1 ? { groupMembers: members.map((member) => member.specFolder), groupBranch: execution.branch } : {}),
          executionGroupId: execution.id,
        }, ctx.queue);
        const model = askedModel ?? execution.archiveModel ?? base.model.archive;
        const provider = askedProvider ?? execution.archiveProvider ?? base.provider.archive;
        if (askedModel) ctx.queue.executionGroups.update(execution.id, {
          archiveModel: askedModel,
          archiveProvider: askedProvider,
        });
        return {
          ...base,
          model: { ...base.model, ...(model ? { archive: model } : {}) },
          provider: { ...base.provider, ...(provider ? { archive: provider } : {}) },
        };
      })()
      : null;
}

export async function groupsActionRoute(ctx: RoutesContext, req: Request, path: string): Promise<Response | null> {
  const groupAction = path.match(/^\/api\/queue\/groups\/([^/]+)\/action$/);
  if (!groupAction) return null;
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const sent = await readObjectBody(req);
  if ("refusal" in sent) return sent.refusal;
  const askedFor = readGroupAction(sent.body);
  if (!askedFor) return json({ error: "malformed body" }, 400);
  const { memberSteps, askedAction, askedModel, askedProvider } = askedFor;
  let groupId: string;
  try { groupId = decodeURIComponent(groupAction[1]!); } catch { return json({ error: "invalid group" }, 400); }
  if (askedAction === "remove") return removeExecutionGroup(ctx, groupId);
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
  if (Object.keys(memberSteps).some((folder) => !members.some((member) => member.specFolder === folder))) return json({ error: "unknown group member" }, 400);
  const plan = groupStartPlan(members, Object.fromEntries(members.map((member) => [member.specFolder,
    ctx.queue.pendingSteps[`${project}/${member.specFolder}`] ?? []])), memberSteps);
  const next = members.find((member) => plan[member.specFolder]!.length > 0);
  const input = {
    project,
    name,
    members: members.map((member) => member.specFolder),
    branch: groupBranch(members[0]!.specFolder, name),
  };
  const historical = ctx.queue.list().filter((job) => job.project === project && input.members.includes(job.specFolder));
  const available = availableGroupAction(execution, { members, archived, memberSteps, historical });
  // A POST that names no action never removes, and is refused as before.
  const action = askedAction ?? (available === "remove" ? undefined : available);
  if (!action || action !== available) return json({ error: `the execution group cannot ${askedAction ?? "run"} while it is ${execution.state}` }, 409);
  if (action === "stop") return stopGroup(ctx, execution, historical);
  if (action === "start") {
    const refused = await startRefusal(ctx, req, path, { execution, members, memberSteps });
    if (refused) return refused;
  }
  const raw = groupJobRequest(ctx, { action, execution, members, plan, next, askedModel, askedProvider });
  if (!raw) return json({ error: action === "start" ? "select a member phase before Start" : "every acceptance criterion in the group must be ticked before Archive" }, 409);
  const result = enqueueRequest(ctx.queue, raw, "manual");
  if (!result.ok) return refusal(result, { spec: `${project}/${raw.specFolder}` });
  if (action === "start") ctx.queue.executionGroups.update(execution.id, { memberSteps: plan, sharedChoices: false,
    completedMembers: execution.completedMembers.filter((folder) => !plan[folder]?.length) });
  ctx.queue.executionGroups.update(execution.id, { state: action === "start" ? "queued" : "archiving", currentMember: raw.specFolder, error: undefined });
  await ctx.tickRunner();
  return json({ ok: true, job: result.job });
}
