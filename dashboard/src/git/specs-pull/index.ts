// The Update button's pull.
//
// The dashboard lists specs by reading the spec folders straight off the
// serving host's working copy, which `aide-pull-specs` pulls from cron
// every two minutes. A description edited and pushed from another
// machine is therefore invisible for up to two minutes, and nothing on
// the page said which version it was showing — the user had to be told
// "wait a couple of minutes" before re-running a cancelled job, which is
// not a process. The button closes that gap and lets a reader SEE that
// the dashboard has the change before pressing Run.
//
// It has to be as safe unattended as the cron is, so it asks the same
// four questions `core/scripts/aide-pull-specs:41-104` asks, in
// TypeScript, over one repo instead of a list: is this a git working
// tree, is there anything uncommitted, is it on its own default branch,
// and is the pull a fast-forward. A repo failing any of them is left
// exactly as it was, with the reason on the page.
//
// One deliberate difference from the script. There, a divergence and an
// unreachable remote are both "pull failed" — a fine answer for a cron
// mail, and no answer at all for a person who just pressed a button. So
// the fast-forward is CHECKED, against a ref the fetch has just moved,
// before anything is merged.

export { pullFastForward, type SpecsPullResult } from "./pull.ts";
export { asFileText, saveSpecFile, saveSpecFiles, type SpecFileEdit, type SpecsSaveResult } from "./save.ts";
