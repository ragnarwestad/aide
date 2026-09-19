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
  es: string;
  de: string;
  fr: string;
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

const INVALID_REQUEST_TAIL_ES =
  " — Recarga la página e inténtalo de nuevo — o, si esto vino de una solicitud en bruto, revisa el campo que nombra.";
const INVALID_REQUEST_TAIL_DE =
  " — Lade die Seite neu und versuche es erneut — oder, falls dies von einer rohen Anfrage kam, prüfe das genannte Feld.";
const INVALID_REQUEST_TAIL_FR =
  " — Rechargez la page et réessayez — ou, si cela provient d'une requête brute, vérifiez le champ qu'elle nomme.";
const FIX_IN_FORM_TAIL_ES = " — Corrígelo en el formulario Nueva spec y envíalo de nuevo.";
const FIX_IN_FORM_TAIL_DE = " — Korrigiere es im Formular Neue Spec und sende es erneut ab.";
const FIX_IN_FORM_TAIL_FR = " — Corrigez-le dans le formulaire Nouvelle spec et soumettez-le à nouveau.";

export const MESSAGES = {
  // --- the runner's hold-backs and caps (runner.ts) -------------------------

  "runner.landingPause": {
    en: "held back: a merge is still running — this starts when it has finished",
    nb: "holdt tilbake: en merge kjører fortsatt — dette starter når den er ferdig",
    es: "retenido: un merge sigue en curso — esto empieza cuando termine",
    de: "zurückgehalten: ein Merge läuft noch — das startet, sobald er fertig ist",
    fr: "retenu : un merge est encore en cours — cela démarre une fois terminé",
    resolve: "this starts when it has finished",
  },
  "runner.archiveRunning": {
    en: "held back: another archive is running in this project — it starts when that one has merged",
    nb: "holdt tilbake: en annen arkivering kjører i dette prosjektet — dette starter når den er merget",
    es: "retenido: otro archive está en curso en este proyecto — empieza cuando ese se haya mergeado",
    de: "zurückgehalten: in diesem Projekt läuft bereits ein anderes Archive — das startet, sobald jenes gemergt ist",
    fr: "retenu : un autre archive est en cours dans ce projet — cela démarre une fois celui-là mergé",
    resolve: "it starts when that one has merged",
  },
  "runner.notAnalyzed": {
    en: "held back: not analyzed yet — run /aide-analyze first",
    nb: "holdt tilbake: ikke analysert ennå — kjør /aide-analyze først",
    es: "retenido: todavía no se ha analizado — ejecuta /aide-analyze primero",
    de: "zurückgehalten: noch nicht analysiert — führe zuerst /aide-analyze aus",
    fr: "retenu : pas encore analysé — lancez d'abord /aide-analyze",
    resolve: "run /aide-analyze first",
  },
  "runner.dependencyNotArchived": {
    en: "held back: depends on {dependency}, which is not archived yet",
    nb: "holdt tilbake: avhenger av {dependency}, som ikke er arkivert ennå",
    es: "retenido: depende de {dependency}, que todavía no está archivada",
    de: "zurückgehalten: hängt ab von {dependency}, das noch nicht archiviert ist",
    fr: "retenu : dépend de {dependency}, qui n'est pas encore archivée",
    exempt: "resolves on its own once the dependency is archived — nothing to press",
  },
  "runner.runVanished": {
    en: "the run vanished without leaving a result. — Press {button} again.",
    nb: "kjøringen forsvant uten å etterlate et resultat. — Trykk {button} igjen.",
    es: "la ejecución desapareció sin dejar un resultado. — Pulsa {button} de nuevo.",
    de: "der Lauf ist verschwunden, ohne ein Ergebnis zu hinterlassen. — Klicke erneut auf {button}.",
    fr: "l'exécution a disparu sans laisser de résultat. — Cliquez de nouveau sur {button}.",
    resolve: "Press {button} again.",
  },
  // The bash cross-check's own verdict on a step that reported success
  // while changing nothing (core/scripts/lib/run-spec-status-line.sh),
  // said in the board's words: the English sentence the script wrote is
  // kept on the job as hover detail, never shown as the row's text.
  "runner.noProgressImplement": {
    en: "implement reported success but left no real progress — nothing changed in the project. — Press {button} again.",
    nb: "implementering meldte ferdig, men gjorde ingen framgang — ingenting ble endret i prosjektet. — Trykk {button} igjen.",
    es: "implement informó de éxito pero no dejó ningún progreso real — nada cambió en el proyecto. — Pulsa {button} de nuevo.",
    de: "Implement meldete Erfolg, hat aber keinen echten Fortschritt hinterlassen — im Projekt hat sich nichts geändert. — Klicke erneut auf {button}.",
    fr: "implement a signalé un succès mais n'a laissé aucun progrès réel — rien n'a changé dans le projet. — Cliquez de nouveau sur {button}.",
    resolve: "Press {button} again.",
  },
  "runner.noProgressArchive": {
    en: "archive reported success but left no real progress — the spec folder was never moved to archive/. — Press {button} again.",
    nb: "arkivering meldte ferdig, men gjorde ingen framgang — spec-mappa ble aldri flyttet til archive/. — Trykk {button} igjen.",
    es: "archive informó de éxito pero no dejó ningún progreso real — la carpeta de la spec nunca se movió a archive/. — Pulsa {button} de nuevo.",
    de: "Archive meldete Erfolg, hat aber keinen echten Fortschritt hinterlassen — der Spec-Ordner wurde nie nach archive/ verschoben. — Klicke erneut auf {button}.",
    fr: "archive a signalé un succès mais n'a laissé aucun progrès réel — le dossier de la spec n'a jamais été déplacé vers archive/. — Cliquez de nouveau sur {button}.",
    resolve: "Press {button} again.",
  },
  "runner.testsRedImplement": {
    en: "implement reported success, but the project's tests are red on its result — the runner ran them itself, and the failing tests are listed below. — Press {button} again; the step ends only on a green run.",
    nb: "implementering meldte ferdig, men prosjektets tester er røde på resultatet — runneren kjørte dem selv, og testene som feiler står under. — Trykk {button} igjen; steget ender bare på en grønn kjøring.",
    es: "implement informó de éxito, pero los tests del proyecto están en rojo sobre su resultado — el runner los ejecutó él mismo, y los tests que fallan se listan debajo. — Pulsa {button} de nuevo; el paso solo termina con una ejecución en verde.",
    de: "Implement meldete Erfolg, aber die Tests des Projekts sind bei diesem Ergebnis rot — der Runner hat sie selbst ausgeführt, und die fehlschlagenden Tests stehen darunter. — Klicke erneut auf {button}; der Schritt endet erst bei einem grünen Lauf.",
    fr: "implement a signalé un succès, mais les tests du projet sont au rouge sur ce résultat — le runner les a lancés lui-même, et les tests en échec sont listés ci-dessous. — Cliquez de nouveau sur {button} ; l'étape ne se termine que sur une exécution au vert.",
    resolve: "Press {button} again; the step ends only on a green run.",
  },
  "runner.testsRedArchive": {
    en: "archive reported success, but the project's tests are red after the merge with main — the runner ran them itself, and the failing tests are listed below. — Press {button} again; the step ends only on a green run.",
    nb: "arkivering meldte ferdig, men prosjektets tester er røde etter mergen med main — runneren kjørte dem selv, og testene som feiler står under. — Trykk {button} igjen; steget ender bare på en grønn kjøring.",
    es: "archive informó de éxito, pero los tests del proyecto están en rojo tras el merge con main — el runner los ejecutó él mismo, y los tests que fallan se listan debajo. — Pulsa {button} de nuevo; el paso solo termina con una ejecución en verde.",
    de: "Archive meldete Erfolg, aber die Tests des Projekts sind nach dem Merge mit main rot — der Runner hat sie selbst ausgeführt, und die fehlschlagenden Tests stehen darunter. — Klicke erneut auf {button}; der Schritt endet erst bei einem grünen Lauf.",
    fr: "archive a signalé un succès, mais les tests du projet sont au rouge après le merge avec main — le runner les a lancés lui-même, et les tests en échec sont listés ci-dessous. — Cliquez de nouveau sur {button} ; l'étape ne se termine que sur une exécution au vert.",
    resolve: "Press {button} again; the step ends only on a green run.",
  },
  "runner.mergeUnfinishedArchive": {
    en: "archive reported success, but dropped the merge with main it was handed open — the branch is still behind main, and the same conflict waits at the next merge. — Press {button} again; the session has to finish that merge.",
    nb: "arkivering meldte ferdig, men kastet mergen med main den fikk åpen — grenen ligger fortsatt bak main, og den samme konflikten venter ved neste merge. — Trykk {button} igjen; økta må fullføre mergen.",
    es: "archive informó de éxito, pero abandonó el merge con main que se le entregó abierto — la branch sigue por detrás de main, y el mismo conflicto espera en el próximo merge. — Pulsa {button} de nuevo; la sesión tiene que terminar ese merge.",
    de: "Archive meldete Erfolg, hat aber den offen übergebenen Merge mit main fallen gelassen — der Branch liegt weiterhin hinter main zurück, und derselbe Konflikt wartet beim nächsten Merge. — Klicke erneut auf {button}; die Sitzung muss diesen Merge fertigstellen.",
    fr: "archive a signalé un succès, mais a abandonné le merge avec main qui lui avait été confié ouvert — la branch est toujours en retard sur main, et le même conflit attend au prochain merge. — Cliquez de nouveau sur {button} ; la session doit terminer ce merge.",
    resolve: "Press {button} again; the session has to finish that merge.",
  },
  "runner.createEndedNoReason": {
    en: "creating the spec ended without a reason on record. — Press Try again on the message at the top of the Specs list.",
    nb: "opprettingen av specen tok slutt uten at noen årsak ble lagret. — Trykk Prøv igjen på meldingen øverst i spec-listen.",
    es: "la creación de la spec terminó sin que quedara registrado ningún motivo. — Pulsa Reintentar en el mensaje de la parte superior de la lista de specs.",
    de: "das Erstellen der Spec endete, ohne dass ein Grund festgehalten wurde. — Klicke in der Meldung oben in der Spec-Liste auf Erneut versuchen.",
    fr: "la création de la spec s'est terminée sans qu'aucun motif ne soit consigné. — Cliquez sur Réessayer dans le message en haut de la liste des specs.",
    resolve: "Press Try again",
  },
  "runner.serverRestarted": {
    en: "the server restarted while this step was running, and it left no result. — Press {button} again.",
    nb: "serveren startet på nytt mens dette steget kjørte, og det etterlot ingen resultat. — Trykk {button} igjen.",
    es: "el servidor se reinició mientras este paso estaba en curso, y no dejó ningún resultado. — Pulsa {button} de nuevo.",
    de: "der Server wurde neu gestartet, während dieser Schritt lief, und hat kein Ergebnis hinterlassen. — Klicke erneut auf {button}.",
    fr: "le serveur a redémarré pendant que cette étape était en cours, et elle n'a laissé aucun résultat. — Cliquez de nouveau sur {button}.",
    resolve: "Press {button} again.",
  },

  // --- the landing's refusals (land-branch/{steps,install,merge}.ts) -------

  "landing.createNothingToLand": {
    en: "the spec was created, but the run reported no pushed branch to merge it from. — " +
      "Merge it by hand, in the checkout on the serving host, or check the queue's push mode.",
    nb: "specen ble opprettet, men kjøringen rapporterte ingen pushet gren å merge fra. — " +
      "Merge den for hånd, i det lokale repoet på serveren, eller sjekk køens pushmodus.",
    es: "la spec se creó, pero la ejecución no informó de ninguna branch pusheada desde la que mergearla. — Mergéala a mano, en el checkout del servidor, o revisa el modo de push de la cola.",
    de: "die Spec wurde erstellt, aber der Lauf meldete keinen gepushten Branch, von dem aus gemergt werden könnte. — Merge sie von Hand, im Checkout auf dem Server, oder prüfe den Push-Modus der Warteschlange.",
    fr: "la spec a été créée, mais l'exécution n'a signalé aucune branch poussée depuis laquelle la merger. — Mergez-la à la main, dans le checkout sur le serveur, ou vérifiez le mode de push de la file d'attente.",
    resolve: "Merge it by hand",
  },
  "landing.createLandingFailed": {
    en: "the spec was created, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble opprettet, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    es: "la spec se creó, pero el merge falló. — Revisa el checkout del servidor, y luego intenta ejecutar el paso de nuevo.",
    de: "die Spec wurde erstellt, aber der Merge ist fehlgeschlagen. — Prüfe den Checkout auf dem Server, und versuche dann, den Schritt erneut auszuführen.",
    fr: "la spec a été créée, mais le merge a échoué. — Vérifiez le checkout sur le serveur, puis essayez de relancer l'étape.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.createAssignNumberFailed": {
    en: "could not assign this spec its number — nothing was pushed; run the step again",
    nb: "klarte ikke å gi denne specen nummeret sitt — ingenting ble pushet; kjør steget igjen",
    es: "no se pudo asignar el número a esta spec — no se hizo push de nada; ejecuta el paso de nuevo",
    de: "dieser Spec konnte keine Nummer zugewiesen werden — es wurde nichts gepusht; führe den Schritt erneut aus",
    fr: "impossible d'attribuer son numéro à cette spec — rien n'a été poussé ; relancez l'étape",
    resolve: "run the step again",
  },
  "landing.stepLandingFailed": {
    en: "the {step} step finished, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "steget {step} ble ferdig, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    es: "el paso {step} terminó, pero el merge falló. — Revisa el checkout del servidor, y luego intenta ejecutar el paso de nuevo.",
    de: "der Schritt {step} ist fertig, aber der Merge ist fehlgeschlagen. — Prüfe den Checkout auf dem Server, und versuche dann, den Schritt erneut auszuführen.",
    fr: "l'étape {step} est terminée, mais le merge a échoué. — Vérifiez le checkout sur le serveur, puis essayez de relancer l'étape.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.stoppedStepLandingFailed": {
    en: "the {step} step stopped at its time limit, and the merge of what it wrote failed. — " +
      "Check the checkout on the serving host, then try running the step again.",
    nb: "steget {step} stoppet ved tidsgrensen, og mergen av det det skrev feilet. — " +
      "Sjekk det lokale repoet på serveren, og prøv å kjøre steget igjen.",
    es: "el paso {step} se detuvo al llegar a su límite de tiempo, y el merge de lo que escribió falló. — Revisa el checkout del servidor, y luego intenta ejecutar el paso de nuevo.",
    de: "der Schritt {step} wurde bei seinem Zeitlimit gestoppt, und der Merge dessen, was er geschrieben hat, ist fehlgeschlagen. — Prüfe den Checkout auf dem Server, und versuche dann, den Schritt erneut auszuführen.",
    fr: "l'étape {step} s'est arrêtée à sa limite de temps, et le merge de ce qu'elle a écrit a échoué. — Vérifiez le checkout sur le serveur, puis essayez de relancer l'étape.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.archiveLandingFailed": {
    en: "the spec was archived, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble arkivert, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    es: "la spec se archivó, pero el merge falló. — Revisa el checkout del servidor, y luego intenta ejecutar el paso de nuevo.",
    de: "die Spec wurde archiviert, aber der Merge ist fehlgeschlagen. — Prüfe den Checkout auf dem Server, und versuche dann, den Schritt erneut auszuführen.",
    fr: "la spec a été archivée, mais le merge a échoué. — Vérifiez le checkout sur le serveur, puis essayez de relancer l'étape.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.closeLandingFailed": {
    en: "the spec was closed, but the merge failed. — Check the checkout on the serving host, " +
      "then try running the step again.",
    nb: "specen ble lukket, men mergen feilet. — Sjekk det lokale repoet på serveren, " +
      "og prøv å kjøre steget igjen.",
    es: "la spec se cerró, pero el merge falló. — Revisa el checkout del servidor, y luego intenta ejecutar el paso de nuevo.",
    de: "die Spec wurde geschlossen, aber der Merge ist fehlgeschlagen. — Prüfe den Checkout auf dem Server, und versuche dann, den Schritt erneut auszuführen.",
    fr: "la spec a été fermée, mais le merge a échoué. — Vérifiez le checkout sur le serveur, puis essayez de relancer l'étape.",
    resolve: "Check the checkout on the serving host",
  },
  "landing.noInstallCommand": {
    en: "merged, not installed — no {label} configured. — Set the {label} in the project's .aide/config " +
      "to enable it.",
    nb: "merget, ikke installert — ingen {label} er satt opp. — Sett {label} i prosjektets .aide/config " +
      "for å slå det på.",
    es: "mergeado, no instalado — no hay {label} configurado. — Configura {label} en el .aide/config del proyecto para activarlo.",
    de: "gemergt, nicht installiert — kein {label} konfiguriert. — Setze {label} in der .aide/config des Projekts, um es zu aktivieren.",
    fr: "mergé, non installé — aucun {label} configuré. — Définissez {label} dans le .aide/config du projet pour l'activer.",
    resolve: "Set the {label} in the project's .aide/config",
  },
  "landing.installTimedOut": {
    en: "merged, but the install timed out after {timeoutMs}ms and was stopped. — " +
      "Check the install command in the checkout on the serving host.",
    nb: "merget, men installasjonen brukte for lang tid ({timeoutMs}ms) og ble stoppet. — " +
      "Sjekk installasjonskommandoen i det lokale repoet på serveren.",
    es: "mergeado, pero la instalación superó el tiempo de espera tras {timeoutMs}ms y se detuvo. — Revisa el comando de instalación en el checkout del servidor.",
    de: "gemergt, aber die Installation hat nach {timeoutMs}ms das Zeitlimit überschritten und wurde gestoppt. — Prüfe den Installationsbefehl im Checkout auf dem Server.",
    fr: "mergé, mais l'installation a dépassé le délai après {timeoutMs}ms et a été arrêtée. — Vérifiez la commande d'installation dans le checkout sur le serveur.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.installFailedExit": {
    en: "merged, but the install failed (exit {code}). — Check the install command in the checkout on " +
      "the serving host.",
    nb: "merget, men installasjonen feilet (avsluttet med {code}). — Sjekk installasjonskommandoen " +
      "i det lokale repoet på serveren.",
    es: "mergeado, pero la instalación falló (código de salida {code}). — Revisa el comando de instalación en el checkout del servidor.",
    de: "gemergt, aber die Installation ist fehlgeschlagen (Exit {code}). — Prüfe den Installationsbefehl im Checkout auf dem Server.",
    fr: "mergé, mais l'installation a échoué (code de sortie {code}). — Vérifiez la commande d'installation dans le checkout sur le serveur.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.installCouldNotRun": {
    en: "merged, but the install could not be run. — Check the install command in the checkout on the " +
      "serving host.",
    nb: "merget, men installasjonen kunne ikke kjøres. — Sjekk installasjonskommandoen i det lokale " +
      "repoet på serveren.",
    es: "mergeado, pero la instalación no se pudo ejecutar. — Revisa el comando de instalación en el checkout del servidor.",
    de: "gemergt, aber die Installation konnte nicht ausgeführt werden. — Prüfe den Installationsbefehl im Checkout auf dem Server.",
    fr: "mergé, mais l'installation n'a pas pu être exécutée. — Vérifiez la commande d'installation dans le checkout sur le serveur.",
    resolve: "Check the install command in the checkout on the serving host.",
  },
  "landing.cannotMergeFallback": {
    en: "cannot merge {branch} in {root} — check the checkout on the serving host",
    nb: "klarer ikke å merge {branch} i {root} — sjekk det lokale repoet på serveren",
    es: "no se puede mergear {branch} en {root} — revisa el checkout del servidor",
    de: "kann {branch} in {root} nicht mergen — prüfe den Checkout auf dem Server",
    fr: "impossible de merger {branch} dans {root} — vérifiez le checkout sur le serveur",
    // Reached only when a `RepoMergeResult`'s own `error` is unset,
    // which every real refusal always sets — a defensive fallback, not
    // a sentence any known code path produces today.
    resolve: "check the checkout on the serving host",
  },
  "landing.cannotWorkOutDefaultBranch": {
    en: "cannot work out the default branch in {root} — check the checkout on the serving host",
    nb: "klarer ikke å finne hovedgrenen i {root} — sjekk det lokale repoet på serveren",
    es: "no se puede determinar la branch por defecto en {root} — revisa el checkout del servidor",
    de: "kann den Standard-Branch in {root} nicht ermitteln — prüfe den Checkout auf dem Server",
    fr: "impossible de déterminer la branch par défaut dans {root} — vérifiez le checkout sur le serveur",
    resolve: "check the checkout on the serving host",
  },
  "landing.stillOnOriginRunArchiveAgain": {
    en: "{branch} is still on origin in {root} — the spec was archived, but its work has not merged. " +
      "Run archive again to merge it.",
    nb: "{branch} ligger fortsatt på origin i {root} — specen ble arkivert, men arbeidet er ikke " +
      "merget. Kjør arkivering igjen for å merge det.",
    es: "{branch} sigue en origin en {root} — la spec se archivó, pero su trabajo no se ha mergeado. Ejecuta archive de nuevo para mergearlo.",
    de: "{branch} liegt in {root} noch auf origin — die Spec wurde archiviert, aber ihre Arbeit ist nicht gemergt. Führe Archive erneut aus, um sie zu mergen.",
    fr: "{branch} est encore sur origin dans {root} — la spec a été archivée, mais son travail n'a pas été mergé. Relancez archive pour le merger.",
    resolve: "Run archive again to merge it.",
  },
  "landing.stillOnOriginRunArchiveAgainMany": {
    en: "{branch} is still on origin in {roots} — the spec was archived, but its work has not merged. " +
      "Run archive again to merge it.",
    nb: "{branch} ligger fortsatt på origin i {roots} — specen ble arkivert, men arbeidet er ikke " +
      "merget. Kjør arkivering igjen for å merge det.",
    es: "{branch} sigue en origin en {roots} — la spec se archivó, pero su trabajo no se ha mergeado. Ejecuta archive de nuevo para mergearlo.",
    de: "{branch} liegt in {roots} noch auf origin — die Spec wurde archiviert, aber ihre Arbeit ist nicht gemergt. Führe Archive erneut aus, um sie zu mergen.",
    fr: "{branch} est encore sur origin dans {roots} — la spec a été archivée, mais son travail n'a pas été mergé. Relancez archive pour le merger.",
    resolve: "Run archive again to merge it.",
  },

  // --- branch-merge.ts's refuse() sites and its two fastForwardToOrigin ---

  "landing.nothingLeftToMerge": {
    en: "there is nothing left to merge — the branch is not on origin ({ref} in {root})",
    nb: "det er ingenting igjen å merge — grenen finnes ikke på origin ({ref} i {root})",
    es: "no queda nada que mergear — la branch no está en origin ({ref} en {root})",
    de: "es gibt nichts mehr zu mergen — der Branch ist nicht auf origin ({ref} in {root})",
    fr: "il ne reste rien à merger — la branch n'est pas sur origin ({ref} dans {root})",
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
    es: "no se puede cambiar a {base} ({ref} en {root})",
    de: "kann nicht zu {base} wechseln ({ref} in {root})",
    fr: "impossible de basculer sur {base} ({ref} dans {root})",
    exempt: "an internal git step failure with no separate location of its own",
  },
  "landing.cannotFastForward": {
    en: "cannot fast-forward {base} — merge it by hand, in the checkout on the serving host ({ref} in {root})",
    nb: "kan ikke spole {base} fremover — merge den for hånd, i det lokale repoet på serveren ({ref} i {root})",
    es: "no se puede avanzar {base} (fast-forward) — mergéalo a mano, en el checkout del servidor ({ref} en {root})",
    de: "kann {base} nicht per Fast-Forward vorziehen — merge es von Hand, im Checkout auf dem Server ({ref} in {root})",
    fr: "impossible d'avancer {base} en fast-forward — mergez-le à la main, dans le checkout sur le serveur ({ref} dans {root})",
    resolve: "merge it by hand",
  },
  "landing.mergeConflict": {
    en: "cannot merge into {base} — conflict, merge it by hand, in the checkout on the serving host " +
      "({ref} in {root})",
    nb: "klarer ikke å merge med {base} — konflikt, merge den for hånd, i det lokale repoet på " +
      "serveren ({ref} i {root})",
    es: "no se puede mergear en {base} — conflicto, mergéalo a mano, en el checkout del servidor ({ref} en {root})",
    de: "kann nicht in {base} mergen — Konflikt, merge es von Hand, im Checkout auf dem Server ({ref} in {root})",
    fr: "impossible de merger dans {base} — conflit, mergez-le à la main, dans le checkout sur le serveur ({ref} dans {root})",
    resolve: "merge it by hand",
  },
  "landing.pushFailed": {
    en: "merged locally, but the push of {base} failed: {pushError} ({ref} in {root})",
    nb: "merget lokalt, men push av {base} feilet: {pushError} ({ref} i {root})",
    es: "mergeado en local, pero el push de {base} falló: {pushError} ({ref} en {root})",
    de: "lokal gemergt, aber der Push von {base} ist fehlgeschlagen: {pushError} ({ref} in {root})",
    fr: "mergé localement, mais le push de {base} a échoué : {pushError} ({ref} dans {root})",
    exempt: "the branch is already merged locally; git's own error names the failure and there is no further move",
  },
  "landing.baseMovedTwice": {
    en: "{base} moved on origin under this merge twice — nothing was pushed; run the step again " +
      "({ref} in {root})",
    nb: "{base} flyttet seg på origin under denne mergen to ganger — ingenting ble pushet; kjør steget igjen " +
      "({ref} i {root})",
    es: "{base} se movió en origin dos veces durante este merge — no se hizo push de nada; ejecuta el paso de nuevo ({ref} en {root})",
    de: "{base} hat sich während dieses Merges zweimal auf origin bewegt — es wurde nichts gepusht; führe den Schritt erneut aus ({ref} in {root})",
    fr: "{base} a bougé sur origin deux fois pendant ce merge — rien n'a été poussé ; relancez l'étape ({ref} dans {root})",
    resolve: "run the step again",
  },
  "landing.gitCouldNotRun": {
    en: "git could not be run — check the checkout on the serving host ({ref} in {root})",
    nb: "git kunne ikke kjøres — sjekk det lokale repoet på serveren ({ref} i {root})",
    es: "no se pudo ejecutar git — revisa el checkout del servidor ({ref} en {root})",
    de: "git konnte nicht ausgeführt werden — prüfe den Checkout auf dem Server ({ref} in {root})",
    fr: "git n'a pas pu être exécuté — vérifiez le checkout sur le serveur ({ref} dans {root})",
    resolve: "check the checkout on the serving host",
  },
  "landing.deployWrongBranch": {
    en: "the checkout is on {on}, not {base} — bring it there by hand first, in the checkout on the " +
      "serving host ({ref} in {root})",
    nb: "det lokale repoet står på {on}, ikke {base} — flytt det dit for hånd først, i det lokale repoet " +
      "på serveren ({ref} i {root})",
    es: "el checkout está en {on}, no en {base} — llévalo allí a mano primero, en el checkout del servidor ({ref} en {root})",
    de: "der Checkout steht auf {on}, nicht auf {base} — bringe ihn zuerst von Hand dorthin, im Checkout auf dem Server ({ref} in {root})",
    fr: "le checkout est sur {on}, pas sur {base} — amenez-le d'abord à la main, dans le checkout sur le serveur ({ref} dans {root})",
    resolve: "bring it there by hand first",
  },
  "landing.deployCannotFastForward": {
    en: "cannot fast-forward it — bring it up to date by hand, in the checkout on the serving host " +
      "({ref} in {root})",
    nb: "klarer ikke å spole det fremover — hent det oppdatert for hånd, i det lokale repoet på serveren " +
      "({ref} i {root})",
    es: "no se puede avanzar (fast-forward) — actualízalo a mano, en el checkout del servidor ({ref} en {root})",
    de: "kann es nicht per Fast-Forward vorziehen — bringe es von Hand auf den neuesten Stand, im Checkout auf dem Server ({ref} in {root})",
    fr: "impossible de l'avancer en fast-forward — mettez-le à jour à la main, dans le checkout sur le serveur ({ref} dans {root})",
    resolve: "bring it up to date by hand",
  },
  "landing.testsRedOnMergeFallback": {
    en: "the project's tests are red on the merge into {base}",
    nb: "prosjektets tester er røde på mergen med {base}",
    es: "los tests del proyecto están en rojo en el merge en {base}",
    de: "die Tests des Projekts sind beim Merge in {base} rot",
    fr: "les tests du projet sont au rouge sur le merge dans {base}",
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
    es: "el merge de {step} falló: {message}",
    de: "Merge von {step} fehlgeschlagen: {message}",
    fr: "le merge de {step} a échoué : {message}",
    exempt: "the resolution is the message it carries",
  },
  "landing.stepStopped": {
    en: "{step} merge stopped: {message}",
    nb: "mergen av {step} ble stoppet: {message}",
    es: "el merge de {step} se detuvo: {message}",
    de: "Merge von {step} gestoppt: {message}",
    fr: "le merge de {step} s'est arrêté : {message}",
    exempt: "the resolution is the message it carries",
  },
  "landing.branchDeleteFailed": {
    en: "{root}: merged, but deleting {branch} on origin failed — delete it by hand, in the checkout " +
      "on the serving host",
    nb: "{root}: merget, men sletting av {branch} på origin feilet — slett den for hånd, i det " +
      "lokale repoet på serveren",
    es: "{root}: mergeado, pero al borrar {branch} en origin falló — bórrala a mano, en el checkout del servidor",
    de: "{root}: gemergt, aber das Löschen von {branch} auf origin ist fehlgeschlagen — lösche ihn von Hand, im Checkout auf dem Server",
    fr: "{root} : mergé, mais la suppression de {branch} sur origin a échoué — supprimez-la à la main, dans le checkout sur le serveur",
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
    es: "{root}: mergeado, pero al borrar {branch} en origin falló — bórrala a mano, en el checkout del servidor ({detail})",
    de: "{root}: gemergt, aber das Löschen von {branch} auf origin ist fehlgeschlagen — lösche ihn von Hand, im Checkout auf dem Server ({detail})",
    fr: "{root} : mergé, mais la suppression de {branch} sur origin a échoué — supprimez-la à la main, dans le checkout sur le serveur ({detail})",
    resolve: "delete it by hand",
  },

  // --- the landing's own past-outcome sentences (job-state/word-phase.ts) -

  "wordPhase.stopNotImplementedYet": {
    en: "nothing is implemented yet — run implement first",
    nb: "ingenting er implementert ennå — kjør implementer først",
    es: "todavía no se ha implementado nada — ejecuta implement primero",
    de: "es ist noch nichts implementiert — führe zuerst Implement aus",
    fr: "rien n'est encore implémenté — lancez d'abord implement",
    resolve: "run implement first",
  },
  "wordPhase.stopAcceptanceCriteriaUnticked": {
    en: "the Acceptance criteria are not all ticked — tick them under › on the Specs list, or on the Status tab",
    nb: "ikke alle punktene under Akseptansekriterier er avkrysset — kryss dem av under › på Specs-lista, eller på Status-fanen",
    es: "no todos los criterios de Aceptación están marcados — márcalos bajo › en la lista Specs, o en la pestaña Status",
    de: "nicht alle Abnahmekriterien sind abgehakt — hake sie unter › in der Specs-Liste ab, oder im Tab Status",
    fr: "les critères d'Acceptation ne sont pas tous cochés — cochez-les sous › dans la liste Specs, ou dans l'onglet Status",
    resolve: "tick them under › on the Specs list",
  },
  "wordPhase.stopNoPassingTestRecord": {
    en: "the project's tests did not pass for this commit — run implement again",
    nb: "prosjektets tester besto ikke for denne commiten — kjør implementer igjen",
    es: "los tests del proyecto no pasaron para este commit — ejecuta implement de nuevo",
    de: "die Tests des Projekts sind für diesen Commit nicht durchgelaufen — führe Implement erneut aus",
    fr: "les tests du projet n'ont pas réussi pour ce commit — relancez implement",
    resolve: "run implement again",
  },
  "wordPhase.stopAlreadyArchived": {
    en: "the spec was already archived — nothing to do",
    nb: "specen var allerede arkivert — ingenting å gjøre",
    es: "la spec ya estaba archivada — nada que hacer",
    de: "die Spec war bereits archiviert — nichts zu tun",
    fr: "la spec était déjà archivée — rien à faire",
    exempt: "already finished — nothing left to resolve",
  },
  "wordPhase.stopConflictOpen": {
    en: "a merge is open in the worktree — archive resolves it, so run archive again",
    nb: "en merge står åpen i arbeidstreet — arkivering løser den, så kjør arkivering igjen",
    es: "hay un merge abierto en el worktree — archive lo resuelve, así que ejecuta archive de nuevo",
    de: "im Worktree steht ein Merge offen — Archive löst ihn, also führe Archive erneut aus",
    fr: "un merge est ouvert dans le worktree — archive le résout, donc relancez archive",
    resolve: "run archive again",
  },
  "wordPhase.stopProviderLimit": {
    en: "the AI's usage limit was reached — run it again once the limit resets",
    nb: "AI-ens bruksgrense ble nådd — kjør på nytt når grensen er nullstilt",
    es: "se alcanzó el límite de uso de la IA — ejecútalo de nuevo cuando se restablezca el límite",
    de: "das Nutzungslimit der KI wurde erreicht — führe es erneut aus, sobald das Limit zurückgesetzt ist",
    fr: "la limite d'utilisation de l'IA a été atteinte — relancez-le une fois la limite réinitialisée",
    resolve: "run it again once the limit resets",
  },
  "wordPhase.filesDisagree": {
    // The spec's files and the run record (the state file, or git where
    // there is none) do not agree on whether this phase ran — a status
    // line claiming a phase no counted run made, or a run the file never
    // caught up with. Running the phase again brings the two in line.
    en: "the files and the run record disagree about whether {phase} ran — press {button} to run it again",
    nb: "filene og kjøringsloggen er uenige om {phase} har kjørt — trykk {button} for å kjøre det på nytt",
    es: "los archivos y el registro de la ejecución no están de acuerdo sobre si {phase} se ejecutó — pulsa {button} para ejecutarlo de nuevo",
    de: "die Dateien und das Laufprotokoll sind sich uneinig, ob {phase} gelaufen ist — klicke auf {button}, um es erneut auszuführen",
    fr: "les fichiers et l'enregistrement de l'exécution ne s'accordent pas sur le fait que {phase} ait tourné — cliquez sur {button} pour le relancer",
    resolve: "press {button} to run it again",
  },
  "wordPhase.attemptQualifierUnlanded": {
    // Read behind the phase's own name ("archive merge failed: …"), so
    // the sentence opens with what happened rather than repeating the
    // phase: "archive archived, but …" is the shape that gave.
    en: "merge failed: the spec was archived, but its branch is still open — re-run archive.",
    nb: "merge feilet: specen ble arkivert, men grenen står fortsatt åpen — kjør arkivering på nytt.",
    es: "el merge falló: la spec se archivó, pero su branch sigue abierta — vuelve a ejecutar archive.",
    de: "Merge fehlgeschlagen: die Spec wurde archiviert, aber ihr Branch ist noch offen — führe Archive erneut aus.",
    fr: "le merge a échoué : la spec a été archivée, mais sa branch est encore ouverte — relancez archive.",
    resolve: "re-run archive.",
  },
  "wordPhase.lastRunDisagreesUnlanded": {
    en: "last run reported done — its work is on the branch, and archiving merges it in",
    nb: "siste kjøring rapporterte ferdig — arbeidet ligger på grenen, og arkivering merger det inn",
    es: "la última ejecución informó de hecho — su trabajo está en la branch, y al archivar se mergea",
    de: "der letzte Lauf meldete fertig — seine Arbeit liegt auf dem Branch, und Archivieren mergt sie ein",
    fr: "la dernière exécution a signalé terminé — son travail est sur la branch, et l'archivage le merge",
    resolve: "archiving merges it in",
  },
  "wordPhase.lastRunDisagreesUnwritten": {
    en: "last run reported done, but nothing reached the files — run it again",
    nb: "siste kjøring rapporterte ferdig, men ingenting nådde filene — kjør det på nytt",
    es: "la última ejecución informó de hecho, pero nada llegó a los archivos — ejecútalo de nuevo",
    de: "der letzte Lauf meldete fertig, aber nichts hat die Dateien erreicht — führe es erneut aus",
    fr: "la dernière exécution a signalé terminé, mais rien n'a atteint les fichiers — relancez-le",
    resolve: "run it again",
  },

  // --- the landing's own test run and its verdicts -----------------------

  "testGate.cannotResolveCommand": {
    en: "the merge could not work out the test command in {root} — {resolverError}",
    nb: "mergen klarte ikke å finne testkommandoen i {root} — {resolverError}",
    es: "el merge no pudo determinar el comando de test en {root} — {resolverError}",
    de: "der Merge konnte den Testbefehl in {root} nicht ermitteln — {resolverError}",
    fr: "le merge n'a pas pu déterminer la commande de test dans {root} — {resolverError}",
    exempt: "the resolver's own error, carried as a value, already names what to look at",
  },
  "testGate.cannotReadResolverAnswer": {
    en: "the merge could not read aide-resolve-test-cmd's answer in {root}",
    nb: "mergen klarte ikke å lese svaret fra aide-resolve-test-cmd i {root}",
    es: "el merge no pudo leer la respuesta de aide-resolve-test-cmd en {root}",
    de: "der Merge konnte die Antwort von aide-resolve-test-cmd in {root} nicht lesen",
    fr: "le merge n'a pas pu lire la réponse de aide-resolve-test-cmd dans {root}",
    exempt: "an internal resolver failure with no separate action beyond investigating the resolver itself",
  },
  "testGate.timedOut": {
    en: "the project's tests did not finish within {minutes} minutes on the merge — nothing was " +
      "pushed; the archive step's own log has what they managed to say. Run archive again when the " +
      "host is quieter.",
    nb: "prosjektets tester ble ikke ferdig innen {minutes} minutter på mergen — ingenting ble " +
      "pushet; arkiveringsstegets egen logg har det de rakk å si. Kjør arkivering igjen når " +
      "maskinen er roligere.",
    es: "los tests del proyecto no terminaron en {minutes} minutos en el merge — no se hizo push de nada; el propio log del paso archive tiene lo que llegaron a decir. Ejecuta archive de nuevo cuando la máquina esté más tranquila.",
    de: "die Tests des Projekts sind beim Merge nicht innerhalb von {minutes} Minuten fertig geworden — es wurde nichts gepusht; das eigene Log des Archive-Schritts enthält, was sie noch sagen konnten. Führe Archive erneut aus, wenn die Maschine ruhiger ist.",
    fr: "les tests du projet n'ont pas fini dans les {minutes} minutes sur le merge — rien n'a été poussé ; le propre journal de l'étape archive contient ce qu'ils ont pu dire. Relancez archive quand la machine est plus calme.",
    resolve: "Run archive again",
  },
  "testGate.redSuite": {
    en: "the project's tests are red on this merge, so nothing was pushed — the work is still on {branch}. " +
      "The archive step's own log names the tests that failed; archive merges the work once they pass.",
    nb: "prosjektets tester er røde på denne mergen, så ingenting ble pushet — arbeidet ligger fortsatt på {branch}. " +
      "Arkiveringsstegets egen logg navngir testene som feiler; arkivering merger arbeidet så snart de er grønne.",
    es: "los tests del proyecto están en rojo en este merge, así que no se hizo push de nada — el trabajo sigue en {branch}. El propio log del paso archive nombra los tests que fallaron; archive mergea el trabajo en cuanto pasen.",
    de: "die Tests des Projekts sind bei diesem Merge rot, also wurde nichts gepusht — die Arbeit liegt weiterhin auf {branch}. Das eigene Log des Archive-Schritts nennt die fehlgeschlagenen Tests; Archive mergt die Arbeit, sobald sie bestehen.",
    fr: "les tests du projet sont au rouge sur ce merge, donc rien n'a été poussé — le travail est toujours sur {branch}. Le propre journal de l'étape archive nomme les tests qui ont échoué ; archive merge le travail dès qu'ils passent.",
    resolve: "archive merges the work once they pass",
  },

  // --- a tab's refusal (queue/parse-request.ts, queue/store.ts) -----------

  "tab.bodyNotObject": {
    en: "body is not an object" + INVALID_REQUEST_TAIL_EN,
    nb: "kroppen er ikke et objekt" + INVALID_REQUEST_TAIL_NB,
    es: "el cuerpo no es un objeto" + INVALID_REQUEST_TAIL_ES,
    de: "body ist kein Objekt" + INVALID_REQUEST_TAIL_DE,
    fr: "le corps n'est pas un objet" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidProject": {
    en: "invalid project" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig prosjekt" + INVALID_REQUEST_TAIL_NB,
    es: "proyecto no válido" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiges Projekt" + INVALID_REQUEST_TAIL_DE,
    fr: "projet invalide" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownProject": {
    en: "unknown or not-allowed project: {project}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent eller ikke tillatt prosjekt: {project}" + INVALID_REQUEST_TAIL_NB,
    es: "proyecto desconocido o no permitido: {project}" + INVALID_REQUEST_TAIL_ES,
    de: "unbekanntes oder nicht erlaubtes Projekt: {project}" + INVALID_REQUEST_TAIL_DE,
    fr: "projet inconnu ou non autorisé : {project}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidSpecFolder": {
    en: "invalid specFolder" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig specFolder" + INVALID_REQUEST_TAIL_NB,
    es: "specFolder no válido" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger specFolder" + INVALID_REQUEST_TAIL_DE,
    fr: "specFolder invalide" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.scheduleKeyMustStartWith": {
    en: "invalid specFolder: a schedule job's tracking key must start with schedule-" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig specFolder: en planlagt jobbs sporingsnøkkel må starte med schedule-" + INVALID_REQUEST_TAIL_NB,
    es: "specFolder no válido: la clave de seguimiento de un trabajo programado debe empezar con schedule-" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger specFolder: der Tracking-Schlüssel eines geplanten Jobs muss mit schedule- beginnen" + INVALID_REQUEST_TAIL_DE,
    fr: "specFolder invalide : la clé de suivi d'un job planifié doit commencer par schedule-" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownSpecFolder": {
    en: "unknown specFolder: {specFolder}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent specFolder: {specFolder}" + INVALID_REQUEST_TAIL_NB,
    es: "specFolder desconocido: {specFolder}" + INVALID_REQUEST_TAIL_ES,
    de: "unbekannter specFolder: {specFolder}" + INVALID_REQUEST_TAIL_DE,
    fr: "specFolder inconnu : {specFolder}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepsMustBeAList": {
    en: "steps must be a list of 1-8 workflow steps" + INVALID_REQUEST_TAIL_EN,
    nb: "steps må være en liste med 1-8 arbeidsflytsteg" + INVALID_REQUEST_TAIL_NB,
    es: "steps debe ser una lista de 1 a 8 pasos del flujo de trabajo" + INVALID_REQUEST_TAIL_ES,
    de: "steps muss eine Liste von 1-8 Workflow-Schritten sein" + INVALID_REQUEST_TAIL_DE,
    fr: "steps doit être une liste de 1 à 8 étapes du workflow" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.createStepsMustBeAList": {
    en: "steps must be a list" + INVALID_REQUEST_TAIL_EN,
    nb: "steps må være en liste" + INVALID_REQUEST_TAIL_NB,
    es: "steps debe ser una lista" + INVALID_REQUEST_TAIL_ES,
    de: "steps muss eine Liste sein" + INVALID_REQUEST_TAIL_DE,
    fr: "steps doit être une liste" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidStepsEntry": {
    en: "invalid entry in steps: {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig verdi i steps: {value}" + INVALID_REQUEST_TAIL_NB,
    es: "entrada no válida en steps: {value}" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger Eintrag in steps: {value}" + INVALID_REQUEST_TAIL_DE,
    fr: "entrée invalide dans steps : {value}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.archivedOnlyStepRefusal": {
    en: "{specFolder} is archived — only {archiveOnlyStep} can be asked for it" + INVALID_REQUEST_TAIL_EN,
    nb: "{specFolder} er arkivert — bare {archiveOnlyStep} kan bes om for den" + INVALID_REQUEST_TAIL_NB,
    es: "{specFolder} está archivada — solo se puede pedir {archiveOnlyStep} para ella" + INVALID_REQUEST_TAIL_ES,
    de: "{specFolder} ist archiviert — dafür kann nur {archiveOnlyStep} angefragt werden" + INVALID_REQUEST_TAIL_DE,
    fr: "{specFolder} est archivée — seul {archiveOnlyStep} peut lui être demandé" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.alreadyActiveNothingToDo": {
    en: "{specFolder} is already active — nothing to {archiveOnlyStep}" + INVALID_REQUEST_TAIL_EN,
    nb: "{specFolder} er allerede aktiv — ingenting å {archiveOnlyStep}" + INVALID_REQUEST_TAIL_NB,
    es: "{specFolder} ya está activa — nada que {archiveOnlyStep}" + INVALID_REQUEST_TAIL_ES,
    de: "{specFolder} ist bereits aktiv — nichts zu {archiveOnlyStep}" + INVALID_REQUEST_TAIL_DE,
    fr: "{specFolder} est déjà active — rien à {archiveOnlyStep}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidModel": {
    en: "invalid model" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig modell" + INVALID_REQUEST_TAIL_NB,
    es: "modelo no válido" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiges Modell" + INVALID_REQUEST_TAIL_DE,
    fr: "modèle invalide" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownModel": {
    en: "unknown or not-allowed model: {model}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent eller ikke tillatt modell: {model}" + INVALID_REQUEST_TAIL_NB,
    es: "modelo desconocido o no permitido: {model}" + INVALID_REQUEST_TAIL_ES,
    de: "unbekanntes oder nicht erlaubtes Modell: {model}" + INVALID_REQUEST_TAIL_DE,
    fr: "modèle inconnu ou non autorisé : {model}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.noModelConfigured": {
    en: "no model choice is configured on this server" + INVALID_REQUEST_TAIL_EN,
    nb: "ingen modellvalg er satt opp på denne serveren" + INVALID_REQUEST_TAIL_NB,
    es: "no hay ninguna elección de modelo configurada en este servidor" + INVALID_REQUEST_TAIL_ES,
    de: "auf diesem Server ist keine Modellauswahl konfiguriert" + INVALID_REQUEST_TAIL_DE,
    fr: "aucun choix de modèle n'est configuré sur ce serveur" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidModelForStep": {
    en: "invalid model for {step}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig modell for {step}" + INVALID_REQUEST_TAIL_NB,
    es: "modelo no válido para {step}" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiges Modell für {step}" + INVALID_REQUEST_TAIL_DE,
    fr: "modèle invalide pour {step}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffort": {
    en: "invalid effort" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå" + INVALID_REQUEST_TAIL_NB,
    es: "nivel de esfuerzo no válido" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger Aufwand" + INVALID_REQUEST_TAIL_DE,
    fr: "effort invalide" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffortForStep": {
    en: "invalid effort for {step}: {level}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå for {step}: {level}" + INVALID_REQUEST_TAIL_NB,
    es: "nivel de esfuerzo no válido para {step}: {level}" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger Aufwand für {step}: {level}" + INVALID_REQUEST_TAIL_DE,
    fr: "effort invalide pour {step} : {level}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidTightenField": {
    en: "invalid {name}" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig {name}" + INVALID_REQUEST_TAIL_NB,
    es: "{name} no válido" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiges {name}" + INVALID_REQUEST_TAIL_DE,
    fr: "{name} invalide" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.tightenMaxExceeded": {
    en: "{name} may only be tightened (max {limit})" + INVALID_REQUEST_TAIL_EN,
    nb: "{name} kan bare strammes inn (maks {limit})" + INVALID_REQUEST_TAIL_NB,
    es: "{name} solo se puede reducir (máx {limit})" + INVALID_REQUEST_TAIL_ES,
    de: "{name} kann nur verschärft werden (max {limit})" + INVALID_REQUEST_TAIL_DE,
    fr: "{name} ne peut être que resserré (max {limit})" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnMustBeList": {
    en: "dependsOn must be a list" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn må være en liste" + INVALID_REQUEST_TAIL_NB,
    es: "dependsOn debe ser una lista" + INVALID_REQUEST_TAIL_ES,
    de: "dependsOn muss eine Liste sein" + INVALID_REQUEST_TAIL_DE,
    fr: "dependsOn doit être une liste" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnAtMost20": {
    en: "dependsOn: at most 20" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn: maks 20" + INVALID_REQUEST_TAIL_NB,
    es: "dependsOn: máximo 20" + INVALID_REQUEST_TAIL_ES,
    de: "dependsOn: höchstens 20" + INVALID_REQUEST_TAIL_DE,
    fr: "dependsOn : 20 maximum" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.unknownDependsOnSpec": {
    en: "unknown spec in dependsOn: {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "ukjent spec i dependsOn: {value}" + INVALID_REQUEST_TAIL_NB,
    es: "spec desconocida en dependsOn: {value}" + INVALID_REQUEST_TAIL_ES,
    de: "unbekannte Spec in dependsOn: {value}" + INVALID_REQUEST_TAIL_DE,
    fr: "spec inconnue dans dependsOn : {value}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.dependsOnRepeats": {
    en: "dependsOn repeats {value}" + INVALID_REQUEST_TAIL_EN,
    nb: "dependsOn gjentar {value}" + INVALID_REQUEST_TAIL_NB,
    es: "dependsOn repite {value}" + INVALID_REQUEST_TAIL_ES,
    de: "dependsOn wiederholt {value}" + INVALID_REQUEST_TAIL_DE,
    fr: "dependsOn répète {value}" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.fieldRequired": {
    en: "{name} is required" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} er påkrevd" + FIX_IN_FORM_TAIL_NB,
    es: "{name} es obligatorio" + FIX_IN_FORM_TAIL_ES,
    de: "{name} ist erforderlich" + FIX_IN_FORM_TAIL_DE,
    fr: "{name} est requis" + FIX_IN_FORM_TAIL_FR,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldTooLong": {
    en: "{name} is too long (max {max})" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} er for lang (maks {max})" + FIX_IN_FORM_TAIL_NB,
    es: "{name} es demasiado largo (máx {max})" + FIX_IN_FORM_TAIL_ES,
    de: "{name} ist zu lang (max {max})" + FIX_IN_FORM_TAIL_DE,
    fr: "{name} est trop long (max {max})" + FIX_IN_FORM_TAIL_FR,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldControlChars": {
    en: "{name} contains control characters" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} inneholder kontrolltegn" + FIX_IN_FORM_TAIL_NB,
    es: "{name} contiene caracteres de control" + FIX_IN_FORM_TAIL_ES,
    de: "{name} enthält Steuerzeichen" + FIX_IN_FORM_TAIL_DE,
    fr: "{name} contient des caractères de contrôle" + FIX_IN_FORM_TAIL_FR,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.fieldMustBeOneLine": {
    en: "{name} must be one line" + FIX_IN_FORM_TAIL_EN,
    nb: "{name} må være én linje" + FIX_IN_FORM_TAIL_NB,
    es: "{name} debe ser una sola línea" + FIX_IN_FORM_TAIL_ES,
    de: "{name} muss eine Zeile sein" + FIX_IN_FORM_TAIL_DE,
    fr: "{name} doit tenir sur une seule ligne" + FIX_IN_FORM_TAIL_FR,
    resolve: FIX_IN_FORM_RESOLVE,
  },
  "tab.noSuchJob": {
    en: "no such job" + INVALID_REQUEST_TAIL_EN,
    nb: "ingen slik jobb" + INVALID_REQUEST_TAIL_NB,
    es: "no existe ese job" + INVALID_REQUEST_TAIL_ES,
    de: "diesen Job gibt es nicht" + INVALID_REQUEST_TAIL_DE,
    fr: "ce job n'existe pas" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotGivable": {
    en: "{named} is not a step this run can still be given" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg denne kjøringen fortsatt kan få" + INVALID_REQUEST_TAIL_NB,
    es: "{named} no es un paso que todavía se le pueda dar a esta ejecución" + INVALID_REQUEST_TAIL_ES,
    de: "{named} ist kein Schritt, der diesem Lauf noch gegeben werden kann" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} n'est pas une étape qui peut encore être donnée à cette exécution" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepCannotBeChanged": {
    en: "{named} cannot be changed: this job is {state}, not running" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} kan ikke endres: denne jobben er {state}, ikke kjørende" + INVALID_REQUEST_TAIL_NB,
    es: "{named} no se puede cambiar: este job está {state}, no en curso" + INVALID_REQUEST_TAIL_ES,
    de: "{named} kann nicht geändert werden: dieser Job ist {state}, nicht laufend" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} ne peut pas être changé : ce job est {state}, pas en cours" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepAlreadyPart": {
    en: "{named} is already part of this job" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er allerede en del av denne jobben" + INVALID_REQUEST_TAIL_NB,
    es: "{named} ya forma parte de este job" + INVALID_REQUEST_TAIL_ES,
    de: "{named} ist bereits Teil dieses Jobs" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} fait déjà partie de ce job" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotPart": {
    en: "{named} is not part of this job" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke en del av denne jobben" + INVALID_REQUEST_TAIL_NB,
    es: "{named} no forma parte de este job" + INVALID_REQUEST_TAIL_ES,
    de: "{named} ist nicht Teil dieses Jobs" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} ne fait pas partie de ce job" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotForModel": {
    en: "{named} is not a step a model can be chosen for" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg det kan velges modell for" + INVALID_REQUEST_TAIL_NB,
    es: "{named} no es un paso para el que se pueda elegir modelo" + INVALID_REQUEST_TAIL_ES,
    de: "{named} ist kein Schritt, für den ein Modell gewählt werden kann" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} n'est pas une étape pour laquelle un modèle peut être choisi" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.stepNotForEffort": {
    en: "{named} is not a step an effort level can be chosen for" + INVALID_REQUEST_TAIL_EN,
    nb: "{named} er ikke et steg det kan velges innsatsnivå for" + INVALID_REQUEST_TAIL_NB,
    es: "{named} no es un paso para el que se pueda elegir nivel de esfuerzo" + INVALID_REQUEST_TAIL_ES,
    de: "{named} ist kein Schritt, für den ein Aufwandsniveau gewählt werden kann" + INVALID_REQUEST_TAIL_DE,
    fr: "{named} n'est pas une étape pour laquelle un niveau d'effort peut être choisi" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.invalidEffortValue": {
    en: "invalid effort: {effort} (one of: {list})" + INVALID_REQUEST_TAIL_EN,
    nb: "ugyldig innsatsnivå: {effort} (ett av: {list})" + INVALID_REQUEST_TAIL_NB,
    es: "nivel de esfuerzo no válido: {effort} (uno de: {list})" + INVALID_REQUEST_TAIL_ES,
    de: "ungültiger Aufwand: {effort} (einer von: {list})" + INVALID_REQUEST_TAIL_DE,
    fr: "effort invalide : {effort} (parmi : {list})" + INVALID_REQUEST_TAIL_FR,
    resolve: INVALID_REQUEST_RESOLVE,
  },
  "tab.clashRefusal": {
    en: "{step} on {specFolder} is already {state} (job {shortId}) — cancel that one first if you want " +
      "to start over",
    nb: "{step} på {specFolder} er allerede {state} (jobb {shortId}) — avbryt den først hvis du vil " +
      "starte på nytt",
    es: "{step} en {specFolder} ya está {state} (job {shortId}) — cancela ese primero si quieres volver a empezar",
    de: "{step} auf {specFolder} ist bereits {state} (Job {shortId}) — brich diesen zuerst ab, wenn du neu starten willst",
    fr: "{step} sur {specFolder} est déjà {state} (job {shortId}) — annulez-le d'abord si vous voulez recommencer",
    resolve: "cancel that one first if you want to start over",
  },
  "tab.landingClashRefusal": {
    en: "{step} on {specFolder} cannot start while its last step is still in progress (job {shortId}) — " +
      "press {button} again in a moment, once the merge finishes",
    nb: "{step} på {specFolder} kan ikke starte mens det siste steget fortsatt er i gang (jobb {shortId}) — " +
      "trykk {button} igjen om et øyeblikk, når mergen er ferdig",
    es: "{step} en {specFolder} no puede empezar mientras su último paso sigue en curso (job {shortId}) — pulsa {button} de nuevo en un momento, en cuanto el merge termine",
    de: "{step} auf {specFolder} kann nicht starten, solange sein letzter Schritt noch läuft (Job {shortId}) — klicke gleich noch einmal auf {button}, sobald der Merge fertig ist",
    fr: "{step} sur {specFolder} ne peut pas démarrer tant que sa dernière étape est encore en cours (job {shortId}) — cliquez de nouveau sur {button} dans un instant, une fois le merge terminé",
    resolve: "press {button} again in a moment",
  },

  // --- a tab's refusal (git/specs-pull.ts) --------------------------------

  "tab.notGitWorkingTree": {
    en: "{dir} is not a git working tree — nothing was pulled. — Check the project's specs root is a " +
      "git checkout, in the checkout on the serving host.",
    nb: "{dir} er ikke et git-arbeidstre — ingenting ble hentet. — Sjekk at prosjektets specrot " +
      "er et git-repo, i det lokale repoet på serveren.",
    es: "{dir} no es un árbol de trabajo git — no se hizo pull de nada. — Comprueba que la raíz de specs del proyecto es un checkout git, en el checkout del servidor.",
    de: "{dir} ist kein Git-Arbeitsverzeichnis — es wurde nichts gepullt. — Prüfe, dass die Specs-Wurzel des Projekts ein Git-Checkout ist, im Checkout auf dem Server.",
    fr: "{dir} n'est pas un arbre de travail git — rien n'a été pull. — Vérifiez que la racine des specs du projet est un checkout git, dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.specsCheckoutDirty": {
    en: "the specs checkout has uncommitted changes — nothing was pulled. — Commit or discard them in " +
      "the checkout on the serving host, then try again.",
    nb: "det lokale specrepoet har ubekreftede endringer — ingenting ble hentet. — Commit eller " +
      "forkast dem i det lokale repoet på serveren, og prøv igjen.",
    es: "el checkout de specs tiene cambios sin commitear — no se hizo pull de nada. — Commitéalos o descártalos en el checkout del servidor, y luego inténtalo de nuevo.",
    de: "der Specs-Checkout hat nicht committete Änderungen — es wurde nichts gepullt. — Committe oder verwirf sie im Checkout auf dem Server, und versuche es dann erneut.",
    fr: "le checkout des specs a des changements non commités — rien n'a été pull. — Commitez-les ou annulez-les dans le checkout sur le serveur, puis réessayez.",
    resolve: "checkout on the serving host",
  },
  "tab.noDefaultBranchOnOrigin": {
    en: "the specs checkout has no default branch on origin — nothing was pulled. — Check the specs " +
      "repo's default branch on origin, from the checkout in the checkout on the serving host.",
    nb: "det lokale specrepoet har ingen hovedgren på origin — ingenting ble hentet. — Sjekk " +
      "specrepoets hovedgren på origin, fra det lokale repoet på serveren.",
    es: "el checkout de specs no tiene branch por defecto en origin — no se hizo pull de nada. — Comprueba la branch por defecto del repo de specs en origin, desde el checkout en el checkout del servidor.",
    de: "der Specs-Checkout hat keinen Standard-Branch auf origin — es wurde nichts gepullt. — Prüfe den Standard-Branch des Specs-Repos auf origin, vom Checkout im Checkout auf dem Server aus.",
    fr: "le checkout des specs n'a pas de branch par défaut sur origin — rien n'a été pull. — Vérifiez la branch par défaut du repo de specs sur origin, depuis le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.specsCheckoutWrongBranch": {
    en: "the specs checkout is on {on}, not {base} — nothing was pulled. — Switch it to {base} in the " +
      "checkout on the serving host, then try again.",
    nb: "det lokale specrepoet står på {on}, ikke {base} — ingenting ble hentet. — Bytt det til " +
      "{base} i det lokale repoet på serveren, og prøv igjen.",
    es: "el checkout de specs está en {on}, no en {base} — no se hizo pull de nada. — Cámbialo a {base} en el checkout del servidor, y luego inténtalo de nuevo.",
    de: "der Specs-Checkout steht auf {on}, nicht auf {base} — es wurde nichts gepullt. — Wechsle ihn im Checkout auf dem Server zu {base}, und versuche es dann erneut.",
    fr: "le checkout des specs est sur {on}, pas sur {base} — rien n'a été pull. — Basculez-le sur {base} dans le checkout sur le serveur, puis réessayez.",
    resolve: "checkout on the serving host",
  },
  "tab.originUnreachable": {
    en: "origin could not be reached — nothing was pulled. — Check the network from the serving host, " +
      "then try again.",
    nb: "origin kunne ikke nås — ingenting ble hentet. — Sjekk nettverket fra serveren, og prøv igjen.",
    es: "no se pudo alcanzar origin — no se hizo pull de nada. — Revisa la red desde el servidor, y luego inténtalo de nuevo.",
    de: "origin konnte nicht erreicht werden — es wurde nichts gepullt. — Prüfe das Netzwerk vom Server aus, und versuche es dann erneut.",
    fr: "origin n'a pas pu être atteint — rien n'a été pull. — Vérifiez le réseau depuis le serveur, puis réessayez.",
    resolve: "the network from the serving host",
  },
  "tab.specsCheckoutDiverged": {
    en: "the specs checkout has commits origin does not, so it cannot fast-forward — nothing was " +
      "pulled. — Merge it by hand, in the checkout on the serving host.",
    nb: "det lokale specrepoet har commits origin ikke har, så det kan ikke spoles fremover — " +
      "ingenting ble hentet. — Merge det for hånd, i det lokale repoet på serveren.",
    es: "el checkout de specs tiene commits que origin no tiene, así que no puede avanzar (fast-forward) — no se hizo pull de nada. — Mergéalo a mano, en el checkout del servidor.",
    de: "der Specs-Checkout hat Commits, die origin nicht hat, daher kann er nicht per Fast-Forward vorgezogen werden — es wurde nichts gepullt. — Merge ihn von Hand, im Checkout auf dem Server.",
    fr: "le checkout des specs a des commits qu'origin n'a pas, donc il ne peut pas avancer en fast-forward — rien n'a été pull. — Mergez-le à la main, dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.pullFailed": {
    en: "the pull failed — nothing was pulled. — Try again; if it keeps failing, check it in the " +
      "checkout on the serving host.",
    nb: "hentingen feilet — ingenting ble hentet. — Prøv igjen; hvis det fortsetter å feile, sjekk det i " +
      "det lokale repoet på serveren.",
    es: "el pull falló — no se hizo pull de nada. — Inténtalo de nuevo; si sigue fallando, revísalo en el checkout del servidor.",
    de: "der Pull ist fehlgeschlagen — es wurde nichts gepullt. — Versuche es erneut; falls es weiter fehlschlägt, prüfe es im Checkout auf dem Server.",
    fr: "le pull a échoué — rien n'a été pull. — Réessayez ; si cela continue d'échouer, vérifiez-le dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.pullGitCouldNotRun": {
    en: "git could not be run: {message}",
    nb: "git kunne ikke kjøres: {message}",
    es: "no se pudo ejecutar git: {message}",
    de: "git konnte nicht ausgeführt werden: {message}",
    fr: "git n'a pas pu être exécuté : {message}",
    exempt: "an internal git-spawn failure with no separate location beyond the checkout the button already acts on",
  },
  "tab.staleEdit": {
    en: "{file} has changed since you opened it for editing — nothing was saved, open it again",
    nb: "{file} har endret seg siden du åpnet den for redigering — ingenting ble lagret, åpne den igjen",
    es: "{file} ha cambiado desde que lo abriste para editarlo — no se guardó nada, ábrelo de nuevo",
    de: "{file} hat sich geändert, seit du es zum Bearbeiten geöffnet hast — es wurde nichts gespeichert, öffne es erneut",
    fr: "{file} a changé depuis que vous l'avez ouvert pour l'éditer — rien n'a été enregistré, rouvrez-le",
    resolve: "open it again",
  },
  "tab.fileCouldNotBeStaged": {
    en: "{file} could not be staged — nothing was saved. — Try again; if it keeps failing, check it in " +
      "the checkout on the serving host.",
    nb: "{file} kunne ikke legges til (stages) — ingenting ble lagret. — Prøv igjen; hvis det fortsetter " +
      "å feile, sjekk det i det lokale repoet på serveren.",
    es: "{file} no se pudo poner en stage — no se guardó nada. — Inténtalo de nuevo; si sigue fallando, revísalo en el checkout del servidor.",
    de: "{file} konnte nicht gestaged werden — es wurde nichts gespeichert. — Versuche es erneut; falls es weiter fehlschlägt, prüfe es im Checkout auf dem Server.",
    fr: "{file} n'a pas pu être stagé — rien n'a été enregistré. — Réessayez ; si cela continue d'échouer, vérifiez-le dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.commitFailed": {
    en: "{subject} could not be committed — nothing was saved. — Try again; if it keeps failing, check " +
      "it in the checkout on the serving host.",
    nb: "{subject} kunne ikke committes — ingenting ble lagret. — Prøv igjen; hvis det fortsetter å " +
      "feile, sjekk det i det lokale repoet på serveren.",
    es: "{subject} no se pudo commitear — no se guardó nada. — Inténtalo de nuevo; si sigue fallando, revísalo en el checkout del servidor.",
    de: "{subject} konnte nicht committet werden — es wurde nichts gespeichert. — Versuche es erneut; falls es weiter fehlschlägt, prüfe es im Checkout auf dem Server.",
    fr: "{subject} n'a pas pu être commité — rien n'a été enregistré. — Réessayez ; si cela continue d'échouer, vérifiez-le dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.pushToOriginFailed": {
    en: "{subject} was committed but the push to origin failed — nothing was kept. — Try again; if it " +
      "keeps failing, check it in the checkout on the serving host.",
    nb: "{subject} ble committet, men push til origin feilet — ingenting ble beholdt. — Prøv igjen; hvis " +
      "det fortsetter å feile, sjekk det i det lokale repoet på serveren.",
    es: "{subject} se commiteó pero el push a origin falló — no se conservó nada. — Inténtalo de nuevo; si sigue fallando, revísalo en el checkout del servidor.",
    de: "{subject} wurde committet, aber der Push zu origin ist fehlgeschlagen — es wurde nichts behalten. — Versuche es erneut; falls es weiter fehlschlägt, prüfe es im Checkout auf dem Server.",
    fr: "{subject} a été commité mais le push vers origin a échoué — rien n'a été conservé. — Réessayez ; si cela continue d'échouer, vérifiez-le dans le checkout sur le serveur.",
    resolve: "checkout on the serving host",
  },
  "tab.saveGitCouldNotRun": {
    en: "{subject} could not be saved: {message}",
    nb: "{subject} kunne ikke lagres: {message}",
    es: "{subject} no se pudo guardar: {message}",
    de: "{subject} konnte nicht gespeichert werden: {message}",
    fr: "{subject} n'a pas pu être enregistré : {message}",
    exempt: "an internal git/file failure with no separate location beyond the checkout the button already acts on",
  },
  // --- a spec that needs a person: the push notification's one sentence ------
  // (src/push/attention.ts picks the key; `{step}` is the step's name and
  // `{button}` the button that runs it again)

  "push.archiveHeldBack": {
    en: "Archive is held back — tick the Acceptance criteria to go on.",
    nb: "Arkivering er holdt tilbake — kryss av akseptkriteriene for å gå videre.",
    es: "El archivado está retenido — marca los criterios de aceptación para continuar.",
    de: "Das Archivieren ist zurückgehalten — hake die Akzeptanzkriterien ab, um fortzufahren.",
    fr: "L'archivage est retenu — cochez les critères d'acceptation pour continuer.",
    resolve: "tick the Acceptance criteria",
  },
  "push.stoppedTimeout": {
    en: "{step} ran out of time — it waits for you to press {button} again.",
    nb: "{step} gikk tom for tid — den venter på at du trykker {button} igjen.",
    es: "{step} se quedó sin tiempo — espera a que pulses {button} de nuevo.",
    de: "{step} hat die Zeit überschritten — es wartet darauf, dass du erneut {button} klickst.",
    fr: "{step} a manqué de temps — il attend que vous cliquiez de nouveau sur {button}.",
    resolve: "press {button} again",
  },
  "push.stoppedProviderLimit": {
    en: "{step} stopped on the AI's usage limit — it waits for you to press {button} again once the limit resets.",
    nb: "{step} stoppet på AI-ens bruksgrense — den venter på at du trykker {button} igjen når grensen er nullstilt.",
    es: "{step} se detuvo por el límite de uso de la IA — espera a que pulses {button} de nuevo cuando el límite se restablezca.",
    de: "{step} wurde durch das Nutzungslimit der KI gestoppt — es wartet darauf, dass du nach dem Zurücksetzen des Limits erneut {button} klickst.",
    fr: "{step} s'est arrêté sur la limite d'usage de l'IA — il attend que vous cliquiez de nouveau sur {button} une fois la limite réinitialisée.",
    resolve: "press {button} again",
  },
  "push.stoppedTestsRed": {
    en: "The tests went red as {step} was merged into main — it waits for a green run.",
    nb: "Testene ble røde da {step} ble merget inn i main — den venter på en grønn kjøring.",
    es: "Las pruebas se pusieron en rojo al hacer merge de {step} en main — espera una ejecución en verde.",
    de: "Die Tests wurden rot, als {step} in main gemergt wurde — es wartet auf einen grünen Lauf.",
    fr: "Les tests sont passés au rouge lors du merge de {step} dans main — il attend une exécution verte.",
    resolve: "a green run",
  },
  "push.failed": {
    en: "{step} failed — it waits for you to look at why and press {button} again.",
    nb: "{step} feilet — den venter på at du ser hvorfor og trykker {button} igjen.",
    es: "{step} falló — espera a que veas por qué y pulses {button} de nuevo.",
    de: "{step} ist fehlgeschlagen — es wartet darauf, dass du nachsiehst, warum, und erneut {button} klickst.",
    fr: "{step} a échoué — il attend que vous regardiez pourquoi et cliquiez de nouveau sur {button}.",
    resolve: "press {button} again",
  },
  "push.interrupted": {
    en: "{step} was cut off before it finished — it waits for you to press {button} again.",
    nb: "{step} ble avbrutt før den var ferdig — den venter på at du trykker {button} igjen.",
    es: "{step} se interrumpió antes de terminar — espera a que pulses {button} de nuevo.",
    de: "{step} wurde abgebrochen, bevor es fertig war — es wartet darauf, dass du erneut {button} klickst.",
    fr: "{step} a été interrompu avant d'avoir terminé — il attend que vous cliquiez de nouveau sur {button}.",
    resolve: "press {button} again",
  },
  "push.createFailed": {
    en: "Creating the spec failed: {reason} — tap to try again with what you typed.",
    nb: "Opprettingen av specen feilet: {reason} — trykk for å prøve igjen med det du skrev.",
    es: "La creación de la spec falló: {reason} — toca para reintentar con lo que escribiste.",
    de: "Das Erstellen der Spec ist fehlgeschlagen: {reason} — tippe, um es mit deiner Eingabe erneut zu versuchen.",
    fr: "La création de la spec a échoué : {reason} — touchez pour réessayer avec ce que vous avez saisi.",
    resolve: "tap to try again",
  },
} as const satisfies Record<string, MessageEntry>;

export type MessageKey = keyof typeof MESSAGES;
