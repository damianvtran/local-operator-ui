# The empty-chat suggestion row and the rotating tip line

Design direction for the operator's ask: the seven bordered suggestion chips on
an empty chat are the loudest thing on the screen and ask the user to choose from
a menu of errands; the suggestions should be far quieter — in the spirit of how
Codex presents its composer — the copy should describe *this* product rather than
a toy case, and a subtle rotating tip line should join the band.

Author: designer subagent (local-operator-ui, lopdev team). Every measurement
below is read from a file in the tree, decoded from a committed frame's readback,
or computed from the twelve palettes in
`src/renderer/src/styles/themes.generated.css`. § 2 says which references are
pixels I captured and which are text I read.

Status: **design direction, implementation not included.** The coder implements
against this document. The direction is **not rendered** — § 7 says so plainly
and gives falsifiable geometry predictions in place of an after frame.

Read with: `docs/branding.md` (the design contract), `AGENTS.md` (environment,
evidence, window modes, release mechanics). Line citations are against this
checkout's tree except where a frame's own head is named.

**Docs only.** Nothing here changes product source. The coder implements; this
document is the direction.

---

## 1. What is there now, measured

The empty-chat band renders, top to bottom: the greeting, the composer box, and
the suggestion stack. The numbers below are the ones that matter to the
direction, with where each came from.

| Thing | Value | Source |
| --- | --- | --- |
| Suggestion chip box | **29.5px** tall | `docs/evidence/draft-splash-browser/readback-after-1380x872.json` (`bottom − top` on every chip) |
| Chip row pitch | **37.5px** (8px `gap-2`) | same readback, consecutive chip tops |
| Chip classes | `variant="outline" size="sm"` + `h-auto max-w-full whitespace-normal break-words px-3 py-1 text-body-sm text-ink-muted hover:bg-elevated hover:text-ink` | `measured-suggestion-stack.tsx:114-127` |
| Chips rendered | **7** (`MAX_SUGGESTIONS`) | `message-input.tsx:739-749` |
| Stack height, 1380x872 | **142px**, 4 rows, all 7 painted | readback-after-1380x872 |
| Stack height, 900x572 | **179.5px**, 5 rows, all 7 painted | readback-after-900x572 |
| Stack height, 830x572 | **179.5px** capped / **255px** uncapped, 5 painted of 7, 2 inert | readback-after-830x572 |
| Composer box | 112px tall, 648px wide at a 1024px window, `rounded-frame` (16px) `p-4` (16px), `border border-control bg-surface` | `after-measurements.json`; `message-input.tsx:537`, `:2021` |
| Content measure | `CHAT_MEASURE` — full width below a 750px column, capped at **900px** above it | `chat-measure.ts` |
| Gap, composer → stack | **24px** (`mt-6`) | `message-input.tsx:2496` |
| Greeting | `text-title` 20px, measured 26px tall, centred | `message-input.tsx:2650-2652` |
| Band, empty, 1024x673 | **569px** = 84.5% of the 673px column | `after-measurements.json` |
| Composer placeholder ink | `placeholder:text-ink-dim` | `message-input.tsx:2104` |

29.5px is not a coincidence and it is the number the whole direction turns on:
`text-body-sm` is 13px at line-height 1.5 (**19.5px**), `py-1` adds 4px top and
bottom (**8px**), and the 1px `border-control` edge adds 2px — 19.5 + 8 + 2 =
**29.5px**. Seven of those edges is seven controls each declaring, at the 3:1
floor, "I am a control and this is my boundary".

Which is exactly the operator's complaint, in structural terms: on a screen with
no content to compete with, the app draws **eight** `border-control` edges — one
composer box and seven chips — and the seven are the decoration.

---

## 2. Visual references

Four image files (2.1, 2.3, 2.4, 2.5) and one rendered snapshot quoted as
text (2.2), plus the block at the end of this section recording what I could not
reach. Assets live beside this file in `docs/design/assets/composer-suggestions/`.

Everything in this section is either **CAPTURED** (a real image or a real render
that I fetched, viewed and saved) or **DESCRIBED** (text from a doc or source
file, quoted, with no claim about pixels). Nothing here is described as an image
I did not hold.

### 2.1 Codex CLI — CAPTURED

`ref-codex-cli-splash.png` — the project's own committed screenshot, fetched from
`https://raw.githubusercontent.com/openai/codex/main/.github/codex-cli-splash.png`
(linked from the README at `https://github.com/openai/codex`). 1898x1190.

What it demonstrates, read off the frame:

- The composer is **one row with one `›` prompt and no boundary of its own**; the
  only box on the screen is the small two-row header (model / directory), and the
  composer sits on a *lighter ground* than the canvas — a fill step, not an edge.
- The suggestion area is **one sentence**: `Tip: Use /feedback to send logs to the
  maintainers when something looks off.` No chip, no border, no fill, one line of
  secondary-ink text between the header box and the composer.
- Consequences of posture: there is nothing to choose from. The tip is *ambient*,
  the composer is the only control, and the reading order is header → ambient tip
  → composer.

### 2.2 Codex CLI, the empty composer — CAPTURED (a rendered snapshot)

The TUI's own insta snapshot of the empty composer, fetched from
`https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__chat_composer__tests__empty.snap`:

```
"                                                                                                    "
"› Ask Codex to do anything                                                                          "
"                                                                                                    "
... (seven blank rows) ...
"  ? for shortcuts                                                                100% context left  "
```

This is the text Codex's renderer actually paints, not an illustration of it. Two
things it settles that the screenshot alone cannot: the composer's content is a
**single `›` + one placeholder sentence**, and the only other row the composer
owns is a quiet **hint/status footer** (`? for shortcuts` … `100% context left`).

The placeholder's weight is in the project's source, fetched from
`https://raw.githubusercontent.com/openai/codex/main/codex-rs/tui/src/bottom_pane/chat_composer.rs`
— the render at `:5039-5052` reads `Span::from(text).dim()`: the placeholder is
the **dim ink**, and the composer has no edge of its own.

### 2.3 Claude Code — CAPTURED

`ref-claude-code-composer.png` — frame 413 of 414 extracted from the project's own
committed demo, fetched from
`https://raw.githubusercontent.com/anthropics/claude-code/main/demo.gif`
(11.0 MB, 1552x992, 414 frames).

What it demonstrates: the composer is a **single row with a `>` prompt and a caret
on an otherwise empty line**, inside one low-contrast rounded edge, and beneath it
a **quiet status row** (`demo (demo)`) in the dim ink. Inline hints are carried in
the same dim ink and in parentheses (`(ctrl+o to expand)`) rather than as
controls. There is no suggestion grid anywhere on the screen.

### 2.4 Gemini CLI, the welcome state — CAPTURED

`ref-gemini-cli-welcome.png` — the project's own committed screenshot, fetched from
`https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/assets/gemini-screenshot.png`
(1089x582).

The most directly useful of the four, because it is a *welcome* state with more
than one suggestion. What it demonstrates:

- The suggestions are a **plain numbered list under the heading `Tips for getting
  started:`** — no border, no fill, no per-item mark, one ink step, left-aligned,
  three lines.
- The composer is `>` + a dim placeholder (`Type your message or @path/to/file`)
  inside one rounded edge, with a dim status footer.

### 2.5 The TUI on this machine — CAPTURED

`ref-tui-welcome-tip-row.png` — `~/local-operator/static/tui-welcome.png`, the
product's own committed capture of `lop`'s welcome view (2824x1060, downsampled to
1024x384 by this tool's image path). This is the nearest precedent to the
operator's ask (b), and it is the reference the direction is copied from rather
than reinvented: the splash ends with one dim rotating line —
`· /resume picks up a recent session where you left off` — under the hint table
and directly above the input card.

Its reasoning is in the source (all from
`~/local-operator/local_operator/tui/widgets/welcome.py`):

- **The glyph is the app's own `info` mark, not a word.** `TIP_GLYPH =
  NOTICE_GLYPHS["info"]` (`:458`), and `NOTICE_GLYPHS["info"]` is `"·"`
  (`widgets/transcript.py:1539`). The comment (`:453-457`): "A word — `tip:` —
  would cost five cells of the sentence to label a line whose tone already says
  what it is, and the mandate takes structure from symbols rather than prefixes."
- **The ink pair is glyph `faint`, sentence `dim`** (`:940-941`), with the reason
  spelled out at `:934-939`: "`dim` is the quietest ink the app will set a whole
  sentence in … `faint` is a step below that and reserved for marks and
  separators — legible as a bullet, not as prose. The pair puts the tip under the
  hints' fg/muted without making it a thing the eye has to work at, which is the
  one failure mode that would make a rotating row annoying."
- **12 s** (`TIP_ROTATE_INTERVAL_S = 12.0`, `:471`), inside a stated band: under
  about 8 s the line changes while it is still being read and "a text change
  inside the peripheral field pulls focus off the input the user is typing into";
  over about 15 s a short session only ever sees the first entry.
- **The row count is a function of width alone** (`_tip_lines`, `:909-930`): one
  row or none, `no_wrap` and a derived `TIP_MIN_WIDTH`, "a width threshold rather
  than a per-tip length test" — otherwise the splash would gain and lose a row as
  the reel turned and "shove the entire splash up and down the screen every
  `TIP_ROTATE_INTERVAL_S`".
- **The opening frame is pinned** (`:359-360`, `:427`): the rotation opens on
  `TIPS[0]` and only then resumes at a random point in the ring — `_sync_tip_timer`
  at `:1468`, the resume at `:1549`.
- **It is a slow timer, not an animation**: "a text change on a slow timer, not
  an animation" (`:57-62`).

### 2.6 What I could not reach

- **No pixel reference exists here for the Codex IDE extension, Codex web,
  Cursor, Warp, Raycast or Linear.** The `browser` tool raised site-approval
  prompts for `developers.openai.com`, `claude.com`, `www.raycast.com`,
  `linear.app` and `www.warp.dev` and nobody was at a screen to approve them, so
  those origins are **BLOCKED for this pass** and I captured nothing from them.
  `github.com` and `raw.githubusercontent.com` were already approved, which is why
  every capture above comes from a project's own repository. Each blocked origin
  needed an approval nobody could give.
- **DESCRIBED only, no pixels:** the Codex docs
  (`https://learn.chatgpt.com/docs/codex/cli.md` and `…/codex/ide.md`) are
  descriptive at the feature level and say nothing about the composer's
  suggestion presentation; the IDE page carries a placeholder line, "Illustration:
  Interactive Codex IDE extension beside a code editor", instead of an image. The
  Raycast developer docs (`https://developers.raycast.com/llms.txt`) cover the
  extension API, not the launcher's empty state. I am therefore **not** claiming
  anything about how Codex's IDE/web composer, Raycast, Warp, Linear or Cursor
  present empty-state suggestions; the direction below rests on § 2.1-2.5.
- The one *repo-internal* claim I am quoting rather than capturing is the TUI
  `welcome.py` docstring text; it is source, not pixels.

---

## 3. The recommended treatment

Two changes, one direction: **stop drawing a boundary for each suggestion, and
give the band one quiet ambient line.**

### 3.1 The suggestions: ghost, not outline

Ship the chip as the app's **existing borderless-control pattern** rather than a
new one. That pattern is already in this file, twice:
`variant="ghost" className="text-ink-dim hover:bg-elevated hover:text-ink"`
(`message-input.tsx:2313-2315`, the attach button; and the same at `:2398`).

Recommended classes for the chip (replacing `measured-suggestion-stack.tsx:118`):

```
variant="ghost"
size="sm"
className="h-auto max-w-full whitespace-normal break-words rounded-sm px-2 py-1
           text-body-sm text-ink-muted hover:bg-elevated hover:text-ink"
```

| Property | Value | Why |
| --- | --- | --- |
| `variant` | **`ghost`** — no fill, no edge at rest | `ghost`'s own definition is "has neither fill nor edge at rest" (`button.tsx:167`). The `outline` variant's `border border-control` (`:162`) is what goes. |
| Fill / border at rest | **none** | Nothing to assert against a ground, because nothing is drawn. |
| Ink, rest | `ink-muted` (unchanged) | The ink was never the problem, and it is the quietest role the contract sets a whole sentence in that still reads as prose. |
| Ink, hover / pressed | `ink` (unchanged) | The existing override already steps `ink-muted → ink`. |
| Hover ground | `bg-elevated` (unchanged) | `elevated` is the role § 2 names for "hovered rows", and this pair is *already asserted* by `contrast-contract.mjs`'s `ask option button (hover)` row (`fill: "elevated"`, `ink: "ink"`). |
| Radius | `rounded-sm` (**6px**) | § 5: 6px is the control radius. Unchanged — the radius is not what made it loud. |
| Type | `text-body-sm` (**13px**), unchanged | The copy is read; shrinking it would trade legibility for quietness, which is the wrong trade. |
| Padding | `px-2` (8px) horizontal, `py-1` (4px) vertical | `px-3` existed to keep a label off its own border. With no border, 8px is the internal gap and the *between-item* separation comes from `gap-2` (8px) plus both paddings — **24px edge to edge**. |
| Box | **27.5px** tall (29.5 − 2px of border), pitch **35.5px** | 19.5 + 8. Measured arithmetic, not a taste call. |
| Row alignment | **left**, on the measure's left edge — `justify-start` in place of `justify-center` (`measured-suggestion-stack.tsx:104`) | See below. |
| Count | **4** (`MAX_SUGGESTIONS` 7 → 4, `message-input.tsx:739`) | See below. |

**Why left-aligned.** With boundaries gone, a centred ragged block of four labels
is the only thing left making the set look deliberate, and it reads as a *first-run
menu*. Left-aligned on the measure's own left edge, it reads as a list of
examples — which is what § 2.4's captured welcome state does, and what § 2.1 and
§ 2.2 do with their quiet rows. It also introduces no new axis: the group already
has exactly one left edge, drawn by the composer box, and the placeholder text
inside it is inset by the box's padding rather than being a second edge.

This is the single recommendation most likely to be overturned on the frame. If
the design round finds the left edge detached from the centred greeting, the
fallback is to keep `justify-center`; what must not happen is a centred row *and*
a left-aligned tip in the same band, which is two axes.

**Why four.** The chip's visual cost was never its width — it was its boundary, and
that is now zero for every chip. What is left of the cost is **height**: at four
chips the row is one or two lines at every window size, and the band's suggestion
demand collapses (see § 7's arithmetic). Four also changes what the set *is*: seven
items is a menu with a most-likely-answer problem, four is a handful of examples
you read past on the way to the composer. The existing random sampling
(`message-input.tsx:741-749`) stays — but the **first** render of a session is
pinned to the pool's first four and only later new chats sample, which is the TUI's
own device (`welcome.py:359-360`, `:1468-1549`) and has the side effect that a design-round frame
is reproducible rather than a different four every run.

### 3.2 The tip line: one row, under the composer, `ink-dim`

A new element between the composer box and the suggestion row.

```
<div className={cn("mt-3 flex h-5 items-center gap-1.5", CHAT_MEASURE)}>
  <Info size={12} aria-hidden="true" className="shrink-0 text-ink-dim" />
  {/* `truncate` is a backstop, not the mechanism: § 8 measures the longest
      entry at ~374px against the 502px the narrowest column gives it. */}
  <span className="truncate text-body-sm text-ink-dim">{tip}</span>
</div>
```

| Property | Value | Why |
| --- | --- | --- |
| Placement | **below the composer box, above the suggestions**, 12px (`mt-3`) | The composer's own footnote. § 2.2's captured render puts Codex's hint/status row under the composer; § 2.3's capture puts Claude Code's status row under the composer. The suggestions stay last: they are the thing the user acts on, so they belong at the end of the reading order. |
| Left edge | the measure's left edge — the same edge the composer box's border draws | `CHAT_MEASURE`'s own docstring: "a single outer edge rather than two that happen to agree". |
| Height | **20px**, fixed (`h-5`), `leading-5` | `leading-5` is already the app's stated line box for a capped block (`CAPPED_BLOCK` in `chat-measure.ts`). A fixed height is what makes the rotation geometrically inert. |
| Glyph | lucide **`Info`, `size={12}`, `ink-dim`, `shrink-0`**, `gap-1.5` (6px) to the sentence | § 2.5's TUI uses the app's own `info` mark rather than the word `tip:`. § 5's icon table makes 12px legal only at `ink-dim` or darker, which this is; `size={12}` is an existing call shape in the tree (`app-updates-section.tsx:237`). The size rule is about the ramp; the mark's contrast account is separate and is held to the 3:1 non-text floor — § 10 item 2. |
| Sentence | `text-body-sm` (13px), **`ink-dim`** | § 2.5's reasoning ports directly: `ink-dim` is the quietest ink the app will set a whole sentence in — the composer's own placeholder role (`message-input.tsx:2104`). The desktop's ink ramp has no step between `ink-dim` and `ink-disabled`, and reaching for `ink-disabled` would repeat the exact defect the `/usage` unmeasured-window rule was fixed for (`contrast-contract.mjs`, `usage unmeasured window rule`). |
| No truncation in practice | the row is hidden below its width threshold instead | § 2.5's contract: the presence answer must be the same for every entry, and a truncated tip is "a fragment rather than a tip". Here the threshold is free: the whole prompt only renders when the column is ≥ 550px (`isSmallView`), and the longest proposed tip measures ≈374px at 13px against the 502px that column gives it — see § 8. |
| Motion | **none.** No transition, no fade, no slide. | § 2.5: "a text change on a slow timer, not an animation". A fade would also walk the row's ink *down* through the 4.5:1 floor mid-cycle, which is the "decorative animation taking a step the user is meant to see" defect the `--animate-pulse-visible` comment in `index.css` records. |

**The clock.** 12 s, unchanged from the TUI's `TIP_ROTATE_INTERVAL_S`, for the
same stated reasons: under ~8 s the line turns while it is still being read and the
change pulls the eye off the composer; over ~15 s a short session only meets one
entry. One departure, and it is deliberate: **the rotation is suspended while the
composer holds a non-empty draft.** The TUI's own worry — "a text change inside
the peripheral field pulls focus off the input the user is typing into" — applies
with more force here, because this composer is where the user is *writing a
prompt*, not running a command. The clock resumes when the box empties.

**Announcement.** The row is ordinary static text: no `aria-live`, no
`role="status"`, no `aria-hidden`. It changes under a timer, which assistive
technology announces only if the author asks it to; asking would spam a screen
reader with a sentence every 12 s. It is not a control and must not become one —
no click handler, no hover ground, no tooltip. If the row ever acquires an
affordance it has stopped being ambient.

### 3.3 The composed band, top to bottom

```
  greeting            text-title, ink, centred          (unchanged — 26px)
  24px                splash wrapper gap-6               (unchanged)
  composer box        rounded-frame 16px, p-4           (unchanged)
                      border-control bg-surface
  12px                mt-3                               (new)
  tip row             20px, h-5, Info 12 + text-body-sm (new)
                      both ink-dim, left on the measure
  24px                mt-6 on the suggestion wrapper    (unchanged)
  suggestions         27.5px each, rounded-sm, px-2 py-1 (restyled)
                      text-body-sm ink-muted,
                      ghost — no fill, no edge;
                      left on the measure; 8px gap
```

Wrapping the tip row in the same `CHAT_MEASURE` container as the composer box is
what gives the two rows one left edge. It must land **inside the `splash` node**
(the wrapper at `message-input.tsx:2641-2648`) and **must not be a child of the
`[data-lo-suggestion-stack]` node**: `suggestionStackCapFor` reads
`stack.children` as the chips and derives rows from boxes sharing a top edge, so a
non-chip child would be counted as a chip and corrupt the row model
(`suggestion-stack.ts:56-82`; `measured-suggestion-stack.tsx:62`).

---

## 4. Why this is subtle, in structural terms

The operator's word was "subtle", and "subtle" is not a value a coder can
implement. Four structural facts carry it, and each is countable:

1. **The structural edges on the band drop from eight to one.** At 1380x872 the
   band draws eight `border-control` edges — seven painted chips and the composer
   box. Each chip's edge is the role whose 3:1 floor exists for "the sole visual
   boundary of a control" (branding § 2), and it measures **3.34:1 at its worst**
   across the twelve palettes (iceberg; best 5.64:1 on neon). Seven edges at or
   above 3:1, in a wrapped grid, in the one place with nothing to compete with
   them. After: the composer box is the only control edge in the band.
2. **The only colour step added is a ground the app already paints on a hover.**
   Rest is ink alone; hover is one step to `elevated`, the role § 2 names for
   hovered rows; the tip is one ink step below the suggestions. No new fill, no
   wash, no tint, and nothing composited below `ink-dim`.
3. **Nothing moves.** No lift, no scale, no translate — hover is a colour step,
   which is the app's rule. The rotating row is a **fixed 20px line that cannot
   reflow**: the row's height is set by `h-5`, its presence is decided by width
   alone, and its content never wraps. So the band is geometrically inert under
   the rotation, which is what stops a slow timer from reading as motion.
4. **The count is smaller.** Four items at the foot of the band instead of seven
   centred pills — so the last thing on the screen is a short list rather than a
   grid of controls.

What is *not* claimed: that the chips become invisible. `ink-muted` on `canvas` is
5.16:1 at its worst across every palette — measured over all fifty-nine, where
the twelve this started from bottomed out at 6.74:1 on `iceberg` — more contrast
than the tip row and than the placeholder. The chips stay as legible as they are today; what they lose
is the *boundary* that told the eye they were a menu.

---

## 5. States and edges

**Hover and focus.** Hover is `hover:bg-elevated hover:text-ink`, unchanged, one
step to a ground role. Focus is the app's unlayered ring — `html :focus-visible`,
2px `--color-accent`, offset 2px, `:focus-visible` only, `box-shadow: none
!important` (`styles/index.css:380-387`) — plus `size="sm"`'s
`focus-visible:outline-offset-1!` (`button.tsx:142`). No focus fill is added: the
ring is 2px of the accent, which is unmissable on a 27.5px borderless box, and the
app's existing borderless control (the attach button) takes the ring alone. With
8px of `gap-2` between chips, the rings cannot collide.

**Disabled / streaming.** `measured-suggestion-stack.tsx` passes
`disabled={isInputDisabled || isRecording || isTranscribing}`. `ghost`'s disabled
state is `bg-transparent text-ink-disabled` (`button.tsx:171`) — colour changes,
never opacity (branding § 6), and there is no edge to lose. The tip row stays
visible and keeping time in these states: it is ambient, it makes no claim about
the turn, and hiding it would make the band's height move with the transport.
It **is** suspended (clock only, row still painted) while a non-empty draft sits
in the composer.

**Reduced motion.** The CSS rule in `styles/index.css` **caps** every duration at
0.01ms rather than cancelling, because "a cancelled animation can strand an
element on its `from` keyframe". That reasoning does not reach a rotating sentence:
there is no keyframe to strand. So the tip row needs its own rule, and the safe one
is different: under `prefers-reduced-motion: reduce`, **do not rotate at all** —
pick one entry and hold it for the life of the mount. Freezing a sentence strands
nothing, and a line that changes every 12 s is precisely the kind of motion the
preference exists to stop. The chips need nothing here beyond the existing
`duration-fast` colour transitions, which the global cap already covers.

**Narrow window (`WINDOW_MIN_HEIGHT = 600` → a 572px viewport).** The whole prompt
— greeting, tip row and suggestion stack — renders only when `!isSmallView`, i.e.
when the chat column is ≥ 550px (`chat-content.tsx`, `message-input.tsx:2495`).
The tip row inherits that gate rather than adding a second threshold, and the
suggestion row keeps its own. Because the direction strictly *reduces* the band's
height at every size, the defect the band cap exists for gets further away, not
closer (arithmetic in § 7).

**The band-height cap contract.** `suggestionStackCapFor`'s invariants must
survive untouched, and they do, because nothing in this direction changes what
the cap is given or what it returns:

- its inputs are still the chips' own boxes and the stack's top edge; the chips
  are still `flex-wrap` items, so **a row is still the set of chips sharing a top
  edge**;
- it still returns **the bottom edge of the last row that fits entirely**, or
  `null` when the whole stack fits, and it still refuses to drop the last row
  (`suggestion-stack.ts:69-82`). Neither the row model nor the tenth-pixel
  rounding changes;
- the `gap-2` (8px) between rows is unchanged, which is what makes a cap landing
  on a row's bottom edge cut nothing;
- `MeasuredSuggestionStack`'s `measure()` computes `fixed = splash.height −
  stack.height`, i.e. the *fixed* composer content. The tip row is fixed
  composer content and lands inside `splash`, so it is counted in `fixed`
  automatically — the stack's allowance drops by exactly the tip's 32px (12px
  margin + 20px row) and the cap arithmetic stays a single pass with no feedback
  loop (`measured-suggestion-stack.tsx:48-64`);
- the tip row is **not** a child of the stack node, so it is not counted as a
  chip. This is the one constraint the implementation must not get wrong.

**What the cap should keep doing.** Stay exactly as it is. With four borderless
chips the cap will not bind at the app's own minimum window height any more (see
§ 7), and the temptation is to delete it. Do not: its docstring is a record of a
real shipped defect, it is what bounds any future pool, and "it cannot happen now"
is the reasoning that produced the defect.

---

## 6. The theme set and the contrast floors

Computed from the twelve palettes in `src/renderer/src/styles/themes.generated.css`.
Worst case across the twelve, for every pairing the direction introduces:

| Pairing | Where it is used | Worst of twelve | Floor | Verdict |
| --- | --- | --- | --- | --- |
| `ink-muted` on `canvas` | chip label at rest | **5.16:1** (kanagawaLotus) | 4.5:1 | clears, asserted by the contract's `INKS` rows |
| `ink` on `elevated` | chip label while hovered | **7.64:1** (tokyoNight) | 7:1 | clears; the identical triple is already pinned by the `ask option button (hover)` row |
| ΔE00(`canvas`, `elevated`) | the hover ground step | **4.21** (iceberg) | aim ≥ 2 (§ 3) | clears with room; the step is perceivable in every theme |
| `ink-dim` on `canvas` | the tip SENTENCE | **4.95:1** (localOperatorLight) | 4.5:1 | clears everywhere, with only **0.45** of headroom on the light brand palette |
| `ink-dim` on `canvas` | the tip glyph, **as painted** | **3.30:1** (iceberg) | 3:1 (non-text) | clears; the painted 1px arc never reaches its own token (3.30-3.68 across four palettes) and is held to the non-text floor because it is decoration (design round 1, D2) |

Three consequences worth stating plainly.

**The tip sentence has almost no headroom on the light brand palette.** 4.95:1 against
a 4.5:1 floor. That is the whole argument for `ink-dim` being the floor of this
design and for the row having **no opacity, no fade and no wash**: any treatment
that composites the sentence below `ink-dim` walks it under the floor in
`localOperatorLight`, and the two themes above it (sage 5.21, iceberg 5.19) are
close enough that a partial fade would do the same there. The contract's own
`FLOOR.text` is 4.5 and `ink-dim` is asserted on all four grounds — this row must
stay on `canvas` and on nothing else. The glyph beside that sentence is the one
element in the row that is NOT held to this floor: it is a decorative,
`aria-hidden` mark, so it owes 3:1 as a non-text mark, and its rendered 1px arc
measures 3.30-3.68:1 (§ 10 item 2).

**The hover state is already covered, and the chip deliberately gets no
`CONTROLS` row.** The pairings are: `ink-muted` on `canvas` at rest (an existing
`INKS` row, 4.5:1 floor), and `ink` on `elevated` while hovered — the identical
hex pair on the identical ground as the existing `ask option button (hover)` row,
7:1 floor. Both pass everywhere.

What the chip **cannot** have is a row of its own, and the reason is worth
writing down so the next reader does not add one and conclude the wrong thing from
its failure. The assertion loop computes `fill ? p[c.fill] : ground` and requires
`max(fillEdge, borderEdge) ≥ 3:1` (`contrast-contract.mjs:1215-1244`):

- **at rest** there is no fill and no border, so the fill collapses to the ground
  and the edge ratio to 1:1;
- **hovered**, the fill is `elevated`, whose ratio to `canvas` is ~1.1:1 — a
  ground step, deliberately far below the 3:1 that belongs to a *boundary*. The
existing hovered rows that use `elevated` all carry `borderControl` at the same
time (`ask option button (hover)`, `:256-261`); this control has no border, and
that is the point.

So the gate this control needs is not a palette row — it is a **call-site pin**,
which is the mechanism this file already provides for exactly this class of edit:
"swapping the class at the call site from `border-control` (3:1 floor) to
`border-hairline` (no floor) … keeps every palette assertion green"
(`contrast-contract.mjs`, `STRUCTURAL_CALL_SITES`). Add one entry:
`{ what: "the empty-chat suggestion chip is borderless",
file: "src/renderer/src/features/chat/components/measured-suggestion-stack.tsx",
must: <the chip's rest class string>, why: <that reverting to `variant="outline"`
re-introduces seven 3:1 boundaries as the loudest thing on the screen, and that
`hairline` is the tempting wrong answer> }`. Two consequences of how those pins
match, both already documented there: keep the pinned string out of comments in
that file, and remember the match is order-sensitive and fails closed.

One **new** `PERCEPTIBLE` row is expressible and worth adding, because nothing
else measures the hover step:
`{ name: "suggestion chip hover ground step", role: "elevated", on: ["canvas"], minDeltaE: 2.0 }`
— the shape that table already takes (`contrast-contract.mjs:598-616`, consumed at
`:1272-1286`). Measured worst across the twelve: ΔE00 **4.21** (iceberg), clear of
the § 3 aim of 2.

**Nothing else moved.** The composer box keeps `border-control` on `canvas`
(3.34:1 worst) as the band's one boundary. The greeting keeps `ink`. No role is
added to the contract, and no palette is touched.

---

## 7. Before / after intent, and what I could not render

**Before — committed frames, not taken by me this pass.** The current band is
already photographed in this repository, on real backends, and I did not re-shoot
them. Cite them at their own heads:

| Frame | Surface | Source |
| --- | --- | --- |
| `docs/evidence/draft-splash-browser/after-draft-1380x872-frame2.png` | the full band, 7 chips in 4 rows | `docs/evidence/draft-splash-browser/README.md` names the instrument (the operator's own paired browser via the `browser` tool) and the head, `8f764cb83` |
| `docs/evidence/draft-splash-browser/after-draft-830x572-frame2.png` | the capped band at the app's minimum window, 5 painted + 2 inert | same |
| `docs/evidence/chat-shell-empty-centre/after-empty-1380x872.png` | the same band with the geometry readback beside it | `after-measurements.json` |
| `docs/evidence/chat-composer-states/idle` | the composer alone, 1024px | that set's README |

I did **not** re-shoot these and the numbers in § 1 come from their readbacks, not
from a fresh run: taking a fresh frame means an isolated `local-operator serve`
backend plus a browser harness (`docs/evidence/draft-splash/README.md`, the
runbook QA owns), and this pass ran no backend.

**After — not rendered.** I could not render the direction: a real frame of it
requires either the same isolated backend, or an edit to product source to add a
story, and the brief for this task is docs only. **No after frame exists and none
is claimed.** The coder renders it; the design round then judges it against the
numbered predictions below, which is what the predictions are for.

**Predicted geometry** (the chip heights and gaps are arithmetic from measured
values; the label widths are estimates at 13px system-ui and must be confirmed on
the frame):

| | Before | After | Delta |
| --- | --- | --- | --- |
| Chip box | 29.5px | **27.5px** | −2px (the border) |
| Row pitch | 37.5px | **35.5px** | −2px |
| Stack, 1380x872 (900px measure) | 142px / 4 rows | **~27.5-63px** / 1-2 rows | **−79 to −114.5px** |
| Stack, 900x572 (620px column) | 179.5px / 5 rows | **~63px** / 2 rows | **−116.5px** |
| Stack, 830x572 (550px column) | 179.5px capped / 255px laid out | **~63px** / 2 rows | **−116.5px capped, −192px uncapped** |
| Tip row | — | **+32px** (12px margin + 20px row) | +32px |
| **Net band change** | | | **≈ −47 to −85px** at every size, and ≈ −160px where the cap currently clamps (830x572, uncapped stack 255px) |

Two predictions to check on the frame, both falsifiable:

1. **The 900px measure is why a wide window does not simply collapse to one
   row.** `CHAT_MEASURE` caps the suggestion wrapper at 900px even at an 1100px
   column (`message-input.tsx:2496`). The pool's first four (the pinned opening
   sample) total ≈814px at ~6.6px per character — inside the 900px measure by
   only ~86px, so the estimate points at **one** row (27.5px, delta −114.5px),
   with the two-row case (−79px) as the fallback. A *later* random sample can be
   wider and take two rows (§ 8.1). This is the prediction most likely to be
   wrong, and the frame decides it.
2. **The cap should no longer engage at 572px.** The band was 528.5px inside a
   468px pane with seven wrapped chips; at four borderless chips the band is
   ≈ 528.5 − (179.5 − 63) + 32 = **444px**, inside the 468px pane without the cap
   clamping anything. If it still clamps, the copy is too long, not the layout.

**Before/after claim the frames must carry:** the band's count of painted
`border-control` edges goes **8 → 1** at 1380x872 (seven chips plus the box) and
**6 → 1** at 830x572 (five painted chips plus the box; the two inert chips paint
nothing), and the band's height falls by the numbers above while nothing else on
the screen moves.

---

## 8. Copy

**Both pools below are the SHIPPED copy, not the drafts.** The drafts this
section opened with were reviewed in round 1 and three of them did not survive
contact: the suggestion pool's head was re-ordered (D1, major) and the tip pool
was rewritten entry by entry (D3, D4). What each change was, in one line, at the
place it happened.

### 8.1 The suggestion pool

`DEFAULT_MESSAGE_SUGGESTIONS` (`chat-content.tsx:60-86`) was 25 entries of a
generic assistant: trending stocks, WallStreetBets, MNIST, space invaders,
"Organize my desktop". None of it describes this product. It ships as:

```ts
const DEFAULT_MESSAGE_SUGGESTIONS = [
	"Set up Linear MCP for me",
	"Create a team of agents",
	"Turn on phone access",
	"Show me what the agent did last turn",
	"Build a code-review agent",
	"Wake me tomorrow morning with a summary",
	"Schedule a task that runs every morning",
	"Review this repo and open a pull request",
];
```

Three of the four head entries were reworded from the draft, and one of them
twice. The draft's head
(`Set up the Linear MCP server for me` / `Set up the mobile relay and tunnel` /
`Create a team of agents` / `Create a new agent`) is the pinned opening sample,
so it is the first screen every user sees — and read as a set it repeated two
leading verbs (`Set up …`, `Set up …`, `Create …`, `Create …`) and spent two of
its four slots on the same job (a team, an agent). D1's direction, now a rule in
`composer-suggestions.ts`: **no two entries share a leading verb, and the pool
keeps at most one create-an-agent entry.** The head therefore became MCP, teams,
phone access and session insight — four capabilities — with the phone entry
RETIRED and replaced rather than moved: `Set up the mobile relay and tunnel` left
the pool, and the capability is now asked for as `Turn on phone access`, which is
the head's **third** entry, not the tail's. (Round 2, M2: this sentence said the
wording "moved to the tail", and the pool's tail — `Build a code-review agent`,
`Wake me tomorrow morning with a summary`, `Schedule a task that runs every
morning`, `Review this repo and open a pull request` — holds no phone entry at
all.) Its register also matches
the tip row's sentence for the same thing. `Create a new agent` left the pool in
favour of `Build a code-review agent`, which is a job rather than a repetition of
`Create a team of agents`.

**`Turn on phone access` is the one place the copy was shortened for geometry,
and it was MEASURED rather than estimated.** The recommended wording
(`Turn on phone access for this session`) put the pinned four on **three** rows at
the 550px column floor: its 249.2px chip plus the 246.2px chip beside it is
495.4px against the 494px of usable width left by the 8px gap, so the wrap
spilled to a third row (measured with `scripts/composer-band-geometry.mjs`). The
pinned head taking **two** rows at the floor is the documented ceiling, so the
label lost its qualifier rather than the pin losing its count: the shortened head
measures one row at the 900px measure (759.7px used) and two rows at the floor
(35.5px pitch, 63px stack), which is what the committed frames show. The
session-scoped half of the sentence is not lost from the band — the tip row
carries `ask for phone access to drive this session from your phone`.

Five of the eight are the operator's own examples; the other three are
affordances that exist in this tree (chat search; the run panel; the agent
cursor). Every entry names something the app can actually do, in sentence case,
in the user's terms, and each is cited against the tree in the PR body.

`MAX_SUGGESTIONS` is **4**; the first sample of a session is pinned to the
pool's first four (§ 3.1), and the sample is held for the mount of the composer
that owns it (round 1, R3).

**The pool's labels carry a length budget, and what it guarantees is narrower
than "any four fit" — this is MEASURED, not estimated.** Two facts, both from
`scripts/composer-band-geometry.mjs` at the committed viewports:

- **The pinned head is the sample the frames show and it is bounded by geometry
  that holds.** One row at the 900px measure (759.7px of chips and gaps), two rows
  at the 550px column floor (173.6/164.2 on the first, 151.7/246.2 on the second,
  35.5px pitch, 63px stack), and the tip sentence is `clipped=false` at both.
  This is why the head's wording is what was shortened for width (§ above): the
  ceiling for the pinned sample is two rows at the floor, and it is worth
  defending.
- **A later RANDOM draw can be wider, and at the floor it can take more than two
  rows.** The pool's longest entries are the same ones it had before this change
  (the reorder moved labels, it did not lengthen them): the four longest measure
  two rows at the 620px column (`long-labels/`), and the same four at the 550px
  column would wrap past two because the widest of them is 291.1px against 502px
  of row width. That is the tail's real ceiling and it is NOT 1,000px of copy — it
  is the pool's four longest labels, which a draw can pick.

So the honest statement of the rule is: **the pinned opening sample is held to
one row at the measure and two at the floor; a later draw is allowed to wrap
further, and the stack's cap (`suggestion-stack.ts`) is what keeps that honest
for the band's height.** At the floor the allowance is 263.6px against a 63px
stack, so a wider draw has room before the cap binds — the cap exists for the
pane, not for the copy. What the pool's own budget buys is that no single entry
can truncate (356px worst against 484px at the floor) and that the pinned head
keeps its two rows. Nothing moves *while* a user looks at the row (the sample is
drawn once per mount), which is why a variable-height stack is acceptable here
where the same variability is refused for the tip row.

### 8.2 The tip pool

UI-flavoured ports of the TUI's `TIPS` (`welcome.py:404`). It ships as:

```ts
const COMPOSER_TIPS = [
	"search chats and agents to reopen an earlier session",
	"ask for a team and several agents share one request",
	"type /approvals to set whether tools ask first",
	"ask for parallel work and the agent fans out subagents",
	"open the run panel to see a turn's plan and subagents",
	"attach a file with the paperclip, or paste one in",
	"connect MCP servers in settings to give the agent tools",
	"open a document in the canvas to keep it beside the chat",
	"set a schedule to run a prompt on a timer",
	"ask for phone access to drive this session from your phone",
];
```

**What changed from the draft, and why.** The TUI's pool is slash-command shaped
because its surface is a terminal, and there every entry *is* the syntax you type
— `/resume picks up a recent session where you left off` teaches a command by
showing it. Seven of this pool's draft entries instead named where a feature
lives (`the canvas keeps a long document beside the chat`, `schedules run a
prompt on a timer`), which teaches a reader sitting in a composer nothing they
can do next (D4). The rewrite's rule, now stated in `composer-tips.ts`: **every
entry names a move the user can make** — ask, type, open, attach, set — rather
than a pane's address. Two entries were also wrong as rendered English and had
to go regardless: the pinned first tip's `the chat list search` is a three-noun
compound the product does not use (the app says "Search chats and agents"), and
`settings connects MCP servers` was ungrammatical with no named destination
(D3). The TUI's own wording for the approvals tip survives, because the desktop
ows `/approvals` and the picker's own copy is the same claim.

The pool is prose in `text-body-sm`, so it carries no markup, no monospace and
no glyph of its own. Keep the TUI's rule that **presence is a function of width
alone**: the row renders or does not render for the whole pool, never per entry,
so the band cannot gain and lose a row as the reel turns. That rule is only
honest while no entry can truncate, so the pool carries a character budget
asserted in `scripts/composer-suggestions.test.mjs` (round 1, D5).

The longest shipped entry is 58 characters (`ask for phone access to drive this
session from your phone`), which **measures 356px** in the row's own element at
the narrowest column that renders it (the rig clones the real span rather than
estimating per character), against **484px** available there — the 502px column
less the 12px glyph and the 6px gap. So the row fits without truncation at the
smallest size where it exists, with **128px** of slack, and `clipped=false` for
all ten entries. That is a MEASURED number and it is the one the character budget
in `scripts/composer-suggestions.test.mjs` (62 chars) keeps true: if an entry ever
measures over 484px, shorten the copy rather than introducing a per-entry length
test.

---

## 9. What not to do

- **Do not keep `variant="outline"` and just shrink the chips.** The boundary is
  the loudness; a smaller bordered pill is still seven chip edges sitting on the
  3:1 structural floor.
- **Do not reach for `hairline`.** § 2 of the contract: if a boundary carries
  information it is structural and owes 3:1; if it does not, delete it. `hairline`
  measures **1.25:1 at its worst on `canvas`** (localOperatorLight) — a boundary
  nobody can see, which is the defect the outline/hairline split exists to stop.
- **Do not tint or fade anything.** No `opacity`, no `accent-wash`, no gradient on
  the tip row: `ink-dim` has 0.45 of headroom on the light brand palette (§ 6).
- **Do not make the tip row clickable, and do not give it a tooltip.** It is
  ambient; an affordance makes it a control and moves it into the accent budget.
- **Do not put the tip row inside the suggestion stack node.** It would be counted
  as a chip (§ 5).
- **Do not rotate on a fade, and do not announce the rotation.** No transition
  (§ 3.2), no `aria-live` (§ 3.2).
- **Do not bump any version.** Per this window's release discipline, `package.json`
  stays at the released version on the branch.

---

## 10. Open items for the coder and the review rounds

1. **Confirm the four-chip wrap at 900 and 550** (§ 7, prediction 1; § 8.1's
   length budget). If four wrap to three rows at 550, shorten the labels rather
   than dropping the count or shrinking padding below `py-1` — 27.5px is already
   the WCAG 2.2 SC 2.5.8 floor's margin (24px minimum target, and this is not a
   touch target but it should not get smaller than a link row).
2. **Settled, with a corrected account (design round 1, D2). The 12px `Info`
   glyph reads as a mark and not as a thin speck — but the justification the
   first version of this item gave was wrong.** `size={12}` is what § 5 permits
   for an icon at this ink, and the glyph is legible as a mark at 1:1 and at
   250% in all four palettes the design round measured. What it does NOT have
   is the contrast its TOKEN suggests: `ink-dim` clears 4.5:1 on canvas (4.95
   worst), but the PAINTED mark is a 1px rendered arc whose core antialiases to
   **3.30-3.68:1** (light 3.35, dark 3.68, iceberg 3.30, sage 3.43) against the
   sentence's 5.44-5.77 beside it. That is above the **3:1 non-text floor** and
   the mark is decorative with no informational role, so it is held to that
   floor and not to the text floor — it is the weakest thing in the band and it
   is allowed to be. `composer-tip.tsx` carries this account. Do not reach for a
   heavier stroke to close the gap (§ 5: one pen, never two); the available
   quieter step, if a later round wants one, is dropping the glyph entirely —
   the plain sentence § 2.4's captured Gemini welcome state shows working.
3. **Settled: the left-aligned suggestion row is right, and the fallback is not
   needed (design round 1, N1).** The band has one axis, not two. Measured on
   the frames: the composer's border box and the chips' own control boxes and
   the tip glyph all land on the same left edge (240 at 1380, 164 at the column
   floor), while the greeting is centred *within* the measure. The three
   different ink-left-edges inside the band (tip glyph 240, chip label 248, tip
   sentence 258, composer placeholder 265) are each component's own padding,
   not a second axis: a glyph-prefixed row and a padded control row cannot share
   a text edge without hanging the glyph outside the column or bleeding the
   chip's hover ground past the measure. Recorded so a future round does not
   re-open it.
4. **Settled: eight entries × 4 shown, and the head is held to two rules
   (D1).** The mechanism (pin the first, sample after) does not depend on the
   pool's size, and the pool's contents were left open here deliberately —
   round 1 re-ordered the head, and the rules that came out of it (no two
   entries share a leading verb; at most one create-an-agent entry) are stated
   in `composer-suggestions.ts` and asserted in the unit test.
5. **Add the call-site pin and the `PERCEPTIBLE` row** (§ 6), and say in the
   commit why the chip has no `CONTROLS` row.
