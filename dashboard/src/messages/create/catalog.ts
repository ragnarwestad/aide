import type { MessageEntry } from "../types.ts";

export const CREATE_CATALOG = {
  "create.failed": {
    en: "creating “{title}” in {project} failed: {message}",
    nb: "å opprette «{title}» i {project} feilet: {message}",
    es: "crear «{title}» en {project} falló: {message}",
    de: "das Erstellen von „{title}“ in {project} ist fehlgeschlagen: {message}",
    fr: "la création de « {title} » dans {project} a échoué : {message}",
    solution: null,
    exempt: "the message inside it carries the fix",
  },
  "create.failedTryAgain": {
    en: "creating “{title}” in {project} failed: {message}",
    nb: "å opprette «{title}» i {project} feilet: {message}",
    es: "crear «{title}» en {project} falló: {message}",
    de: "das Erstellen von „{title}“ in {project} ist fehlgeschlagen: {message}",
    fr: "la création de « {title} » dans {project} a échoué : {message}",
    solution: {
      en: "press {tryAgain} to open the form with what you typed, then press {create}",
      nb: "trykk {tryAgain} for å åpne skjemaet med det du skrev, og trykk så {create}",
      es: "pulsa {tryAgain} para abrir el formulario con lo que escribiste y luego pulsa {create}",
      de: "klicke auf {tryAgain}, um das Formular mit deiner Eingabe zu öffnen, und dann auf {create}",
      fr: "cliquez sur {tryAgain} pour ouvrir le formulaire avec ce que vous avez saisi, puis sur {create}",
    },
  },
} as const satisfies Record<string, MessageEntry>;
