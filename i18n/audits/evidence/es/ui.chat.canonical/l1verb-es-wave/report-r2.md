# Round 2 audit — es, tool-row verbs (l1-a2-es)

Auditor: i18n-auditor (l1-a2-es), actual served model anthropic/claude-sonnet-5-5; independent of the translator (openai/gpt-6.1-sol). No MT/translation service used.
Inputs: es.v2.json sha256 d28c28214bb0039f0c5e9e80c671a26e2ff4fa8546c6fed8e76f79d4928127f8 (matches the translator's recorded hash); keys.json b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419.

## Verdict: clean-with-findings — {blocker 0, major 0, minor 3, nit 2}

## 1. Delta (v1 → v2)
102 keys changed (91 settled + 11 running); 80 unchanged running gerunds. Round-1 BLOCKER B1 (`Inició sesión` = signed in) is fixed: `Creada sesión` / `Creando sesión`. M1 (preterite vs shipped participle) is resolved consistently across all 91 settled values. `Unido a la red`, `Desconectado de la red` (op is `network disconnect`, so the meaning is right), `Consultada/Diagnosticada/Creada la red`, `Activado modo pánico`, `Capturada pantalla de consola`, `Quitado dispositivo` all read correctly. The Spanish word-order in the verb column (participle + bare object: `Listados agentes`, `Leída consola`) is telegraphic rather than fully idiomatic, but it is forced by the source rule "verb first, object trails" and matches the shipped `Leída la conversación compartida` / `Creado` precedent. Accepted.

### Findings
- **MINOR m2-1 `previewed_rename.settled/.running`** — `Previsualizado renombrado` / `Previsualizando renombrado`. Participle + participle-shaped word reads "previewed renamed", i.e. as if the rename had been applied. Shipped catalogue has no noun use of «renombrado» (the 11 `renombr` hits are the infinitive `Renombrar…`, `Renombrar acento`), so nothing supports this as an established UI noun. The change was made only to save 6 cells (v1 was fine on meaning). Suggest `Previsualizado cambio de nombre` (4 words, 31 chars, inside the 32 limit) / `Previsualizando cambio de nombre` (32, at the limit). Not gating: the row's operation is a preview and the object follows.
- **MINOR m2-2 `waited_for_jobs.settled`** — `Esperado fin de trabajos`: «esperado» alone is also the adjective "expected", so a settled row can read "expected end of jobs". Running form `Esperando fin de trabajos` is fine. Suggest `Esperados los trabajos` / `Esperando los trabajos` (3 words, 22/23 chars; the pair stays parallel and the verb matches), or keep and accept. Not gating.
- **MINOR m2-3 article inconsistency** — networks get «la» (`Consultada la red`, `Creada la red`, `Unido a la red`) while sessions/consoles/agents are bare (`Consultada sesión`, `Creada sesión`). The translator's reason (bare «red» reads clipped, per round-1 A-02/m2) is reasonable, so this is accepted as deliberate; flagged only so it stays a recorded decision. Also `Comprobado estado de red` (bare «red») sits next to `Consultada la red` — fine, it is a compound noun.
- NIT n2-1 `messaged.settled` `Enviado mensaje a` vs shipped bridge dm `Mensaje enviado a` (object-first): same concept, different word order. Source rule forces verb-first, so accepted.
- NIT n2-2 the es style guide does not record the participial status-form decision for tool-row verbs (it still says "Action labels: infinitive", "Terse: Guardado"). Suggest the guide owner add one line so the next locale wave does not reopen M1. Guide edits are not mine.

## 2. Declined findings — adjudication
All counts re-run by me with python over every non-context JSON in `i18n-l1-tool-verbs/src/i18n/catalogues/es/` (158 files): consola 43/49 keys/occurrences, despertar 43, secreto 25, actualización 141, trabajos 11, tareas 32, hito 26, variable 40, pares 0, pánico 0, renombr 11. All match the translator's table exactly.
- **es-A-05 / n3 (`peeked_at*` keeps «revisar») — UPHELD.** No short, better Spanish verb; "ojeado" would add a rare word; the key also serves `jobs peek`. Participial agreement (`Revisada sesión`) applied.
- **n1 (`fetched` keeps «obtener») — UPHELD.** `web_fetch` retrieves and renders content; «descargar» implies saving a file. Fine.
- **m1 partial: `removed_milestone` keeps «eliminar» — UPHELD.** Shipped `ui.projects` says «El hito no se eliminó», «Esto elimina el proyecto y sus hitos», «completa o elimina los hitos incompletos» — milestones are consistently «eliminar» in shipped copy; `removed_device` → «quitar» is right (membership revocation; shipped «Quitar» is the dominant remove verb, 2+ hits in settings/teamBridge). I note the tension that shipped UI also uses «quitar» for generic "remove" (schedules, skills), but the milestone-specific evidence beats it.
- Translator's claim that `Se unió a la red` is 5 words: verified true (Se·unió·a·la·red); `Unido a la red` is 4.
- Translator's claim "pares: 0 shipped" is true; «pares de red» retained as a technical term (my view: acceptable; «dispositivos» would clash with `invited_device`).

## 3. Mechanical (whole v2 file)
python3, duplicate-key-rejecting loader: valid JSON; 182 keys, identical order/set to keys.json; 0 empties/whitespace issues; 0 English-identical values (not even Python — «Ejecutado Python»); 0 Unicode `Cf` (bidi/format) characters; all NFC; only á é í ó non-ASCII; all values start uppercase, no trailing punctuation; all 91 settled/running pairs present and parallel (everything after the verb token identical in each pair; verb stem matches); no placeholders/markup in source or target. The display tool redacted one token in my own output; raw bytes verified (`Actu…`), file is not affected.
Same English verb, multiple Spanish forms only by gender/number agreement, plus the deliberate Removed → Eliminado (milestone) / Quitado (device). No concept named two ways (red ×16, consola ×14, sesión ×14, dispositivo ×4, pares de red ×2).

## 4. Widths
Max 4 words (all ≤4) and max 30 chars (`Capturando pantalla de consola`); no string over 5 words/32 cells. Single-width Latin only, no combining marks (NFC). Nothing to flag; the m2-1 suggested `Previsualizando cambio de nombre` would be exactly 32.

## Commands actually run
python3 (json loaders, diff v1/v2, structural/width/Cf/NFC/pair checks, hashlib sha256); python3 catalogue term counts and regex search over the 158 shipped es JSON files; reading es.v2-changes.md, audit-es-B.md excerpts, es.md style guide. No ledger write (report-only task).
