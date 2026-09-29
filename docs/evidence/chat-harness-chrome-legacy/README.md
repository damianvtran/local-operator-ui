# Legacy goal-continuation rows: the pre-marker chrome, hidden on both transcript arms

The fix half of the pair [`../chat-harness-chrome-legacy-before/`](../chat-harness-chrome-legacy-before/).
The operator reported (2026-09-29) that goal-continuation messages
(`Continue working toward this goal: ...`) appeared as visible USER messages in
transcripts. The desktop already hid rows the harness stamps
(`provider_payload.harness_injected`), but a row written before that stamp
existed - and one still sent by an owner on an older build - carries no marker
to read, so it painted as the person's own words.

The fix: `src/renderer/src/features/chat/canonical/harness-chrome.ts` mirrors
core's own recogniser for the two goal families
(`local_operator/harness/rows.py::is_harness_chrome`, over
`session/goal_judge.py`'s continuation and `session/goal_loop.py`'s working
turn and fixed prompt), and `transcript-reducer.ts` applies it as a fallback -
only where the marker said no, on both the durable and the live arms. The
marker stays primary; core's contract keeps both halves ("the marker (and the
recogniser) remain the contract", `docs/DESKTOP_API.md`).

## The frames

```
stored-transcript/   2   the operator's case, the turn opened the way a reader reaches it
live-arrival/        2   the same unstamped row arriving live (`message_start`, no marker)
typed-near-miss/     2   the control: the PERSON's own words - head but no tail - paints in both halves
```

Each directory holds the two brand palettes (`localOperatorDark.webp`,
`localOperatorLight.webp`). The states are the production `CanonicalTranscript`
reading the production reducer (`applyHistoryPage` / `applyEvent`) over
`scripts/fixtures/harness-chrome-legacy.json`, via
`src/renderer/src/features/chat/canonical/harness-chrome-legacy.stories.tsx` -
no hand-set record.

## What moved

`magick compare -metric AE` of each pair, of 1,024,000 pixels (the viewport is
1280x800):

| state             | dark    | light   |
|-------------------|---------|---------|
| stored-transcript | 108,465 | 103,720 |
| live-arrival      | 97,092  | 94,757  |
| typed-near-miss   | 0       | 0       |

The control is the pair's closest on purpose: byte-identical (`md5` equal, AE 0
in both palettes) across the halves, which is what a message the person typed
must be.

## How these were captured

```sh
# this tree, at the fix commit
node_modules/.bin/storybook dev -p 6214 --host 127.0.0.1 --ci --no-open
node scripts/capture-evidence.mjs http://127.0.0.1:6214 \
  --only=chat-harness-chrome-legacy \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
```

The before half is [`../chat-harness-chrome-legacy-before/`](../chat-harness-chrome-legacy-before/),
which carries the throwaway-checkout recipe in its own README;
`docs/evidence/manifest.json` declares it as a supplementary set with its own
`source` and `capturedAtHead`, and `captureOrigin.harnessChromeLegacyPass`
records both runs.
