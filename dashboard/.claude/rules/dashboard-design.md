---
paths:
  - "src/render/**"
  - "src/specs-client/**"
---

# The dashboard's design rules

Four things a change under `src/render/` has to keep. Each one is checked
by a guard in `test/design/css-guard/`, so breaking it is a red suite
rather than a review comment. `docs/design-system.md` says why, and holds
the full component list and the class vocabulary.

## Colours, sizes and lengths come from tokens

No colour literal outside the token block in `src/render/ui/css/tokens.css`,
no `font-size` outside it that is not a step on the scale, no raw length
inside a `font` shorthand. The four token blocks are `:root`, the dark
media query, `[data-theme="dark"]` and `[data-theme="light"]`, and the two
explicit themes are the media query's ramp colour for colour.

Guard: `css-guard-tokens.test.ts`.

## A render file does not invent a class name

The class vocabulary is a list. A name on it must be written out by a
render or `specs-client` file AND have a CSS rule, be a script hook, or be
a state value — a name that is only one of the two fails. A stylesheet
rule that selects only classes nothing emits fails too.

Guard: `css-guard-class-vocabulary.test.ts`.

## Spacing lives in the container, not the component

A component that brings its own margin decides the spacing of every layout
it is put in, and the next layout cannot take it back. The listed
component classes declare no margin of their own; the handful of
exceptions are named in the guard, with the reason.

Guard: `css-guard-layout.test.ts`.

## A `<select>` is drawn by us, not by the platform

`appearance` is reset, and that drags three things behind it: a chevron we
draw (a token, and a different arrow per theme), one `:focus-visible` rule
in the accent colour, and a disabled look. Each reads as optional polish
and is not — drop one and the control goes back to being the operating
system's.

Guard: `css-guard-select.test.ts`.
