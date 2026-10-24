# Browser approvals card — S6b

Status (2026-10-24): **S6b, interactive native child under the S6A opt-in. Not a
shipped product surface until the independent rounds clear.**

The approvals card is one native `WebContentsView` over the live page, sized to
the card and anchored to the content rect's **inline end**: bottom-right in LTR,
bottom-left in RTL. It exists because the page is itself a native child painted
above the app's DOM: a DOM popup cannot appear over it without moving or hiding
the page.

## Scope

- One lazy child, `#00000000`, `PAD = 8`, `INSET = 8`, width
  `min(352, contentW - 16)`, and height = the card document's measured height
  rounded **up** and clamped to `[96, min(480, contentH - 16)]`. The native view
  is therefore exactly card + 16 DIP on both axes, with an 8 DIP inset on every
  side.
- The height is measured from the card at the width it will occupy, never from
  a zero-width provisional view (that view reports a wrapped 150 DIP block).
  The model is painted **before** the measurement: the S6b card's content is
  dynamic, so a measurement taken on the empty document settles at the floor
  and clips the decision buttons.
- A content-rect **width** change rebuilds the child at the new bounds before
  its document loads. Measured on Electron 44.3.0: a width change is not
  propagated to a child's viewport (`innerWidth` stays at the old value), while
  a height change is (`innerHeight` follows `setBounds`). The earlier S6a note
  attributed both to the viewport; the probe now distinguishes them.
- Auto-presented, **unfocused**, while the live queue is non-empty. No focus
  call, no page focus/blur event, no bounds change. Only an explicit open (the
  shield) may focus the card.
- Hidden (not destroyed) when the queue empties or the page stops being
  presented. A tab switch with an unchanged content rect keeps it.
- The card identifies itself as app chrome: a localized `Local Operator`
  wordmark from the catalogue (`ui.browser.browser_new_tab.wordmark`) above the
  `Approvals` heading.
- Copy is catalogued. The expiry uses `ui.browser.approval_queue_model.expires_*`
  (ICU plural); the close/back/queue labels reuse the audited generic and
  browser keys. No new English key was added: a new key would require an
  audited translation in every shipped locale, and the card is not allowed to
  ship unaudited copy.
- The queue's own expiry re-pushes the model at the earliest live `expiresAt`,
  so the card cannot outlive its queue.
- Opaque-square fallback (`opaque: true`, `PAD = 0`) for platforms where the
  transparent-child path is not used.

## Trust boundary

The card is the first purpose-built preload on a native child. The document runs
with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a
dedicated non-persistent partition, and the pinned deny-all CSP.

- **Exactly two channels cross from the card**: `dismiss` and `decide`. The
  preload exposes one frozen object with those two verbs; there is no general
  `ipcRenderer`, no channel name in the document's world and no `sendSync`.
- Both handlers pin the sender to the card's own `webContents`, require the main
  frame, and require the frame's URL to still be the card document. A forged
  sender, a same-origin iframe or a navigation away cannot act.
- Every action carries the `seq` of the model it painted; main drops a stale
  seq. `decide` resolves the entry id against the **live queue** and calls
  `host.respondToConsent` — there is no second decision implementation, and no
  origin or scope is ever taken from the card.
- The model crosses the other way through `executeJavaScript`
  (`window.__approvalsCard.setModel`), the seam S6a proved for the count; it is
  rebuilt by a pure sanitiser (fixed enums, bounded strings, bounded array,
  32 KiB total, no HTML) before serialisation.
- More options and Review all are local view changes; they never cross.

## Interaction, focus, accessibility

- Shield click: explicit open. `window-raise.ts`'s `focusBrowserChordTarget`
  hands keyboard focus to the card only inside an already-focused window and
  only under the launch's `focus` show mode; a hidden/headless run opens the
  card without taking anything.
- Close and Escape dismiss the shown request and return focus to the page. They
  never decide. A dismissed request stays pending and counted; the next live
  request may present, and a new arrival may present again.
- A decision returns focus to the page; the store's change builds the next
  model.
- The card is a non-modal dialog (`role="dialog"`, `aria-modal="false"`,
  `tabindex="-1"`, labelled). Tab order runs Close → Allow once → the four
  scoped decisions → Review all. `aria-busy` follows the model's busy state.
- `lang`/`dir` come from the app's resolved locale, not the card's device tag
  (UX U2). `fr` formats French plurals and reads `lang="fr"`; `ur` sets
  `dir="rtl"` and mirrors the native view.

## Evidence

The S6b fixture's rows are in `docs/evidence/browser-approvals-s6b/` and the
card-document captures are attached to the PR (this repository carries records,
not frame containers).

**Proven in the hidden-window probe:** auto-present with no focus call and no
page focus/blur event; page bounds and `presented` unchanged; 264/900 dark/light
geometry; the content-driven height and its 480 ceiling; the RTL view mirror
(view x = 0, card x = 8); Allow once through the document's real button;
outside-click and page-click non-dismissal; Escape without a decision; the
shield open/close focus handoff; the Tab order; and a stale `seq` dropping.

**BLOCKED and not claimed:** native composite/transparency over a sibling page
(no Screen Recording, hidden window), the 8 DIP ring's native hit routing (no
sibling-view hit testing in a hidden window), and VoiceOver across the second
document (manual release gate).

## Gates

`pnpm check-i18n`, `pnpm check-types`, `pnpm check-themes` (the card's surface is
in the `CONTROLS` table), the controller suite
(`scripts/approvals-overlay.test.mjs`), the spawn-site tables, and the existing
browser suites the wiring touches. Desktop CI is the terminal automated run for
the full lane.
