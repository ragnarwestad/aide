import type { MessageEntry } from "../types.ts";

export const ACTIONS_PROPOSALS = {
  "proposals.unreadable": {
    en: "the run left a list of proposed specs that could not be read ({detail})",
    nb: "kjøringen la igjen en liste med foreslåtte specs som ikke kunne leses ({detail})",
    es: "la ejecución dejó una lista de specs propuestas que no se pudo leer ({detail})",
    de: "der Lauf hat eine Liste vorgeschlagener Specs hinterlassen, die sich nicht lesen ließ ({detail})",
    fr: "l'exécution a laissé une liste de specs proposées illisible ({detail})",
    solution: {
      en: "rewrite the job's prompt so it writes a JSON list of objects with a title and a description, then press Run on the Schedules page again",
      nb: "skriv om jobbens prompt slik at den skriver en JSON-liste med objekter som har tittel og beskrivelse, og trykk Kjør på Planer-siden igjen",
      es: "reescribe el prompt del trabajo para que escriba una lista JSON de objetos con título y descripción, y pulsa Ejecutar en la página Programaciones de nuevo",
      de: "schreibe den Prompt des Jobs so um, dass er eine JSON-Liste von Objekten mit Titel und Beschreibung schreibt, und klicke dann auf der Zeitpläne-Seite erneut auf Ausführen",
      fr: "réécrivez le prompt de la tâche pour qu'elle écrive une liste JSON d'objets avec un titre et une description, puis cliquez de nouveau sur Exécuter dans la page Planifications",
    },
  },
  "proposals.noSpecsRoot": {
    en: "the board could not read this project's specs, so it created none of the proposed specs",
    nb: "brettet kunne ikke lese prosjektets specs, så det laget ingen av de foreslåtte specs-ene",
    es: "el tablero no pudo leer las specs de este proyecto, así que no creó ninguna de las propuestas",
    de: "das Board konnte die Specs dieses Projekts nicht lesen und hat deshalb keine der vorgeschlagenen Specs erstellt",
    fr: "le tableau n'a pas pu lire les specs de ce projet et n'a donc créé aucune des specs proposées",
    solution: {
      en: "look for a checkout problem at the top of the project's page, then press Run on the Schedules page again",
      nb: "se etter et problem med utsjekken øverst på prosjektets side, og trykk Kjør på Planer-siden igjen",
      es: "busca un problema de checkout en la parte superior de la página del proyecto y pulsa Ejecutar en la página Programaciones de nuevo",
      de: "suche oben auf der Projektseite nach einem Checkout-Problem und klicke dann auf der Zeitpläne-Seite erneut auf Ausführen",
      fr: "cherchez un problème de checkout en haut de la page du projet, puis cliquez de nouveau sur Exécuter dans la page Planifications",
    },
  },
  "proposals.failed": {
    en: "the board failed while creating the proposed specs ({detail}); what it had done is listed below",
    nb: "brettet feilet mens det laget de foreslåtte specs-ene ({detail}); det det rakk å gjøre står under",
    es: "el tablero falló al crear las specs propuestas ({detail}); lo que había hecho aparece abajo",
    de: "das Board ist beim Erstellen der vorgeschlagenen Specs gescheitert ({detail}); was es bis dahin getan hat, steht unten",
    fr: "le tableau a échoué en créant les specs proposées ({detail}) ; ce qu'il avait fait figure ci-dessous",
    solution: {
      en: "read serve.log on the serving host, then press Run on the Schedules page again",
      nb: "les serve.log på serveren, og trykk Kjør på Planer-siden igjen",
      es: "lee serve.log en el servidor y pulsa Ejecutar en la página Programaciones de nuevo",
      de: "lies serve.log auf dem Server und klicke dann auf der Zeitpläne-Seite erneut auf Ausführen",
      fr: "lisez serve.log sur le serveur, puis cliquez de nouveau sur Exécuter dans la page Planifications",
    },
  },
} as const satisfies Record<string, MessageEntry>;
