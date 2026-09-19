# Session archive and delete — rendered evidence

The surfaces this feature adds, photographed in the running app: the row's
archive control and its reveal, the archived marker, the search block's
`Include archived` control off and on, the one permanent-delete confirmation, and
the withdrawn pair that is the fail-closed claim.

## How these frames were taken

`scripts/renderer-driver.mjs`, scene `session-archive`, in a headless launch
(`--window-mode` resolves to `headless` for a rig-shaped launch: `AGENTS.md` §
*Running the app without taking the operator's focus*), one launch per palette.
The app is the real one; the daemon underneath it is **not**:

```
# 1. the stand-in backend (the real one is the sibling pull request on
#    damianvtran/local-operator, branch feat/session-archive-delete)
node docs/evidence/session-archive/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/archive-stub-records

# 2. a build pointed at it (the repo's own .env supplies the other keys)
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:18234 pnpm build

# 3. one launch per palette
LOCAL_OPERATOR_DESKTOP_TOKEN=stub-token-archive node scripts/renderer-driver.mjs \
  --scene session-archive --backend http://127.0.0.1:18234 \
  --backend-records /tmp/archive-stub-records --seed-onboarding-complete \
  --theme localOperatorDark --out /tmp/archive-frames-dark --window-size 1380x900
LOCAL_OPERATOR_DESKTOP_TOKEN=stub-token-archive node scripts/renderer-driver.mjs \
  --scene session-archive --backend http://127.0.0.1:18234 \
  --backend-records /tmp/archive-stub-records --seed-onboarding-complete \
  --theme localOperatorLight --out /tmp/archive-frames-light --window-size 1380x900

# 4. the withdrawn half: the same app against a daemon with no archive store
node docs/evidence/session-archive/harness/stub-daemon.mjs \
  --port 18234 --records /tmp/archive-stub-records2 --no-archive
LOCAL_OPERATOR_DESKTOP_TOKEN=stub-token-archive node scripts/renderer-driver.mjs \
  --scene session-archive --backend http://127.0.0.1:18234 \
  --backend-records /tmp/archive-stub-records2 --seed-onboarding-complete \
  --theme localOperatorDark --capability-withdrawn \
  --out /tmp/archive-frames-withdrawn --window-size 1380x900
```

The scene asserts before it photographs — the catalogue answered, the pointer is
over a revealed control, the archived conversation matches nothing before the
control is on and a row after it, the confirmation is open on the conversation
the menu was opened on — and refuses any frame the app never held still for
(`stable`) or that carries a toast. Both runs report 0 FAIL.

## What each frame is, and what it is not

Every frame below is the real renderer: the real sidebar, the real
canonical-sessions store, the real search, the real header, the real
`ConfirmationModal`. The wire underneath is
`harness/stub-daemon.mjs`, which answers the **frozen** contract's shapes
(`include_archived` on both reads, `archived` on every row and hit,
`sessions.archive`, `sessions.delete` with its 409 guard, the two capability
keys) and nothing else.

| Frame | State | The claim it proves | How |
| --- | --- | --- | --- |
| `at-rest/{dark,light}` | the panel with the capability present, nothing archived on screen | a conversation's row spends NO reserved width at rest: no slot, no marker, no chrome in the search block while the box is empty | `--theme <palette>`, no scene step beyond `navigate("/chat")` |
| `row-hover/{dark,light}` | the pointer parked on the archive control of a live row | the affordance appears on the pointer's row and nowhere else, without the row moving (`group-hover`, opacity only) | the scene moves the **real** pointer (`Input.dispatchMouseEvent` at the control's box, from the `measure` verb) before the shutter |
| `search-live-only/{dark,light}` | `notes` typed in the search box, `Include archived` off | the search block gains its one control while a query exists; the archived conversation is NOT in the answer, and `[data-session-archived]` matches nothing | the scene types into the field through the input pipeline, then asserts the absence |
| `search-include-archived/{dark,light}` | the same query, the control ON | the archived conversation is reachable from the search, carries the muted marker, and the sidebar has gained no section to hold it | a real click on the checkbox, then an assertion that `[data-session-archived]` now matches and is in the viewport |
| `delete-dialog/{dark,light}` | the header's conversation menu → `Delete conversation…` | the one permanent delete asks with the danger role, names the conversation, says the transcript cannot be undone, and does nothing on its own | two real clicks (the trigger, then the item), then the dialog's box is measured |
| `capability-withdrawn/{dark}` | the same panel against a daemon that advertises neither capability | no slot, no marker, no control in the search block | `stub-daemon.mjs --no-archive` + `--capability-withdrawn`, which asserts both absences |
| `capability-withdrawn-search/{dark}` | the same, with a query typed | the search block still gains nothing | same run |

## The two measurements stated as numbers

**The reserved slot costs title width, and here is how much.** The archive
control is `size-6` (24px) plus the row wrapper's `gap-1` (4px) = **28px of the
title's line box, on every row, at rest** — reported by the scene itself
(`title width cost` in the run's output), and taken from every row whether or not
the pointer is on it. The second slot the pin pull request will land beside it
adds the same again, for **56px** at the shipped 320px panel. The title is
`truncate`, so the cost is paid in characters: at 320px a title of about 26
characters fits where 30 did. That is a **design trade-off the design round
should rule on** rather than something these frames settle.

**What "fail-closed" means here, measured.** `cmp` the withdrawn pair against the
capable run and the WHOLE FRAME differs — by design, and the difference is
exactly one row: `Previous chats 2` becomes `3`, because a backend that cannot
archive has no state to hide and the archived conversation is therefore listed.
The claim that DOES hold byte-for-byte is about the row that carries the slot:

```
# a 690x60 CSS-px band around the `Invoice reconciliation` row, at the same
# offset in both frames
sips -c 60 690 --cropOffset 1590 430 /tmp/archive-frames-dark/at-rest.png --out /tmp/d.png
sips -c 60 690 --cropOffset 1590 430 /tmp/archive-frames-withdrawn/at-rest.png --out /tmp/w.png
cmp /tmp/d.png /tmp/w.png && echo identical     # -> identical
```

So: the slot shortens the box the title may grow into, and changes no pixel of
what the row draws at rest.

## What is stubbed, and what is still owed

- **Stubbed:** the daemon. Nothing here proves that `sessions.archive` stores
  anything, that the search route filters by `include_archived`, or that the
  delete route refuses a live session — the stand-in answers the contract, and
  the store tests in `scripts/session-archive-delete.test.mjs` bind the client's
  half of those rules.
- **Owed to QA against the real daemon:** the same six states end to end, the
  live-session 409 through the dialog, and the archive→search→unarchive round
  trip. The sibling backend pull request is the prerequisite.
- **Not photographed:** the pin control beside the archive control — the pin
  branch (`feat/chat-sidebar-pins`) is not on this branch's base, so `row-hover`
  shows one reserved `size-6` slot where the merged feature will show two. The
  archive slot is the second of the pair and is built to compose with it.
- **The stand-in advertises the seven `REQUIRED_BACKEND_FEATURES` keys** and
  answers the claim handshake, so the compatibility and attachment banners do not
  cover the surfaces these frames are of. That is a property of the stand-in, not
  of the app.
