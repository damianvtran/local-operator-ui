# Ask drawer below the dock breakpoint: design decisions

Status: architect recommendation, 2026-11-03; implemented the same day, with the
amendments recorded below from the first review and QA rounds.

Scope: the Ask drawer only (session scope in `chat-content.tsx`, fleet scope in
`chat-layout.tsx`). The canvas `overlay` literal is untouched.

## Decisions

- **D1 - Which predicate says "dock or overlay", and measured from where?**
  - Taken: keep `canvasPaneMode(rowWidth)` (row - 480 >= 400, i.e. row >= 880) as the
    one predicate, measured from the pane ROW (`paneRowWidth` in `chat-content.tsx`,
    `contentBox.width` in `chat-layout.tsx`), not the window. No second threshold.
  - Rejected: a separate ask-drawer threshold (would split the one-width system;
    `resolveRightSlotWidth` already routes "ask" through `canvasDockWidth`).
    Window-measured: the sidebar yield already predicts the row from the window
    (`sidebarYieldsToCanvas`), so a window measure is a second copy.
  - Commits us to: no feedback loop. The sheet is `absolute`, so it never changes the
    row; the sidebar decision is a function of the window (`resolveSidebarLayout`),
    not of this measure. Probe (esbuild-bundled real module, drawer open, rail 44,
    sidebar preference 260): 979px -> sidebar 260, row 675, overlay; 980 -> strip 56,
    row 880, docked; 1184 -> sidebar 260, row 880, docked. So overlay occurs only
    below ~980px (936 with no rail on settings/agents routes).
  - Overturned by: operator wanting the chat to shrink below 480
    (`CHAT_PANE_MIN_PX`).
- **D2 - Geometry.**
  - Taken: right-anchored sheet inside the pane row, not a full-row cover.
    `absolute inset-y-0 end-0 z-40 shadow-overlay max-w-full`, inline `width`, with a
    scrim sibling (`absolute inset-0 z-30 bg-scrim`) covering the ROW only. Width =
    `min(preferred, max(min(row, 400), row - 48))`: the 400 floor is kept, so the row
    uncovered is 48 where it can be and less (0 at row <= 400) where it cannot.
    `preferred` is `rightSlotPaneWidth(CANVAS_PANE_MIN_PX, rightSlotWidth)`, the same
    shared 640 default / 400 floor / 1200 cap. No width or constant of
    uniform-side-panels changes; the 48 gutter is the only new number (chosen, not
    measured: a click-to-close target >= the 44px rail precedent, `PANEL_RAIL_WIDTH_PX`).
    `end-0` + `max-w-full` + inline width is not the over-constrained `inset-0`+width
    case `pane-slot.tsx` documents (D8); `max-w-full` resolves at paint time, so a
    one-reflow-old row number cannot overflow.
  - Amendment (review round 1, nit): a strip narrower than `ASK_SHEET_MIN_SCRIM_PX`
    (16px) is not a press target, so there the sheet takes the whole row and the
    scrim is not drawn. That covers rows at or below the 400 floor and the 401-415
    band the floor would otherwise leave a 1-15px sliver of.
  - Rejected: keep `absolute inset-0` (no seam, no context, no click target). Pure
    "replace" (full row, chat hidden): consistent with the branding rule "Narrow
    windows replace, they do not overlay", but that rule is about route detail rails;
    the branding contract blesses the one shadow for a drawer, and a replaced
    transcript loses the question's context. `docs/branding.md` gained one sentence
    scoping the rule away from the transient Ask drawer.
  - Overturned by: operator preferring replace; the change is then width = row, no
    scrim, and nothing else moves.
- **D3 - Root cause of "text bleeds through" is the ground, not only the position.**
  - Taken: in overlay mode the drawer must not wear `data-glass-region="pane"`. That
    marker applies `color-mix(elevated, --lo-glass-a-elevated)` (net alpha inside
    `<main>`), i.e. a TRANSLUCENT ground by design for a docked pane over window
    material; over the transcript it shows text through. Without the marker the
    class `bg-elevated` is opaque. A prop `ground: "glass" | "solid"` on `AskDrawer`
    (forwarded by `FleetAskDrawer`) carries it, solid when the presentation's mode is
    `overlay`. Not measured: the actual alpha at the operator's glass intensity
    (mechanism read from CSS, screenshot consistent with it).
  - Rejected: a second background class on the slot (would fight the unlayered glass
    rule by specificity).
- **D4 - Focus and Escape.**
  - Taken: modal over the ROW via `inert`, applied by a layout effect setting
    `el.inert` (React 18.3 and its types have no `inert` prop), NOT by editing a
    class string (`chat-pane-floors.test.mjs` and `lane-leading.test.mjs` regex it).
    Scrim `onPointerDown` = `onClose()` with no options (a withdrawal, the same kind
    as Escape; the X stays the only `dismissSlot` door). Escape unchanged: the
    drawer's `onKeyDown`, the window ladder's `askClaimsEscape`, the fleet listener.
    Focus-on-mount unchanged. Do NOT give the sheet `role="dialog"`:
    `pressLandsOnOverlay` would make `askClaimsEscape` return false and silently drop
    the chat-page Escape claim.
  - **D4 amendment (review round 1, M1; QA round 1, Q1): the FLEET mount covers
    `{content}`, so it inerts it too.** The session mount has a chat column to name;
    the shell's fleet sheet runs on every route, so the covered thing is whatever the
    route drew. `chat-layout.tsx` wraps `{content}` in a `display: contents` element
    (`data-ask-covered-content`) and sets `inert` on it from a layout effect. It
    introduces no box, so the flex row and both measurements (`contentColumnRef`, the
    lane's stop) are unchanged. Scope is precise: **covered content inert; the sidebar
    and the panel rail stay reachable** - the rail's asks item is how the sheet is
    closed or reopened, and freezing it would leave a pointer user with only the
    sheet's own X.
  - Ordering (review round 1, m1): React flushes a child's layout effects before its
    parent's, so `AskDrawer`'s door read runs while the chip still holds focus, and
    only then does the parent's effect inert the column - which blurs that chip to
    `<body>`. The drawer latches the pressed door before the unread-frame wait
    (`pressedDoorRef`) instead of re-reading focus at the commit that moves it, and
    accepts the latch only when the press is still the user's last act: the keyboard
    is still on that control, or it fell to `<body>` because our own commit took the
    control away - the covered column's `inert` marker is on it, or the control was
    removed. `<body>` alone is not evidence (a click on chrome parks it there too;
    review round 2, m-r2-2).
  - Rejected: `role="dialog"` and Radix `DismissableLayer`; a Radix drawer (`display:
    contents` was preferred over moving the composer out of the inert subtree);
    claiming Escape from `<body>` (it would add a page-wide claim for a case the
    carried-open close below removes); a focus-trap library (a second trap beside
    Radix's).
- **D5 - Auto-open must not cover the conversation.**
  - Taken: in overlay presentation `decideAskAutoOpen` leaves with reason
    `"covers-conversation"` (fact `overlayPresentation`, fed from
    `use-ask-open-policy.ts`). Rules 5 and 6 (no theft) are why this is a refusal
    rather than a modal. The chip and the rail still announce; the live region speaks
    the queue's own clause (`askWaitingAnnouncement`), so a reader who cannot see the
    chip is told asks are waiting. The leave is FINAL for the view: a later resize
    does not open it, because "on open" is the one moment the policy acts.
  - Related (review round 1, m2): a CARRIED open (one that outlives a conversation
    switch) is closed as a withdrawal at the start of an overlay view - the switch
    destroyed the element that held focus, so a carried sheet would mount with the
    keyboard on `<body>` inside an inert column. A DOCKED drawer still follows the
    user, as it always did.
  - **PRESS VERSUS RESULT (review round 2, M2-r2).** `openAsksForSecret` has three
    callers and the sheet changes only the middle one:
    - a PRESS (no options; the notice's "Open asks", the multi-secret confirm's
      "Open asks panel") opens in both presentations and takes the keyboard. A
      labelled door that does nothing below the breakpoint is a dead control; the
      drawer latches that control as the press origin, so a control our own commit
      blurs (inert) or removes (the confirm) still lands the keyboard in the sheet
      rather than on `<body>`.
    - a LANDED fill (`focus: false, openInSheet: false`) opens beside the box when
      docked and does NOT open the sheet: the act is done, and covering the
      conversation would price a completed action.
    - a REFUSED fill (`focus: false`) opens beside the box when docked and keeps the
      caret there; under the sheet it opens and takes the keyboard, because the
      composer is inert and cannot hold it - which is also what keeps
      `secret_fill_refused` ("the asks panel shows why") true. `onOpen` answers with
      whether it took the keyboard, and the composer decides the caret from that
      answer instead of assuming its box is focusable.
    The invitation is untouched: rules 5 and 6 still mean no auto-open.
  - Rejected: auto-open as a modal sheet (blurs the composer via inert, a focus
    theft); leaving the policy alone (reproduces the report on every conversation
    open below ~980px); claiming Escape from `<body>` (a page-wide claim for a state
    the carried-open close removes).
- **D6 - Pure function.**
  - Taken: in `chat-sidebar-layout.ts` beside `canvasPaneMode` (no import cycle: the
    store already imports from this file, so `preferred` is an argument):
    `ASK_SHEET_SCRIM_GUTTER_PX = 48`, `ASK_SHEET_MIN_SCRIM_PX = 16`,
    `type AskPanePresentation = { mode: "docked" | "overlay"; width: number; scrimmed: boolean }`,
    `askPanePresentation(rowWidth, preferredWidth)`.
    Docked: `{mode:"docked", width: min(preferred, canvasDockWidth(row)), scrimmed:false}`
    (equals `resolveRightSlotWidth` for ask); overlay:
    `width = min(preferred, max(min(row, 400), row - 48))`, with a strip under 16px
    collapsing to the full row; `scrimmed = row - width >= 16` (probe: row
    300/400/415 -> uncovered 0; 416 -> 16; 456 -> 48; 506 -> 48; 700 -> 60; 879 ->
    239). Both mounts call it. `chat-layout.tsx`'s lane stop takes `.width`, so
    `data-slot-edge` equals the drawn edge (the capture evidence asserts that). Keep
    `data-ask-mode` values "docked"|"overlay" (rigs read them).
  - As built (review round 1, B2): the two mounts read `preferred` TWO WAYS, and that
    is recorded rather than unified. `chat-content.tsx` reads it through
    `resolveRightSlotWidth(Number.MAX_SAFE_INTEGER, state)` because
    `chat-pane-floors.test.mjs` pins exactly four `rightSlotPaneWidth` calls in that
    file (the drawn panes) and must stay green unedited; the resolver returns the
    preference unchanged for a row that constrains nothing. `chat-layout.tsx` calls
    `rightSlotPaneWidth` directly (no such pin there). Both answers are the same
    number; the difference is a test-visible call count, not an arithmetic.
  - The canvas is still the withheld-divider flex dock; `canvasPaneMode`'s note was
    rewritten to say which occupant draws what.

## Existing tests/rigs that pin the behaviour

- `scripts/pane-slot-ground.test.mjs` - the drawer slot's mode, the sheet class
  list, the width, the scrim, the absence of `absolute inset-0`, and the `inert`
  assignment on both mounts.
- `scripts/notifications-drawer-scene.mjs` - the rig's overlay branch asserts width
  <= row, the scrim, the opaque ground and `inert` on the covered content.
- `scripts/window-glass.test.mjs` - an overlay fixture resolves to the opaque
  elevated role while the docked fixtures stay veiled.
- `scripts/ask-open-policy.test.mjs` - the reason matrix, `covers-conversation` and
  its precedence, and the announcement.
- `scripts/chat-sidebar-layout.test.mjs` - the pure function over rows 300-1000 and
  two preferred widths, including the minimum strip. `chat-pane-floors.test.mjs` and
  `right-slot-width.test.mjs` stay green UNCHANGED: that is the proof the resolver
  and the uniform-side-panels widths did not move.
- `scripts/credential-composer.test.mjs` - the composer's share of press versus
  result, driven through the shipped `MessageInput`: the multi-secret control opens
  as a press and keeps the keyboard out of the box, and a refused fill refocuses the
  box only when the panel answered that it did not take the keyboard.
- `scripts/ask-draft-swap.test.mjs` - the drawer's entry move when our own commit
  blurred the pressed control (`inert`) or removed it (the confirm): the press still
  lands; a control parked on `<body>` without that evidence moves nothing.
- `scripts/ask-open-render.test.mjs` - the refusal's live-region clause is retired
  when a queue settles while the sheet never opened.
- Leave: `renderer-driver.mjs`'s canvas adjacency assertion (canvas out of scope).
