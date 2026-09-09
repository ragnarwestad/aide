# How it looks

The design system the pages are built from: tokens, components, the class vocabulary guard,
and the layout rules that keep them consistent.

## Table of contents

- [Tokens](#tokens)
- [Components](#components)
- [The guard](#the-guard)
- [Spacing lives in the container, not the component](#spacing-lives-in-the-container-not-the-component)
- [One busy flag, not a per-step lookup](#one-busy-flag-not-a-per-step-lookup)
- [A structural marker with no CSS rule uses data-*, not a class](#a-structural-marker-with-no-css-rule-uses-data--not-a-class)
- [`form="<id>"` only wires submission, not event bubbling](#formid-only-wires-submission-not-event-bubbling)
- [Theme choice](#theme-choice)
- [Header and tab bar, not a sidebar](#header-and-tab-bar-not-a-sidebar)

---

One design foundation, and nothing outside it: every colour, type size, space and radius is declared once and reached
through a variable, and a control has one class wherever it appears — never a version per form it sits in.

## Tokens

`src/render/ui/css.ts` declares every colour, type size, space and radius ONCE, as CSS custom properties, between the
`tokens:start` and
`tokens:end` sentinels — and again inside
`@media (prefers-color-scheme: dark)`, where the same ramp is read from the other end. Every rule below the block uses
`var(--…)`; nothing else in the file may contain a literal.

The palette is the brand's: warm neutrals (paper `--bg`, card
`--surface`, ink `--text`), vermilion `--accent`, and `--danger` set to the darkest bar of the mark rather than to a
shade of the accent — so
"running" and "refused" never rest on hue alone. The refused badge is also the only live one with a visible border, and
the row that carries it carries a `.rowmsg.failed` with its own mark beside the reason.

A row, job-page or project-page message is one of three kinds, decided by the producer and never by `rowMessage()`'s
caller reading a colour off a hunch: `info` ("what does the reader have to do?" — nothing), `waiting` (something waits
on a person or on time; nothing is broken), and `failed` (a step, a landing or a request failed and a person has to
act). `rowMessage()` alone turns a kind into a colour and an icon — never at the call site.

## Components

`src/render/ui/components.ts` is the one place markup for them is built:

| Component       | Variants                                                               |
|-----------------|------------------------------------------------------------------------|
| `btn()`         | bare (secondary), `primary`, `ok`, `danger`, `busy`, disabled, `small` |
| `.iconlink`     | a link or control that is its icon alone, no button frame — the spec page's PDF link, whose `.icon-pdf` is `--pdf` red in every theme |
| `badge()`       | `b-idle`, `b-running`, `b-waiting`, `b-ready`, `b-refused`, `b-done`   |
| `phaseChip()`   | `default`, `checked`, `done`, `off` (with the reason in `title`)       |
| `rowMessage()`  | `info`, `waiting`, `failed`                                            |
| `field()`       | label above any control, one height and one radius                     |
| `filterPills()` | "Label · count", the chosen one marked with `aria-current`             |

`STEP_LABELS` lives there too — a step's technical name mapped to a friendlier one shown to a reader, while
`data-phase`, the checkbox
`value`, the queue step and the skill all keep the technical name regardless. It is empty today — no step's technical name needs a friendlier one.

The brand is `src/render/ui/brand.ts` — the mark, the wordmark and the favicons, all inline SVG and data URIs, because the
generated site is published as plain files and has to work opened from a folder.

## The guard

`test/design/css-guard-tokens.test.ts` fails the suite on a colour literal or an off-scale font size anywhere in `css.ts`
outside the token block, and on any CSS class a render file emits that is not one of the components, one of the named
`queue-client.ts` selector hooks (`rowrun`, `actionform`, `mergeform`, `refused`,
`refusal`, `newspec`, `newspecform`) or one of the short list of structural names it writes out in full.

So a spec that wants a look it cannot build from the tokens has to change the TOKENS — visibly, in one block — rather
than add a colour beside them.

`CSS` in `css.ts` is a template literal, so a backtick inside a comment closes it and the file stops parsing —
`bunx tsc --noEmit` catches this,
`bun test` alone does not. A comment's prose also reaches the browser as page content, re-read on every
request, so it is read by whoever views source, not just by the next editor (`queue-detail.test.ts`
proves the re-read by writing a marker word to a comment and asserting a second response does not contain it).

`mergeoverride` in that allow-list and in `queue-client.ts`'s `ACTIONS`
selector is dead in production: no render path emits it any more. It stays deliberately — generic pending/disable
plumbing shared by four form classes, not worth touching `queue-client.ts` and its
tests under `test/queue-client/` to remove for a class nothing else needs.

## Spacing lives in the container, not the component

A gap between two interactive controls comes from the flex `gap` on the row that holds them, never from a `margin` on
one of the components: a component carrying its own margin looks right beside one sibling and wrong, or doubled,
beside the next.
`test/design/css-guard-class-vocabulary.test.ts` asserts that `.mergeform`,
`.actionform` and `.extra` declare no
`margin`, alongside the check that `tr[data-controls] .row`
still has a scoped, non-`center` `align-items` — a row that mixes a labelled field with plain buttons needs its own
baseline, not `.row`'s default, and the override must stay scoped to that one row's
`data-controls` attribute rather than changing what `.row` means everywhere else (the filter bar uses `.row` too).

## One busy flag, not a per-step lookup

A spec's queue row reads its "is anything in flight" state from a single predicate, `specBusy()` in `queue-list.ts`,
rather than each control re-deriving it from the in-flight job's own `steps` list. A control that derives it itself can
show a step as tickable, and Run as clickable, while a job is already running on the spec — the queue refuses the
request, and the row has promised something it cannot keep. Every control that can act on a busy row — the phase boxes,
the Run button, and the model and "also touches" fields — reads the same flag, so a new control cannot forget to check
it.

One narrowing, and only one: the boxes for phases a RUNNING job has not reached yet stay live, so a reader who knows
more at minute ten than at minute zero can add a phase to the run or drop one it has not started. Which those are
is not re-derived by the row — the server puts them on it (`editableSteps`, from `tailEdits()` in `queue.ts`, the same
function the edit route refuses against), so a box is never drawn live for an edit the store would say no to. Otherwise
the row is locked as before: the running step and every step behind it stay locked, a job merely `queued` between two steps locks
the whole row, and a live box posts to `POST /api/queue/<id>/steps` on the tick itself rather than to the Run form,
which while busy would be asking for a second job. A live box is the one `phaseChip` that does nothing with script off —
it belongs to no form — and that is a known limitation, not an oversight.

## A structural marker with no CSS rule uses data-*, not a class

`test/design/css-guard-class-vocabulary.test.ts` holds render files to a closed class vocabulary (see [The guard](#the-guard)). A render
change that needs to mark up a structural role — nothing to style, just something a test or a future render pass needs
to find — should not grow that vocabulary for a class that carries no CSS rule. The per-phase caption row
(`Phase` / `Model` above the phase lines' pickers) is marked
`data-caption="1"` for exactly this reason: every entry in the guard's allow-list is meant to declare tokens, and this
one would declare nothing.

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
`closest("[data-*]")` guard rather than moving it back outside the form — `spec-form-actions.ts`'s
`bind()` and `queue-client.ts`'s AI-picker sync both do this already.

## Theme choice

The nav carries a Dark/Light/Auto control, stored in the browser (`localStorage`), not on the server — the generated
pages are files with no server in front of them when opened from a folder, so nothing server-computed could carry the
choice. An explicit pick sets
`data-theme` on `<html>`; two extra token blocks in `css.ts`,
`:root[data-theme="dark"]` and `:root[data-theme="light"]`, override the `@media (prefers-color-scheme: dark)` block by
attribute-selector specificity (0-2-0 beats 0-1-0) regardless of source order. Auto needs no rule at all — no attribute
set falls straight through to the existing OS-driven CSS.

**This is the one deliberate exception to "generated pages carry no page code."** Applying the stored choice before
first paint (no flash)
needs a script that runs before body content, on every page — served and generated alike — so `src/render/ui/shell.ts`'s
`pageShell()` emits exactly one shared, unconditional `<script>` in `<head>`:
`src/render/scripts/theme-script.ts`, inlined the same way `serve.ts` inlines
`queue-client.ts` for the served `/` page, and tested the same way (transpile the file and run it against a fake DOM —
`theme-script.ts`
cannot `import`/`export`, for the same reason `queue-client.ts` can't). This is a separate mechanism from `opts.script`
(end-of-body, served-`/`-only) — a page carries two `<script>` tags, so a test that locates "the"
script by first occurrence will silently grab the wrong one; find each by a substring unique to its content.

## Header and tab bar, not a sidebar

Every page's `<body>` is `header + nav.tabs + main`. `shell.ts` builds `pageHeader()`
(the wordmark, a line naming the machine and which board it is, then a "..." menu) and `tabBar()`
(Specs/Projects); there is no sidebar, and no reserved column standing empty for one.

The board line reads "*machine* - Prod" on the prod board, and "*machine* - Test - *spec* : *branch*"
plus a Stop button on a test server — `board-info.ts` holds which one this process is, set once at boot
from the CLI flag it was started with (`--test-board`), and read directly by `pageHeader()` rather than
threaded through every page renderer, the same way `lastInstallWarning()` already reads
`AIDE_INSTALL_LOG` directly.

The "..." menu is a `<details>`/`<summary>` disclosure, the same pattern
`.more`, `.newspec` and `.intro` use — not a JS-driven popover. That keeps `queue-routes.test.ts`'s "no page
script beyond the theme switcher" guarantee true by construction and keeps the menu working with JavaScript off, like
every other control on the site. The tab bar reuses
`filterPills()` in its `"page"` mode (the same call the job detail page already made for its own tabs), which is why
`filterPills()` omits the `<span class="lbl">` wrapper when its `label` argument is `""` — a page-level tab bar
needs no group caption, and an empty wrapper is worse than none.

`min-height: 100vh` sits on `body`, so a short page — an empty spec list — still fills the viewport.
