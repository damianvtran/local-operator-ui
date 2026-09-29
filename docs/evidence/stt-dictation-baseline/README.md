# Speech-to-text, the BASELINE capture (`3721eca41e`)

Six frames and a wire record from the SAME rig and the same commands as
`docs/evidence/stt-dictation/`, run against the tree this change starts from
(the worktree at `3721eca41e`, clean). They exist to be the "before" half of
every pair in that directory; nothing here is a defect report of its own.

What they show:

- `05-recording-space/localOperatorDark.webp` - hold Space, outside any editable field: the
  composer's field is GONE and a full-width washed panel (`● Recording`, a
  waveform across the whole box, a border) has replaced it. The record says it
  as data: `sessionA.recordingTreatmentSpace` is
  `{"textarea":false,"draft":null}`.
- `06-transcribing-space/localOperatorDark.webp`, `07-dictated-landed-space/localOperatorDark.webp` - the same
  treatment for transcribing, and the transcript landing afterwards (the field
  comes back with the old text plus the new words, which is the one good
  behaviour this capture also holds).
- `08-mixed-row/localOperatorDark.webp`, `09-typed-row-mid-turn/localOperatorDark.webp` - sends against the live
  backend, for the row comparison.
- `01-idle-draft/localOperatorDark.webp` - the idle field, for the before/after pair.

And the record's own numbers, the ones the AFTER set is measured against:

- hold Right-Option (`AltRight`, the new default): delivered to the page and
  NOTHING engages - no handler exists on this build.
- hold Space: **1810 ms** from the keydown to the recording indicator - the
  1000 ms hold timer plus the first `getUserMedia`.
- the mic across the first ~6 s of a running turn: `disabledCount:54,
  firstEnabledAt:2160` (the admit-to-first-answer window closes it).
- `POST /messages` bodies: no `input_mode` (the field does not exist yet).
- a mid-turn hold: cannot engage (same missing handler), so no steer and no
  dictated-vs-typed row pair exist on this build - the record says so in
  `notes` rather than pretending the steps ran.
