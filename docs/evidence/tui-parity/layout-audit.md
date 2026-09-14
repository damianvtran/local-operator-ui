job 91dd2dbbd23c (ui-layout-audit) [completed] model=anthropic/claude-opus-5
I have the full picture. Since my role has no write tool, I'm delivering the report as my final message, formatted as the file body.

## Summary

All three defects share **one root cause**: the chat column at `chat-content.tsx:261` is a flex column whose three children fight over its height. Full report follows — write it verbatim to `~/local-operator-ui/docs/evidence/tui-parity/layout-audit.md` (I could not create it; my scout role has no write/edit/bash tool, flagged to you mid-task).

---

# Chat shell layout audit — three reported defects

Read-only reconnaissance. Every claim carries a `file:line`. Contract references are
`docs/branding.md` (design contract) and `AGENTS.md` § "Design and branding".

## 0. The height chain, as actually written

| # | Element | File:line | Classes |
|---|---|---|---|
| 1 | `body` | `styles/index.css:195` | `background-color: var(--color-canvas)`, no height, no overflow |
| 2 | `#app` | `src/renderer/index.html:15` | **no styles anywhere** (`grep '#app'` across `src/` returns nothing) |
| 3 | App root | `app.tsx:117` | `flex h-screen overflow-hidden` |
| 4 | `<main>` | `app.tsx:144` | `flex grow flex-col overflow-hidden` |
| 5 | ChatLayout root | `chat-layout.tsx:36` | `flex h-full w-full overflow-hidden` |
| 6 | Content slot | `chat-layout.tsx:47` | `h-full grow overflow-hidden` |
| 7 | ChatPage root | `chat-page.tsx:504` | `flex h-full min-h-0 flex-col` |
| 8 | Panel slot | `chat-page.tsx:539` | `min-h-0 flex-1` |
| 9 | SessionPanel root | `chat-page.tsx:284` | `flex h-full min-h-0 flex-col` |
| 10 | ChatContent slot | `chat-page.tsx:386` | `min-h-0 flex-1` |
| 11 | ChatContent row | `chat-content.tsx:257` | `relative flex h-full w-full flex-row` — **no `min-w-0`, no `overflow-hidden`** |
| 12 | Chat column outer | `chat-content.tsx:258` | `relative h-full min-w-[220px] flex-1` — **no `min-w-0`** |
| 13 | **Chat column inner** | `chat-content.tsx:261` | `flex h-full grow flex-col rounded-none bg-surface` — **no `min-h-0`, no `overflow-hidden`** |
| 13a | ChatHeader | `chat-header.tsx:33` | `flex h-21 items-center gap-3 border-hairline border-b px-4` — **no `shrink-0`** |
| 13b | Transcript | `canonical-transcript.tsx:589` | `relative flex h-full w-full grow flex-col-reverse overflow-auto p-4 …` — **`h-full` AND `grow`** |
| 13c | Composer wrapper | `message-input.tsx:817` | `flex w-full shrink-0 grow flex-col items-center justify-center bg-canvas` — **`shrink-0` AND `grow`** |

Row 13 is where all three defects originate.

---

## Defect 1 — "The full view seems to have a scroll on it"

### The honest finding first

**A true document-level scrollbar is not producible by these classes in the packaged
app, and the report is most likely describing a scrollbar in the wrong place rather
than on `window`.** The chain is hard-bounded at `app.tsx:117` by
`h-screen overflow-hidden` (`height: 100vh` cannot grow), `body` carries no height or
overflow rule (`styles/index.css:195-203`), `#app` is unstyled, and `themes.generated.css`
contains no `html`/`body`/height rules at all. Nothing mutates `document.body.style`
except `userSelect` during a divider drag (`resizable-divider.tsx:168,186`).

**What would settle it:** in the running app, read
`document.documentElement.scrollHeight - document.documentElement.clientHeight` and
`getComputedStyle(document.scrollingElement).overflowY`. If that delta is `0`, the
scrollbar the operator saw belongs to a descendant and the fix below is the whole fix.
A rendered frame with the scrollbar visible would identify the owning box directly.

### The real defect: unbounded overflow escaping the chat column

`chat-content.tsx:261` is `flex h-full grow flex-col` with **no `min-h-0`**. Its three
children over-declare their base sizes, so content overflows the column and escapes
upward through `chat-content.tsx:258` and `:257` (neither has `overflow-hidden`) until
it is finally clipped at `chat-layout.tsx:47`. Clipping is not containment: rows are
silently cut off rather than scrolled, and any scrollbar that does appear appears on
the wrong element.

Flex arithmetic at `chat-content.tsx:261`, container height `H`:

- `13a` ChatHeader — `h-21` = **84px** (`--spacing: 0.25rem` at `index.css:118`, 21 × 4px),
  `flex: 0 1 auto` → base 84, **shrink 1** (no `shrink-0`)
- `13b` Transcript — `h-full` makes `flex-basis: auto` resolve to `height: 100%` = **H**,
  plus `grow` → base H, shrink 1
- `13c` Composer — `shrink-0` → base C (content), shrink 0

Sum of bases = `84 + H + C`, which exceeds `H` by `84 + C` for every non-zero composer.
Deficit is distributed across the two shrinkable items weighted by base size:

```
header shrinks by (84 + C) × 84 / (84 + H)
transcript shrinks by (84 + C) × H / (84 + H)
```

At `H = 800`, `C = 120`: the header renders at **~65px, not 84px**. The header's rendered
height therefore **varies with composer content** — attachments, reply previews, wrapped
suggestion chips and multi-line input all resize it. This is also the direct cause of
Defect 3 (below).

`grow` on `13b` is inert (free space is negative). `grow` on `13c` at
`message-input.tsx:817` contradicts its own `shrink-0` on the same line and is dead in
the current state, but becomes harmful the moment `h-full` is removed from the transcript.

The identical `h-full` + `grow` + `overflow-auto` pattern exists on the legacy path at
`messages-view.tsx:214` and `messages-view.tsx:258`; fix both or the legacy backend
regresses.

### Exact fix

```
chat-content.tsx:261
- "flex h-full grow flex-col rounded-none bg-surface"
+ "flex h-full min-h-0 grow flex-col overflow-hidden rounded-none bg-surface"

chat-header.tsx:33
- "flex h-21 items-center gap-3 border-hairline border-b px-4"
+ "flex h-14 shrink-0 items-center gap-3 border-hairline border-b px-4"   (height per Defect 3)

canonical-transcript.tsx:589
- "relative flex h-full w-full grow flex-col-reverse overflow-auto p-4 …"
+ "relative flex min-h-0 w-full grow flex-col-reverse overflow-auto p-4 …"

message-input.tsx:817
- "flex w-full shrink-0 grow flex-col items-center justify-center bg-canvas"
+ "flex w-full shrink-0 flex-col items-center justify-center bg-surface"   (ground per Defect 2)
```

Plus, to stop horizontal overflow escaping when the canvas panel is open
(`chat-content.tsx:376-382` pins `minWidth: effectiveCanvasPanelWidth`, min 400 / default 450):

```
chat-content.tsx:257  add "overflow-hidden"
chat-content.tsx:258  add "min-w-0"       (min-w-[220px] alone leaves min-width:auto ineffective on a flex item)
```

Apply the same `min-h-0` treatment at `messages-view.tsx:214` and `:258`.

Every one of these must be routed through `cn` from `@shared/lib/utils`
(`AGENTS.md:66-70`). Note `chat-content.tsx:257,258,261` currently pass **bare string
literals, not `cn(...)`** — that is itself a contract violation and should be corrected
while editing these lines.

---

## Defect 2 — "Chat view isn't centered; large empty space with the wrong background colour"

Two independent mechanisms. Both are real; which one dominates the screenshot needs a
rendered frame to confirm.

### 2a. The wrong ground — confirmed, unambiguous

The composer wrapper paints **`bg-canvas`**:

```
message-input.tsx:817   "flex w-full shrink-0 grow flex-col items-center justify-center bg-canvas"
```

…directly inside a column that paints **`bg-surface`**:

```
chat-content.tsx:261    "flex h-full grow flex-col rounded-none bg-surface"
```

`canvas` is the *page* ground and `surface` is the *panel* ground
(`branding.md:76-86`). The composer band is therefore recessed to the page ground
inside a panel — the ground step runs backwards. Worse, `body` is already `canvas`
(`index.css:196`), so the band reads as a hole punched through the chat panel to the page
behind it. That is exactly "empty space with the wrong background colour".

The band is large specifically on an empty or new conversation, which is the state a
fresh screenshot captures. At `message-input.tsx:842-848` the empty state renders the
`text-title` greeting, the composer, and the suggestion chip block
(`message-input.tsx:787-810`, twelve wrapping chips at `mt-6`) all *inside* the
`bg-canvas` wrapper — so on a new chat the canvas-coloured region occupies most of the
column height while `bg-surface` survives only as a thin strip under the header.

**Fix:** change `bg-canvas` → `bg-surface` at `message-input.tsx:817`. The composer box
itself already sits on `bg-surface` with a `border-control` edge
(`message-input.tsx:100-101`), and `border-control` is floored at 3:1 on all four grounds
(`branding.md:149`), so the box stays legible without the band. Same change applies to
the legacy `bg-canvas` at `messages-view.tsx:211`.

### 2b. The measure asymmetry — the "pushed left" appearance

The transcript and the composer declare the *same* outer measure but honour *different*
inner ones.

Outer measure, transcript (`canonical-transcript.tsx:597`):
```
mx-auto flex w-full max-w-[900px] flex-col sm:max-w-[90%] md:max-w-[900px]
```
Outer measure, composer (`message-input.tsx:574`) and suggestions (`message-input.tsx:788`):
```
w-full max-w-full sm:max-w-[90%] md:max-w-[900px]
```
Both are `mx-auto`-centred and both are 900px, so the *containers* agree.

The disagreement is inside. Agent rows carry the `lo-measured` class
(`canonical-transcript.tsx:73`, applied at `:146`), and `markdown.css:292-295` caps
prose at:
```css
.lo-measured .lo-markdown > :is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6),
.lo-measured .lo-stream-tail { max-width: 62ch; }
```
62ch at the 14px `text-body` step (`index.css:77`) is roughly **465px**. Agent rows are
additionally indented by `AGENT_GUTTER = "pl-10"` = 40px
(`message-container.tsx:26`, applied at `:52`). So agent prose occupies x≈40→505 of a
900px column, leaving **~395px permanently empty on the right**, while the composer below
spans the full 900px and the user bubbles above are right-aligned at `max-w-[75%]`
(`canonical-transcript.tsx:107`). Three different right edges in one column reads as
"content pushed left with dead space on the right", and the dead space is `bg-surface`
where the band below it is `bg-canvas`.

A second, smaller offset: the transcript is the `overflow-auto` scroller
(`canonical-transcript.tsx:589`) with an 8px scrollbar
(`global-scrollbar-styles.tsx:22`), so its content box is 8px narrower than the
composer's. Its `mx-auto` centre therefore sits **4px left** of the composer's centre.
Small, but it is a genuine, permanent misalignment between the two elements the eye
most wants aligned.

**Note for the designer, not a bug to fix blind:** the 62ch cap is deliberate and
correct for readability. The defect is that nothing else in the column shares it. The
decision to make is whether the composer adopts the 62ch measure, or the agent rows
adopt a wider one — not whether to delete the cap.

**Breakpoint caveat for the implementer:** `sm:` (640px) and `md:` (768px) are
**viewport** breakpoints, but the chat column is viewport minus the nav rail
(`sidebar-navigation.tsx:236-237`), minus the 240–360px chat sidebar
(`chat-layout.tsx:27-29`), minus the 400–1200px canvas when open
(`chat-content.tsx:371`). The column can easily be 500px wide while `md:` is active. If
the measure is respecified, use container queries (`@container`, already used at
`wysiwyg-markdown-editor.tsx:1701`) rather than viewport breakpoints.

---

## Defect 3 — "The chat header style really needs to improve"

Source: `chat-header.tsx:30-66`.

### Current metrics

| Property | Value | File:line | Against the contract |
|---|---|---|---|
| Declared height | `h-21` = **84px** | `chat-header.tsx:33` | On the 4px ramp but far above every peer bar |
| **Rendered height** | **~65px and variable** | derived, § Defect 1 | Missing `shrink-0`; height moves with composer content |
| Horizontal padding | `px-4` = 16px | `chat-header.tsx:33` | Component tier, consistent |
| Vertical padding | none (pure `items-center`) | `chat-header.tsx:33` | Height is asserted, not derived from content |
| Gap | `gap-3` = 12px | `chat-header.tsx:33` | Between-component tier inside a component (`branding.md:207-210`) |
| Bottom edge | `border-hairline border-b` | `chat-header.tsx:33` | Correct — decorative rule, no floor needed (`branding.md:98`) |
| Ground | **none declared** | `chat-header.tsx:31-34` | Inherits `bg-surface` from `chat-content.tsx:261` |
| Avatar | `size-10` = **40px** | `chat-header.tsx:37` | Overrides the `size-8`/32px default at `avatar.tsx:25` |
| Avatar fill | `bg-sunken`, ink `text-ink-muted` | `avatar.tsx:52-53` | Recessed below the surface it sits on |
| Avatar glyph | `Bot size={22}` | `chat-header.tsx:39` | Hardcoded px, not a scale step |
| Agent name | `text-title` = **20px/1.3, 600** | `chat-header.tsx:43`, `index.css:67-70` | Page/dialog title step used for a bar label |
| Description | `text-body-sm` = **13px/1.5** | `chat-header.tsx:45`, `index.css:80-81` | ink `text-ink-muted` |
| Type ratio | 20 → 13 | | Skips `text-heading` (16px) and `text-body` (14px) entirely |
| Action button | `size="icon-lg"` = **36px**, `[&_svg]:size-5` | `chat-header.tsx:56`, `button.tsx:148` | App default for header actions is `icon` = 32px (`button.tsx:145`) |

### Why it reads squat and unbalanced

1. **The declared height is a lie.** 84px is asserted but the box renders ~65px because
   `shrink-0` is missing. A designer specifying against 84px will specify against a
   number the app never draws. Fix Defect 1 first, then specify.
2. **84px is an outlier with no precedent in the app.** Every other bar:
   `h-13`/52px command palette (`command-palette.tsx:508`), `h-12`/48px nav rail header
   (`sidebar-navigation.tsx:248`), `h-10`/40px canvas header
   (`canvas-variables-viewer.tsx:451`), `h-8`/32px chat-sidebar header
   (`chat-sidebar.tsx:397`). 84px is 1.6× the largest of them.
3. **The type ramp jumps two steps.** 20px against 13px with no 16px or 14px between
   them. `branding.md:187-192` reserves `text-title` for "section and dialog titles";
   an agent name in a persistent bar is a group heading — `text-heading` (16px).
   `branding.md:195-196`: "a desktop app has no hero".
4. **The same agent wears two different avatars.** 40px here (`chat-header.tsx:37`)
   versus 28px in the transcript (`message-avatar.tsx:29`, `size-7`), both on the same
   screen, both `bg-sunken`. Nothing explains the difference to the user.
5. **Contract-correct things worth preserving:** the `border-hairline` bottom edge is
   right (decorative, `branding.md:98`); no shadow is right
   (`branding.md:82-86`); `truncate` on both text nodes is right; `min-w-0` on the text
   column (`chat-header.tsx:42`) is right; the `title` attribute on the description
   (`chat-header.tsx:46`) is the correct disclosure for truncated text.

### Constraints for the replacement spec

- Height must be `shrink-0` and land on the 48/52/56 band its peers occupy, or be
  content-derived via `py-*` rather than asserted.
- Name step: `text-heading` (16px). Description: `text-body-sm` (13px) at `text-ink-muted`
  — that pairing already clears 4.5:1 on all four grounds (`branding.md:149`).
- Avatar: reconcile with `message-avatar.tsx:29` (28px) or justify the difference.
- Action button: `size="icon"` (32px) to match every other header in the app.
- Drop `size={22}` from the `Bot` glyph — `avatar.tsx` and the button variants own icon
  sizing, and a `size` prop the variant overrides "states an intent it cannot deliver"
  (the exact trap documented at `message-input.tsx:558-566`).
- Ground: leave undeclared so it inherits the column, or declare it explicitly if
  Defect 2's ground pass changes the column. Do not introduce a fifth ground.
- No shadow, no hover lift (`branding.md:249-254`).
- **Adding a fill or border to this bar means adding a row to `CONTROLS` in
  `scripts/contrast-contract.mjs`** — `pnpm check-themes` is silent about components
  nobody listed (`AGENTS.md:57-62`).

---

## Ground/background token inventory — complete chat shell

Every `bg-*` in the chat shell and its ancestors. `canvas → surface → elevated`, with
`sunken` recessed below canvas (`branding.md:76-86`).

### App shell
| Element | File:line | Token |
|---|---|---|
| `body` | `styles/index.css:196` | `--color-canvas` |
| App root | `app.tsx:117` | none (inherits canvas) |
| `<main>` | `app.tsx:144` | none |
| Nav rail | `sidebar-navigation.tsx:236` | `bg-sunken` |
| Toasts | `themed-toast-container.tsx:28,37` | `--color-elevated` inline |

### Chat sidebar
| Element | File:line | Token |
|---|---|---|
| Sidebar root | `chat-sidebar.tsx:394` | `bg-surface` |
| Search input | `chat-sidebar.tsx:413` | `bg-surface` |
| Row hover | `chat-sidebar.tsx:47,268,293,322,401` | `hover:bg-elevated` |
| Row selected | `chat-sidebar.tsx:208,260,503` | `bg-accent-wash` |

### Chat column
| Element | File:line | Token |
|---|---|---|
| **Chat column** | `chat-content.tsx:261` | **`bg-surface`** |
| ChatHeader | `chat-header.tsx:33` | none (inherits surface) |
| Header avatar fill | `avatar.tsx:52` | `bg-sunken` |
| Transcript scroller | `canonical-transcript.tsx:589` | none (inherits surface) |
| **User bubble** | `canonical-transcript.tsx:106` | **`bg-surface`** ← see finding below |
| Transcript `<pre>` | `canonical-transcript.tsx:250` | `bg-sunken` |
| Agent avatar | `message-avatar.tsx:29` | `bg-sunken` |
| **Composer band** | `message-input.tsx:817` | **`bg-canvas`** ← Defect 2a |
| Composer box | `message-input.tsx:101` | `bg-surface` |
| Composer icon hover | `message-input.tsx:657,691` | `hover:bg-elevated` |
| Suggestion chip hover | `message-input.tsx:801` | `hover:bg-elevated` |
| Slash popup | `slash-commands.tsx:191` | `bg-elevated` |
| Reply preview | `reply-preview.tsx:25` | `bg-sunken` |
| Attachment strip | `attachments-preview.tsx:35` | `bg-sunken` |
| Attachment overlay | `attachments-preview.tsx:46` | `bg-elevated` |
| Attachment badges | `attachments-preview.tsx:238,250` | **`bg-surface/85`** ← see finding below |
| Attachment disabled | `attachments-preview.tsx:252` | `disabled:bg-sunken` |
| Attachment frame | `message-item/attachment-frame.tsx:47,76` | `bg-sunken` |
| Log block | `message-item/log-block.tsx:24` | `bg-sunken` |
| Error block | `message-item/error-block.tsx:107` | `bg-danger-wash` |
| Error footer | `message-item/error-block.tsx:111` | `bg-surface` |
| Trace hover | `trace/trace-line.tsx:193` | `hover:bg-elevated` |
| Audio attachment | `message-item/audio-attachment.tsx:173,230` | `bg-surface` |

### Legacy / adjacent
| Element | File:line | Token |
|---|---|---|
| Legacy messages view | `messages-view.tsx:211` | `bg-canvas` |
| Raw info view | `raw-info-view.tsx:21` | `bg-sunken` |
| Error view | `error-view.tsx:53` | `bg-canvas` |
| Placeholder view | `placeholder-view.tsx:37` | `bg-canvas` |
| Options sheet | `chat-options-sidebar.tsx:123` | `bg-surface` |
| Canvas panel | `chat-content.tsx:382` | none, `border-l border-hairline` |
| Canvas tab strip | `canvas/canvas-tabs.tsx:194` | `bg-sunken` |
| Canvas selected tab | `canvas/canvas-tabs.tsx:217` | `bg-surface` / `hover:bg-elevated` |
| Canvas editor | `canvas/wysiwyg-markdown-editor.tsx:1701,1748,1967` | `bg-surface` |
| Canvas inline edit | `canvas/inline-edit.tsx:76` | `bg-elevated` |
| HTML preview | `canvas/html-preview.tsx:53,82` | `bg-surface` |
| Spreadsheet footer | `canvas/spreadsheet-preview.tsx:953,958,970` | `bg-surface` / `bg-sunken` |

### Two further contract findings surfaced by the inventory

**A. The user bubble is invisible against its own ground.**
`canonical-transcript.tsx:106` renders the user bubble as
`rounded-frame border border-hairline bg-surface` — `bg-surface` on the `bg-surface`
column (`chat-content.tsx:261`). The bubble's *only* edge is `hairline`, which is
decorative and carries **no contrast floor** (`branding.md:98-107`). Removing that
border would lose information (which speaker a turn belongs to), so by the contract's
own test it is structural and must be `border-control` at 3:1 — or the bubble needs a
different ground. This is precisely the failure mode `branding.md:104-107` describes as
"the control's only edge, effectively invisible". The agent side has no bubble, so the
border is doing all the work of distinguishing the two speakers.

**B. Opacity-modified role tokens.**
`attachments-preview.tsx:238` and `:250` use `bg-surface/85`. An alpha-modified ground
lands on a different rendered colour depending on what is behind it, which is the same
class of defect `branding.md`/`index.css:182-193` rejects for disabled states
("disabled changes colour, never opacity"), and it is invisible to
`scripts/contrast-contract.mjs`, which asserts over solid role triples. If a
translucent chip over an image is genuinely wanted, it needs an authored role, not an
alpha suffix.

---

## Recommended fix order

1. **Defect 1 first.** Nothing else can be measured or screenshotted reliably while the
   header height is a function of composer content.
2. **Defect 2a** (`bg-canvas` → `bg-surface` at `message-input.tsx:817`) — one-line,
   independently verifiable, removes the wrong-coloured band.
3. **Capture a rendered frame** before touching Defect 2b or 3, to confirm which of the
   two measure mechanisms the operator actually saw and to establish the before/after
   pair the standing instructions require.
4. **Defect 3** as a designer-authored spec against the corrected geometry, plus a
   `CONTROLS` row in `scripts/contrast-contract.mjs` if the bar gains a fill or border.
5. Convert the bare-string `className`s at `chat-content.tsx:257,258,261` to `cn(...)`
   while in the file (`AGENTS.md:66-70`).

## What this audit did not establish

- Whether the scrollbar in Defect 1 is on `document.documentElement` or on a descendant.
  Static reading says a document scrollbar should be impossible; measuring
  `scrollHeight - clientHeight` in the running app settles it in one line.
- Whether Defect 2's "pushed left" is the 62ch/`pl-10` asymmetry (§ 2b), the 4px
  scrollbar offset, or something only visible at the operator's specific window width
  and sidebar/canvas state. A screenshot with `getBoundingClientRect()` on
  `[data-lo-canonical-transcript] > div` and on the `COMPOSER_BOX` div settles it.
- Runtime-rendered geometry generally: I have no browser or shell in this role, so every
  number above is derived from the source and the token definitions, not measured.