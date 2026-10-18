# Named sound batches — fixture evidence

Implementation/evidence agent: coder, actual fallback model **openai/gpt-6.1-sol** (host switched after Anthropic quota exhaustion). No profile/model/tool settings changed. No merge, release, tags, issues, or human reviewer requests.

## Contract and limits

The source contract is harness commit `18a34a21c0`, `local_operator/tools/audio_tool.py:1032-1118`, not a hypothetical wire shape. The fixtures retain every `details.artifacts` item, its backend-authored name, digest, status, error, requested duration, and `cost_usd`/`cost.basis`. The total is the server's `cost_usd`/`cost.basis`; `cost_complete:false` labels a **known total** and preserves the unknown/late-charge caveat. The renderer never sums money. Fixtures compute their own illustrative receipt totals; none are live billing facts.

The result's N items are matched to existing session attachments **by digest**, not array position. Byte-identical audio coalesces to one Canvas entry by digest; the batch result still shows every named item. A regression test supplies two named requests sharing one attachment and verifies two existing players and separate costs. No second attachment store, Canvas index, fetch path, or audio engine is introduced.

These are **production-component Storybook fixtures**, not live batch generation or native app evidence. The generated PCM WAVs contain silence, and the production player decodes/plays those bytes without audible output. Live 10-success and 3-success/1-server-400 captures remain owed until both harness/UI changes land. TUI degradation belongs to the harness lane; this repository has no TUI renderer.

## Rendered comparison

All images below were captured using the harness `browser` tool, one background tab, at 1280 × 720 CSS px (PNG 2560 × 1440). Baseline production modules came from the prescribed merged UI `7b02644e9ba22ce328281602bdf78f7ceae5a343` in an isolated control worktree. Its only source edit was the identical fixture story, so the inputs and viewport match. The primary checkout was left untouched.

- `single-before.png` / `single-after.png`: **byte-identical PNGs**, SHA-256 `1375c46e8c380984ad422403d495708ea1ba490012c0a43add4646fb2a547885`. This initial fixture used single-form billing fields and did not prove true one-item-batch handling; round-1 remediation below replaces that misleading shim with separate legacy-single and true one-item-batch stories. This proves the fixture's existing single card is unchanged; it is not a new replay of the six already approved real-provider captures.
- `four-before.png` / `four-after.png`: same four attachments. Before: generic numbered players without per-item names/costs. After: backend names, duplicate disambiguation, per-item billed/estimated costs, total and summary.
- `five-after.png`: five entries; the same row layout and player.
- `ten-after-top.png` / `ten-after-bottom.png`: ten entries in a scrolling story container. The tenth waveform was reached through the real control; no fixed batch height clips the entries in the production component.
- `partial-after.png`: exactly three players and one verbatim `audio_rejected`/400 fixture reason. Success costs and known total remain visible; the result does not collapse to an error.
- `partial-playback.png`: the first success was played using the real button and silent WAV. Its real player reached **0:03 / 0:03**, with played fill; the failed neighbor remained visible and other players stayed idle.
- `all-failed-after.png`: the actual `isError:true` record arm, zero players, four names/reasons and honest costs. The card remains failed.
- `loading-after.png`: existing running media treatment before artifacts exist. No new loader, speculative names or estimated money is invented.
- `partial-initial.png` is an explicitly historical first-layout capture, superseded by `partial-after.png`.

The UI supports backend-defaulted names verbatim, arbitrary long-name wrapping, and duplicate names without dropping rows. A duplicate's display suffix is additional disambiguation; it never replaces the stored name or collides with another literal backend name.

The backend validates nonempty batches, so there is no supported empty-batch state to invent. Empty/malformed or legacy single-form artifact metadata retains the existing rendering path; true one-item batches now use batch-exclusive contract discriminators, as recorded below; regression tests cover those negative controls. Missing attachment bytes continue through the existing unavailable/resolving attachment states.

### Geometry and source controls

Browser ancestor inspection measured the ten-item body at **512 × 1064.83 CSS px**, inside an unconstrained card of **512 × 1119.83** and a story scroll viewport of **1280 × 720**. The batch has `min-w-0`, wrapped names and no pinned height. The last player measured **512 × 44**. Browser `scroll` did not move the story's nested scroller on this host; clicking its last real waveform scrolled it into view. No new scrolling implementation was added to production.

At the initial reviewed head, `CanonicalAudio`, `SoundPlayer`, and `audio-engine-store` had **empty source diffs** against `7b02644e`. Round-1 remediation adds an optional batch-only owner override to `CanonicalAudio`; `SoundPlayer` and the engine remain unchanged, and the default single-form owner is unchanged. The player SHA-256 is `ea7782e22ac89cd63a9b02d680e99d8b9ad1a06e9d414456d0953b6d30fdba55` on both baseline and branch. The existing cost formatter was moved byte-for-byte to `sound-cost-caption.ts` and re-exported from its old module to avoid a circular batch/model dependency.

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

## Round-1 unified remediation — 2026-10-18

One implementation commit addresses code review `6250666393`, UX `6250676403`, design `6250710330`, and QA `6250718316`. Implementer actual fallback model remains **openai/gpt-6.1-sol**. Rows remain the design-ratified layout.

### Changed behavior and exact controls

- **One-item batch:** batch-exclusive counters/`cost_complete`, not attachment count, discriminate the batch. The false `count===1` billing-field shim is gone. The legacy-single story now explicitly has the actual single-form fields, while `sound-batch-one` uses the real nested-basis batch contract and shows its name and both cost levels.
- **Same bytes, separate requests:** only batch rows pass a stable request/row owner to the existing `CanonicalAudio` seat. Default single/digest owners, byte resolution, waveform cache, `SoundPlayer` and the one engine are unchanged. In a controlled before probe, loading `CanonicalAudio` verbatim from reviewed `fb5ecb221` reproduced **[playing, playing]** after row 1 Play. The revised real component/engine probe observes **[playing, idle]**, a playhead update only on row 1, then **[idle, playing]** on row 2 Play, and keyboard Space pauses only row 2. That probe uses a fake Audio element and controlled animation frames, not device/decoder proof.
- **Actual browser playback:** the remediated shared-digest story decoded the valid silent PCM. After row 1 Play the browser read **[0:03/0:03, 0:00/0:03]**; after row 2 Play **[0:00/0:03, 0:03/0:03]**. `r1-shared-first.png` and `r1-shared-second.png` record those separate playheads.
- **Counts and attention:** valid server counters win; unknown item status is explicitly unknown, never silently completed. The summary names only items needing attention, not every success again. Its measured partial-failure height is now **17.4 CSS px at 512px width** (one line), rather than the prior repeated-name index. Rows are semantic `ul`/`li`, with explicit `Failed`, `Stopped` or `Status unknown` state words. Error reasons are lifted to `text-body-sm text-ink`; costs are subordinate `text-meta text-ink-dim`; batch totals use `text-ink-muted`.
- **Money honesty:** a failed **billed zero** says `No charge.` A failed **estimated zero** says `Estimated cost $0; final charge not confirmed.` It must not be relabelled `No charge.` because an estimate is not proof of the final charge. Unknown values stay unknown and known-subtotal/late-charge caveats are retained; no UI sum or replacement amount.
- **Aggregate reason/class:** failed batches keep the model's error message/class, display the class, and show the server's aggregate cause as a note. The producer's first caption line carries `Batch time budget reached` / `Batch stop requested`; item-caption lines are already represented by rows and are not duplicated. Cancelled batches show the server's stop/cancellation caveat next to costs and item outcomes.
- **Running batch:** `args.sounds` or actual live `total` states the request count; the latest emitted `item`/`name` appears as **Latest update**, not as a fabricated completed counter. Carrier equality tracks these fields. The producer emits noncumulative per-item updates, so `item:3` is deliberately **not** called “3 of 10 done”. The fixture is responsive, including an explicit 390px-width story.
- **Material:** batch titles derive from material, covering the previously latent multi-artifact voiceover mislabel (QA Q1/design D5). The carrier's stale numbered-discriminator comments are corrected. Raw server failure wording remains verbatim intentionally; a future harness-copy change is out of this UI remediation, recorded here rather than filed as an issue.

### Re-captured delta frames

The approved `localhost:6127` browser surface worked in this coder session; no capture is claimed blocked. All are browser-tool captures of the current production components, not live provider/billing or native-app evidence.

| New frame | What it proves |
|---|---|
| `r1-single-after.png` | Explicit **legacy single**, byte-identical to `single-before.png`: SHA-256 `1375c46e8c380984ad422403d495708ea1ba490012c0a43add4646fb2a547885` |
| `r1-one-item-batch.png` | Actual batch-only discriminator, requested name, nested per-item/total costs; no shim |
| `r1-four.png`, `r1-five.png`, `r1-ten-top.png` | Ratified rows; concise counts-only success header; clearer money hierarchy |
| `r1-partial-after.png`, `r1-partial-narrow.png` | Attention name, explicit failure marker and lifted error; narrow content box **342 × 432.66 CSS px** inside a 390px fixture |
| `r1-cancelled.png` | Cancelled item, aggregate stop reason, unknown item cost and known-subtotal/late-charge caveat |
| `r1-unavailable.png` | Missing attachment and unknown per-item cost without inventing bytes or money |
| `r1-shared-first.png`, `r1-shared-second.png` | Actual silent PCM playback switches between separate named requests sharing bytes |
| `r1-loading-narrow.png` | Responsive batch request count and latest item, not invented completion progress |
| `r1-all-failed.png` | Explicit failure words and billed-zero versus estimated-zero wording |

These 13 new PNGs and the 12 initial PNGs are accounted using the shipped `unjudgedFrames` walker. The initial CI Evidence Frames job `117691041414` failed because the initial 12 frames were not reflected in the ledger (987 claimed outside versus 999 on disk). The remediated metadata-only walk derives **649 inside / 1012 outside / 25 batch PNGs**, and `unjudgedFrameFailures` returns **[]**. No frame is reclassified as a theme-sweep pass and no historical citation is changed. CI owns the full pixel sweep; it is not duplicated locally.

Additional story suffixes: `sound-batch-one`, `sound-batch-cancelled`, `sound-batch-unavailable`, `sound-batch-shared-digest`, `sound-batch-loading-narrow`, `sound-batch-partial-narrow`. One background browser tab was reused; it is closed after capture. All prior frames remain historical before-side evidence, not current-layout claims.

### Remediation validation results

`node scripts/run-desktop-tests.mjs scripts/image-gen-card.test.mjs scripts/tool-row.test.mjs scripts/sound-player.test.mjs scripts/audio-engine.test.mjs scripts/evidence-manifest.test.mjs` → **210 tests: 209 passed, 0 failed, 1 skipped**. The skip is the manifest historical-citation ancestry check: this shared repository answers `git rev-parse --is-shallow-repository` → **true**. The shipped manifest counts test passed. Main and renderer `pnpm check-types` passed. Biome passes on the nine source/test files in the complete PR; `git diff --check` passes. The explicit fake-Audio assignment follows the audio safety guard, and no test creates a real device element.

The base refresh observed `origin/main=76dda0304` versus the prescribed `7b02644e9`: upstream changed only `package.json` for the 0.35.1 release. The batch branch is rebased onto that base after the single remediation commit; the PR remediation comment records the resulting head, actual `range-diff` and byte-identity proof. Package version changes remain upstream-only, not part of this PR. Full automated coverage and the full evidence pixel sweep stay with CI; these targeted passes are not a claim that pending CI is green.
