### Agent review — round 2 (Russian i18n audit)
Reviewer: independent lopdev reviewer, session 9db9e255c45c; openai/gpt-6.1-sol (actual served fallback model)
Scope: 2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82..269ef259c0523fd61c9f40b2a700bed27b838055

Assumed contract: Russian-only remediation audit, not a full code or other-locale review. Check RU-UP-01, all seven consumers of the new unnamed fallback, and no unrelated Russian drift. Fix/patch lane; bounded to 30 minutes. No product changes, commits, installs, screenshots, browser or release claims.

## Verdict: clean — TERMINAL
Zero in-scope BLOCKER/MAJOR. RU-UP-01 is fixed. Three unchanged round-1 NITs remain deferred.

**Final provenance ruling:** RU-R2-01 is a pre-existing malformed composition that this PR re-words, not a defect it introduces or makes reachable. It is a MAJOR-severity observation about existing code, explicitly **out of scope — pre-existing; non-gating**. The initial gating classification was incorrect: the old fallback already yielded «в this organization», and both heads disable the confirmation through `canEnableAutoPush={false}`. No newly reachable user-flow defect was demonstrated. This final ruling supersedes the provisional gating assessment; no tests were rerun or scope expanded.

## Plural fix
The explicit `=1` selector wins only at exactly one. `one` now uses the same genitive phrase as `few`, `many`, `other`. Actual formatting through the installed intl-messageformat dependency (also used by src/i18n/messages.ts), not a handwritten plural substitute:

| Count | Rendered clause |
|---|---|
| 1 | Владелец этой организации может включить его в консоли Radient. |
| 2 | Владелец любой из отмеченных выше организаций может включить его в консоли Radient. |
| 5 | Владелец любой из отмеченных выше организаций может включить его в консоли Radient. |
| 21 | Владелец любой из отмеченных выше организаций может включить его в консоли Radient. |
| 31 | Владелец любой из отмеченных выше организаций может включить его в консоли Radient. |
| 101 | Владелец любой из отмеченных выше организаций может включить его в консоли Radient. |

Also formatted 1.5 to exercise `other`. All arms are grammatical: «владелец» governs genitive; «этой организации» and «любой из отмеченных выше организаций» both fill that slot. The latter means an owner of any one of the indicated organizations, not one owner of all of them. Named organization substitutions retain the unchanged proper-name convention. No numeric count leaks into the hint. The same probe formats the old head: at 21, 31 and 101 it used the single-organization clause; the new head fixes exactly that distinction.

## New fallback: implementer is right, with an important qualification
**«без названия» is the right choice for the six noun-bearing frames.** It is a descriptive prepositional phrase (literally, without a name), not a claimed proper name. In lowercase without quotation marks it attaches naturally to the already inflected noun; it does not need to become accusative itself. The English sidecar's technical description of a NAME slot must not be mistaken for a requirement that the resulting Russian text look like a proper name.

Every consuming frame was formatted with the current value, old English fallback and proposed accusative alternative; full sentences are in renders.txt:

| Consumer | Current composed phrase | Assessment |
|---|---|---|
| intro.org | в организацию без названия | Correct directional accusative supplied by организацию. |
| not_leaving.org | Участники организации без названия | Correct genitive supplied by организации. |
| title.published_org | Опубликовано «Помощник» в организации без названия | Fallback attaches correctly; publication-state locative is coherent. |
| receipt.title_org | Опубликовано в организации без названия | Correct publication-state locative. |
| published.org_listed | в общих агентах организации без названия | Correct genitive modifier of общих агентах. |
| title.publish_org | Опубликовать «Помощник» в организации без названия? | Fallback attaches correctly; unchanged locative/directional preference remains prior RU-UP-04, not a new fallback defect. |
| ui.hub.subscriptions.enable_private | могут публиковаться в без названия без отдельного подтверждения | **Ungrammatical as a standalone composed string.** This frame supplies no noun, so the universal seven-frame grammar claim would be wrong. |

«эту организацию» improves only the seventh string («в эту организацию») and breaks all six noun-bearing strings, e.g. «в организацию эту организацию» and «Участники организации эту организацию». It is clearly worse as the shared value. Per-frame or, better, per-grammatical-role composition could make all seven strings ideal, but is not needed to fix the six reachable upload frames and would expand this delta unnecessarily.

The seventh string was investigated one step beyond the implementer's comment. upload-agent-dialog.tsx:956-958 passes organization=targetDisplayName AND canEnableAutoPush={false}. hub-initial-policy-fields.tsx:56 starts confirming at null; line 89 opens confirmation only under canEnableAutoPush; line 117 binds Dialog.open to confirming !== null. Therefore this upload path cannot open that seventh confirmation. The old head already passes false and formats the same hypothetical frame as «в this organization». The ru ui.hub.json frame and the control flow are unchanged. **Currently unreachable from this upload dialog**, so not a newly reachable user-flow regression; this is RU-R2-01, a pre-existing MAJOR-severity observation, not an in-scope gate. Do not claim the seventh sentence is grammatical or validated live. Before enabling upload auto-push, give that noun-free receiver its own noun-phrase fallback (e.g. «эту организацию»), rather than changing the value shared by the six noun-bearing frames.

Thus the implementer's six-frame case-government reasoning is right; rejecting it in favor of a global accusative would regress visible text. The comment's limitation about the seventh is real. I approve the modifier-shaped value for the six noun-bearing frames, but not the single-value solution across all seven: a separate noun-phrase variant is necessary for the noun-less frame.

## Drift, evidence and retained findings
- Parsed old/current ru upload maps: 46 -> 47 keys; only blocked_hint changed, only target.org_unnamed was added; all other 45 Russian values are identical. ru ui.hub.json is byte-unchanged across the delta.
- RU-UP-01: fixed at 269ef259c0523fd61c9f40b2a700bed27b838055, verified by before/after ICU output at 21/31/101.
- RU-UP-02, RU-UP-03, RU-UP-04: NIT, deferred — unchanged round-1 wording/consistency observations, no remediation required for terminal approval. Their original source and descriptions remain in the round-1 receipt; no re-audit or invented closure.
- Probe exit 0; assertions cover the plural result, no digits in the rendered hint, exact changed-key set and source-level gate for the hypothetical seventh receiver.
- One Node process, NODE_OPTIONS=--max-old-space-size=1024, no installs or servers. Catalogue-formatting evidence only; no browser tool is available in this role and no rendered desktop frame was captured.
- Pushed head verified with git ls-remote origin refs/heads/i18n/slice-upload-agent-dialog, yielding the full head above.
- No PR found by gh pr list --repo damianvtran/local-operator-ui --head i18n/slice-upload-agent-dialog --json number,url,headRefOid (actual output []). This round is retained locally for the manager; it has NOT been posted to a PR. No silent claim that a private record satisfies the PR gate.

Command (from the manager-owned worktree):
`NODE_OPTIONS=--max-old-space-size=1024 node i18n/audits/evidence/ru/ui.agents.upload/ru-upload-r2-9db9e255c45c/probe.mjs`

Citation triage: the named local-operator-ui round-1 receipt, its probe, ru upload and hub catalogue files, upload component, policy component and dialog wrapper were opened and RESOLVABLE. The old receipt was used as a prior ledger, not accepted as execution proof: current drift, plural behavior and fallback composition were independently re-derived. No UNRESOLVABLE or ABSENT citation is relied on.

Model provenance: began anthropic/claude-sonnet-5-5; provider-quota notices switched first to anthropic/claude-opus-5-5 and then openai/gpt-6.1-sol. All substantive diff reads, probes and verdict were produced after the latter notice. No role/default or tool configuration changed.

## RU-R2-01 — out of scope — pre-existing MAJOR; non-gating
**Problem / code path:** upload-agent-dialog.tsx:323-325 computes `targetDisplayName = … || t("ui.agents.upload.target.org_unnamed")`; :956 passes it as `organization` to HubInitialPolicyFields; hub-initial-policy-fields.tsx:133-135 formats `ui.hub.subscriptions.enable_private` with that value. The Russian catalogue's sentence begins `Будущие изменения {item} могут публиковаться в {organization}`. The new value produces `в без названия`, an actual malformed composition, not a stylistic preference.

**Reachability qualification:** upload sets `canEnableAutoPush={false}`; confirming starts null and can only be opened when that prop is true. Thus I did not reproduce a visible confirmation in the live UI, and do not claim one. The formatter invocation exists in the component's JSX and was reproduced directly with its installed ICU dependency. The old head instead produced `в this organization`; that was already untranslated and malformed. The composition defect is real, but predates this PR. It is retained as a non-gating pre-existing MAJOR observation, not an in-scope finding or a newly reachable user-flow regression.

**Obvious fix:** preserve `без названия` for the six noun-bearing frames; give the seventh consumer a separate noun-phrase fallback (e.g. `эту организацию`) or a complete dedicated unnamed-organization sentence, and pass/use it only there. Do not swap `эту организацию` into targetDisplayName globally. Add a regression assertion for the seventh composed sentence as well as the six name-slot sentences. A localized variant for the distinct grammatical shape is necessary for correctness across all seven; seven separate keys are not necessary when six genuinely share the same grammatical slot.

### Actual seven current outputs (copied from the successful execution log)

- `ui.agents.upload.intro.org`: «Вы собираетесь опубликовать набор инструкций этого агента в организацию без названия, где прочитать и установить его смогут только её участники. Публикуется то, что описывает агента:»

- `ui.agents.upload.not_leaving.org`: «С этого компьютера больше ничего не уходит: ни разговоров, ни истории выполнения, ни памяти, ни усвоенного, ни плана, ни конфигурации, привязанной к этому компьютеру. Участники организации без названия смогут прочитать и установить опубликованное; никто за её пределами этого не сможет.»

- `ui.agents.upload.title.published_org`: «Опубликовано «Помощник» в организации без названия»

- `ui.agents.upload.receipt.title_org`: «Опубликовано в организации без названия»

- `ui.agents.upload.published.org_listed`: ««Помощник» в общих агентах организации без названия как набор инструкций. Его могут прочитать и установить участники этой организации; никто за её пределами этого не может.»

- `ui.agents.upload.title.publish_org`: «Опубликовать «Помощник» в организации без названия?»

- `ui.hub.subscriptions.enable_private (hypothetical confirmation; upload disables auto-push)`: «Будущие изменения Помощник могут публиковаться в без названия без отдельного подтверждения. Их получат только те, у кого есть доступ к этой организации.»

### Alternative outcomes
- Shared accusative `эту организацию`: breaks intro.org (`в организацию эту организацию`), not_leaving.org (`Участники организации эту организацию`), title.published_org and receipt.title_org (`в организации эту организацию`), published.org_listed (`в общих агентах организации эту организацию`), and title.publish_org (`в организации эту организацию?`). It fixes only enable_private (`в эту организацию`). Full executions for each are retained in renders.txt.
- Separate key/variant per grammatical frame: no frame needs to break. Keep the noun modifier `без названия` for the six existing noun-bearing frames; use an independently selected noun phrase `эту организацию` only for enable_private (or supply a complete unnamed-case sentence). That is the fully correct composition, and better than a knowingly malformed seventh string. Dedicated keys need not be duplicated for six identical modifier contexts.

### Delivery
No PR exists by the manager's deliberate workflow; this report and the immutable receipt are delivered to the manager for posting when it opens. No PR comment was attempted. The earlier CLI lookup was informational, not a stalled dependency.

## Final disposition / fix location
RU-R2-01: **out of scope — pre-existing, non-gating**. Correct fix: in `hub-initial-policy-fields.tsx`’s `enable_private` composition, select a dedicated noun-phrase fallback («эту организацию»); retain «без названия» for the six noun-bearing upload frames. No new issue or product edit made.
