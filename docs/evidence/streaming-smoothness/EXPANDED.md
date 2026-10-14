# Expanded transcript window and formation evidence

2026-10-13. Implementer: coder / **openai/gpt-6.1-sol**, actual temporary fallback after Anthropic quota exhaustion. This supplements the earlier PR #1021 evidence; it does not replace independent review, QA, design or UX rounds.

## Source and scope

Captured the final source-working-tree implementation with the harness browser tool against its Vite Storybook at port 6006. Shared dependencies remained symlinked; no new worktree or project dependency. Synthetic records, isolated server/test HOME, telemetry opted out (`telemetryOptedOut: true` in each capture). These are **Storybook renderer** measurements, not native Electron/backend proof, real durable storage, or foreground 60fps evidence. All new `*-fixed` artifacts below belong to this pass; unsuffixed exploratory JSON is historical and not final-source evidence. `windowed-formation-mid.json` is explicitly marked FAIL.

The feature remains **default off**. Opt in with `localStorage.setItem('canonicalTranscriptDomWindow', 'on')` and remount, or build with `VITE_CANONICAL_TRANSCRIPT_DOM_WINDOW=1`. Local `off` overrides build opt-in.

The expanded implementation adds measured chronological entry windows after the unchanged model partition, disjoint always-mounted state leases, width/signature cache checks and frozen per-kind estimates, shared pager/layout transactions, target-mount navigation adapters, session-associated expansion state, and stable scalar shells for atomic two-inline-to-one-fold formation. Unsafe-state majority / more than 64 pins explicitly falls back rather than destroying local state. The off path skips DOM-window measurement observers and DOM-window per-commit entry geometry reads. After unified round-two remediation it also skips the window hook's coordinator begin/commit/retarget path entirely; the unchanged intrinsic pager still owns its existing held-anchor measurement/correction. The original tail-only profile did not establish an absence of held-anchor reads.

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

## Unified round-two remediation: new motion and lease-flow proof

2026-10-13. Coder / **openai/gpt-6.1-sol**, actual temporary fallback after Anthropic quota exhaustion. The artifacts in `remediation-*` are fresh harness-browser captures of the source working tree, including these fixes, with real Storybook stylesheet and fonts at **localhost:6041**. They are **renderer/Storybook** evidence, not native Electron, durable backend, hardware gestures, or foreground frame pacing. Server HOME was isolated, inherited CMUX variables absent, telemetry disabled/blank synthetic key and client output `telemetryOptedOut: true`. No new worktree or project dependencies were installed. Eleven new frames are palette-named `remediation-<state>/localOperatorDark.png`, so the pixel predicate actually judges them. All eleven were inspected as a contact sheet; the turn midpoint, first tool paint and jump frame were also opened at readable resolution.

### Replaying the narrow controls

Use the **manager URL**, not a bare `iframe.html`, with story `chat-streaming-smoothness--motion-paths`. Append `&motionCapture=tool|answer|turn&cssSample=0|1|2`; optionally `&narrow=1`. These invoke the same visible story button handlers after fonts are ready and a 500ms settle, remounting the opt-in window. Actual CSS animations/transitions are paused and stepped using `Animation.currentTime`; the 180ms production cleanup deadline alone is suspended (bounded at 120s), and restored on release/unmount. A hidden same-origin mirror of the visible story report, `[data-lo-renderer-proof]`, lets the harness's top-document read action retrieve the iframe's actual numbers without browser-script injection. The frame retains Storybook manager chrome.

| Motion case | Actual stepped values | Result |
|---|---|---|
| Live non-answer tool arrival, 0/120/240ms | Actual row ink opacity **0 / 0.934096 / 1**; ink and shell height **20 / 20 / 20px**; parent payload opacity **1 / 1 / 1**; exactly **1** CSS animation, `lo-transcript-arrival`, duration **240ms**; upstream context document Y **5156.6875px** in every sample | PASS: final layout exists from first paint; ink only |
| Settled assistant append negative control | **0** animations in the appended answer shell; actual ink and parent opacity **1** at all three samples; shell **54.3984375px** throughout; exactly **1** payload | PASS: no extra parent fade |
| Live completed-turn entries become a bar, 0/90/180ms | Scalar shell height **42 / 35.171875 / 34.6953125px**; intrinsic payload **34.6953125px** throughout; payload opacity **0 / 0.934096 / 1**; exactly **2** CSS transitions (height + opacity), each **180ms**; upstream document Y **5156.6875px** unchanged; **1** payload, **1** bar, **0** inline tool rows throughout | PASS: one new tree, no duplicated outgoing payload |
| Narrow neighboring turn-bar midpoint | Canvas clientWidth/scrollWidth **390 / 390px**, no horizontal overflow; same **42 / 35.171875 / 34.6953125px** shell path; upstream document Y **6615.625px** unchanged within all three samples; **1** payload / **1** bar | PASS for this 390px renderer fixture, not a device matrix |

JSON outputs: [tool first](remediation-tool-0.json), [tool mid](remediation-tool-1.json), [tool settled](remediation-tool-2.json), [answer control](remediation-answer-control.json), [turn first](remediation-turn-0.json), [turn mid](remediation-turn-1.json), [turn settled](remediation-turn-2.json), [narrow turn](remediation-turn-narrow.json). Corresponding frames are in the identically named directories, file `localOperatorDark.png`. A capture race is named rather than hidden: the first freeze attempt stepped the animations correctly but a later remount settled the window between the report read and the shot, so the committed midpoint frame was re-taken from the live paused state and the recorded sample and the frame now agree (both show one `2 actions` bar, zero inline rows). Turn fixture marks its answer `complete=true, streaming=false`; its synthetic working-line caption remains present, exercising a settled cycle while the surface is still live rather than an idle-session transition. `opacity` reads the first animated target; **`parentOpacity`** is the discriminating payload opacity for the turn's height/opacity pair.

### U2: actual production adapter, focus and DOM Range

Story `chat-streaming-smoothness--lease-interactions` uses a scoped synthetic `window.api.desktop.request` transport, restored on unmount. It serves only a one-tick synthetic manifest; other requests refuse with 404, never reach an operator session/backend. `&flow=jump|focus|selection` invokes the corresponding visible button. DOM APIs and synthetic scroll events are explicitly the input instrument, not physical keyboard dispatch.

| Flow | Actual DOM assertions/output | Result |
|---|---|---|
| Jump to old loaded user row 140 via shipped checkpoint rail → jump loop → mount adapter | Before: **10** mounted entries, target absent. On landing: **11** entries including target140, `data-jump-highlight` present, target top offset **24.2421875px** (the shipped top-fade landing inset), scrollTop **-5933.5**; fetchedPages **0** before/after, exactly **1** manifest request and **0** sessions.history requests | PASS. `data-jump-highlight` is the observed attribute at landing measured from the live DOM; the committed frame is the stable post-release sample and shows the landed, still-highlighted target row 140 anchored at the scrollport top (the highlight band is visible), with the landing inset measured above |
| Focus a row Copy control, programmatically move the window and append | Before/after document.activeElement: **BUTTON / Copy / smooth-u-190**; **sameElement=true, connected=true**; window changes from **10** tail entries to **17**, rows162–177 plus disjoint focused190 island; scrollTop **-3089.5**, window remains on | PASS DOM focus retention during a real component window move |
| Range spanning an originally omitted boundary, then append outside it | Initial tail selection engages explicit full-DOM `reason=selection`; extend message-text endpoints user140→assistant199; selected text **9779→9779** chars, **sameText=true**, both endpoints connected; **61** mounted entries and **0** spacers after append | PASS story-driven DOM Range retention. The first exploratory whole-row range included the tail answer's ephemeral action/time footer (9864→9779); final endpoints select message text rather than decoration legitimately moved by answer election |

Outputs: [jump](remediation-jump.json), [focus](remediation-focus.json), [selection](remediation-selection.json), with corresponding `remediation-<flow>/localOperatorDark.png` frames. This closes only the harness-dispatchable subset requested for U2. **Unverified:** physical Tab/keyboard navigation and selection gestures, fast hardware scroll/blank-flash perception, persisted user-row expansion and media-bearing fold UX beyond the earlier independently exercised cases, native CSS reduced-motion preference, native Electron/backend, and responsive/theme matrices. The host does not expose key or selection dispatch; story DOM APIs are not relabeled as physical-input proof. Existing park/append fractional residual remains exactly as disclosed above.

### Code and CI remediation dispositions

- MINOR-1/NIT-2: coordinator begin/commit/retarget gated on requested; disabled hook regression includes a collapsed owner and a would-write-5px commit stub, asserting no transaction/write and no geometry reads. Off-path claim corrected above.
- MINOR-2: tail layout following requires **scrollTop === 0**, not the pager policy's 24px ownership epsilon; commit also rechecks following and input revision. Mounted pager regression begins at tail, dispatches a deliberate **-10px** scroll, commits/rebegins/commits and asserts **-10px** survives.
- MINOR-3: memoized key→descriptor Map replaces the per-element `entries.find` in commit and ResizeObserver scans.
- MINOR-4: successful later commit clears transient missing-held-node fallback; hook regression fails-open then recovers windowed projection.
- MINOR-5: role/aria-live now follow actual `domWindow.enabled`; short/fallback intrinsic transcripts retain log semantics.
- NIT-1: complementary checkpoint branch is plain else.
- NIT-3: **deferred**. Full signatures still provide exact stale-node/cache compatibility checks. Hashing both sides changes that correctness boundary and introduces collision policy; no measured DOM-attribute cost justifies expanding this bounded remediation. No follow-up issue created.
- Red CI source fixes: both CSS.escape call sites replaced with the established dataset-comparison idiom; no selector escaping dependency added. Flag-off adapter now skips its extra asynchronous pre-mount frame, restoring the existing synchronous refused-jump path. Both new DOM-window test lanes registered in test:desktop.
- Red Evidence Frames derived cause: `frames()` judges palette-named images; six existing non-palette `*-fixed.png` are accounted separately as unjudged, so the prior supplementary.frames=23 was wrong (**17 judged**). Eleven new palette-named frames yield **28 judged**, **34 total PNGs**, not a fabricated missing-file explanation.

## Earlier expanded-head automated gates (historical, not remediation-head claims)

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
