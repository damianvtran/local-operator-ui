# P7 Spanish independent translation audit — round 1

Verdict: **clean** (terminal for these six candidate values).
Counts: 6/6 keys audited; BLOCKER 0, MAJOR 0, MINOR 0, NIT 0.
Findings: none; no replacement wording requested.

## Provenance and scope
- Auditor: i18n-auditor (p7-au-es), session 038190a408cf.
- ACTUAL served model: openai/gpt-6.1-sol, as supplied by this run's runtime model header. No fallback model used.
- Translator: i18n-translator on anthropic/claude-sonnet-5-5, per delegation; candidate's model field agrees. I did not author or modify the translations. Translator session ID was not supplied.
- Date: 2026-11-11.
- Candidate: ~/local-operator-ui/.worktrees/_p7-prep/es.json.
- Source/context: keys.json plus callsites.md and risks.md in that directory.
- Read Spanish and English style guides and core glossary in ~/local-operator/i18n; compared relevant local shipped catalogues with origin/main at 3e48d8acb981b098bf512157ee0d1faf3f5fc3c9.
- No MT/translation service used. No repository, ledger, or candidate edits.

## Actual mechanical execution
Executed a Python 3 check against keys.json and es.json, exit 0. All checks true: valid JSON, locale es, exact key set, exact key order, all six nonempty strings, placeholder parity, no English-identical values, all NFC, no bidi controls. The five actor strings each retain only {at}; the audio string retains {current} and {total}. None contains ICU plural/select, markup, backticks, commands or flags requiring preservation. This was the task-requested candidate mechanical check, not a claim that the full repository validator ran.

## Per-key semantic and fit review
| Key | Current candidate | Assessment | Source/target characters |
|---|---|---|---|
| ui.library.preview.organized_by_agent | Organizado por un agente {at} | Correct indefinite agent, glossary agente, idiomatic with hace 2 h. | 26 / 29 |
| ui.library.preview.organized_by_librarian | Organizado por el Bibliotecario {at} | Correct definite article and exact shipped Bibliotecario term/capitalization. | 31 / 36 |
| ui.library.preview.organized_by_system | Organizado automáticamente {at} | Correct automatic organization without inventing an attributed person/agent. | 28 / 31 |
| ui.library.preview.organized_by_user | Organizado por ti {at} | Correct tú register; ti is the proper tonic pronoun after por. | 21 / 22 |
| ui.library.preview.organized_unattributed | Organizado {at} | Preserves absence of actor attribution. | 14 / 15 |
| ui.chat.audio.position_value | {current} de {total} | Natural concise elapsed/total phrase, e.g. 0:05 de 0:12; no repeated posición or unnecessary plural. | 20 / 20 |

Character counts are directly measured source template lengths (including placeholder syntax), not rendered DOM widths. Expansion is modest (maximum 36/31, about 16.1%); sidecars provide comparable-width guidance, not a numeric maxCells/maxChars cap. No apparent fit concern. No rendered-layout or screen-reader execution is claimed.

Relative-age constructions were explicitly substituted with hace 2 h and reread: Organizado por un agente hace 2 h; Organizado por el Bibliotecario hace 2 h; Organizado automáticamente hace 2 h; Organizado por ti hace 2 h; Organizado hace 2 h. They are idiomatic Spanish fragments; no duplicate hace is introduced. Masculine Organizado agrees with the resource/archivo and retains shipped wording. RTL does not apply to es; no manual bidi controls were present.

## Shipped usage cross-check
Derived with git show of origin/main, not inferred from translator notes:
- ui.library.librarian.title = Bibliotecario.
- ui.library.librarian.last_organized = Organizado por última vez {at}.
- ui.library.preview.organized_by = Organizado por {by} {at}.
- ui.library.sort.organized = Organizados por última vez.
- ui.chat.audio.position_label = Posición de {label}.
All listed library values match the local catalogue. The audio position label differs between local catalogue and origin/main; therefore the translator's note that the label was absent in its worktree is not evidence of absence from current origin/main. The current candidate remains correct against the newer shipped label.

## Input SHA-256
- keys.json: c2b57addb849fb35720fac74c79b59c1c47078534c0c50cf9e8b58c368c0a35a
- es.json: 71f3cbb8113448dd189c77a9590f8233919e9a4464d1a2e2d1b8898530ed3abd
- callsites.md: 25fc999688b693d45b3ad3cbcd5e11180087cd969ce6031d586fc200390f94ff
- risks.md: ee66a0fa2c3b52184bef860a53c1b5f79b1d1708978a4e7e4fa2eada06ace9a8

This scratch report is the requested handoff artifact, not a tracked audit-ledger receipt or a historical audit replacement. No ledger write was requested for this slice.
