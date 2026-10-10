# How it looks

## Table of contents

- [Tokens](#tokens)
- [Components](#components)
- [The wiki graph](#the-wiki-graph)
- [The class vocabulary](#the-class-vocabulary)
- [Spacing lives in the container, not the component](#spacing-lives-in-the-container-not-the-component)
- [One busy flag, not a per-step lookup](#one-busy-flag-not-a-per-step-lookup)
- [A structural marker with no CSS rule uses data-*, not a class](#a-structural-marker-with-no-css-rule-uses-data--not-a-class)
- [The length count under a bounded text field](#the-length-count-under-a-bounded-text-field)
- [`form="<id>"` only wires submission, not event bubbling](#formid-only-wires-submission-not-event-bubbling)
- [What a button's variant means](#what-a-buttons-variant-means)
- [Theme choice](#theme-choice)
- [Language choice](#language-choice)
- [Header and tab bar, not a sidebar](#header-and-tab-bar-not-a-sidebar)

---

The design system the pages are built from: tokens, components, the class vocabulary,
and the layout rules that keep them consistent.


One design foundation, and nothing outside it: every colour, type size, space and radius is declared once and reached
through a variable, and a control has one class wherever it appears — never a version per form it sits in.

## Tokens

The stylesheet is the seventeen `.css` files `src/render/ui/css/index.ts` lists in `SECTIONS`, read and joined in
that order into the one string inlined into every page. `tokens.css` declares every colour, type size, space and radius ONCE, as CSS
custom properties, between the `tokens:start` and `tokens:end` sentinels. There are four such blocks:

- `:root`.
- `@media (prefers-color-scheme: dark)` — the same ramp read from the other end.
- `:root[data-theme="dark"]`.
- `:root[data-theme="light"]`.

Every rule in the other sixteen files uses `var(--…)`; none of them may contain a literal. The full set — and the type and space scales a font size or a gap has to come
from — is `tokens.css` itself; the names below are the ones a reader of the palette needs first.

The palette is warm neutrals with zinc ink:

- `--bg` — paper.
- `--surface` — card.
- `--surface-2` — a second surface, for a hover or a table heading.
- `--text` — ink.
- `--accent` — vermilion, which marks action and activity and otherwise only the wordmark's own letter and the
  current tab's underline.
- `--link` — a link is ink too, so a page of spec titles never reads as a page of failures.
- `--ok`, `--warn` and `--danger` — the states, with three tones each: the token, a `-soft` for a badge and a
  `-ground` for a message box. Dark mode has its own, calmer copy of every one rather than an inverted one.

"Running" and "refused" never rest on hue alone: a refused row also carries a `.rowmsg.failed` with its own mark beside
the reason. The idle badge is the one badge with a visible edge, since it has no ground of its own. Corners are:

- `--r` — a card, a message.
- `--r-s` — a badge, a field, a button.

A row, job-page or project-page message is one of three kinds. The code that knows what happened picks the kind and
passes it in; nothing passes a colour or an icon:

- `info` — "what does the reader have to do?" — nothing.
- `waiting` — something waits on a user or on time; nothing is broken.
- `failed` — a step, a landing or a request failed and a user has to act.

`rowMessage()` and `rowMessageParts()` turn a kind into a colour and an icon — never at the call site.

## Components

`src/render/ui/components/` builds the markup for every one of these but `.iconlink`, which is a class a caller puts
on its own link; its `index.ts` exports them all. No page writes a button or a link with `.btn`, or a message line, by
hand — `test/guards/one-button-one-link-one-line.test.ts` fails when one does — nor a fold arrow, a tab strip, a table
of facts, a form holding one button or a checkbox with its words beside it, which
`test/guards/five-shapes-one-component-each.test.ts` checks:

| Component             | Variants                                                                                                                              |
|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| `btn()`               | bare (secondary), `primary`, `ok`, `danger`, `busy`, disabled, `small`; `form`, `value`, `data-*` and `aria-label` when asked         |
| `btnLink()`           | a link that looks like a button: every `btn()` variant but `busy`, and `small`; never disabled — that is a disabled `btn()`           |
| `buttonForm()`        | a form whose only control is one button — a `btn()` or a dialog's close cross: a post or its close, hooks, hidden fields, a (?) first |
| `foldArrow()`         | open or shut, swapping rows in place or, with `goto`, loading a page; its title one of five catalogue sentences                       |
| `foldDisclosure()`    | a fold inside a row that opens and shuts in the browser itself, with no request; a summary line and a body, `data-*` when asked       |
| `tabBar()`            | in `ui/tabs.ts`: every tab strip, the header's row included; a base path or a link per tab, catalogue words, `aria-current="page"`    |
| `facts()`             | a table of label and value, one row each; a value can be a figure                                                                     |
| `labelledCheckbox()`  | a box and its words in one label, or disabled with a help popover after the words; never the acceptance row's 18px `.checkbox`        |
| `labelledRadio()`     | a radio button and its words in one label, the words a link when given one; checked, disabled, and `form=`                            |
| `switchControl()`     | on or off, its position and the word beside it drawn from `aria-checked`; moved by `setSwitch()`; disabled                            |
| `.iconlink`           | a link or control that is its icon alone, no button frame — the spec page's PDF link, whose `.icon-pdf` is `--pdf` red in every theme |
| `badge()`             | `b-idle`, `b-running`, `b-waiting`, `b-ready`, `b-refused`, `b-done`; the state word and its icon                                     |
| `phaseChip()`         | `default`, `checked`, `done`, `off` (with the reason in `title`)                                                                      |
| `phases()`            | a group of chips in one wrapper, so the row carries no spacing rule of its own                                                        |
| `pips()`              | one pip per phase, its first letter above it, the full name in `title`                                                                |
| `rowMessage()`        | `info`, `waiting`, `failed`                                                                                                           |
| `rowMessageParts()`   | the same three kinds built from parts rather than one string; every link in one opens in a new tab                                    |
| `messageSlot()`       | a message the page's script writes into: its icon, announced, and always drawn empty — with no words it takes no room                 |
| `field()`             | label above any control, one height and one radius                                                                                    |
| `saveCancelActions()` | a form's Save and Cancel pair; Save submits the form, Cancel renders disabled because it needs script                                 |
| `confirmDialog()`     | a confirmation that runs no step: the question, OK first and Cancel beside it (the platform's own close)                              |
| `progressDialog()`    | the dialog every running step stands in: its running word, its step list, a refusal line, and first the question of a step that asks  |
| `askButton()`         | the button that names a dialog by `data-ask`; one listener on `body` opens any of them                                                |
| `helpPopover()`       | a `details.intro` disclosure holding developer-authored help text                                                                     |
| `backLink()`          | the link back out of a page, with the page's title beside it rather than below; `keep` on a page with tabs keeps it across tabs       |

A badge says the state and nothing else: no reason, no count. Its icon comes from the word itself
(`stateIconName()`, `components/state-icon.ts`) — a tick for Done, a clock for Queued, a spinner for anything running —
and is drawn by the stylesheet from `data-icon`, so a caller never picks one. At a phone's width the badge is the word
alone, since the state column there is sized for the word.

`STEP_LABELS` is re-exported from there and lives in `src/format/step-label.ts` — a step's technical name mapped to
the word a reader sees, with a sibling table per language (`STEP_LABELS_NB` and three more), while `data-phase`, the
checkbox `value`, the queue step and the skill all keep the technical name regardless.

The brand is `src/render/ui/brand.ts` — the mark, the wordmark and the favicons, all inline SVG and data URIs.

## The wiki graph

Above the Wiki tab's page list, one named point per page and one line per linked pair
(`src/render/pages/projects-page/wiki-graph.ts`, `wiki-graph.css`): `.wikigraph` is the box, sized to the tab's own
width and at most 70% of the viewport tall so the page can always be scrolled from above or below it; `.wikiedge` is
a line between two linked points; `.wikinode` is one page's own point and name, a real link to the address the page
list already opens it at. The server draws a first, settled layout at 720×480 (`src/wiki-graph/layout.ts`); with
script it is measured and settled again at the box's real size, and script adds drag, pan, wheel and pinch zoom over
pointer events (`src/specs-client/wiki-graph/`) — none of it is a new dependency, and with script off or failed the
first layout is what stays drawn. A project with no wiki page besides its own index draws no graph at all.

## The class vocabulary

Four rules hold for every stylesheet and render file. No test reads the markup or the stylesheet for them — the
testing rule leaves layout out of the suites — so each change keeps them itself:

- **Tokens.** No colour literal and no off-scale font size anywhere in the stylesheet outside the token blocks, and
  the report frame's and the loading page's own CSS are held to the same rule.
- **A closed class vocabulary.** A CSS class a render file or a `specs-client` file emits is one of the components,
  one of the two dozen named `specs-client` selector hooks (`rowrun`, `actionform`, `refused` and the rest), or one
  of the short list of structural names written out in full, such as `pageform`: the look every page-sized form
  shares, so no form borrows another's hook for it. A name on those lists is emitted by some render or
  `specs-client` file, and has a rule that selects it unless it is a script hook, which a script or a browser test
  selects by class, or one of the state values `default`, `todo` and `notverified`, each one value of a family whose
  other values carry the rules. No stylesheet rule selects only classes nothing emits. A marker that only names a
  role is a `data-*` attribute, not a class.
- **Layout.** Spacing lives in the container (see
  [Spacing lives in the container, not the component](#spacing-lives-in-the-container-not-the-component)).
- **The select control.** A `<select>` is drawn by us: `appearance` reset, our own chevron per theme, one
  `:focus-visible` rule in the accent colour, and a disabled look.

So a spec that wants a look it cannot build from the tokens has to change the TOKENS — visibly, in `tokens.css` — rather
than add a colour beside them.

Whether something fits is measured in a browser, by `test/e2e/`, and only where the behaviour exists only in a
browser — never by reading the stylesheet as text. A rule can be present and still be wrong: `flex: 0 0 100%` beside
a left margin hangs past the row's right edge, because a whole width plus a margin is wider than the row.

A CSS comment's prose reaches the browser as page content: the stylesheet is inlined into every page, so a comment
is read by whoever views source, not just by the next editor. It is also why a test looking for an English word in a
response can be failed by a comment that happens to hold it — `test/queue-detail/queue-detail-spec-page-routes.test.ts`
writes distinctive sentinels rather than English words for exactly that reason.


## Spacing lives in the container, not the component

A gap between two interactive controls comes from the flex `gap` on the row that holds them, never from a `margin` on
one of the components: a component carrying its own margin looks right beside one sibling and wrong, or doubled,
beside the next.

One control is an exception, and its CSS says so: the specs list's state filter, `.menu.state`, carries
`margin-left: var(--sp-3)` on a desktop screen — more room from the "(?)" beside it than the row's gap gives, because
the two are easy to mis-click together — and `narrow.css` sets it back to 0 at phone width. A `margin-left: auto`
that pushes a control to the row's far end, as the New spec button's does, is not a gap between two controls, and
the rule does not cover it. `.actionform` declares no `margin`.

## One busy flag, not a per-step lookup

A spec's queue row reads its "is anything in flight" state from a single predicate, `specBusy()` in
`specs-list/row-state.ts`,
rather than each control re-deriving it from the in-flight job's own `steps` list. A control that derives it itself can
show a step as tickable, and Run as clickable, while a job is already running on the spec — the queue refuses the
request, and the row has promised something it cannot keep. Every control that can act on a busy row — the phase boxes,
the Run and Cancel buttons, and the AI and model pickers — reads the same flag, so a new control cannot forget to
check it.

One narrowing, and only one: the boxes for phases a RUNNING job has not reached yet stay live, so a reader who knows
more at minute ten than at minute zero can add a phase to the run or drop one it has not started. Which those are
is not re-derived by the row — the server puts them on it (`editableSteps`, from `tailEdits()` in `queue/steps.ts`, the same
function the edit route refuses against), so a box is never drawn live for an edit the store would say no to. Otherwise
the row is locked as before:

- The running step and every step behind it — stay locked.
- A job merely `queued` between two steps — locks the whole row.
- A live box — posts to `POST /api/queue/<id>/steps` on the tick itself rather than to the Run form, which while busy
  would be asking for a second job.

A live box is the one `phaseChip` that does nothing with script off —
it belongs to no form — and that is a known limitation, not an oversight.

## A structural marker with no CSS rule uses data-*, not a class

Render files keep to a closed class vocabulary (see [The class vocabulary](#the-class-vocabulary)). A render
change that needs to mark up a structural role — nothing to style, just something a test or a future render pass needs
to find — should not grow that vocabulary for a class that carries no CSS rule. The per-phase caption row
(`Phase` / `Model` above the phase lines' pickers) is marked `data-caption="1"` for exactly this reason. It has since
grown rules of its own — two dozen of them, in the specs list's stylesheets and `narrow.css` — and stays a `data-*` regardless: the
vocabulary covers the classes a render file emits, so CSS may select on an attribute freely. A marker that gains
styling later is not a reason to convert it into a class.

## The length count under a bounded text field

Every text input and textarea that carries `maxlength`, and any that carries `data-maxlength` (a bound the server holds
but the browser is not to apply, such as the Close reason), gets two spans from `specs-client/limits` after it:

- `data-limit="ok|near"` — the count, marked `near` from 90% of the bound.
- `data-limit-note` — a `role="status"` line that names how many characters a paste or a drop lost, and is empty
  otherwise.

The server draws neither, so a page with
script off is unchanged. A bounded field added later is covered by the selector alone only if it is a `textarea` or an
`input type="text"`: the selector names that one type, so a bounded `search`, `email`, `url` or `number` field would
get no count until the selector is widened.

The spans are drawn twice: once at load, over the whole document, and again over each row the specs list swaps in on
its five-second refresh (`drawLimits`, called from `row-swap.ts`). A field already carrying them is left alone, so the
second pass costs nothing — and without it a bounded field inside a swapped row would lose its count the first time
the row was redrawn.

## `form="<id>"` only wires submission, not event bubbling

A control outside a `<form>`'s literal DOM tree can still submit with it via `form="settings-form"`,
but that attribute governs submission alone — `input`/`change` events from that control never bubble
to the form element, so a listener attached to the form (a dirty-tracking latch, an AI-picker sync)
never sees them. Moving a field between "outside the form, wired by `form=`" and "a literal descendant"
changes which of these two mechanisms applies, and the two are easy to conflate when only submission was
checked. On the settings page, closing `</form>` early and relying on `form=` to keep the AI settings
table attached would satisfy submission but break the table's own dirty-tracking, since that relies on
literal containment.

Where a field must ride inside the form for event bubbling but must never itself mark the form dirty
(a display-only preference, not a saved field), exclude it from the shared listener with a
`closest("[data-*]")` guard rather than moving it back outside the form:

- `unsaved-changes.ts` — the one place that does this, skipping `[data-unit-choice]`.
- `spec-form-actions.ts` — its own `bind()` listens on the form with no guard at all.
- `specs-client/index.ts` — its `closest("select[data-ai]")` is the opposite: it picks a control out
  rather than leaving one alone.

## What a button's variant means

`primary` is the one thing a form wants pressed — Save, Create, Deploy — and every spec row's one action, so the
specs list carries a column of them on purpose. Bare is secondary: every control that is not that one thing, such as
the Cancel beside a Save.

`danger` means one thing only: an action a mistake cannot undo — removing a project, deleting a scheduled job,
leaving a page with its edits unsaved. Every `danger` control is either the OK of a dialog asking the question first,
or the button that opens one, as Delete in the scheduled jobs' list and Remove project do. A job's Cancel is `primary` and not `danger`, because a cancelled run can be started again.

## Theme choice

The header carries a Dark/Light/Auto control, stored in the browser (`localStorage`), not on the server. An explicit pick sets
`data-theme` on `<html>`; two extra token blocks in `tokens.css`,
`:root[data-theme="dark"]` and `:root[data-theme="light"]`, override the `@media (prefers-color-scheme: dark)` block by
attribute-selector specificity (0-2-0 beats 0-1-0) regardless of source order. Auto needs no rule at all — no attribute
set falls straight through to the existing OS-driven CSS.

Applying the stored choice before first paint (no flash) needs a script that runs before body content, on every page, so `src/render/ui/shell.ts`'s
`pageShell()` emits exactly one `<script>` tag in `<head>`, unconditional and shared. `theme-script.ts` is what it
exists for, but the tag carries eleven transpiled files in all — the unit setting, the "…" menu's close-on-outside-click,
the service worker registration and the rest — each its own IIFE, concatenated into the one tag rather than one tag per
file. Every file in it is transpiled raw by `Bun.Transpiler`, so none of them
may `import` or `export`; `specs-client/index.ts` may, because it is bundled by `Bun.build({ format: "iife" })`
instead. Both are tested the same way: transpile the file and run it against a fake DOM.

This is a separate mechanism from `opts.script`, which goes at the end of the body and is passed by whichever pages
need it. A served page carries two `<script>` tags where its route passes one, so a test that locates "the" script by
first occurrence will silently grab the wrong one; find each by a substring unique to its content.

A scheduled run's report is shown in an `<iframe sandbox srcdoc>`, which is its own document. Its stylesheet is
`css/report-frame.css` — element rules, tokens only, held to the same rule — placed in the framed document after
`tokens.css`. It is not one of the page's `SECTIONS`. `specs-client/report-frame.ts` copies the page's `data-theme`
into the frame's `<html>` (and removes it when the page has none, the Auto choice) and sizes the frame to its content.
Without script the frame keeps a fixed height and follows the operating system's dark/light setting.

## Language choice

The header carries a language control beside the theme one, offering five languages: English, Norwegian,
Spanish, German and French. It draws the same N-way `<details class="menu">` pattern the theme control uses —
one row per choice, a checkmark reserved on every row, `aria-current` on the selected one — rather than the
two-entry "current, then the other" shape a two-language board could get away with.

Each row is labelled with that language's own native name — "English", "Norsk", "Español", "Deutsch",
"Français" — never translated into the reader's currently selected language: Spanish always reads "Español",
whichever of the five languages the reader has chosen. `LANGUAGE_NATIVE_NAMES` in `header-controls.ts` is the
one place these five names live.

`src/i18n/translations.ts` is the one source of truth every N-way language choice reads from:

- `Language` — the union.
- `translations` — the registry (`{ en, nb, es, de, fr }`).
- `LANGUAGES` — the list the header menu and `serve-helpers/http.ts`'s `?lang=`/cookie validation both iterate, so
  neither has to name a language by hand.
Every other file that needs a per-language answer (`provider-limit.ts`'s locale table,
`format/gerund.ts` and `format/step-label.ts`'s verb/name tables) is a `Record<Language, …>` lookup, with an
English fallback for the two of those that are not required to cover every language.

**Adding a sixth language is two separate, catalogue-only changes — not one:**

1. **The UI-string catalogue** (`shell.theme`, `list.search`, and the couple of hundred other keys `en.ts` types):
   add a `<lang>.ts` file shaped `Record<TranslationKey, string>` (the same shape `nb.ts`/`es.ts`/`de.ts`/`fr.ts`
   already are) and register it in `translations.ts`'s `translations` object and `LANGUAGES` list. A key
   missing from the new file fails `tsc`, the same way an incomplete `nb.ts` already does — and the same way a new
   string does: a key added to `en.ts` fails `tsc` until the other four catalogues have it too.
2. **The board-message catalogue** (`src/i18n/messages.ts`'s `MESSAGES`, the runner/landing/tab sentences):
   add the new language's field to the `MessageEntry` interface and then to every one of its entries. This is
   a different shape from step 1 — an interface change plus per-entry content, not a new file — because
   `MESSAGES` types its five language fields directly on one shared interface rather than through a
   `Record<TranslationKey, …>` catalogue file.

**Three tables outside `src/i18n/` need the new language as well**, and `tsc` is what tells you: `LANGUAGE_FLAGS`
and `LANGUAGE_NATIVE_NAMES` in `header-controls.ts`, and `LOCALES` in `job-state/provider-limit.ts`. Each is a full
`Record<Language, string>`, so a language missing from one is a type error rather than a gap that reaches the board.
`format/gerund.ts` and `format/step-label.ts` are `Partial` and fall back to English, so they can be left. Everything
else reads `Language`/`LANGUAGES` generically and needs nothing.

## Header and tab bar, not a sidebar

Every page's `<body>` is `header + nav.tabbar + main`, with the page's own notices and dialogs between the header
and the bar. `shell.ts` builds `pageHeader()` — the wordmark, a line naming the machine and which board it is, the
theme, language and unit controls, and a "…" menu — and `siteTabs()`, which draws Jobs, Specs, Projects and Schedule.
There is no sidebar, and no reserved column standing empty for one. A page that passes `hideTabBar` draws no bar at
all: the spec page, a project's page and Settings.

The board line reads:

- "*machine* - Prod" — on the prod board.
- "*machine* - Test - *spec number*" plus a Stop button — on a test server, with the spec's folder and branch in the
  line's `title`.

`board-info.ts` holds which one this process is, set once at boot
from the CLI flag it was started with (`--test-board`), and read directly by `pageHeader()` rather than
threaded through every page renderer, the same way `lastInstallWarning()` already reads
`AIDE_INSTALL_LOG` directly.

The "…" menu is a `<details>`/`<summary>` disclosure, the same pattern `.intro` uses — not a JS-driven popover.
Closing it on an outside click or on
Escape is its own script, `menu-script.ts`, riding in the head tag with the others.

Every tab strip is `tabBar()` in `tabs.ts`: the header's row (`site`, which leaves out `subtabs`), a page's own tabs,
and a strip nested under one — a step's Log, Changed files and Errors, the Wiki tab's Pages, Graph and Build. A caller
gives it a base path or a function building each tab's address, and its words from the catalogue when it has them; the
open tab is `aria-current="page"` on every strip.

`min-height: 100vh` sits on `body`, so a short page — an empty spec list — still fills the viewport.
