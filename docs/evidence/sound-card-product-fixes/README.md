# Sound card receipts and stop warning

Implementation/evidence agent: coder, actual fallback model **openai/gpt-6.1-sol** (host switched after Anthropic quota exhaustion). No model/profile/tool settings were changed.

## Scope and limits

This is implementation evidence, **not the final six-real-artifact release-gate pass**. No fresh provider generation or cancellation was performed here. No merge, release, version bump, reviewer request, issue or tag was made.

The initial-head native replay used real MP3s and the actual earlier tool results documented in `sound-generation-release` evidence PR #1167. During remediation the four caption PNGs were replaced by **focused, opaque Storybook receipt comparisons**, not another native replay; they verify presentation only. That PR is not merged by this change. `rig-local.patch` is its extension plus capture-only fixes: explicit scroll-to-row and 800 ms layout settling, and durable BYOK details in `provider_payload.details`. The patch is not applied to shipped scripts. The old BYOK result is deliberately still **$0.001 estimated**: the backend correction must supply the newer amount; the UI never substitutes $0.0020. Radient legacy rows retain their verbatim **$0.002 (billed)** text. New structured receipts use up to four decimals, drop unnecessary padding, and carry sentence punctuation to match the legacy receipt.

The warning screenshots are the **production card and real Stop control in Storybook**, with a stub action handler; they are not provider-cancel evidence. DOM regression testing separately verifies dispatch counts: initial Stop = 0, Keep waiting = 0, Stop + Request stop = 1. The existing integration mount continues to wire the actual turn-interrupt handler.

Pending settlement renders only explicit `settled:null`, `cost_usd:null`, `cost.basis:"quote"` fields. The older harness `_cancel_receipt` emits stage/settling/vendor_stopped but omits those fields. Harness #2588 (`5e684700d79bebbcfbfe09dc35a3b0e99a7f39c7`, still OPEN at remediation verification) forwards the server's cost/cancellation/note fields; the new contract stories use those explicit fields. Therefore no pending-settlement native screenshot or completed-cancel billing screenshot is claimed here. The backend must forward its actual values before the final integrated capture. Similarly the prior refusal replay has no tool error class; this change does not invent one from its JSON body. Tests verify that a sound `invalid_arguments` planning verdict or supplied tool `error_type` becomes a human-readable class above the unchanged body, unless that body already opens with the same words. Image/video failures receive no new label or cost caption.

## Rendered comparisons

- `voiceover-before.png` / `voiceover-after.png`: **opaque receipt-only Storybook** pair, production source from `60948819f` versus the remediation source, with identical explicit legacy billed text. Caption absent before, present after. No artifact/player is claimed by these replacements.
- `byok-before.png` / `byok-after.png`: the same opaque receipt-only comparison with identical explicit `cost_usd: 0.001`, `billing_basis: "estimated"` facts. This remains an estimate, not a corrected billed BYOK capture.
- `stop-before-action.png`: running production card before pressing Stop.
- `stop-warning.png` / `stop-warning-settled.png`: after Stop but before Request stop. Exact charge-on-output warning and best-effort copy remain visible. Fieldset measured via browser styles: **512 × 138.5 CSS px**, overflow visible; no fixed height. The clock/shimmer continue, but the warning layout remains stable.

All listed images were opened and inspected. Earlier #1167 images named voiceover/earlier-turn showed a different viewport with folded rows; those are not reused as before evidence.

## Initial-head executed validation (historical; not rerun natively during remediation)

From the worktree root:

```sh
node scripts/run-desktop-tests.mjs scripts/image-gen-card.test.mjs scripts/tool-row.test.mjs
# 112 tests, 112 pass, 0 fail. Existing server-render useLayoutEffect warnings.
./node_modules/.bin/biome check scripts/image-gen-card.test.mjs \
  src/renderer/src/features/chat/canonical/image-gen-card-model.ts \
  src/renderer/src/features/chat/canonical/image-gen-card.tsx \
  src/renderer/src/features/chat/components/trace/tool-row-model.ts
# Checked 4 files, no fixes, no errors.
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
# exit 0
```

Native replay after applying `rig-local.patch` locally:

```sh
LOCAL_OPERATOR_UI_NO_BYTECODE=true \
SOUNDS_RELEASE_ASSETS="$ARTIFACT_MANIFEST" \
SOUNDS_RELEASE_BYOK="$ACTUAL_BYOK_RESULT" \
SOUNDS_RELEASE_BYOK_STORE="$ACTUAL_BYOK_ATTACHMENT_STORE" \
LOP_SOUNDS_HARNESS="$HOME/local-operator/.worktrees/sound-generation-release" \
node scripts/run-sounds-scene.mjs
```

Before run compiled the three production source files verbatim from `origin/main:60948819f`; a finally block restored the edited bytes. After run compiled edited source. Both passed: history HTTP **200**, expired signed-URL negative control HTTP **403**, exactly **one** control request, **ALL CHECKS PASSED**, and **no process from this run outlived its boot**. App was headless/invisible/unfocused; zero-gain graph armed before audio creation and rejects re-arm. After playback observed voiceover time **0.397642**, input RMS **0.0462163243**, output RMS **0**; SFX time **0.134718**, input RMS **0.0278442871**, output RMS **0**. Artifact hashes are checked by the replay fixture before starting.

The existing bytecode-build limitation recorded in #1167 is why this evidence explicitly used `LOCAL_OPERATOR_UI_NO_BYTECODE=true`; this is not packaged-bytecode proof. UI #1165 separately addresses it. Dependencies share the existing repository installation; nothing was installed. The browser tab and Storybook server were closed afterward.

## Round-1 remediation — 2026-10-18

Implementer: coder, actual fallback model **openai/gpt-6.1-sol**. One batched remediation commit; no harness changes, merge, reviewer requests, issues or tags.

### Executed controls and real paths

- Bundled the adapter and detail carrier from the reviewed `01fba7e2` Git objects: reproduced raw `insufficient_credits` on an image failure, no caption for an explicitly settled/billed cancellation, and loss of reference identity on a fresh equal `cost` object. All three control assertions passed. The revised regression cases pass against the new production modules.
- Mounted the production card, pane admission hook and **production `useInterruptOnEscape`**, not a replacement key predicate. Card and pane Stop share one visible warning. Both button directions were exercised: card → pane and pane → card yield exactly one group, no interrupt. Stop/Escape admission and Keep waiting yield **0** dispatches; Request stop yields **1**. Escape dismisses without acting; Keep waiting returns focus to the card Stop or pane composer; unmounting a confirming card returns focus to its own pane's textarea. Ordinary non-sound Stop and Escape remain immediate. Capability denial remains authoritative.
- The confirmation uses one combined note, a visible question, a polite announcement and a described, focused safe choice. Keep waiting is first/quiet; Request stop is secondary; both occupy the card's horizontal 8px-gapped row. The authoritative server-authored cancellation sentence is retained verbatim after stopping rather than rewritten client-side.
- The canonical `audio_settle_v1` journal fixture from `audiogen/settle.py` (terminal row, `detail: ""`, explicit amount/basis) survives history reduction with **Audio settlement — Cost $0.0021 (billed).** Equal replay returns the same state; absent amount and quote-only negatives paint no invented charge. An explicitly settled/billed cancelled tool record also displays its own caption.
- Opened the production Storybook states through the harness browser, clicked both actual card and pane warning controls, captured the frames below and **viewed** their pixels. Keyboard dispatch/focus assertions were executed in the mounted production-hook tests; the browser tool has no keypress action, so a trusted physical Escape press is not claimed.

### New rendered evidence

All four replacement caption PNGs and all new PNGs are **RGB, no alpha channel** (Pillow verification), rather than the old RGBA ground at alpha 168/255. The before/after story fixtures are identical; the three baseline production modules were read directly from `60948819f`, hash-checked against those Git bytes, then restored byte-for-byte before after capture. No native artifact, billing correction or provider call is fabricated by these receipt-only stories.

- `voiceover-before.png` / `voiceover-after.png`, `byok-before.png` / `byok-after.png`: opaque baseline/remediation receipt pairs.
- `receipts-remediation-after.png`: both current receipt styles together.
- `stop-warning.png` (initial head) → `stop-warning-remediation.png` / `stop-warning-remediation-light.png`: old versus new card warning hierarchy. Both required consequence sentences remain, in one paragraph instead of two repeated note blocks.
- `pane-stop-remediation.png`: the pane entrance uses the same confirmation; measured fieldset **512 × 119.9 CSS px**, overflow visible. Choices share y=363.4, heights **28px**, x=24 and 121.95: a horizontal row with **8px** gap, not stacked choices.
- `refusal-remediation.png`: **Invalid arguments** in `text-meta`, unchanged error body beneath it.
- `settlement-pending-contract.png`: human pending copy from explicit null/quote fields.
- `settlement-billed-contract.png`: the late custom journal row goes through the real reducer and renders a billed receipt despite its empty wire `detail`.

Pending/billed settlement and refusal frames are **contract fixtures**, not final real-provider release-gate captures. State 4's final integrated capture still waits on #2588 merging; the corrected BYOK and real refusal receipts likewise remain the owning release stream's gates.

### Targeted validation

```sh
node scripts/run-desktop-tests.mjs scripts/image-gen-card.test.mjs \
  scripts/tool-row.test.mjs scripts/transcript-reducer.test.mjs
# 304 tests, 304 pass, 0 fail; existing server-render useLayoutEffect warnings.
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
# exit 0
```

Touched production/story sources and `scripts/image-gen-card.test.mjs` pass Biome. The reducer test file's existing regex-hoisting warnings are unchanged; no warning was added by the settlement test. The whole desktop suite/build remains CI's terminal coverage, not a duplicate local full run. Shared existing dependencies only; Storybook ran with isolated HOME/config, no CMUX environment, telemetry/notifications off. The owned browser surface and preview server were reaped after capture.

### QA scope decisions

- Q1: replaced the obsolete “EITHER key” contract comment with the actual four discriminators (`stage`, `error_type`, `billing_basis`, `settled`).
- Q2 / N2: **sound-only** is intentional. Image/video outputs are not scanned for legacy cost sentences and their failures/cost receipts retain the pre-change presentation; explicit sound receipts alone gain these captions. Regression tests include both other media lanes.
