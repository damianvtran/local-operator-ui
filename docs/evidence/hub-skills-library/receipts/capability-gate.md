# PR #1099 unified B remediation — complete-adapter capability

## Source scope and contract

Baseline: `3b6e1a905cc89e19ea2c0d7b4517da08ed568e1b`, same evidence branch/PR. No speculative merge/rebase of later main, no version bump, no core adapter implementation. Current implementation model: `anthropic/claude-sonnet-5-5` (session-state); earlier capture/convergence fallback provenance remains historical.

The new OPTIONAL numeric feature is **`hub_skills: 1`**. It promises the COMPLETE initial Skills adapter: public/org remote reads, `org_skills.list` and `org_skill.get` credential proxy, local pull/install, initial publish preview/confirm and receipt/reconciliation contract. Neither `hub_links`, `skill_catalogue`, `radient_org`, nor remote revision-CAS can stand in for it. Future core must advertise it only when the whole contract exists. It is not added to the required backend feature set; working Hub links/agents/teams remain available on released core. `DesktopCapabilities.features` remains `Record<string, number>`; unknown keys retain the existing forward-compatible map behavior.

Page gating derives an effective Agents view in the SAME render whenever requested Skills is unsupported; an effect also normalizes stored selection so a later reconnect does not resurrect an old draft. Entry and mount are absent, not a broken clickable action. Both remote query hooks gate enablement AND re-check latest QueryClient capabilities before dispatch, including manual refetch/retry callbacks. Mutations perform the same latest-cache check. Failed negotiation cannot reuse stale positive capability data. No mock query engine or production cache-writing control was added.

## Actual released-core HTTP proof (not source inspection)

Current installed generation observed: `20261015T042511Z-0.71.5`.
A separately isolated HOME/config and synthetic desktop bearer launched that exact generation's `lop serve --host 127.0.0.1 --port 18328` in owned process group13954, then:

- `GET /v1/capabilities`: HTTP200; `hub_links:1`, `skill_catalogue:1`, `radient_org:1`; **hub_skills absent**. Exact full public response: `capability-released-core.json`.
- Authenticated `GET /v1/desktop/hub/links`: HTTP200, real empty inventory with `capability:"hub_links:1"`; exact response: `capability-released-links.json`.
- No Skills route was requested in this probe; no 404 or real install/publication claim. The later native fallback proof must establish that the renderer also starts no remote Skills work.
- Exact owned process group13954 was SIGTERM-reaped (exit-15). No operator daemon/config was touched. Current core owner remains separate; no duplicate adapter work.

## Targeted mounted/query and sibling-route proofs

Command:

```sh
node --test scripts/hub-skills-capability.test.mjs scripts/hub-links-scene.test.mjs
```

Actual result in `capability-gate-tests.txt`: **13 tests PASS, 0 FAIL**.

- Real mounted React Query hooks and real capability hook; only transport/API calls are instrumented. Explicit absent/unknown/zero capability => zero public/org list/detail calls and refused initial pull/publication dispatch. Extra future unknown key is preserved and cannot unlock Skills.
- Explicit `hub_skills:1` => all four public/org list/detail reads and initial pull/preview dispatch occur.
- Failed capability negotiation with stale positive data refuses work.
- A genuinely pending remote list read is held, capability withdrawn, response released; retained query/mutation callbacks then refuse additional work: **remote5→5, writes2→2**. This is hook/cache execution, not a native frame claim.
- Shared stub legacy inventory, policy PATCH and stale-revision refusal are exercised through actual loopback HTTP. No sibling full-capture reset.
- CLI test now parses true scene-list membership rather than requiring hub-links adjacent to none.
- Wire-state test reads ONLY direction constructor/default and direction({...}) fixtures, not unrelated local-link receipt states. Actual negative-control output: `{"bad":["not-a-wire-state"],"receiptMisclassified":false}`. Bad direction remains detected; production direction allowlist was NOT widened.
- Source test assertions cover effective selection/entry/mount; native proof remains separately required below.

Targeted source/test Biome checks have no errors (warnings retained, not silenced). Syntax checks passed for driver and stub. The new mounted regression is registered in test:desktop for terminal CI; no duplicate local full suite.

## Q3 — discriminating consent vectors, not a blanket preview refusal

The QA report's original row14 says HTTP200 WITH PREVIEW but does not retain dry_run/auto_push fields. Its stub log contains paths/statuses only, and its cited contract-fixture.mjs was absent from the retained QA directory. Therefore that reported preview by itself does NOT establish unsafe enablement. This limitation is explicit; no payload was invented or attributed to QA.

Fresh same-source control used the baseline3b6e1a905 stub with exact synthetic bodies; full vectors and responses are in `capability-consent-original-vectors.json`:

| Public request, auto_push=true / confirm_public_egress=false | Baseline actual result | Remediated actual result |
|---|---|---|
| dry_run=true preview | HTTP200, preview, no link | HTTP200 preview remains allowed |
| dry_run=false, receipt + confirm_publish=true | HTTP200, link.policy.auto_push=true (UNSAFE) | HTTP422 unsafe-publication, inventory unchanged |
| initial pull with future auto-push enabled | HTTP200, link.policy.auto_push=true (UNSAFE) | HTTP422 unsafe-publication, inventory unchanged |

Positive neighbors: public copy with auto_push=false and no grant remains HTTP200; explicit grant allows public pull and publication HTTP200. Preview is side-effect-free and may describe an unconsented draft; it is NOT future-auto-push enablement. The fix is in the fixture's fidelity only; released core has no initial Skills adapter to patch or certify. Original fixture process group18967 was reaped exactly.

## Unified review dispositions

- **B1:** supplementary declaration added BEFORE derivation. Real `frames()` returns0 judged Skills frames; all original67 are state-named PNGs. In-memory true deriveFields after declaring the set yielded584 inside/807 outside,13999 swept judged frames,1728 surfaces,12 sweep themes,218 supplementary sets. These are pre-new-fallback counts, not blindly stamped final values. Final walk/fold/countsMean prose and gate must be re-derived AFTER new fallback PNGs exist.
- **Q1:** fail closed behind complete-adapter capability; do not claim released-core Discover/Pull/INSTALL. Actual0.71.5 capability/working-Hub HTTP proof above; native fallback still required.
- **Q3:** preview framing qualified; demonstrated unsafe fixture writes fixed with direct negative/positive neighbors above.
- **M1:** future emitted geometry uses top-level requestedSize, actualSizeProvenance and measured viewport; geometry holds measured boxes only. Historical H remains source+PNG-derived800 with no fabricated live read. No nested future-schema overwrite.
- **M2:** shared stub changes are additive plus async handler conversion from historical captures; current legacy route regression passes, not a claim the old hub-links frames were recaptured against this stub.
- **M3:** controls/ is an empty, untracked output directory left by the separate controls boot; its evidence is receipts/run-ctl.log, not missing screenshots. It is documented, not destructively removed.
- **N1:** scoped tabGeometry template indentation aligned. **N2:** historical live-read limitations remain next to the geometry provenance discussion.
- **D39 / U1:** deferred — minor tab background-color transition with correct selected semantics/stable geometry; retain the pair for independent judgment, no polish/recapture here.
- **U2:** deferred — minor lack of explicit busy text while disabled, not a duplicate-write or task failure; avoid unrelated UX change in this gate fix.

## Native chronology — original build PASS, then separately authorized Skills-only boots PASS

Product source changed, so reusing historical compiled assets would be invalid. ONE fresh stub-pointing build completed under the original24GiB build rule. Its next24GiB boot admission was refused, as recorded below. The owner subsequently authorized a distinct20GiB-start/18GiB-abort **boot-only** continuation with exact source/assets reuse, not a blanket waiver or another build. R-I/R-J then completed; original67 PNGs remain unchanged, no full matrix.

Actual cell job `78cd2433d301`, leasePID21374/helperPID21384/buildPID21397 started2026-10-15T01:26:13.741654-04:00. Prelease25846792KiB; before build25701984KiB (24.511322GiB), swap9966.69MB/memory-free50%. Build exited0; all five pinned product/driver/stub sources were unchanged during compilation. New compiled guard was found in `agent-hub-page-DQIxKetH.js`. `capability-compiled-identity.json` pins source and new assets; `capability-cell.log` retains the actual output. Built HTML connect-src is only self +127.0.0.1:8127.

Immediately before the next core/origin dispatch the exact Data volume fell to24615088KiB (23.474777GiB), swap9958.69MB/memory-free45%. The helper STOPPED before starting ANY core/stub/Electron process; the completed build process was reaped, no8127/18328 listener remained, lease released. This is **successful build + refused native dispatch**, not a passing fallback cell. No automatic second build, lease or native retry was queued. The new gate build may be reused only after source/asset pin identity and fresh resource admission are proven.

Completed continuation job `1b01b0465928` used actual isolated0.71.5 for R-I (16 PASS/0 FAIL) and the explicit future-adapter fixture for R-J (21 PASS/0 FAIL, including the actual30s capability watch). Both measured1380×900 CSS pixels/DPR2. See `capability-boot-reuse.json`, `capability-boot-cell.log`, `capability-native-results.json` and **`capability-native-observations.md`** for all4 viewed PNGs and actual limits: old R-I's0×0 display:contents wrapper is not overflow evidence; old R-J's undefined agent count is a fixture pagination omission, corrected later at source. Start23204872KiB/swap10645.5MB/memory41%; end23260856KiB/swap10629.5MB/memory48%; continuous3s disk watch stayed above18GiB. All core/stub/app groups were reaped;8127/18328 empty.

These cells prove the **Skills gate only** and preceded the separately requested minimum-core0.72.1 mutation guard. They do not prove the underlying core policy/merge fixes or the later guard. See `minimum-core-guard.md` for that distinct source/runtime scope, its exact new build and any capture recovery. Final manifest/frozen-head gates remain a separate requirement; no merge/version/release is claimed here.
