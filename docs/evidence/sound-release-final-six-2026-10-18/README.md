# Final six sound release-gate captures — 2026-10-18

**All six review artifacts are present. Release remains HELD for the operator to review all six.** This evidence does not approve a release, merge a PR, request a reviewer, create an issue, or create a tag.

Capture/implementation agent: coder, actual fallback **openai/gpt-6.1-sol**, after the host switched from Anthropic on quota exhaustion. No role/model/tool settings changed.

## Source, instrument, and truthful boundaries

- UI: requested merged `7b02644e9ba22ce328281602bdf78f7ceae5a343`, in fresh `.worktrees/release-capture-final`; dirty primary untouched. Harness: requested merged `2c52030af3c170dfb057ed5da704c13021a1d89e`, separate fresh worktree. Existing shared dependencies; no installs.
- Actual Electron **44.3.0** native desktop renderer, compiled source, **bytecode enabled** (one main bundle compiled), real production widgets, attachment relay, decoder, audio graph, reducer, and composer. Not a Storybook render or illustration. Full frames are 2760×2200 opaque RGB, 1380×1100 CSS at DPR 2. The state-4 review image is a labelled contact sheet of three unretouched crops; full originals are in `supporting/`.
- `rig-local.patch` contains every capture-only alteration: the prior release replay extensions, fresh input file carriers, real-control sequence, mock-keychain switch, and a **single isolated-identity recorded-event ingress** into the mounted canonical session hook. That ingress runs production `applyEvent` and frontend streaming state for the recorded running context; it is not shipped application functionality. The production sound/player/card/composer source is unchanged.
- This is **recorded-artifact replay in an isolated conversation**, not a claim these provider generations happened inside the photographed chat. Account identity was independently confirmed with the required result GET, HTTP **200**. Real local bytes are used by digest; the successful result body was deliberately not retained because it may contain expiring URLs.
- Fresh calls made here: live invalid-arguments POST, merged-harness ElevenLabs BYOK, and a fresh merged-harness invalid-argument classification check. State 4 uses the server lane's genuinely observed receipt and immediate next completed poll, in order. **No new provider cancellation, artificially prolonged job, fake pending provider response, or guaranteed-cancel claim.** The real composer Stop is pressed to open the warning; `Request stop` is not dispatched to an unrelated/no-longer-running provider job. `Keep waiting` dismisses the question, then the recorded receipt is replayed.
- `provenance/cancel-replay.json` was derived by serving the canonical receipt over local HTTP to merged `audio_tool._cancel_receipt`, not by replacing its money/cancellation fields. The terminal envelope uses the merged executor's `is_error: true` cancellation convention (`audio_tool.py:674–680`). Completed/billed fields are the next canonical poll forwarded into that same recorded row.
- Refusal body is the fresh server response, verbatim in value. The row label is the classified invalid-argument carrier supplied to the replay: a separate fresh merged-tool invocation confirms `details.__fault: "invalid_arguments"`; the native row's `error_type` label is an explicit presentation mapping, **not a claim the raw HTTP body contained that field**.

## The six review images

| State | Artifact | What is actually visible / observed |
|---|---|---|
| 1 | [01-voiceover-playing.png](01-voiceover-playing.png) | Real voiceover MP3, pause control, decoded waveform/played fill, duration, **Cost $0.0020 (billed)**. Playback observation: time 0.403447s, decoded duration 1.578957s, input RMS 0.04588879, gain 0, output RMS 0. |
| 2 | [02-sfx-playing.png](02-sfx-playing.png) | Real SFX MP3 playing, waveform/fill, **Cost $0.0020 (billed)**. Time 0.136417s, decoded duration 0.48s, input RMS 0.02784429, gain 0, output RMS 0. Subsecond duration displays 0:00 under the existing whole-second clock. |
| 3 | [03-invalid-arguments.png](03-invalid-arguments.png) | **Invalid arguments** row label above the fresh HTTP-400 `audio_rejected` body, including the exact required-duration reason. |
| 4 | [04-running-cancel-three-instants.png](04-running-cancel-three-instants.png) | A: real composer Stop warning **before Request stop**; provider may finish and charge. B: recorded CANCELLED receipt, settlement pending, no billed amount. C: recorded next COMPLETED poll, **Cost $0.0216 (billed)**, pending sentence retired. Full frames: [before action](supporting/release-cancel-before-action.png), [pending](supporting/release-cancel-pending-receipt.png), [completed](supporting/release-cancel-completed-billed.png). |
| 5 | [05-fresh-byok-estimated.png](05-fresh-byok-estimated.png) | Fresh corrected real ElevenLabs audio. Card says **Cost $0.002 (estimated)**; the actual merged-harness approval description immediately underneath says **estimated $0.0020**, never billed. Amount is the new result, not relabelled old $0.001 output. |
| 6 | [06-earlier-turn-playing.png](06-earlier-turn-playing.png) | Earlier voiceover actively playing while later SFX, refusal and BYOK turns are visible. Time 0.162056s, input RMS 0.11346967, output RMS 0, played fill ≈9.93%. Earlier player y=71.94 CSS px. |

All six final images and three state-4 full originals were opened and inspected. Idle/populated player neighbors are in `supporting/`; running/loading is the real running-card/Stop state, and error is the real refusal. No empty generated-artifact result is invented: these successful artifacts exist; unknown BYOK duration honestly displays 0:00 rather than fabricated metadata. Container MP3 durations from the supplied provenance (1.619592s / 0.522449s) differ from Chromium's observed decoded durations above; both are retained rather than overwritten.

## Fresh requests and actual responses

At 2026-10-18T08:40Z, with an authorized stored Radient key (never logged):

```http
GET /v1/tools/audio/result?request_id=aud_6ad446940d2c53091b89c45a
→ HTTP 200 (same account; response body deliberately discarded)

POST /v1/tools/audio/sound-effects
{"prompt":"a door creak","model":"radient/sound-effects"}
→ HTTP 400
{"code":"audio_rejected","details":{"reason":"duration_seconds is required: the provider's auto-duration mode cannot be quoted"},"error":"This audio request could not be accepted."}
```

The refusal creates no request ID/audio. Exact saved body: `provenance/refusal.json`. Fresh classifier control: `provenance/refusal-class.json`, `is_error: true`, `details.__fault: invalid_arguments`.

Fresh BYOK, stored `ELEVENLABS_API_KEY` passed only in process memory, isolated HOME/config, Radient availability asserted false:

```python
await execute_generate_sound_effect(
    "release-fresh-byok",
    {"prompt":"a short wooden door creak, close perspective","duration_s":0.5},
    context=isolated_context,
)
```

Actual result: `is_error:false`, `provider:"elevenlabs"`, `model:"eleven_text_to_sound_v2"`, `request_id:null`, real 8820-byte MP3 digest **ebd203c4892f3c83d3e8d9997e53854a**; harness `cost_usd:0.002`, `billing_basis:"estimated"`, `cost_source:"rate_table"`. Vendor returned audio bytes, **no per-call billed amount** (`cost:null` in the provenance envelope expresses that absence; it is not a fabricated vendor JSON field). Derived central-table estimate: `{amount_usd:0.002,units:1,unit:"seconds"}`. Real approval: `Generate a 0.5s sound effect via ElevenLabs — estimated $0.0020 at published rates (audio-rates@2026-10-17); the billed figure is the provider's.` One actual channel-spend callback row: units=1, amount_micro=2000, estimated, catalogue. This is callback evidence, not a claim of an integrated durable session-ledger write. Full actual tool result, estimate, approval and callback are in `provenance/byok.json`.

## Real artifact and canonical receipt provenance

Voiceover `aud_6ad446940d2c53091b89c45a`: supplied local session `7046cbee7da0/scratchpad/audio-live/aud_6ad446940d2c53091b89c45a.mp3`, 26374 bytes, 1.619592s container duration, 44.1kHz mono; SHA256 **b44d1c36b127e144f7c9062815b048bb60a30c1b21eef57047edebedc5dcd3b5**. Billed **$0.0020**, usage record `6ad446940d2c53091b89c45c`, server-lane provenance. Replay caption normalizes the same amount to four decimal places; the actual billing basis is unchanged.

SFX `aud_6ad446a1e73ab027182a5272`: same local directory, 8820 bytes, 0.522449s container duration, 44.1kHz stereo; SHA256 **4454c2d9463ecec5dc0a5e46ae363aa57d57984dccd3370f05f2fa912da9935c**. Billed **$0.0020**, server-lane provenance. Peaks were decoded here from those exact MP3 bytes, not synthesized.

Canonical files from server conversation **Sound + speech generation: Radient Agent Server endpoints**, session `6c9c8f09af70/scratchpad/audio-live`; copied verbatim and SHA256-computed here:

- `cancel-submit.json`, 581 bytes: **82aee261c842e89291fd916f8341a1f1ded7c898cbf37b17260b0af75fe04853**.
- `cancel-response.json`, 685 bytes: **30bf30b8e83f3b649ab51c2208192dbc7ebce8a071b90a95e1538234d6c89804**.
- `cancel-status.json`, 593 bytes: **902eefa4d5003039093974b8f62c52c4c7ba4aa43244fbbb893ec950d2ccb5a3**.

Request **aud_6ad466c8e73ab027182a54fd**, 540 characters, quote **$0.0216**, usage record **6ad466c8e73ab027182a54ff**, `audio-rates@2026-10-17`. Receipt: `status:CANCELLED`, `settled:null`, `cost_usd:null`, `cost.basis:quote`, `cancellation.requested:true`, `vendor_stopped:false`, `reason:provider_has_no_cancel_api`, exact detail `The provider has no cancellation endpoint. The generation continues and will be charged if it produces audio.` Next canonical poll: `COMPLETED`, `settled:true`, `cost_usd:0.0216`, `cost.basis:billed`, same usage record. The genuine short window is not stretched: these are distinct recorded instants, explicitly labelled.

## Exact execution and safety

From the new UI worktree, after applying `rig-local.patch` and generating the fresh input files with the saved provenance scripts:

```sh
# existing shared dependency resolution; no installation or bytecode downgrade
export NODE_PATH="$HOME/local-operator-ui/node_modules/.pnpm/@babel+plugin-transform-arrow-functions@7.25.9_@babel+core@7.26.10/node_modules"
export SOUNDS_RELEASE_ASSETS="$INPUTS/assets.json"
export SOUNDS_RELEASE_BYOK="$INPUTS/byok.json"
export SOUNDS_RELEASE_BYOK_STORE="$INPUTS/config/attachments"
export SOUNDS_RELEASE_REFUSAL="$INPUTS/refusal.json"
export SOUNDS_RELEASE_CANCEL="$INPUTS/cancel-replay.json"
export LOP_SOUNDS_HARNESS="$HOME/local-operator/.worktrees/release-capture-final"
env -u XPC_FLAGS node scripts/run-sounds-scene.mjs
```

Actual INPUTS: capture session `d97f35d8fba1/scratchpad/final-audio-inputs`; final run: `sounds-native-heZBIM` in that session scratchpad. `node --check` for fixture/scene and `tsc --noEmit -p tsconfig.app.json` passed before native dispatch. First attempt stopped before renderer on missing Babel root resolution; the module already existed in the shared pnpm store, and NODE_PATH solved it. A subsequent run caught two capture-envelope omissions on visual inspection (wrong refusal details nesting and missing cancellation `is_error`); both were corrected in the rig and final capture was regenerated. No product code fix or source-only success claim.

Final actual output: history preflight **HTTP 200**; expired-URL negative control **HTTP 403** with exactly **one** control request, no app hotlink; graph re-arm negative control refused; no connection to the operator's own backend; class/warning/pending/billed assertions **PASS**; **ALL CHECKS PASSED**; **no process from this run outlived its boot**. `native-scene.txt` and `native-build.txt` retain actual responses and build facts. The headless window was invisible/unfocused. Graph armed before element creation; gain=0 and measured output RMS=0 for playback. HOME/config isolated; CMUX/LOP/XPC flags stripped; mock keychain used; telemetry and notifications off; exact owned process groups reaped in finally.

`image-manifest.json` pins dimensions, RGB opacity and SHA256 of every image. No signed URL or credential value is present. This work creates only evidence on an unmerged branch and comments on the existing PR. **Operator review of all six remains the release gate.**
