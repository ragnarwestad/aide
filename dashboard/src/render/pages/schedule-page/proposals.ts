// The list under a run's report saying what the board did with the specs the
// run proposed: which it created, which it skipped, and why. Reads the record
// `propose-specs.ts` leaves beside the report; no record draws nothing.
import { t, type Language } from "../../../i18n";
import { renderMessage } from "../../../i18n/message.ts";
import type { InvalidWhat, ProposalResult, ProposalsProblem, ProposalsRecord, SkipWhy } from "../../../queue/spec-proposals.ts";
import { badge } from "../../ui/components";
import { esc } from "../../ui/html.ts";
import { specPagePath } from "../spec-page";

const INVALID_KEY: Record<InvalidWhat, Parameters<typeof t>[1]> = {
  "not-an-object": "proposals.invalidNotObject",
  "title-missing": "proposals.invalidTitleMissing",
  "title-lines": "proposals.invalidTitleLines",
  "title-long": "proposals.invalidTitleLong",
  "description-missing": "proposals.invalidDescriptionMissing",
  "description-long": "proposals.invalidDescriptionLong",
};

const PROBLEM_KEY = {
  unreadable: "proposals.unreadable",
  "no-specs-root": "proposals.noSpecsRoot",
  failed: "proposals.failed",
} as const satisfies Record<ProposalsProblem, string>;

const jobHref = (id: string): string => `/jobs/${encodeURIComponent(id)}`;
const link = (href: string, text: string): string => `<a href="${esc(href)}">${esc(text)}</a>`;

/** A sentence with one blank filled by a link: the words are escaped, the link
 *  is put in after. */
function withLink(sentence: string, blank: string, anchor: string): string {
  return esc(sentence).replace(blank, anchor);
}

function reason(lang: Language, project: string, why: SkipWhy): string {
  switch (why.code) {
    case "exists": {
      const key =
        why.kind === "closed" ? "proposals.existsClosed" : why.kind === "archived" ? "proposals.existsArchived" : "proposals.existsActive";
      return withLink(t(lang, key, { spec: "\u0001" }), "\u0001", link(specPagePath(project, why.folder), why.folder));
    }
    case "queued":
      return withLink(t(lang, "proposals.queued") + " \u0001", "\u0001", link(jobHref(why.jobId), why.jobId.slice(0, 8)));
    case "invalid":
      return esc(t(lang, INVALID_KEY[why.what], { max: why.max ?? "" }));
    case "refused":
      return esc(t(lang, "proposals.refused"));
  }
}

function row(lang: Language, project: string, p: ProposalResult): string {
  const title = p.title ? esc(p.title) : `<span class="muted">${esc(t(lang, "proposals.noTitle"))}</span>`;
  if (p.result === "created") {
    return `<li>${badge("done", t(lang, "proposals.created"))} ${link(jobHref(p.jobId), p.title || p.jobId)}</li>`;
  }
  return `<li>${badge("idle", t(lang, "proposals.skipped"))} ${title} <span class="muted">— ${reason(lang, project, p.why)}</span></li>`;
}

export function renderProposalsPanel(opts: { lang: Language; project: string; record: ProposalsRecord | null }): string {
  const { lang, project, record } = opts;
  if (record === null) return "";
  const problem = record.problem
    ? `<p>${esc(renderMessage(lang, { key: PROBLEM_KEY[record.problem], values: { detail: record.detail ?? "" } }))}</p>`
    : "";
  const list = record.proposals.length
    ? `<ul>${record.proposals.map((p) => row(lang, project, p)).join("")}</ul>`
    : "";
  return `<section id="proposals" class="reportpanel"><h2>${esc(t(lang, "proposals.heading"))}</h2>${problem}${list}</section>`;
}
