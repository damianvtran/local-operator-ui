# fr · ui.chat.composer · merged-file delta audit (cmpmrg1-fr)

Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR, 1 INFO)
Auditor: i18n-auditor, session 9a8cf2fffd64, model anthropic/claude-sonnet-5-5 (session header; no fallback observed)
HEAD: 801b1ad29d47bbb89a0768e0ea1f193892db953d (worktree clean at start; nothing but this bundle written)
Date: 2026-11-04

## Hashes (computed from the files on disk at HEAD)
- en  src/i18n/catalogues/en/ui.chat.composer.json: 1abe3bc2730635d6eae484b49bfafa1743dee3be1f0ca60863576632acb95f14
- ctx src/i18n/catalogues/en/ui.chat.composer.context.json: de9e346489f6df64bc3ff08abd1f8e0550e95e54e44b7c0ddda47897ff50e2dc
- fr  src/i18n/catalogues/fr/ui.chat.composer.json: d40ca3b6771c39fd126e481f7e4c4b4065edbc68877307441b54336093ac2a93
- glossary ~/local-operator/i18n/glossary.md: 0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8
- style guide ~/local-operator/i18n/style-guides/fr.md: ae1519ab7617d19aa826918d607de1d018595094166edbc18aa58f6a8f0a4226

## Mechanical
- Key sets en = fr = 72, no added/dropped (python set diff). All six values NFC, no edge/double spaces, no bidi/zero-width chars.
- None of the six English strings contains a placeholder, ICU plural/select or markup; none introduced in fr. No plural categories needed.
- `node scripts/i18n/context-parity.test.mjs` 8/8 pass; `composer-machine-anchors.test.mjs` 3/3 pass.
- `node scripts/i18n/locale-parity.test.mjs`: fr 'not an English stub' fails on 3 keys, all in ui.chat.pickers (slash.source.effort/agent/title_refresh), NOT ui.chat.composer — outside this audit's scope, pre-existing, reported for the manager only.
- `node scripts/i18n/ledger-check.mjs` (read-only) shows the expected 3 stale/unnamed-bytes findings for fr/ui.chat.composer, which a receipt naming these hashes resolves.

## Per-key
| key | fr | verdict |
|---|---|---|
| secret_closure_notice | Répondez à la demande de secret dans le panneau des demandes — ce champ reste en pause jusqu’à votre réponse, et votre brouillon est conservé. | OK; F1 MINOR |
| insert_transcript | Insérer la transcription | OK (24/24 cells; not 'confirm', per context) |
| insert_transcript_hint | Insérer la transcription pour la relire (Entrée) | OK (48/48; Entrée per fr key-cap precedent, F2) |
| send_recording | Envoyer l’enregistrement | OK (24/24) |
| send_recording_hint | Transcrire et envoyer maintenant, sans relecture | OK (48/48; 'sans relecture' states the no-review step plainly) |
| steer_hint | Orienter l’agent maintenant (Entrée) · Échap arrête le tour | OK (59/64; 'Orienter' matches placeholder.waiting 'Orientez l’agent'; 'le tour' matches placeholder.stopping 'Arrêt du tour') |

## Terminology and register
- vous/imperative-infinitive for control labels, matches style guide and siblings (confirm_recording, cancel_recording, stop_agent).
- transcript -> transcription (glossary + fr locale call). enregistrement for recording matches start/confirm/cancel_recording. 'demande de secret' and 'panneau des demandes' match placeholder.secret_answer and ui.chat.asks.* ('demandes'). 'brouillon' matches ui.settings/ui.common.errors. 'ce champ' for the composer has precedent in delivery_remedies_hint ('au-dessus de ce champ'); the 'champ secret' collision in secret_fill_* is real but the notice sits directly above the box and names the panel first, so not a MAJOR.
- Typography: ’ elisions and spaced em dash / middle dot consistent with the file; no ? : ; ! in the six, so no U+202F needed.

## Findings
[
  {
    "id": "F1",
    "severity": "MINOR",
    "key": "ui.chat.composer.secret_closure_notice",
    "current": "Répondez à la demande de secret dans le panneau des demandes — ce champ reste en pause jusqu’à votre réponse, et votre brouillon est conservé.",
    "problem": "EN says the box is paused 'until it is answered' (the request, passive, answerable from any surface). 'jusqu’à votre réponse' ties the unpause to the reader's own answer; if the request is answered elsewhere or by another route, 'votre réponse' is slightly narrower than the source. Meaning is otherwise preserved (asks panel named, pause stated, draft kept, no security promise, em dash and clause order kept per context).",
    "suggested": "Répondez à la demande de secret dans le panneau des demandes — ce champ reste en pause tant que la demande n’a pas reçu de réponse, et votre brouillon est conservé."
  },
  {
    "id": "F2",
    "severity": "INFO",
    "key": [
      "ui.chat.composer.insert_transcript_hint",
      "ui.chat.composer.steer_hint"
    ],
    "problem": "Context sidecar says 'keep the key name exactly as written (Enter/Esc)'; fr correctly uses the French key caps Entrée/Échap, matching shipped siblings (confirm_recording_hint, placeholder.waiting, placeholder.aside). Not a locale defect; the sidecar note is what is imprecise. No change requested."
  }
]

## Safety
Notice makes no promise about encryption, storage, attempts or budget (per context note). send_recording_hint states plainly that there is no review step.

## Limits
Text-and-sidecar audit only; no rendered-fit screenshots (maxCells is advisory; width counted by East-Asian-width display cells). I did not read the translators' commit text and did not edit any catalogue, ledger or receipt.
