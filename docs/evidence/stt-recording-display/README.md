# The recording display, before and after

The recording state's whole visual, photographed in the composer it lives in:
two frames per half — the composer empty, and the composer holding a draft —
so the pair reads as one variable changed (the component) against one input
(a speech-shaped WAV the rig plays into a page-side synthetic microphone).

- `before/empty-field/`, `before/with-draft/` — the strip as shipped, on
  `origin/main` = `49491865ca` (this branch's base), captured before any
  source edit.
- `after/empty-field/`, `after/with-draft/` — the redesigned lane, on this
  branch's tree.
- `before/stt-proof.json`, `after/stt-proof.json` — each run's own record
  (claims, geometry, engage timings). Both halves: zero failed claims.

## How captured

```
LO_PROOF_CAPTURE_ONLY=1 LO_PROOF_AUDIO_FILE=<speech.wav> \
  node scripts/stt-dictation-proof.mjs <out-dir>
```

against the app BUILT from the half's tree (`pnpm build`), in
`--window-mode=headless`, with the app's own isolated backend (scratch config
root, `tool_approval_mode: auto`) plus the rig's fake Radient upstream and its
recording proxy. `LO_PROOF_CAPTURE_ONLY` runs session A and the recording-
display leg (session G) and stops — sessions B–F are the `stt-dictation`
set's evidence, not this set's.

- One take per frame, held ~8.5 s before the shutter — the lane is a 120-bar
  ring buffer of roughly 8 s, so a frame carries the take's whole history —
  then Esc-cancelled; the cancel is what leaves the draft in place in the
  `with-draft` half.
- The input WAV: `scripts/stt-recording-display-audio.mjs <out.wav>` writes it
  (a 2 s loop — one 0.8 s phrase at speech level, a gap, one 0.8 s phrase at
  roughly a quarter of that level, a gap). The rig plays it through a
  `MediaStreamAudioDestinationNode` and answers `getUserMedia` with that
  stream (`installSyntheticMicrophone`); the same construction in both halves.
- The brand dark theme, as the `stt-dictation` set: the surface spends existing
  roles only (`text-accent`, `text-ink-dim`, `bg-accent`, `border-accent`), so
  no theme-specific branch exists to photograph — `check-themes` and the
  contrast contract own the other eleven.
- A note for whoever re-runs this: Chromium's
  `--use-file-for-fake-audio-capture` delivers silence under Electron 44.3.0
  (measured), which is why the rig builds the microphone page-side, and the
  app's CSP allows `blob:` for `media-src` but not `data:`, which is why the
  element's URL is a blob.

## What to look at

1. THE SPAN. `stt-proof.json` geometry, the same record in all four frames:
   before `lane {x: 526, w: 112, h: 24}` inside a 778 px row — the waveform
   ends at x=638, most of the row past it empty; after `lane {x: 431, w: 778,
   h: 36}` — the field's own content width, the composer's measure.
2. THE PEAKS. One input, two renders: before, the frequency-bin average draws
   a short dim cluster a few pixels tall; after, the normalized time-domain
   RMS draws bars that use the lane's height and keep the input's structure —
   loud phrase, quieter phrase, gaps — legible across the frame.
3. THE KEYS. `Enter confirms · Esc cancels` lives in the field's placeholder
   in the before half, so the `with-draft` frame loses it the moment the draft
   exists; after, it is its own row beside the `Recording` label and survives
   both states.
4. THE FOOTPRINT. The composer grows only while recording: 110 px idle,
   150 px recording before, 194 px after (the label row over the lane);
   nothing else on the screen moves between the halves.

## The gain pipeline

`scripts/audio-recording-levels.test.mjs` drives the normalization as a pure
reducer: quiet speech renders visibly, a full-scale input tops out below the
lane's ceiling by construction, dynamics stay legible between a quiet and a
loud passage, silence sits at the floor, and quiet speech recovers after a
loud passage within the strip's ~8 s window.
