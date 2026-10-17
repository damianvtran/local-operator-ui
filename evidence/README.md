# Frames for local-operator-ui#1150

Re-captured at branch head 9a525b027 with the repository's own rig, narrowed to the
composer's secret-ask stories, in both `localOperator` palettes:

    node scripts/capture-evidence.mjs http://localhost:6017 \
      --only=secret-ask --themes=localOperatorDark,localOperatorLight --allow-backend

Headless, one browser, scratch profile under the session's scratchpad, reaped by pid.

- `queued-secret-ask-{dark,light}.webp` - the queued secret ask at rest: box usable, the
  standing sentence and **Open asks** above it.
- `secret-ask-confirm-{dark,light}.webp` - a password-shaped send: the inline confirm
  with the character count, **Put in secret field** focused. The light frame is the one
  design round 2 asked for (D10).
- `secret-ask-sending-{dark,light}.webp` - a Put in flight: all three controls disabled,
  "Sending to the secret field…", the count keeping its place, and the row holding the
  keyboard (the ring is the fieldset's, so Escape is still the lane's).
- `secret-ask-refused-{dark,light}.webp` - a refused Put: the outcome sentence under the
  standing notice, the text kept.
- `secret-ask-multi-{dark,light}.webp` - a value that names no field: the primary reads
  **Open asks panel**.

The blocking-gate frame from the previous capture is not re-shot: that state did not move
in this round.
