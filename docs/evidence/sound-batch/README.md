# Named sound batches — fixture evidence

Implementation/evidence agent: coder, actual fallback model **openai/gpt-6.1-sol** (host switched after Anthropic quota exhaustion). No profile/model/tool settings changed. No merge, release, tags, issues, or human reviewer requests.

## Contract and limits

The source contract is harness commit `18a34a21c0`, `local_operator/tools/audio_tool.py:1032-1118`, not a hypothetical wire shape. The fixtures retain every `details.artifacts` item, its backend-authored name, digest, status, error, requested duration, and `cost_usd`/`cost.basis`. The total is the server's `cost_usd`/`cost.basis`; `cost_complete:false` labels a **known total** and preserves the unknown/late-charge caveat. The renderer never sums money. Fixtures compute their own illustrative receipt totals; none are live billing facts.

The result's N items are matched to existing session attachments **by digest**, not array position. Byte-identical audio coalesces to one Canvas entry by digest; the batch result still shows every named item. A regression test supplies two named requests sharing one attachment and verifies two existing players and separate costs. No second attachment store, Canvas index, fetch path, or audio engine is introduced.

These are **production-component Storybook fixtures**, not live batch generation or native app evidence. The generated PCM WAVs contain silence, and the production player decodes/plays those bytes without audible output. Live 10-success and 3-success/1-server-400 captures remain owed until both harness/UI changes land. TUI degradation belongs to the harness lane; this repository has no TUI renderer.

## Rendered comparison

All images below were captured using the harness `browser` tool, one background tab, at 1280 × 720 CSS px (PNG 2560 × 1440). Baseline production modules came from the prescribed merged UI `7b02644e9ba22ce328281602bdf78f7ceae5a343` in an isolated control worktree. Its only source edit was the identical fixture story, so the inputs and viewport match. The primary checkout was left untouched.

- `single-before.png` / `single-after.png`: **byte-identical PNGs**, SHA-256 `1375c46e8c380984ad422403d495708ea1ba490012c0a43add4646fb2a547885`. A one-item artifact array stays on the original rendering branch. This proves the fixture's existing single card is unchanged; it is not a new replay of the six already approved real-provider captures.
- `four-before.png` / `four-after.png`: same four attachments. Before: generic numbered players without per-item names/costs. After: backend names, duplicate disambiguation, per-item billed/estimated costs, total and summary.
- `five-after.png`: five entries; the same row layout and player.
- `ten-after-top.png` / `ten-after-bottom.png`: ten entries in a scrolling story container. The tenth waveform was reached through the real control; no fixed batch height clips the entries in the production component.
- `partial-after.png`: exactly three players and one verbatim `audio_rejected`/400 fixture reason. Success costs and known total remain visible; the result does not collapse to an error.
- `partial-playback.png`: the first success was played using the real button and silent WAV. Its real player reached **0:03 / 0:03**, with played fill; the failed neighbor remained visible and other players stayed idle.
- `all-failed-after.png`: the actual `isError:true` record arm, zero players, four names/reasons and honest costs. The card remains failed.
- `loading-after.png`: existing running media treatment before artifacts exist. No new loader, speculative names or estimated money is invented.
- `partial-initial.png` is an explicitly historical first-layout capture, superseded by `partial-after.png`.

The UI supports backend-defaulted names verbatim, arbitrary long-name wrapping, and duplicate names without dropping rows. A duplicate's display suffix is additional disambiguation; it never replaces the stored name or collides with another literal backend name.

The backend validates nonempty batches, so there is no supported empty-batch state to invent. Empty/malformed/one-item artifact metadata retains the existing rendering path; regression tests cover those negative controls. Missing attachment bytes continue through the existing unavailable/resolving attachment states.

### Geometry and source controls

Browser ancestor inspection measured the ten-item body at **512 × 1064.83 CSS px**, inside an unconstrained card of **512 × 1119.83** and a story scroll viewport of **1280 × 720**. The batch has `min-w-0`, wrapped names and no pinned height. The last player measured **512 × 44**. Browser `scroll` did not move the story's nested scroller on this host; clicking its last real waveform scrolled it into view. No new scrolling implementation was added to production.

`CanonicalAudio`, `SoundPlayer`, and `audio-engine-store` have **empty source diffs** against `7b02644e`. The player SHA-256 is `ea7782e22ac89cd63a9b02d680e99d8b9ad1a06e9d414456d0953b6d30fdba55` on both baseline and branch. The existing cost formatter was moved byte-for-byte to `sound-cost-caption.ts` and re-exported from its old module to avoid a circular batch/model dependency.

## Executed validation

```sh
node scripts/run-desktop-tests.mjs scripts/image-gen-card.test.mjs \
  scripts/tool-row.test.mjs scripts/sound-player.test.mjs scripts/audio-engine.test.mjs
pnpm check-types
node_modules/.bin/biome check \
  src/renderer/src/features/chat/canonical/{sound-batch-model.ts,sound-batch.tsx,sound-cost-caption.ts,image-gen-card-model.ts,image-gen-card.tsx,image-gen-card.stories.tsx} \
  src/renderer/src/features/chat/components/trace/tool-row-model.ts scripts/image-gen-card.test.mjs
git diff --check
node scripts/ci-scope.mjs --since 7b02644e9ba22ce328281602bdf78f7ceae5a343
```

Actual results: **150 tests passed, 0 failed**; main and renderer typechecks exited **0**; Biome checked all eight changed source/test files with no errors; `git diff --check` exited **0**. The scope classifier selected lint, types, unit, evidence and pack; its no-run mode is a plan, not a claim those full gates passed locally.

Targeted regression coverage includes partial/all failures, 4/5/10 layouts, names and duplicate-suffix collisions, shared digests, reverse attachment order, unchanged single/malformed metadata, nested billed/estimated basis, unknown/subtotal money, stopped batches and replay identity. Existing SSR `useLayoutEffect`/jsdom event warnings are disclosed, not suppressed. Full automated coverage is delegated to CI, not duplicated locally; independent QA/design/UX are separate required rounds.

Dependency preflight found the primary installed lock lacked four FormatJS packages required by this baseline. The initial narrow test passed with that mismatch disclosed, then the worktree received an APFS clone and `pnpm install --frozen-lockfile --ignore-scripts`; offline first failed on an uncached tarball, online succeeded in 20.6s. Final installed lock equals the worktree lock. No install wrote through a shared dependency symlink. Both Storybook processes use isolated HOME, `env -i`, telemetry disabled, and no live sessions.

## Reaching the fixtures

From this worktree, `STORYBOOK_DISABLE_TELEMETRY=1 pnpm exec storybook dev -p 6127 --ci --no-open`. Direct story URL: `/iframe.html?id=chat-image-generation--sound-batch-partial-failure&viewMode=story`. Other suffixes: `sound-batch-single-unchanged`, `sound-batch-four`, `sound-batch-five`, `sound-batch-ten`, `sound-batch-all-failed`, `sound-batch-loading`. The story wrapper supplies scrolling only; the production transcript supplies its existing scroll container.
