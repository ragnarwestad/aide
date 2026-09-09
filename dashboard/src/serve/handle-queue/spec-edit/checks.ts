// the Checks tab's tick: one box, committed onto the branch the spec is being worked on. One of the three families `handleSpecEditRoutes` asks in
// turn (split 2026-09-04: the file had reached 567 lines). Every
// check is the one it was, in the order it was in, and answers
// `null` for a path that is not its own.
import { saveSpecFiles } from "../../../git/specs-pull.ts";
import { readStatusFromBranch, resolveOpenBranchTarget, writeStatusToBranch } from "../../../git/branch-file.ts";
import { lastCommitOf } from "../../../git/description-freshness.ts";
import { runAideWriteSpec } from "../../../git/run-aide-write-spec.ts";
import { specFileText } from "../../../project/discover.ts";
import {
  acceptanceCriteriaUnticked,
  clearArchiveHeldBack,
  parseStatusChecks,
  tickStatusLine,
  untickStatusLine,
} from "../../../project/parse-status.ts";
import { STATUS_SPEC_FILE, specTabPath } from "../../../render.ts";
import { ARCHIVED_REFUSAL, MAX_SAVE_BODY, bodyToObject, json, logRefusal, readBounded, specsRedirect, tickMessage } from "../../serve-helpers.ts";
import { STATE_SPEC_FILE, specWriteInFlight, stateRelPath } from "./shared.ts";

import type { HandleQueueContext } from "../../handle-queue.ts";

export async function checkRoutes(
  ctx: HandleQueueContext,
  req: Request,
  _url: URL,
  path: string,
  _wantsJson: boolean,
): Promise<Response | null> {
  const tick = path.match(/^\/api\/queue\/specs\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/tick$/);
  if (tick) {
    if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
    const [, project, specFolder] = tick;
    const found = ctx.specDir(project!, specFolder!);
    if (!found) return new Response("not found", { status: 404 });
    const dir = await ctx.machinerySpecDir(project!, found);
    // Before the body is even read: this one WRITES, commits and
    // pushes, and an archived spec's folder is in `archive/`. Hiding
    // the boxes leaves this route reachable for anyone who already
    // has the URL, so the refusal is here and not only on the page.
    if (ctx.specRef(project!, specFolder!)?.archived) {
      logRefusal("tick", `${project}/${specFolder}`, ARCHIVED_REFUSAL);
      return specsRedirect({}, { error: ARCHIVED_REFUSAL }, specTabPath(project!, specFolder!, "checks"));
    }
    // A step that is RUNNING, or a landing in flight, is writing the
    // file this tick would commit onto. A job that is merely queued is
    // not — and an archive job parked on this very tick ("held back:
    // the Acceptance criteria are not all ticked yet") is queued, so
    // refusing on `queued` made the tick and the hold-back wait for
    // each other (371, 2026-09-03).
    const activeJob = ctx.queue.list().some(
      (job) => job.project === project && job.specFolder === specFolder && specWriteInFlight(job),
    );
    if (activeJob) {
      const reason = "another job for this spec is still running — nothing was saved";
      logRefusal("tick", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: reason }, specTabPath(project!, specFolder!, "checks"));
    }
    const sent = await readBounded(req, MAX_SAVE_BODY);
    if ("refusal" in sent) return sent.refusal;
    let body: Record<string, unknown> = {};
    try {
      if (sent.text) body = bodyToObject(sent.text, req.headers.get("content-type")) as Record<string, unknown>;
    } catch {
      return json({ error: "malformed body" }, 400);
    }
    // The Checks tab (renamed from Overview by spec 294), which is
    // where the boxes are — not the bare spec path, which spec 294
    // also made default to Description instead.
    const back = specTabPath(project!, specFolder!, "checks");
    // `bodyToObject` wraps a lone value in an array for the New-spec
    // form's chip set, exactly as it does for `dependsOn`, so both
    // shapes are taken apart the same way.
    // The boxes the reader left TICKED — the whole state of the section,
    // not a list of additions. A browser posts only the checked boxes,
    // so a row missing from this set is a row whose check was taken off,
    // and every box clear is a legitimate press rather than an empty
    // one. That is what makes a mis-click correctable here instead of by
    // hand in `4-status.md`.
    const ticks = (Array.isArray(body.tick) ? body.tick : [body.tick]).filter((v): v is string => typeof v === "string");
    // Every row the form DREW, ticked or not, as its own hidden field.
    // It is what scopes the press: only these rows are decided by it, so
    // a request that carries none changes nothing rather than clearing
    // the section, and a row a run added since the page was drawn is
    // left alone instead of being answered for by a reader who never
    // saw it.
    const drawn = (Array.isArray(body.row) ? body.row : [body.row]).filter((v): v is string => typeof v === "string");
    // Boxes with no phase to read them against is a request that
    // never came from this form.
    if (typeof body.checksPhase !== "string") {
      return specsRedirect({}, { error: "no phase was submitted — nothing was saved" }, back);
    }
    // REQ-1/REQ-4/REQ-6: the same "is this branch open" question the
    // read side asks (`resolveOpenBranchTarget`) — but FRESH, never the
    // cached answer. A branch opened moments ago by `create` or
    // `analyze` must be seen by the very next Save press, or the write
    // silently falls through to `saveSpecFiles`/`main` — the exact bug
    // this spec fixes, reintroduced on the write side by a stale cache
    // hit (see 3-solution.md's Plan review, Coherence's must-fix).
    const branchTarget = await resolveOpenBranchTarget(ctx, dir, specFolder!, STATUS_SPEC_FILE, true);
    // The row-level guard, on top of the file-level `baseSha` one
    // below. A `null` is every way the page can be out of date at
    // once: no such phase, no such row inside it, or a row someone
    // has already ticked in the very commit the page was drawn from
    // — which a sha alone cannot tell from a fresh render.
    //
    // Read fresh off the branch when one is open — never trusting the
    // page's own copy, since a headless run may have moved the branch
    // since the page was drawn — and off disk otherwise, exactly as
    // before REQ-1.
    //
    // Chained one row after another, which is safe because exactly
    // one character moves per tick and the cell keeps its padding:
    // a tick never reflows the table, so every other row's text is
    // still what it was.
    let ticked = branchTarget
      ? ((await readStatusFromBranch(ctx.gitRun, branchTarget.root, branchTarget.branch, branchTarget.relPath))
          ?.text ?? "")
      : (specFileText(dir, STATUS_SPEC_FILE) ?? "");
    // What the file says now, so the press can be read as a state rather
    // than as a list: a row the reader left ticked that is already done
    // needs nothing, and a row that is done and no longer ticked is a
    // check to take off. Read from the same text every write below goes
    // on to change, so the two can never disagree about what was there.
    const asRead = ticked;
    const state = new Map(
      parseStatusChecks(ticked)
        .filter((row) => row.phase === body.checksPhase)
        .map((row) => [row.line, row.done] as const),
    );
    const wanted = new Set(ticks);
    for (const line of drawn) {
      const done = state.get(line);
      if (done === undefined) {
        return specsRedirect(
          {},
          { error: "that check is not there to change any more — reload the page and look again" },
          back,
        );
      }
      if (wanted.has(line) === done) continue;
      const next = done
        ? untickStatusLine(ticked, body.checksPhase, line)
        : tickStatusLine(ticked, body.checksPhase, line);
      // One row that is not there refuses the WHOLE press, the boxes
      // beside it included — never applied silently while one of them
      // is dropped.
      if (next === null) {
        return specsRedirect(
          {},
          { error: "that check is not there to change any more — reload the page and look again" },
          back,
        );
      }
      ticked = next;
    }
    // A press that moved nothing: the reader opened the tab, pressed
    // Save and changed their mind about nothing. Not a refusal, and not
    // a commit either.
    if (ticked === asRead) return specsRedirect({}, undefined, back);
    // Spec 190: the hold-back note goes with the last check it was
    // waiting on. A declined archive run writes `## Archive held
    // back` naming one open row and where to close it out; ticking
    // that row IS closing it out, so leaving the section behind
    // makes the page go on reporting a spec held back after the
    // reason is gone.
    //
    // The ACCEPTANCE rows, not the whole file's: the Phase tables gate
    // nothing (archive's only gate has been the Acceptance section since
    // spec 268), so an implement run that left one of its own rows
    // unticked used to keep the note — and the "held back" wording with
    // it — standing on a spec whose person had judged everything that
    // was theirs to judge.
    if (!acceptanceCriteriaUnticked(ticked)) {
      const cleared = clearArchiveHeldBack(ticked);
      if (cleared !== null) ticked = cleared;
    }
    const statusBaseSha = typeof body.statusBaseSha === "string" && body.statusBaseSha ? body.statusBaseSha : null;
    // spec 355 (REQ-4): the tick lands through the same spawned
    // aide-write-spec every skill's own write already goes through —
    // never a second, TypeScript-side computation of the derived state.
    // Refuses rather than ticking with a state file that would fall out
    // of step with what was just ticked.
    const derived = await runAideWriteSpec(specFolder!, STATUS_SPEC_FILE, ticked);
    if (!derived.ok || !derived.stateJson) {
      const reason = derived.error ?? "the state file could not be derived";
      logRefusal("tick", `${project}/${specFolder}`, reason);
      return specsRedirect({}, { error: `${reason} — nothing was saved` }, back);
    }
    const currentState = await lastCommitOf(ctx.gitRun, dir, STATE_SPEC_FILE);
    // REQ-4: an open branch writes straight onto `refs/heads/aide/<folder>`
    // at origin — never through `saveSpecFiles`, which structurally
    // cannot target anything but the shared checkout's own `HEAD`
    // (see 2-analysis.md's "The write side"). No open branch keeps the
    // exact `saveSpecFiles` call this route has always made (REQ-2).
    // Both cases now land `4-status.md` and `4-status.json` together, in
    // the ONE commit the tick makes.
    const result = branchTarget
      ? await ctx.mergeLock.run(branchTarget.root, () =>
          writeStatusToBranch(
            ctx.gitRun,
            branchTarget.root,
            branchTarget.branch,
            [
              { relPath: branchTarget.relPath, text: ticked },
              { relPath: stateRelPath(branchTarget.relPath), text: derived.stateJson! },
            ],
            statusBaseSha,
            tickMessage(specFolder!),
          ),
        )
      : await ctx.mergeLock.run(await ctx.specsRoot(dir), () =>
          saveSpecFiles(
            ctx.gitRun,
            dir,
            (root) => ctx.branchStatus.defaultBranch(root),
            [
              { file: STATUS_SPEC_FILE, text: ticked, baseSha: statusBaseSha },
              { file: STATE_SPEC_FILE, text: derived.stateJson!, baseSha: currentState?.sha ?? null },
            ],
            { specLabel: specFolder!, message: tickMessage(specFolder!) },
          ),
        );
    if (!result.ok) {
      logRefusal("tick", `${project}/${specFolder}`, result.note);
      return specsRedirect({}, { error: result.note }, back);
    }
    // The branch answer this tick just changed is TTL-cached, and the
    // Specs list reads it to decide whether to say "held back: the
    // Acceptance criteria are not all ticked yet". Forgotten here, the
    // very next render asks git instead of repeating what was true
    // before the Save (337, 2026-09-04).
    ctx.forgetBranchFileSteps?.(dir, specFolder!);
    return specsRedirect({}, undefined, back, { note: result.note, ok: true });
  }

  return null;
}
