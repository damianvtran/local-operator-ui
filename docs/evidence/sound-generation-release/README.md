# Sound generation — real-artifact release capture attempt

**HOLD: this is not a six-state release-gate pass.** The real widget renders and
plays the real MP3s, but the merged card does not expose the billed/estimated
caption. No substitute cost overlay, mocked widget, or fabricated cancellation
screen was added. The operator has not approved release.

## Source and execution

UI merge `60948819fed2166f50e9452565d79770349a9cc3` (feature head
`25c6bd089f79f5ecef52a692fa04944d7f975223`); harness merge
`01729374e4b1484234d300064b60ce7ac4c015e0`. Extended the existing
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
peaks/cost_usd for the two verified MP3s. `SOUNDS_RELEASE_BYOK` is the actual
BYOK result JSON; `SOUNDS_RELEASE_BYOK_STORE` points at its isolated attachment
store. The exact executed scene command was:

```sh
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
SOUNDS_RELEASE_ASSETS="$LOCAL_OPERATOR_SCRATCHPAD/release-assets.json" \
SOUNDS_RELEASE_BYOK="$LOCAL_OPERATOR_SCRATCHPAD/byok-live/result.json" \
SOUNDS_RELEASE_BYOK_STORE="$LOCAL_OPERATOR_SCRATCHPAD/byok-live/config/attachments" \
LOP_SOUNDS_HARNESS="$HOME/local-operator/.worktrees/sound-generation-release" \
node scripts/run-sounds-scene.mjs
```

Final run: `sounds-native-Ev5ivA` under the capture session scratchpad. Actual
output: history preflight HTTP **200**; expired-URL control HTTP **403**, exactly
**1** control request before/after; **ALL CHECKS PASSED**; **no process from this
run outlived its boot**. The real app was headless, invisible, and unfocused.
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

## Required-state matrix

| State | Actual result | Frame |
|---|---|---|
| 1. Voiceover, billed cost, waveform, duration, played fill | **PARTIAL/BLOCKED**: real waveform/playback/fill; billed caption is absent from merged card | `release-voiceover-playing.png`; `release-voiceover-idle.png` |
| 2. SFX with billed cost | **PARTIAL/BLOCKED**: real SFX plays; billed caption is absent; sub-second clock displays `0:00 / 0:00` | `release-sfx-playing.png`; `release-sfx-idle.png` |
| 3. Invalid arguments + exact server refusal body | **PARTIAL/BLOCKED**: exact HTTP-400 body is replayed and visible; not a newly executed tool refusal and not the requested invalid-arguments labelled row | `release-auto-duration-refusal.png` |
| 4. Running cancel warning BEFORE action, then pending settlement | **BLOCKED/NOT CAPTURED**: no real pre-action warning/action flow was obtained; the forwarded post-cancel rows do not prove it | No fabricated frame |
| 5. BYOK `cost:null` plus labelled estimate | **PARTIAL/BLOCKED**: actual merged harness BYOK generation succeeded, but estimate is `$0.0010`, not requested `$0.0020`; estimate caption is absent from merged card; no server `cost:null` row exists for this direct-provider path | `release-byok-result.png`; `byok-actual.json` |
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

The real browser decoder accounts for MP3 padding: the first complete run measured
voiceover time 0.405325 / decoded duration 1.578957, paused false, gain 0,
input RMS 0.04536893249957781, output RMS 0; SFX time 0.136417 / decoded duration
0.48, paused false, gain 0, input RMS 0.027844287147636378, output RMS 0.
These are derived here, not server duration replacements.

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

## Actual BYOK execution and discrepancy

A real isolated call to merged `execute_generate_sound_effect` used the stored
ElevenLabs key through a child-process environment, with Radient unavailable in
the isolated config. No secret value was logged or written. Arguments:
`{"prompt":"a short wooden door creak, close perspective","duration_s":0.5}`.
Result: is_error false, provider elevenlabs, model eleven_text_to_sound_v2,
8,820-byte MP3 digest `3a679cd9fe08265e7f48e1781cda036d`, request_id null.
Tool caption: `Cost $0.001 (estimated from published rates; the provider reports
no per-call figure).` Details: cost_source rate_table, billing_basis estimated.
Actual approval description: `Generate a 0.5s sound effect via ElevenLabs —
estimated $0.0010 at published rates (audio-rates@2026-10-17); the billed figure
is the provider's.` One channel-spend callback row was emitted:
amount_micro 1000, units 0.5, unit seconds, billing_basis estimated,
cost_source catalogue. This was not an integrated session-ledger write proof.

The calculation is implemented at merged `audiogen/pricing.py:121–137`:
rate × duration_s, no ceil; the actual response and ledger row corroborate it.
It would be false to relabel it as $0.0020 or as a billed charge. The complete
non-secret tool result and ledger observation are in `byok-actual.json`.

Implementer/capture agent: coder, actual fallback model **openai/gpt-6.1-sol**
after Anthropic quota exhaustion. No role/model configuration changed. No release,
merge, review request, tag, or issue was created by this capture attempt.
