# Independent translation audit — `es` — `ui.chat.canonical` (combined bytes after the #1862 ∪ #1861 rebase)

## Record block

```
locale:            es
namespace:         ui.chat.canonical   (file group = whole namespace file)
auditor_agent:     i18n-auditor
model:             deepseek/deepseek-flash   (ACTUAL served model for this session;
                   actual_model_source = session model header, no pin/role override
                   requested by me; no fallback observed)
session:           075c98e61fad
date:              2026-11-11
candidate:         git 659ef7e44b7ccb4800e9853ef355ea58b49854cc  (branch cand-rebased-unaudited)
worktree:          ~/local-operator-ui/.worktrees/i18n-l2-file-sizes  (READ ONLY, nothing checked out)
read_only:         yes — no edits, no installs, no build, no tests, no generator, no PR comment
mirror_of:         the same commit as served by git show/cat-file (blobs only)
independent_from_translators: yes — the 182 tool_row.verb.* keys were translated by
                   i18n-translator / openai/gpt-6.1-sol, the 2 file-size keys and the
                   inherited 258 by i18n-translator / anthropic/claude-sonnet-5-5;
                   I authored none of them. No MT service, dictionary or
                   back-translation was used to compare or produce anything below.
verdict:           clean-with-findings
status:            passed            (no BLOCKER and no MAJOR remains)
severity_counts:   { blocker: 0, major: 0, minor: 2, nit: 4 }
input_hashes:
  en:       path=src/i18n/catalogues/en/ui.chat.canonical.json
            sha256=38f1069648c9241799bb1b316820e0530bf9445dfba3151e1c28df70153916b3
  context:  path=src/i18n/catalogues/en/ui.chat.canonical.context.json
            sha256=c258ab485de698eec85e81ffed506866e3b1e8caf29cb3ff434901388065b390
  target:   path=src/i18n/catalogues/es/ui.chat.canonical.json
            sha256=085b359e749d56c159ab7475f4d7461f31bfc1b988df823ade5a7bcf000143ce
```

Hashes were computed twice and agree: `python3 hashlib` over `git show 659ef7e44b7c:<path>` output, and
`git cat-file blob 659ef7e44b7c:<path> | shasum -a 256`.

---

## 1. What this audit covers, and the union arithmetic

The rebase combined two PRs that both appended to this one namespace file, so the ledger rows (which hash
the whole file) had to be re-derived against the combined bytes.

| Slice | Keys | Provenance |
|---|---|---|
| inherited (per-namespace history) | 258 | prior rows, previously audited |
| `ui.chat.canonical.tool_row.verb.*` (PR #1862) | 182 | translator openai/gpt-6.1-sol, round-2 audited clean on main |
| `ui.chat.canonical.tool.never_sent_*` (PR #1861) | 2 | translator anthropic/claude-sonnet-5-5 |
| **total** | **442** | 258 + 182 + 2 = 442 ✔ |

The hand-union of two disjoint key sets is exactly the operation this repository warns about
(`docs/I18N.md`, "Merge a shared new English catalogue by hand-union"), so I checked it three ways:

- `git diff origin/main 659ef7e44b7c -- src/i18n/catalogues/es/ui.chat.canonical.json` is **+2 / −1
  lines**: only `tool.never_sent_composed` and `tool.never_sent_empty` were added, and the 440 other keys
  are byte-identical to `origin/main`. Nothing from the #1862 side was dropped.
- English side: also +2 keys, plus 15 added sidecar lines (the two new context entries).
- Raw duplicate-key scan (a `json` loader with an `object_pairs_hook` that rejects a repeated key in one
  object — `JSON.parse`'s blind spot): no duplicate keys in either file. **No lost or doubled key.**

## 2. Mechanical pass (all 442 keys)

Run with python only. **The repository's node validators (`scripts/i18n/check-strings.mjs`,
`locale-parity`, `context-parity`, `generate.mjs --check`) and `scripts/i18n/file-size.test.mjs` were NOT
run**: the manager's brief for this run forbids installs, builds, tests and the generator (memory guard,
"tiny python only"). What follows is my own re-implementation of those checks over the blob bytes, not a
claim that the repo tools passed.

| Check | Result |
|---|---|
| Key set identical to English (no added/dropped) | PASS — 442/442 both sides |
| Key order matches English | **1 displacement** — `fold.count.actions_partial`; see N-1. Pre-existing on `origin/main` and shared with fr/ru/hi; not introduced here |
| Valid JSON, no duplicate keys in raw bytes | PASS |
| ICU messages parse (recursive parser: braces, args, nested arms) | PASS — 0 parse errors across 442 × 2 |
| Placeholder names and types identical per key | PASS — 442/442 after fixing my own parser twice; the only diffs are ICU **arms**, never argument names/types |
| ICU plural/select arms structurally valid | PASS — `one`/`many`/`other` (+ `=0` where the source has it) |
| CLDR plural categories for `es` (`one`, `many`, `other`) | PASS on 56 of 58 plural keys; 2 keys carry `one`/`other` only — see N-2 |
| `few` used anywhere | PASS — never (not a Spanish category) |
| `#` used for the number, `{count, number, ::group-off}` kept where the source has it | PASS |
| ICU number skeletons / `::group-off` preserved | PASS |
| Markup, backticks, code spans, flags, paths, identifiers | PASS — token sets byte-identical to source |
| Empty values | PASS — none |
| English-identical values | PASS with 6 named exceptions, all structural (below) |
| Leading/trailing spaces, double spaces | PASS — the two exceptions are separator strings |
| NFC / no combining marks | PASS |
| Control or bidi formatting characters (`Cf`, U+2066–2069) | PASS — none (an LTR catalogue needs none; `messages.ts` isolates only RTL answers) |
| Whitespace/typing conventions vs English | PASS — tabs 442/442, trailing newline, same indent |
| Question marks | PASS — 1 question, correctly `¿…?` |
| Trailing punctuation parity with source | PASS — 0 diffs over 442 keys |
| Register | PASS — `tú` throughout, no `usted`/`vosotros`, no `!` |
| Stray English beyond policy | PASS — heuristic scan for English function-word runs: 0 hits |

**English-identical values, named (all allowed, none is untranslated copy):**

1. `tool_row.bridge.detail.headline.target` = `{verb} {target}` — pure composition skeleton.
2. `tool_row.bridge.summary.count` = `({count, number, ::group-off})` — punctuation + ICU number only.
3. `fold.count.named` = `{count, number, ::group-off} {name}` — count + verbatim tool identifier; the
   sidecar says only the two tokens' order may change, and Spanish word order is already correct.
4. `fold.sentence.join` = `{first}, {second}` — a comma join; the Spanish comma is the same glyph.
5. `fold.unit_separator` = `" · "` — a separator glyph; the English value is the same glyph.
6. `supplement.withheld.reason_separator` = `", "` — the same separator glyph as English. The es guide's
   "no space before `:` `;`" rule does not touch a comma-plus-space join, and no Spanish variant of this
   separator exists.

Non-ASCII inventory of the whole file: `ó á ú í é ñ ¿ … — ·` only (no NBSP, no soft hyphen, no full-width
punctuation, no CJK/Arabic residue).

## 3. Accuracy and idiom — the delta, key by key

### `ui.chat.canonical.tool.never_sent_composed` — `nunca enviado · redactado: {size}`
### `ui.chat.canonical.tool.never_sent_empty` — `nunca enviado · nada redactado`

Both read as correct, native, terse Spanish status fragments; I found **no BLOCKER, MAJOR, MINOR or NIT** on
these two keys. What I checked, against the sidecar's role/tone/length/note:

- **Status word.** "nunca enviado" = the call never reached a tool (refused by the harness, or the turn
  ended first). Present perfect in Spanish is the natural fit here; `no se envió` would read as a discrete
  past event and `sin enviar` as an adjective that could attach to the wrong noun. Kept.
- **Parallelism.** The sidecar asks the two lines to stay parallel: `redactado: {size}` / `nada redactado`
  both hang off the same participle, and the empty sibling substitutes the quantity slot instead of
  inventing a different verb. PASS.
- **Word order.** The source's `{size} composed` becomes `redactado: {size}`, which the sidecar explicitly
  permits ("Whole line is one message so word order can follow the target language"). The colon is the one
  addition over English; it is what makes the label/value shape readable, and it obeys the es guide ("No
  space before `:`"). Measured against `12,4 kB` it also avoids a participle that would have to agree with
  an implied noun whose gender Spanish does not settle here. Judged correct rather than a deviation.
- **Placeholder.** `{size}`: same name, same type, used once in the translation exactly as in the source.
  `src/i18n/keys.gen.ts` types it `{ size: string }`, matching the sidecar's "an already-localized file
  size … insert verbatim, do not translate or reformat". Nothing inside the placeholder is touched.
- **Typography.** Middle dot with spaces (` · `) as in the source and as `fold.unit_separator` ships;
  lowercase start; no trailing punctuation; ellipsis not involved.
- **Safety.** Neither string is destructive, permission-bearing or an error, so no safety-wording rule
  applies; "nunca enviado" is factual and cannot be misread as a delivery claim (the user is being told
  the opposite).
- **Register.** Both are diagnostics inside the transcript's tool group. "redactado" (drafted/composed) is
  the register the French row also chose (`texte rédigé`), and it is the right verb for the model's request
  text; `escrito` would work too but is not better, so I am not raising a wording change.

## 4. Unit symbols — what I verified and what I inferred

The catalogue carries **no** unit symbol, and that is the correct design: `{size}` arrives preformatted.

- **Verified by reading the source at this commit** (`src/i18n/format.ts`): `formatByteQuantity` returns
  `formatNumber(value) + fileSizeSeparator(tag) + fileSizeUnitLabel(unit, tag)`; `fileSizeUnitLabel` asks
  `Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte"|"megabyte"|…, unitDisplay: "narrow" })` and
  **never holds a table**; English short-circuits to ASCII `B/KB/MB/…`; IEC `KiB/MiB/GiB` stay as written in
  every locale; a runtime without the unit falls back to the ASCII symbol. The separator comes from the
  locale's own `kilobyte` short pattern (a narrow no-break space in fr).
- **Verified by reading the caller**: the two new keys are only the frame around `{size}`; no call site or
  catalogue value in this namespace builds a unit itself (scan for `B/KB/MB/GB/byte` tokens over all
  es values: none).
- **Inferred, not observed by me**: the exact glyphs the Spanish user will see. `scripts/i18n/file-size.test.mjs`
  pins `es: ["0 B", "1 B", "1 kB", "1 kB", "1,5 kB", "1 MB", "2,5 GB"]` (measured by the PR author with
  ICU 78.3 / CLDR 48.0), i.e. CLDR's own es narrow form `kB` with a decimal comma and a plain space. I did
  not execute node/Intl in this run, so treat the glyphs as the author's pinned measurement plus CLDR es
  data, not as my own observation. Consequence for this audit: the Spanish line renders
  `nunca enviado · redactado: 12,4 kB`, and the spelling is owned by the formatter, so a CLDR drift would
  show up in that test rather than in this catalogue.
- **Observation (not a translation finding):** at this head there is no renderer call site for the two
  `tool.never_sent_*` keys — `git grep` over `src/` finds them only in the catalogues and `keys.gen.ts`.
  So "fit" for these two strings can only be judged against the sidecar hint ("shares one row with the tool
  name and truncates with an ellipsis when narrow"), not against a rendered frame. The ledger hash still
  binds these bytes, but a reviewer should not expect screenshot evidence for this line from #1861 alone.

## 5. Findings

Severity: BLOCKER 0 · MAJOR 0 · MINOR 2 · NIT 4. Both MINORs are **inherited** (present on `origin/main`,
untouched by this PR's diff); per review economy they do not gate this merge.

Pass note for the manager: this is **pass 1** of my read. The namespace carries the send-failure and
withheld-file error surface (`send_failure.*`, `supplement.withheld.*`, `security_notice.*`), which I
re-read word by word and found accurate and safely worded; if you want an independent second pass on those
strings because they are error copy, say so and I will run it as pass 2 rather than treating this one as it.

### M-1 — MINOR — one concept, two names: `todos` is "pendientes" in the fold units and "tareas" in the verb column
- Keys: `ui.chat.canonical.fold.count.todo` = `…{count, number, ::group-off} actualización de pendientes` /
  `…de actualizaciones de pendientes`; `ui.chat.canonical.fold.count.todo_read` = `… lectura de pendientes`;
  versus `tool_row.verb.read_todos.settled` = `Leídas tareas`, `tool_row.verb.updated_todos.settled` =
  `Actualizadas tareas`.
- Problem: the same object (the to-do plan) is named "pendientes" in the collapsed summary and "tareas" in
  the adjacent tool row, so one turn can show "Actualizando tareas" and "1 actualización de pendientes" on
  consecutive lines. The settled UI term elsewhere is "tareas": `ui.chat.run_details.todos.title` =
  "Tareas pendientes", `ui.projects.project_todos.to_dos` = "Tareas pendientes". The glossary's invariant
  is one term per concept.
- Suggested: `actualización de tareas` (one) / `de actualizaciones de tareas` (many) / `actualizaciones de
  tareas` (other), and `lectura de tareas` / `de lecturas de tareas` / `lecturas de tareas`. All stay
  inside the sidecar budget (2–4 words including the count; they are the same word count as today).
- Not a MAJOR: meaning is intact in both spellings, both read as natural Spanish, and the affected line is a
  low-visibility collapsed summary.

### M-2 — MINOR — `unknown.settled` is the only finite-verb settled form in the verb batch
- Key: `ui.chat.canonical.tool_row.verb.unknown.settled` = `Usó Team Bridge` (running `Usando Team Bridge`).
- Problem: the other 90 settled families are participial or impersonal (`Liberado`, `Creado`,
  `Publicado en`, `Mensaje enviado a`, `Reacción añadida en`, `Conversaciones listadas`). `Usó` is a
  third-person preterite, so it reads as a sentence fragment beside a column of participles.
- Suggested: `Se usó Team Bridge` (4 words, stays inside the one-to-four-word gutter budget) or
  `Team Bridge usado` if the object-first order is preferred. Also acceptable: leave it and record the
  choice; it is a one-string register inconsistency, not a meaning error.

### N-1 — NIT — key order: one key is displaced relative to English
- Key: `ui.chat.canonical.fold.count.actions_partial` sits at index 248 (after
  `transcript.job_suffix`) in es, but at index 240 (after `transcript.not_delivered`) in en.
- Provenance: present on `origin/main`, and shared with fr/ru/hi (vi/ur/zh-CN are aligned). No gate checks
  order, and lookups are by key, so this has no functional effect. Recorded because the brief asked for the
  order check, not because it should be fixed in a translation PR.

### N-2 — NIT — two plural keys have no `many` arm although `es` has that CLDR category
- Keys: `ui.chat.canonical.tool_row.diff.more`, `ui.chat.canonical.tool_row.diff.truncated`
  (`one`/`other` only; the other 56 plural keys carry `one`/`many`/`other`).
- Impact: nil in practice — the arm is only selected for exact multiples of 10⁶ diff lines, which this
  surface cannot produce, and `intl-messageformat` falls back to `other`, whose Spanish text
  ("… más del diff") is grammatical for a large count. Suggested only for category completeness:
  add `many {… de líneas más del diff}` / `many {Diff truncado: # de líneas más sin registrar}`.

### N-3 — NIT — ambiguous clitic in the awaiting-acceptance tooltip
- Key: `ui.chat.canonical.tool_row.bridge.delivery.awaiting_acceptance.title` =
  `Publicado, pero el propietario del agente debe aceptar la conversación antes de despertarlo.`
- Problem: "despertarlo" can attach to "el propietario" as written; the agent is what gets woken.
- Suggested: `… debe aceptar la conversación antes de que el agente se despierte.`

### N-4 — NIT — `succeeded` and `completed` collapse to one Spanish word
- Key: `ui.chat.canonical.tool_row.outcome.succeeded` = `completado`; `ui.chat.canonical.turn_summary.completed`
  is also `completado`, so the screen-reader-only outcome word loses the success nuance English draws
  (failures announce `falló`, so the context still carries it).
- Suggested if the distinction is wanted: `logrado`. Not worth a churn on its own.

### Considered and deliberately not raised
- `tool_row.verb.waited_for_jobs.settled` = `Esperado fin de trabajos` — already reported and adjudicated in
  the previous round (`l1verb-es-wave/report-r2.md`, MINOR m2-2, "not gating"); not re-raised here.
- `send_failure.aside_still_answering` = "La consulta al margen sigue respondiendo." — mild metonymy, but
  the English source uses the same metonymy, the shipped corpus already says "Consulta al margen" and
  "Consultando al margen", and the sentence is unambiguous in context. Judged acceptable.
- `Diff` kept English (`tool_row.diff.*`) — not on the es guide's explicit kept-English list, but the
  shipped es corpus keeps `diff` everywhere (`ui.canvas.code_editor_diff.*`, `ui.hub.adoption.diff_hub`,
  and "un diff" in the skills prose), so this is the settled form, not a drift.
- The telegraphic participle style of the verb column (`Listados agentes`, `Leída consola`) — forced by the
  source rule "verb first, object trails"; adjudicated and accepted in the previous round (MINOR m2-3).
- Warning copy on the destructive path (`sound.stop.warning`, `security_notice.*`,
  `supplement.withheld.*`) — re-read word by word: the charge warning, the best-effort qualification and
  the withholding reasons are all preserved. No finding.

## 6. Recording the result (not done by me — no repo writes in this run)

The RFC's ledger writer is `scripts/i18n/ledger-assemble.mjs` (read-only `ledger-check.mjs` verifies later).
It refuses a receipt that does not name the bytes on disk, so the receipt must carry all three hashes above.
I wrote **nothing** into the repository: no ledger row, no receipt, no `record.json`, no evidence bundle, no
PR comment. What the manager needs is in this scratchpad, ready to copy:

- `scratchpad://audit-1861-es.receipt.json` — the receipt in the contract's shape
  (`auditor`, `model`, `instance`, `status`, `namespace`, `sha256 {en, es}`, `findings[]`).
- Suggested tracked record directory:
  `i18n/audits/evidence/es/ui.chat.canonical/au1861es-combined-659ef7e4/` with
  `record.json`, this report as `report.md`, and the receipt copied to `i18n/receipts/au1861es-combined-659ef7e4.json`.
- Suggested ledger note (231 chars, ≤280):
  `Combined-bytes audit of es at 659ef7e4: 442 keys = 258 inherited + 182 tool_row.verb.* (#1862) + 2 tool.never_sent_* (#1861). 0 BLOCKER/MAJOR. Record: i18n/audits/evidence/es/ui.chat.canonical/au1861es-combined-659ef7e4/record.json`
- Command the manager can run once the receipt exists on disk (from the worktree):
  ```
  node scripts/i18n/ledger-assemble.mjs --locale es \
    --file src/i18n/catalogues/es/ui.chat.canonical.json \
    --auditor-instance au1861es-combined-659ef7e4 \
    --auditor-model deepseek/deepseek-flash \
    --result clean-with-findings \
    --receipt i18n/receipts/au1861es-combined-659ef7e4.json \
    --translator-agent i18n-translator --translator-model anthropic/claude-sonnet-5-5 \
    --scope "Whole combined namespace at 659ef7e4: 258 inherited + 182 tool_row.verb.* (#1862) + 2 tool.never_sent_* (#1861), read against en and the context sidecar; es file byte-identical to origin/main apart from the two added keys" \
    --date 2026-11-11
  ```
  `--result clean-with-findings` is what the receipt's own counts support (0 blocker, 0 major, 2 minor,
  4 nit); `ledger-assemble.mjs` derives the row's `status` from that, so it will land `audited`.

## 7. Commands actually run (execution log, not notes)

All in `~/local-operator-ui/.worktrees/i18n-l2-file-sizes` (reads only) and in this session's scratchpad.

1. `git show 659ef7e44b7c:{en,es}/ui.chat.canonical.json`, `…/en/ui.chat.canonical.context.json` → scratchpad copies.
2. `git cat-file blob 659ef7e44b7c:… | shasum -a 256` for the three inputs (hashes above).
3. `git diff origin/main 659ef7e44b7c -- src/i18n/catalogues/{en,es}/ui.chat.canonical.json` and
   `--numstat` on the context sidecar (delta = +2 keys each, 440 unchanged).
4. `git show 659ef7e44b7c:i18n/ledger.json` (es/ui.chat.canonical row), `scripts/i18n/ledger-assemble.mjs`
   header (receipt contract), `docs/I18N.md`, `src/i18n/format.ts`, `src/i18n/messages.ts`,
   `src/i18n/keys.gen.ts` line 4647, `scripts/i18n/file-size.test.mjs` eyes-only.
5. Read-only `git grep` over `src/i18n/catalogues/es/*.json` for terminology precedent
   (tareas/pendientes, diff, consulta al margen, app vs aplicación, correcto).
6. python3 (persistent kernel): key-set/order diff; recursive ICU parser written for this audit
   (`scratchpad/icu.py`) comparing every argument name, type and arm list per key; raw duplicate-key scan;
   NFC and `Cf` scan; whitespace/tabs/trailing-newline check; English-identical list; markup/code-token set
   comparison; negation-token and question-mark parity; `many`-arm extraction and " de " agreement scan;
   non-ASCII inventory; English-run heuristic; hash recomputation.
7. Style guide and glossary read from the **core** checkout (`~/local-operator/i18n/style-guides/es.md`,
   `~/local-operator/i18n/glossary.md`) — the UI repo has no `i18n/style-guides/` tree at this commit
   (`git ls-tree` on that path: not a valid object name). Precedent audit reports read:
   `i18n/audits/evidence/es/ui.chat.canonical/l1verb-es-wave/report-r1a.md` and `report-r2.md`, so the
   previously adjudicated MINORs are not re-raised.

Not run, and not claimed: node validators, the generator, any test suite, any build, any render, any
translation/MT service, any write to the repository.
