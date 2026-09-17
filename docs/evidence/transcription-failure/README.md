# The sentence a failed dictation shows

Six frames of the toast a person reads when a dictation is refused, rendered by
the app's own Storybook (`src/renderer/src/features/chat/components/
transcription-failure.stories.tsx`) and captured through the operator's browser.
They exist because the copy is the change: both transcription call sites used to
answer every failure with one literal, "Error transcribing audio. Please try
again.", whatever the server had said.

```
before-generic.png                 Error transcribing audio. Please try again.
after-provider-out-of-credits.png  Dictation failed: the OpenAI account behind dictation is out of credits. Top it up at platform.openai.com/account/billing, then try again.
after-radient-credits.png          Dictation failed: you're out of Radient credits. Get more credits, then try dictating again.
after-sign-in-refused.png          Dictation failed: your Radient sign-in was refused. Sign in to Radient again, then try again.
after-server-message-clipped.png   Dictation failed: The audio could not be decoded: unsupported codec 'opus' in a webm container… Try again, or report it with the console detail.
after-no-reason-given.png          Dictation failed, and the server gave no reason. Try again, or report it with the console detail.
```

`before-generic.png` and `after-provider-out-of-credits.png` are the pair: the
**same** relay answer (the operator's own `insufficient_quota` body, drawn above
the toast in every frame) under the copy this branch replaced and the copy it
ships. The other four are the rest of the mapping's branches.

## What round 1 changed in these frames

Every frame but the before-half was re-captured for the design round's findings,
and the sentences above are what the frames now show:

- **D1** — the provider sentence names the account as one *behind* dictation
  rather than as the reader's own, and keeps the destination the relayed body
  actually gave (`platform.openai.com/account/billing`) instead of "add credits
  to it". A destination too long for the toast is not named at all: the
  account-neutral sentence is better than half a URL.
- **D2** — the fallback reads the reason out of the JSON body the relay forwarded
  (stripping its own `POST <url> returned 400` framing), leads with it, and ends
  with an action. It was four lines of URL and JSON punctuation clipped mid-phrase
  with no next step; it is three lines whose first clause is the answer.
- **D3** — the credits sentence uses the words the app's own low-credits surface
  already uses ("Get more credits") instead of a third phrasing.
- **D4** — the sign-in sentence is in the reader's terms ("your Radient sign-in
  was refused") rather than the product describing itself from the outside.
- **D6/D7** — every sentence opens with the feature's own name, **Dictation**, and
  the no-reason case states the absence instead of repeating "try again" as the
  whole advice.

`before-generic.png` is re-captured too, from the same rig in the same pass, so
the pair the design round reads is one photograph of one build: the before-half's
copy did not change (it is the override the story pins), and its toast is the same
one line in the same place.

**The viewport sentence in this README's previous revision was wrong, and the
pixels here say so.** It claimed 1024x576 CSS at `devicePixelRatio` 2.5. The
committed frames' own geometry refutes that: the story's `mx-auto max-w-2xl` block
(672 CSS px) starts at 610 device px in them, which is `(1280 - 672) / 2 * 2` and
not `(1024 - 672) / 2 * 2.5`, and a toast at Sonner's default 356 CSS px width
lands at 710 device px in them - so those frames are a **1280x720** CSS viewport
at **DPR 2**, and this round re-shot them on it. What the numbers change: the
earlier round's per-line arithmetic ("284.8 CSS px wide", "≈50 characters a
line") described the *toast at 2.5x*, not the toast; the rendered line count in
every frame is unchanged.

## The command

```sh
node_modules/.bin/storybook dev -p 6123          # `pnpm storybook`, on a port of your own
# then, per story, in a browser at 1280x720 CSS:
#   http://localhost:6123/iframe.html?id=chat-dictation-failures--<story>&viewMode=story
```

`chat-dictation-failures--before-generic`, `--provider-out-of-credits`,
`--radient-credits`, `--sign-in-refused`, `--server-message-clipped` and
`--no-reason-given`. Storybook 8.6.12 for `@storybook/react-vite`. The frames are
PNG, 2560x1440 pixels for a **1280x720** CSS viewport (`devicePixelRatio` 2).
They were re-shot over raw CDP with a private headless Chrome, the container
setting `Emulation.setDeviceMetricsOverride` to those three numbers, so the frame
is a function of the command rather than of whichever browser happened to be open
(see the note above the changed-frames list for why the viewport is 1280x720
rather than the 1024x576 an earlier revision of this file claimed).

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
