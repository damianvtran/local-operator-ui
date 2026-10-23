# Keyboard shortcuts: the registry, dispatch, and how to extend it

Design note for issue #928 (user-assignable keyboard shortcuts), as implemented.
The modules live under `src/renderer/src/shared/keymap/`; the settings surface is
`features/settings/components/keyboard-shortcuts-section.tsx`.

## The shape

- **One registry** (`keymap-registry.ts`): every assignable action as `{ id,
  label, category, defaultChord, scope }`. The id is persisted data — it is the
  key a user's override is stored under — so ids are never renamed without a
  migration. `RESERVED_CHORDS` sits beside it.
- **One chord grammar** (`keymap-chord.ts`): the canonical stored form is
  lowercase, modifier order `primary+alt+shift`, one key last (`primary+j`,
  `primary+shift+c`). `primary` is the app modifier (⌘ on macOS, Ctrl elsewhere)
  and is the COLLAPSED spelling of both `meta` and `ctrl` — the judgement every
  predicate in the app already makes. Parsing, storage, refusal and display all
  go through this one form, so a chord prints what it answers.
- **One recorder vocabulary** (`chord-capture.ts`): the modifier-only keys, the
  edit-ending keys (Escape/Enter), the key-name table and the composition are
  shared with the backend registry's own field (`setting-control.tsx`), so the
  two recorders cannot learn different rules.
- **One router** (`use-keymap-shortcuts.ts`), mounted once in `app.tsx` in the
  BUBBLE phase. A capture-phase listener would run before the surfaces it must
  yield to.
- **Persistence is renderer-local** (`ui-preferences-store.shortcutBindings`):
  only overrides are stored; absent = the action's default. Writes are
  re-validated at the store action, and the hydrating guard
  (`sanitizeShortcutBindings`) re-validates every blob, because `localStorage`
  is not a trusted input.

## Dispatch precedence (per keydown, in order)

1. `defaultPrevented` → return. An editor (CodeMirror, the Markdown editor) or
   any surface that claimed the key answers FIRST, because React handlers run as
   the event bubbles and `preventDefault` is their "mine".
2. `repeat` or IME composition → return.
3. No `metaKey || ctrlKey` → return; build the canonical chord; no match in the
   effective map → return.
4. The press landed on an open dialog/menu/listbox → return (role-based, via
   `keyboard-scopes.ts`). Overlays own their keys.
5. The action's door is absent → return WITHOUT `preventDefault`: nothing
   happened, so nothing is swallowed. Door presence is the same condition as the
   rail item rendering (`panel-rail-actions.ts`), read from `rightSlotRoute` plus
   the asks offer.
6. `preventDefault()`, then run the action through the same toggle functions the
   rail's clicks use — one toggle path, two doors.

## The terminal carve-out

`Ctrl+J` inside a shell must still mean what the shell says it means. The router
needs no terminal knowledge for this: xterm consumes the keys a shell needs and
calls `preventDefault()` + `stopPropagation()`, so those presses never reach the
document listener (rule 1 covers the first, the bubble-phase registration covers
the second — a descendant that consumes a press keeps the router from firing at
all). On macOS `⌘J` is not consumed by xterm and therefore still toggles, which
is VS Code's own behaviour. This is pinned two ways: the jsdom cells in
`keymap-dispatch.test.mjs` hold the bubble-phase property structurally, and QA
presses both in the real app, because the xterm behaviour is a fact of the
pinned library (`@xterm/xterm` 6.0.0), not of this code.

## The reserved-list rule

`RESERVED_CHORDS` (`keymap-registry.ts`) lists the chords capture refuses, each
with a sentence naming the job. **A lane that adds a fixed chord to this tree
adds it to `RESERVED_CHORDS` in the same change.** The list was scanned from the
tree's fixed chord inventory (`git grep 'metaKey || '` over `src/`); re-run that
scan whenever the list is touched. One class is deliberately not on it:
punctuation keys (unrepresentable in the canonical grammar — `⌘+`/`⌘-`/`⌘0`
cannot be captured by construction).

One fixed chord is outside this rule by construction rather than by exemption:
`Ctrl+Tab` / `Ctrl+Shift+Tab` opens the recent-session switcher
(`docs/session-switcher.md`), and it belongs to no registry binding because the
grammar cannot spell `tab` at all and no binding in this registry can commit on a
modifier's keyUp. It needs no `RESERVED_CHORDS` row for the same reason: capture
can never produce it.

The canvas editors' save/open chords (`⌘S`, `⌘O`) and the focused row's move
(`⌘⇧↑`/`⌘⇧↓`) ARE on it, and the reason is a phase-order fact the first draft
got wrong (agent review round 1's F1 = QA's Q1, measured): their listeners sit
on `window` while the router is on `document`, and in the bubble phase
`document` runs FIRST — so a bound action fires *beside* the editor's rather
than after a `preventDefault` the router never saw. The move chords claim a
press only when the focused row offers it; on the announce and rowId-null
returns they answer without `preventDefault`, so the router fires on the same
press. A chord in that position is reserved, not explained away; a listener the
router genuinely yields to (rule 1) is the palette's case, not this one.

## The recorder, in three rules

1. **Tab and Shift+Tab navigate** (UX round 1's U1). The field leaves them to
the browser: no refusal, no `preventDefault`, focus moves as it does anywhere
else, and one Tab reaches Reset. A recorder that swallows them makes its own
Reset unreachable from its keyboard flow.
2. **Escape/Enter end the recording cue, never the focus** (U2). The hint and
any refusal clear; the field keeps focus, so the next Tab continues from the
row rather than the top of the page, and the next captured key re-arms the
cue. A blur to `<body>` is the defect this rule exists for.
3. **Reset deletes, Clear stores `null`** (U4). Absence means "the default";
the stored `null` is the explicit no-chord state — the action stops answering,
and its default stops claiming its chord, freeing it for another row. Pressing
the chord a row already shows changes nothing; pressing its default while an
override exists is the override's own reset (U3). The recorder's refusal sentence
names the platform's own modifier key (U5).

## The recipe for a seventh action

1. Add the action to `KEYMAP_ACTIONS` (id, label, category, defaultChord,
   scope) — never rename an existing id.
2. If the action drives a rail item: its id's suffix is the rail id
   (`panel.console` → `console`), so the toggle must exist in
   `panel-rail-actions.ts` and its door presence in `panelRailDoorPresent`.
3. If it ships BOUND, check the default against `RESERVED_CHORDS` and every
   other default; `keymap-registry.test.mjs` pins both.
4. If the action is NOT a rail toggle, extend the action→runner mapping in
   `use-keymap-shortcuts.ts` and add its door rule.
5. Tests: the registry cell in `keymap-registry.test.mjs`, a match case in
   `keymap-dispatch.test.mjs`, and — if it surfaces in the UI — a cap where the
   control prints one (`displayChord`).
