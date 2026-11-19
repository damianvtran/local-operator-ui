# Independent translation audit — `es` — Slice L1 / tool-row verbs — pass A

- **Locale:** `es` (neutral Spanish, `tú`, per `i18n/style-guides/es.md`)
- **Namespace / file group:** `ui.chat.canonical.tool_row.verb.*` (182 keys, 91 settled/running families)
- **Auditor:** i18n-auditor (this session), independent of the translator (openai/gpt-6.1-sol, session unknown to me)
- **Session:** `4b41c16b747a`
- **Date:** 2026-11-11
- **Actual served model:** `deepseek/deepseek-flash` (as served to this session; no model pin or role override requested by me)
- **Verdict:** **blocked** — `changes_requested` (1 BLOCKER, 1 MAJOR)
- **Counts:** `{blocker: 1, major: 1, minor: 2, nit: 2}`

## Inputs and hashes (SHA-256)

| Input | Path | SHA-256 |
|---|---|---|
| English source + context/notes | `.worktrees/_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Target translation | `.worktrees/_l1-prep/es.json` | `d44da14ac96c31d6d50cf202e77808bad75d2d3270bffb38577c04b933607aac` |
| Style guide | `~/local-operator/i18n/style-guides/es.md` | `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |
| Glossary | `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |

Cross-checks used as ground truth, all read-only:

- `src/i18n/catalogues/en/ui.chat.canonical.json` + `ui.chat.canonical.context.json` (branch `feat/i18n-l1-tool-verbs`): the 182 keys, their English values, and the `length`/`note` sidecar text — `keys.json` mirrors both byte-for-text (0 mismatches).
- `src/i18n/catalogues/es/ui.chat.canonical.json` on the same branch: shipped `tool_row.generic_verb.*`, `tool_row.bridge.verb.*`.
- Shipped prose elsewhere in `src/i18n/catalogues/es/` for terminology (login, network, console, todos, milestones, wakes).

## Commands actually run (with results)

1. Python mechanical pass on `keys.json` + `es.json` (key set, order, values, duplicates, English-identical, control characters, widths):
   ```
   counts 182 182 order_equal True
   empty []                       braces {}          dup groups 0
   identical-to-en []             bidi/control []
   max words es 4   max cells es 32   max cells en 23
   ```
2. Raw-bytes duplicate-key scan (`json.load(..., object_pairs_hook=...)`, which fails on a repeated key in one object — `JSON.parse`'s blind spot): `raw dup scan clean: es.json`, `raw dup scan clean: keys.json`. Both files are valid JSON.
3. Key-set equality against the *English catalogue and sidecar in the tree* (not only against `keys.json`): `en catalogue keys with prefix: 182 | prep keys: 182`, `prep keys == en catalogue keys: True`, `en values agree: True`, `keys missing from sidecar: 0`.
4. Surface/hygiene scan: `leading/trailing ws: []`, `double spaces: []`, `trailing punctuation: []`, `exclamation/question: []`, `lowercase start: []`.
5. Read the shipped Spanish catalogue for terminology precedent (grep over `catalogues/es/*.json`, see the citations in each finding).

No translation/MT service, dictionary or back-translation tool was used. No other auditor's report was read.

## Mechanical results

| Check | Result |
|---|---|
| Key set equal to source | PASS (182/182, same order) |
| Keys added / dropped | PASS (none) |
| Empty values | PASS (none) |
| Valid JSON, no duplicate keys in raw bytes | PASS |
| Placeholders | N/A — the sidecar declares `placeholders: {}` for all 182, and no value contains `{`, `}`, `<` or `>` |
| ICU plural/select structure | N/A — no value is an ICU message; no CLDR categories required |
| Markup / code spans / flags / commands / identifiers | PASS — no value contains backticks, flags, paths or identifiers; `Python` kept as a technology name (glossary §1) |
| Manual bidi / control characters | PASS (none) |
| Keys read as a sentence (verb + object) | PASS — every value is a bare verb phrase with no full stop, ready for the monospace object to follow |
| Settled/running pair uses the same verb | PASS — 91/91 (preterite/gerund of one lexeme; `Obtuvo`/`Obteniendo` is a correct stem alternation) |
| Length 1–4 words | PASS — max 4 words, none over |
| Stray English | PASS — none (only `Python`, allowed) |
| Duplicates that collapse two different English operations | PASS — zero repeated values; `Ran`/`Ran Python` correctly stay distinct |

## Findings

### es-A-01 — BLOCKER — `spawned_session.settled` / `.running`: reads as "signed in", not "spawned"

- **Keys:** `ui.chat.canonical.tool_row.verb.spawned_session.settled`, `…spawned_session.running`
- **Current:** `Inició sesión` / `Iniciando sesión`
- **English / role:** `Spawned session` / `Spawning session` — the `sessions` tool's `spawn` operation.
- **Problem:** `iniciar sesión` is this app's own phrase for **authentication**, not for starting an agent session. Shipped Spanish copy proves the collision is live, in several namespaces:
  - `ui.settings.integrations.integration_model.sign_in` = `Iniciar sesión`
  - `ui.settings.integrations.integration_model.signing_in` = `Iniciando sesión…`
  - `ui.teamBridge.plan.sign_in_title` = `Inicia sesión en Radient`
  - `ui.settings.model.model_setting_options.signed_in` = `Sesión iniciada`

  So `Iniciando sesión…` in the verb column is the exact string a user reads while Radient signs them in. The row's object makes it worse rather than better: `sessionsSummary` (`tool-row-model.ts:886`) puts **visibility first** for `spawn`, so the rendered row is `Iniciando sesión workstream · <name>`, which parses as "signing in [to] workstream". The verb claims an operation the user did not perform, in a product where the sign-in flow is a distinct, visible action.
- **Suggested:** `Creó sesión` / `Creando sesión` (matches the rest of the file's `Creó agente` / `Creó equipo` / `Creó proyecto` / `Creó red` family, and `sessions spawn` does create the session). `Lanzó sesión` / `Lanzando sesión` is an acceptable alternative if the "launch" nuance is preferred; do not keep any `iniciar sesión` form.

### es-A-02 — MAJOR — `joined_network` / `left_network`: prepositional complement without the article is ungrammatical

- **Keys:** `…joined_network.settled` / `.running`, `…left_network.settled` / `.running`
- **Current:** `Se unió a red` / `Uniéndose a red` · `Salió de red` / `Saliendo de red`
- **English:** `Joined network` / `Joining network` (`join`); `Left network` / `Leaving network` (`disconnect`).
- **Problem:** `salir` and `unirse` take a prepositional complement that requires a determiner in Spanish: `se unió a **la** red`, `salió **de la** red`. As shipped these read as machine output, and this is the one place the file's bare-noun headline style (`Creó equipo`, `Consultó sesión`) stops working, because there the noun is a direct object and here it is a complement. The shipped catalogue articles `red` in every prose use (`ui.chat.device.sentence.pairing_guidance`: `… o únete a una con 'lop network join'`; `ui.mesh.mesh_drop.no_shared_network`: `… de ninguna red compartida …`; `… el nombre de la red …`).
- **Suggested:** `Se unió a la red` / `Uniéndose a la red` · `Salió de la red` / `Saliendo de la red` (23 cells for the longest, within the 1–4-word rule).

### es-A-03 — MINOR — `viewed_network` / `diagnosed_network` / `created_network`: bare `red` as direct object

- **Keys:** `…viewed_network.*`, `…diagnosed_network.*`, `…created_network.*`
- **Current:** `Consultó red` / `Consultando red` · `Diagnosticó red` / `Diagnosticando red` · `Creó red` / `Creando red`
- **Problem:** Same missing determiner, weaker form: as a direct object it is parseable but reads awkwardly, and it is the only place in the file where a common noun stands in for a name-like object — the other object nouns (`agente`, `equipo`, `proyecto`, `secreto`, `consola`, `sesión`) are product entities the app also uses bare in labels (`Abrir consola`, `Tareas pendientes`), while shipped copy never says `red` without an article. Compounds in the same file are fine and need no change: `estado de red`, `registro de red`, `pares de red` (cf. shipped `Direcciones de red`, `llamada de red`).
- **Suggested:** `Consultó la red` / `Consultando la red`, `Diagnosticó la red` / `Diagnosticando la red`, `Creó la red` / `Creando la red`.

### es-A-04 — MINOR — `previewed_rename`: longest verb in the group; costs the object 13–15 cells

- **Keys:** `…previewed_rename.settled` / `.running`
- **Current:** `Previsualizó cambio de nombre` (29 cells) / `Previsualizando cambio de nombre` (32 cells)
- **English:** `Previewed rename` (16) / `Previewing rename` (17)
- **Problem:** Measured with `unicodedata.east_asian_width` over all 182 values, these are the group's two longest strings and its largest expansion (`+13`, `+15` cells against English; the group's next-worst is `+9`). The verb span is `shrink-0 whitespace-nowrap` (`trace/tool-row.tsx`, §E1) while the monospace object is the half that truncates, so every extra verb cell is taken 1:1 from the symbol being renamed (I did not render a frame, so I claim the cell delta, not a pixel budget). The sidecar carries no `maxCells` (its hint is `One to four words`, satisfied), so this is a fit judgement, not a rule breach, and the current wording is accurate.
- **Suggested:** `Previsualizó renombrado` / `Previsualizando renombrado` (24 / 27 cells) if the gutter needs tightening; keeping the current wording is defensible because `lsp`'s op *is* a rename preview and `cambio de nombre` is unambiguous. Do not shorten to a bare `Renombró`/`Renombrando` — that is the *applied* rename, not the preview, and would be a false claim.

### es-A-05 — NIT — `peeked_at` / `peeked_at_session`: `Revisó` is heavier than "peek"

- **Keys:** `…peeked_at.*`, `…peeked_at_session.*`
- **Current:** `Revisó` / `Revisando` · `Revisó sesión` / `Revisando sesión`
- **Problem:** `peek` is a shallow look at the last N steps of a job or subagent; `revisar` is "to check/review", which reads as a complete inspection. Meaning is not wrong and nothing is unsafe; the register is simply one notch heavier than the English.
- **Suggested:** `Ojeó` / `Ojeando`, `Ojeó sesión` / `Ojeando sesión` (shorter *and* closer to `peek`), or keep `Revisó` — the pairs are consistent either way.

### es-A-06 — NIT — `waited_for_jobs`: `Esperó trabajos` drops the relation

- **Keys:** `…waited_for_jobs.settled` / `.running`
- **Current:** `Esperó trabajos` / `Esperando trabajos`
- **Problem:** English is `Waited for jobs` / `Waiting for jobs`; the bare plural object reads as "waited [up] jobs" rather than "waited for". Understandable in the gutter and consistent with the file's headlinese, and `job → trabajo` is the guide's recorded term.
- **Suggested:** keep, or `Esperó a los trabajos` / `Esperando a los trabajos` (24 cells) if the relation should be explicit.

## Checked and cleared (not raised as findings)

- **Active preterite + gerund as the settled/running pair** — correct for these rows and the reason the shipped participle family does not transfer here: the row is *verb + object on one line* (`tool-row-model.ts:1320`, §E1), so `Ejecutó \`ls -la\`` works where a participle (`Ejecutado`) would not. The shipped bridge family settles as participles (`Enviado a`, `Leído en`, `Publicado en`) because it is participle + preposition, not verb + object; `tool_row.bridge.verb.unknown.settled` = `Usó Team Bridge` already uses the preterite. Recorded as an observation only: `tool_row.generic_verb.settled` ships `Invocado`, which sits in the same visual column as the new `Ejecutó` — pre-existing shipped copy, out of this slice's scope, and the new family is the one that matches the row grammar if it is ever aligned.
- **Bare singular object nouns** (`Creó equipo`, `Guardó secreto`, `Actualizó hito`, `Leyó variable`, `Consultó agente`, …) — telegraphic but consistent at 91/91 and it mirrors the English headlinese (`Created project`); not a defect of this translation. Clearer with articles, longer with them; no change requested.
- **`Consultó` for `Viewed`** — precedent exists in shipped copy (`tool_row.bridge.verb.directory`: `Consultado el directorio del equipo`), and the alternative `Vio` reads worse in a verb column.
- **`Eliminó hito` for `Removed milestone`** — matches shipped `ui.projects…the_milestone_was_not_removed` = `El hito no se eliminó`, and it keeps the distinction the code cares about (a removal must not read as `Actualizó`).
- **`Guardó secreto`** — `almacenar`/`guardar` both defensible; `guardar` matches the UI's `Guardar` convention. Not a glossary violation (glossary covers `credentials`, not `secret`).
- **`Escribió en consola`** — bare `consola` matches shipped labels (`Abrir consola`, `Cerrar consola`); `en la consola` would be more natural and is noted as an option, not a defect.
- **`Listó pares de red`** — `par` is the standard Spanish term for a network peer and there is no shipped Spanish precedent to override it; `dispositivos` would change the claim (peers ≠ all devices).
- **`Listó tareas` / `Actualizó tareas`** — `tarea` is the shipped word for a todo (`ui.chat.run_details.todos.title` = `Tareas pendientes`, `fold.count.task` = `tarea`).
- **`Listó despertares` / `Canceló despertar`, `Listó trabajos` / `Canceló trabajo`, `Listó sesiones`, `Reanudó sesión`, `Detuvo sesión`** — all follow the recorded locale calls (`wake → despertar`, `job → trabajo`, `session → sesión`).
- **Trailing prepositions** `Navegó por`, `Envió mensaje a`, `Vinculó sesión a`, `Desvinculó sesión de`, `… a la red` — each keeps the relation the following object needs; `Enviando mensaje a` matches shipped `tool_row.bridge.verb.dm.running`.
- **Accents** — all 91 preterites carry their tilde (`Ejecutó`, `Programó`, `Inició`, `Obtuvo` correctly without one); no missing or doubled diacritics found.
- **RTL** — not applicable to `es`; no bidi controls present.

## Ledger / evidence

Not written, deliberately: these are **pre-merge prep artifacts** (`.worktrees/_l1-prep/es.json`), not a catalogue in the tree, so there is no `(locale, namespace)` pair whose `source_sha256`/`target_sha256` `scripts/i18n/ledger-check.mjs` could verify, and the result is non-passing anyway. When the namespace lands in `src/i18n/catalogues/es/ui.chat.canonical.json`, the record to write is:

- `locale`: `es` · `namespace`: `ui.chat.canonical` (slice: `tool_row.verb`) · `audit_date`: `2026-11-11` · `key_count`: 182
- `auditor`: agent `i18n-auditor`, session `4b41c16b747a`, model `deepseek/deepseek-flash`, `independent_from_translator_session: true`, `actual_model_source: session runtime (no pin)`
- `input_hashes`: `en` = b3f3bfe3…, `context` = the tracked `ui.chat.canonical.context.json`, target = d44da14a… (re-hash after the fixes and the catalogue copy)
- `current_report_verdict`: `status: changes_requested`, `unresolved_blocker_major_count: 2`, `finding_ids`: es-A-01, es-A-02 (es-A-03…06 recorded, non-gating)
- Note (≤280 chars) must reference the tracked record path and must **not** claim `passed`.

## Verdict

**blocked / `changes_requested`** — 1 BLOCKER (`spawned_session`: `Inició sesión` collides with the app's own sign-in wording; the row renders `Iniciando sesión workstream · …`) and 1 MAJOR (`joined_network` / `left_network`: `Se unió a red` / `Salió de red` need `la`). Two MINOR (bare `red` in `viewed_/diagnosed_/created_network`; `previewed_rename` length) and two NIT (`peeked_at`, `waited_for_jobs`) do not gate. Everything else in the 182 keys is mechanically clean, uses the guide's and glossary's recorded terms, stays inside 1–4 words, contains no English leakage, and every settled/running pair is a matching preterite/gerund pair.
