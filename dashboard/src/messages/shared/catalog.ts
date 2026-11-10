import type { MessageEntry } from "../types.ts";

export const SHARED_CATALOG = {
  "message.written": {
    en: "{problem}",
    nb: "{problem}",
    es: "{problem}",
    de: "{problem}",
    fr: "{problem}",
    solution: { en: "{solution}", nb: "{solution}", es: "{solution}", de: "{solution}", fr: "{solution}" },
  },
  "message.lead": {
    en: "{lead} {message}",
    nb: "{lead} {message}",
    es: "{lead} {message}",
    de: "{lead} {message}",
    fr: "{lead} {message}",
    solution: null,
    exempt: "the message inside it carries the fix",
  },
} as const satisfies Record<string, MessageEntry>;
