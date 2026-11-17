import {
  acCoverageFile, analysisFile, branchPrefix, descriptionFile, groupBranchPrefix,
  provisionalKeyHexLength, provisionalKeyPattern, provisionalKeyPrefix,
  scheduleKeyPrefix, solutionFile, specFolderPattern, stateFile, statusFile,
} from "../../../core/scripts/lib/spec-identity.json" with { type: "json" };

// The names the board and the runner build and read: what a spec folder is,
// a spec's branch, the keys a create and a scheduled job carry in place of a
// spec folder, and the spec's own files. Static values come from the shared
// contract; `test/project/spec-names.test.ts` runs both adapters on the same
// names.

const SPEC_FOLDER_PATTERN = new RegExp(specFolderPattern);
const PROVISIONAL_KEY_PATTERN = new RegExp(provisionalKeyPattern);

/** A numbered spec folder: digits, then a dash — `742-a-spec`. */
export const isSpecFolder = (name: string): boolean => SPEC_FOLDER_PATTERN.test(name);

const BRANCH_PREFIX = branchPrefix;

/** The branch a step pushes to, named for the spec's folder — which is why
 *  the name is not stored on a job. */
export const specBranch = (folder: string): string => `${BRANCH_PREFIX}${folder}`;

/** The branch shared by a persisted group. The first member folder is
 * immutable once work starts; the editable display name is deliberately
 * not part of the git name. */
export const groupBranch = (firstFolder: string, _displayName?: string): string =>
  `${groupBranchPrefix}${firstFolder}`;

/** The folder a spec's branch is named for; undefined for any other branch. */
export const specFolderOfBranch = (branch: string): string | undefined =>
  branch.startsWith(BRANCH_PREFIX) && branch.length > BRANCH_PREFIX.length
    ? branch.slice(BRANCH_PREFIX.length)
    : undefined;

/** The provisional key a create job carries in place of a spec folder,
 *  until landing decides the real name. Obviously not a spec
 *  folder, on purpose: nothing in this codebase may compute a spec's
 *  number or slug except the two shared shell functions
 *  (`aide_next_spec_number`, `aide_slug_from_title` in
 *  `_aide-spec-lib.sh`) that both an interactive `/aide-create` session
 *  and landing's own `--assign-number` step call — never a second,
 *  independent count (a second count would be one rule written down
 *  twice). */
export const newProvisionalKey = (): string =>
  `${provisionalKeyPrefix}${crypto.randomUUID().replace(/-/g, "").slice(0, provisionalKeyHexLength)}`;

/** `new-` + 8 hex: the key a create job carries until its merge renames it. */
export const isProvisionalKey = (key: string): boolean => PROVISIONAL_KEY_PATTERN.test(key);

const SCHEDULE_PREFIX = scheduleKeyPrefix;

/** The job-store tracking key a schedule entry's runs are filed under —
 *  never a spec folder, and never resolved under the specs root
 *  (`parseJobRequest`'s own exemption for it). Obviously not a spec
 *  folder, on purpose, the same way a create's provisional key is. */
export const scheduleTrackingKey = (name: string): string => `${SCHEDULE_PREFIX}${name}`;

/** Whether a key is a schedule entry's tracking key. */
export const isScheduleKey = (key: string): boolean => key.startsWith(SCHEDULE_PREFIX);

/** The entry name inside a scheduled job's tracking key; any other key comes
 *  back whole, as bash's `${key#schedule-}` gives it. */
export const scheduleNameOf = (key: string): string => (isScheduleKey(key) ? key.slice(SCHEDULE_PREFIX.length) : key);

/** The spec's own files. */
export const DESCRIPTION_FILE = descriptionFile;
export const ANALYSIS_FILE = analysisFile;
export const SOLUTION_FILE = solutionFile;
export const STATUS_FILE = statusFile;
export const STATE_FILE = stateFile;
export const AC_COVERAGE_FILE = acCoverageFile;
