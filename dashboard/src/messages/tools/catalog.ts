import type { MessageEntry } from "../types.ts";

// What the line at the top of every page says about an AI the board
// checked and found wanting: what is wrong, and the one fix for it.
export const TOOLS_CATALOG = {
  "tools.notInstalled": {
    en: "{tool} is not found on the machine the board runs on, so no step can run on it",
    nb: "{tool} finnes ikke på maskinen boardet kjører på, så ingen steg kan kjøre på den",
    es: "{tool} no está en la máquina donde corre el tablero, así que ningún paso puede ejecutarse con él",
    de: "{tool} ist auf dem Rechner, auf dem das Board läuft, nicht zu finden, daher kann kein Schritt damit laufen",
    fr: "{tool} est introuvable sur la machine où tourne le tableau, donc aucune étape ne peut s'exécuter avec",
    solution: {
      en: "install {tool} on that machine; the board finds it at its next check",
      nb: "installer {tool} på den maskinen; boardet finner den ved neste sjekk",
      es: "instala {tool} en esa máquina; el tablero lo encontrará en la próxima comprobación",
      de: "installiere {tool} auf diesem Rechner; das Board findet es bei der nächsten Prüfung",
      fr: "installez {tool} sur cette machine ; le tableau le trouvera à la prochaine vérification",
    },
  },
  "tools.notLoggedIn": {
    en: "{who} is not logged in, so steps that run on it stop",
    nb: "{who} er ikke logget inn, så steg som kjører på den stopper",
    es: "{who} no tiene la sesión iniciada, así que los pasos que corren con él se detienen",
    de: "{who} ist nicht angemeldet, daher halten Schritte an, die darauf laufen",
    fr: "{who} n'est pas connecté, donc les étapes qui s'exécutent dessus s'arrêtent",
    solution: {
      en: "run {command} on the machine the board runs on",
      nb: "kjør {command} på maskinen boardet kjører på",
      es: "ejecuta {command} en la máquina donde corre el tablero",
      de: "führe {command} auf dem Rechner aus, auf dem das Board läuft",
      fr: "lancez {command} sur la machine où tourne le tableau",
    },
  },
  "tools.otherAccount": {
    en: "{who} uses a stored login that belongs to another account than the one it names, and runs spend that account",
    nb: "{who} bruker en lagret innlogging som hører til en annen konto enn den den viser, og kjøringene bruker den kontoen",
    es: "{who} usa una sesión guardada de otra cuenta distinta de la que muestra, y las ejecuciones gastan esa cuenta",
    de: "{who} verwendet eine gespeicherte Anmeldung eines anderen Kontos als des angezeigten, und Läufe verbrauchen dieses Konto",
    fr: "{who} utilise une connexion enregistrée d'un autre compte que celui qu'il affiche, et les exécutions consomment ce compte",
    solution: {
      en: "run {command} on the machine the board runs on, then log in again",
      nb: "kjør {command} på maskinen boardet kjører på, og logg inn på nytt",
      es: "ejecuta {command} en la máquina donde corre el tablero y vuelve a iniciar sesión",
      de: "führe {command} auf dem Rechner aus, auf dem das Board läuft, und melde dich erneut an",
      fr: "lancez {command} sur la machine où tourne le tableau, puis reconnectez-vous",
    },
  },
  "tools.unreadable": {
    en: "the board could not read whether {tool} is installed: {said}",
    nb: "boardet kunne ikke lese om {tool} er installert: {said}",
    es: "el tablero no pudo leer si {tool} está instalado: {said}",
    de: "das Board konnte nicht lesen, ob {tool} installiert ist: {said}",
    fr: "le tableau n'a pas pu lire si {tool} est installé : {said}",
    solution: {
      en: "run {command} on the machine the board runs on to see what it says",
      nb: "kjør {command} på maskinen boardet kjører på for å se hva den sier",
      es: "ejecuta {command} en la máquina donde corre el tablero para ver qué dice",
      de: "führe {command} auf dem Rechner aus, auf dem das Board läuft, um zu sehen, was es sagt",
      fr: "lancez {command} sur la machine où tourne le tableau pour voir ce qu'il dit",
    },
  },
  "tools.unanswered": {
    en: "the board's check of {tool} has not finished for {minutes} minutes: the machine the board runs on is too busy to answer it, and the board keeps asking",
    nb: "boardets sjekk av {tool} har ikke blitt ferdig på {minutes} minutter: maskinen boardet kjører på er for opptatt til å svare, og boardet fortsetter å spørre",
    es: "la comprobación de {tool} del tablero lleva {minutes} minutos sin terminar: la máquina donde corre está demasiado ocupada para responder, y el tablero sigue preguntando",
    de: "die Prüfung von {tool} durch das Board ist seit {minutes} Minuten nicht fertig: der Rechner, auf dem es läuft, ist zu beschäftigt, um zu antworten, und das Board fragt weiter",
    fr: "la vérification de {tool} par le tableau n'a pas abouti depuis {minutes} minutes : la machine où il tourne est trop occupée pour répondre, et le tableau continue de demander",
    statement: "it ends by itself once the machine answers again, and nothing on the board can make it answer sooner",
  },
} as const satisfies Record<string, MessageEntry>;
