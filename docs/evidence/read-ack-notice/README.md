# The read receipt's states — frames at the remediation head

**What these are.** Hand-driven renders of the per-row read receipt's copy surface
on PR #484 (`fix/ack-retry-and-apply`), taken through the Storybook rig archived
below (`harness/`) with no window and the server reaped by pid. They are PNG rather
than WebP **on purpose**: `check-evidence.mjs`'s frame walker counts `.webp` only,
so a hand-driven set cannot be mistaken for frames a sweep produced and the
capturer's own figures stay untouched. This repository's contact sheets set the same
precedent.

**Read the third column first.** Only ONE frame in this set has a *drawn* change;
the rest are evidence of the DOM the panel ships and are labelled as such rather
than left to imply a picture (design round 2, D8):

| frame | state | what it shows |
| --- | --- | --- |
| `after/baseline.png` | no notice | **drawn**: the row with nothing said — status line `Completed, unread`, no clause, no description |
| `after/unsettled-flyout.png` | `unsettled`, pressed | **drawn**: the row's FLYOUT open, `Completed, unread · click the chat to try again`, with the readout's `flyout box: 256x62` and status span `238x35 (~2 lines)` (design round 1, D2 and D5). **Shot one head earlier** (the clause and the geometry are unchanged by the round that carries this file; the readout line in it still shows the silent remedy without the full stop D9 added). |
| `after/pending.png` | `pending` | **DOM readout**: the notice, and the row's description as the DOM has it (`Marking this chat read.`). No flyout pixel — the tooltip opens on hover in this rig and a click in it focuses the row without painting the box. |
| `after/offscreen.png` | `offscreen` | **DOM readout**: description `Scroll to the result to mark this chat read.` Same no-pixel caveat as above. |
| `after/unsettled.png` | `unsettled` | **DOM readout**: `notice: unsettled`, the deferred row's description, and the silent row's clause now carrying its own full stop (`/stop if it stays silent.`). |
| `after/silent-and-receipt.png` | `unsettled` on a row that is also silent | **DOM readout**: the composed description, `/stop if it stays silent. Not marked read. Click the chat to try again.` — two sentences, neither running into the other (design round 1 D4, design round 2 D9; 2 px of anti-aliasing differ in the panel, no drawn change) |
| `after/toast-busy.png` | the give-up arm's contention refusal | **DOM readout**: `toaster=3 toasts=3` and the lane's three copies of **the composed sentence for this arm** — `The read state is busy, so the unread mark was not cleared. Click the chat to try again.` — beside `warningCalls=2 dismissCalls=3` and the measured box (`box=0x0@0,0 mounted=true op=1 vis=visible disp=none`) |
| `after/toast-full-volume.png` | the same arm for a store refusal | **DOM readout**: the sentence for the other store arm, `The read state could not be written, …`, in the lane |
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

**THE TOAST'S BOX IS STILL NOT IN THIS SET, AND THE REASON IS MEASURED RATHER THAN
ASSERTED.** The round that added the first version of this set said the lane painted
nothing; that was wrong, and the design round was right to reject it. Corrected, the
sequence is: sonner DOES receive the request and DOES render it once the build
resolves one copy of the package (the round-2 harness had two, which is why a probe
found no toaster; `harness/main.ts` now pins `resolve.dedupe` and
`optimizeDeps.include`), and the copies it renders inside this panel's own lane are
hidden — `styles/index.css` declares
`nav[aria-label="Chats"] [data-sonner-toaster] [data-sonner-toast]:not(.lo-archive-toast) { display: none; }`,
which is the rule that keeps a receipt's message out of the archive lane, and the
probe measures exactly that (`disp=none`). What no capture here shows is a painted
box anywhere: the rig mounts three containers at the same position, the copies that
are not under the nav are the ones that would paint, and they did not in any frame
of this set. So the sentence's **rendered height at this wording remains unverified
by a frame**; for the previous wording the design round measured **360x66 CSS px
over two lines** for both store arms. A rig that hovers (or an app-side capture) is
what that picture needs, and the next round should not re-read this paragraph as
either "the library failed" or "the box is fine".

## How they were produced

`harness/` holds the whole rig, archived beside the frames as this repository's
other evidence sets archive theirs:

- `main.ts` — a Storybook config whose `stories` glob points at this directory, so
  no story was added to the repository for one round's frames, plus the one-sonner
  pins described above;
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
