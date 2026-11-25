// The spec, its step subjects and the fake git log the workflow-history
// tests read from.
import { fakeGit } from "../../helpers/fake-git.ts";

export const FOLDER = "154-the-runner-owns-the-record-of-what-has-run";
export const DIR = `/specs/aide/${FOLDER}`;

export const subject = (
  step: string,
  opts: { headless?: boolean; stopped?: string; folder?: string; model?: string } = {},
) =>
  `Run /aide-${step} for ${opts.folder ?? FOLDER}` +
  (opts.headless === false ? "" : " (headless)") +
  // The model suffix sits BEFORE the stop reason, which is read
  // greedily to the end of the subject — a suffix after it would be
  // swallowed into the reason.
  (opts.model ? ` (model: ${opts.model})` : "") +
  (opts.stopped ? ` (stopped: ${opts.stopped})` : "");

/** git log prints NEWEST FIRST, and every case here depends on that. */
export const gitLogging = (...subjects: string[]) =>
  fakeGit({ log: { code: 0, stdout: subjects.join("\n") + "\n" } });
