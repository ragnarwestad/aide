import type { MessageKey } from "./catalog.ts";

type Texts = { en: string; nb: string; es: string; de: string; fr: string };

/** The language texts hold the problem alone. `solution` holds the one
 *  fix, in each language, or is `null` when there is nothing to resolve,
 *  and `exempt` says why (docs/error-sentences.md). A `statement` is no
 *  problem at all, such as a check that passed, and says why; it is shown
 *  as its sentence alone, with no Problem or Solution label. */
export type MessageEntry = Texts & (
  | { solution: Texts; exempt?: undefined; statement?: undefined }
  | { solution: null; exempt: string; statement?: undefined }
  | { solution?: undefined; exempt?: undefined; statement: string }
);

export interface BoardMessage {
  key: MessageKey;
  values?: Record<string, string | number | string[]>;
  /** Lists named by the message stay as data until the message is drawn.
   *  The sentence uses a scalar count from `values`; the original items
   *  are shown as detail without having to parse translated prose. */
  lists?: Record<string, string[]>;
  /** Another message, for a key whose text has a `{message}` blank: a
   *  landing failure says WHICH step's landing it was and then what
   *  went wrong, and the second half is itself a message. Kept as a
   *  message rather than flattened to text at the point it is stored,
   *  because there is no reader and no language there. */
  inner?: Sentence | Sentence[];
}

/** Legacy plain text is shown as written; structured messages are translated
 *  when displayed. A landing may report more than one repo's message. */
export type Sentence = string | BoardMessage;

export type MessageVariant = "info" | "waiting" | "failed";

export interface Message {
  variant: MessageVariant;
  text: string;
  sentence?: Sentence;
  log?: string;
  dismiss?: string;
}
