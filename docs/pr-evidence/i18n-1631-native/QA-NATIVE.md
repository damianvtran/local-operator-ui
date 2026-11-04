### QA report — round 2

Reviewer: qa-tester — **openai/gpt-6.1-sol (actual execution)**. Requested header was anthropic/claude-sonnet-5-5, but own persisted usage.provider/model_id and native_replay metadata record GPT for round 1 and every round-2 continuation. Earlier Sonnet/no-fallback claims were incorrect.
Head: 6fe683b6d7aae8c80e4faeb215139d057b1e1400
Scope: ae0c38872982c2f47c035b6e042572162de4d43a..6fe683b6d7aae8c80e4faeb215139d057b1e1400; bounded census targets, C1/C2 and direct neighbors only.
Verdict: **PASS — TERMINAL for the bounded localization/census scope**, using the executed native cells below together with the retained discriminating 2/2 remediation runtime tests and unchanged formatter/CLDR evidence. No new locale-introduced Q-code defect established. Uncaptured native permutations remain explicitly unproved, and the pre-existing narrow wake pane is NOT passed. This is not whole-UI completion or merge/CI clearance. Native slot is released; no more capture or tests requested by this report.

Operator request verbatim: “Make sure to continue the work all the way for all languages to get the entire UI completely translated” and “Also some of the toast notifications like the update notification, etc. are not translated (we don’t need to translate the change log but we do need to translate the other stuff and the toasts)”. Acceptance for this bounded slice: seven target locales plus English effort labels/status, armed-wake count/once, real settings/negotiation reactivity, main untitled tab localization while retaining remote titles, native RTL shortcut ordering. Non-goals: entire UI completion, changelog translation, unrelated memos/picker rewrites or general narrow-layout remediation.

## Environment, build, admission and execution

One current-head app built in the existing worktree with matching-lock donor dependencies. Electron45.1.0 package and binary verified. Both lock SHA256 values: `3c8154767ff17d8b7e038df2eb5104ef948c214fbbb75f433865b3915c60589b`. Only the owned worktree's dependency symlink was repointed; no install/copy/new dependency tree.

Corrected build: existing `scripts/run_bounded.py --timeout 420 --memory-mb 4096 -- node node_modules/electron-vite/bin/electron-vite.js build`, heap3072MiB; actual exit0, wall163.1s. Explicit synthetic OAuth strings, loopback API49461, disabled backend manager, empty PostHog key and telemetry off. Build-only `NODE_PATH` exposes the already-present lock-matched Babel arrow plugin7.25.9/core7.26.10 parent because default donor-root resolution failed. **Not a stock default build pass.** Earlier environment/Babel setup failures and failed disk admission remain in the existing report history/scratch logs.

**Admission error disclosed:** build printed actual load21.69 (>20 build limit) but my shell did not fail-close it. Disk16.69498GiB and memory78% passed; load did not. This was QA's procedural error, not product evidence or an authorized exception. No additional rebuild.

Before ANY app/daemon launch, an executable Python supervisor then enforced capture load<=25, memory>=40%, disk>=15GiB, active-heavy<=2. Negative control: synthetic load25.01, other measurements passing => **exit75, `launch_called:false`**. Actual admission => load19.281738, memory78%, disk17.837990GiB,0heavy. The actual launch callback ran only after this gate passed. Proof: `gate-negative.json`, `gate-actual.json`.

Command: fail-closed `native-gate.py` -> `run_bounded.py --timeout 1100 --memory-mb 4096` -> isolated `native-supervisor.py` -> existing renderer-driver API, one headless Electron app + one owned real loopback daemon. No browser engine installed/scripted. Renderer pixels come from the actual app's `webContents.capturePage()`. Synthetic HOME/config/cwd/session IDs; inherited CMUX/LOP/XPC removed; no live user sessions/customer data/provider credentials. All scripts/logs remain session scratch. Source/output identity is recorded in `build-receipt.json` (182 compiled-file hashes).

## Bounded-acceptance reconciliation

The earlier overall BLOCKED verdict treated unexecuted native permutations as mandatory even though the bounded acceptance can be proved by independent layers. I reconciled the actual execution receipts against the original scope and read independent designer round2 comment6602893791, which is CLEAN—TERMINAL on this exact head. This changes the scope-level verdict, **not the facts or coverage of any cell**, and requires no new launch/test or empty re-pin round.

- Correct display words and counts: eight-locale native effort/status and count2/once screenshots plus unchanged formatter tests for0/1/2/21/1000 and CLDR plural categories. No requirement to render every count permutation natively is introduced.
- Locale reactivity:29 real settings.edit operations and visible retained views supply the actual app path; C1 frozen-reference and C2 delayed-main-ordering invariants are discriminating production memo/projection runtime tests (old0/2, fixed2/2), not object-identity claims inferred from pixels.
- Urdu readability: actual current native glyph order and source-provenanced baseline pair exercise the shared isolation mechanism. Uncaptured sibling tooltip combinations remain limits; the designer independently found no distinct new hazard requiring a broader sweep. That is their shared-mechanism judgment, not my claim of additional execution.
- English/wire/title preservation: unchanged source/catalogue compatibility, exact English focused tests, raw localized picker submission test and current remote-title retention provide complementary proof.
- Russian800 effort fit is observed; narrow wake pane16px also fails the same-code English control, so it is a non-gating pre-existing layout limitation, not narrow success or a localization regression. Earliest<1.6s flash testing and whole-UI completion are not asserted.

No unresolved required defect or proof gap remains for these bounded paths. Every native-unobserved row below remains labelled BLOCKED/unproved **for that native permutation**, without escalating nonrequired permutations into an overall release gate. Designer sign-off is attributed to the independent designer; QA reaches its own bounded PASS from the layered execution above. The build load21.69 admission mistake, existing-plugin NODE_PATH accommodation and synthetic OAuth fixture disclosures below are unchanged.

## Actual matrix

| Cell | Actual operation and response | Verdict |
|---|---|---|
| Real language owner/negotiation |29 locale operations invoked actual `window.api.desktop.request({op:'settings.edit',key:'language',value:<locale>})`; real main IPC/transport -> owned daemon -> config/capabilities negotiation. Successful receipts status200, document lang matches all seven targets+en. No JS setLocale, localStorage language override, catalogue override or DOM text replacement. |PASS for this IPC/settings path; not a pointer-click language-dialog test |
| Retained Settings effort list, fr/es/zh-CN/ru/vi/ur/hi/en | Actual listbox stays open while language changes, no reload; native first/settled frames contain localized Low/Medium/High, then English control. |PASS |
| Retained session EffortPicker/status, same eight locales | Real own session `e3b04624ee62`, OpenAI o3/high; native dialog contains localized three labels and selected high tick, status reading behind modal changes too. No model-provider request sent. Native contact sheet visually inspected. |PASS at1380CSSpx |
| Wake count+once, same eight locales | Two actual synthetic wakes created through real `POST /v1/desktop/wakes` status200. Open wake pane stays mounted across locale switches; title/count/cadence visibly change, messages remain `QA localization synthetic wake 1/2`. |PASS at1380CSSpx for count2/once |
| C1 frozen-frontend identity native assertion | Native pane retained; only language settings changed during that sequence, but exact frontend object identity/absence of every background frontend event was NOT instrumented in native app. |BLOCKED for strict native frozen-identity claim; original-source0/2/current2/2 production memo tests separately prove exact stable-reference behavior |
| C2 main existing projection | Browser renders actual owned daemon `/docs` title `Local Operator API - Swagger UI` beside app-created blank tab `نیا ٹیب`; actual settings.edit ur→fr while view remains open gives `Nouvel onglet`, remote title unchanged. No user browser navigation/tab action/reload between comparison commands91–94. |PASS for retained native projection; intentionally delayed main-capabilities ordering remains lightweight-test proof, not a native fault-injected delay |
| Urdu reload native glyph | Real enabled reload tooltip actual DOM `<bdi dir="ltr">⌘R</bdi>`; captured native pixels visually read **(⌘R)**. Same-site retained earlier baseline reads **(R⌘)**. `ur-reload-before-after.png` inspected. |PASS for reload glyph order |
| Urdu sidebar plain accessibility strings | Actual button aria includes LRI/PDI around `⌘N`, `⌘P`, `⌘K`; no manual locale override. |PASS for inspected attributes only, not native tooltip-family coverage |
| Urdu modifier/arrow/shift tooltip families, composer/inline edit/settings search/team composer | No native tooltip frames for these changed call-site families in this bounded run. |BLOCKED, not promoted from SSR/source evidence |
| Narrow effort dialog | Failed native-window resize reported innerWidth1380 and was NOT counted. CDP metrics emulation then verified inner/client/visual width800. Russian dialog576px, client/scroll574/574; options550/550. Native800 frame inspected, no label clipping. |PASS for800CSSpx emulated viewport, not OS-window resize |
| Narrow wake panel | At800CSSpx, pane is only16px wide in English AND fr/ru/ur. English `· once` x782..816.60; Russian x782..858.95; Urdu x−20.14..18. Existing run-details/layout bytes unchanged in this PR. Same-code English image confirms clipped baseline layout, not a locale-introduced regression. |NOT PASS; baseline observation, outside localization remediation scope |
| Native count0/1/21/1000 and crowded effort before/after pairs | Count2 native only; prior all-count formatter matrix retained. Crowded effort matched-width baseline pair not completed. |BLOCKED for additional native claims; no baseline build or further capture |

Actual displayed labels/once:

|Locale|Low / Medium / High|Once/count2|
|---|---|---|
|en|Low / Medium / High|once /2 wakes armed|
|fr|Faible / Moyen / Élevé|une fois /2 réveils activés|
|es|Bajo / Medio / Alto|una vez /2 despertares activados|
|zh-CN|低 / 中 / 高|一次 /2个唤醒项待触发|
|ru|Низкий / Средний / Высокий|однократно /2 пробуждения запланированы|
|vi|Thấp / Trung bình / Cao|một lần /2 lịch thức dậy đã đặt|
|ur|کم / متوسط / زیادہ|ایک بار /2 بیداریاں فعال ہیں|
|hi|कम / मध्यम / उच्च|एक बार /2 जागृतियाँ सक्रिय|

Technical identifiers/model names/raw wire tokens/remote document title are intentionally not translated. Synthetic wake messages are authored content. The isolated no-provider session initially shows loading and later provider-access refusal; this run does not claim a real model response/provider authentication. Prior one localized `Faible` click -> raw `args:"low"` test and22 identical source/catalogue blobs retain round1 evidence; no duplicate full suite/count matrix.

## Frames, geometry and first/settled limits

34 captured states,68 native frames. Each pair: first capture after a1.6s locale-settle delay (or current explicit scene setup), then capture700ms later. **Not first locale-change paint**, so no claim about the first1.6s transient reflow.11/34 full-frame pairs have identical pixels;23 differ (e.g. toast/transcript/cursor changes). All16 scoped wake/effort-dialog target crops across eight locales are pixel-identical within their observed first/settled pair; crop coordinates/diffs are in `target-pair-checks.json`. This does not substitute for an earliest-frame animation capture. Native bitmap vs emulated viewport mismatch/black backing in browser frames is disclosed in baseline provenance; compare the verified chrome region, not black remote-page backing.

Viewed actual settled native full frames, both contact sheets, Russian800 dialog, English800 clipped wake control, Urdu native glyph crop and before/after pair. Geometry explicitly sampled on list/dialog/narrow count controls; do not infer a complete DOM-overlap audit from these samples. Cropped contact sheets intentionally omit portions of headers; full frames remain alongside them.

Baseline image was captured by an earlier independent QA run, not here. Its retained manifest names `e42a6d69154cfb847987fa9981ee514c44eca508`; same800CSSpx/native2760x1800 and exact BrowserUrlBar reload call-site verified. File diff changes raw shortcut interpolation to ShortcutText/isolateLtr (back/forward analogues only); original image SHA/source path retained in `retained-baseline/provenance.json`. No old image is labelled current-head evidence.

## Explicit finish and cleanup

Command127 `finish` answered `finishing`, intentionally ending the capture after scoped cells/control. Driver log: `[native1631-finished] stopping 1 app(s) this run started`; existing driver stops the exact Electron child handle with SIGTERM/SIGKILL fallback and waits for exit. Supervisor logged `OWNED_DAEMON_REAPED 51601 -15`; bounded command exit0, wall427.7s. Post-cleanup `ps` readback matching owned profile `lo-renderer-driver-51708/userdata-native1631` plus Electron executable, driver path plus Node, and Python daemon port49461 found **zero matches**. The inspection-shell false positive from an initial broad string query was excluded by executable-qualified verification. `cleanup-verified.json` records the check. This is actual cleanup evidence, not just supervisor exit0.

All native processes ended; E01 owner was told the slot was released. No capture retry/build follows. Remaining blocked cells are explicit evidence limits; no invented locale FAIL and no designer sign-off implied.

Durable evidence root: `docs/pr-evidence/i18n-1631-native/` — full `frames/`, `effort-contact-sheet.png`, `wake-contact-sheet.png`, `ur-reload-before-after.png`, build/gate/cleanup/capture-pair receipts and command/observation JSON. Scripts and full logs: this session's scratch `qa1631-r2/`.
