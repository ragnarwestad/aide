// The whole stylesheet, in one place. It is INLINED into every page
// rather than served as a file: the generated site is published by
// rsync and has to work from a folder, with no server and no second
// request. That constraint is why this is a TypeScript string and not
// a .css file.

export const CSS = `
:root { color-scheme: light dark; }
body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; }
.layout { display: flex; min-height: 100vh; }
.layout > nav { flex: 0 0 14rem; padding: 1rem; border-right: 1px solid #8884; }
.layout > nav ul { list-style: none; margin: 0; padding: 0; }
.layout > nav li { margin: 0.3rem 0; }
.layout > nav a { text-decoration: none; }
.layout > nav a.current { font-weight: 700; }
.layout > nav .nav-label { margin-top: 0.9rem; font-size: 0.8rem;
  font-weight: 600; color: #777; text-transform: uppercase;
  letter-spacing: 0.05em; }
main { flex: 1; padding: 1rem 1.5rem; max-width: 60rem; }
.pagehead { display: flex; justify-content: space-between; align-items: baseline;
            flex-wrap: wrap; gap: 0.5rem; }
.stamp { color: #777; font-size: 0.85rem; }
.proj-row { border: 1px solid #8884; border-radius: 8px; padding: 0.8rem 1rem;
            margin: 0.8rem 0; }
.proj-row.error { border-color: #c0392b; }
.error-text { color: #c0392b; }
.counts { color: #777; margin-left: 0.6rem; font-size: 0.9rem; }
.summary { color: #777; font-size: 0.9rem; }
.desc { margin-top: 0; }
.row { margin: 0.3rem 0; }
.row ul { margin: 0.1rem 0 0.4rem; padding-left: 1.4rem; }
.label { font-weight: 600; margin-right: 0.4rem; }
.muted { color: #777; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.25rem 0.6rem 0.25rem 0; vertical-align: top; }
thead th { border-bottom: 1px solid #8886; }
tr.archived td { color: #999; }
main h2 { font-size: 1rem; margin: 1.6rem 0 0.4rem; letter-spacing: 0.01em; }
.small { font-size: 0.82rem; }

/* The form is a panel, not three controls loose on the page. */
.panel { border: 1px solid #8884; border-radius: 10px; padding: 0.9rem 1.1rem 1rem;
  margin: 1rem 0 1.6rem; background: #8881; }
.panel h2 { margin-top: 0; }
.enqueue { display: flex; flex-wrap: wrap; gap: 0.9rem 1.2rem; align-items: end; }
.enqueue .field { display: flex; flex-direction: column; gap: 0.25rem; }
.enqueue .fieldlabel { font-size: 0.72rem; font-weight: 600; color: #888;
  text-transform: uppercase; letter-spacing: 0.06em; }
.enqueue select { font: inherit; padding: 0.35rem 0.5rem; border-radius: 6px;
  border: 1px solid #8886; background: transparent; color: inherit; min-width: 15rem; }
.enqueue .steps { display: flex; gap: 0.7rem; flex-wrap: wrap; padding-bottom: 0.35rem; }
.enqueue .stepbox { font-size: 0.9rem; display: inline-flex; align-items: center; gap: 0.3rem; }
.enqueue .gate { color: #888; padding-bottom: 0.35rem; }
.enqueue .stepbox.isdone { color: #888; }
.enqueue .tick { color: #22c55e; font-weight: 700; }
.enqueue button { font: inherit; font-weight: 600; padding: 0.4rem 0.9rem;
  border-radius: 6px; border: 1px solid #8886; background: #8882; color: inherit;
  cursor: pointer; }
.enqueue button:hover { background: #8883; }
.listhead { font-size: 0.78rem; font-weight: 700; color: #888; margin: 1.6rem 0 0.4rem;
  text-transform: uppercase; letter-spacing: 0.07em; }
.listnote { margin: 0.4rem 0 0; }
/* One list, cut and ordered on demand — the filter answers "is anything
   running?" without a second table standing there when nothing is. */
.listcontrols { display: flex; flex-wrap: wrap; gap: 0.5rem 1.6rem; align-items: center;
  margin: 0 0 0.7rem; }
.filtergroup { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
.filtergroup a { text-decoration: none; color: inherit; font-size: 0.88rem;
  padding: 0.15rem 0.6rem; border-radius: 999px; border: 1px solid transparent; }
.filtergroup a:hover { background: #8881; }
.filtergroup a[aria-current] { font-weight: 700; background: #8881; border-color: #8884; }
table.jobs thead a { text-decoration: none; color: inherit; }
table.jobs thead a:hover { text-decoration: underline; }
.sortmark { color: #3b82f6; }
.refusal { margin: 0 0 0.9rem; padding: 0.5rem 0.8rem; border-radius: 6px;
  background: #f59e0b22; border: 1px solid #f59e0b88; font-size: 0.9rem; }
.specinfo { margin: 0.9rem 0 0; padding-top: 0.7rem; border-top: 1px solid #8883;
  font-size: 0.9rem; }

/* State carries colour, but the word is always there too. */
.chip, .state { display: inline-block; padding: 0.05rem 0.5rem; border-radius: 999px;
  font-size: 0.8rem; border: 1px solid #8886; }
.state { font-weight: 600; }
.s-running { background: #3b82f622; border-color: #3b82f688; }
.s-queued { background: #8881; }
.s-awaiting-approval { background: #a855f722; border-color: #a855f788; }
.s-done { background: #22c55e22; border-color: #22c55e88; }
.s-stopped { background: #f59e0b22; border-color: #f59e0b88; }
.s-failed, .s-interrupted { background: #ef444422; border-color: #ef444488; }
.s-cancelled { background: #8881; color: #888; }
/* Worth noticing, not alarming — the same amber a cap-stop already uses. */
.unmerged { background: #f59e0b22; border-color: #f59e0b88; }

table.jobs td { padding: 0.5rem 0.8rem 0.5rem 0; border-bottom: 1px solid #8882; }
table.jobs .speccell { font-weight: 600; }
table.jobs .num { text-align: right; font-variant-numeric: tabular-nums; }
table.jobs .empty { padding: 1.2rem 0; }
/* One line per SPEC, with its phases beneath it. The rule goes ABOVE
   each spec rather than under every row: a spec and its four phase
   lines are one block, so a reader sees eight specs rather than forty
   rows. */
table.jobs tr.spechead td { border-bottom: none; border-top: 1px solid #8882;
  padding-top: 0.9rem; }
table.jobs tbody tr.spechead:first-child td { border-top: none; }
table.jobs tr.subrow td { border-bottom: none; padding-top: 0.1rem; padding-bottom: 0.1rem;
  font-size: 0.9rem; }
table.jobs tr.subrow:last-child td { padding-bottom: 0.6rem; }
table.jobs tr.subrow .phasecell { padding-left: 1.4rem; }
/* A phase nobody has run yet still holds its place — that is what makes
   progress readable — but it must not compete with what has happened. */
table.jobs tr.untried td { opacity: 0.55; }
/* One job, in full: facts on the left, values on the right. */
table.facts { width: auto; margin: 0.6rem 0 1rem; }
table.facts td { padding: 0.15rem 1rem 0.15rem 0; }
table.facts .label { color: #777; font-weight: 600; white-space: nowrap; }
table.facts .pips { display: inline-flex; margin: 0 0 0 0.5rem; vertical-align: middle; }
.specdesc { white-space: pre-wrap; max-width: 46rem; }
ul.activity { list-style: none; margin: 0.3rem 0; padding: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.82rem; }
ul.activity li { padding: 0.12rem 0; border-bottom: 1px solid #8882;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* One job says four different things. Under plain headings they ran
   together and a reader scrolled past the one they came for. */
.tabs { display: flex; flex-wrap: wrap; gap: 0.2rem; margin: 1rem 0 0;
  border-bottom: 1px solid #8884; }
.tabs a { text-decoration: none; color: inherit; font-size: 0.92rem;
  padding: 0.45rem 0.9rem; margin-bottom: -1px; border: 1px solid transparent;
  border-bottom: none; border-radius: 8px 8px 0 0; }
.tabs a:hover { background: #8881; }
.tabs a[aria-current] { font-weight: 700; background: #8881; border-color: #8884; }
.tabcount { display: inline-block; margin-left: 0.35rem; padding: 0 0.4rem;
  border-radius: 999px; background: #8883; font-size: 0.75rem; font-weight: 600;
  color: #666; }
.tabpanel { padding-top: 0.8rem; }
.tabpanel > h2:first-child { margin-top: 0.4rem; }
.pips { display: flex; gap: 3px; margin-top: 0.3rem; }
.pip { width: 14px; height: 4px; border-radius: 2px; background: #8884; }
.pip.past { background: #22c55e99; }
.pip.now { background: #3b82f6; }
td form { margin: 0; }
td button { font: inherit; font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 5px;
  border: 1px solid #8886; background: transparent; color: inherit; cursor: pointer; }
@media (max-width: 40rem) {
  .layout { flex-direction: column; }
  .layout > nav { flex: none; border-right: none; border-bottom: 1px solid #8884; }
  .layout > nav li { display: inline-block; margin-right: 0.8rem; }
}
`;
