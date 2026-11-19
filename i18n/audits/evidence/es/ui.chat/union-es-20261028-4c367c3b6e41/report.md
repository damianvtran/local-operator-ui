# Union audit — `es` / `ui.chat` — report

* **Audit id:** `union-es-20261028-4c367c3b6e41`
* **Locale / namespace:** `es` / `ui.chat` (one catalogue, 142 keys)
* **Target bytes:** PR #1449, branch `i18n-wave-a`, head `c5e19ecec883b45e281d696f06dac86bcb0d90f3`
  (merge of `e5f7c8daeaf3` with `origin/main` `1d631be71fb7`)
* **Audit date:** 2026-10-28
* **Auditor:** `i18n-auditor`, session `4c367c3b6e41`, route `radient/auto` (no fallback, no model switch, no session incident — see `record.json`)
* **Verdict:** **passed** — `clean-with-findings`, 0 blocker, 0 major, 0 minor, 2 nit

## Why this audit exists

Wave A (18 keys: `checkpoint.*`, `header_identity.*`, `region.*`) and wave B (9 keys:
`session_status.*`) were each audited on their own whole-file bytes and both passed
(receipts `949ac6eec574` and `8bbe685ce56d`). The union file the merge produces has never
been read as a whole, so `node scripts/i18n/ledger-check.mjs` fails its row for stale
hashes. This audit binds the union bytes and asks the question the two separate passes
could not: does the merge of the two deltas hold together.

## What was audited

A **delta audit over unchanged-by-proof bytes** plus a whole-file consistency read:

1. **Delta proof (parsed JSON, not text).** Union = 142 keys = 115 base + 18 wave A + 9
   wave B, with zero shared key names. Every value is byte-identical to the earlier audit
   that read it: the 18 wave-A keys against `80ee119bbd` (the bytes receipt `949ac6eec574`
   bound), the 9 wave-B keys against `a5356ce91c` = `1d631be71f` (the bytes receipt
   `8bbe685ce56d` bound), and all 115 base keys against both `81f286ee5c` (pre-wave) and
   `origin/main`. A line-level check re-read the raw JSON text of all 142 keys: **0 value
   mismatches, 0 raw-text mismatches**. Key order in the union is exactly `origin/main`'s
   124 keys followed by wave A's 18, so the merge moved no base line.
2. **Whole-file read** of all 142 keys — mechanical gates, then accuracy, idiom, register,
   terminology, fit and (for this locale) punctuation/typography, with a second pass over
   the error, approval and secret copy.
3. **Cross-wave consistency** between the A family (`region.conversation` vs
   `region.composer`, `checkpoint.*`, `header_identity.*`, `session_status.answer_label`
   equivalents) and the B family (`session_status.*`): term, register and terminal-stop
   collisions.

## Gates run (actual, in the read-only `git archive` export of `c5e19ecec8`)

| Gate | Result |
|---|---|
| `node scripts/i18n/ledger-check.mjs` | **fails exactly 7 rows / 21 findings**, all `*/ui.chat` stale-source + stale-target + receipt-vs-bytes. Expected: the union bytes have no receipt yet. This audit is the missing one for `es`. |
| `node scripts/i18n/generate.mjs --check` | `src/i18n/keys.gen.ts is byte-identical to a fresh generation` |
| `node scripts/i18n/context-parity.mjs` | `ok` — every English key covered apart from 131 allowed gaps in 4 namespaces; all 27 wave keys carry a sidecar entry |
| `node scripts/i18n/check-coverage.mjs` | `ok` — 7 gated languages over 99 namespaces; 0 allowed keys remain |
| `node --test scripts/i18n/locale-parity.test.mjs` | 44/44 pass (es included: every key, no unknown key, placeholder parity, not an English stub) |
| `node scripts/i18n/check-duplicates.mjs` | `ok` — 889 files, 0 duplicate keys (the merge hazard specifically) |
| Independent mechanical sweep (this audit, `@formatjs/icu-messageformat-parser` + `intl-messageformat`) | 142/142 keys parsed; **172 real renders**; 0 problems |

Mechanical detail: placeholder name/type parity for all 142 keys (arg-shape equality), ICU
select/plural block parity vs `en` (0 diffs), `es` plural categories limited to
`one`/`many`/`other` with `other` present everywhere, no markup/tag drift, no
backtick/code/flag/path drift, NFC on every value, no bidi controls or zero-width
characters, no NBSP, no stray whitespace, no key added or dropped, valid JSON.

## Renders (real `intl-messageformat`, locale `es`)

```
loop_progress_turns   0 -> "0 turnos"   1 -> "1 turno"   2 -> "2 turnos"
                      1000000 -> "1.000.000 de turnos"   1500000 -> "1.500.000 turnos"
update_all            {count:1234} -> "Actualizar todo (1234)"   (::group-off honoured)
update_all_label      agents/teams/skills/other ->
                      "Actualizar las 3 actualizaciones de agentes|equipos|habilidades desde el hub"
                      / "Actualizar las 3 actualizaciones desde el hub"
header_identity.loading  agents/teams/other -> "Cargando agentes…" / "Cargando equipos…" / "Cargando…"
loop_progress_of_turns   {2,10} -> "2 de 10 turnos"
no_matches            -> "Nada coincide con “Nova”."
hint.prefix           -> "Pregunta 2 de 5. "   (trailing space preserved)
checkpoint.jump_user  -> "Ir a tu mensaje del turno 3 de 7, a las 15:42"
```

The `many` arm renders "1.000.000 de turnos" and 1.5 M falls to `other` — exactly the es
guide's rule (`many` = exact multiples of 10⁶).

## Findings

### UES-N1 — NIT — `ui.chat.error_block.heading`

* **Source:** `Error`
* **Current:** `Detalle del error`
* **Problem:** the one-word heading is rendered with one extra word. Nothing is
  mistranslated and the label still describes the block, but it narrows the heading to
  "error detail" — a block that carries only a short error line reads oddly under it —
  and it is the only heading in its family that grows (`mermaid.error_title` = "Error en
  el diagrama de Mermaid", `rendering_error` = "Error de renderizado").
* **Suggested:** `Error`

### UES-N2 — nit — `ui.chat.error_block.schema.after`

* **Source:** `to fix this. We recommend using Radient Automatic to have the best combo of cheap and smart picked for you based on your requests (typically cheaper than bringing your own key), or use one of the recommended models with a star icon.`
* **Current:** `para solucionarlo. Recomendamos Radient Automatic, que elige para ti la mejor combinación de barato e inteligente según tus solicitudes (normalmente más barato que usar tu propia clave), o uno de los modelos recomendados con el icono de estrella.`
* **Problem:** two small idiom defects in one sentence. (a) `la mejor combinación de barato
  e inteligente` nominalises two adjectives — colloquial marketing shorthand rather than
  product prose. (b) the second alternative carries no verb: after the long relative
  clause `que elige para ti …`, `o uno de los modelos recomendados` dangles off
  `Recomendamos`, and the reader has to re-parse to see that a different model is being
  recommended. Meaning survives, so nit rather than major.
* **Suggestion:** `para solucionarlo. Recomendamos usar Radient Automatic, que elige para ti la mejor combinación de económico e inteligente según tus solicitudes (normalmente más barato que usar tu propia clave), o usar uno de los modelos recomendados con el icono de estrella.`

## Observations (not findings, not counted)

* **UES-O1 — composer vs message box is the source's split, not the translation's.** The
  file renders `composer` as `compositor` (3 sites, including wave A's
  `region.composer` = "Compositor de mensajes") and `message box` as `cuadro de mensaje`
   (2 sites, both in the approval hints) — a strict 1:1 mapping of two English terms the
   source itself uses for the same field. It is therefore not a term collision this audit
   can fault the translation for. Wave A recorded the same observation as `O1` and
   recommended aligning the two `cuadro de mensaje` sites to `compositor` in a separate
   change; that recommendation still stands and no catalogue byte is changed here.
* **UES-O2 — `Approve`/`Deny` stay English by contract.** `question_dock.hint.approval`
  names the on-screen buttons as `Approve`/`Deny`, which is correct: the approval card
  prints `APPROVAL_OPTIONS` labels from `src/renderer/src/features/chat/approval-words.ts`
  (English, submitted verbatim as the option label), and the typed answers resolve through
  the same English word lists. Translating the hint's button names would point the reader at
  controls that do not exist in Spanish.
   The typed tokens `yes`/`no` are quoted (“yes”, “no”); quoting is Spanish typography and
  keeps them readable next to the Spanish word `no`. No change suggested.
* **UES-O3 — `{reason}` is an English cross-repo contract.** `header_identity.aria_*_closed`
  = "Agente: {label}. {reason}" leaves `{reason}` in English on purpose: the sidecar records
  it as text this UI composes to mirror core's `team_owns_the_agent_slot_message` byte for
  byte, and core keys on the exact words. The mixed-language utterance is intended in every
  locale, not an untranslated leftover.
* **UES-O4 — `ui.chat.tabs.chat` = "Chat" is an audited exemption**, not a skipped string:
  `scripts/i18n/locale-parity.test.mjs` records `es:ui.chat.tabs.chat` with its reason
  ("Spanish loanword … the established noun in the audited es house voice"). It is the only
  value in the file identical to English.
* **UES-O5 — wave A's W1 (English meridiem in `{clock}`) is closed at this head.**
  `checkpointClockLabel` now returns `formatTime(date, { hour: "numeric", minute: "2-digit" })`
  (`src/renderer/src/features/chat/canonical/checkpoint-model.ts:220`, fixed in
  `cbc7082c53`), so `a las {clock}` renders "a las 15:42" in `es`. No finding is carried
  forward; the earlier minor is remediated, not ignored.

## Register, terminology, typography

* Formality: tú throughout (`Usa`, `Elige`, `Escribe`, `Vuelve`); no `usted`/`vosotros`.
  Infinitives for control labels (`Asignar`, `Cambiar de`, `Restablecer vista`),
  imperative for sentences — the es guide's rule.
* Terminology concordance over the whole file is 1:1 for every repeated term: session→sesión
  (5/5), agent→agente(s), team→equipo(s), model→modelo(s), turn→turno(s),
  conversation→conversación, composer→compositor, message box→cuadro de mensaje,
  job→trabajos, wake→despertares, monitor→monitores, goal→objetivo(s), loop→bucle,
  transcript→transcripción, hub kept English, raw→sin procesar. Glossary terms (sesión,
  agente, subagente, equipo, habilidad, dispositivo, trabajo, aprobaciones, transcripción,
  uso/coste) follow the core glossary and the es guide's recorded calls (`coste`,
  `trabajo`, `despertar`).
* Punctuation: no straight quotes, no `...` (the source's one `Loading diagram...` renders
  `…` per the es guide), spaced em dash ` — `, “ ” quotes, `·` separators preserved,
  `Intro`/`Esc`/`Escape` as the source uses them, no space before `:;?!`, no pre-formatted
  numbers (grouping comes from `::group-off` and the formatter).

## Fit

Only two keys carry a width hint: `session_status.choose_model` 16 ≤ 18 cells,
`session_status.last_reading` 14 ≤ 16. No key overruns a hint. The shortest controls stay
short (`Sin agente`, `Sin equipo`, `estimado`, `Chat`); `Descartar` is the longest of the
dismiss family and the sidecar records that this word is dropped below the narrow column
floor in favour of the icon and accessible name.

## Limitations

* Catalogue-level audit: it proves the strings, their ICU structure and their rendering. It
  does not re-render the Electron UI; visual proof for this change belongs to the
  design/QA lanes. No screenshot is claimed here.
* The es file at this head is `origin/main`'s plus wave A's 18 appended keys (proved above),
  so the delta proof — not a fresh re-derivation — is what carries the base and wave-B keys.
  The whole-file mechanical and narrative checks were nonetheless re-run over all 142 keys.
* No translation or MT service was used to compare or back-translate anything.

## Records

* receipt: `i18n/receipts/union-es-20261028-4c367c3b6e41.json`
* evidence: `i18n/audits/evidence/es/ui.chat/union-es-20261028-4c367c3b6e41/`
  (`record.json`, this report, `audit.log`, `receipt.json`)
