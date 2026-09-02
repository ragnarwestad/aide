// The source language (spec 350, REQ-9 — the opposite of PaceUp's own
// `nb`-as-source `paceup/src/i18n/`): every other language is typed
// against THESE keys (`translations.ts`'s `TranslationKey`), so a key
// missing from `nb.ts` fails `tsc`, not a test. Every value here is the
// exact English text the covered surfaces already render — REQ-5's
// byte-identical default depends on that.
export const en = {
  "shell.theme": "Theme",
  "shell.language": "Language",
  "shell.more": "More",
  "shell.units": "Units",
  "shell.settings": "Settings",
  "shell.about": "About",
  "shell.themeDark": "Dark",
  "shell.themeLight": "Light",
  "shell.themeAuto": "Auto",
  "shell.tabSpecs": "Specs",
  "shell.tabProjects": "Projects",
  "shell.installWarning": "aide's last install found a problem — see {path}",

  "list.statesLabel": "States",
  "list.state.all": "All",
  "list.state.active": "Active",
  "list.state.running": "Running",
  "list.state.done": "Done",
  "list.state.problem": "Problems",
  "list.state.archived": "Archived",
  "list.searchHelpTitle": "What the search reads",
  "list.searchHelpBody":
    "Searches the project:folder, the title, the description — the whole description, " +
    "including the part the row does not show.",
  "list.searchPlaceholder": "a word in any of three fields",
  "list.searchAriaLabel": "Search the specs",
  "list.searchClearTitle": "Clear the search",
  "list.search": "Search",
  "list.newSpec": "New spec",
  "list.colSpec": "Spec",
  "list.colState": "State",
  "list.colCreated": "Created",
  "list.colTime": "Time",
  "list.colCost": "Cost",
  "list.colTokens": "Tokens",
  "list.foldShow": "show",
  "list.foldHide": "hide",
  "list.foldTitle": "{action} the phases and controls of {folder}",
  "list.cancel": "Cancel",
  "list.cancelling": "cancelling…",
  "list.reopen": "Reopen",
  "list.reopening": "reopening…",
  "list.pullRequest": "pull request",
  "list.notPushed": "not pushed",
  "list.noPullRequest": "no pull request",
  "list.landingFailed": "landing failed",
  "list.dateUnknown": "date unknown",
  "list.waitingOnReview": "its code is waiting on a pull request — open it to review",
  "list.pushError": "A step's push did not reach origin. Pull the branch locally, then push it again.",
  "list.prError": "No pull request could be opened for this branch. Open one by hand.",
  "list.branchLeftBehind":
    "This spec merged, but its branch could not be deleted on origin. Delete it by hand.",
  "list.noPullRequestOpened": "its code is on a branch and no pull request was opened for it",
  "list.archiveHeldBack": "archive held back — {reason}",
  "list.noSpecMatchesFilter": "No spec matches this filter.",
  "list.noSpecAtAll": "No spec to show — no project on this machine has one to run.",
  "list.noRunner":
    "No runner is installed on this machine yet (slice 81b) — queued jobs stay queued, " +
    "and nothing here spends money.",
  "list.ready": "ready",
  "list.archiveHeldBackWord": "archive held back",
  "list.done": "done",
  "list.stateQueued": "{step} queued",
} as const;
