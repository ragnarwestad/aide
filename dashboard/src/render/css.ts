// The whole stylesheet, in one place. It is INLINED into every page
// rather than served as a file: the generated site is published by
// rsync and has to work from a folder, with no server and no second
// request. That constraint is why this is a TypeScript string and not
// a .css file.
//
// One token block, six components, and nothing else. Every colour, type
// size, space and radius below is a `var(--…)` read from the block at
// the top — which is the ONLY place in this file a literal may appear.
// `test/css-token-guard.test.ts` enforces that by scanning this file
// between the `tokens:start`/`tokens:end` sentinels, and refuses any
// class a render file emits that is not one of the components. A spec
// that wants a look it cannot build from these has to change the
// TOKENS, visibly, rather than add a colour beside them.
//
// The values come from the brand handoff and the design sheet
// (`specs/102-design-foundation/assets/`): warm neutrals, vermilion for
// the accent, and danger carried by the darkest bar of the mark — not
// by a shade of the accent, so "running" and "refused" never rest on
// hue alone.

export const CSS = `
:root {
  color-scheme: light dark;
/* tokens:start */
  --bg: #EFECE5; --surface: #FBFAF7; --surface-2: #F3F0EA;
  --text: #16181C; --muted: #6B6760; --line: #DFDAD0; --line-strong: #C9C2B4;
  --accent: #D8492A; --accent-strong: #A8331A; --accent-soft: #F8E4DD;
  --on-accent: #FCFAF7;
  --ok: #2F7D4F; --ok-soft: #E3F0E7;
  --warn: #B7791F; --warn-soft: #F8EDD6;
  --danger: #6B1D0C; --danger-soft: #F1DDD7;
  --fs-s: 12px; --fs-m: 13.5px; --fs-l: 16px; --fs-xl: 20px; --lh: 1.45;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --r: 6px; --r-s: 4px;
/* tokens:end */
  --sans: system-ui, -apple-system, "IBM Plex Sans", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, "IBM Plex Mono", monospace;
}
/* Dark is the same ramp read from the other end: a dark surface takes a
   light foreground, which is why --danger is a pale peach here and the
   darkest bar tone in light. Not a typo — the same inversion every
   other pair makes. */
@media (prefers-color-scheme: dark) {
:root {
/* tokens:start */
  --bg: #16181C; --surface: #1F2226; --surface-2: #272B30;
  --text: #ECE9E2; --muted: #9A958B; --line: #33373D; --line-strong: #4A4F56;
  --accent: #F0663F; --accent-strong: #F5B7A3; --accent-soft: #3A2620;
  --on-accent: #16181C;
  --ok: #6FC08F; --ok-soft: #22352A;
  --warn: #E0A84A; --warn-soft: #3A2F1C;
  --danger: #F5B7A3; --danger-soft: #3D211B;
/* tokens:end */
}
.brand .mark-l { display: none; }
.brand .mark-d { display: block; }
}
/* Spec 107: the same two sets again, this time by choice rather than by
   preference. Both directions need a block of their own, and the reason
   is specificity, not tidiness: :root[data-theme="light"] (0-2-0)
   beats the bare :root inside the media query above (0-1-0) whatever
   the source order, so an explicit Light survives a machine set to
   dark — and the mirror image for Dark on a machine set to light.
   "Auto" has no block at all: it is the ABSENCE of the attribute, which
   falls straight through to the two rules above, unchanged. */
:root[data-theme="dark"] {
/* tokens:start */
  --bg: #16181C; --surface: #1F2226; --surface-2: #272B30;
  --text: #ECE9E2; --muted: #9A958B; --line: #33373D; --line-strong: #4A4F56;
  --accent: #F0663F; --accent-strong: #F5B7A3; --accent-soft: #3A2620;
  --on-accent: #16181C;
  --ok: #6FC08F; --ok-soft: #22352A;
  --warn: #E0A84A; --warn-soft: #3A2F1C;
  --danger: #F5B7A3; --danger-soft: #3D211B;
/* tokens:end */
  color-scheme: dark;
}
:root[data-theme="dark"] .brand .mark-l { display: none; }
:root[data-theme="dark"] .brand .mark-d { display: block; }
:root[data-theme="light"] {
/* tokens:start */
  --bg: #EFECE5; --surface: #FBFAF7; --surface-2: #F3F0EA;
  --text: #16181C; --muted: #6B6760; --line: #DFDAD0; --line-strong: #C9C2B4;
  --accent: #D8492A; --accent-strong: #A8331A; --accent-soft: #F8E4DD;
  --on-accent: #FCFAF7;
  --ok: #2F7D4F; --ok-soft: #E3F0E7;
  --warn: #B7791F; --warn-soft: #F8EDD6;
  --danger: #6B1D0C; --danger-soft: #F1DDD7;
/* tokens:end */
  color-scheme: light;
}
:root[data-theme="light"] .brand .mark-l { display: block; }
:root[data-theme="light"] .brand .mark-d { display: none; }

/* --- the page ------------------------------------------------------ */

body { font: var(--fs-m)/var(--lh) var(--sans); margin: 0;
  background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-strong); text-decoration: underline; }
.layout { display: flex; min-height: 100vh; }
.layout > nav { flex: 0 0 12rem; padding: var(--sp-5) var(--sp-4);
  border-right: 1px solid var(--line); }
.layout > nav ul { list-style: none; margin: 0; padding: 0; }
.layout > nav li { margin: 2px 0; }
.layout > nav a { display: block; padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-s); color: var(--text); }
.layout > nav a:hover { background: var(--surface); text-decoration: none; }
.layout > nav a.current { background: var(--accent-soft); color: var(--accent-strong);
  font-weight: 600; }
main { flex: 1; padding: var(--sp-5) var(--sp-6); max-width: 68rem; }
h1 { font-size: var(--fs-xl); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
main h2 { font-size: var(--fs-l); font-weight: 600; margin: var(--sp-5) 0 var(--sp-3); }
h3 { font-size: var(--fs-l); font-weight: 600; margin: var(--sp-5) 0 var(--sp-3); }
.pagehead { display: flex; justify-content: space-between; align-items: baseline;
  flex-wrap: wrap; gap: var(--sp-2); margin: 0 0 var(--sp-4); }
.stamp { color: var(--muted); font-size: var(--fs-s); }

/* --- the brand ------------------------------------------------------ */
/* Inline SVG and data URIs, per the handoff: the site is also opened
   straight from a folder, so there is no file to point a <link> at. */

.brand { display: flex; align-items: center; gap: var(--sp-2);
  margin: 0 0 var(--sp-3); padding: 0 var(--sp-2); text-decoration: none;
  color: var(--text); font-size: var(--fs-l); font-weight: 600;
  letter-spacing: -0.035em; }
.brand:hover { text-decoration: none; color: var(--text); }
.brand i { font-style: normal; color: var(--accent); }
.brand .mark, .brand .mark svg { display: block; width: 22px; height: 22px; }
.brand .mark-d { display: none; }

/* --- text roles ----------------------------------------------------- */

.small { font-size: var(--fs-s); }
.muted { color: var(--muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.label { font-weight: 600; margin-right: var(--sp-1); }
.desc { margin-top: 0; }
.summary { color: var(--muted); }
.counts { color: var(--muted); margin-left: var(--sp-2); font-size: var(--fs-s); }
.specdesc { white-space: pre-wrap; max-width: 46rem; }
.lbl { font-size: var(--fs-s); font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em; }
.layout > nav .lbl { display: block; margin-top: var(--sp-4);
  padding: 0 var(--sp-2); }
/* The theme choices sit under the link list. The pill's own 9px of
   padding is what lines its text up with the links above it, so the row
   itself gets none. */
.layout > nav .filters { margin-top: var(--sp-1); }

/* --- button --------------------------------------------------------- */
/* One button. Bare is secondary, and the variants are modifiers on it —
   there used to be three different buttons depending on which form they
   sat in. */

.btn { display: inline-flex; align-items: center; gap: var(--sp-2);
  height: 28px; padding: 0 var(--sp-3); border-radius: var(--r);
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--text); font: 500 var(--fs-m)/1 var(--sans);
  cursor: pointer; white-space: nowrap; }
.btn:hover { border-color: var(--muted); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn.primary:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
.btn.ok { background: var(--ok); border-color: var(--ok); color: var(--on-accent); }
.btn.danger { color: var(--danger); border-color: var(--danger); background: var(--surface); }
.btn.busy { color: var(--muted); border-color: var(--line); cursor: progress; }
.btn:disabled { opacity: 0.45; cursor: default; }
/* Deliberately not a second button of the same size: the merge override
   is a way out for someone who means it, and must not be the thing a
   mouse lands on. */
.btn.small { height: 22px; padding: 0 var(--sp-2); font-size: var(--fs-s); font-weight: 400; }
.spin { width: 12px; height: 12px; border-radius: 50%; flex: none;
  border: 2px solid var(--line-strong); border-top-color: var(--accent);
  animation: sp 0.9s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }

/* --- status badge --------------------------------------------------- */
/* State carries colour, but the word is always there too — and the dot
   is itself semantic: a live state has one, a settled one does not. */

.badge { display: inline-flex; align-items: center; gap: 6px; height: 20px;
  padding: 0 var(--sp-2); border-radius: 999px; font-size: var(--fs-s);
  font-weight: 500; border: 1px solid transparent; white-space: nowrap; }
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
.b-idle { background: transparent; color: var(--muted); border-color: var(--line); }
.b-running { background: var(--accent-soft); color: var(--accent-strong); }
.b-waiting { background: var(--warn-soft); color: var(--warn); }
.b-ready { background: var(--ok-soft); color: var(--ok); }
/* The only live variant with a visible border. Refused must never be
   told from running by hue alone, and the row that carries it also
   carries a .rowmsg.err with the warning mark. */
.b-refused { background: var(--danger-soft); color: var(--danger); border-color: var(--danger); }
.b-done { background: var(--surface-2); color: var(--muted); }

/* --- phase chip ----------------------------------------------------- */

.phases { display: inline-flex; flex-wrap: wrap; gap: var(--sp-1); }
.phase { display: inline-flex; align-items: center; gap: 6px; min-height: 24px;
  padding: 0 var(--sp-2); border-radius: var(--r-s); border: 1px solid var(--line);
  background: var(--surface); font-size: var(--fs-s); color: var(--text); cursor: pointer; }
.phase input { accent-color: var(--accent); margin: 0; }
.phase .box { display: inline-flex; width: 12px; height: 12px; color: var(--ok); }
.phase svg { width: 12px; height: 12px; }
.phase.checked { border-color: var(--line-strong); }
.phase.done { color: var(--muted); }
.phase.busy { border-color: var(--accent); background: var(--accent-soft);
  color: var(--accent-strong); cursor: default; }
.phase.off { opacity: 0.45; cursor: not-allowed; border-style: dashed; }
.phase.off .box { color: var(--muted); }

/* --- row-level message ---------------------------------------------- */

.rowmsg { display: flex; align-items: center; gap: var(--sp-2);
  padding: 6px 10px; border-radius: var(--r-s); font-size: var(--fs-s);
  border: 1px solid; margin: var(--sp-1) 0 0; }
.rowmsg svg { width: 14px; height: 14px; flex: none; }
.rowmsg.err { background: var(--danger-soft); border-color: var(--danger); color: var(--danger); }
.rowmsg.warn { background: var(--warn-soft); border-color: var(--warn); color: var(--warn); }
.rowmsg.info { background: var(--surface-2); border-color: var(--line); color: var(--muted); }
/* The slot the browser code writes a refusal into. Nothing to draw
   until it does. */
.rowmsg:empty { display: none; }
p.rowmsg { margin: 0 0 var(--sp-3); }

/* --- field ----------------------------------------------------------- */

.field { display: inline-flex; flex-direction: column; gap: var(--sp-1); }
.field > span { font-size: var(--fs-s); color: var(--muted); font-weight: 500; }
.field input, .field select, .field textarea {
  height: 28px; padding: 0 var(--sp-2); border-radius: var(--r-s);
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--text); font: var(--fs-m)/1 var(--sans); }
.field textarea { height: auto; padding: var(--sp-2); line-height: var(--lh);
  min-height: 84px; resize: vertical; width: 100%; }
.field.wide { flex-basis: 100%; max-width: 48rem; }
.field input[name="title"] { min-width: 18rem; }

/* --- filter pill ------------------------------------------------------ */

.filters { display: inline-flex; flex-wrap: wrap; gap: var(--sp-1); align-items: center; }
/* Two elements, one pill. A filter is a link because it goes somewhere;
   a theme choice is a button because it does something. That difference
   belongs in the markup, not in a second class that looks the same. */
.filters a, .filters button { padding: 3px 9px; border-radius: 999px; font-size: var(--fs-s);
  color: var(--muted); border: 1px solid transparent; }
.filters button { background: none; font-family: var(--sans); line-height: var(--lh);
  cursor: pointer; }
.filters a:hover, .filters button:hover { background: var(--surface); text-decoration: none; }
/* No bold on the chosen one: bold text is WIDER, so the pill grew and
   shoved its neighbours along every time you clicked. */
.filters a[aria-current], .filters button[aria-current] { background: var(--surface);
  border-color: var(--line-strong); color: var(--text); }

/* --- the list ---------------------------------------------------------- */

table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: var(--sp-2) var(--sp-3) var(--sp-2) 0;
  vertical-align: top; }
thead th { font-size: var(--fs-s); font-weight: 500; color: var(--muted);
  border-bottom: 1px solid var(--line); }
table.list { background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); }
table.list th { padding: var(--sp-2) var(--sp-3); background: var(--surface-2); }
table.list td { padding: 10px var(--sp-3); border-bottom: 1px solid var(--line);
  vertical-align: middle; }
table.list thead a { color: var(--muted); }
/* A column header is a control: a flat that shows on hover, and on the
   sorted column a chevron that the ascending state turns round. */
.sortlink { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px;
  margin: -2px -6px; border-radius: var(--r-s); text-decoration: none; }
.sortlink:hover { background: var(--surface); color: var(--text); text-decoration: none; }
.sortlink.on { color: var(--text); font-weight: 600; }
.sortlink svg { transition: transform 120ms ease, opacity 120ms ease; opacity: 0.35; }
.sortlink.on svg, .sortlink:hover svg { opacity: 1; }
.sortlink.asc svg { transform: rotate(180deg); }
.spec-name { font-weight: 600; font-family: var(--mono); font-size: var(--fs-m); }
.spec-title { color: var(--muted); font-size: var(--fs-s); margin-top: 2px; }
/* One line per SPEC, with its phases beneath it: the rule goes ABOVE
   each spec rather than under every row, so a reader sees eight specs
   rather than forty rows. */
table.list tr.spechead td { border-bottom: none; border-top: 1px solid var(--line);
  padding-top: var(--sp-3); }
table.list tbody tr.spechead:first-child td { border-top: none; }
table.list tr.subrow td { border-bottom: none; padding-top: 2px; padding-bottom: 2px;
  font-size: var(--fs-s); }
table.list tr.subrow:last-child td { padding-bottom: var(--sp-3); }
/* An open row's "more" line: full width, directly under the row it
   belongs to, so opening the disclosure changes one row's height and no
   column's width. */
table.list tr[data-more] td { border-bottom: none; padding-top: 0; padding-bottom: 2px; }
table.list tr.subrow .phasecell { padding-left: var(--sp-5); }
/* A phase nobody has run yet still holds its place — that is what makes
   progress readable — but it must not compete with what has happened. */
table.list tr.untried td { opacity: 0.55; }
.empty { padding: var(--sp-5) var(--sp-3); }
.listnote { margin: var(--sp-2) 0 0; color: var(--muted); font-size: var(--fs-s); }
/* A real control: a 24px flat with a chevron, in front of the spec's
   name. Quiet at rest, obvious on hover, and the shut state turns the
   chevron rather than swapping a glyph. */
.fold { display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: var(--r-s); color: var(--muted);
  vertical-align: middle; margin-right: var(--sp-1); }
.fold:hover { background: var(--surface-2); color: var(--text); }
.fold svg { transition: transform 120ms ease; }
.fold.shut svg { transform: rotate(-90deg); }
.branchlist { display: inline-flex; flex-wrap: wrap; gap: 2px var(--sp-2);
  font-weight: 400; font-family: var(--sans); }
.branch { white-space: nowrap; }
.pips { display: flex; gap: 3px; }
.pip { width: 14px; height: 4px; border-radius: 2px; background: var(--line-strong); }
.pip.past { background: var(--ok); }
.pip.now { background: var(--accent); }

/* --- rows and forms ----------------------------------------------------- */
/* "rowrun", "actionform", "mergeform", "resolveform", "newspecform",
   "refused" and "refusal" are what queue-client.ts selects on. They are
   laid out here and coloured nowhere: a rename breaks the browser code
   with no type error to catch it. */

.row { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.fact { margin: var(--sp-1) 0; }
.fact ul { margin: 2px 0 var(--sp-2); padding-left: var(--sp-5); }
td form { margin: 0; display: inline-block; }
.rowrun { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap; }
.mergeform { display: inline-block; margin-left: var(--sp-1); }
.actionform { margin-left: var(--sp-1); }
.resolveform { display: inline-block; margin-left: var(--sp-1); }
.mergeform form { display: inline-block; }
.more { font-size: var(--fs-s); }
.more summary { color: var(--muted); cursor: pointer; }
.more .row { margin-top: var(--sp-2); align-items: flex-end; }
/* The one form on this page that is not about an existing spec. Shut by
   default: the list is what people come here for. */
.newspec { margin: var(--sp-3) 0; }
/* A summary draws its native triangle only while its computed display
   is list-item, and .btn's inline-flex already suppresses it. The two
   rules below are for older WebKit, which needs telling. */
.newspec > summary { list-style: none; }
.newspec > summary::-webkit-details-marker { display: none; }
.newspecform { display: flex; gap: var(--sp-3); align-items: flex-end;
  flex-wrap: wrap; margin-top: var(--sp-3); }
.newspecform .refused { flex-basis: 100%; }
/* How runs work: a small question mark at the right-hand end of the
   filter row, not a block between the page's title and the list the
   reader came for. */
.row > details.intro { margin-left: auto; }
.row > details.intro > summary { display: inline-flex; align-items: center;
  justify-content: center; width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--line-strong); color: var(--muted);
  font-size: var(--fs-s); font-weight: 600; list-style: none; cursor: pointer; }
.row > details.intro > summary::-webkit-details-marker { display: none; }
.row > details.intro > summary:hover { border-color: var(--muted); color: var(--text); }
.row > details.intro p { margin: var(--sp-2) 0 0; max-width: 28rem; }
p.intro { margin: 0 0 var(--sp-3); }

/* --- the job page --------------------------------------------------------- */

table.facts { width: auto; margin: var(--sp-3) 0 var(--sp-4); }
table.facts td { padding: 2px var(--sp-4) 2px 0; }
table.facts .label { color: var(--muted); font-weight: 500; white-space: nowrap; }
table.facts .pips { display: inline-flex; margin-left: var(--sp-2); vertical-align: middle; }
ul.activity { list-style: none; margin: var(--sp-2) 0; padding: 0;
  font-family: var(--mono); font-size: var(--fs-s); }
ul.activity li { padding: 2px 0; border-bottom: 1px solid var(--line);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tabpanel { padding-top: var(--sp-4); }
.tabpanel > h2:first-child { margin-top: var(--sp-2); }

/* --- the project overview -------------------------------------------------- */

.proj-row { background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); padding: var(--sp-3) var(--sp-4); margin: var(--sp-3) 0; }
.proj-row.error { border-color: var(--danger); }
.error-text { color: var(--danger); }
/* Whether the spec's FOLDER has been archived on disk — a different
   question from whether a job is in flight for it, which the spec
   list's own row-state classes answer. They used to share the words
   "active" and "archived" and mean different things. */
tr.spec-archived td { color: var(--muted); }

@media (max-width: 40rem) {
  .layout { flex-direction: column; }
  .layout > nav { flex: none; border-right: none; border-bottom: 1px solid var(--line); }
  .layout > nav li { display: inline-block; margin-right: var(--sp-2); }
  main { padding: var(--sp-4); }
}
`;
