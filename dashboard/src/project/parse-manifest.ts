// Normalize hand-edited .aide/project.yaml into one render shape.
// The two real manifests already diverge (logging.where is a string
// in one, a list in the other) — normalization is the point.

import { normalize as normalizePath } from "node:path";
import { CronExpressionParser } from "cron-parser";
import { parse } from "yaml";

/** The same character class `queue.ts`'s `NAME_RE` checks a job's own
 *  names against — a schedule entry's name becomes half of a job's
 *  `schedule-<name>` tracking key, which has to survive as a git branch
 *  name and a directory-shaped string wherever the queue writes it. Not
 *  imported from `queue.ts`: this module is read by things that parse a
 *  manifest with no queue in the picture at all. */
export const SCHEDULE_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** One recurring job (spec 259): a cron expression and the prompt file
 *  its run sends verbatim, relative to the project root. */
export interface ScheduleEntry {
  name: string;
  cron: string;
  prompt: string;
  /** Absent or anything but the literal boolean `false` means enabled —
   *  an existing entry with no such field keeps firing exactly as it
   *  always has. */
  enabled: boolean;
  /** Which model every fire of this entry runs on — a NAME out of the
   *  queue config's own `modelChoices` table, exactly like the name a
   *  spec's phase line posts. Absent means the entry never picked one
   *  and the configuration's own `schedule` default decides, which is
   *  what every entry written before this field did. */
  model?: string;
}

export interface ManifestData {
  name?: string;
  description?: string;
  generated?: string;
  stack?: Record<string, string>;
  dependencies?: string[];
  /** `preview` is a URL TEMPLATE with a literal `{branch}` in it —
   *  where one branch can be tried, as opposed to `url`, which is
   *  where the merged site lives. Only a project whose host builds
   *  every branch has one. */
  deployment?: { host?: string; command?: string; url?: string; preview?: string; note?: string };
  logging?: { where: string[] };
  statistics?: string[];
  reports?: { title?: string; url?: string; recipe?: string }[];
  docs?: string[];
  /** The gitignored paths a run has to symlink into its worktree, space
   *  separated (spec 184). Here rather than in `.aide/config` because it
   *  is true of the PROJECT on any machine — that a Vite project needs
   *  `node_modules` does not depend on whose laptop it is checked out
   *  on — and `.aide/config` is dropped by a global ignore rule, so a
   *  clone arrived on the next machine with that knowledge gone.
   *
   *  A scalar, not a list, and the dashboard writes it: `aide-run-spec`
   *  reads the same line with one anchored `sed`, and the run's own
   *  refusal wording names this key when the value came from here. */
  worktreeLinks?: string;
  /** Whether this project's archived CODE goes straight onto its default
   *  branch, or waits for a pull request (spec 220). Absent means
   *  `merge`, which is what every project did before this key existed.
   *
   *  Here rather than in `.aide/config` for a sharper reason than the
   *  worktree links have: whether code is reviewed before it lands is a
   *  TEAM policy, and `.aide/config` is dropped by a global ignore rule
   *  — a policy a fresh clone cannot see is a policy the project does
   *  not have. It has no `.aide/config` fallback at all, unlike
   *  `worktreeLinks`, which has one only because it had an older
   *  spelling to migrate from.
   *
   *  A value this does not recognize is left ABSENT rather than carried
   *  through, so no reader downstream has to decide for itself what a
   *  word it has never heard means. */
  codeLanding?: "merge" | "pr";
  /** Recurring jobs this project wants run on a schedule (spec 259).
   *  Committed and reviewed, the same trust level `codeLanding` has — no
   *  `.aide/config` fallback, because a schedule is team policy, not a
   *  per-machine setting. Absent when the project has none.
   *
   *  Each entry is validated on its own and a bad one is DROPPED rather
   *  than carried through with a guess: a `prompt:` path that would
   *  escape the project root, or a `cron:` expression that does not
   *  parse. The array itself is omitted when nothing survived, so a
   *  reader never has to tell "no schedule" apart from "every entry was
   *  malformed" — both render the same, absent, section. */
  schedule?: ScheduleEntry[];
  /** What installing this project means, and its own test command —
   *  both read the same way as `worktreeLinks` (spec 345):
   *  `.aide/config`'s `AIDE_INSTALL_CMD`/`AIDE_TEST_CMD` override these
   *  per machine when set, but a fresh clone that has never been
   *  configured locally still knows both, because they are usually the
   *  same on every machine the project runs on. Unlike `worktreeLinks`
   *  the config file wins here, not the manifest — an install/test
   *  command can legitimately differ on one machine (a PATH prefix a
   *  shell needs, say) in a way a worktree link cannot. */
  installCmd?: string;
  testCmd?: string;
}

/** Whether `path`, read relative to the project root, could resolve
 *  outside it — an absolute path, or one whose `..` segments climb past
 *  the root. Purely a shape check on the string: it never touches the
 *  filesystem, so it works the same for a `prompt:` value that is never
 *  going to exist as for one that does (spec 259, acceptance criterion
 *  8 — the entry is dropped at PARSE time, before anything reads it). */
export function escapesRoot(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(path)) return true;
  const normalized = normalizePath(path).replace(/\\/g, "/");
  return normalized === ".." || normalized.startsWith("../");
}

export type ManifestResult =
  | { ok: true; data: ManifestData }
  | { ok: false; error: string };

function toList(v: unknown): string[] | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function toStr(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

export function parseManifest(text: string): ManifestResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "manifest is not a YAML mapping" };
  }
  const r = raw as Record<string, unknown>;
  const data: ManifestData = {};

  if (r.name != null) data.name = toStr(r.name);
  if (r.description != null) data.description = toStr(r.description);
  if (r.generated != null) data.generated = toStr(r.generated);
  if (r.stack != null && typeof r.stack === "object" && !Array.isArray(r.stack)) {
    data.stack = Object.fromEntries(
      Object.entries(r.stack as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    );
  }
  if (r.dependencies != null) data.dependencies = toList(r.dependencies);
  if (r.deployment != null && typeof r.deployment === "object") {
    const d = r.deployment as Record<string, unknown>;
    data.deployment = {
      ...(d.host != null && { host: toStr(d.host) }),
      ...(d.command != null && { command: toStr(d.command) }),
      ...(d.url != null && { url: toStr(d.url) }),
      ...(d.preview != null && { preview: toStr(d.preview) }),
      ...(d.note != null && { note: toStr(d.note) }),
    };
  }
  if (r.logging != null && typeof r.logging === "object") {
    const where = toList((r.logging as Record<string, unknown>).where);
    if (where) data.logging = { where };
  }
  if (r.statistics != null) data.statistics = toList(r.statistics);
  if (r.reports != null && Array.isArray(r.reports)) {
    data.reports = r.reports.map((entry) => {
      if (entry === null || typeof entry !== "object") return { title: String(entry) };
      const e = entry as Record<string, unknown>;
      return {
        ...(e.title != null && { title: toStr(e.title) }),
        ...(e.url != null && { url: toStr(e.url) }),
        ...(e.recipe != null && { recipe: toStr(e.recipe) }),
      };
    });
  }
  if (r.docs != null) data.docs = toList(r.docs);
  if (r.worktreeLinks != null) data.worktreeLinks = toStr(r.worktreeLinks);
  if (r.installCmd != null) data.installCmd = toStr(r.installCmd);
  if (r.testCmd != null) data.testCmd = toStr(r.testCmd);
  // The one field here that is VALIDATED rather than normalized: it is a
  // two-value enum, and an unrecognized spelling has to fail toward the
  // safe default the same way an absent key does.
  const landing = toStr(r.codeLanding)?.trim();
  if (landing === "merge" || landing === "pr") data.codeLanding = landing;

  if (r.schedule != null && Array.isArray(r.schedule)) {
    const entries: ScheduleEntry[] = [];
    for (const entry of r.schedule) {
      if (entry === null || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const name = toStr(e.name)?.trim();
      const cron = toStr(e.cron)?.trim();
      const prompt = toStr(e.prompt)?.trim();
      if (!name || !cron || !prompt) continue;
      if (!SCHEDULE_NAME_RE.test(name)) continue;
      if (escapesRoot(prompt)) continue;
      try {
        CronExpressionParser.parse(cron);
      } catch {
        continue;
      }
      // An unusable model name is DROPPED, not the entry with it: the
      // fire is what the entry is for, and one falling back to the
      // configured model is a smaller surprise than a schedule that
      // silently stopped running. The name's shape is all that can be
      // checked here — whether the queue config actually grants it is
      // the queue's own answer, and it is given at enqueue time.
      const model = toStr(e.model)?.trim();
      entries.push({
        name, cron, prompt, enabled: e.enabled !== false,
        ...(model && SCHEDULE_NAME_RE.test(model) ? { model } : {}),
      });
    }
    if (entries.length > 0) data.schedule = entries;
  }

  return { ok: true, data };
}
