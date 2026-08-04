# Branding and design system

The visual and verbal system for the Local Operator desktop app, and the rules
that keep it consistent as it changes.

This is the app-side companion to the design kit that owns the marketing site
(`docs/design-kit/` in the `local-operator-site` repo). Where the two disagree
about the brand, the kit wins; where they disagree about *how a desktop app
should behave*, this file wins, because a tool read for hours at arm's length is
not a page read once.

**Read this before changing any visual surface.** The parts of this system that
are enforceable are enforced by `pnpm check-themes`; the rest is here because a
rule nobody wrote down gets re-litigated every quarter and re-broken every
release.

---

## 0. The one sentence

> The audience has used a chat assistant. They have not used a build tool.

Every rule below follows from that. The app runs agents that write and execute
code on your own machine — genuinely technical machinery — for people who
describe their problem in a sentence. The interface's job is to make the
machinery *legible* without making it the subject.

The failure mode this system exists to prevent is an app that looks like a
terminal wearing a GUI: dense chrome, monospace everywhere, every internal step
of the agent's reasoning shown at equal weight to the answer.

---

## 1. Architecture: where colour comes from

One source, two consumers. Do not add a third.

```mermaid
graph LR
  A["palettes/*.ts<br/>ThemePalette x12"] --> B["createBaseTheme()<br/>MUI, hex values"]
  A --> C["generate-theme-css.mjs<br/>--lo-* variables"]
  C --> D["styles/index.css<br/>@theme role utilities"]
  A --> E["contrast-contract.mjs<br/>the floors"]
```

- **`src/renderer/src/shared/themes/palettes/*.ts`** — the single source of
  truth. Twelve `ThemePalette` objects, 29 roles each, every value a literal
  string.
- **MUI** consumes them as hex, because roughly 299 `alpha()` call sites need a
  real colour and cannot take a `var()`. This half shrinks as the port
  continues.
- **Tailwind** consumes generated CSS variables. `pnpm gen-themes` writes
  `styles/themes.generated.css`; never hand-edit it.
- **`pnpm check-themes`** verifies the generated file is current and that every
  palette clears the floors in § 3.

The theme provider sets `document.documentElement.dataset.theme`. That attribute
is what every Tailwind role utility resolves against — without it, the ported
half of the app renders unthemed.

### Why roles rather than colours

Twelve themes are user-selectable, and a "Dracula" theme is a promise to a user.
Overriding community palettes with brand green would break exactly the users who
chose them. So the brand ports as **roles with contrast floors**, not as values:
the two `localOperator*` palettes *are* the brand, and the other ten only have
to satisfy the contract while keeping their own identity.

A component never names a colour. It names a role — `bg-surface`,
`text-ink-muted`, `border-control` — and the theme decides what that is.

---

## 2. Colour

### The four grounds

`canvas` (page) → `surface` (cards, panels, inputs) → `elevated` (menus,
popovers, tooltips, hovered rows), plus `sunken` (wells, tracks, code grounds)
recessed below canvas.

**Elevation is a lightness step, not a shadow.** There is exactly one shadow in
the system and it belongs only to objects that leave the flow: menu, dialog,
drawer, popover, tooltip, select. An in-flow card that needs to feel raised
takes the next ground, not a shadow. This is why the four grounds must be
mutually distinguishable, and why `check-themes` asserts it.

### The four inks

`ink` (primary) → `ink-muted` (secondary) → `ink-dim` (captions, metadata,
placeholders) → `ink-disabled`.

`ink-disabled` is the only role exempt from a contrast floor, because a disabled
control that meets 4.5:1 does not read as disabled.

### The two lines — the distinction people get wrong

- **`hairline`** is decorative: section rules, table separators, list dividers.
  It carries no information and has no floor.
- **`border-control`** is structural: the sole visual boundary of an input,
  select, checkbox, or outlined button. Floor 3:1 on all four grounds.

Most palettes ship one border colour and use it for both jobs. That is how the
old light theme ended up bounding every input in the app at **1.25:1** — the
control's only edge, effectively invisible. If you are adding a boundary, ask
whether removing it entirely would lose information. If yes, it is structural
and must clear 3:1. If no, delete it rather than reaching for `hairline`.

### Accent

One accent, spent about **three times per screen**. Primary action, active
state, focus ring. A second decorative hue is not available.

If a screen needs the accent a fourth time, something on it is not as important
as it thinks.

### Semantic

`success`, `warning`, `danger`, `info`, each a triple of colour, `-wash` (the
faintest tint, for the ground of a callout) and `-border`.

All three parts are authored per theme rather than derived, because deriving
them is what lets MUI's `augmentColor` invent an Alert's appearance — twelve
times, differently. `info` is the accent's own triple in the brand palettes: a
fourth semantic hue is a hue nobody can name.

---

## 3. The floors — enforced

`scripts/contrast-contract.mjs`, run by `pnpm check-themes`. Per palette:

| Assertion | Floor |
|---|---|
| `ink` on each of the four grounds | 7:1 |
| `ink-muted`, `ink-dim` on each of the four grounds | 4.5:1 |
| `accent` and each semantic colour as text on canvas and surface | 4.5:1 |
| `on-accent` on the accent fill | 4.5:1 |
| `border-control` on each of the four grounds | 3:1 |
| Any two grounds, mutually | 1.03:1 (distinguishable) |
| Component triples: ink on its own fill | 4.5:1 |
| Component triples: edge (fill **or** border) against the ground behind | 3:1 |

`ink-disabled` is the only exemption.

**Component triples are the assertion that matters most.** A pair checker passes
a control whose fill is 1.06:1 and whose border is 1.20:1 — each token is
"fine", and the control has no perceivable edge. Adding a component to the app
means adding a row to `CONTROLS` in that script; green output about a component
nobody listed is not evidence about that component.

**Exemptions are pinned, not muted.** An accepted sub-floor pair records its
measured ratio, so moving the token breaks the pin and forces a human to
re-approve it.

What the script cannot see: alpha composites, gradients, text over images, and
any colour a third-party widget (ag-grid, CodeMirror, mermaid) picks for itself.
Those need a human and a screenshot.

---

## 4. Type

| Step | Size | Use |
|---|---|---|
| `text-display` | 28px | The largest text in the app. A page title, not a headline. |
| `text-title` | 20px | Section and dialog titles |
| `text-heading` | 16px | Group headings, card titles |
| `text-body` | 14px | Default body |
| `text-body-sm` | 13px | Dense rows, secondary panels |
| `text-meta` | 12px | Captions, timestamps, counts |
| `text-mono` / `-sm` | 13px / 12px | Machine voice only |

The site's display steps are deliberately absent. A desktop app has no hero, and
a 60px headline in a tool is a marketing device applied to a working surface.

**Monospace is machine voice.** Paths, code, counts, timestamps, trace labels,
identifiers. It is what lets a tool trace read as machine output without needing
a box drawn around it — which is most of how the trace redesign buys its
quietness. Monospace for emphasis, or for prose, is forbidden.

---

## 5. Space, radii, motion

**Space** is a 4px ramp, grouped in three tiers: 4/8 within a component,
12/16/24 between components, 32/48/64 between sections. Consistency of tier
matters more than the specific value — mixed tiers are what make a layout look
unconsidered.

Default to more air and less chrome. When a panel feels busy, the fix is almost
always removing a border or a background, not tightening the spacing.

**A component does not own its outer margin. The container owns the gap.**

A component that ships `mb-4` cannot be composed: it stacks with every parent
that has an opinion, and the failure is silent because the result is still
*some* spacing, just the wrong tier. That is exactly how every settings form in
this app came to sit at 32px between fields — a component's own `mb-4` plus its
container's `gap-4` — which is section-tier spacing on component-tier content.

Margins between a component's own internals are fine; it is the **root element**
that must be free. If every caller genuinely wants the same spacing, that is
still a container concern, not a reason to keep it.

**Radii**: 2 / 6 / 10 / 14 / 16, and nothing else.

**Radius is assigned by what the object is, not by what looks good on it in
isolation.**

- **6px, controls.** Anything you click or type into — button, input, select
  trigger, textarea, tab — plus the small blocks that live at control scale:
  tooltip, badge, skeleton. A 32px-tall control cannot carry more: 10px eats a
  third of its height and reads as a lozenge, and every desktop tool that feels
  precise sits at 4–6.
- **10px, panels and callouts.** Things that sit over or beside content and are
  read as one block: menu, popover, select panel, alert.
- **14px, frames.** Cards and dialogs — the containers other things sit inside.
- **2px** is for bars too small to carry 6: the progress track, the scrollbar
  thumb, the checkbox.
- **16px (`frame`)** is for the two objects that span their whole column: the
  composer and the message bubble.
- **Nested radii are concentric, not repeated:** an inner radius is the outer
  radius minus the padding between them. The tabs track is 10 with 4px padding,
  so its pills are 6.
- `rounded-full` stays reserved for avatars, status dots and pill badges.

**Motion** — durations 80 / 120 / 180 / 240ms. Nothing in this app animates for
longer than 240ms, and only something entering the screen earns that.

- Transition `color`, `background-color`, `border-color`, `opacity`, and
  `transform` only for entrances.
- **Nothing lifts, scales, or translates on hover.** Hover is a colour step.
- Reduced motion is a contract: `styles/index.css` caps every duration at
  0.01ms. It **caps** rather than disabling, because a cancelled animation can
  strand an element on its `from` keyframe — which is how content ends up
  permanently invisible. (That exact defect shipped on the marketing site: 16
  elements with `opacity: 0` that never animated away under reduced motion.)

### Icons

**`lucide-react`, one stroke weight, and the weight is never written down.**

The weight is lucide's own default of 2. The rule is expressed as an absence —
`strokeWidth` does not appear on an icon anywhere in the tree — because a
default costs nothing to keep in sync and a restated value drifts. It already
had: five weights (1.5, 1.75, 2, 2.2 and 3) had accumulated across 18 call
sites while the other ~290 icon renders in the app sat on the default and
looked fine.

Lucide draws on a 24px grid and scales the stroke with the box, so one value
is one pen at different zooms. At the sizes below, a 2 renders as 1.17px,
1.33px, 1.67px and 2px — the range where an icon still outweighs the 1px
`hairline` beside it and roughly matches the stems of the 500-weight label it
weighs against. A 1.5 at 16px renders at exactly 1px, which is what the chat
header's canvas toggle was doing: an icon with the visual weight of a divider.

**Sizes: 14 / 16 / 20 / 24.** These are not free choices. They are the icon
slots `Button` already defines, and an icon inside a control has to agree with
the control.

| Size | Where |
|---|---|
| 14 | `Button` `sm` and `icon-sm`; inline with `body-sm` or `meta` |
| 16 | the default — `Button` `md`, `lg` and `icon`; list rows, nav items |
| 20 | `Button` `icon-lg`; a standalone glyph labelling a settings row |
| 24 | a page header, beside the `display` step |

Above 24 is illustration rather than iconography — the onboarding and
installer moments — and it does not belong in a toolbar or a row. Sizes off
this ramp still exist in the tree (18, 19, 22, 26) and are drift, not
exceptions.

**When a glyph reads thin, change its size, not its stroke.** The checkbox is
the worked example: a 12px tick needed `strokeWidth={3}` to hold its weight,
so it became a 14px tick at the standard weight instead. One pen at four sizes
is a system; two pens is a defect a viewer notices without being able to name
it.

`strokeWidth` on a recharts `<Line>` is chart geometry, not an icon, and is
the one place the prop legitimately appears.

---

## 6. Focus, disabled, and the two rules people break

**Focus ring is `outline`, never `box-shadow`.** An outline honours
`border-radius: inherit` and is not clipped by an ancestor's `overflow: hidden`.
This app is mostly scroll containers, so a box-shadow ring silently disappears
in exactly the places keyboard users need it. `:focus-visible` only — a mouse
user clicking a button should not get a ring.

**Disabled changes colour, never opacity.** An opacity-faded control fades its
own background too, so the same disabled button lands on a different colour over
`surface` than over `sunken`, and neither was designed. MUI applies
`disabledOpacity` in eight components — AccordionSummary, Autocomplete, Chip,
ListItemButton, MenuItem, PaginationItem, Rating, Tab — and all eight are
neutralised in `base-theme.ts`. That list is written out so it can be re-checked
against a future MUI version rather than remembered.

---

## 7. Showing agent work: the trace hierarchy

This is the part of the app most likely to drift back toward a developer tool,
so the intent is written down rather than left to taste.

An agent turn can contain: prose to the user, a question for the user, a tool
call and its output, internal reasoning, and a security notice. Those are **not
equally important**, and the interface must not present them as though they are.

**The hierarchy, most prominent to least:**

1. **A question for the user.** The agent is blocked and waiting. This is the
   only thing on screen that needs a decision, and it must be unmissable —
   its own affordance, not a paragraph that happens to end in a question mark.
2. **The answer.** Prose addressed to the user, at full reading weight.
3. **What the agent did.** One line per action. Quiet, monospace, subdued ink.
   Enough to answer "what is it doing?" at a glance and to audit afterwards.
4. **How it did it** — code, stdout, logs, diffs. Behind a disclosure. Available
   in one click, never shown by default.
5. **Internal reasoning** — the `thinking` field, plus `reflection` and `plan`
   turns. Hidden by default. This is the agent talking to itself, and showing it
   at prose weight is the single biggest reason the app reads as technical.

**Rules that fall out of the hierarchy:**

- A completed action is **one line**. Not a card, not a bordered panel, not a
  header with an icon tile.
- A trace line names the action in the **user's** terms and the object in
  monospace: "Read `invoices/march.csv`", not "Executing Code".
- Prefer one disclosure idiom app-wide. Two competing expand/collapse patterns
  is a bug, not a style choice.
- Never show a spinner and a trace line for the same action; the line's own
  state carries it.
- A security notice is **retrospective** — it records that a risk was reviewed
  and averted. It must not be styled as a prompt, because nothing consumes a
  response to it.

---

## 8. Voice

Full treatment in the kit's `voice.md`. The rules that bite hardest in an app:

- **Say what happens, and on whose machine.** Name the files, the code, the
  computer. Describe events, not capabilities.
- **No jargon noun where an everyday noun works.** "Executing Code" is an
  implementation detail narrated at a reader who wants to know whether the thing
  helped them.
- **Every claim checkable, or cut.** No adjective doing a verb's job.
- **Errors say what happened, what it means, and what to do** — in that order,
  in the user's terms. An error that only quotes an exception is unfinished.
- **No emojis**, anywhere: UI copy, code, comments, commit messages.
- Sentence case for everything — buttons, headings, menu items, labels. Title
  Case is a marketing register and it makes a tool shout.

### Implementation traps

Three defects this system has already produced, each of which looked fine.

**`cn` is not optional.** Route every `className` through `cn` from
`@shared/lib/utils`. It registers our custom scales with `tailwind-merge`,
which otherwise classifies the type steps (`text-body`, `text-meta`, ...) as
*text colours* and puts them in the same conflict group as `text-ink` and
`text-ink-muted`. One of the pair is then dropped **silently**:
`twMerge("text-ink text-body-sm")` returned `"text-body-sm"`. The component
still looks right, because colour inherits from `body` — until it renders on a
ground where the inherited colour is wrong, at which point it looks like a
theme bug in a file nobody edited.

**Tailwind v4 namespaces are not guessable.** `duration-*` utilities generate
from `--transition-duration-*`, not from `--duration-*`. A token in the wrong
namespace compiles to nothing at all — no error, no warning, the utility simply
never appears and the element animates at Tailwind's stock 150ms. If a utility
seems not to apply, check that it exists in the compiled CSS before assuming
the value is wrong.

**MUI wins cascade fights during the migration, and specificity is not the
reason.** Emotion injects its styles *unlayered*, and an unlayered declaration
beats a layered one no matter how specific the layered one is. Tailwind's
utilities and this app's base rules are all layered. So a rule authored in
`@layer base` loses to `MuiButtonBase`'s `outline: 0` even at higher
specificity - and it loses in the most confusing possible way, applying its
`outline-width` and `outline-color` while `outline-style` stays `none`, so the
values are visible in devtools and nothing paints.

A rule that must beat MUI has to be **unlayered** (see the focus ring at the
bottom of `styles/index.css`), or carry `!important`. The `html` prefix is
still needed on top of that, to beat `.MuiButtonBase-root` on specificity once
both are unlayered.

This section previously said the `html` prefix alone was sufficient. It is not,
and that error is why the app shipped for a while with no keyboard focus ring
at all: the rule was correct, layered, and silently inert. Two further lessons
are worth keeping from that one bug. **Verify a global rule in a browser, in
the app** - not in Storybook, which renders a `<CssBaseline/>` the app does not
and therefore had a focus ring the product lacked. And **a verification surface
that differs from the product will eventually certify a defect**; when they
disagree, fix the surface first.

---

## 9. Adding something new

A short checklist, in the order that catches problems earliest.

1. Is there an existing primitive in `shared/components/ui/`? Use it. A second
   button implementation is a defect.
2. Name **roles**, never colours. If you are reaching for a hex, the system is
   missing a role — add it to the contract rather than working around it.
3. Pick radius and spacing from the ramps. Nothing off-ramp.
4. Does it need a boundary at all? If removing it loses no information, remove
   it. If it is the sole boundary of a control, it is `border-control`.
5. Does it need a shadow? Almost certainly not — take the next ground.
6. Check keyboard: focus visible, reachable, and not trapped.
7. Check reduced motion, and check the state the animation is supposed to leave
   things in when it never runs.
8. Run `pnpm check-themes`. If you added a component with its own fill and
   border, add it to `CONTROLS` in the contrast script.
9. Screenshot it in `localOperatorLight` and `localOperatorDark` at minimum. The
   light themes are where contrast defects hide.

### Disclosure

**The chevron swaps, it never rotates.** `ChevronRight` collapsed,
`ChevronDown` expanded, 14px, `text-ink-dim`. Rotation is a transition on a
toggle, and § Motion reserves transitions for entrances.

The canonical implementation is `@shared/components/ui/disclosure`. Import it.

Two places legitimately cannot: `canvas-variables-viewer` and
`chat-settings` both place action buttons as *siblings* of the trigger, and a
button nested in a button is not markup a browser can resolve. Reimplementing
the trigger is allowed there; reinventing the signal is not.

This rule exists because the codebase reached three disclosure idioms, two of
them carrying comments that each declared themselves "the app's one disclosure
idiom" - and they disagreed. The cause was structural: the canonical component
was buried in `features/chat/components/trace/`, so no other feature could
import it even when its author wanted to. A shared idiom has to live in the
shared layer or it is not one.
