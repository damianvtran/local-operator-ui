# Sound generation — real-artifact release capture attempt

**HOLD: this is not a six-state release-gate pass.** The real widget renders and
plays the real MP3s, but the merged card does not expose the billed/estimated
caption. No substitute cost overlay, mocked widget, or fabricated cancellation
screen was added. The operator has not approved release.

## Source and execution

UI merge `60948819fed2166f50e9452565d79770349a9cc3` (feature head
`25c6bd089f79f5ecef52a692fa04944d7f975223`); harness merge **`ab58506e`** (the
generation whose artifact and duration are shown; the earlier harness pin
`01729374` is what the first capture ran on). Extended the existing
`scripts/run-sounds-scene.mjs`, `sounds-fixture.mjs`, and `sounds-scene.mjs`;
`rig-extension.patch` preserves the exact extension without changing the shipped
product or the existing committed scripts in this evidence-only commit.

These are **isolated transcript replays of real provider artifacts**, not a fresh
Radient call or a claim about the desktop's signed-in account. Exact Radient rows
came from the manager forwarding the server lane. Both local MP3 SHA-256 values
were independently verified here; `audiogen.peaks.compute_peaks` from the merged
harness derived their 240 waveform bars. No signed URL is used or retained.

Run from the UI worktree after applying the extension. `SOUNDS_RELEASE_ASSETS`
is a local JSON array containing request_id/path/duration_s/sha256/title/tool/
peaks/cost_usd (and `bytes`, unused by the fixture) for the two verified MP3s. `SOUNDS_RELEASE_BYOK` is the actual
BYOK result JSON; `SOUNDS_RELEASE_BYOK_STORE` points at its isolated attachment
store. The exact executed scene command was:

```sh
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
SOUNDS_RELEASE_ASSETS="$LOCAL_OPERATOR_SCRATCHPAD/release-assets.json" \
SOUNDS_RELEASE_BYOK="$LOCAL_OPERATOR_SCRATCHPAD/byok-live/result.json" \
SOUNDS_RELEASE_BYOK_STORE="$LOCAL_OPERATOR_SCRATCHPAD/byok-live/config/attachments" \
LOP_SOUNDS_HARNESS="$HOME/local-operator/.worktrees/sound-gen-fixed" \
node scripts/run-sounds-scene.mjs

# That worktree is the merged harness ab58506e; the annotation is a comment on
# its own line because a trailing `#` after a `\` is not a continuation (it is
# an escaped space, and the command then runs with no env at all).
```

Final run: **`sounds-native-Rqp1qi`** (2026-10-20), whose stdout is committed as
`run/rig-stdout.txt` and whose scene log as `run/scene.txt`. Actual output:
history preflight HTTP **200**; expired-URL control HTTP **403**, exactly **1**
control request in total (`requests=1`); **`PASS 7 frames, 7 distinct SHA-256`**;
**`PASS expired URL remains unused by the app: requests=1`**. The rig's own `finally`
reaps every process group it started; the committed stdout is that run's output,
captured by the rig as it ran. The
real app was headless, invisible, and unfocused.
The existing zero-gain graph is armed before any audio element and rejects a
second arm. Nonzero pre-gain audio with zero post-gain RMS is measured. No host
audio, headful app, live session, or notification was used. Dependencies were an
APFS clone of the existing installation, not a fresh dependency install.

Build limitation: normal bytecode build at this merged head fails with
`Unable to transform arrow inside class property` on the browser tab-audio
initializer. Captures use the existing supported plain-JS/npm build switch
`LOCAL_OPERATOR_UI_NO_BYTECODE=true`; they do not validate bytecode packaging.
An existing Babel plugin was linked inside the isolated cloned dependencies to
repair their missing root resolution; the primary installation was untouched.

## Re-capture (2026-10-19, completed 2026-10-20)

Round 1 of review found that two of the seven frames did not show what their
filenames claim: the voiceover idle/playing pair was scrolled to the transcript's
latest turn with no player in view, and `release-earlier-turn-playing.png` was
byte-identical to `release-voiceover-playing.png` — six distinct images, not
seven. **All seven are now re-captured in one run. No product source changed**;
the app tree is still `60948819`, and `rig-recapture.patch` is the rig as run
(self-contained: it includes the release-asset extension of the first run). The
seventh waited on a harness fix (`ab58506e`) because its recording carried a null
duration — see below.

Why the first capture missed the card, and the three rig fixes:

- **Camera.** The scene scrolled to the record and photographed it in the same
  step; the transcript mounts rows as they enter the viewport, so the press that
  followed could re-anchor the scroll before the capture. Each capture now
  scrolls, lets the layout settle, then photographs. The BYOK step scrolls
  *before* it waits for the record to exist — the earlier order waited on an
  element the app had not built yet.
- **Opacity.** Every frame carried an alpha channel (measured 65.5% of pixels at
  alpha 168) because `capturePage()` photographs the window's composited glass.
  The rig now seeds the app's OWN persisted setting — `window-glass.json`,
  version 2, `enabled: false`, the same file its Settings toggle writes — so the
  capture is opaque at the source rather than flattened after the fact. All seven
  re-captured frames are colour type 2 (RGB), like every other live-app set.
- **Playback.** A hidden window is backgrounded: the player reported `playing`
  with `time 0, inputRms 0`, and the "real MP3 advances silently" demand failed
  on one run in three. The rig passes `--disable-renderer-backgrounding` and
  `--disable-background-timer-throttling` and polls the clock, re-pressing only
  when the player is paused. Measured on the accepted run: voiceover
  `time 0.186863, inputRms 0.0808249478757425, gain 0, rms 0`. State 6 is read
  back at `time 1.361138` of `duration 1.578957` with `ownerId sound:b44d1c36…` —
  the **earlier voiceover** is the playing card, and the later turns are visible
  below it.

Distinctness is **asserted by the rig**, not eyeballed: seven frames must hash to
seven SHA-256 values or the run fails. The seven committed PNGs do.

**`release-byok-result.png` is re-captured from a LIVE BYOK generation, not a
replay of the old recording.** The old recording carried `duration_s: null` —
the defect itself — so replaying it could never show a player, and writing the
server's `0.522449 s` into a recorded result would have been fabricating
evidence. The defect has since been fixed in the harness (a clip's length is a
property of its bytes; `audiogen.peaks.compute_duration`), and this frame comes
from a real ElevenLabs call made on the merged harness **`ab58506e`**. Its tool
result carries the duration derived from the returned bytes: **`0.48 s`**,
digest `d736c1f0…`, 8 820 bytes. `byok-actual.json` in this directory is that
result, verbatim, and the card renders a player and a waveform where it
previously rendered nothing.

## Required-state matrix

| State | Actual result | Frame |
|---|---|---|
| 1. Voiceover, billed cost, waveform, duration, played fill | **PARTIAL/BLOCKED**: real waveform/playback/fill; billed caption is absent from merged card | `release-voiceover-playing.png`; `release-voiceover-idle.png` |
| 2. SFX with billed cost | **PARTIAL/BLOCKED**: real SFX plays; billed caption is absent; sub-second clock displays `0:00 / 0:00` | `release-sfx-playing.png`; `release-sfx-idle.png` |
| 3. Invalid arguments + exact server refusal body | **PARTIAL/BLOCKED**: exact HTTP-400 body is replayed and visible; not a newly executed tool refusal and not the requested invalid-arguments labelled row | `release-auto-duration-refusal.png` |
| 4. Running cancel warning BEFORE action, then pending settlement | **BLOCKED/NOT CAPTURED**: no real pre-action warning/action flow was obtained; the forwarded post-cancel rows do not prove it | No fabricated frame |
| 5. BYOK `cost:null` plus labelled estimate | **PARTIAL/BLOCKED**: real BYOK generation on the merged harness succeeded; estimate is **`$0.002`** (whole started seconds: `ceil(0.48 s)` = 1 s at `$0.0020/s`); the estimate caption is absent from the merged card; no server `cost:null` row exists for this direct-provider path. **The record renders a player and a waveform** — `duration_s` is derived from the returned bytes (`0.48 s`), where it was null before the harness fix | `release-byok-result.png`; `byok-actual.json`; `byok-actual.mp3` |
| 6. Earlier-turn artifact playing mid-transcript | **PASS**: earlier real voiceover actively playing while later turns remain visible, not a thumbnail | `release-earlier-turn-playing.png` |

Loading/empty states were not captured by this attempt; populated, playing and
server-error-body replay are present. Do not reuse the older seeded 12-second
WAV evidence as real-artifact coverage.

## Artifact and billing provenance

Voiceover request `aud_6ad446940d2c53091b89c45a`: server reports **$0.0020 billed**,
settled true, usage record `6ad446940d2c53091b89c45c`, 26,374 bytes,
1.619592 seconds, 44,100 Hz mono. SHA-256:
`b44d1c36b127e144f7c9062815b048bb60a30c1b21eef57047edebedc5dcd3b5`.

SFX request `aud_6ad446a1e73ab027182a5272`: server reports **$0.0020 billed**,
settled true, 8,820 bytes, 0.522449 seconds, 44,100 Hz **stereo**. SHA-256:
`4454c2d9463ecec5dc0a5e46ae363aa57d57984dccd3370f05f2fa912da9935c`.

The real browser decoder accounts for MP3 padding. Facts from the committed run
(`run/scene.txt`): voiceover `time 0.186863` / decoded duration 1.578957, paused
false, gain 0, input RMS 0.0808249478757425, output RMS 0; SFX `time 0.17538` /
decoded duration 0.48, input RMS 0.021914229053231683; the state-6 read-back is
`time 1.361138` with `ownerId sound:b44d1c36…` — the EARLIER voiceover is the
playing card. These are derived here, not server duration replacements.

Exact forwarded refusal (no charge), `POST /v1/tools/audio/sound-effects` with
`{"prompt":"a door creak","model":"radient/sound-effects"}`, HTTP **400**:

```json
{"code":"audio_rejected","details":{"reason":"duration_seconds is required: the provider's auto-duration mode cannot be quoted"},"error":"This audio request could not be accepted."}
```

Forwarded cancel request `aud_6ad466c8e73ab027182a54fd`: 540 chars, quote
**$0.0216**. Response CANCELLED, vendor_stopped false,
reason `provider_has_no_cancel_api`, detail `The provider has no cancellation
endpoint. The generation continues and will be charged if it produces audio.`,
settled null, cost_usd null. Subsequent poll COMPLETED, settled true,
**$0.0216 billed**, usage record `6ad466c8e73ab027182a54ff`. This is provenance
only: no capture claims to have performed that cancellation.

## Actual BYOK execution

A real isolated call to merged `execute_generate_sound_effect` (harness
`ab58506e`) used the stored ElevenLabs key through a child-process environment,
with Radient unavailable in the isolated config. No secret value was logged or
written. Arguments:
`{"prompt":"a short wooden door creak, close perspective","duration_s":0.5}`.

Result: the recorded result is a success and carries no `is_error` field; provider `elevenlabs`, model `eleven_text_to_sound_v2`,
8,820-byte MP3 at digest `d736c1f07f72f3b0bbd13c40871f37e4`, **`duration_s 0.48`**
— the length derived from the returned bytes by the harness fix this capture
waited on. `byok-actual.json` is that result verbatim and `byok-actual.mp3` is the
artifact the digest resolves through, committed so the digest is checkable from
the PR rather than from a scratchpad that will not survive.

Cost: `cost_usd 0.002`, `cost_source rate_table`, `billing_basis estimated`. The
merged estimator charges whole started seconds (`audiogen/pricing.py`:
`sound_effect_units = ceil(duration)`), so a 0.48 s request is one unit at
`$0.0020/s` — the same figure the server's own ledger charges. This is an
ESTIMATE, not a billed charge: this path has no per-call server figure, and no
server `cost:null` row exists for it. The result's `details` carry
`artifacts/attempts/audio/billing_basis/cancel_handle/cost_provenance/cost_source/
cost_usd/model/prompt/provider/request_id` and no ledger row.

Implementer/capture agent: coder, actual fallback model **openai/gpt-6.1-sol**
after Anthropic quota exhaustion. The 2026-10-20 re-capture, the BYOK generation
and this README's revision were run by the design lane, model
`deepseek/deepseek-flash`. No role/model configuration changed. No release,
merge, review request, tag, or issue was created by this capture attempt.
