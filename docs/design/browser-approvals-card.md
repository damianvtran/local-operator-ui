# Browser approvals card — S6b

Status (2026-10-24): **S6b, interactive native child under the S6A opt-in.
Round-2 remediation applied; the four-cell native probe passes apart from the
measured I3 ring row. Not a shipped product surface until the independent
rounds clear.**

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
  The model is painted **in the same script as the measurement**: the S6b
  card's content is dynamic, so a measurement taken on the empty document
  settles at the floor and clips the decision buttons. Two separate
  `executeJavaScript` calls are not ordered by contract (round 2 measured a
  96 DIP card under load); one task applies the model, then reads. The read is
  a `setTimeout(0)`, not `requestAnimationFrame`: a hidden window runs no
  animation frames.
- A content-rect **width** change rebuilds the child at the new bounds before
  its document loads. Measured on Electron 44.3.0: a width change is not
  propagated to a child's viewport (`innerWidth` stays at the old value), while
  a height change is (`innerHeight` follows `setBounds`). The earlier S6a note
  attributed both to the viewport; the probe now distinguishes them.
- Auto-presented, **unfocused**, while the live queue is non-empty. No focus
  call, no page focus/blur event, no bounds change. Only an explicit open (the
  shield) may focus the card. The shield toggles the EXPLICIT open, never
  auto-present visibility; a dismissal from the card pushes the host projection
  and clears the latch, so the next press is not a stale close (F1).
- Hidden (not destroyed) when the queue empties or the page stops being
  presented. A tab switch with an unchanged content rect keeps it.
- The card identifies itself as app chrome: a localized `Local Operator`
  wordmark from the catalogue (`ui.browser.browser_new_tab.wordmark`) above the
  `Approvals` heading.
- The requester is the queue's **session identity resolved to its display
  label** by the renderer (`requesterSessionId` → conversation title), never
  `displayAuthority` (the requested site's host). Main cannot name a
  conversation, so the renderer pushes the label map with the locale/theme
  context; an entry with no session falls back to the document's localized
  "An agent" (F2).
- The exact palette name travels in the model (`palette`), so the card paints
  in the user's palette; the light/dark mode is read from the app's `dark`
  class, not from a substring of the palette name (F3).
- The request is ONE sentence — requester, the verb and the exact origin inline
  in monospace — matching the band's consent card; the scoped decisions share
  one gloss line that follows focus/hover, so five repeated gloss paragraphs no
  longer push the deny button under the fold (D2/D10/Q2). The broad grant uses
  the queue's own registrable-domain key (`allow_all_of` + `broad.key`) and is
  omitted entirely when the entry carries none (D3/Q1).
- Copy is catalogued. The expiry uses `ui.browser.approval_queue_model.expires_*`
  (ICU plural); the close/back/queue labels reuse the audited generic and
  browser keys. No new English key was added: a new key would require an
  audited translation in every shipped locale, and the card is not allowed to
  ship unaudited copy.
- The footer is sticky inside the scrolling body and shares that body's content
  width; the scroll boundary is marked by a hairline and a scrim that is
  **painted only while the body actually overflows** (D13 — an always-on shadow
  greyed the empty ground of a short list), and the failure line lives there so
  it is never below the 480 ceiling (D5/D6/D7). The close control is on the app's 28px ladder
  (D8); disabled states are colour treatments, not `opacity: .6` (D4 — the
  light disabled primary measured 2.53:1 under opacity; `ink-dim` on
  `elevated` is 6.14:1).
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
  card without taking anything. The shield is a toggle of the EXPLICIT open,
  not of auto-present visibility: the first press opens and focuses, the second
  closes; an empty queue clears the latch instead of arming the next arrival
  (M1/M3). The renderer pushes its resolved locale/theme to main on mount and
  on change, so an auto-presented card is already in the app's language (U5).
- Close and Escape dismiss the shown request and return focus to the page; the
  renderer returns keyboard focus to the shield on the open→closed transition.
  They never decide. A dismissed request stays pending and counted; an explicit
  open with every request dismissed clears the presentation-only dismissals and
  recalls the oldest (U3). `selectedEntryId` is only an explicit list selection:
  it is cleared before a dismissal and whenever the controller's request
  changes, so the painted request always follows main. A presentation-dismissed
  entry can stay in the live queue, so selection cannot be inferred from
  `pending` alone (Q-S6b-1).
- A decision returns focus to the page; the store's change builds the next
  model.
- The card is a non-modal dialog (`role="dialog"`, `aria-modal="false"`,
  `tabindex="-1"`, labelled). Tab order runs Close → Allow once → the four
  scoped decisions → Review all. `aria-busy` follows the model's busy state.
  Review all is an actionable list: rows carry requester, origin and expiry and
  select the request in place (D9/U4); the list inherits the request view's
  height so the native view does not collapse under it (D11), and the body
  fills the pinned card so the footer sits at the card's foot in both views
  (D12). Its visible label is the count (“2 approvals waiting”) with a
  disclosure chevron and an action aria-label (“Open approvals”), so it reads as
  an action without dropping the count (D9/U9). When an unnamed session would
  otherwise make two rows identical, the row label appends a four-character
  session discriminator — never the full id (U10). A stale action re-pushes the model
  with a visible stale line; the primary obeys the expiry like the scoped
  decisions.
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

**Round-3 driven rows (source `703f2ce5a3`, rebased onto `main` `4046249582`;
the built artifact hashes are pinned in `facts.json`):** four cells (264/900 ×
dark/light) on the built document — auto-present unfocused, geometry and
Q2-above-fold, RTL, the eight input rows (I3 ring BLOCKED), locale/requester/
palette and the nine document frames (request 264/368 × dark/light, list
264/368, catppuccinLatte, expired, stale error). A stalled fixture load records
`BOOT-fixture-load` and exits instead of hanging; the four rows below are
complete runs, never a retry relabelled. I4 also asserts the rendered
origin/requester after a dismissal, the Q-S6b-1 regression.
The probe uses a private `--user-data-dir` and `--disable-gpu`, no `HOME`
override, and reaps its process group; all four boots exit 0 with no leftover
Electron. The earlier "environment BLOCKED" claim was wrong: a sized child
loads once the probe follows that recipe.

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
