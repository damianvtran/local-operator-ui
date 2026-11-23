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
| 5 | The rig is playing it: block "Speaking" (no control) | `--speaking` | wide |
| 6 | Spoken: block "Spoken aloud" + Replay; strip keeps the summary, Replay left of Pause | `--spoken` / `--narrow-spoken` | wide, narrow |
| 7 | Frame 6 with History open: Voice line = the summary + "Full reply in chat ↑" + Replay | `--spoken-history-open` / `--narrow-spoken-history-open` | wide, narrow |
| 8 | Interrupted (barge-in): "Spoken aloud · stopped early" | `--stopped` | wide |
| 9 | Speaker muted: "Not spoken (muted)" + Play | `--muted` | wide |
| 10 | Fallback, no summary: no block; footnote "Spoken aloud: first part only" + Replay under the reply; strip "Cut short · rest above ↑"; History = the whole reply (as #2065) | `--fallback-history-open` / `--narrow-fallback-history-open` | wide, narrow |
| 11 | Summary longer than the cap: "Spoken aloud · first part only", chip, History row cut note | `--cut-history-open` / `--narrow-cut-history-open` | wide, narrow |
| 13 | Voice off, older voiced turn: "Spoken summary", no Replay, no strip | `--static-voice-off` / `--narrow-static` | wide, narrow |

Frames 4a, 6, 7, 10, 11 exist in light and dark, wide and narrow (20 files); 5, 8, 9 are wide light and dark; 13 is all
four. 30 files.

Reproduce (Storybook booted and reaped by the helper; the capture script is a private headless Chrome over CDP, one
instance for the whole run, `Emulation.setDeviceMetricsOverride` to the viewport, a clip to the story's own box):

```sh
node scripts/with-storybook.mjs -- <capture command>   # then open $STORYBOOK_ORIGIN/iframe.html?id=<story>&viewMode=story&args=theme:localOperatorLight
```

Not measured here: contrast of `text-ink-dim` at `text-meta` on `bg-sunken` (the block label and the footnote reuse the
tokens History's labels already used).
