# Audit — es · `ui.chat.canonical` · slice S16e-renderer (12 ICU keys)

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT (3 INFO observations, not defects).

- **Locale:** es (neutral Spanish, wave 1, addressing **tú**)
- **Namespace (file group):** `ui.chat.canonical`
- **Slice / PR:** S16e-renderer, damianvtran/local-operator-ui #1884, worktree `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` (read-only; `git status --porcelain` empty after the audit)
- **Independent auditor:** `i18n-auditor`, session/instance **`15b65aa91541-es`**, actual model **`deepseek/deepseek-flash`**
  (model as reported by this session's runtime; no provider fallback was observed or declared)
- **Independence:** I did not write, edit or dictate any of these strings, and I changed no file in the repo. The draft was written by a separate translator session; I first formed my own reading of all 12 keys from the English source + sidecar, and only then read `notes-es-s16e.md`.
- **Audited bytes:** `draft-es-s16e.json`, sha256 `b9290ae76d05774eeca47b3bea438ac6df0be03c7907efaa3cb93a5d6082a50c` — identical to the hash in the manager's `s16e/manifest.json`, verified on my own copy.
- **No MT/translation service was used.** Judgement is by reading; the only tooling is the ICU parser/formatter the app itself uses.

## Inputs (hashes verified by me, not copied from the notes)

| Input | sha256 |
|---|---|
| draft `draft-es-s16e.json` (audited bytes) | `b9290ae76d05774eeca47b3bea438ac6df0be03c7907efaa3cb93a5d6082a50c` |
| English source `src/i18n/catalogues/en/ui.chat.canonical.json` | `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` |
| English context sidecar `…en/ui.chat.canonical.context.json` | `ec598772089552ace910c857a38b364bdfa83a32c76c62b752b761527531e7b7` |
| brief `s16e-brief.json` (en + per-key context) | `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` |
| shipped es catalogue (terminology authority for this surface) | `547b85e9670eec79f82211f50325092bf75c13eda4504995cce1a1d5ab25e272` |
| core glossary `~/local-operator/i18n/glossary.md` | `0eb34437a8c3d6f564f278ef957a603b1d9f51bb07d5ddae5ea8f37deba962f8` |
| core `~/local-operator/i18n/style-guides/es.md` | `77b9227213802d14c74d4298d6b346ad842bbf2a5ca3b9d46fc6144430d26c3e` |

Scope confirmation: `git diff HEAD~1 HEAD -- src/i18n/catalogues/en/ui.chat.canonical.json` adds **exactly these 12 keys** and nothing else — the draft's key set matches one-for-one (no key added, dropped or renamed).

## Method (every command is in `audit.log`; nothing there is written from memory)

1. **Mechanical.** `check.mjs` loads `@formatjs/icu-messageformat-parser` 3.5.21 from the primary checkout (read-only) and compares, per key, a full structural skeleton — argument names **and kinds**, `select`/`plural` branch names, `#`, tags — against the English. It also asserts: valid JSON; exact 12-key set; every value non-empty; `material` select = `video/voiceover/sound_effect/other`; every branch a complete sentence; es CLDR categories complete for any plural and no `few` (none of these 12 pluralises); es typography (no space before `; : ? !`, no `!`, spaced em dash, no double space, no bidi/invisible controls, no U+00A0, sentence-case starts, sentence-class values end with a full stop, label-class values must not); no English lexical items in the prose; nothing byte-identical to English. **Result: PASS.**
2. **Negative controls — 11/11 caught**, so the pass is not vacuous: dropped `sound_effect` branch (C1), renamed placeholder `{material}`→`{media}` (C2), broken ICU brace (C3), missing sentence full stop (C4), label acquiring a full stop (C5), English left in place (C6), space before `;` (C7), `few` category on a plural (C8), dropped key (C9), branch demoted to a non-sentence (C10), invalid JSON (C11).
3. **Real render.** Every value formatted through `intl-messageformat` 12.1.3 under `es`, including all four materials plus an unknown material (must degrade to the image wording — it does). No placeholder or markup leaks; no edge whitespace.
4. **Terminology.** Each rendering checked against the shipped es catalogue and the glossary by query (see `audit.log`), not by recollection. Cross-namespace precedent measured separately for the two labels this namespace has no row for.
5. **Two passes.** The failure-class and stop copy is high-visibility error copy, so after the first full pass I re-derived every key from the English side and re-checked promises, polarity and class separation independently (results below). **This is a second pass by the same auditor — it is not a second independent auditor.** If the programme requires the high-visibility second pass to come from a different instance, that is still owed; I am not claiming it.

## Per-axis result

| Axis | Result |
|---|---|
| 1. Mechanical (ICU, placeholders, keys, JSON, CLDR, typography) | **pass** — structurally identical to English; 11/11 negative controls caught |
| 2. Accuracy — every promise kept as the English draws it | **pass** — see the promise ledger below |
| 3. Idiom & register (tú, sentence case, terse, native) | **pass** — no calques found; reads as Spanish product copy |
| 4. Terminology (glossary + shipped catalogue) | **pass** — 9 terms reused from shipped keys; the one new term is grounded |
| 5. Fit | **pass** — no `maxCells`/`maxChars` exists for these keys; measured widths below |
| 6. RTL | **n/a** (es is LTR) |

### The promise ledger (the part this slice could actually get wrong)

| Key | English promises / refuses | es draft | Same? |
|---|---|---|---|
| `cancel.queued` | **The only no-charge promise** — categorical, not a maybe | «no se te cobrará» (categorical, tú) | ✅ promise intact, unhedged |
| `cancel.running` | Stop is a **request**; no cancellation endpoint; generation **continues**; **will be charged** if it produces audio; never "nothing was charged" | «Detención solicitada. El proveedor no tiene un endpoint de cancelación; la generación continúa y se cobrará si produce audio.» | ✅ nothing softened, no no-charge claim |
| `cancel.checking` | Neutral in-progress check, own sentence, no amount | «Comprobando el cobro final.» | ✅ complete sentence, its own full stop |
| `settlement.pending` | Charge still outstanding; **no amount, never a zero** | «Cobro final pendiente — aparecerá en cuanto el proveedor lo comunique.» | ✅ no amount, no zero, no date claimed |
| `error.audio_rate_limited` | Busy now; try again; **no success promise, no wait time** | «La generación de audio está saturada ahora mismo. Espera un momento y vuelve a intentarlo.» | ✅ "un momento", no "5 s"; no success claim |
| `error_class.denied` vs `gate_failed` | Two classes: the user's permission settings refused vs a configured policy gate stopped the call | «Denegado» vs «Bloqueo por política» | ✅ distinct strings, distinct causes |
| `error_class.unknown_tool` vs `invalid_arguments` / `duplicate_id` | Three distinct classes | «Herramienta desconocida» / «Argumentos no válidos» / «Id duplicado» | ✅ no label collision |

No negation or polarity inversion appeared anywhere; no value was softened into a maybe on `cancel.queued`, and no "sin coste" leaked into `cancel.running`.

### Notes on three places a reviewer might expect a finding (I checked, and none is one)

1. **`cancel.running` reuses shipped bytes.** «El proveedor no tiene un endpoint de cancelación … la generación continúa y se cobrará si produce audio» is lifted from the shipped `sound.stop.warning` wording (`sound.stop.warning` = «… de cancelación. La generación continúa y se cobrará si produce audio. …»); only the joining punctuation differs, and it follows the English semicolon. That is the correct consistency direction: card and stop dialog say the same thing.
2. **`settlement` → «cobro final»** collapses English's two words (settlement / final charge) into the phrase the catalogue already ships for *final charge* (`sound.cost.estimated_zero` = «Coste estimado de $0; cobro final sin confirmar.»). No es catalogue anywhere ships «liquidación»/«asentamiento». The user-facing fact — a charge is pending and unnamed — survives intact, and `cancel.checking` uses the same phrase, so label and note agree. Accepted.
3. **`Id duplicado`.** «Id» is the one token that could look like English left in place. It is not a translation: the catalogue keeps `id` as a machine token (`transcript.job_suffix` = «· Trabajo {id}»), and capitalising it is sentence case at label start, not a translated word. English left in copy is limited to «endpoint», which the es guide keeps Latin explicitly ("Kept-English technical list: … endpoint …").

## Findings

**None at BLOCKER, MAJOR, MINOR or NIT.** Findings table (empty):

| ID | Severity | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| — | — | — | — | none found | — |

### Observations (INFO — verified OK, recorded not churned)

| ID | Key | Observation |
|---|---|---|
| O1 | `error_class.gate_failed` | «Bloqueo por política» names the *reason* where English names the *mechanism* ("Gate failed"). I accept it: no es catalogue translates "gate" as a noun at all (core `relay.asks.gate.*` renders the concept as «Aprobaciones»/«modo de aprobación»; zero occurrences of «puerta»/«compuerta» anywhere in es), the label cannot wrap into the class it sits above, and it stays distinct from «Denegado». A mechanism-named variant would be longer and stilted («Control de política fallido»). |
| O2 | `error_class.audio_rate_limited` | «Audio saturado» names the condition where English names the class ("Audio rate limited"). Accepted: it agrees with the sentence rendered directly below («está saturada ahora mismo»), which is the stronger requirement, and no other class label shares the word. The alternative «Límite de audio» would introduce the "cap on audio" reading the translator wanted to avoid. |
| O3 | fit | Measured rendered widths (real formatter, not source length): widest es branch «Se detuvo el lote de efectos de sonido.» = 39 chars vs 27 en (1.44×); widest label «Herramienta desconocida» = 23 vs 12 (1.92×); `cancel.running` is 125 = 125 en. No `maxCells`/`maxChars` exists in the sidecar for any of the 12, and these keys render in a full-width card line (labels in a `text-meta` paragraph with no width class), so there is no budget to violate. Flagged for design only if wrapping is ever reported. |

Correction to the translator's notes, offered because the manager may quote it: the notes' "widest branch 195 chars vs 157 en" is the **ICU source** length, not what renders. The rendered figures are the ones above.

## Reviewer judgement on the translator's three open questions

1. **`gate_failed` → «Bloqueo por política»:** accept (O1). It is the only string here without shipped es precedent, and the absence of any es "gate" noun makes a reason-named label the honest choice; the class boundary the brief cares about (denied vs gate_failed) holds.
2. **`audio_rate_limited` label:** keep «Audio saturado» (O2). Label and sentence agreeing outranks matching English's register split.
3. **`cancel.queued` «no se te cobrará»:** keep. The tú indirect-object promise is correct per the es guide's recorded tú decision, it is categorical (no modal, no adverb of doubt), and the shipped impersonal «se cobrará» it departs from sits in a *warning* about being charged — the opposite speech act. Personalising it here is right, not drift.

## Ledger / evidence (repo writes are the implementer's: this audit is read-only)

The UI-repo contract is `i18n/ledger.json` (read by `scripts/i18n/ledger-check.mjs`, written by `scripts/i18n/ledger-assemble.mjs`, rules in `scripts/i18n/ledger-rules.mjs`). Its current `es`/`ui.chat.canonical` row describes the **shipped** catalogue (`target_sha256 547b85e9…`), not this draft, so the S16e row is a new row keyed on the post-merge hashes. I prepared it verbatim in `ledger-row.json` beside this report, including a gate-shaped receipt (`receipt.json`, `result: "clean"`, `findings` counts all zero, real 12-hex instance, `receipt_sha256`).

For the tracked bundle, copy my scratchpad companions into
`i18n/audits/evidence/es/ui.chat.canonical/s16e-15b65aa91541-r1/` (`record.json`, `report.md`, `audit.log`, `receipt.json`); the ledger note references that path under 280 characters.

**Freshness caveat:** this verdict is bound to en `b967adc3…` and draft `b9290ae7…`. If either moves before merge, the delta must be re-judged rather than the row re-pointed; the whole-namespace row additionally inherits the earlier audited bytes for the 442 keys this slice does not touch (the existing row's own delta-audit precedent).

## What I did not do

- No repo write of any kind (no catalogue, ledger, receipt or evidence commit); no install, build or test suite. Worktree clean afterwards.
- No rendered-frame/browser or TUI capture: this group is catalogue copy, and the card's visual states are the design/QA lanes' evidence, not the locale audit's.
- No second *independent* auditor for the high-visibility error copy (my second pass was my own) — say so if the programme requires one.
- No glossary file edit: the term proposals in the translator's notes (provider, charge, settlement, batch, rate limited, stop-vs-cancel, gate) are worth landing as glossary rows, but that is a glossary change, not part of this verdict.
