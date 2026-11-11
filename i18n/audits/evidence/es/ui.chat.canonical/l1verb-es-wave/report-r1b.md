# l1-au-es-B — independent audit, locale `es`, 182 tool_row.verb.* keys

Auditor: i18n-auditor (team lopdev), served model anthropic/claude-sonnet-5-5. Not the translator (openai/gpt-6.1-sol).
Inputs: keys.json, es.json (worktree `_l1-prep`), es.md style guide, shipped es `ui.chat.canonical.json` (generic_verb.*, bridge.*). Glossary has no entry for panic/peer.

## Mechanical (python3, executed)
- key set AND order identical to keys.json: True (182/182)
- empty values: none · English-identical values: none · manual bidi/control chars: none
- leading/trailing whitespace or terminal punctuation: none
- duplicate values across keys: none
- settled/running pairs: all 91 share the same verb stem and trailing object/preposition, except `joined_network` (reflexive "Se unió a red" / "Uniéndose a red"; both correct, only a mechanical tail diff)
- none of the 182 keys already exists in the shipped catalogue (no collisions)
- longest values: `previewed_rename.running` 32 chars (4 words), `previewed_rename.settled` 29; English max is 23. Verb span is `shrink-0 whitespace-nowrap` (tool-row.tsx ~L990), so long verbs squeeze the truncating object rather than overflow.

## Findings

### BLOCKER (1)
- **B1** `verb.spawned_session.settled` "Inició sesión" / `.running` "Iniciando sesión". In Spanish "iniciar sesión" is the fixed idiom for **log in / sign in**. The `sessions` tool's `spawn` op creates a new lop session. A transcript row "Inició sesión `abc`" reads as the agent authenticating. Misleading in a permission-sensitive context.
  Suggest: settled "Lanzó sesión", running "Lanzando sesión" (or "Creó sesión"/"Creando sesión"; "Lanzó" avoids colliding with `created_*`).

### MAJOR (1)
- **M1** Form/tense drift from shipped copy, all 91 settled values. Shipped settled forms in the same transcript use the **past participle**: `generic_verb.settled` "Invocado"; `bridge.verb.*.settled` "Creado", "Leído en", "Enviado a", "Publicado en", "Liberado"; style guide: "Terse: Guardado". The new set uses **third-person preterite** ("Ejecutó", "Creó agente", "Leyó", "Envió mensaje a"). So a turn that mixes tool rows would show "Creado" (bridge channel_create) next to "Creó agente", and "Mensaje enviado a" (bridge dm) next to "Envió mensaje a" (hub send). The running forms match shipped (gerund). Judgement call, not a mistranslation: either (a) switch settled to participles ("Ejecutado", "Leído", "Escrito", "Creado agente"...) or (b) record the preterite as a deliberate decision in es.md and accept the mix. I recommend (a). Waivable with a recorded decision; I did not count it as a BLOCKER.

### MINOR (5)
- **m1** `removed_device` "Eliminó dispositivo"/"Eliminando dispositivo" (network `member_rm`) and `removed_milestone` "Eliminó hito"/"Eliminando hito". English separates Removed from Deleted (`deleted_team/project/secret` → "Eliminó"), Spanish collapses both onto "Eliminó". `member_rm` revokes membership, it does not delete the device. Suggest "Quitó dispositivo"/"Quitando dispositivo", "Quitó hito"/"Quitando hito" (shipped bridge already uses "Quitó/Quitando la reacción").
- **m2** `joined_network` "Se unió a red"/"Uniéndose a red", `left_network` "Salió de red"/"Saliendo de red": preposition + bare singular noun reads clipped. Suggest "Se unió a la red"/"Uniéndose a la red", "Salió de la red"/"Saliendo de la red" (still ≤4 words).
- **m3** `raised_panic` "Activó pánico"/"Activando pánico": no article; reads like the user panicking. Suggest "Activó el pánico"/"Activando el pánico" (or "Activó modo pánico").
- **m4** `waited_for_jobs` "Esperó trabajos": "esperar" + direct object suggests waiting for the jobs to arrive. Suggest "Esperó a los trabajos"/"Esperando a los trabajos" or "Esperó trabajos" accepted if terse register is preferred. (Weak; the monospace job id follows.)
- **m5** `previewed_rename.running` "Previsualizando cambio de nombre" (32 chars, longest; 29 settled). Shrink-0 verb costs object width. Suggest "Previsualizó renombrado"/"Previsualizando renombrado" (23/26), same meaning.

### NIT (3)
- **n1** `fetched` "Obtuvo"/"Obteniendo" for `web_fetch`: generic; "Descargó"/"Descargando" is closer to fetching a URL. Acceptable as is.
- **n2** `captured_console` "Capturó consola" (screenshot op): could be read as capturing the console session; "Capturó pantalla de consola" is clearer but wider. Acceptable.
- **n3** `peeked_at` / `peeked_at_session` "Revisó": slightly stronger than "peeked"; no better short Spanish equivalent; acceptable. Note the key also serves `jobs.peek`.

## Checked and fine
- Destructive vs read-only: no swap. Delete/Remove/Cancel/Stop/Reset map to destructive-class verbs (Eliminó, Canceló, Detuvo, Restableció), List/View/Read/Peek map to read-only ones (Listó, Consultó, Leyó, Revisó).
- Glossary: session→sesión, wake→despertar ("Listó despertares", "Canceló despertar"), job→trabajo, skill n/a, team→equipo, tú/infinitive n/a. "listar" matches shipped bridge usage.
- Trailing prepositions kept: "Navegó por", "Vinculó sesión a", "Desvinculó sesión de", "Envió mensaje a", "Escribió en consola", "Buscó en la web". `peeked_at` drops "at" correctly (Revisó is transitive).
- No English left (Python is a technology name, allowed). Accents ok (Envió, Previsualizó, Diagnosticó). No bidi chars. All 1–4 words.

## Verdict: blocked (B1 must be fixed; M1 needs a decision)
Counts: blocker 1, major 1, minor 5, nit 3.
Ledger not written (task asked for a report only).
