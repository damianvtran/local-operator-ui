# The read receipt's states — frames at the remediation head

**What these are.** Hand-driven renders of the per-row read receipt's copy surface
on PR #484 (`fix/ack-retry-and-apply`), taken through the Storybook rig archived
below (`harness/`) with no window and the server reaped by pid. They are PNG rather
than WebP **on purpose**: `check-evidence.mjs`'s frame walker counts `.webp` only,
so a hand-driven set cannot be mistaken for frames a sweep produced and the
capturer's own figures stay untouched. This repository's contact sheets set the same
precedent.

**Read the third column first.** Two rows are labelled `drawn` — `baseline`, the
reference frame the others are diffed against, and `unsettled-flyout`, the one whose
pixels a change in this pull request moves — and the other seven are evidence of the
DOM the panel ships, labelled as such rather than left to imply a picture (design
rounds 2 and 3, D8 and D15):

| frame | state | what it shows |
| --- | --- | --- |
| `after/baseline.png` | no notice | **drawn**: the row with nothing said — status line `Completed, unread`, no clause, no description |
| `after/unsettled-flyout.png` | `unsettled`, pressed | **drawn**: the row's FLYOUT open, `Completed, unread · click the chat to try again`, with the readout's `flyout box: 256x62` and status span `238x35 (~2 lines)` (design round 1, D2 and D5). **Shot one head earlier** (the clause and the geometry are unchanged by the round that carries this file; the readout line in it still shows the silent remedy without the full stop D9 added). |
| `after/pending.png` | `pending` | **DOM readout**: the notice, and the row's description as the DOM has it (`Marking this chat read.`). No flyout pixel — the tooltip opens on hover in this rig and a click in it focuses the row without painting the box. |
| `after/offscreen.png` | `offscreen` | **DOM readout**: description `Scroll to the result to mark this chat read.` Same no-pixel caveat as above. |
| `after/unsettled.png` | `unsettled` | **DOM readout**: `notice: unsettled`, the deferred row's description, and the silent row's clause now carrying its own full stop (`/stop if it stays silent.`). |
| `after/silent-and-receipt.png` | `unsettled` on a row that is also silent | **DOM readout**: the composed description, `/stop if it stays silent. Not marked read. Click the chat to try again.` — two sentences, neither running into the other (design round 1 D4, design round 2 D9; 2 px of anti-aliasing differ in the panel, no drawn change) |
| `after/toast-busy.png` | the give-up arm's contention refusal | **DOM readout**: `toaster=3 toasts=3` and the lane's three copies of **the composed sentence for this arm** — `The read state is busy, so the unread mark was not cleared. Click the chat to try again.` — beside `warningCalls=2 dismissCalls=3` and the measured box (`box=0x0@0,0 mounted=true op=1 vis=visible disp=none`) |
| `after/toast-full-volume.png` | the same arm for a store refusal | **DOM readout**: `toaster=3 toasts=3` and the lane's three copies of **this arm's** sentence — `The read state could not be written, so the unread mark was not cleared. Click the chat to try again.` (the probe's `last`, verbatim). Re-shot with the two-press sequence: the frame it replaced recorded `toaster=0` and the CONTENTION sentence, because the second store arm's publish is identity-preserving on the standing `(sessionId, kind)` pair and so raised nothing (design round 3, D12) |
| `after/toast-retired.png` | the sentence retired | **DOM readout**: the same lane after the kind changed — the sentence is gone and the readout's `dismissCalls` has advanced |

Every frame carries the rig's own readouts: the notice the store holds, the row's
accessible description as the DOM has it, and a live probe line with the lane's
counters and the last sentence composed.

## What these frames prove, and what they do not

They prove **the drawing** where the third column says `drawn`, and **the panel's
own DOM and lane requests** everywhere else: the clause the row renders, the
description `aria-describedby` resolves, the sentences composed per class of
refusal, the announce-once-per-budget call, its 10-second lifetime and its
retirement. The states were published through the store's own action
(`publishReadAckNotice`, the one the loop calls), on the shipped `ChatSidebar` and
the shipped store.

They do **not** prove the **publishing** — which arm the loop chooses and when; that
loop lives in the transcript and needs a live backend refusing `/seen`. They also do
not prove any assistive technology's announcement, the toast inside the app's own
Electron window, or eleven of the twelve palettes.

**NO FRAME CARRIES THE `unreachable` CLASS'S SENTENCE.** It is the longest this
pull request ships — `Desktop controls could not reach the backend process. The
unread mark was not cleared. Click the chat to try again.` — and the rig stages four
states (`pending`, `offscreen`, and the two store arms), none of which is it: the
transport's own sentences are raised by a bridge that never answered, an old backend
and the deadline, and the rig's staging readout asks the store for a refusal code
instead. Its words are pinned where they are composed, by the composer case in
`scripts/mark-all-read-control.test.mjs`, and its geometry is pinned by nothing — the
rig cannot paint a card for any arm at all, which is the next paragraph (UX round 4,
U10).

**THE TOAST'S BOX IS STILL NOT IN THIS SET, AND WHAT STOPS IT IS NOW MEASURED.**
The arc is worth recording because two earlier explanations were wrong. The round
that added the first version of this set said the lane painted nothing; the next
replaced that with "the build resolves two copies of sonner", which the design round
refuted by re-running with the whole `optimizeDeps` block removed and reading the
same numbers. What actually holds the card off this rig's frames, measured in the
committed rig at this head:

- sonner DOES receive the request and renders it — the lane's three copies of the
  composed sentence are in the DOM, and the probe prints them verbatim;
- the copies inside this panel's own lane are hidden on purpose —
  `styles/index.css` declares
  `nav[aria-label="Chats"] [data-sonner-toaster] [data-sonner-toast]:not(.lo-archive-toast) { display: none; }`,
  which is the rule that keeps a receipt's message out of the archive lane, and the
  probe measures exactly that (`disp=none`);
- and the two containers outside that nav sit at **`op=0` with a `0x0` `<ol>`** while
  `data-mounted`, `data-visible` and `data-styled` are all true — a container with no
  box, so no capture of this set could have carried a card whatever the timing. Give
  that container the box the app's own lane gives it and the same rig paints the card
  at the bottom-right, which is how the round that measured it read the busy
  sentence's first painted line.

**THE CARD'S HEIGHTS ARE MEASURED, THOUGH NO FRAME SHOWS ONE** (design round 3,
D13) — from the DOM of this rig at this head, at the lane the app gives a positionless
toast (sonner's default 356 px `<ol>`, 324 px of card):

| arm | sentence | card | sonner's own reading |
| --- | --- | --- | --- |
| contention (`store_busy`) | 88 chars | **324x62** — two lines | `--front-toast-height: 62px` |
| store refusal (`store_out_of_space`) | 98 chars | **324x80** — three lines | `--front-toast-height: 80px` |

The 18 px step is one line box, and it is the shape D11 flagged for the flyout one
surface over: at this width the refusal sentence takes a third line that is a lone
`again.` — not seen painted, so it is written here as an inference from the box rather
than as a frame. Round 2's two-line reading was taken on the **previous** wording, so
those two numbers are what replaces it: the card is 62 px and 80 px, and what the rig
needs is a container with a box, not a different library or another pin. The next
round should not re-read this section as either "the library failed" or "the box is
fine".

## How they were produced

`harness/` holds the whole rig, archived beside the frames as this repository's
other evidence sets archive theirs:

- `main.ts` — a Storybook config whose `stories` glob points at this directory, so
  no story was added to the repository for one round's frames, plus the `dedupe`
  and `optimizeDeps.exclude` pins the section above describes;
- `preview.tsx` — the repository's own preview (it mounts the themed toast
  container and reads `parameters.toastDuration`);
- `read-ack.stories.tsx` — a staging story that renders the shipped `ChatSidebar`
  with the shipped store, stubs `window.api.desktop` for the catalogue, publishes
  each state through the store's own action, and prints the live probe line.

Run it from a **throwaway worktree** at the head (the config is inside the project
then, which is what lets its bare imports resolve):

```sh
git worktree add --detach <scratch>/wt <head>
rm -rf <scratch>/wt/node_modules && ln -s ../../node_modules <scratch>/wt/node_modules
cp -r docs/evidence/read-ack-notice/harness <scratch>/wt/frames-harness
cd <scratch>/wt && pnpm exec storybook dev -c frames-harness -p 6171 --ci   # no window
# drive http://localhost:6171/iframe.html?id=design-review-read-ack-notice--<state>&viewMode=story
```

The give-up arm needs **two presses of the rig's own buttons**, in this order: a
`pending` press first (the store's publish is identity-preserving on an unchanged
`(session, kind)` pair, so the kind has to change for the next publish to be a new
event), then the arm under test. Pressing only the arm is a no-op against a story
whose own play has already published it — which is what the design round's "one
press" note means, and what the round before this one got wrong.

Screenshots were taken through this harness's `browser` tool (a background tab, no
focus); the server was reaped by pid and the throwaway worktree removed. Host load
was 30-120 on 14 cores throughout; nothing here is a timing measurement.
