# Spanish upload-dialog translation audit — round 2

Reviewer: reviewer / openai/gpt-6.1-sol (actual fallback; Sonnet then Opus failed provider quota)
Scope: 2b72db6a56ad8204ec7f30a0ba6ffbc941be3b82..269ef259c0523fd61c9f40b2a700bed27b838055
Repository: damianvtran/local-operator-ui
Worktree: ~/local-operator-ui/.worktrees/i18n-s4
Date: 2026-11-08 · Lane: bounded fix audit (<2 h)

## Verdict: clean — terminal

Round-2 findings: BLOCKER 0 · MAJOR 0 · MINOR 0 · NIT 0.
ES-UPL-1 is fixed: `many` now has precisely the same ICU AST text as `other`; `one` remains the `org` argument.
`esta organización` is grammatical and idiomatic neutral Spanish in all seven consuming frames. No article, gender, number, or preposition mismatch appears; `en esta organización` and `de esta organización` are natural constructions.

## Executed plural checks

Executed the installed `intl-messageformat` dependency with Spanish rules, using committed catalogue values and `org: "Minerva Labs"`; no network, install or app process. Assertions passed for exact changed keys/files, zero removed keys, identical many/other ASTs, unchanged one argument, and all count/output combinations below.

- `0` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1` → `one`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de Minerva Labs puede activarlo en la consola de Radient.
- `2` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1.1` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `999999` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1000000` → `many`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1000000.1` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1000001` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `1500000` → `other`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `2000000` → `many`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.
- `10000000` → `many`: Compartir agentes dentro de una organización forma parte del plan Team. Un propietario de cualquiera de las organizaciones marcadas arriba puede activarlo en la consola de Radient.

The exact-million samples (1,000,000; 2,000,000; 10,000,000) selected `many`; 999,999, 1,000,001, 1,500,000 and the fractional sample 1,000,000.1 selected `other`. The integer-count production path (`blockedTargets.length`, dialog lines 1059–1064) does not yield scientific-notation exponent operands. `one` still names Minerva Labs. The same renderings from the previous head are retained in record.json as negative controls: the old `many` named Minerva Labs, while the new output correctly names any marked organization. Other sampled categories did not change.

## All unnamed-organization frames — actual ICU output

### `ui.agents.upload.intro.org` — PASS

Vas a publicar el conjunto de instrucciones de este agente en esta organización, donde solo sus miembros pueden leerlo e instalarlo. Lo que se publica es lo que describe al agente:

### `ui.agents.upload.not_leaving.org` — PASS

Nada más sale de esta máquina: ni la conversación, ni el historial de ejecución, ni la memoria ni los aprendizajes, ni el plan, ni la configuración específica de la máquina. Los miembros de esta organización pueden leer e instalar lo que publiques; nadie de fuera puede.

### `ui.agents.upload.title.publish_org` — PASS

¿Publicar “Asistente de prueba” en esta organización?

### `ui.agents.upload.title.published_org` — PASS

Publicado “Asistente de prueba” en esta organización

### `ui.agents.upload.receipt.title_org` — PASS

Publicado en esta organización

### `ui.agents.upload.published.org_listed` — PASS

“Asistente de prueba” está en los agentes compartidos de esta organización como conjunto de instrucciones. Sus miembros pueden leerlo e instalarlo; nadie fuera de la organización puede.

### `ui.hub.subscriptions.enable_private` — PASS

Los cambios futuros de Asistente de prueba pueden publicarse en esta organización sin preguntar cada vez. Solo pueden recibirlos las personas con acceso a esa organización.

## Consumer trace and drift proof

Direct source inspection in this repository: `src/renderer/src/features/agents/components/upload-agent-dialog.tsx:323–325` computes the translated fallback; `:504` stores it in `published.orgName`; `:190–203` supplies both title frames; `:854–866` supplies receipt title and listed body; `:969–982` supplies intro/not-leaving; `:956` passes it into `HubInitialPolicyFields`. `src/renderer/src/features/agents/components/hub-initial-policy-fields.tsx:133–136` supplies the seventh receiver, `enable_private`. Thus the nested confirmation is included, not only the six upload namespace messages.

Compared base/head catalogue JSON values and git changed-path list: only `target.blocked_hint` changed and `target.org_unnamed` was added in Spanish. All 45 other existing Spanish upload values are identical; no other Spanish catalogue changed, including `ui.hub.json`. English upload added only the new fallback key. The dialog's only executable delta is replacement of the English literal fallback with `t()`; the rest is explanatory comment. The generated type map adds only the matching key. No other Spanish copy drifted.

Prior-round source: opened this repository's `i18n/receipts/es-upload-r1-46b43b7fd549.json` and its canonical record. The two cited round-1 artifacts are RESOLVABLE and opened; the ES-UPL-1 repro was independently rerun, not accepted from the prior summary. ES-UPL-2, the optional public-intro wording NIT, is unchanged and remains deferred; it is not re-audited or counted as a new round-2 finding.

Style sources: ~/local-operator/i18n/style-guides/es.md (including exact-million plural rules) and ~/local-operator/i18n/glossary.md, with hashes recorded. This is a scoped linguistic/ICU-output audit, not browser/native fit evidence. No browser tool is available in this role, so no screenshots or visual-layout coverage are claimed. No PR exists per brief; no GitHub comment was attempted. No commit, catalogue, ledger, allowance, test or generated file was changed.

Harness note: the first ICU run passed its content assertions but failed at optional package-version metadata collection (`ERR_PACKAGE_PATH_NOT_EXPORTED` for `intl-messageformat/package.json`). Reran without that metadata import; the full scoped script exited 0. No service or persistent process was started.
