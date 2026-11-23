# Spoken summary: block, strip and History

Real renders of the shipped `CanonicalTranscript` row (the agent's reply ending in a `Spoken:` paragraph) above the
shipped `MessageInput` voice band, from the `Voice/Spoken summary` Storybook stories added in this change
(`src/renderer/src/features/voice/spoken-summary.stories.tsx`). The store is seeded through its own actions
(`noteTake`, `setLastSpoken`, `notePlayback`), the calls the controller makes. Same reply in every frame (table,
bullets, a closing paragraph); the summary is the design brief's sample.

File name: `<frame>-<state>-<theme>-<width>.png`. Theme `light` = `localOperatorLight`, `dark` = `localOperatorDark`;
`wide` = 900 px chat column (1000 px viewport), `narrow` = 393 px column (460 px viewport, compact dock).

| Frame | State | Story id | Widths |
|---|---|---|---|
| 4a | `Spoken:` paragraph still streaming: block "To be spoken", no raw label, strip "Working" | `voice-spoken-summary--upcoming` / `--narrow-upcoming` | wide, narrow |
| 5 | The rig is playing it: block "Speaking"; Replay stays drawn but dimmed and `aria-disabled` (keeps a keyboard press's focus); the strip's Replay waits the same way | `--speaking` | wide |
| 6 | Spoken: block "Spoken aloud" + Replay; strip keeps the summary, Replay left of Pause | `--spoken` / `--narrow-spoken` | wide, narrow |
| 7 | Frame 6 with History open: Voice line = the summary + "Full reply in chat ↑" + Replay | `--spoken-history-open` / `--narrow-spoken-history-open` | wide, narrow |
| 8 | Interrupted (barge-in): "Spoken aloud · stopped early" | `--stopped` | wide |
| 9 | Speaker muted: "Not spoken (muted)" + Play in the block; the strip's button reads Play too (one rule for every Replay) | `--muted` | wide |
| 10 | Fallback, no summary: no block; footnote "Spoken aloud: first part only" with its Replay beside it under the reply; strip "Cut short · rest above ↑"; History = the whole reply (as #2065) | `--fallback-history-open` / `--narrow-fallback-history-open` | wide, narrow |
| 11 | Summary longer than the cap: "Spoken aloud · first part only", chip, History row cut note | `--cut-history-open` / `--narrow-cut-history-open` | wide, narrow |
| 13 | Voice off, older voiced turn: "Spoken summary", no Replay, no strip | `--static-voice-off` / `--narrow-static` | wide, narrow |
| 14 | Frame 6 with the pointer over the message: the per-message Copy / Speak aloud / Fork row under the block (Speak still reads the whole reply) | `--spoken` | wide (hover) |
| 15 | Keyboard focus ring (`:focus-visible` true, a Tab key event first) on the block's Replay (`15-focus-block-replay-*`) and on History's "Full reply in chat ↑" link (`15-focus-history-link-*`) | `--spoken`, `--spoken-history-open` | wide |
| 16 | A reply that ends in a code block, then the block | `--spoken-after-code-block` | wide |
| 17 | Right to left (`ur`): the block's Replay on the trailing (left) edge, and the fallback footnote with its Replay beside the note | `--spoken` / `--fallback-history-open`, `?args=theme:<theme>;locale:ur` | wide |

Frames 4a, 6, 7, 10, 11 exist in light and dark, wide and narrow (20 files); 5, 8, 9, 14, 16 are wide light and dark;
13 is all four; 15 is two frames and 17 two frames, each light and dark; 7 also has two narrow light frames in `vi` and `fr`
(Q-5, below). 44 files. Every frame was re-rendered from
the head that carries the round-1 fixes (the 30 first-round frames included), by one script, so none is a stale frame.

### The narrow strip (design D3), measured

At 393 px the strip row is full (status chip, cut chip, caption, Replay, Pause, Silence, History). The Replay icon is the
only item this change added to that row, so hiding it renders the #2065 layout. With it shown, the cut chip's text box was
**36 px ("Cut ...")**; hidden, **76 px** (and "Cut short ·" is still clipped: that truncation is #2065's, the chip is
the one that gives by design). The summary caption box was 60 px with it and 100 px without, and the caption truncates in
both. Fix: at the narrow dock, while a cut chip is up, the strip does not draw its own Replay (the block or footnote under
the message carries one, and the chip points at it): chip back to 76 px. The `Said: Us...` caption stays truncated by design.

### The narrow History row in long locales (QA round 2, Q-5), measured

`SummaryRowControls` (the link and Replay in a History summary row) was one nowrap flex row. At the 393 px dock the
`vi` link ("Câu trả lời đầy đủ trong cuộc trò chuyện ↑") is 244.9 px wide, which pushed Replay past the History's edge.
Fix: the row is `flex-wrap` (the link stays whole, Replay drops under it when it does not fit).

Measured in real Chrome (460 px viewport, 393 px column, `localOperatorLight`, story
`voice-spoken-summary--narrow-spoken-history-open&args=theme:localOperatorLight;locale:<loc>`), the same script before
(class reverted) and after:

| Locale | Before: History scrollWidth / clientWidth, Replay right edge vs History edge (383) | After |
|---|---|---|
| vi | 344 / 325, 401.7 (18.7 px past) | 325 / 325, Replay wraps under the link, 152.8 |
| fr | 325 / 325, 372.5 (fits) | 325 / 325, 372.5 (still one line) |
| en, ru, es, hi, zh-CN | 325 / 325, fits | unchanged |
| ur (RTL) | 325 / 325, fits | unchanged |

`vi` reproduces QA's numbers (Replay 377.7 to 401.7). `fr` did NOT overflow in this rig (10.5 px of room), so QA's +5 px
on `fr` is not reproduced here (a different font fallback is the likely difference); the wrap covers it either way.
`7-spoken-history-vi-light-narrow.png` is the wrapped row; `7-spoken-history-fr-light-narrow.png` is `fr` on one line.
The committed `en` narrow frames (7 and 11, light and dark) were re-rendered at this head and differ from the committed
files only by text anti-aliasing (max channel difference 79 on 13 px above 40 of 468,740 in frame 7 light; no layout box
moved: same height 1019, English does not wrap), so they are kept. The same check runs as the story's `play`
(`NarrowSpokenHistoryOpen`: History `scrollWidth <= clientWidth` and both controls inside its right edge), in whichever
locale the URL pins. Run in Storybook over CDP: no play error in en, vi, fr, ru, es, ur, hi, zh-CN at this head; with the
class reverted, `vi` logs `AssertionError: expected false to be true` from `expectNoHistoryOverflow`.

### Right to left (Q-1, D2)

Frame 17: in `ur` the block's Replay moved to the trailing edge (logical `ms-auto`; it was `ml-auto` and sat against the
label) and the footnote's Replay sits next to its note in both directions (it no longer carries an auto margin).

Not seen in a still: the order of states on a press (Speaking, then Spoken aloud only after playback starts) and a refused
speak. They are pinned by `scripts/voice-composer.test.mjs` ("U2: ..."), which drives the real controller with a scripted
rig; the stories seed a state, they do not run a take.

Reproduce (Storybook booted and reaped by the helper; the capture script is a private headless Chrome over CDP, one
instance for the whole run, `Emulation.setDeviceMetricsOverride` to the viewport, a clip to the story's own box):

```sh
node scripts/with-storybook.mjs -- <capture command>   # then open $STORYBOOK_ORIGIN/iframe.html?id=<story>&viewMode=story&args=theme:localOperatorLight
```

Not measured here: contrast of `text-ink-dim` at `text-meta` on `bg-sunken` (the block label and the footnote reuse the
tokens History's labels already used).
