// The shapes every project-admin operation reports through, and the
// one-line refusal every operation that fails outright uses. Split out
// of project-admin.ts (split project-admin.ts by theme).

/** The steps an add or a remove is made of. `name` is the request
 *  itself: a project name becomes a directory under the projects root
 *  AND an argument to `git clone`, so it is checked before anything
 *  else runs — a refusal that happens after the clone is not a refusal.
 *  `clone` and `register` are the two ways a checkout gets here, and
 *  exactly one of them appears in any one answer. */
export type ProjectStepName =
  | "name"
  | "clone"
  | "register"
  | "manifest"
  | "specsConfig"
  | "worktreeLinks"
  | "codeLanding"
  | "installCmd"
  | "jiraBaseUrl"
  | "allowlist"
  | "confirm";

export interface ProjectStep {
  step: ProjectStepName;
  ok: boolean;
  error?: string;
  /** Something that went RIGHT and the operator still has to know —
   *  today only "a manifest had to be made, so `/aide-manifest` still
   *  has a run to do". A note never makes the step fail. */
  note?: string;
}

/** What a readiness check is ABOUT (spec 138). Each one mirrors a
 *  prerequisite `aide-run-spec` tests before it starts, and nothing
 *  else: a check the runner does not make would refuse a project that
 *  runs perfectly well. */
export type ReadinessCheckName =
  | "gitRoot"
  | "specsRoot"
  | "specsRepo"
  | "defaultBranch"
  /** Whether the dashboard's own checkout can be made, when it has not
   *  been yet (spec 205). Once it exists it answers to `defaultBranch`
   *  like any other participating repository — the same question, about
   *  the checkout a run actually uses. */
  | "dashboardCheckout"
  | "worktreeLinks";

export interface ReadinessCheck {
  check: ReadinessCheckName;
  /** Which path this answer is about. `defaultBranch` is asked of
   *  EVERY participating repository — the project's and, when the specs
   *  live elsewhere, the specs repo's — so the name alone would not say
   *  which repo answered. */
  subject: string;
  /** Whether the check passed. */
  ok: boolean;
  /** Whether this answer stops a run. Only ever true where `ok` is
   *  false, and false for the answers that are worth SAYING without
   *  being wrong: a checkout on a feature branch (the run moves it),
   *  or no worktree links configured (most projects need none). */
  blocking: boolean;
  detail: string;
}

export interface ProjectReadiness {
  canRun: boolean;
  checks: ReadinessCheck[];
  /** The whole answer in one line, for the two places it is shown: the
   *  form's own slot with script, and the query string a no-JS redirect
   *  carries to `/projects`. Built here so both modes say the same
   *  words — a second copy in the browser code would be a second copy
   *  of the wording. */
  note: string;
}

export interface ProjectAdminResult {
  ok: boolean;
  steps: ProjectStep[];
  /** Whether a run could START in the project just added — a separate
   *  answer from `ok`, which says only that the registration completed
   *  (spec 138). Absent when there was no successful registration to
   *  assess, and on a removal, which registers nothing. */
  readiness?: ProjectReadiness;
}

export interface AddProjectRequest {
  name: string;
  /** Clone it from here. Mutually exclusive with `existingPath`. */
  gitUrl?: string;
  /** It is already on this machine: an absolute path, or — what the
   *  Add form's picker sends — the bare name of a directory directly
   *  under the projects root, which names the project too when `name`
   *  is left blank. Mutually exclusive with `gitUrl`. */
  existingPath?: string;
  description?: string;
  /** `AIDE_SPECS_PATH` for the project's own `.aide/config`. Omitted
   *  means the config is not written at all — `<project>/specs` is the
   *  fallback both readers already implement. */
  specsPath?: string;
  /** What happens to code when a spec is archived, the same choice the
   *  project page's own Edit offers. `merge` is the default and writes
   *  NOTHING: it is what a manifest with no `codeLanding` already
   *  means, and a key stating the default is a key that has to be kept
   *  in step with it. */
  codeLanding?: string;
  /** `worktreeLinks`: the space-separated, repo-relative paths a
   *  run has to link into its worktree because git does not carry them
   *  — `node_modules`, `.venv`. Omitted means the key is not written:
   *  the dashboard cannot infer which gitignored paths a project's own
   *  test command needs, so it never invents one. */
  worktreeLinks?: string;
}

/** The one-refusal-step answer every add/settings-change route that
 *  fails before it has done anything else uses. */
export const fail = (step: ProjectStepName, error: string): ProjectAdminResult => ({
  ok: false,
  steps: [{ step, ok: false, error }],
});
