# The read receipt's states — frames after the remediation round

**What these are.** Hand-driven renders of the per-row read receipt's copy surface
at the remediation head of PR #484 (`fix/ack-retry-and-apply`), taken to answer
design round 1's findings by looking at the drawing rather than arguing about it.
They are PNG rather than WebP **on purpose**: `check-evidence.mjs`'s frame walker
counts `.webp` only, so a hand-driven set like this cannot be mistaken for frames a
sweep produced, and the numbers beside them (`frames`, `surfaces`) stay what the
capturer last wrote. The repository's own contact sheets set the same precedent.

| frame | state | what it shows |
| --- | --- | --- |
| `after/baseline.png` | no notice | the row with nothing said: status line `Completed, unread`, no clause, no description |
| `after/pending.png` | `pending` | the flyout clause ` · marking read`, and the description sentence `Marking this chat read.` |
| `after/offscreen.png` | `offscreen` | ` · scroll to the result to mark this chat read` (the move a press cannot make), description in sentence form |
| `after/unsettled.png` | `unsettled` | the give-up state with the row's clause and its description as the DOM has them |
| `after/unsettled-flyout.png` | `unsettled`, pressed | the flyout OPEN: `Completed, unread · click the chat to try again` (design D2 — the remedy only), and the geometry readout `flyout box: 256x62`, status span `238x35 (~2 lines)` (design D5) |
| `after/silent-and-receipt.png` | `unsettled` on a row that is also silent | the composed accessible description: `/stop if it stays silent Not marked read. Click the chat to try again.` (design D4 — two clauses, each a sentence of its own) |

Each frame also carries the harness's own readouts: the notice the store holds, the
row's accessible description as the DOM has it, the flyout's box, and a live probe
line (see below).

## What these frames prove, and what they do not

They prove **the drawing**: the words, their position in the flyout and in the
description, the wrapping and the box, and the two channels' separation.

They do **not** prove the **publishing** — which state the loop chooses and when.
That loop lives in the transcript and needs a live backend refusing `/seen`; the
states here were published by the harness through the store's own action
(`publishReadAckNotice`, the one the loop calls), on the shipped `ChatSidebar` and
the shipped store.

**The give-up toast is NOT in these frames, and that is a gap rather than a
result.** The panel asks the lane to speak — the probe line in every frame above
records the request and its sentence, e.g. `warningCalls=1
last="The unread mark was not cleared. Click the chat to try again."` — and sonner
painted **no toaster at all** in this harness (`toaster=0`, `sonner toast
elements: 0`), so there is nothing to photograph. Sonner renders its toaster only
while its own toast list is non-empty (`if (!toasts.length) return null`), so a
request that reaches the store the panel writes and no element in the DOM is a
resolved-module or subscription difference in this rig, not a product behaviour:
the same request paints in `scripts/mark-all-read-control.test.mjs`'s jsdom
harness, where the composed sentence is asserted off the live lane and this
round's case retires it when the receipt lands. The **rendered height** of the new
sentence in the lane is therefore unverified by a frame, and a design round that
wants that picture should shoot it with a rig whose lane paints.

## How they were produced

`harness/` holds the whole rig, archived beside the frames as this repository's
other evidence sets archive theirs:

- `main.ts` — a Storybook config whose `stories` glob points at this directory, so
  no story was added to the repository for one round's frames;
- `preview.tsx` — the repository's own preview (it mounts the themed toast
  container and reads `parameters.toastDuration`);
- `read-ack.stories.tsx` — a staging story that renders the shipped `ChatSidebar`
  with the shipped store, stubs `window.api.desktop` for the catalogue, and
  publishes each state through the store's own action.

Run it from a **throwaway worktree** at the head (the config is inside the
project then, which is what lets its bare imports resolve):

```sh
git worktree add --detach <scratch>/wt <head>
rm -rf <scratch>/wt/node_modules && ln -s ../../node_modules <scratch>/wt/node_modules
cp -r docs/evidence/read-ack-notice/harness <scratch>/wt/frames-harness
cd <scratch>/wt && pnpm exec storybook dev -c frames-harness -p 6111 --ci   # no window
# drive http://localhost:6111/iframe.html?id=design-review-read-ack-notice--<state>&viewMode=story
# screenshots through the operator's own browser tool, never a windowed launch
```

The story was driven through this harness's `browser` tool (a background tab, no
focus), the server was reaped by pid, and the throwaway worktree removed. Host load
was 60-100 on 14 cores throughout; nothing here is a timing measurement.
