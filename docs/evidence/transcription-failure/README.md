# The sentence a failed dictation shows

Six frames of the toast a person reads when a dictation is refused, rendered by
the app's own Storybook (`src/renderer/src/features/chat/components/
transcription-failure.stories.tsx`) and captured through the operator's browser.
They exist because the copy is the change: both transcription call sites used to
answer every failure with one literal, "Error transcribing audio. Please try
again.", whatever the server had said.

```
before-generic.png                 Error transcribing audio. Please try again.
after-provider-out-of-credits.png  Transcription failed: the OpenAI account is out of credits. Add credits to it, then try again.
after-radient-credits.png          Transcription failed: you're out of Radient credits. Add credits to continue.
after-sign-in-refused.png          Transcription failed: the server refused this app's sign-in. Sign in to Radient again, then try again.
after-server-message-clipped.png   Transcription failed: POST https://… returned 400 {"error":{"message":"The audio could not be decoded: unsupported codec…
after-no-reason-given.png          Transcription failed. Please try again.
```

`before-generic.png` and `after-provider-out-of-credits.png` are the pair: the
**same** relay answer (the operator's own `insufficient_quota` body, drawn above
the toast in every frame) under the copy this branch replaced and the copy it
ships. The other four are the rest of the mapping's branches.

## The command

```sh
node_modules/.bin/storybook dev -p 6107          # `pnpm storybook`, on a port of your own
# then, per story, in the app's browser at 1024x576 CSS:
#   http://localhost:6107/iframe.html?id=chat-dictation-failures--<story>&viewMode=story
```

`chat-dictation-failures--before-generic`, `--provider-out-of-credits`,
`--radient-credits`, `--sign-in-refused`, `--server-message-clipped` and
`--no-reason-given`. Storybook 8.6.12 for `@storybook/react-vite`. The frames are
PNG, 2560x1440 pixels for a **1024x576** CSS viewport (`devicePixelRatio` 2.5),
which is the viewport the capturing browser reports rather than a size this README
chose.

**A frame here is the settled toast, and getting there needed a wake.** In a
background tab — which is how every agent-driven capture runs, since nothing may
raise a window — Chromium does not advance `requestAnimationFrame`, so Sonner's
enter transition freezes at its first frame and the toast photographs as a sliver
below the viewport edge. The DOM holds the sentence the whole time (a selector
read finds it), and one synthetic pointer press on the page resumes rendering and
settles the toast. These frames were taken after that press; a re-capture that
skips it will produce a clipped one.

The story holds its toast with `toastDuration: Number.POSITIVE_INFINITY` for the
frame's lifetime. Production keeps its own 4 s lifetime and its identical-error
cooldown: only the story sets a duration.

## What these frames do NOT show

- **No backend was driven.** The frames are the mapper's output for a relay
  answer, not a live daemon's refusal: the story hands the real
  `transcriptionFailureMessage` a real `TranscriptionRequestError` carrying the
  status and body shown above it. What they establish is the copy; that both call
  sites route through it, and that the relay's own result reaches the mapper with
  its status intact, is asserted in `scripts/transcription-failure-copy.test.mjs`
  (which drives the shipped client against a stubbed media relay).
- **Nothing is claimed about layout, spacing or the toast's arrival.** The
  animation is the thing the wake above overcomes, so these say where the toast
  finally sits, not how it gets there.
- **Light themes, focus rings and carets are absent.** Every frame is the default
  dark theme at rest, and a background tab cannot render `:focus` state.
- **The story is not registered in `scripts/capture-evidence.mjs`'s `STORIES`**,
  so the twelve-theme sweep does not cover it. That list and the manifest's
  `surfaces` count are one claim, and adding a story there owes 12 more frames;
  the story and these PNGs are the coverage this branch ships.
