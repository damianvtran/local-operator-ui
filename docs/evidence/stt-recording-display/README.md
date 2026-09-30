# The recording display, before and after

The recording state's whole visual, photographed in the composer it lives in:
the composer empty and the composer holding a draft, on both sides of the
change, plus one narrow-width frame - so the pair reads as one variable
changed (the component) against one input (a speech-shaped WAV the rig plays
into a page-side synthetic microphone).

- `before/empty-field/`, `before/with-draft/` - the strip as shipped, with
  `src/` at `origin/main` = `49491865ca` (this branch's base).
- `after/empty-field/`, `after/with-draft/` - the redesigned lane on this
  branch's tree (`f1cbaf469b`, the round-1 fold).
- `after/narrow-empty-field/` - the same state in an 800 px window: the run
  asked for `LO_PROOF_WIDTH=760` and the app clamps to its `WINDOW_MIN_WIDTH`
  floor of 800, which it logs (design review round 1, D4; reviewer round 2, M1).
- `before/stt-proof.json`, `after/stt-proof.json`, `after/stt-proof-narrow.json`
  - each run's own record (claims, geometry, engage timings, viewport). Every
  run: zero failed claims.

## How captured

```
LO_PROOF_CAPTURE_ONLY=1 LO_PROOF_AUDIO_FILE=<speech.wav> \
  node scripts/stt-dictation-proof.mjs <out-dir>
```

(and `LO_PROOF_WIDTH=760` for the narrow frame, which the app clamps to its
800 px floor) against the app BUILT from
the half's tree (`pnpm build`), in `--window-mode=headless`, with the app's
own isolated backend (scratch config root, `tool_approval_mode: auto`) plus
the rig's fake Radient upstream and its recording proxy. `LO_PROOF_CAPTURE_ONLY`
runs session A and the recording-display leg (session G) and stops - sessions
B-F are the `stt-dictation` set's evidence, not this set's.

- One take per frame, held ~8.5 s before the shutter - the lane is a 120-bar
  ring buffer of roughly 8 s, so a frame carries the take's whole history -
  then Esc-cancelled; the cancel is what leaves the draft in place in the
  `with-draft` half.
- The input WAV: `scripts/stt-recording-display-audio.mjs <out.wav>` writes it
  (a 2 s loop - one 0.8 s phrase at speech level, a gap, one 0.8 s phrase at
  roughly a quarter of that level, a gap). The rig feeds it through a
  `MediaStreamAudioDestinationNode` and answers `getUserMedia` with that
  stream (`installSyntheticMicrophone`); the same construction in both halves.
- **Both halves were re-captured at round 1 with the same rig revision.** The
  rig's microphone now decodes the WAV into an `AudioBufferSourceNode` feeding
  the destination node instead of looping an `<audio>` element: with the
  element route, on a renderer that cannot open an output device,
  `element.play()` never settles - three consecutive capture runs failed with
  zero flips behind exactly that, the app's first `getUserMedia` never
  resolving behind it. A destination node needs no output device (the samples
  go to the stream, not to the speakers), and the WAV bytes are the same ones
  the element played.
- The brand dark theme, as the `stt-dictation` set: the surface spends existing
  roles only (`text-accent`, `text-ink-dim`, `bg-accent`, `border-accent`), so
  no theme-specific branch exists to photograph - `check-themes` and the
  contrast contract own the other eleven.
- A note for whoever re-runs this: Chromium's
  `--use-file-for-fake-audio-capture` delivers silence under Electron 44.3.0
  (measured), which is why the rig builds the microphone page-side.

## What to look at

1. THE SPAN. `stt-proof.json` geometry: before `lane {x: 526, w: 112, h: 24}`
   inside a 778 px row - the waveform ends at x=638, most of the row past it
   empty; after `lane {x: 439, w: 762, h: 36}` - the field's own content
   column (`px-2` in, the draft text's inset), the composer's measure.
2. THE PEAKS. One input, two renders: before, the frequency-bin average draws
   a short dim cluster a few pixels tall; after, the normalized time-domain
   RMS draws bars that use the lane's height and keep the input's structure -
   loud phrase, quieter phrase, gaps - legible across the frame.
3. THE KEYS. Before, the sentence lives only in the field's placeholder, so it
   dies the moment a draft exists. After, it is a row beside the `Recording`
   label - `Enter`/`Esc` as `KeyboardShortcut` caps - and the placeholder no
   longer names the keys at all, so neither state repeats or loses them
   (agent/design/UX round 1, F1/D1/U1).
4. THE FOOTPRINT. The composer grows only while recording: 110 px idle,
   150 px recording before, 194 px after; nothing else on the screen moves
   between the halves.
5. NOT COVERED HERE. The inline-edit surface mounts the same component into
   its own box; the label row is the shared surface, and that consumer is not
   photographed by this set. The narrow frame sits at the app's 800 px floor
   (the requested 760 is clamped), so nothing smaller is reachable through a
   normal window.

## The gain pipeline

`scripts/audio-recording-levels.test.mjs` drives the normalization as a pure
reducer: quiet speech renders visibly and settles in its quiet band, a
full-scale input settles inside the headroom band, dynamics stay legible
between a quiet and a loud passage, silence sits at the floor, and quiet
speech recovers after a loud passage within the strip's ~8 s window.
