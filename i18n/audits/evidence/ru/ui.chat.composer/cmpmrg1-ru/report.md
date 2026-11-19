### Audit report — ru / ui.chat.composer / cmpmrg1-ru

Auditor: i18n-auditor, session d0f873a0bc82, model anthropic/claude-sonnet-5-5 (harness-reported, no fallback). Independent of the translators. Head 801b1ad29d4. Verdict: **passed** (0 blocker, 0 major, 1 minor, 1 nit).

Scope: the six delta keys of the merged file (secret_closure_notice from the branch; insert_transcript, insert_transcript_hint, send_recording, send_recording_hint, steer_hint from main). Other keys read for consistency only.

Hashes (at HEAD): en 1abe3bc2730635d6eae484b49bfafa1743dee3be1f0ca60863576632acb95f14 · context de9e346489f6df64bc3ff08abd1f8e0550e95e54e44b7c0ddda47897ff50e2dc · ru 96126dd7d640c3fd21768d478dfb32147e8a1c878f68b4d892f9631a74efaf7b.

Merge provenance: the ru file's other 66 values plus secret_closure_notice are byte-identical to the branch parent (5f28dd97e93); the five main keys are byte-identical to main (421813971dc); no key sits in neither parent; the key set equals English (72).

Mechanical: all six parse in intl-messageformat (ru and en), have no placeholders, tags or plural arms, are NFC, and keep Enter/Esc verbatim. Fit: 20/24, 41/48, 16/24, 44/48, 51/64 characters; secret_closure_notice has no hint. Repo test validators were not run (brief forbids vitest/tsc).

Findings
- F1 MINOR `insert_transcript` (+ `_hint`): «Вставить расшифровку» departs from the guide's transcript → «транскрипт». The sense here is the dictated text, so «расшифровка» is right and consistent (also «Расшифровать» in send_recording_hint). Keep; record the call in the ru style guide. Do not switch to «транскрипт».
- F2 NIT `steer_hint`: «Направить агента сейчас (Enter) · Esc остановит ход» — «направить» alone is slightly ambiguous, but matches the settled steer rendering in placeholder.waiting and mesh_approvals. Optional: «Дать агенту указание сейчас (Enter) · Esc остановит ход» (55 chars).

Per-key: see record.json `per_key_verdict`. Clean: send_recording, send_recording_hint (says there is no review step), secret_closure_notice (both facts in order, one em dash, terms match the neighbouring secret-ask copy, no security claim).

Limits: source/bytes reading only, no rendered frame; ru is LTR so no bidi check applies.
