import type { WikiPageState } from "./state.ts";

export interface WikiPageLine {
  page: string;
  title: string;
  summary: string;
  state: WikiPageState;
}

/** The page the address asks for: its text (front matter cut off, links
 *  rewritten), or the fact that the branch has no such page. */
export type WikiOpenPage = { page: string; state: WikiPageState; text: string } | { page: string; missing: true };

/** What the Wiki tab draws of the wiki itself. */
export interface WikiView {
  pages: WikiPageLine[];
  open?: WikiOpenPage;
}
