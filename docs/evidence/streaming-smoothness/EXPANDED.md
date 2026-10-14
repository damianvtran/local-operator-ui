# Expanded transcript window and formation evidence

2026-10-13. Implementer: coder / **openai/gpt-6.1-sol**, actual temporary fallback after Anthropic quota exhaustion. This supplements the earlier PR #1021 evidence; it does not replace independent review, QA, design or UX rounds.

## Source and scope

Captured the final source-working-tree implementation with the harness browser tool against its Vite Storybook at port 6006. Shared dependencies remained symlinked; no new worktree or project dependency. Synthetic records, isolated server/test HOME, telemetry opted out (`telemetryOptedOut: true` in each capture). These are **Storybook renderer** measurements, not native Electron/backend proof, real durable storage, or foreground 60fps evidence. All new `*-fixed` artifacts below belong to this pass; unsuffixed exploratory JSON is historical and not final-source evidence. `windowed-formation-mid.json` is explicitly marked FAIL.

The feature remains **default off**. Opt in with `localStorage.setItem('canonicalTranscriptDomWindow', 'on')` and remount, or build with `VITE_CANONICAL_TRANSCRIPT_DOM_WINDOW=1`. Local `off` overrides build opt-in.

The expanded implementation adds measured chronological entry windows after the unchanged model partition, disjoint always-mounted state leases, width/signature cache checks and frozen per-kind estimates, shared pager/layout transactions, target-mount navigation adapters, session-associated expansion state, and stable scalar shells for atomic two-inline-to-one-fold formation. Unsafe-state majority / more than 64 pins explicitly falls back rather than destroying local state. The off path skips measurement observers and per-commit slot geometry reads.

## F5: derived cause and connected fix

Cold navigation with `&fastFormation=1` automatically remounts flag-on, sets scrollTop=-100, dispatches reader input and freezes the third-tool formation at 90ms **in the same task**, with no inter-click settle waits. The story records the first frame and another after `document.fonts.ready` plus two animation frames. The first frame alone was a false pass: `FontFaceSet.loadingdone` subsequently cleared both exact measurements and frozen estimates. Instrumented descriptor snapshots found the first omitted entry (`smooth-u-146`, unchanged signature and width810) switching from measured74.3984375 to heuristic70.4; all57 entries lost measurements, and only the10 mounted entries remeasured. The omitted prefix consequently lost95.890625px. This was not model trimming, inline duplication, or the intended shell shrink.

`invalidateEntryMeasurements` now **demotes exact measurements into frozen estimates before clearing exactness**. Omitted entries retain their last-known scalar until they can remount and measure; mounted entries remeasure normally. Width and render-signature incompatibilities still reject the old estimate. No spacer clamp, scrollTop override, or production diagnostic was retained.

Connected negative control: reverting only the hook's invalidation call restored spacer5023.890625→4928 and upstream documentY5802.2734375→5706.3828125 after the late font event. Reapplying the call produced the passing artifact below. The actual hook regression fails with the old call (first prefix20→13, full prefix diverges) and passes with the fix.

Regressions:
- `font invalidation demotes omitted measurements without collapsing the formation prefix` — pure contract, including width/signature rejection.
- `late font loadingdone preserves omitted prefix extents while remeasuring mounted entries` — actual hook + DOM font-event wiring.

| Fast formation state | Top spacer | Context documentY | scrollTop | Shell height | Inline / fold |
|---|---:|---:|---:|---:|---:|
| Before, fonts loading | 5023.890625 | 5802.2734375 | -100 | 42 | 2 / 0 |
| 90ms first frame | 5023.890625 | 5802.2734375 | -79.5 | 21.4453125 | 0 / 1 |
| Font-settled frame | 5023.890625 | 5802.2734375 | -79.5 | 21.4453125 | 0 / 1 |

[Full actual output](windowed-formation-fast-fixed.json). [Before pixels](windowed-before-fixed.png), [90ms pixels](windowed-mid-fixed.png), [cold fast-sequence frame](windowed-formation-fast-fixed.png).

## Final-source renderer matrix

| Surface / action | Actual result | Status |
|---|---|---|
| Mixed, flag off/on | 36→15 entry mounts;640→284 nodes; equal3097px extent;3 disjoint state pins; remains windowed | PASS |
| Off mixed,20 synchronous token flushes | rectReads0;styleReads0;mean2.49ms;max4ms | PASS (excludes deferred observer/paint) |
| Synthetic durable older page landing | fetched60→80;pages0→1;mounted10→17;older `smooth-u-134` mounted; remains windowed | PASS renderer fixture only |
| Equal extent redistribution | H6650→6650;scrollTop-3089.5→-3059.5;max anchor frame delta0px across20 samples | PASS |
| Park/append, flag on | mounts16→16;H6561→6650;scrollTop-3000.5→-3089.5;max anchor frame delta **0.203125px** | **FAIL against literal0px requirement** |
| Same-source park/append, flag off control | H6561→6596;scrollTop-3000.5→-3035;max anchor frame delta **0.1015625px** | Control also not literal0 |
| Reduced-motion JS fixture | shell42→20 immediately, phase settled;0 inline/1 fold;spacer/context unchanged;scrollTop-100→-78 | PASS JS policy only |

The fractional park/append residual is recorded rather than rounded away. It is consistent with the host's half-pixel scrollTop steps, but browser quantization was **not independently proven**. The new omitted tail entry initially contributes an estimate rather than its actual mounted height, so the on/off total extents differ after append. No blanket zero-drift claim is made.

Reduced motion uses the story-local `&reducedMotion=1` matchMedia fixture. It exercises the production shell's immediate-swap branch, **not native OS/browser preference emulation or CSS media-rule behavior**; the original API is restored on story unmount. Native reduced-motion/CSS validation remains unverified.

Outputs: [mixed off](mixed-flag-off-fixed.json), [mixed on](mixed-flag-on-fixed.json), [off flush profile](mixed-profile-off-fixed.json), [durable before](durable-before-fixed.json), [durable after](durable-after-fixed.json), [park](park-on-fixed.json), [append on](append-parked-on-fixed.json), [append off visible browser output](append-parked-off-fixed.txt), [equal extent](equal-extent-fixed.json), [reduced JS](windowed-formation-reduced-js-fixed.json). Frames: [mixed off](mixed-off-fixed.png), [mixed on](mixed-on-fixed.png), [reduced JS](windowed-reduced-js-fixed.png).

## Automated gates actually run

All commands used a fresh isolated HOME and `env -i`, stripping inherited CMUX variables. Dependencies were the existing symlinked tree. Targeted tests ran serially through the repository's memory/lane-bounded desktop runner.

```sh
node scripts/run-desktop-tests.mjs \
  scripts/transcript-dom-window.test.mjs scripts/transcript-dom-window-hook.test.mjs \
  scripts/transcript-perflush-perf.test.mjs scripts/streaming-markdown-parity.test.mjs \
  scripts/trace-fold-behaviour.test.mjs scripts/transcript-paging.test.mjs \
  scripts/transcript-paging-hook.test.mjs scripts/reveal-record.test.mjs \
  scripts/use-active-checkpoint.test.mjs scripts/transcript-deep-jump.test.mjs
pnpm lint
pnpm lint:scripts
pnpm check-types
pnpm check-themes
```

- Targeted matrix: **175/175 PASS**,0 fail,0 skipped,14.511s. Existing active-checkpoint harness act warnings remain; they were not suppressed.
- Perflush6/6: existing A2/A3/A6/A7 guards pass; A2 cue-scan/query work remains0 per flush.
- Lint: exit0,1291 files checked,168 existing whole-tree warnings.
- Scripts lint: exit0,6 changed scripts clean against fork point732f216.
- Types: exit0,main and renderer.
- Themes: exit0,generated CSS fresh;34140 contrast assertions across59 themes.
- Evidence manifest contracts: **52 PASS,0 FAIL,1 SKIP** (shallow-history ancestry check); fresh committed source/script tree stamps and six added screenshot counts verified. This is not a remote-citation ancestry claim.
- `git diff --check`: exit0.

Full automated coverage is left to CI, rather than duplicating its whole suite locally. No independent QA/design/UX or fresh expanded-head review verdict is claimed. No merge, version bump, reviewer request or handle tag was performed.
