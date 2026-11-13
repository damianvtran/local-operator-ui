# Spanish L1 remediation v2 — 2026-11-11

Translator: i18n-translator, session f5d236199e73, actual served model **openai/gpt-6.1-sol** (session runtime header; no fallback used).
Allocation: bounded fix (<2 h). No MT, translation APIs or external translation services used. This is translator remediation, NOT an independent audit. No catalogue, ledger or guide changed; no commit made.

## Scope and evidence

Read both reports in full, all 91 operation-family roles from source/context, the source pair/grammar notes, existing es.json, core docs/I18N.md and RFC introduction, en/es style guides and glossary, plus shipped Spanish tool-row bridge/generic strings and relevant shipped terminology. Mechanical checks cover all 182 source entries. Source/context role identifies the actual operation for each family. All 91 settled values now follow the requested systemic participial/status register, not just examples. Explicit direct objects agree: «Leídas tareas», «Creada sesión», «Redimensionada consola»; prepositional complements do not control agreement («Escrito en consola»). Verb-before-object and trailing relations retained.

Shipped precedent in src/i18n/catalogues/es/ui.chat.canonical.json: generic_verb.settled=Invocado; bridge channel_create=Creado; channel_history=Leído en; channel_post=Publicado en; shared_history=Leída la conversación compartida; dm=Mensaje enviado a; react_remove=Reacción quitada en. One existing exception, bridge unknown=Usó Team Bridge, is not a reason to extend the drift. A’s blanket clearance of the preterite conflicts with B’s M1 and the explicit remediation brief; M1 takes precedence here, without editing the guide.

Terminology scan over non-context shipped JSON: consola 43 keys, despertar 43, secreto 25, actualización 141, trabajos 11, tareas 32, hito 26, variable 40, pares 0, pánico 0, renombr 11 (substring counts, not normalized lemma counts). Network peer has no shipped «pares» precedent; retain the technical «pares de red», not «dispositivos». Style guide explicitly mandates trabajo, despertar and sesión. For hito, existing ui.projects error «El hito no se eliminó» supports retaining eliminar.

## Finding decisions

12 fully fixed findings, 1 partially fixed/partially declined (m1), 3 wholly declined; no deferred findings. Declined portions are non-gating preferences with evidence below. All BLOCKER/MAJOR requests addressed, pending independent recheck.

| Finding | Decision | Keys / exact changes or reason |
|---|---|---|
| es-A-01 | fixed | spawned_session.*: Inició sesión → Creada sesión; Iniciando sesión → Creando sesión. Spawn creates an agent session, unlike the shipped sign-in labels. |
| es-A-02 | fixed | joined_network.*: Se unió a red → Unido a la red; Uniéndose a red → Uniéndose a la red. left_network.*: Salió de red → Desconectado de la red; Saliendo de red → Desconectándose de la red. Articles restored; disconnect meaning preserved. Auditor’s proposed «Se unió a la red» is actually 5 words; chosen status form uses 4. |
| es-A-03 | fixed | viewed_network.*, diagnosed_network.*, created_network.*: Consultó red → Consultada la red; Diagnosticó red → Diagnosticada la red; Creó red → Creada la red; corresponding gerunds gain la. |
| es-A-04 | fixed | previewed_rename.*: Previsualizó cambio de nombre → Previsualizado renombrado; Previsualizando cambio de nombre → Previsualizando renombrado. Keeps preview, does not claim an applied rename. |
| es-A-05 | declined | peeked_at.* / peeked_at_session.* retain revisar (now Revisado / Revisada sesión in settled form due to M1). Revisar describes inspecting recent output without claiming exhaustive review; ojeado would introduce another UI term. B n3 independently accepts revisar. |
| es-A-06 | fixed | waited_for_jobs.*: Esperó trabajos → Esperado fin de trabajos; Esperando trabajos → Esperando fin de trabajos. Makes job completion rather than job arrival explicit, without the auditor’s animate-object a los trabajos construction. |
| B1 | fixed | spawned_session.*: same change as es-A-01. |
| M1 | fixed | ALL 91 settled values changed to participial status forms, agreeing in gender/number with explicit objects. Examples: Ejecutó → Ejecutado; Leyó variable → Leída variable; Listó agentes → Listados agentes; Actualizó tareas → Actualizadas tareas. Full exact delta table below. Running gerunds retained except accepted semantic fixes. |
| m1 | partly fixed / partly declined | removed_device.*: Eliminó dispositivo → Quitado dispositivo; Eliminando dispositivo → Quitando dispositivo (membership removal, not deletion; shipped bridge react_remove uses quitada). removed_milestone.* retains eliminar (Eliminado hito / Eliminando hito): shipped ui.projects.project_detail.the_milestone_was_not_removed uses «El hito no se eliminó»; removal deletes the milestone, unlike device membership revocation. |
| m2 | fixed | joined_network.* / left_network.*: same changes as es-A-02. |
| m3 | fixed | raised_panic.*: Activó pánico → Activado modo pánico; Activando pánico → Activando modo pánico. Explicit mode, not emotional panic. |
| m4 | fixed | waited_for_jobs.*: same changes as es-A-06. |
| m5 | fixed | previewed_rename.*: same changes as es-A-04. |
| n1 | declined | fetched.* retains obtener (now Obtenido / Obteniendo). web_fetch retrieves and renders page/file contents, including JSON/HTML, not necessarily a download saved to disk; descargar would narrow its meaning. |
| n2 | fixed | captured_console.*: Capturó consola → Capturada pantalla de consola; Capturando consola → Capturando pantalla de consola. Screenshot semantics explicit; both fit 4 words. |
| n3 | declined | peeked_at.* / peeked_at_session.*: same reasoning as es-A-05; retain revisar, adopting participle status agreement only. |

## Mechanical validation actually executed

`python3` loaded keys.json, es.json and es.v2.json with duplicate-key rejection and asserted: valid JSON; exactly 182 source keys in identical order; no empty/whitespace-only strings; no English-identical string except allowed Python (none actually identical); no manual bidi/Unicode format controls; no markup/placeholder changes (source has none); every value 1–4 words. **PASS**. 102 changed keys: all 91 settled + 11 running.

`pnpm check-i18n:catalogues` in the manager worktree: **exit 1**. generate freshness PASS (keys.gen.ts byte-identical); duplicates PASS (1428 files, zero); literal ratchet PASS (1660 files, zero at/below baseline; 40 allowed data-shape literals). ledger-check FAIL: 24 findings, 1106 ledger entries; all seven locales lack the 182 new keys and carry stale source/receipt hashes for ui.chat.canonical. Direct re-read of the Spanish worktree catalogue confirms all 182 prep keys absent: this command validates the unintegrated worktree, NOT es.v2.json. No ledger statuses/hashes were bypassed. context-parity was short-circuited, so `node scripts/i18n/context-parity.mjs` was run separately: exit 0, every English key covered apart from 129 allowed gaps in 4 namespaces.

## Width / ambiguities / glossary proposals

No 5-word exceptions: all 182 values use 1–4 words. No hard maxCells supplied. Longest values after tightening are listed below; console screenshot gains precision at the cost of 4 words. Status participles have inherent subject-gender ambiguity when only an opaque identifier follows; unspecified generic objects use masculine singular, explicit nouns agree. «Navegado por» retains the location relation and adopts the requested status register. The independent recheck should review these register-wide edits, not merely the lexical fixes.

Glossary proposals (not style-guide edits): peer → par de red; rename (noun, LSP) → renombrado; panic safety state → modo pánico. Terms with existing shipped/guide precedent unchanged.

- `captured_console.running`: Capturando pantalla de consola — 30 characters/cells, 4 words.
- `captured_console.settled`: Capturada pantalla de consola — 29 characters/cells, 4 words.
- `updated_secure_input.running`: Actualizando entrada segura — 27 characters/cells, 3 words.
- `updated_secure_input.settled`: Actualizada entrada segura — 26 characters/cells, 3 words.
- `previewed_rename.running`: Previsualizando renombrado — 26 characters/cells, 2 words.

## Full changed-key table (source order)

| Key suffix (`ui.chat.canonical.tool_row.verb.`) | Old | New |
|---|---|---|
| `ran.settled` | Ejecutó | Ejecutado |
| `ran_python.settled` | Ejecutó Python | Ejecutado Python |
| `read.settled` | Leyó | Leído |
| `wrote.settled` | Escribió | Escrito |
| `edited.settled` | Editó | Editado |
| `listed.settled` | Listó | Listado |
| `searched.settled` | Buscó | Buscado |
| `searched_the_web.settled` | Buscó en la web | Buscado en la web |
| `fetched.settled` | Obtuvo | Obtenido |
| `browsed.settled` | Navegó por | Navegado por |
| `listed_variables.settled` | Listó variables | Listadas variables |
| `read_variable.settled` | Leyó variable | Leída variable |
| `asked.settled` | Preguntó | Preguntado |
| `sent.settled` | Envió | Enviado |
| `waited_for_jobs.settled` | Esperó trabajos | Esperado fin de trabajos |
| `waited_for_jobs.running` | Esperando trabajos | Esperando fin de trabajos |
| `deleted_team.settled` | Eliminó equipo | Eliminado equipo |
| `deleted_project.settled` | Eliminó proyecto | Eliminado proyecto |
| `received.settled` | Recibió | Recibido |
| `delegated.settled` | Delegó | Delegado |
| `listed_agents.settled` | Listó agentes | Listados agentes |
| `viewed_agent.settled` | Consultó agente | Consultado agente |
| `searched_agents.settled` | Buscó agentes | Buscados agentes |
| `installed_agent.settled` | Instaló agente | Instalado agente |
| `reset_agent.settled` | Restableció agente | Restablecido agente |
| `created_agent.settled` | Creó agente | Creado agente |
| `updated_agent.settled` | Actualizó agente | Actualizado agente |
| `synced_agents.settled` | Sincronizó agentes | Sincronizados agentes |
| `listed_teams.settled` | Listó equipos | Listados equipos |
| `viewed_team.settled` | Consultó equipo | Consultado equipo |
| `created_team.settled` | Creó equipo | Creado equipo |
| `updated_team.settled` | Actualizó equipo | Actualizado equipo |
| `listed_subagents.settled` | Listó subagentes | Listados subagentes |
| `peeked_at.settled` | Revisó | Revisado |
| `messaged.settled` | Envió mensaje a | Enviado mensaje a |
| `steered.settled` | Reorientó | Reorientado |
| `paused.settled` | Pausó | Pausado |
| `cancelled.settled` | Canceló | Cancelado |
| `resumed.settled` | Reanudó | Reanudado |
| `stored_secret.settled` | Guardó secreto | Guardado secreto |
| `retrieved_secret.settled` | Recuperó secreto | Recuperado secreto |
| `listed_secrets.settled` | Listó secretos | Listados secretos |
| `described_secret.settled` | Describió secreto | Descrito secreto |
| `updated_secret.settled` | Actualizó secreto | Actualizado secreto |
| `deleted_secret.settled` | Eliminó secreto | Eliminado secreto |
| `listed_projects.settled` | Listó proyectos | Listados proyectos |
| `viewed_project.settled` | Consultó proyecto | Consultado proyecto |
| `created_project.settled` | Creó proyecto | Creado proyecto |
| `updated_project.settled` | Actualizó proyecto | Actualizado proyecto |
| `linked_session_to.settled` | Vinculó sesión a | Vinculada sesión a |
| `unlinked_session_from.settled` | Desvinculó sesión de | Desvinculada sesión de |
| `updated_milestone.settled` | Actualizó hito | Actualizado hito |
| `removed_milestone.settled` | Eliminó hito | Eliminado hito |
| `read_todos.settled` | Leyó tareas | Leídas tareas |
| `updated_todos.settled` | Actualizó tareas | Actualizadas tareas |
| `scheduled.settled` | Programó | Programado |
| `listed_wakes.settled` | Listó despertares | Listados despertares |
| `cancelled_wake.settled` | Canceló despertar | Cancelado despertar |
| `listed_jobs.settled` | Listó trabajos | Listados trabajos |
| `cancelled_job.settled` | Canceló trabajo | Cancelado trabajo |
| `checked_network_status.settled` | Comprobó estado de red | Comprobado estado de red |
| `listed_networks.settled` | Listó redes | Listadas redes |
| `viewed_network.settled` | Consultó red | Consultada la red |
| `viewed_network.running` | Consultando red | Consultando la red |
| `listed_network_peers.settled` | Listó pares de red | Listados pares de red |
| `read_network_log.settled` | Leyó registro de red | Leído registro de red |
| `diagnosed_network.settled` | Diagnosticó red | Diagnosticada la red |
| `diagnosed_network.running` | Diagnosticando red | Diagnosticando la red |
| `created_network.settled` | Creó red | Creada la red |
| `created_network.running` | Creando red | Creando la red |
| `invited_device.settled` | Invitó dispositivo | Invitado dispositivo |
| `joined_network.settled` | Se unió a red | Unido a la red |
| `joined_network.running` | Uniéndose a red | Uniéndose a la red |
| `removed_device.settled` | Eliminó dispositivo | Quitado dispositivo |
| `removed_device.running` | Eliminando dispositivo | Quitando dispositivo |
| `left_network.settled` | Salió de red | Desconectado de la red |
| `left_network.running` | Saliendo de red | Desconectándose de la red |
| `raised_panic.settled` | Activó pánico | Activado modo pánico |
| `raised_panic.running` | Activando pánico | Activando modo pánico |
| `listed_consoles.settled` | Listó consolas | Listadas consolas |
| `opened_console.settled` | Abrió consola | Abierta consola |
| `checked_console.settled` | Comprobó consola | Comprobada consola |
| `read_console.settled` | Leyó consola | Leída consola |
| `captured_console.settled` | Capturó consola | Capturada pantalla de consola |
| `captured_console.running` | Capturando consola | Capturando pantalla de consola |
| `typed_in_console.settled` | Escribió en consola | Escrito en consola |
| `sent_keys.settled` | Envió teclas | Enviadas teclas |
| `resized_console.settled` | Redimensionó consola | Redimensionada consola |
| `updated_secure_input.settled` | Actualizó entrada segura | Actualizada entrada segura |
| `closed_console.settled` | Cerró consola | Cerrada consola |
| `found_definition.settled` | Localizó definición | Localizada definición |
| `found_references.settled` | Localizó referencias | Localizadas referencias |
| `listed_symbols.settled` | Listó símbolos | Listados símbolos |
| `previewed_rename.settled` | Previsualizó cambio de nombre | Previsualizado renombrado |
| `previewed_rename.running` | Previsualizando cambio de nombre | Previsualizando renombrado |
| `listed_sessions.settled` | Listó sesiones | Listadas sesiones |
| `viewed_session.settled` | Consultó sesión | Consultada sesión |
| `spawned_session.settled` | Inició sesión | Creada sesión |
| `spawned_session.running` | Iniciando sesión | Creando sesión |
| `resumed_session.settled` | Reanudó sesión | Reanudada sesión |
| `stopped_session.settled` | Detuvo sesión | Detenida sesión |
| `peeked_at_session.settled` | Revisó sesión | Revisada sesión |

## Input/output SHA-256

- `keys.json`: `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419`
- `es.json`: `d44da14ac96c31d6d50cf202e77808bad75d2d3270bffb38577c04b933607aac`
- `es.v2.json`: `d28c28214bb0039f0c5e9e80c671a26e2ff4fa8546c6fed8e76f79d4928127f8`
- `audit-es-A.md`: `85c7dc04adcd5e09e77df52a097b6029ec9d9ace9cfe643958dba59f5f32ba9a`
- `audit-es-B.md`: `566182cb483eb0c859bda0fbc9d7e28bdc9cfbc65fe27f7aa6f8665ef1aa6e5f`
