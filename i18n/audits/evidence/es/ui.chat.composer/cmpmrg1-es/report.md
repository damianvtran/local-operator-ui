# Audit cmpmrg1-es — es / ui.chat.composer — delta audit of the merge (round 1)

- Auditor: i18n-auditor (team lopdev), session `bf2b29ee9a07`, model `anthropic/claude-sonnet-5-5` (read from the harness session header; no fallback observed, no pin applied). Independent: did not translate any of these values and edited no catalogue, context, ledger or existing receipt.
- Head: `801b1ad29d47bbb89a0768e0ea1f193892db953d` (merge of origin/main into `fix/i18n-four-flow-defects`).
- Inputs (sha256 at HEAD): en `1abe3bc2730635d6eae484b49bfafa1743dee3be1f0ca60863576632acb95f14`; context `de9e346489f6df64bc3ff08abd1f8e0550e95e54e44b7c0ddda47897ff50e2dc`; es `abe170ed1ff28951ea07eccc52af6f3c46fb987bdad3cdb7269c59eb03a2561e`.
- References read: `~/local-operator/i18n/glossary.md` (sha256 `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8`) and `i18n/style-guides/es.md` (sha256 `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e`, last commit e21f92fa4ee). Neither exists inside the UI repo; they live in the local-operator repo.
- Scope: six delta keys only. `secret_closure_notice` (ours; value identical to pre-merge parent 5f28dd97e) and five keys from main (`insert_transcript`, `insert_transcript_hint`, `send_recording`, `send_recording_hint`, `steer_hint`). I verified from git that the five main values in the merged file are byte-identical to `origin/main`'s es file and that no other main key differs in the merge. Other keys read only for glossary/register consistency.

## Mechanical
- JSON valid; 72 keys en = 72 es, no add/drop; context sidecar covers every key.
- None of the six strings has placeholders, ICU plural/select, markup or code spans (all six also format cleanly through intl-messageformat with `es`). Nothing to carry or CLDR-check.
- NFC, no leading/trailing/double spaces, no format/bidi characters.
- Key names `Esc`, `Intro` kept; the sidecar's "keep Enter exactly" is addressed in S1.

## Accuracy / idiom / terminology / fit (per key)
| key | es | verdict |
|---|---|---|
| insert_transcript | Insertar transcripción | OK. Matches "insert", not "confirm" (sidecar prohibits "confirm"); glossary transcript → transcripción. 22/24 cells. |
| insert_transcript_hint | Insertar la transcripción para revisarla (Intro) | OK. "to review" kept as purpose; tú-neutral infinitive label form; 48/48 cells (at the limit, not over). |
| send_recording | Enviar grabación | OK. Consistent with the Start/Confirm/Cancel recording family ("grabación"). 16/24. |
| send_recording_hint | Transcribir y enviar ahora, sin revisar | Meaning correct, "no review step" is conveyed; see N1. 39/48. |
| steer_hint | Guiar al agente ahora (Intro) · Esc detiene el turno | OK. "Guiar" agrees with the shipped `placeholder.waiting` "Guía al agente"; "el turno" agrees with `placeholder.stopping` "Deteniendo el turno"; `·` separator as source. 52/64. |
| secret_closure_notice | Responde a la solicitud de secreto en el panel de consultas — este cuadro está en pausa hasta que la respondas, y tu borrador se conserva. | OK. Both facts kept (paused until answered; draft kept), order and single em dash with spaces as the sidecar and es guide require; "consultas" = asks (same as `ui.chat.asks.*` and `placeholder.secret_answer`), "cuadro"/"borrador" match sibling copy; subjunctive "hasta que la respondas" correct; tú; no security/attempt-limit claims added. |

## Findings
- **S1 — MINOR — `ui.chat.composer.insert_transcript_hint`, `steer_hint`** — current: `(Intro)` / `Guiar al agente ahora (Intro)`. The sidecar says to keep the key name "Enter" exactly as written; es renders it as the Spanish key name `Intro`. I accept this: it is what `placeholder.waiting`, `confirm_recording_hint` and the ledger-audited `ui.chat.composer_media.confirms` line already use in this locale (4 uses in this file, consistent), and Spanish keyboards/Apple label the key "Intro". It does mean the sidecar wording is read as "keep the key name", not "keep the letters"; the repo's two other es files (`ui.miniView.hint`, `ui.teamBridge.composer.hint`) keep `Enter`, so there is a pre-existing cross-file split. Not gating; nothing in the six delta values needs to change. If the team wants one rule, decide it in the style guide, not per string.
- **N1 — NIT — `ui.chat.composer.send_recording_hint`** — current: `Transcribir y enviar ahora, sin revisar`. "sin revisar" can be read as describing the message ("unreviewed"); the sidecar asks to say plainly that no review step exists. Suggested: `Transcribir y enviar ahora, sin revisión previa` (46/48 cells). Optional.

No BLOCKER, no MAJOR. Verdict: **passed**.
