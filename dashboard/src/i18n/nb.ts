// Norwegian bokmål (spec 350, REQ-2), typed against the source
// language's own keys (`translations.ts`'s `TranslationKey`) — a key
// removed here while `en.ts` still has it fails `tsc`, not a test.
import type { TranslationKey } from "./translations.ts";

export const nb: Record<TranslationKey, string> = {
  "shell.theme": "Tema",
  "shell.language": "Språk",
  "shell.more": "Mer",
  "shell.units": "Enheter",
  "shell.settings": "Innstillinger",
  "shell.about": "Om",
  "shell.themeDark": "Mørk",
  "shell.themeLight": "Lys",
  "shell.themeAuto": "Auto",
  "shell.tabSpecs": "Spesifikasjoner",
  "shell.tabProjects": "Prosjekter",
  "shell.installWarning": "siste installasjon fant et problem — se {path}",

  "list.statesLabel": "Tilstand",
  "list.state.all": "Alle",
  "list.state.active": "Aktive",
  "list.state.running": "Kjører",
  "list.state.runningAll": "alle",
  "list.state.done": "Ferdig",
  "list.state.problem": "Problemer",
  "list.state.archived": "Arkivert",
  "list.searchHelpTitle": "Hva søket leser",
  "list.searchHelpBody":
    "Søker i prosjekt:mappe, tittelen og beskrivelsen — hele beskrivelsen, også den " +
    "delen raden ikke viser.",
  "list.searchPlaceholder": "et ord i ett av tre felt",
  "list.searchAriaLabel": "Søk i spesifikasjonene",
  "list.searchClearTitle": "Tøm søket",
  "list.search": "Søk",
  "list.newSpec": "Ny",
  "list.colSpec": "Spesifikasjon",
  "list.colState": "Tilstand",
  "list.colCreated": "Opprettet",
  "list.colTime": "Tid",
  "list.colCost": "Kostnad",
  "list.colTokens": "Tokens",
  "list.foldShow": "vis",
  "list.foldHide": "skjul",
  "list.foldTitle": "{action} faser og kontroller for {folder}",
  "list.cancel": "Avbryt",
  "list.cancelling": "avbryter…",
  "list.reopen": "Gjenåpne",
  "list.reopening": "gjenåpner…",
  "list.pullRequest": "pull-forespørsel",
  "list.notPushed": "ikke pushet",
  "list.noPullRequest": "ingen pull-forespørsel",
  "list.landingFailed": "landing feilet",
  "list.testsRed": "testene er røde",
  "list.dateUnknown": "dato ukjent",
  "list.waitingOnReview": "koden venter på en pull-forespørsel — åpne den for å se over",
  "list.pushError":
    "Et stegs push nådde ikke origin. — Hent grenen i det lokale repoet på serveren, " +
    "og push den på nytt fra en terminal.",
  "list.prError":
    "Det kunne ikke opprettes en pull-forespørsel for denne grenen. — Opprett en for hånd, " +
    "i det lokale repoet på serveren.",
  "list.branchLeftBehind":
    "Denne spesifikasjonen ble slått sammen, men grenen kunne ikke slettes på origin. — " +
    "Slett den for hånd, i det lokale repoet på serveren.",
  "list.noPullRequestOpened":
    "koden ligger på en gren, og det ble ikke opprettet noen pull-forespørsel for den. — " +
    "Opprett en for hånd, i det lokale repoet på serveren.",
  "list.archiveHeldBack": "arkivering holdt tilbake — {reason}",
  "list.noSpecMatchesFilter": "Ingen spesifikasjon matcher dette filteret.",
  "list.noSpecAtAll": "Ingen spesifikasjon å vise — ingen prosjekt på denne maskinen har en å kjøre.",
  "list.noRunner":
    "Ingen kjøretjeneste er installert på denne maskinen ennå (del 81b) — køede jobber blir " +
    "stående i kø, og ingenting her koster penger.",
  "list.ready": "klar",
  "list.archiveHeldBackWord": "arkivering holdt tilbake",
  "list.done": "ferdig",
  "list.stateQueued": "{step} i kø",
  "list.stateQueuedPosition": "{step} {n}/{total}",
  "list.stateQueuedTooltip": "{n} av {total} i kø — venter på en ledig plass til å kjøre {step}",
};
