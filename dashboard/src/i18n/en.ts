// The source language (spec 350, REQ-9 — the opposite of PaceUp's own
// `nb`-as-source `paceup/src/i18n/`): every other language is typed
// against THESE keys (`translations.ts`'s `TranslationKey`), so a key
// missing from `nb.ts` fails `tsc`, not a test. Every value here is the
// exact English text the covered surfaces already render — REQ-5's
// byte-identical default depends on that.
export const en = {
  "shell.theme": "Theme",
  "shell.language": "Language",
  "shell.languageEnglish": "English",
  "shell.languageNorwegian": "Norwegian",
  "shell.unit": "Units",
  "shell.more": "More",
  "shell.settings": "Settings",
  "shell.testServers": "Test servers",
  "shell.about": "About",
  "shell.themeDark": "Dark",
  "shell.themeLight": "Light",
  "shell.themeAuto": "Auto",
  "shell.tabSpecs": "Specs",
  "shell.tabProjects": "Projects",
  "shell.restartWaiting": "Deploy is waiting for {jobs}; the service restarts when they are done.",
  "shell.installWarning": "aide's last install found a problem — see {path}",
  "shell.overlayDeploying": "deploying…",
  "shell.overlayResetting": "resetting…",
  "shell.overlayClosing": "closing…",
  "shell.overlayRemoving": "removing…",
  "shell.overlaySaving": "saving…",
  "shell.overlayLoading": "loading…",
  "shell.stopTestServer": "Stop",
  "shell.runTestRound": "Run",
  "shell.testRound": "round",

  "list.statesLabel": "States",
  "list.state.all": "All",
  "list.state.active": "Active",
  "list.state.running": "Running",
  "list.state.waiting": "Waiting",
  "list.state.stopped": "Stopped",
  "list.state.failed": "Failed",
  "list.state.archived": "Archived",
  "list.state.closed": "Closed",
  "list.searchHelpTitle": "What the search reads",
  "list.searchHelpBody":
    "Searches the project:folder, the title, the description — the whole description, " +
    "including the part the row does not show.",
  "list.searchPlaceholder": "a word in any of three fields",
  "list.searchAriaLabel": "Search the specs",
  "list.searchClearTitle": "Clear the search",
  "list.search": "Search",
  "list.newSpec": "New",
  "list.colSpec": "Specification",
  "list.colState": "State/Action",
  "list.colCreated": "Created",
  "list.colTime": "Time",
  "list.colCost": "Cost",
  "list.colTokens": "Tokens",
  "list.foldShow": "show",
  "list.foldHide": "hide",
  "list.foldTitle": "{action} the phases and controls of {folder}",
  "list.cancel": "Cancel",
  "list.cancelling": "cancelling…",
  "list.cancelConfirmTitle": "Cancel {step}?",
  "list.cancelConfirmBody": "This stops it right away — it can be run again from the same spec.",
  "list.cancelConfirmOk": "OK",
  "list.reopen": "Reopen",
  "list.reopening": "reopening…",
  "list.pullRequest": "pull request",
  "list.notPushed": "not pushed",
  "list.noPullRequest": "no pull request",
  "list.landingFailed": "merge failed",
  "list.testsRed": "tests red",
  "list.dateUnknown": "date unknown",
  "list.waitingOnReview": "its code is waiting on a pull request — open it to review",
  "list.testServer": "test server",
  "list.testServerStartLink": "Click the link to start a test server running this branch",
  "list.testServerStartComing": "The link to start one appears once this spec's implement run is recorded as done",
  "list.pushError":
    "A step's push did not reach origin. — Pull the branch in the checkout on the serving host, " +
    "then push it again from a terminal.",
  "list.prError": "No pull request could be opened for this branch. — Open one by hand, in the checkout on the serving host.",
  "list.branchLeftBehind":
    "This spec merged, but its branch could not be deleted on origin. — " +
    "Delete it by hand, in the checkout on the serving host.",
  "list.noPullRequestOpened":
    "its code is on a branch and no pull request was opened for it. — Open one by hand, " +
    "in the checkout on the serving host.",
  "list.archiveHeldBack": "{step} held back: {reason}",
  "list.readyToArchive": "All checks ticked — press {button} to merge it",
  "list.noSpecMatchesFilter": "No spec matches this filter.",
  "list.noSpecAtAll": "No spec to show — no project on this machine has one to run.",
  "list.noRunner":
    "No runner is installed on this machine yet (slice 81b) — queued jobs stay queued, " +
    "and nothing here spends money.",
  "list.createdNotRegistered": "not registered",
  "list.ready": "Ready",
  "list.archiveHeldBackWord": "{step} held back",
  "list.done": "Done",
  "list.stateQueued": "{step} queued",
  "list.stateQueuedPosition": "{step} {n}/{total}",
  "list.stateQueuedTooltip": "{n} of {total} queued — waiting for a free slot to run {step}",
  // The bare word, for every stop the SYSTEM made: the badge says the
  // state and the row's own notice line says why, in full. It named the
  // step as well ("archiving held back") until 2026-09-08 — the step is
  // already on the line, and the reason is the half a reader acts on.
  "list.lastRerun": "last re-run {state}",
  "state.stopped": "stopped",
  // A stopped job is not a failed one, and the reason is the half that
  // says which. These read on the row itself, so they are as short as
  // the badge is wide.
  "state.stoppedTimeout": "stopped — {minutes} min",
  "state.stoppedProviderLimit": "stopped — provider limit",
  "state.stoppedTestsRed": "stopped — tests red",

  "project.deployRestartWaiting":
    "This checkout matches origin, but the service is still running commit {sha} — " +
    "the restart is waiting for running jobs: {jobs}.",
  "project.deployHeading": "Deploy for prod",
  "project.testServerHeading": "Test server with the test specs",
  "project.testServerNote":
    "Starts a test server from the latest main, seeded with the round's own test specs. It never touches " +
    "prod; the server shows up under Test servers.",
  "project.testServerButton": "Start test server",
  "project.testServerUnavailable":
    "This project does not carry the dashboard's own source, so a test server cannot start from here.",
} as const;
