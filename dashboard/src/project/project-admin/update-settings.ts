// Change a project's settings after it was added.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "../../git/branch-status.ts";
import { configValue } from "../discover";
import { parseManifest } from "../parse-manifest.ts";
import { oneLine, specsPathError, upsertManifestScalar, worktreeLinksError, writeAideConfig } from "./manifest-io.ts";
import { assessProjectReadiness } from "./readiness.ts";
import { applySettingsEdits, manifestTracked } from "./settings-state.ts";
import { fail, type ProjectAdminResult, type ProjectStep, type ProjectStepName } from "./types.ts";

/** What a project may say about where its archived code goes (spec
 *  220). Two values, not the runner's three: `none` is an operational
 *  choice about whether this host publishes anything at all, and it
 *  belongs to the machine's own queue config — this is the team's
 *  question of whether code is reviewed before it lands. */
const CODE_LANDINGS = ["merge", "pr"] as const;

/** How strictly `/aide-analyze` checks a spec's acceptance criteria. */
const CRITERIA_CHECKS = ["off", "warn", "stop"] as const;

/** Change a project's three settings after it was added (spec 184).
 *
 *  Until this existed, the fields lived on the Add form and nowhere
 *  else: a project added with either left blank could only be fixed by
 *  taking it off the dashboard and adding it again, or by opening a
 *  terminal on the serving host and editing a file. The readiness check
 *  already named what was missing; this is the place to act on it.
 *
 *  The settings go to two different files, and that split is the
 *  point of the spec: the specs path names a directory on THIS machine
 *  and stays in the gitignored `.aide/config`, while the worktree links
 *  are true of the project on any machine and go in the committed
 *  manifest. Spec 220's code-landing choice joins the manifest half for
 *  a sharper version of the same reason — a review policy a fresh clone
 *  cannot read is not a policy the project has.
 *
 *  A field whose submitted value MATCHES what is already stored is not
 *  written at all — that is what makes "change the specs path and leave
 *  the links alone" leave the manifest byte-identical, rather than
 *  rewriting both files on every save. An empty value is a real answer
 *  and clears the setting; it is not the same as "not submitted".
 *
 *  Refuses an unusable links value before EITHER file is opened, through
 *  the same `worktreeLinksError` the Add form and the readiness check
 *  ask — one rule, asked in one place. */
export async function updateProjectSettings(
  run: GitRunner,
  projectDir: string,
  raw: {
    specsPath?: string;
    worktreeLinks?: string;
    codeLanding?: string;
    /** Saved like `codeLanding`: `warn`, the default, removes the key. */
    criteriaChecks?: string;
    /** Both gated on presence in `req`, unlike `specsPath` above:
     *  `codeLanding` already reads that way (`req.codeLanding !==
     *  undefined`), and this one needs the same rule — a future caller
     *  posting only some fields must not blank ones it never intended
     *  to touch (spec 255). */
    installCmd?: string;
    /** Read the same way, written to the MANIFEST rather than
     *  `.aide/config`: how a project is started for a look at one
     *  branch is a fact about the project, and a fresh clone that knows
     *  it can offer the board. A machine that starts it differently
     *  still sets `AIDE_PREVIEW_CMD` in its own config by hand, which
     *  keeps winning. */
    previewCmd?: string;
    /** The command a run and a landing test with — the manifest's
     *  `AIDE_TEST_CMD`, read by `aide-resolve-test-cmd`. Gated on
     *  presence the same way. */
    testCmd?: string;
  },
  opts: {
    saveManifest?: SaveManifest;
    /** The dashboard's own settings file (spec 512), where the manifest
     *  keys go when the project's manifest is not tracked. */
    settingsFile?: string;
  } = {},
): Promise<ProjectAdminResult> {
  // A value is one line. A field the request does not carry stays
  // absent, so a partial save clears nothing.
  const req = { ...raw };
  for (const key of ["specsPath", "worktreeLinks", "installCmd", "previewCmd", "testCmd"] as const) {
    if (req[key] !== undefined) req[key] = oneLine(req[key]);
  }
  const links = (req.worktreeLinks ?? "").trim();
  if (links) {
    const linkError = worktreeLinksError(links);
    if (linkError) return fail("worktreeLinks", linkError);
  }
  const specsError = specsPathError((req.specsPath ?? "").trim());
  if (specsError) return fail("specsConfig", specsError);
  // Before either file is opened, exactly like the links above: a value
  // written and then refused by every reader is worse than one never
  // written at all.
  const landing = (req.codeLanding ?? "").trim();
  if (landing && !(CODE_LANDINGS as readonly string[]).includes(landing)) {
    return fail("codeLanding", `code landing must be ${CODE_LANDINGS.join(" or ")} — not "${landing}"`);
  }
  const criteria = (req.criteriaChecks ?? "").trim();
  if (criteria && !(CRITERIA_CHECKS as readonly string[]).includes(criteria)) {
    return fail("criteriaChecks", `acceptance criteria checks must be ${CRITERIA_CHECKS.join(", ")} — not "${criteria}"`);
  }
  const steps: ProjectStep[] = [];
  const done = async (): Promise<ProjectAdminResult> => ({
    ok: steps.every((s) => s.ok),
    steps,
    readiness: await assessProjectReadiness(run, projectDir),
  });

  const specsPath = (req.specsPath ?? "").trim();
  if (req.specsPath !== undefined && specsPath !== (configValue(projectDir, "AIDE_SPECS_PATH") ?? "")) {
    // Made where it is not there yet, `archive/` and all — the same
    // thing Add does, for the same reason: a path configured and absent
    // is a refusal over something known the moment it was written.
    let note: string | undefined;
    if (specsPath && !existsSync(specsPath)) {
      try {
        mkdirSync(join(specsPath, "archive"), { recursive: true });
        note = `made the specs root at ${specsPath}, with its archive/`;
      } catch (err) {
        note = `could not make ${specsPath}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    try {
      writeAideConfig(projectDir, { AIDE_SPECS_PATH: specsPath });
      steps.push({ step: "specsConfig", ok: true, ...(note ? { note } : {}) });
    } catch (err) {
      steps.push({
        step: "specsConfig",
        ok: false,
        error: `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      });
      return done();
    }
  }

  const manifest = join(projectDir, ".aide", "project.yaml");
  // Spec 512: where the manifest keys go depends on whether the project
  // tracks its own manifest. Tracked, it is the team's and is committed
  // as before; not tracked, the dashboard's own settings file holds them
  // and nothing reaches the project's repository; git unable to say
  // writes nothing for a manifest key. Callers that give no settings
  // file keep the older behaviour.
  const home = opts.settingsFile ? await manifestTracked(run, projectDir) : { tracked: true as boolean | null };
  const settingsFile = home.tracked === false ? opts.settingsFile : undefined;
  const readPath = settingsFile ? (existsSync(settingsFile) ? settingsFile : manifest) : manifest;
  const settingsEdits: { key: string; value: string; step: ProjectStepName }[] = [];
  // Where a manifest edit goes: into the file here, or — when the
  // caller commits it (the Settings route, into the dashboard's own
  // checkout) — gathered and handed over once at the end, so three keys
  // changed in one save are one commit and nothing is left on disk.
  const manifestEdits: { key: string; value: string; step: ProjectStepName }[] = [];
  const writeManifest = (key: string, value: string, step: ProjectStepName): void => {
    if (home.tracked === null) {
      steps.push({ step, ok: false, error: home.why ?? "git could not say whether .aide/project.yaml is tracked" });
      return;
    }
    if (settingsFile) {
      settingsEdits.push({ key, value, step });
      steps.push({ step, ok: true });
      return;
    }
    if (opts.saveManifest) {
      manifestEdits.push({ key, value, step });
      return;
    }
    try {
      upsertManifestScalar(manifest, key, value);
      steps.push({ step, ok: true });
    } catch (err) {
      steps.push({
        step,
        ok: false,
        error: `could not write ${manifest}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
  const manifestData = existsSync(readPath)
    ? (() => {
        const parsed = parseManifest(readFileSync(readPath, "utf-8"));
        return parsed.ok ? parsed.data : {};
      })()
    : {};
  const fromManifest = (v: string | undefined): string => (v ?? "").trim();
  const fromConfig = (key: string): string => configValue(projectDir, key) ?? "";

  // Changed-only, like `specsPath` above, and gated on presence in `req`:
  // a caller that never mentions a field must not blank it.
  const writeConfigField = (step: ProjectStepName, configKey: string, value: string): void => {
    const trimmed = value.trim();
    if (trimmed === fromConfig(configKey)) return;
    try {
      writeAideConfig(projectDir, { [configKey]: trimmed });
      steps.push({ step, ok: true });
    } catch (err) {
      steps.push({
        step,
        ok: false,
        error: `could not write .aide/config: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };
  // Every setting now belongs to exactly one file (spec 549): the
  // install command always goes to `.aide/config`, and worktree links,
  // preview command and test command always go to the manifest —
  // regardless of which file, if either, a value currently lives in.
  const save = (
    step: ProjectStepName,
    value: string | undefined,
    configKey: string,
    manifestKey: string,
    stored: string,
    inConfig: boolean,
  ): void => {
    if (value === undefined) return;
    if (inConfig) writeConfigField(step, configKey, value);
    else if (value.trim() !== stored) writeManifest(manifestKey, value.trim(), step);
  };
  const storedLinks = fromManifest(manifestData.worktreeLinks);
  save("worktreeLinks", req.worktreeLinks, "AIDE_WORKTREE_LINKS", "worktreeLinks", storedLinks, false);
  save("installCmd", req.installCmd, "AIDE_INSTALL_CMD", "installCmd", "", true);
  save("previewCmd", req.previewCmd, "AIDE_PREVIEW_CMD", "previewCmd", fromManifest(manifestData.previewCmd), false);
  save("testCmd", req.testCmd, "", "AIDE_TEST_CMD", fromManifest(manifestData.AIDE_TEST_CMD), false);

  // Spec 220: `merge` is the default, so choosing it takes the key OUT
  // rather than spelling today's behaviour into every project's
  // manifest — which is exactly what `upsertManifestScalar` does with an
  // empty value.
  const wanted = landing === "merge" ? "" : landing;
  if (req.codeLanding !== undefined && wanted !== (manifestData.codeLanding ?? "")) {
    writeManifest("codeLanding", wanted, "codeLanding");
  }
  const wantedCriteria = criteria === "warn" ? "" : criteria;
  if (req.criteriaChecks !== undefined && wantedCriteria !== (manifestData.criteriaChecks ?? "")) {
    writeManifest("criteriaChecks", wantedCriteria, "criteriaChecks");
  }

  if (settingsFile && settingsEdits.length) {
    try {
      applySettingsEdits(settingsFile, settingsEdits.map(({ key, value }) => ({ key, value })), [manifest]);
    } catch (err) {
      for (const edit of settingsEdits) {
        const failed = steps.find((st) => st.ok && st.step === edit.step);
        if (failed) Object.assign(failed, { ok: false, error: `could not write ${settingsFile}: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }
  if (opts.saveManifest && manifestEdits.length) {
    const saved = await opts.saveManifest(manifestEdits.map(({ key, value }) => ({ key, value })));
    for (const edit of manifestEdits) {
      steps.push(
        saved.ok
          ? { step: edit.step, ok: true }
          : { step: edit.step, ok: false, error: `could not commit .aide/project.yaml: ${saved.note ?? "no reason given"}` },
      );
    }
  }

  return done();
}

/** How a caller commits the manifest keys a save changed, instead of
 *  leaving them on disk. `ok: false` carries the reason in `note`. */
export type SaveManifest = (edits: { key: string; value: string }[]) => Promise<{ ok: boolean; note?: string }>;
