// The spec, the analyze subject and the fake git the description-freshness
// tests ask their questions of.
import { fakeGit } from "../../helpers/fake-git.ts";

export const DIR = "/specs/aide/96-merge-button-says-what-it-merges";
export const FOLDER = "96-merge-button-says-what-it-merges";
export const SUBJECT = `Run /aide-analyze for ${FOLDER} (headless)`;

/** What the two lookups are keyed on: the description's own history,
 *  and the analyze commits. Kept apart so a test can move one without
 *  the other. */
export const gitFor = (description: string | null, analyzeLog: string | null, differs = true) =>
  fakeGit({
    "log -1 --format=%H": description === null ? { code: 1 } : { code: 0, stdout: `deadbee\t${description}\n` },
    "log --format=%H%x09%aI%x09%s":
      analyzeLog === null ? { code: 1 } : { code: 0, stdout: analyzeLog },
    // `git diff --quiet`: 0 identical, 1 different.
    "diff --quiet": { code: differs ? 1 : 0 },
  });

/** An analyze log line in the shape the lookup now reads. The sha is
 *  arbitrary; only the diff stub above cares that there is one. */
export const analyzeLine = (at: string, subject = SUBJECT) => `deadbee\t${at}\t${subject}`;
