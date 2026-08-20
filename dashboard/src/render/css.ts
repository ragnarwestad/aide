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
  --fs-s: 12px; --fs-m: 13.5px; --fs-l: 16px; --fs-xl: 20px; --fs-brand: 26px;
  --lh: 1.45;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --r: 6px; --r-s: 4px;
  --overlay-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  --backdrop: rgba(0, 0, 0, 0.35);
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

/* Spec 118: the same trick again, on text rather than colour. Every
   consumption figure is rendered twice — a dollar span and a token span
   — and exactly one is shown. Dollars is the ABSENCE of the attribute,
   like Auto above, so a page whose script never ran reads the way it
   always did; the :not() is what makes that work without a
   data-unit="usd" nobody sets. A budget CAP is money either way and
   goes through neither span. */
:root[data-unit="tokens"] .u-usd { display: none; }
:root:not([data-unit="tokens"]) .u-tok { display: none; }

/* --- the page ------------------------------------------------------ */

/* The full-viewport-height floor used to sit on the .layout wrapper
   the sidebar shared with main (spec 119 removed it). It belongs on
   the body now, or a short page stops painting the background where
   its content ends. */
body { font: var(--fs-m)/var(--lh) var(--sans); margin: 0; min-height: 100vh;
  background: var(--bg); color: var(--text); }
a { color: var(--accent); text-decoration: none; }
a:hover { color: var(--accent-strong); text-decoration: underline; }
/* The mark left, the "…" menu right — space-between is what puts the
   menu at the right-hand end; DOM order alone would leave it beside
   the mark. */
header { display: flex; align-items: center; justify-content: space-between;
  gap: var(--sp-3); padding: var(--sp-4) var(--sp-6) var(--sp-3); }
header .brand { margin: 0; padding: 0; }
/* The two tabs: a real tab bar — the row sits ON the hairline, and the
   current tab is marked by an underline in the accent colour, PaceUp's
   tab bar being the reference (2026-08-19). */
body > nav.tabbar { display: flex; gap: var(--sp-4); padding: 0 var(--sp-6);
  border-bottom: 1px solid var(--line); }
.tabbar .tab { padding: var(--sp-2) 2px calc(var(--sp-2) + 1px); margin-bottom: -1px;
  min-width: 7rem; text-align: center;
  color: var(--muted); font-weight: 500; border-bottom: 2px solid transparent; }
.tabbar .tab:hover { color: var(--text); text-decoration: none; }
.tabbar .tab[aria-current] { color: var(--text); font-weight: 600;
  border-bottom-color: var(--accent); }
main { padding: var(--sp-5) var(--sp-6); max-width: 68rem; }
/* The frame is CENTRED: header, tabs and page share one width and sit
   in the middle of the window instead of flush against its left edge. */
header, body > nav.tabbar, main { max-width: 72rem; margin-inline: auto; }
h1 { font-size: var(--fs-xl); font-weight: 600; margin: 0; letter-spacing: -0.01em; }
main h2 { font-size: var(--fs-l); font-weight: 600; margin: var(--sp-5) 0 var(--sp-3); }
h3 { font-size: var(--fs-l); font-weight: 600; margin: var(--sp-5) 0 var(--sp-3); }
.pagehead { display: flex; justify-content: space-between; align-items: baseline;
  flex-wrap: wrap; gap: var(--sp-2); margin: 0 0 var(--sp-4); }
.stamp { color: var(--muted); font-size: var(--fs-s); }

/* --- the brand ------------------------------------------------------ */
/* Inline SVG and data URIs, per the handoff: the site is also opened
   straight from a folder, so there is no file to point a <link> at. */

/* Header-sized, not list-sized: the mark and the wordmark are the
   page's identity. 22px read as an icon that had shrunk in the wash,
   and 30px still did (2026-08-19) — so the brand gets a size of its
   own above the heading scale. */
.brand { display: flex; align-items: center; gap: var(--sp-2);
  margin: 0 0 var(--sp-3); padding: 0 var(--sp-2); text-decoration: none;
  color: var(--text); font-size: var(--fs-brand); font-weight: 600;
  letter-spacing: -0.035em; }
.brand:hover { text-decoration: none; color: var(--text); }
.brand i { font-style: normal; color: var(--accent); }
.brand .mark, .brand .mark svg { display: block; width: 40px; height: 40px; }
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

/* --- button --------------------------------------------------------- */
/* One button. Bare is secondary, and the variants are modifiers on it —
   there used to be three different buttons depending on which form they
   sat in. */

.btn { display: inline-flex; align-items: center; gap: var(--sp-2);
  height: 28px; padding: 0 var(--sp-3); border-radius: var(--r);
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--text); font: 500 var(--fs-m)/1 var(--sans);
  cursor: pointer; white-space: nowrap;
  /* Two of these are links, not buttons (spec 121): New spec on the
     spec list, and Cancel on /new. Both GO somewhere and do nothing
     else, which is what a link is for — but the page's own a-rule
     underlines on hover, and a button that grows an underline under
     the pointer stops looking like one. .brand, .filters and .sortlink
     each say the same thing for the same reason. */
  text-decoration: none; }
.btn:hover { border-color: var(--muted); text-decoration: none; }
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
/* The spinner and the lock REPLACE the checkbox, never stand beside it:
   both marks are checkbox-sized, so the chip keeps its width when a
   run starts (asked for repeatedly, last 2026-08-19). The input stays
   in the markup for the form's sake — it is disabled in both states
   and posts nothing. */
.phase.busy input, .phase.off input { display: none; }
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
/* border-box, or width:100% means "100% plus padding and border" and
   the box sticks 18px out of its own field — which is exactly the gap
   to whatever stands beside it (seen against Create, 2026-08-19). */
.field textarea { height: auto; padding: var(--sp-2); line-height: var(--lh);
  min-height: 84px; resize: vertical; width: 100%; box-sizing: border-box; }
.field.wide { flex-basis: 100%; max-width: 48rem; }
.field input[name="title"] { min-width: 18rem; }

/* --- filter pill ------------------------------------------------------ */

.filters { display: inline-flex; flex-wrap: wrap; gap: var(--sp-1); align-items: center; }
/* The whole controls line keeps clear air down to the table. */
#jobrows > .row:first-child { margin: var(--sp-3) 0; }
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
/* One line, always: the name is clamped with an ellipsis rather than
   wrapped — a wrapped tail landed in front of the branch marks and
   read as one of them (2026-08-19). The full name is in the title. */
.spec-name { font-weight: 600; font-family: var(--mono); font-size: var(--fs-m);
  display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.spec-name > .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; }
/* The summary wraps at a sensible measure instead of dragging the
   whole column wide: the phase lines start where this column ends, so
   an un-capped line of text put a hand's width of nothing between the
   buttons and the phases (2026-08-19). */
.spec-title { color: var(--muted); font-size: var(--fs-s); margin-top: 2px;
  max-width: 18rem; }
.spec-name { max-width: 18rem; }
/* One line per SPEC, with its phases beneath it: the rule goes ABOVE
   each spec rather than under every row, so a reader sees eight specs
   rather than forty rows. */
table.list tr.spechead td { border-bottom: none; border-top: 1px solid var(--line);
  padding-top: var(--sp-3); }
table.list tbody tr.spechead:first-child td { border-top: none; }
table.list tr.subrow td { border-bottom: none; padding-top: 2px; padding-bottom: 2px;
  font-size: var(--fs-s); }
table.list tr.subrow:last-child td { padding-bottom: var(--sp-3); }
/* The phase lines claim the width they need rather than wrapping: a
   box, a name and a select on one line, or the column squeezes them
   into three (2026-08-19).
   Top-aligned since spec 126: the leading line's cell carries the
   button stack ABOVE its phase, which makes that cell taller than the
   State/Started/Cost cells beside it. The table's own middle default
   would then float the buttons in the middle of the row they lead. */
table.list tr.subrow .phasecell { padding-left: var(--sp-5); white-space: nowrap;
  vertical-align: top; }
table.list tr.subrow .phasecell > .row { flex-wrap: nowrap; }
/* The phase lines are COLUMNS, not a ragged flex: the box gets a fixed
   width and so does the name, so every select starts at the same x,
   under the caption's own "Model" — which shares both widths by
   matching the same selectors. The "create" line has no box and the
   caption has neither, and both still line up: their first span is
   empty and holds the same place. */
table.list tr.subrow[data-step] .phasecell > .row > :first-child,
table.list tr.subrow[data-caption] .phasecell > .row > :first-child {
  flex: 0 0 2.5rem; }
table.list tr.subrow[data-step] .phasecell > .row > :nth-child(2),
table.list tr.subrow[data-caption] .phasecell > .row > :nth-child(2) {
  flex: 0 0 6rem; }
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
/* Nothing but hidden fields since spec 124: the boxes it posts are on
   the phase lines and the button that submits it is in the stack
   above, both reaching it by the "form" attribute alone. It is still a
   real form — the page works with script off — and still carries the
   class queue-client.ts selects on, so a press is still intercepted.
   It just has nothing to show, and a stack that gave it a gap would
   open a hole between two buttons. */
.rowrun { display: none; }
/* The vertical one: a row's buttons, one under the next, sharing the
   cell of the phase line they lead (specs 124, 126). Named by the
   archived design sheet and never ported until now. Flex-start because
   the buttons are different widths and a stack of centred ones has no
   edge to read down; the gap is the container's, as everywhere else.

   Two declarations come from sharing that cell (spec 126). The cap is
   14rem because the longest label a row can draw — the Merge button
   naming two repos at once — fits in it, and it is on the stack rather
   than on the cell because the cell holds the phase lines too. And
   white-space is put back to normal because that cell sets nowrap for
   the phase lines' sake: inherited, it would make "stop for approval
   between steps" one unbreakable line, and a column is at least as
   wide as its widest unbreakable content — widening the very column
   the stack was moved into to narrow. */
.stack { display: flex; flex-direction: column; align-items: flex-start;
  gap: var(--sp-2); max-width: 14rem; white-space: normal; }
/* The two rules below are the backstop for the day a label does not
   fit: a button clips rather than demanding a wider column, since a
   column that grows to fit one row's button moves every other row on
   the page, which is what the cap was declared to stop. */
.stack > * { max-width: 100%; }
.stack .btn { overflow: hidden; }
/* No margin on any of the three below, nor on "extra": the space
   between two controls is declared once, by the "row" that holds them
   (spec 120). A margin here would travel into every layout the form is
   put in next, and a container gap does not absorb it. "actionform"
   has no rule left at all — "td form" above gives it everything it
   had. */
.mergeform { display: inline-block; }
.resolveform { display: inline-block; }
.mergeform form { display: inline-block; }
/* The end of the action stack: the gate and "also touches" (the model
   left for the phase lines in spec 123). Small and bottom-aligned, so
   a labelled field and a bare checkbox share one line, and quiet
   enough that the buttons above them still read first. */
.extra { display: inline-flex; vertical-align: bottom;
  font-size: var(--fs-s); align-items: flex-end; }
/* A disclosure holding a form that is not about an existing spec. The
   New-spec form wore this until spec 121 moved it to /new, where a page
   needs nothing folded away; the Projects panel still does. */
.newspec { margin: var(--sp-3) 0; }
/* A summary draws its native triangle only while its computed display
   is list-item, and .btn's inline-flex already suppresses it. The two
   rules below are for older WebKit, which needs telling. */
.newspec > summary { list-style: none; }
.newspec > summary::-webkit-details-marker { display: none; }
.newspecform { display: flex; gap: var(--sp-3); align-items: flex-end;
  flex-wrap: wrap; margin-top: var(--sp-3); }
.newspecform .refused { flex-basis: 100%; }
/* The /new form's three lines. Each row takes the full width of the
   wrapping flex; the first top-aligns its two fields so Project and
   Depends on share a label line, the last bottom-aligns Create and
   Cancel with the Description box they act on. */
.newspecform .frow { display: flex; gap: var(--sp-4); align-items: flex-start;
  flex-basis: 100%; }
.newspecform .frow .field.wide { flex: 1 1 0; }
.newspecform .factions { display: flex; gap: var(--sp-2); align-self: flex-end; }
/* The Remove confirmation, on a page of its own since 2026-08-19 (the
   panel these rules used to scope under is gone). "addprojectform" and
   "removeform" are what queue-client.ts selects on — laid out here,
   coloured nowhere. */
.removeform [data-confirm] { display: flex; gap: var(--sp-2); align-items: flex-end; }
/* The "…" menu (spec 119): About and the theme choices, behind one
   disclosure at the right-hand end of the header. A POPOVER like
   .intro below — an open menu must lay over the page, not push the
   tab bar and everything under it down. */
.menu { position: relative; }
.menu > summary { display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 999px; border: 0; background: none;
  color: var(--muted); line-height: 1; list-style: none; cursor: pointer; }
.menu > summary::-webkit-details-marker { display: none; }
.menu > summary:hover { background: var(--surface-2); color: var(--text); }
/* Menu rows, not a box with text in it: every item is a full-width flat
   with a hover, the way a menu reads. */
.menupanel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 20;
  display: flex; flex-direction: column; align-items: stretch; gap: 2px;
  min-width: 13rem; padding: var(--sp-1); background: var(--surface);
  border: 1px solid var(--line-strong); border-radius: var(--r);
  box-shadow: var(--overlay-shadow); }
.menupanel > * { display: block; padding: 6px 10px; border-radius: var(--r-s); }
.menupanel > a { color: var(--text); }
.menupanel > a:hover { background: var(--surface-2); text-decoration: none; }

/* The About dialog: opened from the menu, closed by the cross, Escape
   or a click on the backdrop. The panel carries the padding so a click
   inside it can never be mistaken for one outside (the script closes on
   clicks whose target is the dialog element itself). */
dialog.about { padding: 0; border: 1px solid var(--line-strong); border-radius: var(--r);
  background: var(--surface); color: var(--text); max-width: 34rem;
  box-shadow: var(--overlay-shadow); }
dialog.about::backdrop { background: var(--backdrop); }
.aboutpanel { position: relative; padding: var(--sp-5) var(--sp-6); }
.aboutpanel h2 { margin: 0 0 var(--sp-3); font-size: var(--fs-l); font-weight: 600; }
.aboutclose { position: absolute; top: var(--sp-3); right: var(--sp-3);
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 999px; border: 0; background: none;
  color: var(--muted); cursor: pointer; }
.aboutclose:hover { background: var(--surface-2); color: var(--text); }

/* How runs work: a small question mark at the right-hand end of the
   filter row, not a block between the page's title and the list the
   reader came for. */
/* A POPOVER, not an inline fold: opening it lays the text over the page
   instead of shoving the list down. The details element keeps the no-JS
   behaviour; only the open box is lifted out of the flow. */
/* The New spec button carries the auto margin, so button and question
   mark sit together at the row's right-hand end. */
#jobrows > .row:first-child > .btn { margin-left: auto; }
.row > details.intro { position: relative; }
.row > details.intro > summary { display: inline-flex; align-items: center;
  justify-content: center; width: 20px; height: 20px; border-radius: 50%;
  border: 1px solid var(--line-strong); color: var(--muted);
  font-size: var(--fs-s); font-weight: 600; list-style: none; cursor: pointer; }
.row > details.intro > summary::-webkit-details-marker { display: none; }
.row > details.intro > summary:hover { border-color: var(--muted); color: var(--text); }
.row > details.intro[open] p { position: absolute; right: 0; top: calc(100% + 6px);
  z-index: 20; width: 28rem; max-width: 80vw; margin: 0; padding: var(--sp-3);
  background: var(--surface); border: 1px solid var(--line-strong);
  border-radius: var(--r); box-shadow: var(--overlay-shadow); }
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

/* The Add button above the list, at the right — the same place New spec
   holds on the spec list. */
.listtop { display: flex; margin: var(--sp-3) 0; }
.listtop > .btn { margin-left: auto; }
.proj-row { background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); padding: var(--sp-3) var(--sp-4); margin: var(--sp-3) 0;
  display: flex; align-items: center; gap: var(--sp-4); }
/* The row's text fills the line; the Remove keeps to the right of it. */
.proj-row > div:first-child { flex: 1; min-width: 0; }
.proj-row.error { border-color: var(--danger); }
.error-text { color: var(--danger); }
/* Whether the spec's FOLDER has been archived on disk — a different
   question from whether a job is in flight for it, which the spec
   list's own row-state classes answer. They used to share the words
   "active" and "archived" and mean different things. */
tr.spec-archived td { color: var(--muted); }

@media (max-width: 40rem) {
  header { padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  body > nav { padding: 0 var(--sp-4) var(--sp-2); }
  main { padding: var(--sp-4); }
}
`;
