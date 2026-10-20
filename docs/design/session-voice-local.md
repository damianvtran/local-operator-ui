# Session voice, fully local: no Groq, no cloud

Status: **architect proposal, 2026-10-19 (EDT). Not approved for building. Nothing
here has been launched or run live.**

Operator (Ben), in his words: "what if we keep it all local, like not to use groq",
then "let's try to build it as a variant but not start it or anything like that. I
want to prioritize other work". Earlier: voice must be "usable for everyone, and not
everyone can afford or have that 36 gigs of memory", and duplicate speech code must
not ship. Later the same day: long replies get a **spoken summary**, not the first
800 characters, for both variants.

Bases (line numbers drift with edits):

- UI: `feat/voice-local`, cut from `origin/feat/qwen-voice` `3083205a1`
  (worktree `~/workspace/repos/lo-ui-qwen-vad`).
- Backend: `origin/feat/qwen-voice` `039c1adae`. Backend line numbers below are
  against that commit. A backend `feat/voice-local` is cut from it by slice S1.
- Harness speech code: `local-operator` `origin/main` `30fcbbdaa`.

Frozen and not planned against: no app, Electron, `pnpm dev`, `lop serve`, browser or
server launches; no merge; no PR; `feat/qwen-voice` (the Groq variant) is left
untouched; voice is OFF by default and off loads nothing (no model download, no WASM
init, no microphone); low priority, at most three slices.

Prior records this builds on: `docs/design/session-voice-groq.md` (backend
`feat/qwen-voice`, decisions D1-D8) and `docs/design/voice-spoken-summary.md`
(backend `feat/qwen-voice`, option (i)). This file is the carrier for the local
variant's decisions (L1-L8 below).

## Recommendation

**Three slices, in order: S1 (backend) → S2 (UI page engine) → S3 (UI wiring).**

1. **Everything runs in the hidden voice page that is already built.** Listening:
   Silero VAD (built) → **Moonshine Base** speech-to-text. Speaking: **Supertonic**
   text-to-speech. Both run on the **`onnxruntime-web` 1.30.0 that is already
   bundled** (`package.json:137`), through two small hand-written model runners.
   **No new npm package**: not `kokoro-js`, not `@huggingface/transformers`.
2. **The proposed stack is replaced on the speaking side.** Kokoro through
   `kokoro-js` is rejected on licence grounds before speed even matters: it needs
   `phonemizer`, which embeds eSpeak NG (GPL-3.0) inside an MIT app (evidence
   under "Why"). Supertonic needs no phonemizer: its tokenizer is 81 plain
   characters.
3. **WebGPU is detected at run time.** WebGPU present → both models on the WebGPU
   execution provider. Absent → the same models on single-thread WASM. Speaking
   then measures its own speed on the first sentence; if it is slower than real
   time, voice keeps listening but **reads replies on screen only**, with a status
   that says so. macOS `say` is not the fallback (it is not on this branch, and it
   is Mac-only).
4. **Models are downloaded on first enable, not bundled**: about 330 MB, from
   Hugging Face at pinned commits, every file checked against a pinned SHA-256,
   stored under the app's user-data folder, read by main and handed to the page
   over the page's own preload. The page CSP does not change and the page never
   touches the network.
5. **Wiring needs one backend line, not a new route.** The page sends the
   transcript up through the existing `/voice/utterance` text door; replies come
   down through the existing `/voice/text`, whose `segments` are kept because the
   first segment is one sentence, so speech starts sooner. `/voice/speech` and file
   uploads are unused.
6. **The spoken summary is shared backend work (S1)**, delivered as a voice-only
   system section rather than a note appended to the user's message.
7. **One coordinator with a provider switch, not a fork.** S3 builds the
   page-based coordinator that the Groq plan calls U2, with only the `local`
   provider. The Groq branch later adds `cloud` to the same seam, so the branches
   converge by merging, not by choosing.

### What the existing code gives us (verified by reading)

- Page CSP `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self' blob:`
  (`src/voice-page/csp.ts:26-27`, mirrored in `src/renderer/voice-page.html:8`).
  Model bytes arriving over IPC need nothing more.
- VAD runs ORT on one WASM thread because the `file:` page is not cross-origin
  isolated (`src/voice-page/vad-factory.ts:33-37`). The same constraint applies to
  the new models.
- Assets are emitted by one Vite plugin from a shared list
  (`src/voice-page/vad-assets.ts:20-35`, `scripts/vite-plugins/voice-page-vad.ts:20-31`),
  and a test checks the list, the sources and the built output
  (`scripts/voice-page.test.mjs:563-597`).
- On end of speech the page encodes a WAV and sends it up
  (`src/voice-page/vad.ts:62-65`). Local STT replaces that one call.
- `encodeWav` already takes a sample rate (`src/voice-page/wav.ts:9-12`), so
  Supertonic's 44.1 kHz output becomes WAV bytes that the existing scheduler
  decodes (`src/voice-page/scheduler.ts:24`, `:57`) through the existing inbox
  (`src/voice-page/reply-inbox.ts:30`).
- The preload is one narrow bridge (`src/preload/voice-page.ts:12-20`,
  `src/voice-page/bridge.ts:8-14`); channel names live in
  `src/voice-page/channels.ts:6-17`.
- A start failure is only logged today (`src/voice-page/main.ts:79-81`); the U2
  carry-over requires a visible status.
- The coordinator is still rig-shaped: Gateway and speech ports
  (`src/main/voice/qwen-voice.ts:148-170`), a 16 GB machine gate (`:460`), the
  Gateway and s2s started (`:506-508`), and `speak` sends to the Gateway
  (`:941-966`). The page host refuses any origin but the Gateway's
  (`src/main/voice/qwen-voice-page.ts:322`) and loads no preload (`:331`).
  `appVoicePageUrl` (`:143`) exists but nothing calls it yet.
- The speak guard keeps only `/voice/text` answers that main relayed
  (`qwen-voice.ts:906-936`). It stores `result.text` and not yet `segments`.
- The renderer already posts takes to the text door with `textOrigin: "qwen_s2s"`
  (`src/renderer/src/features/voice/qwen-voice-controller.tsx:474-482`); main's
  relay pins that literal (`src/main/desktop-media.ts:144`, `:304`).
- The off switch is a main-owned file, OFF unless it says `true`
  (`src/main/voice/qwen-voice-setting.ts:26-31`).
- Backend text door: exactly one of file or text; `text_origin` must be in the
  closed `TEXT_ORIGINS = {"qwen_s2s"}` (`desktop_voice.py:188`, `:540`), and it
  becomes the message's `input_path` (`:558`, `_admit` `:611-655`).
- `/voice/text` returns `{text, spoken_chars, truncated, segments}`
  (`desktop_voice.py:712-748`) from `speak_segments` (`:736`), which calls
  `speakable` (`voice/segments.py:156-170`, the call at `:164`); `speakable` is
  `cap(clean(text))` (`voice/speakable.py:156-158`).

## The slices

### S1 — Spoken summary and the local text origin (backend, shared by both variants)

Branch: `feat/voice-local` in `~/workspace/repos/lo-qwen-groq-b1`'s repository, cut
from `origin/feat/qwen-voice` (`039c1adae`). Work in a new sibling worktree
(`git worktree add ~/workspace/repos/lo-voice-local-be -b feat/voice-local origin/feat/qwen-voice`).

**(a) The summary instruction, as a voice-only system section** (replaces the "turn
note" placement in `voice-spoken-summary.md`; see L5).

- `local_operator/prompts_api.py`: `build_system_blocks` (`:907`) gains
  `voice: bool = False`. When true, append a `<voice>` block to the tail, after
  `<interactivity>` (`:1201-1203`) and before credentials (`:1205`):

  > `<voice>` This conversation is in voice mode: your replies are read aloud.
  > End every reply that answers the user with a paragraph that begins `Spoken:`,
  > at most two sentences, written for the ear (no lists, code, links or
  > symbols). The rest of the reply stays on screen. `</voice>`

  Model-facing English, never translated (AGENTS.md exempts model-facing prompts).
  Add `("voice", "<voice>")` to `_TAIL_SECTION_MARKERS` (`:1276`) and
  `"voice": "Voice mode"` to `STATE_SECTION_HEADINGS` (`:1335`). Not advisory
  (`ADVISORY_TAIL_SECTIONS`, `:1316`): its latest value must be authoritative, so a
  disable reaches the model as an empty section.
- `local_operator/session_factory.py`: `_make_system_blocks_provider` (`:3605`)
  takes `config_dir` and `session_id`; the call at `:4780` passes
  `config_dir` (`:4572`) and `transcript_dir.name` (the id used at `:4564`). The
  provider (`:3660`) reads `voice_slot.is_voice_session(config_dir, session_id)`
  (`voice/slot.py:125`) and adds the answer to `key` (`:3730`) and to the
  `build_system_blocks` call (`:3751`). The read is one small JSON file; it is
  wrapped so any error reads as `False`.
- Subagents get nothing: `harness/subagent.py:3593` builds its own blocks and does
  not pass `voice`.
- Why this is cache-safe: production sessions freeze the first prefix and journal
  later changes as `[session-state]` messages at the history tail
  (`prompts_api.py:928-936`). Enabling voice adds one section record, and
  disabling adds one more. Nothing is added per turn, and no user row changes.

**(b) Select the summary when speaking.** `local_operator/voice/speakable.py`:
before `clean`, pick the LAST paragraph whose first token is `Spoken:` (also
`**Spoken:**`, case-insensitive, paragraph start only) and drop the label. No such
paragraph, or an empty one, falls back to today's whole-text path. The cap and
`TRUNCATION_TAIL` (`:51`) still apply to whatever was selected. Both `/voice/text`
and `/voice/speech` inherit this through `speak_segments` (`segments.py:164`), so
the Groq variant gets it for free.

**(c) The local text origin.** `desktop_voice.py:188`:
`TEXT_ORIGINS = frozenset({"qwen_s2s", "local_moonshine"})`, plus the wire copy
`wire.voice.invalid_text_origin` in every backend locale, and the
`VoiceUtteranceResult` docstring.

**(d) Copy.** `wire.voice.max_spoken_chars.help` now says the cap applies to the
spoken summary, or to the whole reply when there is none. Update it in every
language in `i18n/languages.json`, with an independent audit row (AGENTS.md rule).

Tests (no launch, no network):

- `tests/unit/voice/test_speakable.py`: a table covering a `Spoken:` paragraph,
  the bold label, two summaries (the last wins), an empty summary (falls back), the
  word "spoken" mid-sentence (not a marker), and a summary over the cap (cut, with
  the tail).
- `tests/unit/voice/test_segments.py`: the first segment of a summary is its first
  sentence.
- `tests/unit/test_prompts_api.py`: `voice=True` renders `<voice>`, and
  `split_system_block_sections` round-trips it as section `voice`.
- `tests/unit/session/test_state_sections.py` (pattern at `:469`): enable gives
  one `[session-state]` record with the section; a second turn adds nothing;
  disable records it as empty.
- `tests/unit/server/test_desktop_voice.py`: `text_origin=local_moonshine` is
  admitted with that `input_path`; an unknown origin is still 422.

Gates: flake8, black, isort, pyright, and the voice, session and prompt test
directories as an inner loop. The whole tree goes through CI.

Waits for Ben: whether the model actually writes the paragraph (instruction
following cannot be unit-tested), and the cache-hit rate on a real session.

### S2 — The local engine in the page (UI, pure code and build only)

Branch `feat/voice-local` in `~/workspace/repos/lo-ui-qwen-vad` (this worktree;
its `node_modules` is reused; **no `pnpm install`, because no package is added**).

New files under `src/voice-page/`:

- `engine.ts`: the provider seam, shared with the Groq variant:
  `interface Listener { transcribe(samples: Float32Array): Promise<string> }`,
  `interface Speaker { synthesize(text: string): Promise<{ samples: Float32Array; rate: number }> }`,
  `type VoiceProvider = "local" | "cloud"`.
- `device.ts`: `pickDevice(nav)` returns `"webgpu"` when
  `await navigator.gpu?.requestAdapter()` gives an adapter, else `"wasm"`.
  `speedVerdict(synthMs, audioSeconds)` returns `"ok"` when the measured real-time
  factor is at most 0.8, else `"too_slow"`.
- `ort-runtime.ts`: loads ORT lazily, only from `engine.start()`. `"wasm"` uses the
  `onnxruntime-web/wasm` entry that VAD already loads; `"webgpu"` uses
  `onnxruntime-web/webgpu` from the **same 1.30.0 package**. Sets
  `env.wasm.numThreads = 1` and `wasmPaths` to the page's own asset folder.
- `moonshine.ts`: greedy decoding over `encoder_model_quantized.onnx` and
  `decoder_model_merged_quantized.onnx`. Ports the official reference loop (MIT,
  `useful-moonshine-onnx` `model.py`, 112 lines): encoder input `input_values`
  `[1, samples]` at 16 kHz; decoder inputs `input_ids`, `encoder_hidden_states`,
  `use_cache_branch`, `past_key_values.{0..7}.{decoder,encoder}.{key,value}`
  (8 layers, 8 heads, head size 52 for Base); start token 1, end token 2. The
  maximum length scales with the clip, at most 192 tokens. Audio must be 0.1-64 s,
  so a longer take is refused with a status rather than cut. Graph input names
  were read from the pinned files.
- `moonshine-tokens.ts`: decode only. The ids are looked up in `tokenizer.json`'s
  BPE vocabulary, `▁` becomes a space, `<0xNN>` byte tokens are joined as UTF-8,
  and one leading space is stripped (the tokenizer's own decoder sequence).
- `supertonic.ts`: a port of transformers.js 4.3.1's
  `SupertonicForConditionalGeneration.generate_speech` (Apache-2.0, credited):
  `text_encoder` → durations; latent mask; seeded Gaussian noise; 5 steps of
  `latent_denoiser`; `voice_decoder` → waveform, trimmed to the durations, at
  44,100 Hz. Graph inputs were verified on the pinned files: `input_ids`,
  `attention_mask`, `style` / `noisy_latents`, `latent_mask`, `encoder_outputs`,
  `timestep`, `num_inference_steps` / `latents`. The voice is one 51,712-byte
  style file (F1 by default, M1 as the alternative).
- `supertonic-tokens.ts`: NFKD; whitespace runs become one space; `–` and `—`
  become `-`; drop characters outside the vocabulary; map each character to its id
  in the 81-entry `WordLevel` vocabulary.
- `local-engine.ts`: holds the sessions and implements `Listener` and `Speaker`.
  The first `synthesize` is timed and feeds `speedVerdict`; `"too_slow"` makes
  later calls reject with `speech_too_slow`.
- `model-manifest.ts`: the pinned list below (repository, revision, path, bytes,
  SHA-256). It is the only place the numbers live.

New file `src/main/voice/voice-models.ts` (main process, Electron-free so it can
be tested):

- `ensureModels({ dir, fetch, onProgress, signal })` downloads each missing file
  from `https://huggingface.co/<repo>/resolve/<revision>/<path>` into
  `<dir>/<name>.part`, hashes it while streaming, and renames it only on a match.
  A mismatch deletes the part and fails with `model_integrity`. A present file is
  re-hashed once per app run before use.
- `readModel(dir, name)` returns verified bytes for the page.
- `dir` is `join(app.getPath("userData"), "voice-models")`. The coordinator calls
  this only after the person has enabled voice and accepted the download notice
  (S3). Nothing at startup imports it.

Preload and channels: `src/voice-page/channels.ts` gains
`model: "voice-page:model"` (invoke, page → main, `name` from the manifest's closed
set; main refuses any other name) and `transcript: "voice-page:transcript"`
(page → main, text). `bridge.ts` and `src/preload/voice-page.ts` gain
`loadModel(name)` and `sendTranscript(text)`. The bytes reach ORT as
`InferenceSession.create(bytes, { externalData: [{ path, data }] })`. The
`externalData` option is in `onnxruntime-common` 1.30.0's `OnnxModelOptions`.

Build: extend `vad-assets.ts` (or add `engine-assets.ts` beside it) with ORT's
`ort-wasm-simd-threaded.asyncify.wasm` (26,781,914 bytes) and `.mjs`. The
`onnxruntime-web/webgpu` entry needs that variant: `dist/ort.webgpu.min.mjs` names
only `ort-wasm-simd-threaded.asyncify.mjs`. Nothing else is bundled; **no model
weights go into the app**. Also fix m3 from the carry-over:
`voice-page-vad.ts:12` must resolve from the config directory, not `process.cwd()`.

Tests: one new file, `scripts/voice-local-engine.test.mjs`, bundled with esbuild
the same way as `scripts/voice-page.test.mjs:12-36`, and added to
`package.json`'s test lists. No network, no microphone, no window.

- `moonshine.ts` against a **fake ORT** (a session object that records its feeds
  and returns scripted logits): the first step uses `use_cache_branch=false` and
  empty past values; later steps feed back only the decoder's present values;
  decoding stops at token 2 and at the length limit; a clip under 0.1 s or over
  64 s is refused.
- `moonshine-tokens.ts` on a small synthetic `tokenizer.json`: spaces, a byte
  sequence for `é` and an emoji, and leading-space strip.
- `supertonic.ts` against a fake ORT: feeds and shapes per step, exactly 5
  denoiser calls, trimming by the durations, rate 44,100; a seeded noise source
  makes the result deterministic.
- `supertonic-tokens.ts`: a table of NFKD, dashes, dropped symbols and ids from a
  fixture vocabulary.
- `device.ts`: no `navigator.gpu` → `wasm`; an adapter → `webgpu`; a rejecting
  `requestAdapter` → `wasm`; `speedVerdict` at its boundaries.
- `voice-models.ts` with an injected `fetch` over fixture bytes: a good file is
  renamed into place; a bad hash deletes the part and throws `model_integrity`; an
  abort leaves no part; a present good file causes no fetch; `readModel` refuses a
  name that is not in the manifest.
- **Off means nothing**: importing the page modules creates no ORT session and
  calls no fetch (both fakes record zero calls until `start()`).
- Build-output assertion (runs when `out/renderer/voice-page.html` exists, as the
  VAD test does): both ORT variants are present, and **no `.onnx` other than
  Silero, nor any `.onnx_data`, is in `out/`**.

Gates: `pnpm lint`, `pnpm check-types`, the new test file plus
`scripts/voice-page.test.mjs`, and `pnpm build` with the dummy environment from the
carry-over (`VITE_GOOGLE_CLIENT_ID`, `VITE_MICROSOFT_CLIENT_ID`,
`VITE_GOOGLE_CLIENT_SECRET`, `VITE_MICROSOFT_TENANT_ID`,
`LOCAL_OPERATOR_UI_NO_BYTECODE=true`). The build launches nothing.

### S3 — The coordinator on the page, local provider (UI wiring, copy, notices)

This is the Groq plan's U2 coordinator, built with only the `local` provider.

- `src/main/voice/qwen-voice.ts`: replace the Gateway and speech ports
  (`:148-170`) with a page port plus the desktop transport. Skip the machine gate
  (`:460`) on this path. Start sequence: switch on, then the download notice
  acknowledged, then `ensureModels`, then the microphone preflight, then
  `page.openApp(appVoicePageUrl(rendererUrl))`. `speak` (`:941-966`) sends the
  relayed **segments** to the page instead of `gateway.send`, and
  `noteDesktopAnswer` (`:906-936`) keeps `result.segments` beside `result.text`.
  Phrases: main sends the text of a key from the closed set
  (`resources/qwen-voice/phrases.json`), never free text.
- `src/main/voice/qwen-voice-page.ts`: an `openApp` path for the app page. It
  uses the verdict that already exists for the app page, the narrow preload
  (`out/preload/voice-page.js`), and a navigation lock for that URL only. The
  Gateway path (`:322`) stays until U4.
- Page `main.ts`: in `local` mode, the VAD's speech end goes to
  `listener.transcribe`, then `sendTranscript`. Speak messages carrying segments
  go to `speaker.synthesize(segment n+1)` while segment n plays (one ahead, the
  same rule the scheduler already keeps), then `encodeWav(samples, 44100)` into the
  inbox. Barge-in, stop and mute stay as they are.
- Main relays a transcript into the existing take path, so the renderer posts it
  with `textOrigin: "local_moonshine"` (`qwen-voice-controller.tsx:481`,
  `desktop-media.ts:144` zod literal, `desktop-contract.ts:5853`).
- Statuses (carry-over m3 included): `models_downloading` (with progress),
  `models_offline`, `model_integrity`, `mic_unavailable`, `listening_failed`,
  `speech_too_slow` ("Voice reads replies on screen on this computer"). Copy in
  `ui.chat.voice.*` and `ui.settings.voice.*`, translated into all seven UI
  locales (`en es fr hi ru vi zh-CN`), then `node scripts/i18n/generate.mjs` and
  `pnpm check-i18n`.
- Notice, shown once before the first download (wording for designer review):
  "Voice runs on this computer. Turning it on downloads about 330 MB of speech
  models from Hugging Face, once. After that, what you say and what is read to you
  stay on this computer."
- `THIRD_PARTY_NOTICES.md` sections: vad-web (ISC), onnxruntime-web (MIT,
  Microsoft) with its transitive packages, Silero VAD v5 (MIT); Moonshine (MIT,
  Useful Sensors); Supertonic (OpenRAIL-M, Supertone, including its
  use-restriction attachment, which OpenRAIL-M requires to be passed on); the
  transformers.js and `useful-moonshine-onnx` code the runners port from
  (Apache-2.0 and MIT).

Tests: extend `scripts/qwen-voice-main.test.mjs` with the injected-port pattern.

- Off: zero downloads, zero page creations, the app page URL never loaded (closes
  the `TODO(U2)` at `:2349`).
- On without the acknowledgement: no download.
- A transcript is relayed as a take with origin `local_moonshine`.
- Speak sends only relayed segments; a text that was not relayed is refused.
- A slot switch stops the page and drops in-flight segments.
- `speech_too_slow` keeps listening and stops speaking.
- Each status renders its copy (`scripts/voice-composer.test.mjs`).

Waits for Ben (only a live run can show these):

- WebGPU in the sandboxed `file:` page;
- the ORT asset loads from inside `app.asar`;
- the speed of each model on WASM;
- memory use (estimated 0.5-1 GB with both models loaded; not measured);
- the microphone and echo cancellation;
- Moonshine's accuracy on his voice;
- how Supertonic sounds.

## Why this and not the alternatives

- **Kokoro-82M through `kokoro-js` (the proposed TTS): rejected.** `kokoro-js`
  1.2.1 (Apache-2.0) depends on `phonemizer` ^1.2.1 and
  `@huggingface/transformers` ^3.5.1 (npm registry, read 2026-10-19).
  `phonemizer` 1.2.1 is labelled Apache-2.0, but its 1.3 MB `dist/phonemizer.js`
  bundles eSpeak NG, whose repository is GPL-3.0 (GitHub API), and its
  `espeak-ng-data`. The project's issue #6, "Invalid license", has been open since
  2026-01-26; a 2026-09-09 comment there asks for the eSpeak source revision and
  build records and found none. Shipping that inside this MIT app
  (`package.json:10`) is a copyleft risk no slice should take on implicitly. The
  speed problem in the brief stands as well (about 2× slower than real time on one
  WASM thread, the briantung.me figure the handoff cites, not measured here). The
  Python route (`kokoro-onnx` 0.6.1) has the same problem: it needs `phonemizer`
  ≥3.4.0, which is GPLv3+ on PyPI.
- **`@huggingface/transformers` for both models: rejected.** 4.3.1 depends on
  `onnxruntime-web` **1.31.0-dev.20260914** (a dev build), `onnxruntime-node`
  1.30.0 (301 MB unpacked, with an install script) and `sharp`. Its web build
  imports `onnxruntime-web/webgpu`. That is a second ORT beside the vetted 1.30.0,
  and a heavy install in a worktree with cloned `node_modules`. The two models need
  about 250 lines of runner code, which can be ported and tested against fakes.
- **Moonshine through transformers.js**: the same objection; the model itself is
  kept. English Base and Tiny ONNX are MIT (Hugging Face API card data); the
  non-English variants carry `license: other`, so this variant is English only.
- **STT and TTS in main or a utility process (`onnxruntime-node`)**: rejected. It
  adds 301 MB of native code per platform, while the page already owns the
  microphone and playback, and Groq D2 put voice there for crash isolation.
- **A native helper (Kokoro MLX/CoreML, Apple SpeechAnalyzer)**: rejected for
  now. It is Apple-only (SpeechAnalyzer needs macOS 26), against "usable for
  everyone"; the app also ships Windows and Linux (`package.json:348`, `:398`).
- **macOS `say` as the fallback**: rejected for this variant. The rung exists only
  on `origin/feat/session-voice` (`20a012742`, "feat(tts): add opt-in
  local_tts_system rung (macOS say)"); it is not on `origin/main` (whose
  `TTS_RUNG_PATHS`, `tts/cascade.py:96-100`, has three cloud rungs) nor on
  `feat/qwen-voice`. `git merge-tree` of it onto `039c1adae` conflicts in
  `tts/__init__.py`, `tts/cascade.py` and `tests/unit/server/test_server_tts.py`,
  and using it needs `/voice/speech` with `include_local`. It is Mac-only too. It
  remains a possible later fallback.
- **Bundling the weights**: rejected. About 330 MB would go into every download
  of an app whose voice is off by default.
- **A custom `lo-voice-model:` protocol for model bytes**: rejected. It adds a
  scheme registered before ready (`src/main/index.ts:1731` precedent) and a
  `connect-src` entry; IPC through the existing preload changes neither.
- **The summary as a note appended to each user turn** (`voice-spoken-summary.md`,
  "The turn note", via `_append_busy_resume_note`, `session/session.py:27040`):
  replaced. It costs tokens on every voiced turn, needs a strip in the rendered
  user row (`harness/rows.py:772` precedent), and makes the journal and the screen
  differ. A tail system section is journalled once per change, through the
  machinery that already keeps that cache-safe.
- **Forking the coordinator per variant**: rejected. Groq's U2 is unbuilt; building
  it once with a provider seam is the only shape that converges.

## What this commits us to

- **Order:** S1 → S2 → S3. S2 can start alongside S1 (no shared files); S3 needs
  S1's `local_moonshine` origin and S2's engine.
- **Files owned:** backend `prompts_api.py`, `session_factory.py`,
  `voice/speakable.py`, `server/routes/desktop_voice.py` and their tests. UI
  `src/voice-page/{engine,device,ort-runtime,moonshine,moonshine-tokens,supertonic,supertonic-tokens,local-engine,model-manifest}.ts`,
  `src/main/voice/voice-models.ts`, `qwen-voice.ts`, `qwen-voice-page.ts`, the
  preload, the channels, and notices.
- **Contracts frozen:** `TEXT_ORIGINS` gains `local_moonshine`; the `<voice>`
  section name and the `Spoken:` marker (machine labels, never translated); the
  page channels `model` and `transcript`; the `Listener`/`Speaker`/`VoiceProvider`
  seam the Groq variant must adopt.
- **Hard to reverse:** the model revisions and hashes (changing them means a
  re-download for every user); the notice's promise that nothing leaves the
  computer.
- **Not touched:** `feat/qwen-voice`, `/voice/speech`, the Groq rungs, the rig (U4
  stays Ben's call, Groq D6).

### Pinned models (the S2 manifest; SHA-256 from the Hugging Face API's LFS ids, or computed here for small files)

| File | Bytes | SHA-256 |
|---|---|---|
| `onnx-community/moonshine-base-ONNX` @ `b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad` | | |
| `onnx/encoder_model_quantized.onnx` | 20,513,063 | `1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751` |
| `onnx/decoder_model_merged_quantized.onnx` | 42,498,870 | `cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3` |
| `tokenizer.json` | 3,761,754 | `7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f` |
| `config.json` | 922 | `fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1` |
| `onnx-community/Supertonic-TTS-ONNX` @ `cff123c84b0655d9d647641f1b532c3cbb8f7faa` | | |
| `onnx/text_encoder.onnx` | 433,169 | `50a03d29d5dc95918eeff578f542b814f3cf5a741f927116f5a8462a76ff6898` |
| `onnx/text_encoder.onnx_data` | 28,426,752 | `6415854f135a318909dc716e90f83a391d9a91bd9da09bdb6d6763d6b0a6c102` |
| `onnx/latent_denoiser.onnx` | 398,102 | `9a639a8c05c9be111848562c5cf10ea2697a589c6341830aac479d0ce7b75aa9` |
| `onnx/latent_denoiser.onnx_data` | 132,098,880 | `cde4abf1136defce235bc446eaab4954a57721ae8d5a4754cdd337bf191b612f` |
| `onnx/voice_decoder.onnx` | 59,921 | `83c104006dabcd6b568c0d5acb6fec18f65609d2391dd2c459e4440e85027669` |
| `onnx/voice_decoder.onnx_data` | 101,353,472 | `ea52402c9ba5131ee2b3901a86db2f0b435b322169cd75157e053493d967d17f` |
| `tokenizer.json` | 2,038 | `da6954f045585fc12c8ea9831b3c3eb1c5bffc8ef7ff6b6db7de781cd472ee01` |
| `config.json` | 247 | `37cdafab327b4360e0d6911956bfb3ca3d7254b53749e06ca41ab422d7686259` |
| `voices/F1.bin` | 51,712 | `5ef84e3421e4f80994a5a40a18ba39ba9fc48175c41ae6cf3e56418820872dbf` |
| `voices/M1.bin` | 51,712 | `7d53fbaaccf39a358010dcc5f289fc1d5cb350fe5f518be35f62cc518d794892` |

Total: about 66.8 MB for listening and 262.9 MB for speaking, so about 330 MB.
Moonshine Tiny (`a6da1241…`, encoder 7,937,661 bytes, `c6fc4b7b…`; decoder
20,243,286 bytes, `eed87831…`) is the measured-slowness fallback if Base proves too
slow; it is not in the first manifest.

## Risks and what would change the answer

- **First thing for Ben to check:** the Supertonic licence (OpenRAIL-M). It is not
  an OSI licence: it adds use restrictions that must be passed on to users. If he
  will not ship it, local speaking has no permissive, phonemizer-free model in this
  plan, and the honest fallback is "listen locally, read replies on screen" (S2
  without `supertonic.ts`) or a deliberate GPL decision on eSpeak.
- **Then, on his first live run:** whether `navigator.gpu` exists in the sandboxed
  `file:` voice page of Electron 44. Unverified — waits for Ben's live run. If it
  does not, everything depends on WASM speed.
- **WASM speed: unverified, waits for Ben's live run.** Supertonic's own table (the
  vendor's numbers, M4 Pro, native ONNX on CPU) gives a real-time factor of
  0.012-0.015, against 0.124-0.144 for Kokoro in the same table. Single-thread WASM
  is slower than native by a factor nobody has measured here. The run-time
  `speedVerdict` makes a slow machine fall back to on-screen replies instead of
  stalling.
- **Two ORT entries in one page** (VAD on `/wasm`, the models on `/webgpu`):
  unverified, waits for Ben's live run. If they conflict, move VAD onto the
  `/webgpu` entry as well (vad-web accepts `ortConfig`), at the cost of touching
  reviewed code.
- **Port errors in the runners.** A fake ORT proves the control flow, not the
  numbers. Output parity with the reference implementations needs the real weights
  and a run, which waits for Ben. Keep the ports line-for-line with their sources
  and cite the source version in each header.
- **Hugging Face availability and terms.** The download depends on a third-party
  host at pinned commits. If a revision disappears, voice reports `models_offline`.
  Mirroring the files to a host we control is the fix if that ever happens.
- **The model ignores the `Spoken:` instruction.** The fallback speaks the whole
  reply capped at 800 characters, exactly as today, so the worst case is today's
  behaviour.
- **What would overturn this plan:** a measured real-time factor above 1 for
  Supertonic on WASM on a typical Apple Silicon Mac *and* no WebGPU (then a native
  helper becomes worth its platform cost); Ben declining OpenRAIL-M; or eSpeak NG
  being cleared for distribution (then Kokoro, with 24 English voices, is back in
  contention).

## What I verified, and what I could not

Verified here (2026-10-19, read-only; no launch):

- Every UI and backend file:line cited above, read at the stated commits.
- npm registry metadata for `kokoro-js` 1.2.1, `phonemizer` 1.2.1,
  `@huggingface/transformers` 4.3.1 and 3.8.1, `onnxruntime-node` 1.30.0, and the
  `onnxruntime-web` 1.31 dev build. The `phonemizer` and `kokoro-js` tarballs were
  unpacked and read; transformers.js 4.3.1's web build was read for its imports,
  cache, Moonshine and Supertonic code.
- Licences: eSpeak NG GPL-3.0 (GitHub API), PyPI `phonemizer` GPLv3+, Moonshine
  MIT, Supertonic OpenRAIL-M (model card and LICENSE), `onnxruntime-web` MIT.
- Model files, sizes and SHA-256 values from the Hugging Face API; small files
  downloaded and hashed here; ONNX graph input names read from the pinned files.
- That ORT 1.30.0's `/webgpu` entry needs the asyncify WASM variant, and its size.
- That the macOS `say` rung is absent from `origin/main` and `feat/qwen-voice`, and
  that cherry-picking it conflicts.

Not verified (each waits for Ben's live run): WebGPU in the page; any speed or
memory figure; ORT loading from `app.asar`; echo cancellation; accuracy; voice
quality; the cache-hit rate after the `<voice>` section.

## Decisions

- **L1 — Where STT and TTS run.**
  - **Taken:** in the existing sandboxed voice page, on the bundled
    `onnxruntime-web` 1.30.0; WebGPU when an adapter exists, else single-thread
    WASM.
  - **Rejected:** main or a utility process (`onnxruntime-node`, 301 MB native);
    a native helper (Apple-only); transformers.js (second, dev-build ORT plus
    `onnxruntime-node` and `sharp`).
  - **Commits us to:** `src/voice-page/ort-runtime.ts` and two runners; the
    asyncify ORT variant in the build.
  - **Overturned by:** a measured real-time factor above 1 on WASM with no WebGPU
    on typical Macs.
  - **Owner:** coder (S2).
- **L2 — Which TTS model.**
  - **Taken (Ben confirms the licence):** Supertonic, `onnx-community/Supertonic-TTS-ONNX`
    @ `cff123c8`.
  - **Rejected:** Kokoro via `kokoro-js` (bundled GPL-3.0 eSpeak NG through
    `phonemizer`, issue #6; about 2× slower than real time on WASM, published
    figure); `kokoro-onnx` (GPLv3+ `phonemizer`).
  - **Commits us to:** OpenRAIL-M notice and use-restriction pass-through; English
    only.
  - **Overturned by:** Ben declining OpenRAIL-M, or eSpeak NG being cleared.
  - **Owner:** Ben (licence), then coder (S2).
- **L3 — Fallback without fast enough speech.**
  - **Taken:** measure the first synthesis; if slower than real time, keep
    listening and read replies on screen, with the `speech_too_slow` status.
  - **Rejected:** macOS `say` (absent from this branch, conflicting cherry-pick,
    Mac-only); speaking anyway (stalls).
  - **Commits us to:** `device.ts` `speedVerdict`; one status and its copy.
  - **Overturned by:** Ben wanting `say` on Macs (then cherry-pick `20a012742`
    and route through `/voice/speech` with `include_local`).
  - **Owner:** coder (S2, S3).
- **L4 — Model delivery.**
  - **Taken:** download on first enable after a notice, from pinned Hugging Face
    commits, SHA-256 per file, into `userData/voice-models`; main reads the files
    and hands bytes to the page over the preload; the page CSP is unchanged.
  - **Rejected:** bundling (about 330 MB for everyone); a custom protocol (new
    scheme and CSP origin).
  - **Commits us to:** `voice-models.ts`, the manifest table above, the notice
    copy in seven locales.
  - **Overturned by:** a requirement for voice with no network at all, ever
    (then bundle or side-load).
  - **Owner:** coder (S2, S3); copy by designer.
- **L5 — Spoken summary placement (replaces "The turn note" in
  `voice-spoken-summary.md`).**
  - **Taken:** a `<voice>` tail system section, gated by `is_voice_session`,
    journalled as `[session-state]` on change; `speakable` picks the last
    `Spoken:` paragraph and otherwise falls back to today's path.
  - **Rejected:** a per-turn note in the user message (tokens every turn, a strip
    in rendered rows, journal and screen differing).
  - **Commits us to:** a `voice` section name and `Spoken:` marker; serves both
    variants.
  - **Overturned by:** a cache measurement showing the state record costs more
    than per-turn notes, or the model ignoring a system-side instruction.
  - **Owner:** coder (S1).
- **L6 — Wiring.**
  - **Taken:** transcript up through the `/voice/utterance` text door with
    `text_origin=local_moonshine`; text down through `/voice/text`, using its
    `segments` for earlier first audio; no `/voice/speech`.
  - **Rejected:** reusing `qwen_s2s` (records a false origin); a new route
    (nothing needs one).
  - **Commits us to:** one `TEXT_ORIGINS` entry and the matching zod literal.
  - **Overturned by:** nothing foreseen.
  - **Owner:** coder (S1, S3).
- **L7 — Sharing with the Groq variant.**
  - **Taken:** one page-based coordinator with a `VoiceProvider` seam
    (`local` | `cloud`) and the `Listener`/`Speaker` interfaces; S3 builds it with
    `local` only; Groq's U2 adds `cloud`.
  - **Rejected:** a forked coordinator per branch.
  - **Commits us to:** the Groq U2 brief adopting this seam.
  - **Overturned by:** Ben dropping one variant (then remove the seam).
  - **Owner:** manager.
- **L8 — Slicing.**
  - **Taken:** S1 (backend summary and origin) → S2 (page engine, pure code and
    build) → S3 (coordinator, copy, notices); S2 may run alongside S1.
  - **Rejected:** a single UI slice (too large to review: engine plus coordinator
    plus seven-locale copy).
  - **Commits us to:** reviewer and qa-tester on each slice; designer and
    ux-reviewer on S3 copy and the enable flow, from rendered static frames,
    because launches are barred.
  - **Overturned by:** Ben allowing launches (then add live QA per slice).
  - **Owner:** manager.
