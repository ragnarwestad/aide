---
paths:
  - "src/render/**"
  - "src/specs-client/**"
---

# The dashboard's design rules

Five things a change under `src/render/` has to keep. No test reads the
markup or the stylesheet for most of them (`core/rules/testing.md`, "No
layout tests"), so they hold only as long as each change keeps them.
`docs/design-system.md` says why, and holds the full component list and
the class vocabulary.

## A new piece of the page is built from the components

Before adding or changing anything the page shows — a button, a fold, a
form, a badge, a line of text — inspect the surrounding interface and the
nearest existing control with the same role. Before writing code, name
that control and its source as the reference for the change. A request
for a control beside an existing one means following that control's
layout, appearance and interaction, including what opens and how it
closes. A different solution needs a concrete reason agreed with the user
before implementation.

Read "Components" and "What a button's variant means" in
`docs/design-system.md`. Reuse the reference's component and behaviour;
using any shared component is not enough. If the matching controls have
no shared component, extract their common presentation and interaction
rather than adding another independent implementation. Where no existing
pattern fits, make a component in `src/render/ui/components/` first and
add it to the component list. Markup written by hand beside a component
drifts from it: another arrow, another spacing, another word.
`test/guards/one-button-one-link-one-line.test.ts` and
`test/guards/six-shapes-one-component-each.test.ts` catch the shapes they
know.

Before reporting the change as finished, compare it with the named
reference in the browser, in the surrounding page, at desktop and phone
widths. Check its appearance and its opening, closing and keyboard
behaviour. Passing functional tests does not replace this comparison.
If browser verification is unavailable, report the missing check and do
not claim visual verification. A review of an interface change must read
this rule, inspect the same reference and check the implementation's
visual verification; it must not approve design consistency from green
tests alone.

## Colours, sizes and lengths come from tokens

No colour literal outside the token block in `src/render/ui/css/tokens.css`,
no `font-size` outside it that is not a step on the scale, no raw length
inside a `font` shorthand. The four colour-scheme token blocks are `:root`, the dark
media query, `[data-theme="dark"]` and `[data-theme="light"]`. One token block per theme sets the light and dark
colour pairs selected by those four blocks.

## A render file does not invent a class name

The class vocabulary is a list. A name on it must be written out by a
render or `specs-client` file AND have a CSS rule, be a script hook, or be
a state value — a name that is only one of the two fails. A stylesheet
rule that selects only classes nothing emits fails too.

## Spacing lives in the container, not the component

A component that brings its own margin decides the spacing of every layout
it is put in, and the next layout cannot take it back. The listed
component classes declare no margin of their own; an exception says why
in its own CSS.

## A `<select>` is drawn by us, not by the platform

`appearance` is reset, and that drags three things behind it: a chevron we
draw (a token, and a different arrow per theme), one `:focus-visible` rule
in the accent colour, and a disabled look. Each reads as optional polish
and is not — drop one and the control goes back to being the operating
system's.
