# Notes — es · slice S16e-renderer (ui.chat.canonical, 12 keys)

Draft: `draft-es-s16e.json` (flat, brief key order, tab-indented, UTF-8, NFC, trailing newline).
Locale: **es (neutral Spanish), wave-1 locale**, addressing **tú**, sentence case, never Title Case.

## Sources read (file + sha256)

Repo worktree `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329`
(PR #1884), read-only; nothing written or checked out there.

| File | sha256 |
|---|---|
| core `~/local-operator/i18n/style-guides/es.md` (binding es guide) | `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |
| core `~/local-operator/i18n/glossary.md` (shared glossary) | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| core `~/local-operator/docs/design/i18n.md` (RFC §§2.2, 6) | `92eca5a123b65c4dea7e7ec2db9ddd4fec0b04c0fa038d10ba540e30f0d7e096` (read for §2.2 catalogue shape and §6 translator/auditor split; no string decision rests on it) |
| UI `docs/I18N.md` (HOWTO; "no locale CLI exists") | `d58ad473701f098b3c2c24343c3a7e7236f22db22cc871016c4cb75f25f41f5c` |
| UI `src/i18n/catalogues/en/ui.chat.canonical.json` (source) | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| UI `src/i18n/catalogues/en/ui.chat.canonical.context.json` (sidecar) | `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| UI `src/i18n/catalogues/es/ui.chat.canonical.json` (shipped es terminology) | `547b85e9670eec79f82211f50325092bf75c13eda4504995cce1a1d5ab25e272` |
| brief `s16e-brief.json` (verified) | `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` |

## Term choices, with the shipped es evidence

All twelve keys ride the same nine terms as the existing `image_gen.*` and
`sound.*` keys in `es/ui.chat.canonical.json`; no new rendering of an
already-shipped term is introduced.

- **material nouns (select branches)** — reused verbatim from
  `image_gen.state.running` / `state.done` / `state.failed_batch`:
  `video` → **vídeo**, `voiceover` → **locución**, `sound_effect` →
  **efecto de sonido**, `other` → **imagen/es**. The select keywords
  (`video`, `voiceover`, `sound_effect`, `other`) stay English.
- **batch** → **lote** (`state.done_batch` "Lote de vídeos"; `state.failed_batch`
  "Falló el lote de vídeos.").
- **stopped** → **detener / detención** (`image_gen.control.stop` "Detener";
  `sound.stop.request_stop` "Solicitar detención"; `sound.batch.item_status`
  `cancelled` "Detenida"; `transcript.stopped_before_finishing` "Se detuvo antes
  de terminar"). Not `cancelar`, which the catalogue reserves for
  jobs/sessions/wakes (`tool_row.verb.cancelled*`).
- **provider** → **proveedor** (`sound.stop.warning` "El proveedor no tiene un
  endpoint de cancelación."; `transcript.connect_provider` "Conectar un
  proveedor").
- **charge / billing** → verb **cobrar**, noun **cobro**, zero-charge phrase
  **Sin cargo.** (`sound.stop.warning` "… se cobrará si produce audio … ni
  evitar el cobro."; `sound.cost.no_charge` "Sin cargo.";
  `sound.cost.estimated_zero` "… cobro final sin confirmar.").
- **settlement** → **cobro final**, taken straight from
  `sound.cost.estimated_zero`; so `cancel.checking` and `settlement.pending`
  use the same noun phrase ("Comprobando el cobro final." / "Cobro final
  pendiente …").
- **endpoint** stays Latin/undeclined (kept-English set, glossary §2 wave-2
  list and es guide list).
- **tool** → **herramienta**, **arguments** → **argumentos**, **id** →
  **id** lowercase mid-sentence (`run_details.reader.no_session_id` "… id de
  sesión …"), **denied** → **Denegado** (`ui.browser.approval_queue_model.denied`,
  `ui.mesh.mesh_approvals.denied` both ship exactly "Denegado").
- **invalid** → **no válido** (dominant shipped form: 7 keys incl.
  `ui.browser.chrome.invalid_order` "… no válido."; `inválido` appears once,
  in `ui.mesh.mesh_reach.attempt_bad_address`).

## Per-key judgement calls

1. `state.cancelled_batch` — each branch is a full sentence on the
   `failed_batch` pattern: **"Se detuvo el lote de vídeos."** (verb-first, like
   "Falló el lote de vídeos."), not the shorter "Lote de vídeos detenido.".
   The sidecar's note ("must read as the same family" as the failed batch line)
   outranks the English "two to four words": the es line is 6 words because es
   needs the article and inflected verb. Widest branch 195 chars vs 157 en.
2. `cancel.queued` — **"Se detuvo antes de llamar al proveedor; no se te
   cobrará."** Kept the promise flat, not a maybe (sidecar note). "no se te
   cobrará" is the tú-form of the shipped impersonal "se cobrará"; the
   promise is preserved, and no hedging was added. Semicolon, no space before
   it (es convention; the guide's no-space rule is for `: ; ? !`).
3. `cancel.running` — **"Detención solicitada. El proveedor no tiene un
   endpoint de cancelación; la generación continúa y se cobrará si produce
   audio."** Second and third clauses are lifted from the shipped
   `sound.stop.warning` so the card and the stop dialog say the same thing.
   No "sin coste" anywhere: this value must not read as a guarantee. No
   appended settlement clause (the callsite joins `cancel.checking`).
4. `cancel.checking` — **"Comprobando el cobro final."** Complete sentence,
   own full stop, 27 chars vs 24 en; dropped as the sidecar describes.
5. `settlement.pending` — **"Cobro final pendiente — aparecerá en cuanto el
   proveedor lo comunique."** The em dash is kept (spaced " — ") because the
   es guide lists it as idiomatic es punctuation with spaces; it is not a
   French-style import. Noun-phrase + dash-clause mirrors the English shape.
   Says a charge is outstanding, never an amount, never zero. Shorter than en
   (70 vs 79 chars).
6. `error.audio_rate_limited` — **"La generación de audio está saturada ahora
   mismo. Espera un momento y vuelve a intentarlo."** `saturada` is the settled
   es word for an overloaded service and avoids `límite`-based phrasing that
   would read as a cap on audio. No promise of success, no specific wait time.
   90 chars vs 64; it wraps inside the card and the length hint is "two short
   sentences", not a cell budget.
7. `error_class.audio_rate_limited` — **"Audio saturado"** (14 chars vs 18).
   Same `saturado` as the sentence above so label and sentence agree.
8. `error_class.unknown_tool` — **"Herramienta desconocida"** (23 vs 12).
   Widest honest rendering; no register-appropriate abbreviation exists and
   the English has no abbreviating convention here either.
9. `error_class.invalid_arguments` — **"Argumentos no válidos"** (21 vs 17),
   shipped `no válido` form.
10. `error_class.duplicate_id` — **"Id duplicado"** (12 vs 12). `Id` is
    sentence-case start of the label (`id` mid-sentence elsewhere in the
    catalogue), not a translated word.
11. `error_class.denied` — **"Denegado"** (8 vs 6), byte-identical to three
    shipped `Denegado` labels.
12. `error_class.gate_failed` — **"Bloqueo por política"** (20 vs 11). See the
    glossary proposal below; this is the one term with no shipped es precedent.

## Glossary proposals (missing rows this slice needed)

| Term | Proposed es | Why |
|---|---|---|
| gate (policy gate) | **bloqueo por política** (label form); *"el control de políticas"* if a prose noun is ever needed | No `gate` row exists and no shipped es string translates it as a noun: core es renders the concept as "modo de aprobación"/"aprobaciones" (`relay.asks.gate.*`) and the single UI occurrence is a `{gate}` config token (`settings.configuration.backend_setting_row.gate_note` = "Necesita que actives “{gate}”."). `puerta`, `compuerta`, `barrera` are not es dev usage. |
| provider | **proveedor** | Shipped, not yet in the glossary table. |
| charge (noun/verb) | **cobro** / **cobrar**; zero = **sin cargo** | Shipped across `sound.cost.*` and `sound.stop.warning`. |
| settlement (of a charge) | **cobro final** | Shipped in `sound.cost.estimated_zero`. |
| batch | **lote** | Shipped in `state.done_batch` / `state.failed_batch`. |
| voiceover | **locución** | Shipped in `state.running` / `state.done`. |
| sound effect | **efecto de sonido** | Shipped in `state.running` / `state.done`. |
| rate limited | **saturado** | No shipped occurrence; chosen here (see 6/7). |
| stop (a generation) | **detener / detención** (not `cancelar`) | Shipped split: `image_gen`/`sound` use `detener`, jobs/sessions/wakes use `cancelar`. Worth a row so future waves do not merge them. |

## Width

No `maxCells`/`maxChars` in the en sidecar for any of these twelve. Measured
characters (en → es) are in the per-key notes above. The two label lines worth
a design eye if wrapping is reported: `error_class.unknown_tool` (23) and
`error_class.gate_failed` (20). If the gate label wraps in the card, the
recorded tightening option is **"Bloqueo"** alone (the gate's own reason sits
directly below), but I did not take it: "policy" is what separates this class
from `denied`, and the sidecar says the label is a class, not a sentence.

## Structural validation (actually run)

`node_modules` is absent from this worktree (the slice forbids installs), so
`pnpm check-i18n` and the repo's own `src/i18n/messages.ts` could not be loaded
here; no locale CLI exists per `docs/I18N.md` step 4. Instead I ran **one small
node script** (`icucheck-es-s16e.mjs`, scratchpad) that loads `@formatjs/
icu-messageformat-parser` and `intl-messageformat` read-only from the primary
checkout (`~/local-operator-ui/node_modules`) — the same libraries the app's
runtime uses — and it parsed every en/es pair, compared the structural
skeleton (argument names, argument kinds, select/plural branches, plural
offset, tags) and formatted each es value under `es`:

```
ok  state.cancelled_batch [video]         -> Se detuvo el lote de vídeos.
ok  state.cancelled_batch [voiceover]     -> Se detuvo el lote de locuciones.
ok  state.cancelled_batch [sound_effect]  -> Se detuvo el lote de efectos de sonido.
ok  state.cancelled_batch [image]         -> Se detuvo el lote de imágenes.
ok  cancel.queued    -> Se detuvo antes de llamar al proveedor; no se te cobrará.
ok  cancel.running   -> Detención solicitada. El proveedor no tiene un endpoint de cancelación; la generación continúa y se cobrará si produce audio.
ok  cancel.checking  -> Comprobando el cobro final.
ok  settlement.pending -> Cobro final pendiente — aparecerá en cuanto el proveedor lo comunique.
ok  error.audio_rate_limited -> La generación de audio está saturada ahora mismo. Espera un momento y vuelve a intentarlo.
ok  error_class.audio_rate_limited -> Audio saturado
ok  error_class.unknown_tool -> Herramienta desconocida
ok  error_class.invalid_arguments -> Argumentos no válidos
ok  error_class.duplicate_id -> Id duplicado
ok  error_class.denied -> Denegado
ok  error_class.gate_failed -> Bloqueo por política
ALL OK: shape identical to en, all strings format under es
```

Also checked by hand/in the same script: exactly 12 keys, key order equals the
brief order, no key added or renamed, `state.cancelled_batch` keeps the
`{material}` select with all four English branch keywords, NFC form, valid
JSON, trailing newline. No `few` category was introduced (es has one/many/other;
none of these strings pluralises).

## Not done here (out of this slice's scope)

- No catalogue or ledger file was written: the worktree is read-only for this
  run. The ledger row (`locale: es`, `namespace: ui.chat.canonical`,
  `status: translated`) belongs to the coordinator merging the draft.
- No self-audit: a separate i18n-auditor must judge this locale.
- No translation service, SDK or MT was used; every string was written here.

## Open questions for the auditor/coordinator

1. `error_class.gate_failed` ("Bloqueo por política") — accept the new term, or
   prefer a different gate rendering? This is the only string without shipped
   es precedent.
2. `error_class.audio_rate_limited` — "Audio saturado" (state) vs "Límite de
   audio" (class). I chose the state word to match its sentence; if the auditor
   reads the label as naming the *class* rather than the condition, "Límite de
   audio" (15 chars) is the alternative.
3. `cancel.queued` — "no se te cobrará" (tú, indirect object) vs the shipped
   impersonal "no se cobrará". I kept the personal form because the sentence
   addresses the user; flagging it because it is the one key whose promise has
   legal weight.
