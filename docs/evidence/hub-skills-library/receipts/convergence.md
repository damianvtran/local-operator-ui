# Fresh-main convergence — refined compatibility proofs PASS; parent accepted

## Scope, heads and disposition

- Capture/evidence head: `43fc66a1b97e2b3bc892635dd378dc4dfd0514c8`.
- Frozen captured-product base: `8057f32ff`; selector baseline `6c0e483de`.
- Incoming main: `51a2eccfb936eb44340dbc25bad00b04f1b39d01`.
- Local SHA-preserving merge: `1912dc7fac252a30fb66d02f65fc9e6a436617ec`, parents old evidence head and incoming main. Git ort merged cleanly; no manual conflict resolution or root/worktree interference.
- Chronology: the initial literal source-byte STOP preserved the local merge without push. Parent then authorized bounded classification and refined runtime proofs; after they passed, parent accepted retention of all67 frames and **authorized a normal evidence-branch push**. Final remote verification is reported externally. No recapture, application build, native boot, full suite, PR or main merge was performed.
- Implementation/proof work used the session's recorded fallback provenance **openai/gpt-6.1-sol**; no model settings or tool permissions were changed.

## Proof A — original task remained exactly the same

`convergence-range-diff.txt`: all **seven original commits are `=`**, retaining their original SHAs. Other entries are incoming main history, not task commits.

`convergence-proof.json` compares:

```
git diff --binary --full-index -U0 8057f32ff 43fc66a1b
git diff --binary --full-index -U0 51a2eccfb 1912dc7f
```

Results: task file sets equal; path-qualified added/removed line multisets equal; **entire binary patch bytes equal**, not merely the line counts. Both are **+2674/-9**, 86 task files. There are **zero merge-resolution deviations**. Added convergence receipt files/documentation in the later documentation commit are a separately identifiable addendum, not incoming product work and not part of this preserved patch comparison.

## Proof B — captured dependency source envelope

An artificially narrow component-only set would miss shared initialization. `convergence-src-capture.tsv` and `convergence-src-merged.tsv` record Git blob identities for **the entire `src/` tree**, deliberately a conservative superset of the loaded dependency closure, not a claim that every file was painted. It covers Skills page/library/publication/hooks/API, consent/policy primitives, common controls, app/sidebar layout, CSS/theme and source i18n. `convergence-incoming-files.txt` lists all incoming changed paths; **28 are in src/**. Explicit SHA256 pins for the library roots, directly consumed desktop hooks, shared store/contract, generated i18n and lockfile are in `convergence-dependency-pins.json`.

The page directly imports `desktopFeatureEnabled`, `desktopFeatureState`, `useDesktopCapabilities` from `@shared/api/local-operator/desktop-hooks` (agent-hub-page.tsx lines1–6). Thus that file is a genuine captured dependency, even though its single changed line is erased at runtime. Shared UI-preferences initialization is also genuinely on the captured shell path: chat-sidebar.tsx imports the store at line77 and reads existing sidebar/palette selectors. Main desktop transport imports/uses the shared runtime contract (desktop-transport.ts lines5,94,318).

**Source-byte identity fails**, so it was not certified. The following classification does not silently waive that original requirement.

### Per-hunk classification and paint-path result

| Changed file/hunks | Classification | Reaches captured flow / effect |
|---|---|---|
| desktop-hooks.ts:193 `DesktopFeature` adds `"session_files"` | TYPE ONLY, erased | Page imports this module, but the feature is a TypeScript union, not a runtime const/list. Full emitted module is byte-identical. No new capability gate or painted value. |
| ui-preferences-store.ts:18 import | MIXED | `type FinderPreferences` erases; DEFAULT_FINDER and sanitizeFinderPreferences are runtime imports. New finder-layout module has pure constants and sanitizer declarations, not an eager fetch. |
| ui-preferences-store.ts:71 state shape | TYPE ONLY | `finderFiles`/`setFinderFiles` type declarations erase. |
| ui-preferences-store.ts:1878 version3→4 | RUNTIME | Persist middleware sees a different schema version on the captured shell's shared store. Cannot honestly call the entire dependency unchanged. |
| ui-preferences-store.ts:1891 defaults/setter | RUNTIME | Store initialization executes in the shell. Adds finderFiles default and a setter, leaving all existing sidebar/palette defaults unchanged. Actual finderFiles readers are only finder-files-view.tsx:137,138,904; that canvas is not mounted on /agent-hub. |
| ui-preferences-store.ts:2825 hydration | RUNTIME | Adds only sanitized finderFiles to merged state. No existing sidebar key is rewritten by this hunk. Shared hydration is executed/reachable, though its newly added field is unobserved by Skills. |
| ui-preferences-store.ts:2897 migration | RUNTIME | For stored version<4 adds only sanitized finderFiles. Existing migration branches remain unchanged. This is an actual global initialization-path delta, not erased code. |
| desktop-contract.ts:1571 two schemas | RUNTIME | Adds sessions.files and sessions.files.materialise discriminators to shared Zod union. Existing Skills/capability/auth discriminators remain byte-identical. New requests are not emitted by the Skills scene. Union construction itself is on the main transport path. |
| desktop-contract.ts:5024 read-only set | RUNTIME | Adds sessions.files only. Existing captured operations' membership is untouched. |
| desktop-contract.ts:6485 dispatch cases | RUNTIME | Two new cases only; each captured existing request still selects its old, unchanged branch. No existing hub/chrome endpoint rewritten. |
| keys.gen.ts | MIXED | New MessageParams members erase; new enUiCanvas import/spread is real runtime code. English messages consumed by Skills are unchanged, with no new-key collision (proof below). |

### Emitted-JS proof, not an app build

`convergence-compile.mjs` ran the **existing esbuild.transform**, per module, loader ts / format esm / target es2022 / no source map, with source obtained directly from Git refs `43fc66a1b` and `51a2eccfb`. No bundling, installing or app build. Full source and output SHA256 values are in `convergence-emitted-hashes.json`.

- desktop-hooks full emitted output both refs: `86fcf11093c829de865594b8dd9c7c76eaece700d8d9568ed1b04e99ec40ec58` — **equal**.
- Preferences full outputs differ (runtime hunks above). Removing only the added type import and two type fields from the new source leaves emitted bytes **equal** to the unmodified new emission (`05123a70327e9005e7ef4929d91b1a0b90c12a3bc1131aec1fb7828f6a4d4e09`). Thus those isolated type hunks erase, without claiming runtime equivalence of the complete module.
- keys.gen full outputs differ (real namespace import/spread). Removing **only** the new runtime canvas import/spread while retaining every new MessageParams declaration yields output **equal** to old (`2a654037e77168e9b9172bf3c43de273d50e5cf50d3dcdfa72d0bf244baab0e8`). This isolates erasure from the runtime addition.
- desktop-contract full emitted output differs: all its listed additions are runtime. No type-only waiver asserted.

## Proof C — incoming streams and additional dependencies

| Stream | Primary evidence and compatibility classification |
|---|---|
| #1039 | Already the frozen base8057; original seven evidence commits unchanged, exact patch identity above. Core library/page/hooks/policy/consent/CSS bytes remain unchanged aside from the already captured selector additions. |
| #1080 (merge2f84e482e) | Finder files and shared store/contract/runtime-i18n additions. **Not globally byte-compatible** with the captured dependency envelope. Detailed runtime boundaries above. New canvas rendering, session-files hooks and chat-content changes are outside /agent-hub's mounted content; shared initialization still executes. |
| #1073 (merge25940fa7f) | French console copy/control changes do not paint in these English /agent-hub captures, but generated-key and onboarding changes were checked rather than omitted. Onboarding modal's action container gains flex-wrap/justify-end; captures seeded onboarding-complete, so modal is absent. |
| #1075 (merge51a2eccfb) | Ledger assembly, receipt and audit/test tooling changes; no additional captured product module changed by this stream. Existing fixture asset pins remain historical, not asserted as rebuilt fresh-main binaries. |

Additional real changed dependencies disclosed:

- **dev-driver/install.ts:** imports finderThumbnailStats and adds filesFacts verb. Driver installation executes, but only initializes counters/maps/queues; no thumbnail read starts without a finder subscriber. Skills does not call filesFacts. Existing Skills verbs remain unchanged.
- **onboarding-modal.tsx:** runtime className change on an absent seeded-complete modal; no captured modal pixels.
- **i18n:** `convergence-english-messages.json` hashes all14 pre-existing English namespace files. Only ui.console changes; **zero existing message values changed**. New ui.canvas has57 keys and **zero collisions** with existing English keys. ui.hub file/message bytes are identical. This proves consumed-message compatibility, not generated-file byte identity. French console is not selected by the captures.
- **CSS/theme:** no incoming changed `.css` or theme path. Package dependencies/lock and electron-vite config unchanged; package.json changes only `scripts.test:desktop`, not runtime dependencies/build settings.
- **Other changed src paths:** canvas views/media/file actions/session-files and console panes are listed in `convergence-incoming-files.txt`, not silently excluded from the envelope. Their content surfaces are not open in these captures; shared store/contract/generated messages were treated separately above.

## Initial literal-rule verdict (superseded by refined parent proof ruling)

**Proof A PASS. Literal proof B FAIL. Semantic classification: shared store hydration/version and runtime request-union construction do execute in captured shell/request paths; therefore this is not an all-type-only convergence.** New Finder fields and new endpoint branches have no identified painted Skills consumer, but module initialization bytes are genuinely different. Retaining all67 frames as fresh-main runtime proof requires an explicit parent ruling; this receipt does not supply that approval.

If the parent requires a discriminating runtime check rather than source classification, the proposed minimum is existing **R-A dark populated**, **R-G light populated** and **R-H actual800 populated** states, using fresh isolated profile hydration and current shared contract, checking sidebar/default preference projection, Skills capability/scope/row reads, and no modal. These three cover the changed shared initialization across the captured shell layouts/themes; there is no source evidence requiring repeating all67 states. This is a proposal for approval only: **no captures or builds were run**.

At this initial STOP checkpoint, no push had been attempted. The later refined acceptance and push authorization below supersede that checkpoint; final remote verification is reported externally. Parent owns independent convergence review.

## Refined parent ruling — executed runtime compatibility proofs

The parent explicitly replaced the blanket byte requirement for these shared modules with compiled type-erasure, full existing-key projection, captured-request-shape replay, and top-level purity proof. The following are fresh executions, not inferred from unchanged screenshots.

### Exact commands and outputs

```sh
node docs/evidence/hub-skills-library/receipts/convergence-compile.mjs
node docs/evidence/hub-skills-library/receipts/convergence-runtime.mjs
```

Both use existing esbuild, with no installs, application build, native process or capture. The first is per-module transform. The second follows the repository's `scripts/right-slot-memory.test.mjs` pattern: a bounded Node-only module compilation of store and shared contract, with real Zustand/source helpers. An esbuild onLoad handler loads every repository TS/JS/JSON dependency from its nominated Git ref; it does not accidentally read current source for the old case. Source hashes and emitted module hashes are retained. localStorage is a fresh in-memory map, never the operator's storage.

Actual runtime command output:

```json
{"oldKeys":83,"persistedKeys":23,"projectionCases":100,"changedExisting":[],"addedKeys":["finderFiles","setFinderFiles"],"requestCases":17,"valid":15,"refused":2,"allIdentical":true}
```

- **Preferences:** compares ALL83 original state/action keys, including function-source identity, not just a hand-picked Hub subset. All23 original persisted fields appear in the seed. Empty/all-default/per-field-perturbed scenarios run migration versions0/1/2/3 and merge projection,100 cases. Every original key compares equal. Only the newly added finderFiles is removed from migration-object comparison; added setter is separately reported, not an omitted existing field. A v3 sentinel object proves current migration adds/sanitizes finderFiles and leaves every other property, including an unknown sentinel, unchanged. This is finite concrete projection coverage plus exact added-hunk analysis, not an exhaustive proof over arbitrary corrupt JavaScript objects.
- **Request replay:**15 valid shapes cover capabilities, local skills list, Hub links, account/memberships/org agent/team/skills list/detail, org/public pull, org/public preview and confirm publication. Two direct regression negatives (mismatched tenant/visibility, missing confirmation receipt) refuse identically. Parsed objects, endpoint method/path/body, actual private READ_ONLY_OPS membership and deadline-detail output all compare equal. READ_ONLY_OPS is exposed only by a proof export appended to the instrumented module; its implementation is unmodified. Inputs are reconstructed from exact source hook/proxy operations and fixture names, with a fixed synthetic UUID in place of the original non-retained random request ID. **Not claimed as raw wire-body replay.**
- **Purity:** `convergence-finder-layout.js.txt` is actual emitted JS; `convergence-finder-purity.json` pins it. Zero emitted imports. Top-level is literal constants, arrays, function/arrow declarations and exports; no eager call, fetch, timer, listener, DOM or storage side effect. The real module is also executed in the new preferences proof.
- **Actual proof-module closure:**73 old source files /74 current; changed entries are only new finder-layout, store and desktop-contract. `convergence-runtime-closure.json` names them; the complete per-ref SHA256 source lists are in runtime-results. This Node closure is not misrepresented as the full renderer closure; the whole-src manifests and painted-core proof remain separate.
- **Painted core:** `convergence-painted-core.json` names143 library/page/hooks/policy/API/primitives/CSS/theme/message paths, **zero changed**. Broader shared dependencies are handled explicitly above, not excluded to manufacture a byte pass. All14 pre-existing English namespaces retain every existing message value; added57 canvas keys have zero collisions. Package dependency versions/lock/build config remain unchanged; only test:desktop script changes.

### Refined terminal classification

**PASS for the parent's bounded compatibility proof set:** type-erased desktop hook emission unchanged; existing preference projections unchanged; captured Hub/Skill request semantics unchanged; pure finder import; original painted core/CSS/input semantics and consumed English messages unchanged. No behavior difference was observed in the discriminating Node paths. Thus there is no identified rendered invalidator requiring new frames under the refined rule; existing67 remain historical captures supported by this compatibility evidence, not freshly rebuilt native frames.

The earlier proposed three-frame check was a conditional proposal under the literal-rule proof gap, **not executed and not now asserted necessary**. No numerical contrast re-audit was done here. No source or response shape outside this bounded proof is silently certified. The parent accepted the refined proofs and explicitly ruled that all67 frames are retained with no reaching behavior change. A normal push of this evidence branch is authorized; no PR, new capture or merge-to-main is authorized. The final commit/remote SHA comparison is reported in the handoff rather than inventing a self-referential commit hash in this receipt.

