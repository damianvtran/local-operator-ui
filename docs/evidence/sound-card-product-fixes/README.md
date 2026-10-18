# Sound card receipts and stop warning

Implementation/evidence agent: coder, actual fallback model **openai/gpt-6.1-sol** (host switched after Anthropic quota exhaustion). No model/profile/tool settings were changed.

## Scope and limits

This is implementation evidence, **not the final six-real-artifact release-gate pass**. No fresh provider generation or cancellation was performed here. No merge, release, version bump, reviewer request, issue or tag was made.

The native frames replay real MP3s and the actual earlier tool results documented in `sound-generation-release` evidence PR #1167. That PR is not merged by this change. `rig-local.patch` is its extension plus capture-only fixes: explicit scroll-to-row and 800 ms layout settling, and durable BYOK details in `provider_payload.details`. The patch is not applied to shipped scripts. The old BYOK result is deliberately still **$0.0010 estimated**: the backend correction must supply the newer amount; the UI never substitutes $0.0020. Radient legacy rows retain their verbatim **$0.002 (billed)** text. New structured results format four decimals.

The warning screenshots are the **production card and real Stop control in Storybook**, with a stub action handler; they are not provider-cancel evidence. DOM regression testing separately verifies dispatch counts: initial Stop = 0, Keep waiting = 0, Stop + Request stop = 1. The existing integration mount continues to wire the actual turn-interrupt handler.

Pending settlement renders only explicit `settled:null`, `cost_usd:null`, `cost.basis:"quote"` fields. The older harness `_cancel_receipt` currently emits stage/settling/vendor_stopped but omits those fields. Therefore no pending-settlement native screenshot or completed-cancel billing screenshot is claimed here. The backend must forward its actual values before the final integrated capture. Similarly the prior refusal replay has no tool error class; this change does not invent one from its JSON body. Tests verify that an actual `invalid_arguments` planning verdict or supplied tool `error_type` is presented above the unchanged body.

## Rendered comparisons

- `voiceover-before.png` / `voiceover-after.png`: same transcript/artifact, baseline `60948819f` versus changed card. Billed caption absent before, present after.
- `byok-before.png` / `byok-after.png`: same old actual BYOK result, estimated caption absent before, present after.
- `stop-before-action.png`: running production card before pressing Stop.
- `stop-warning.png` / `stop-warning-settled.png`: after Stop but before Request stop. Exact charge-on-output warning and best-effort copy remain visible. Fieldset measured via browser styles: **512 × 138.5 CSS px**, overflow visible; no fixed height. The clock/shimmer continue, but the warning layout remains stable.

All listed images were opened and inspected. Earlier #1167 images named voiceover/earlier-turn showed a different viewport with folded rows; those are not reused as before evidence.

## Executed validation

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
