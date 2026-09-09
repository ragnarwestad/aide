// Every message the board can show from the four producers REQ-1 names
// (spec 380): the runner's hold-backs and caps, the landing's refusals,
// the landing's own test run, and the refusals a tab answers a press
// with. One entry per key, English and Norwegian together, so this file
// alone is the list REQ-5 asks for.
//
// `en` is copied byte-for-byte from the producer's own current string —
// this spec moves WHERE the words live, never what they say in
// English. `nb` is written fresh, in ordinary Norwegian: `push`/`origin`
// keep their current spelling as loanwords, and `merge`/`spec` join them
// (spec 399). `src/i18n/banned-words.ts` lists the words that do NOT
// belong here and what to say instead; `banned-words.test.ts` is what
// keeps a later message from reaching for one of them again.

export interface MessageEntry {
  en: string;
  nb: string;
  /** A substring of `en` (and, by the same convention, `nb`) naming what
   *  resolves this message. Required unless `exempt` says why there is
   *  genuinely nothing to resolve (docs/error-sentences.md). */
  resolve?: string;
  exempt?: string;
}

const INVALID_REQUEST_TAIL_EN =
  " — Reload the page and try again — or, if this came from a raw request, check the field this names.";
const INVALID_REQUEST_TAIL_NB =
  " — Last siden på nytt og prøv igjen — eller, hvis dette kom fra en rå forespørsel, sjekk feltet som er navngitt.";
const INVALID_REQUEST_RESOLVE = "Reload the page and try again";
const FIX_IN_FORM_TAIL_EN = " — Fix it in the New spec form and submit again.";
const FIX_IN_FORM_TAIL_NB = " — Rett det i Ny spec-skjemaet og send inn igjen.";
const FIX_IN_FORM_RESOLVE = "Fix it in the New spec form and submit again.";

export const MESSAGES = {
  // --- the runner's hold-backs and caps (runner.ts) -------------------------

  "runner.landingPause": {
    en: "held back: a merge is still running — this starts when it has finished",
    nb: "holdt tilbake: en merge kjører fortsatt — dette starter når den er ferdig",
    resolve: "this starts when it has finished",
  },
  "runner.archiveRunning": {
    en: "held back: another archive is running in this project — it starts when that one has merged",
    nb: "holdt tilbake: en annen arkivering kjører i dette prosjektet — dette starter når den er merget",
    resolve: "it starts when that one has merged",
  },
  "runner.createRunning": {
    en: "held back: another spec is being created in this project — it starts when that one has its number",
    nb: "holdt tilbake: en annen spec lages i dette prosjektet — denne starter når den har fått nummeret sitt",
    resolve: "it starts when that one has its number",
  },
  "runner.notAnalyzed": {
    en: "held back: not analyzed yet — run /aide-analyze first",
    nb: "holdt tilbake: ikke analysert ennå — kjør /aide-analyze først",
    resolve: "run /aide-analyze first",
  },
  "runner.dependencyNotArchived": {
    en: "held back: depends on {dependency}, which is not archived yet",
    nb: "holdt tilbake: avhenger av {dependency}, som ikke er arkivert ennå",
    exempt: "resolves on its own once the dependency is archived — nothing to press",
  },
  "runner.acceptanceCriteriaUnticked": {
    en: "held back: the Acceptance criteria are not all ticked yet — tick them on the Checks tab",
    nb: "holdt tilbake: ikke alle punktene under Akseptansekriterier er avkrysset ennå — kryss dem av på Sjekker-fanen",
    resolve: "tick them on the Checks tab",
  },
  "runner.jobCapExceeded": {
    // The literal "$" is part of the fixed text, immediately before the
    // "{cap}" placeholder — `renderMessage`'s substitution only replaces
    // the "{cap}" substring, so the "$" survives untouched either side
    // of it.
    en: "the job cap (${cap}) would be exceeded by the next step. — Raise the job cap in the project's " +
      ".aide/config, then press Run again.",
    nb: "jobbtaket (${cap}) ville blitt overskredet av neste steg. — Øk jobbtaket i prosjektets .aide/config, " +
      "og trykk Kjør igjen.",
    resolve: "Raise the job cap",
  },
  "runner.dailyCapExceeded": {
    en: "held back: the daily cap (${cap}) would be exceeded. — Raise the daily cap in the project's " +
      ".aide/config, or wait for it to reset tomorrow.",
    nb: "holdt tilbake: dagstaket (${cap}) ville blitt overskredet. — Øk dagstaket i prosjektets .aide/config, " +
      "eller vent til det nullstilles i morgen.",
    resolve: "Raise the daily cap",
  },
  "runner.runVanished": {
    en: "the run vanished without leaving a result. — Press Run again.",
    nb: "kjøringen forsvant uten å etterlate et resultat. — Trykk Kjør igjen.",
    resolve: "Press Run again.",
  },
  // The bash cross-check's own verdict on a step that reported success
  // while changing nothing (core/scripts/lib/run-spec-status-line.sh),
  // said in the board's words: the English sentence the script wrote is
  // kept on the job as hover detail, never shown as the row's text.
  "runner.noProgressImplement": {
    en: "implement reported success but left no real progress — nothing changed in the project. — Press Run again.",
    nb: "implementering meldte ferdig, men gjorde ingen framgang — ingenting ble endret i prosjektet. — Trykk Kjør igjen.",
    resolve: "Press Run again.",
  },
  "runner.noProgressArchive": {
    en: "archive reported success but left no real progress — the spec folder was never moved to archive/. — Press Run again.",
    nb: "arkivering meldte ferdig, men gjorde ingen framgang — spec-mappa ble aldri flyttet til archive/. — Trykk Kjør igjen.",
    resolve: "Press Run again.",
  },
  "runner.serverRestarted": {
    en: "the server restarted while this step was running, and it left no result. — Press Run again.",
    nb: "serveren startet på nytt mens dette steget kjørte, og det etterlot ingen resultat. — Trykk Kjør igjen.",
    resolve: "Press Run again.",
  },

  // --- the landing's refusals (land-branch/{steps,install,merge}.ts) -------

  "landing.createNothingToLand": {
    en: "the spec was created, but the run reported no pushed branch to merge it from. — " +
      "Merge it by hand, in the checkout on the serving host, or check the queue's push mode.",
    nb: "specen ble opprettet, men kjøringen rapporterte ingen pushet gren å merge fra. — " +
      "Merge den for hånd, i det lokale repoet på serveren, eller sjekk køens pushmodus.",
    resolve: "Merge it by hand",
  },
  "landing.createLandingFailed": {
    en: "the spec was created, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble opprettet, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.stepLandingFailed": {
    en: "the {step} step finished, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "steget {step} ble ferdig, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.stoppedStepLandingFailed": {
    en: "the {step} step stopped at its time limit, and the merge of what it wrote failed. — " +
      "Check the checkout on the serving host, then try running the step again.",
    nb: "steget {step} stoppet ved tidsgrensen, og mergen av det det skrev feilet. — " +
      "Sjekk det lokale repoet på serveren, og prøv å kjøre steget igjen.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.archiveLandingFailed": {
    en: "the spec was archived, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble arkivert, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.closeLandingFailed": {
    en: "the spec was closed, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble lukket, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.noInstallCommand": {
    en: "merged, not installed — no {label} configured. — Set the {label} in the project's .aide/config " +
      "to enable it.",
    nb: "merget, ikke installert — ingen {label} er satt opp. — Sett {label} i prosjektets .aide/config " +
      "for å slå det på.",
    resolve: "Set the {label} in the project's .aide/config",
  },
  "landing.installTimedOut": {
    en: "merged, but the install timed out after {timeoutMs}ms and was stopped. — " +
      "Check the install command in the checkout on the serving host.",
    nb: "merget, men installasjonen brukte for lang tid ({timeoutMs}ms) og ble stoppet. — " +
      "Sjekk installasjonskommandoen i det lokale repoet på serveren.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.installFailedExit": {
    en: "merged, but the install failed (exit {code}). — Check the install command in the checkout on " +
      "the serving host.",
    nb: "merget, men installasjonen feilet (avsluttet med {code}). — Sjekk installasjonskommandoen " +
      "i det lokale repoet på serveren.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.installCouldNotRun": {
    en: "merged, but the install could not be run. — Check the install command in the checkout on the " +
      "serving host.",
    nb: "merget, men installasjonen kunne ikke kjøres. — Sjekk installasjonskommandoen i det lokale " +
      "repoet på serveren.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.cannotMergeFallback": {
    en: "cannot merge {branch} in {root} — check the checkout on the serving host",
    nb: "klarer ikke å merge {branch} i {root} — sjekk det lokale repoet på serveren",
    // Reached only when a `RepoMergeResult`'s own `error` is unset,
    // which every real refusal always sets — a defensive fallback, not
    // a sentence any known code path produces today.
    resolve: "check the checkout on the serving host",
  },
  "landing.cannotWorkOutDefaultBranch": {
    en: "cannot work out the default branch in {root} — check the checkout on the serving host",
    nb: "klarer ikke å finne hovedgrenen i {root} — sjekk det lokale repoet på serveren",
    resolve: "check the checkout on the serving host",
  },
  "landing.archivedNotYetOnDefault": {
    en: "the archived spec is on {branch}, not on the default branch yet.",
    nb: "den arkiverte specen ligger på {branch}, ikke på hovedgrenen ennå.",
    // The test run already gave the one instruction that applies (run
    // implement again) moments earlier on the same row; a second,
    // different instruction here would contradict it (merge.ts:289-294).
    exempt: "the test run's own verdict already named the fix",
  },
  "landing.stillOnOriginRunArchiveAgain": {
    en: "{branch} is still on origin in {root} — the spec was archived, but its work has not merged. " +
      "Run archive again to merge it.",
    nb: "{branch} ligger fortsatt på origin i {root} — specen ble arkivert, men arbeidet er ikke " +
      "merget. Kjør arkivering igjen for å merge det.",
    resolve: "Run archive again to merge it.",
  },

  // --- branch-merge.ts's refuse() sites and its two fastForwardToOrigin ---

  "landing.nothingLeftToMerge": {
    en: "there is nothing left to merge — the branch is not on origin ({ref} in {root})",
    nb: "det er ingenting igjen å merge — grenen finnes ikke på origin ({ref} i {root})",
    // Reached only through `reason: "gone"`, which the caller treats as
    // settled rather than a failure (`landBranch`'s own `else if
    // (result.reason === "gone")` branch never reads `.error`) — the
    // branch already being gone answers the question this would
    // otherwise resolve.
    exempt: "the branch already being gone is itself the resolution — nothing to press",
  },
  "landing.cannotSwitch": {
    en: "cannot switch to {base} ({ref} in {root})",
    nb: "klarer ikke å bytte til {base} ({ref} i {root})",
    exempt: "an internal git step failure with no separate location of its own",
  },
  "landing.cannotFastForward": {
    en: "cannot fast-forward {base} — merge it by hand, in the checkout on the serving host ({ref} in {root})",
    nb: "kan ikke spole {base} fremover — merge den for hånd, i det lokale repoet på serveren ({ref} i {root})",
    resolve: "merge it by hand",
  },
  "landing.mergeConflict": {
    en: "cannot merge into {base} — conflict, merge it by hand, in the checkout on the serving host " +
      "({ref} in {root})",
    nb: "klarer ikke å merge med {base} — konflikt, merge den for hånd, i det lokale repoet på " +
      "serveren ({ref} i {root})",
    resolve: "merge it by hand",
  },
  "landing.pushFailed": {
    en: "merged locally, but the push of {base} failed: {pushError} ({ref} in {root})",
    nb: "merget lokalt, men push av {base} feilet: {pushError} ({ref} i {root})",
    exempt: "the branch is already merged locally; git's own error names the failure and there is no further move",
  },
  "landing.baseMovedTwice": {
    en: "{base} moved on origin under this merge twice — nothing was pushed; run the step again " +
      "({ref} in {root})",
    nb: "{base} flyttet seg på origin under denne mergen to ganger — ingenting ble pushet; kjør steget igjen " +
      "({ref} i {root})",
    resolve: "run the step again",
  },
  "landing.gitCouldNotRun": {
    en: "git could not be run — check the checkout on the serving host ({ref} in {root})",
    nb: "git kunne ikke kjøres — sjekk det lokale repoet på serveren ({ref} i {root})",
    resolve: "check the checkout on the serving host",
  },
  "landing.deployWrongBranch": {
    en: "the checkout is on {on}, not {base} — bring it there by hand first, in the checkout on the " +
      "serving host ({ref} in {root})",
    nb: "det lokale repoet står på {on}, ikke {base} — flytt det dit for hånd først, i det lokale repoet " +
      "på serveren ({ref} i {root})",
    resolve: "bring it there by hand first",
  },
  "landing.deployCannotFastForward": {
    en: "cannot fast-forward it — bring it up to date by hand, in the checkout on the serving host " +
      "({ref} in {root})",
    nb: "klarer ikke å spole det fremover — hent det oppdatert for hånd, i det lokale repoet på serveren " +
      "({ref} i {root})",
    resolve: "bring it up to date by hand",
  },
  "landing.testsRedOnMergeFallback": {
    en: "the project's tests are red on the merge into {base}",
    nb: "prosjektets tester er røde på mergen med {base}",
    // The real message: the landing's own test run always carries its
    // own resolution; this is only the fallback for the rare case it
    // returns none at all.
    exempt: "a fallback for when the test run's own verdict carries no message of its own",
  },
  // Which step's landing this was, in front of what went wrong. The
  // badge beside the row names the step the job is on NOW, which is not
  // the same thing: a landing failure from an earlier step stands on the
  // row while a later step runs (spec 327).
  "landing.stepFailed": {
    en: "{step} merge failed: {message}",
    nb: "merge av {step} feilet: {message}",
    exempt: "the resolution is the message it carries",
  },
  "landing.stepStopped": {
    en: "{step} merge stopped: {message}",
    nb: "mergen av {step} ble stoppet: {message}",
    exempt: "the resolution is the message it carries",
  },
  "landing.branchDeleteFailed": {
    en: "{root}: merged, but deleting {branch} on origin failed — delete it by hand, in the checkout " +
      "on the serving host",
    nb: "{root}: merget, men sletting av {branch} på origin feilet — slett den for hånd, i det " +
      "lokale repoet på serveren",
    resolve: "delete it by hand",
  },
  // The same, with git's own reason in parentheses. `mergeBranchIntoDefault`
  // keeps its stderr in `detail` and out of the sentence (spec 352,
  // REQ-5); `landBranch` — which is what writes the JOB's own record —
  // puts the two together, so the record still says why the delete was
  // refused.
  "landing.branchDeleteFailedWhy": {
    en: "{root}: merged, but deleting {branch} on origin failed — delete it by hand, in the checkout " +
      "on the serving host ({detail})",
    nb: "{root}: merget, men sletting av {branch} på origin feilet — slett den for hånd, i det " +
      "lokale repoet på serveren ({detail})",
    resolve: "delete it by hand",
  },

  // --- the landing's own past-outcome sentences (job-state/word-phase.ts) -

  "wordPhase.stopNotImplementedYet": {
    en: "nothing is implemented yet — run implement first",
    nb: "ingenting er implementert ennå — kjør implementer først",
    resolve: "run implement first",
  },
  "wordPhase.stopAcceptanceCriteriaUnticked": {
    en: "the Acceptance criteria are not all ticked — tick them on the Checks tab",
    nb: "ikke alle punktene under Akseptansekriterier er avkrysset — kryss dem av på Sjekker-fanen",
    resolve: "tick them on the Checks tab",
  },
  "wordPhase.stopNoPassingTestRecord": {
    en: "the project's tests did not pass for this commit — run implement again",
    nb: "prosjektets tester besto ikke for denne commiten — kjør implementer igjen",
    resolve: "run implement again",
  },
  "wordPhase.stopAlreadyArchived": {
    en: "the spec was already archived — nothing to do",
    nb: "specen var allerede arkivert — ingenting å gjøre",
    exempt: "already finished — nothing left to resolve",
  },
  "wordPhase.stopConflictOpen": {
    en: "a merge is open in the worktree — archive resolves it, so run archive again",
    nb: "en merge står åpen i arbeidstreet — arkivering løser den, så kjør arkivering igjen",
    resolve: "run archive again",
  },
  "wordPhase.filesDisagree": {
    en: "the files disagree with what has run",
    nb: "filene stemmer ikke med det som faktisk har kjørt",
    // States a fact with no action attached, the same shape as
    // ARCHIVED_REFUSAL (docs/error-sentences.md).
    exempt: "a bookkeeping mismatch report, not an action the reader takes",
  },
  "wordPhase.attemptQualifierUnlanded": {
    // Read behind the phase's own name ("archive merge failed: …"), so
    // the sentence opens with what happened rather than repeating the
    // phase: "archive archived, but …" is the shape that gave.
    en: "merge failed: the spec was archived, but its branch is still open — re-run archive.",
    nb: "merge feilet: specen ble arkivert, men grenen står fortsatt åpen — kjør arkivering på nytt.",
    resolve: "re-run archive.",
  },
  "wordPhase.lastRunDisagreesUnlanded": {
    en: "last run reported done — its work is on the branch, and archiving merges it in",
    nb: "siste kjøring rapporterte ferdig — arbeidet ligger på grenen, og arkivering merger det inn",
    resolve: "archiving merges it in",
  },
  "wordPhase.lastRunDisagreesUnwritten": {
    en: "last run reported done, but nothing reached the files — run it again",
    nb: "siste kjøring rapporterte ferdig, men ingenting nådde filene — kjør det på nytt",
    resolve: "run it again",
  },

  // --- the landing's own test run and its verdicts -----------------------

  "testGate.cannotResolveCommand": {
    en: "the merge could not work out the test command in {root} — {resolverError}",
    nb: "mergen klarte ikke å finne testkommandoen i {root} — {resolverError}",
    exempt: "the resolver's own error, carried as a value, already names what to look at",
  },
  "testGate.cannotReadResolverAnswer": {
    en: "the merge could not read aide-resolve-test-cmd's answer in {root}",
    nb: "mergen klarte ikke å lese svaret fra aide-resolve-test-cmd i {root}",
    exempt: "an internal resolver failure with no separate action beyond investigating the resolver itself",
  },
  "testGate.timedOut": {
    en: "the project's tests did not finish within {minutes} minutes on the merge — nothing was " +
      "pushed; the archive step's own log has what they managed to say. Run archive again when the " +
      "host is quieter.",
    nb: "prosjektets tester ble ikke ferdig innen {minutes} minutter på mergen — ingenting ble " +
      "pushet; arkiveringsstegets egen logg har det de rakk å si. Kjør arkivering igjen når " +
      "maskinen er roligere.",
    resolve: "Run archive again",
  },
  "testGate.redSuite": {
    en: "the project's tests are red on this merge, so nothing was pushed. The archive step's own " +
      "log names the tests that failed; archive merges the work once they pass.",
    nb: "prosjektets tester er røde på denne mergen, så ingenting ble pushet. Arkiveringsstegets " +
      "egen logg navngir testene som feiler; arkivering merger arbeidet så snart de er grønne.",
    resolve: "archive merges the work once they pass",
  },

  // --- a tab's refusal (queue/parse-request.ts, queue/store.ts) -----------

  "tab.bodyNotObject": {
    en: "body is not an object" + INVALID_REQUEST_TAIL_EN,
    nb: "kroppen er ikke et objekt" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidProject": {
    en: "invalid project" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig prosjekt" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownProject": {
    en: "unknown or not-allowed project: {project}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent eller ikke tillatt prosjekt: {project}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidSpecFolder": {
    en: "invalid specFolder" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig specFolder" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.scheduleKeyMustStartWith": {
    en: "invalid specFolder: a schedule job's tracking key must start with schedule-" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig specFolder: en planlagt jobbs sporingsnøkkel må starte med schedule-" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownSpecFolder": {
    en: "unknown specFolder: {specFolder}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent specFolder: {specFolder}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepsMustBeAList": {
    en: "steps must be a list of 1-8 workflow steps" + INVALID_REQUEST_TAIL_EN,
    nb: "steps må være en liste med 1-8 arbeidsflytsteg" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.createStepsMustBeAList": {
    en: "steps must be a list" + INVALID_REQUEST_TAIL_EN,
    nb: "steps må være en liste" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidStepsEntry": {
    en: "invalid entry in steps: {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig verdi i steps: {value}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.archivedOnlyStepRefusal": {
    en: "{specFolder} is archived — only {archiveOnlyStep} can be asked for it" + INVALID_REQUEST_TAIL_EN,
    nb: "{specFolder} er arkivert — bare {archiveOnlyStep} kan bes om for den" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.alreadyActiveNothingToDo": {
    en: "{specFolder} is already active — nothing to {archiveOnlyStep}" + INVALID_REQUEST_TAIL_EN,
    nb: "{specFolder} er allerede aktiv — ingenting å {archiveOnlyStep}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidModel": {
    en: "invalid model" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig modell" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownModel": {
    en: "unknown or not-allowed model: {model}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent eller ikke tillatt modell: {model}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.noModelConfigured": {
    en: "no model choice is configured on this server" + INVALID_REQUEST_TAIL_EN,
    nb: "ingen modellvalg er satt opp på denne serveren" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidModelForStep": {
    en: "invalid model for {step}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig modell for {step}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffort": {
    en: "invalid effort" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffortForStep": {
    en: "invalid effort for {step}: {level}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå for {step}: {level}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidTightenField": {
    en: "invalid {name}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig {name}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.tightenMaxExceeded": {
    en: "{name} may only be tightened (max {limit})" + INVALID_REQUEST_TAIL_EN,
    nb: "{name} kan bare strammes inn (maks {limit})" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnMustBeList": {
    en: "dependsOn must be a list" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn må være en liste" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnAtMost20": {
    en: "dependsOn: at most 20" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn: maks 20" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownDependsOnSpec": {
    en: "unknown spec in dependsOn: {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent spec i dependsOn: {value}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnRepeats": {
    en: "dependsOn repeats {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn gjentar {value}" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.fieldRequired": {
    en: "{name} is required" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} er påkrevd" + FIX_IN_FORM_TAIL_NB,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldTooLong": {
    en: "{name} is too long (max {max})" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} er for lang (maks {max})" + FIX_IN_FORM_TAIL_NB,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldControlChars": {
    en: "{name} contains control characters" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} inneholder kontrolltegn" + FIX_IN_FORM_TAIL_NB,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldMustBeOneLine": {
    en: "{name} must be one line" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} må være én linje" + FIX_IN_FORM_TAIL_NB,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.noSuchJob": {
    en: "no such job" + INVALID_REQUEST_TAIL_EN,
    nb: "ingen slik jobb" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotGivable": {
    en: "{named} is not a step this run can still be given" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg denne kjøringen fortsatt kan få" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepCannotBeChanged": {
    en: "{named} cannot be changed: this job is {state}, not running" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} kan ikke endres: denne jobben er {state}, ikke kjørende" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepAlreadyPart": {
    en: "{named} is already part of this job" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er allerede en del av denne jobben" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotPart": {
    en: "{named} is not part of this job" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke en del av denne jobben" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotForModel": {
    en: "{named} is not a step a model can be chosen for" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg det kan velges modell for" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotForEffort": {
    en: "{named} is not a step an effort level can be chosen for" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg det kan velges innsatsnivå for" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffortValue": {
    en: "invalid effort: {effort} (one of: {list})" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå: {effort} (ett av: {list})" + INVALID_REQUEST_TAIL_NB,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.clashRefusal": {
    en: "{step} on {specFolder} is already {state} (job {shortId}) — cancel that one first if you want " +
      "to start over",
    nb: "{step} på {specFolder} er allerede {state} (jobb {shortId}) — avbryt den først hvis du vil " +
      "starte på nytt",
    resolve: "cancel that one first if you want to start over",
  },
  "tab.landingClashRefusal": {
    en: "{step} on {specFolder} cannot start while its last step is still in progress (job {shortId}) — " +
      "press Run again in a moment, once the merge finishes",
    nb: "{step} på {specFolder} kan ikke starte mens det siste steget fortsatt er i gang (jobb {shortId}) — " +
      "trykk Kjør igjen om et øyeblikk, når mergen er ferdig",
    resolve: "press Run again in a moment",
  },

  // --- a tab's refusal (git/specs-pull.ts) --------------------------------

  "tab.notGitWorkingTree": {
    en: "{dir} is not a git working tree — nothing was pulled. — Check the project's specs root is a " +
      "git checkout, in the checkout on the serving host.",
    nb: "{dir} er ikke et git-arbeidstre — ingenting ble hentet. — Sjekk at prosjektets specrot " +
      "er et git-repo, i det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.specsCheckoutDirty": {
    en: "the specs checkout has uncommitted changes — nothing was pulled. — Commit or discard them in " +
      "the checkout on the serving host, then try again.",
    nb: "det lokale specrepoet har ubekreftede endringer — ingenting ble hentet. — Commit eller " +
      "forkast dem i det lokale repoet på serveren, og prøv igjen.",
    resolve: "checkout on the serving host",
  },
  "tab.noDefaultBranchOnOrigin": {
    en: "the specs checkout has no default branch on origin — nothing was pulled. — Check the specs " +
      "repo's default branch on origin, from the checkout in the checkout on the serving host.",
    nb: "det lokale specrepoet har ingen hovedgren på origin — ingenting ble hentet. — Sjekk " +
      "specrepoets hovedgren på origin, fra det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.specsCheckoutWrongBranch": {
    en: "the specs checkout is on {on}, not {base} — nothing was pulled. — Switch it to {base} in the " +
      "checkout on the serving host, then try again.",
    nb: "det lokale specrepoet står på {on}, ikke {base} — ingenting ble hentet. — Bytt det til " +
      "{base} i det lokale repoet på serveren, og prøv igjen.",
    resolve: "checkout on the serving host",
  },
  "tab.originUnreachable": {
    en: "origin could not be reached — nothing was pulled. — Check the network from the serving host, " +
      "then try again.",
    nb: "origin kunne ikke nås — ingenting ble hentet. — Sjekk nettverket fra serveren, og prøv igjen.",
    resolve: "the network from the serving host",
  },
  "tab.specsCheckoutDiverged": {
    en: "the specs checkout has commits origin does not, so it cannot fast-forward — nothing was " +
      "pulled. — Merge it by hand, in the checkout on the serving host.",
    nb: "det lokale specrepoet har commits origin ikke har, så det kan ikke spoles fremover — " +
      "ingenting ble hentet. — Merge det for hånd, i det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.pullFailed": {
    en: "the pull failed — nothing was pulled. — Try again; if it keeps failing, check it in the " +
      "checkout on the serving host.",
    nb: "hentingen feilet — ingenting ble hentet. — Prøv igjen; hvis det fortsetter å feile, sjekk det i " +
      "det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.pullGitCouldNotRun": {
    en: "git could not be run: {message}",
    nb: "git kunne ikke kjøres: {message}",
    exempt: "an internal git-spawn failure with no separate location beyond the checkout the button already acts on",
  },
  "tab.staleEdit": {
    en: "{file} has changed since you opened it for editing — nothing was saved, open it again",
    nb: "{file} har endret seg siden du åpnet den for redigering — ingenting ble lagret, åpne den igjen",
    resolve: "open it again",
  },
  "tab.fileCouldNotBeStaged": {
    en: "{file} could not be staged — nothing was saved. — Try again; if it keeps failing, check it in " +
      "the checkout on the serving host.",
    nb: "{file} kunne ikke legges til (stages) — ingenting ble lagret. — Prøv igjen; hvis det fortsetter " +
      "å feile, sjekk det i det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.commitFailed": {
    en: "{subject} could not be committed — nothing was saved. — Try again; if it keeps failing, check " +
      "it in the checkout on the serving host.",
    nb: "{subject} kunne ikke committes — ingenting ble lagret. — Prøv igjen; hvis det fortsetter å " +
      "feile, sjekk det i det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.pushToOriginFailed": {
    en: "{subject} was committed but the push to origin failed — nothing was kept. — Try again; if it " +
      "keeps failing, check it in the checkout on the serving host.",
    nb: "{subject} ble committet, men push til origin feilet — ingenting ble beholdt. — Prøv igjen; hvis " +
      "det fortsetter å feile, sjekk det i det lokale repoet på serveren.",
    resolve: "checkout on the serving host",
  },
  "tab.saveGitCouldNotRun": {
    en: "{subject} could not be saved: {message}",
    nb: "{subject} kunne ikke lagres: {message}",
    exempt: "an internal git/file failure with no separate location beyond the checkout the button already acts on",
  },
} as const satisfies Record<string, MessageEntry>;

export type MessageKey = keyof typeof MESSAGES;
