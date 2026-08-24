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

// A chevron on a <select> has to be a background-image, and a
// background-image is resolved before custom properties — the URI
// cannot read a var(), so the colour has to be literal text inside it,
// percent-encoded. That is exactly the kind of literal the guard test
// refuses, so it lives in the token block, which is where the guard
// says a literal belongs. One copy of the path data, one interpolated
// colour: the two themes then differ by their stroke and nothing else,
// which is the drift spec 130 removed from the palettes.
//
// No semicolon anywhere inside the URI (hence `svg+xml,` and not
// `svg+xml;utf8,`): the guard's token parser splits a declaration on
// `;` and would read half an arrow as the whole value.
const chevron = (stroke: string) =>
  `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='${stroke}' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6.5L8 10.5L12 6.5'/%3E%3C/svg%3E")`;

// Each palette is written HERE and nowhere else, and read four times
// below. All four blocks have to exist — the reason is specificity and
// it is spelled out at the two of them that look redundant — but the
// VALUES had been typed out in each, so a colour change was two edits
// and nothing caught it when only one was made (spec 130).
const LIGHT_COLORS = `  --bg: #EFECE5; --surface: #FBFAF7; --surface-2: #F3F0EA;
  --text: #16181C; --muted: #6B6760; --line: #DFDAD0; --line-strong: #C9C2B4;
  --accent: #D8492A; --accent-strong: #A8331A; --accent-soft: #F8E4DD;
  --pip-skim: #F0A48B;
  --on-accent: #FCFAF7;
  --ok: #2F7D4F; --ok-soft: #E3F0E7;
  --warn: #B7791F; --warn-soft: #F8EDD6;
  --danger: #6B1D0C; --danger-soft: #F1DDD7;
  --chevron: ${chevron("%236B6760")};`;

const DARK_COLORS = `  --bg: #16181C; --surface: #1F2226; --surface-2: #272B30;
  --text: #ECE9E2; --muted: #9A958B; --line: #33373D; --line-strong: #4A4F56;
  --accent: #F0663F; --accent-strong: #F5B7A3; --accent-soft: #3A2620;
  --pip-skim: #FFC4AC;
  --on-accent: #16181C;
  --ok: #6FC08F; --ok-soft: #22352A;
  --warn: #E0A84A; --warn-soft: #3A2F1C;
  --danger: #E8836B; --danger-soft: #3D211B;
  --chevron: ${chevron("%239A958B")};`;

export const CSS = `
:root {
  color-scheme: light dark;
/* tokens:start */
${LIGHT_COLORS}
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
/* The dark mark is hidden by default and shown by the theme blocks
   below. This rule has to come BEFORE them: it has the same specificity
   as the media query's "display: block", and the later rule wins — with
   it written after the blocks (as it was until 2026-08-21) a machine set
   to dark, with no explicit choice, hid both marks and showed the word
   alone. */
.brand .mark-d { display: none; }
@media (prefers-color-scheme: dark) {
:root {
/* tokens:start */
${DARK_COLORS}
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
${DARK_COLORS}
/* tokens:end */
  color-scheme: dark;
}
:root[data-theme="dark"] .brand .mark-l { display: none; }
:root[data-theme="dark"] .brand .mark-d { display: block; }
:root[data-theme="light"] {
/* tokens:start */
${LIGHT_COLORS}
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
/* One ring for everything focusable, declared here rather than on each
   component: the page had no focus style anywhere, so every control
   focused in the browser's default blue — the one hue the palette does
   not contain, and which spec 102 took out of the stylesheet on
   purpose. :focus-visible and not :focus, or a mouse press leaves a
   ring behind it. */
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
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
/* The SAME bar one level in: a spec's own seven tabs, and a job's
   three. They were filter pills with a caption beside them until
   2026-08-23 — chips choose among values, tabs move between views, and
   these are views. Inside main, so the row takes the page's width
   rather than the frame's, which is why it is a rule of its own and
   not the body-child one above. */
nav.tabbar.subtabs { display: flex; flex-wrap: wrap; gap: var(--sp-4);
  border-bottom: 1px solid var(--line); }
/* Narrower than the site's two: seven tabs at 7rem each do not fit a
   laptop, and these labels are one word. They keep the row's own
   rhythm by their padding instead. */
nav.tabbar.subtabs .tab { min-width: 0; }
.tabbar .tab { padding: var(--sp-2) 2px calc(var(--sp-2) + 1px); margin-bottom: -1px;
  min-width: 7rem; text-align: center;
  color: var(--muted); font-weight: 500; border-bottom: 2px solid transparent; }
.tabbar .tab:hover { color: var(--text); text-decoration: none; }
.tabbar .tab[aria-current] { color: var(--text); font-weight: 600;
  border-bottom-color: var(--accent); }
main { padding: var(--sp-5) var(--sp-6); }
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
/* The surface name, not the product name: ordinary weight and muted, so
   the name stays the wordmark and the suffix says which surface. No
   backticks in here — this file IS a template literal. */
.brand .surface { font-weight: 400; color: var(--muted); }
.brand .mark, .brand .mark svg { display: block; width: 40px; height: 40px; }

/* --- text roles ----------------------------------------------------- */

.small { font-size: var(--fs-s); }
.muted { color: var(--muted); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.label { font-weight: 600; margin-right: var(--sp-1); }
.desc { margin-top: 0; }
.summary { color: var(--muted); }
.counts { color: var(--muted); margin-left: var(--sp-2); font-size: var(--fs-s); }
.specdesc { white-space: pre-wrap; max-width: 46rem; }
/* A whole spec file, shown as written (spec 150). Markdown is
   deliberately not rendered, so this carries what a reader needs to
   read one anyway: the file's own line breaks, a measure that does not
   run to the window's edge, and a scrollbar for the one thing wrapping
   cannot save — a table three columns wider than the box. */
/* One right edge for a document page (2026-08-23). The frame is 72rem
   and a tab's text stopped at 60, so the buttons on the head line sat a
   hand's width clear of everything they act on — "så ikke knappene
   forsvinner ut til høyre". The banner, the tabs and the panel
   share this one width; the site's own header and top tab bar keep the
   frame's, because the spec LIST is a table that wants all of it.
   Declared for both selectors at once so the number has one home. */
.doc, .specfile { max-width: 60rem; }
.specfile { white-space: pre-wrap; overflow-x: auto;
  font: var(--fs-s)/1.5 var(--mono); color: var(--text);
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r); padding: var(--sp-3); }
/* The small caption over a group of controls: Repos, Show, Theme, Units.
   It shouted in capitals until 2026-08-23 — four words in a row that a
   reader has to slow down for, saying nothing the ordinary spelling did
   not. The weight and the colour already set it apart from what it
   heads. */
.lbl { font-size: var(--fs-s); font-weight: 600; color: var(--muted);
  letter-spacing: 0.04em; }

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
/* Spec 208: the two kinds of waiting .btn.busy does not cover. A
   press has always changed the button that was pressed; opening a row,
   folding the list and moving between tabs changed nothing at all, and
   seven silent seconds read as a dead app.

   Deliberately quiet — a dim and a progress cursor, no spinner and no
   reserved space. The rows are about to be replaced or the document is
   about to change; anything louder would flash on every fast answer,
   which is most of them now. */
.awaiting { opacity: 0.55; cursor: progress; }
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
.phase.off { opacity: 0.45; cursor: not-allowed; border-style: dashed; }
/* The lock REPLACES the checkbox, never stands beside it: the mark is
   checkbox-sized, so the chip keeps its width (asked for repeatedly,
   last 2026-08-19). The input stays in the markup for the form's sake
   — it is disabled and posts nothing. A running phase had a spinner
   here on the same terms until spec 168, which moved that signal to
   the row's own Progress marker. */
.phase.off input { display: none; }
.phase.off .box { color: var(--muted); }
/* A phase LINE's box has no label of its own — the phase's name leads
   the line, and the chip holds the checkbox and nothing else — so the
   frame outlined nothing (spec 176). Selected on the data attribute
   rather than on .phase itself: the chips that DO carry a label, the
   "Also touches" repos (data-project) and the new-spec form's
   "Depends on" (data-depends), frame something and keep their frame. */
.phase[data-phase] { border-color: transparent; }

/* --- a spec's remaining checks (spec 182) ---------------------------- */

/* The list sits in the spec page's banner, above the tab bar. Its job
   is that an OPEN row cannot be mistaken for a settled one at a glance:
   the open rows keep the full text colour and a button, the done ones
   go muted and struck through. Nothing here depends on the mark's
   colour alone. */
.checks { margin: var(--sp-4) 0 0; }
.checkshead { margin: 0 0 var(--sp-2); }
.checklist { list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: var(--sp-1); }
.checklist .checkphase { color: var(--muted); font-size: var(--fs-s); font-weight: 600;
  margin-top: var(--sp-2); }
.checklist .checkphase:first-child { margin-top: 0; }
.check { display: flex; align-items: baseline; gap: var(--sp-2); }
.check.done .checktask { color: var(--muted); text-decoration: line-through; }
/* One box-sized slot, whichever of the two things is in it: the mark a
   row on the spec page shows, and the real checkbox the Edit form draws
   for a row that is still open (spec 188). Fixed width so every row
   lines up whether it is a mark or a control. */
.checkbox { display: inline-flex; align-items: center; justify-content: center;
  width: 18px; min-width: 18px; height: 18px; padding: 0; flex: none;
  font-size: var(--fs-m); line-height: 1; }
label.checkbox { cursor: pointer; }
label.checkbox input { margin: 0; cursor: pointer; }

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
/* The two selects on a phase line are named here alongside the fields
   because neither one is inside a field: modelPicker renders into a
   span.row and aiPicker straight into the AI column's own cell
   (queue-list.ts), so the .field selector reached neither, and both
   carried no height, border, background or colour from the design
   system at all. Attribute selectors rather than a wrapper — both
   attributes are already in the markup, so this stays a stylesheet
   change.
   The pair sits side by side since spec 179, and the four rules below
   are what makes them read as a pair: same height, same border, same
   arrow, same disabled look. The one thing that differs is the face
   the text is set in, further down, and that is about what they HOLD
   — a model name is a value, an AI is a thing's name. */
.field input, .field select, .field textarea,
select[name^="model."], select[data-ai] {
  height: 28px; padding: 0 var(--sp-2); border-radius: var(--r-s);
  border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--text); font: var(--fs-m)/1 var(--sans); }
/* Without appearance: none the browser goes on drawing its own control
   on top of ours — its chevron, its inner edge, and a height that is
   advisory rather than binding. -webkit-appearance is spelled out
   alongside because Safari has historically wanted it. The right-hand
   padding is what keeps our arrow BESIDE a long option label, such as
   claude-sonnet-4-6, instead of over the end of it. The background is
   set piece by piece: the shorthand would drop the var(--surface)
   ground the rule above gives it. */
.field select, select[name^="model."], select[data-ai] {
  appearance: none; -webkit-appearance: none;
  padding-right: 26px;
  background-image: var(--chevron);
  background-repeat: no-repeat;
  background-position: right 7px center;
  background-size: 12px; }
/* A disabled field had no look of its own at all, so a model picker
   disabled for the length of a run still read as pressable and the
   reason for it was only findable by hovering. The button keeps its own
   opacity: 0.45 — a button and a field fail differently, and on a
   select a blanket opacity dims the border into invisibility.
   background-color rather than the shorthand, for the same reason as
   above. */
.field input:disabled, .field select:disabled, .field textarea:disabled,
select[name^="model."]:disabled, select[data-ai]:disabled {
  background-color: var(--surface-2); color: var(--muted);
  border-color: var(--line); cursor: default; }
.field select:disabled, select[name^="model."]:disabled, select[data-ai]:disabled {
  background-image: none; }
/* A model name is a value, like a spec id, a duration or a branch name,
   and its version digits are what a reader is actually comparing. The
   project and checkout pickers name a thing rather than a value and
   stay in the sans face. --fs-s because mono runs wider at the same
   nominal size, and these sit in a table column whose width is argued
   over in the comments around .phasecell.
   select[data-ai] is deliberately NOT here (spec 179), although it
   stands right beside the model select and shares every other rule
   above with it: "Claude Code" is a thing's NAME, which is the case
   the sentence above already carves out for the project and checkout
   pickers. */
select[name^="model."] {
  font-family: var(--mono); font-size: var(--fs-s); }
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

/* A table has a width of its own and no way to give it up: six columns
   of dates and figures are wider than a phone whatever the CSS says.
   The box scrolls instead of the page, the same self-contained answer
   .specfile already gives for a preformatted file too wide to wrap
   (spec 155). Unconditional, not phone-only — a narrow WINDOW on a
   desktop has the same problem. */
.tablewrap { overflow-x: auto; }

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
/* Hard against the end of the fixed-width name line, so every row's
   pips start at the same x whatever its name is. */
.pipslot { margin-left: auto; padding-left: var(--sp-2); }
.spec-name { font-weight: 600; font-family: var(--mono); font-size: var(--fs-m);
  display: flex; align-items: center; gap: var(--sp-2); min-width: 0;
  /* 27rem since the pips joined this line and the Progress column went
     with them (2026-08-22): the row is one column shorter, and 18rem
     clamped a name to "194-archive-decides-on-th…" with the width
     standing empty to the right of it.
     A WIDTH, not a maximum (2026-08-23): a short name left the pips
     sitting further left than a long one's, so they stepped in and out
     down the column instead of forming one. The name still truncates
     at the same place; what is fixed is where the line ends. */
  width: 27rem; }
.spec-name > .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  min-width: 0; }
/* The summary wraps at a sensible measure instead of dragging the
   whole column wide: the phase lines start where this column ends, so
   an un-capped line of text put a hand's width of nothing between the
   buttons and the phases (2026-08-19). */
/* Indented to the NAME, not to the cell: the fold control stands in
   front of the name, and the two lines under it began at the cell's
   own left edge — a step to the left of everything they belong to
   (asked for 2026-08-23). The offset is the control's own footprint:
   its width, its margin, and the flex gap after it. */
.spec-title, .branchlist {
  margin-left: calc(24px + var(--sp-1) + var(--sp-2)); }
.spec-title { color: var(--muted); font-size: var(--fs-s); margin-top: 2px;
  max-width: 27rem; }
/* The archive's Description column (spec 170). A spec's Description
   section runs to several paragraphs — the whole of it is in the cell, because
   the search reads the whole of it — so the cell is bounded here rather
   than left to the browser: two lines, and a measure that stops one
   paragraph from taking the width the other three columns need. Clamped
   rather than cut on the server, so nothing the reader can search for is
   missing from the markup. -webkit- prefixed as well as plain: the
   prefixed trio is what every browser actually implements today. */
/* Twice the width a search box gets by default, and no caption over it:
   the button beside it says what it is, and the caption made the field
   the taller of the two (2026-08-23). */
.archive-q { width: 26rem; max-width: 100%; }
/* The whole date, on one line, never cut. */
.archive-date { white-space: nowrap; }
/* And the same for what the spec cost (spec 207): "1h04m" broken over
   two lines reads as two numbers, not one. The cell is empty for a spec
   whose archive never recorded a figure, which is a blank and not a gap
   in the row. */
.archive-duration { white-space: nowrap; }
.archive-desc { color: var(--muted); font-size: var(--fs-s); max-width: 34rem;
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
/* One line per SPEC, with its phases beneath it: the rule goes ABOVE
   each spec rather than under every row, so a reader sees eight specs
   rather than forty rows. */
table.list tr.spechead td { border-bottom: none; border-top: 2px solid var(--line-strong);
  padding-top: var(--sp-3); }
/* An OPEN spec is one thing, not a header and some loose lines under it:
   its own faint ground holds the phase lines and the button together, so
   a reader can see which group a control belongs to (asked for
   2026-08-23). Faint on purpose — the separator above is what divides
   the specs; this only gathers what is already inside one. */
table.list tr.spechead:has(+ tr.subrow) td,
table.list tr.subrow td,
table.list tr.specnotice:has(+ tr.subrow) td { background: var(--surface-2); }
table.list tbody tr.spechead:first-child td { border-top: none; }
/* The row's message panel (spec 143): part of the row above it, not a
   row of its own. It draws no rule and adds no padding the message's
   own box already brings — the separator a reader sees is still the
   next spec's top border. */
table.list tr.specnotice td { border-bottom: none; border-top: none;
  padding-top: 0; padding-bottom: var(--sp-2); }
table.list tr.specnotice .rowmsg { margin: 0; }
table.list tr.subrow td { border-bottom: none; padding-top: 2px; padding-bottom: 2px;
  font-size: var(--fs-s); }
/* Air under an OPEN spec's last phase line, so it does not sit hard
   against the next spec's name. The rule read :last-child alone until
   spec 167, and :last-child means the last row in the TABLE — so it
   fired only when the open spec happened to be the bottom one, and any
   spec below it left the last phase line on its ordinary 2px. A
   collapsed row looks right because its air comes from ABOVE: the head
   row has its own border-top and padding-top.
   :has() reads FORWARD from the subrow to the head row that follows it,
   which is the only direction a flat, unwrapped tbody allows without a
   wrapper element per spec. A browser without :has() keeps the 2px —
   the rule does nothing rather than erroring, which is an acceptable
   way for a spacing detail to degrade. */
table.list tr.subrow:last-child td,
table.list tr.subrow:has(+ tr.spechead) td { padding-bottom: var(--sp-3); }
/* A phase line is TWO cells since spec 192 — the name, then the three
   choices the line offers together. It was three real columns from spec
   165 (the name, the phase's AI, the model with the box beside it), and
   three flex children of one cell up to then, each pinned to a fixed
   width so every select started at the same x.
   A real column ended the hand-pinning, and charged a reserved width
   and a cell's padding for it — three columns is two lots of both
   between the name and the box, which is the gap that made the three
   controls read as three separate things. They share a cell again, and
   the pinned widths do NOT come back: the one width reserved below is
   stated on the model select itself.
   The name stands hard left with nothing in front of it: it is what
   the eye lands on first, and it began 2.5rem in, behind the box. */
table.list tr.subrow .phasecell { white-space: nowrap; }
/* The AI select, the model select and the phase's box, in the column
   the head row's pips leave empty on a phase line: they claim the width
   they need rather than wrapping, or the cell squeezes them into two
   lines. */
table.list tr.subrow .modelcell > .row { flex-wrap: nowrap; }
/* The one width this cell does reserve: it holds the column still when
   the row's AI changes, since a browser sizes a select by its widest
   OPTION and the models one tool offers are not the width of the
   other's. A floor, not a fix — a model name longer than any real
   configuration widens the select and takes the box with it, which is
   better than clipping the name.
   6.25rem, not the 10rem it was: the list used to carry every model
   under both tools, and now carries one tool's at a time (spec 179's
   filter), so the floor no longer has to clear the widest name in the
   whole configuration. Asked for 2026-08-22 — the reserved width was
   pushing the phase, the AI and the model apart.
   Selected by the select's own NAME, never by its position: the AI
   select sits in front of it whenever two tools are configured, so
   a :first-child rule would cap that one instead and let the model select
   regrow to its widest option — the exact crowding spec 192 removes. */
table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 6.25rem; max-width: 100px; }
/* A caption is as wide as the control under it, so "AI" stands over the
   AI select and "Model" over the model select rather than the three
   words running together at the left edge of the cell. Same numbers as
   the controls themselves, one line apart, because a caption that
   drifts from its control is worse than no caption. */
table.list tr.subrow .modelcell > .row > [data-cap="ai"],
table.list tr.subrow .modelcell > .row select[data-ai] { min-width: 8rem; max-width: 8rem; }
table.list tr.subrow .modelcell > .row > [data-cap="model"] { min-width: 6.25rem; max-width: 100px; }
/* The mobile fold control (design handoff, mobile-spec-row): a plain
   inline wrapper on desktop, where the checkbox and chevron stay
   invisible and every phase line keeps reading exactly as it did
   before this control existed. The mobile media query below is what
   gives the chevron a shape and the checkbox a job. */
.phasefold { display: inline-flex; align-items: center; gap: var(--sp-1); }
.phasefold .foldphase { display: none; }
.phasefold .foldchevron { display: none; }
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
/* 21px, not 14: a third of the bar has to be a thing a reader can see,
   and 21 is the smallest width divisible by three that stays a mark
   rather than a bar (spec 210). Widened ONCE, for every pip, rather
   than while a run is going — a pip that grew mid-run would move
   everything on the line beside it. The position and overflow are what
   the fill below is drawn inside. */
.pip { width: 21px; height: 4px; border-radius: 2px; background: var(--line-strong);
  position: relative; overflow: hidden; }
.pip.past { background: var(--ok); }
/* The one moving thing on the page that says a phase is RUNNING (spec
   168). It was a spinner on that phase's checkbox, which only exists
   on an open row — so the closed row, the whole interface for the
   ordinary case since spec 157, showed no motion at all. The mark
   already answers half the question in --accent alone: WHICH phase.
   A lighter band travelling along it says "and it is alive" in the
   same 14x4 glyph, taking no space and needing no new element.
   Movement ALONG the bar, in the direction the four marks already
   read, rather than a pulse — a pulse reads as an alert.
   No animation-delay, ever: every row's pip is torn down and rebuilt
   in one innerHTML swap (queue-client.ts), so a plain infinite
   animation starts them all together. A delay keyed off a row's index
   or a job's start time is what would make four running specs shimmer
   at random instead of moving as one. */
.pip.now { background: linear-gradient(90deg, var(--accent), var(--pip-skim), var(--accent));
  background-size: 260% 100%; animation: pipskim 1.6s linear infinite; }
@keyframes pipskim { from { background-position: 130% 0; } to { background-position: -130% 0; } }
/* Motion off, and the reader can still tell a running phase from a
   waiting one: --accent stays, the mark simply stands still. */
@media (prefers-reduced-motion: reduce) {
  .pip.now { animation: none; background: var(--accent); }
}
/* Which THIRD of a running implement is behind it (spec 210). The parts
   already done stand still in solid --accent; the rest goes on
   shimmering underneath, so the pip says "this much is finished, and it
   is still working" in the one glyph. Inside the pip, never around it:
   the box is the same 21x4 whatever the fill.
   The colour keeps its one meaning — blue for running — and the fill is
   what says how far. A second colour here would make one pip answer two
   questions.
   Keyed off the running pip and not off every pip: a third belongs to
   the phase that is running, and only a running phase has one. */
.pip.now[data-third]::after { content: ""; position: absolute; inset: 0 auto 0 0;
  background: var(--accent); }
.pip.now[data-third="1"]::after { width: 33%; }
.pip.now[data-third="2"]::after { width: 67%; }

/* --- rows and forms ----------------------------------------------------- */
/* "rowrun", "actionform", "newspecform", "refused" and
   "refusal" are what queue-client.ts selects on. They are
   laid out here and coloured nowhere: a rename breaks the browser code
   with no type error to catch it. */

.row { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
/* The row's one action keeps its place whatever it currently is. The
   label changes with the state — Analyze, Implement, Cancel — and a
   box that grew with it moved the columns to its right on every
   press. The width is the widest label ("Implement") plus the button's
   own padding; the slot is drawn empty rather than removed on a row
   with nothing to press, for the same reason. Deliberate movement —
   opening a row — is the exception, and it is not this. */
.actionslot { display: inline-flex; justify-content: flex-start;
  min-width: 6.5rem; }
/* And the slot itself stands at the column's RIGHT EDGE, whatever the
   badge in front of it says (spec 167). The slot has reserved a fixed
   width since spec 157, but the badge has none — its wording runs from
   two syllables to most of a sentence — so the buttons began at
   different x positions down the column and moved as a state changed.
   space-between costs no reserved space at all, and it is scoped to the
   State cell's own row: the shared .row above is the phase lines' and
   the filter bar's too.
   No badge is QUOTED here on purpose: a comment in this file is served
   as page content, so a state's wording written out below would be
   found by every test that asks whether the page says it.
   One residue, left open: a table column is as wide as its widest cell,
   so the COLUMN still moves if the longest badge on the page changes.
   Closing that needs a declared width, which no spec owns yet. */
table.list tr.spechead > td > .row { justify-content: space-between; }
.fact { margin: var(--sp-1) 0; }
.fact ul { margin: 2px 0 var(--sp-2); padding-left: var(--sp-5); }
td form { margin: 0; display: inline-block; }
/* Nothing but hidden fields since spec 124: the boxes it posts are on
   the phase lines and the button that submits it stands beside the
   state badge (spec 157), both reaching it by the "form" attribute
   alone. It is still a real form — the page works with script off —
   and still carries the class queue-client.ts selects on, so a press
   is still intercepted. It just has nothing to show, and a container
   that gave it a gap would open a hole beside the badge. */
.rowrun { display: none; }
/* The stack of a row's buttons stood here until spec 157, with a 14rem
   cell of its own above it: a row draws ONE button now, beside the
   state badge, and the two share the page's ordinary "row" container.
   That container wraps, which is the whole width rule the pairing
   needs — the badge and the button drop to two lines rather than
   widening a column the whole table is aligned on. */
/* No margin on "extra" below: the space between two controls is
   declared once, by the "row" that holds them (spec 120). A margin here
   would travel into every layout the form is put in next, and a
   container gap does not absorb it. "actionform" has no rule at all —
   "td form" above gives it everything it had, and the conflict form's
   rule went with the control it belonged to (spec 171). */
/* The last thing in the State cell of an open row: "also touches" (the
   model left for the phase lines in spec 123). Small and
   bottom-aligned, so a labelled field and a bare checkbox share one
   line, and quiet enough that the badge and the button beside them
   still read first. */
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
/* The question mark carries the auto margin, so it and the New spec
   button sit together at the row's right-hand end. */
#jobrows > .row:first-child > details.intro { margin-left: auto; }
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

/* --- narrow: one screen, one place (spec 155) ------------------------- */
/* Every rule the phone layout needs is in this one block, and each one
   repeats the selector of the desktop rule it overrides rather than
   writing a shorter one — the override wins by coming later, and a
   selector with one class more or fewer would change the specificity
   and quietly stop applying. */

@media (max-width: 40rem) {
  header { padding: var(--sp-3) var(--sp-4) var(--sp-2); }
  body > nav { padding: 0 var(--sp-4) var(--sp-2); }
  main { padding: var(--sp-4); }

  /* Started and Cost are not what a phone is for on a PHASE line: the
     reader is checking whether a run finished and pressing Run or
     Cancel, and neither figure is needed to do either. Dropped rather
     than squeezed — six columns in 390px is six unreadable ones.
     Scoped to tr.subrow, not every row: the spec's own header line
     keeps its date/cost, folded onto line 2 with the badge and the
     button instead (design handoff, mobile-spec-row). */
  table.list tr.subrow [data-col="started"], table.list tr.subrow [data-col="cost"] { display: none; }

  /* The spec LIST leaves table layout entirely at this width — found
     with a 500px iframe walk (2026-08-24): a flex tr inside a table
     still contributes its one-line max-content width (~458px, the
     badge + button + date + cost side by side) to the table's minimum,
     so .tablewrap grew a scrollbar below ~480px however shrinkable the
     items themselves were. As stacked blocks the flex rows wrap freely
     and nothing computes a table minimum. Scoped to .speclist: the
     archive page and the settings table share .list and keep real
     table layout. The remaining true-table rows here (the notice
     panel, the "no spec matches" line) hold one full-width cell each,
     so block costs them nothing. The three tab links up top get their
     7rem floor lifted for the same overall goal — three of them do
     not cross 360px otherwise. */
  table.speclist, table.speclist tbody { display: block; }
  table.speclist tr:not(.spechead):not(.subrow) { display: block; }
  table.speclist tr:not(.spechead):not(.subrow) > td { display: block; }
  .tabbar .tab { min-width: 0; }

  /* The spec header line (design handoff, mobile-spec-row): the mock
     puts the fold/name/pips alone on the first line and the badge, the
     Archive button and the date/cost together on a second — one flex
     row rather than four independent table cells, since a cell cannot
     wrap around another cell's boundary. tr.spechead becomes the flex
     container; each td is still a td, just laid out as a flex item
     instead of a table cell. */
  table.list tr.spechead { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); }
  /* min-width: 0 on the cells, or nothing ever truncates: a flex item
     refuses to shrink below its content's min-content width by default
     (min-width: auto), so a long spec name forced the whole row — and
     with it the table — wider than the viewport instead of letting the
     label's own ellipsis do its job. */
  table.list tr.spechead > td:first-child { flex: 1 1 100%; min-width: 0; }
  table.list tr.spechead > td:not(:first-child) { flex: 0 0 auto; min-width: 0; }
  /* The vertical padding moves off the cells and onto the row: each td
     kept the desktop 10px above and below, and two tds stacked as two
     flex lines put 10px + the row gap + 10px between the name line and
     the badge line — read as a hole. The row pads once, at its edges. */
  table.list tr.spechead { padding-top: 10px; padding-bottom: 10px; }
  table.list tr.spechead > td { padding-top: 0; padding-bottom: 0; }
  /* The desktop rule (space-between, base stylesheet) spaces the badge
     and the Archive button apart to fill a table column's own width —
     a gap that ate into line 2's space here too, for the same reason
     the auto-margin above did: reserved space a tight line cannot
     spare. flex-start keeps them side by side with the ordinary gap. */
  table.list tr.spechead > td > .row { justify-content: flex-start; }
  /* .actionslot reserves 6.5rem (the widest label, "Implement") so the
     button does not shift position between rows sharing a desktop
     column. There is no such column on mobile — every row is its own
     block — so a shorter label ("Archive") left that width standing
     empty, which is what was still forcing Cost to wrap even after the
     other two gaps were closed. */
  table.list tr.spechead .actionslot { min-width: 0; }
  /* Not margin-left:auto (removed): pushing date/cost hard to the right
     reserves that gap even when the line is tight, which is what was
     forcing Cost to wrap onto a third line despite there being room for
     it if the gap were not reserved. Plain flow, sharing the row's own
     gap like every other item on the line, fits all four. */
  table.list tr.spechead [data-col="started"] { display: block; }
  table.list tr.spechead [data-col="cost"]::before { content: "· "; }

  /* .spec-name/.spec-title/.archive-desc carry a desktop alignment width
     (27rem/27rem/34rem), and it MUST be overridden here — width: auto,
     put back 2026-08-24 after being dropped in an earlier round: the
     27rem (432px) held below ~480px viewports and pushed the pips out
     of the right edge. It looked fine at the window width it happened
     to be tested at, which is how the regression slipped through. */
  .spec-name, .spec-title, .archive-desc { width: auto; max-width: none; box-sizing: border-box; }

  /* A long name gets two lines before it clamps to an ellipsis, instead
     of one. The pips are their own flex item and do not wrap with it —
     align-items reverts to the top so they sit against the name's
     FIRST line, not centred against both. The chevron's own margin
     plus the flex gap stacked into two lots of space between it and
     the name; the margin is dropped here so only the (smaller) gap
     remains. flex:1 on the label is not cosmetic: without it the label
     kept its own intrinsic width and wrapped a line early, leaving the
     space the auto-margin before the pips was not using empty instead
     of given to the name. */
  .spec-name { gap: var(--sp-1); }
  .spec-name > .fold { margin-right: 0; }
  /* One line, truncated with an ellipsis against the pips — same rule
     the base (desktop) style already uses, restated here only for the
     flex-basis: 0, not auto, is what actually gives the label the
     row's free width instead of sizing to its own content first (the
     bug behind the "half the row" width report). */
  .spec-name > .label { flex: 1 1 0%; min-width: 0; }

  /* No sortable column headings on mobile: "Spec/State/Started/Cost"
     headed a column layout that is gone at this width (Started and
     Cost are hidden, State moved onto the spec's own second line), and
     the mock draws no heading row here at all. */
  table.list thead { display: none; }

  /* The fold control (design handoff, mobile-spec-row), second attempt
     (2026-08-24). The first attempt toggled .modelcell between
     display:block and table-cell depending on the checkbox, and that
     was the bug: a table computes ONE column layout from ALL its rows,
     so rows disagreeing about their display type scattered the
     selects and tick boxes into the wrong columns. This version never
     lets the table's column layout see these rows at all: EVERY subrow
     is a flex line, identically, open or shut — the same technique
     tr.spechead above uses, where it holds up. Per-row state changes
     inside a flex container affect only that row.

     Collapsed: [chevron name] [tick box] [status] on one line — the
     name column fixed at 5.3rem ("implement", the longest) so the box
     and status start at the same x on all four lines. Open: .aimodel
     becomes a full-width item ordered last, so AI and Model drop to a
     line of their own below, 50/50.

     display:contents on .modelcell and its .row lifts the box and
     .aimodel up to be flex items of the row itself; selectors like
     ".modelcell > .row select" still match (they read the DOM, not
     the boxes). The caption row is also a subrow, hidden below rather
     than flexed. */
  table.list tr.subrow { display: flex; flex-wrap: wrap; align-items: center;
    gap: var(--sp-1) var(--sp-2); }
  table.list tr.subrow > td { border-bottom: none; }
  table.list tr.subrow { border-bottom: 1px solid var(--line); }
  table.list tr.subrow .phasecell { flex: 0 0 5.3rem; min-width: 5.3rem; }
  table.list tr.subrow .modelcell,
  table.list tr.subrow .modelcell > .row { display: contents; }
  table.list tr.subrow .phasefold { cursor: pointer; }
  table.list tr.subrow .phasefold .foldchevron { display: inline-flex;
    transform: rotate(-90deg); transition: transform 0.15s; }
  table.list tr.subrow .phasefold .foldchevron svg { flex-shrink: 0; }
  table.list tr.subrow:has(.foldphase:checked) .phasefold .foldchevron { transform: rotate(0deg); }
  table.list tr.subrow .aimodel { display: none; }
  table.list tr.subrow:has(.foldphase:checked) .aimodel {
    display: flex; gap: var(--sp-2); flex: 1 1 100%; order: 10; }
  /* max-width: none included: the desktop caps (8rem on the AI select,
     100px on the model select) otherwise stop the two halves from
     actually reaching 50% each. */
  table.list tr.subrow:has(.foldphase:checked) .aimodel > * { flex: 1 1 0%; min-width: 0; max-width: none; }

  /* The "Phase | AI Model Select" caption row heads a desktop column
     layout that does not exist at this width; the mock draws no such
     row on mobile at all. */
  table.list tr.subrow[data-caption="1"] { display: none; }

  /* And the width the cell reserves on a desktop is given back.
     Reserving it here would put a floor into a 23rem screen and the
     table would scroll — the one thing spec 155 exists to prevent, and
     a full-width block honours a min-width exactly as a table cell
     does. It is not needed at this width: the controls have wrapped, so
     there is no second column inside the cell to line a caption up
     with, and a column that closes when its control is absent is
     better than a scrollbar. */
  /* max-width: none on the model select too, or the 50/50 split above
     never happens: this selector (attribute + element type) outweighs
     the .aimodel > * rule, so the desktop 100px cap kept winning there
     while the AI select — reset below at its own matching specificity —
     grew freely. 90/10, not 50/50, until both caps fall together. */
  table.list tr.subrow .modelcell > .row select[name^="model."] { min-width: 0; max-width: none; }
  table.list tr.subrow .modelcell > .row > [data-cap],
  table.list tr.subrow .modelcell > .row select[data-ai] { min-width: 0; max-width: none; }

  /* Two fields side by side become two lines. */
  .newspecform .frow { flex-wrap: wrap; }
}
`;
