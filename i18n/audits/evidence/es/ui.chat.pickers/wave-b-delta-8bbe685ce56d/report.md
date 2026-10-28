# Wave B delta audit — Spanish (`es`) — `a5356ce91c`

Independent translation audit of the wave-B amendments. Subject: branch
`i18n-wave-b`, head `a5356ce91c4f37bf4c4d1c4518070e3a9b2505cb`, parent
`0559f7f7d830752b0c5d118c2b1049f125b43bbb` (audited for `es` in the previous
round, receipt `~/qa/wave-b-audit-es/receipt.json`, sha256
`481bf2d41a0a61f5b124a7a3c7ff831f6f0eee6638c463009589c3d9eb5dc34d` — recorded
here as the previous round's artifact reference; it is machine-local, not a
tracked record).

Auditor: agent `i18n-auditor`, session `8bbe685ce56d`, model `radient/auto` (the
harness session header's own route; no fallback observed). Independent: this
session did not translate or edit a single catalogue value, English source,
generated file or ledger row. It wrote only its own evidence, plus — in a
throwaway detached worktree that was deleted afterwards — the receipt and ledger
rows shipped for the coordinator to apply. No MT/translation API or SDK was used;
`intl-messageformat` was run as validation of the app's own render path, never to
produce copy.

## 1. What changed in wave B, `es` and `en`

Parsed-JSON diff of the nine wave-B namespace files between the parent and the
head (`diff.py`, `diff-report.json`). Seven values changed: six Spanish, one
English.

| Key | Before | After |
|---|---|---|
| `ui.chat.device.footer.move_deletes_copy` (es) | `…cuando se completa el movimiento.` | `…cuando se completa el traspaso.` |
| `ui.chat.pickers.slash.enter_needs_a_pick` (es) | `Enter necesita una fila que elijas: ↓ y luego Enter · Tab completa esta fila.` | `Intro necesita que elijas una fila: ↓ y luego Intro · Tab completa esta fila.` |
| `ui.chat.session_status.not_signed_in_description` (es) | `Esta sesión ejecuta {label}…` | `Esta sesión se ejecuta con {label}…` |
| `ui.chat.status.internet_offline` (es) | `…El envío esperará.` | `…El envío quedará en espera.` |
| `ui.chat.status.unreachable` (es) | `…El envío esperará.` | `…El envío quedará en espera.` |

The seventh changed value is the code span in `ui.chat.device.sentence.pairing_guidance`
in **both** locales (the Spanish value mirrored the English bug):

```
en before: …join one with `lop network join '<token>'.     <- span never closed
es before: …una con `lop network join '<token>'.           <- same, mirrored
en after:  …join one with `lop network join '<token>'`.
es after:  …una con `lop network join '<token>'`.
```

No key was added, removed or reordered in any of the nine files, each file keeps
its trailing newline and is valid UTF-8, and the raw hunks touch only the lines
above (checked for all five changed files).

### Regression proof for the other 56 values

- A snapshot of the previously audited values (`triples.json` of the previous
  round) matches the **parent bytes for 62/62 keys**, so the snapshot is a sound
  reference.
- At the head, **56 of 62** wave-B values are byte-identical to that snapshot.
  The six that differ are exactly the six Spanish values above; the English value
  that differs is `pairing_guidance`, which the earlier audit did not flag and
  which this round fixes.
- File hashes agree with `git show a5356ce91c:<path>` for all 18 files (en and es
  of the nine namespaces), and five of the nine namespaces are byte-identical to
  the audited revision (canonical, run_details, connection, layout,
  agents.config).

## 2. Verdict per namespace

| Namespace | Keys | Verdict |
|---|---|---|
| `ui.agents.config` | 3 | **passed** — unchanged; bytes identical to the audited revision |
| `ui.chat` | 9 | **passed** — `not_signed_in_description` fixed (es-01 resolved) |
| `ui.chat.canonical` | 8 | **passed** — unchanged |
| `ui.chat.device` | 11 | **passed** — `traspaso` (es-03 resolved) and the closed code span |
| `ui.chat.pickers` | 18 | **passed with 1 nit** — `Intro` policy applied (es-02 copy resolved); nit `es-d1` on the context note |
| `ui.chat.run_details` | 2 | **passed** — unchanged |
| `ui.chat.status` | 4 | **passed** — both calques replaced (es-04, es-05 resolved) |
| `ui.common.connection` | 5 | **passed** — unchanged |
| `ui.common.layout` | 2 | **passed** — unchanged |

62 of 62 wave-B values were read. Zero blockers, zero majors, zero minors, one
nit.

## 3. Prior findings — resolution and adjudication

**es-01 (minor, `ui.chat.session_status.not_signed_in_description`)** — resolved.
The value now reads `Esta sesión se ejecuta con {label} sin un inicio de sesión
que funcione, así que no podrá responder hasta que lo conectes.` The applied form
is exactly the suggested one; `se ejecuta con` is the catalogue's own rendering
of the same construction (`ui.chat.pickers.destination_pickers…`: «Esta sesión se
ejecuta con {shownselector}») and is idiomatic for "runs <provider>". The pronoun
`lo` in `hasta que lo conectes` correctly agrees with `un inicio de sesión`.

**es-02 (minor, `ui.chat.pickers.slash.enter_needs_a_pick`)** — copy resolved;
the translator's wording deviates from the suggestion and the deviation is
**accepted**. It now reads `Intro necesita que elijas una fila: ↓ y luego Intro ·
Tab completa esta fila.` The auditor had suggested `Intro necesita una fila que
elijas…`; the translator's `necesita que elijas` is the more natural Spanish
(subjunctive complement rather than a relative clause) and keeps the meaning
("Enter acts only on a row you have picked"). Better than the suggestion, not
worse.

The key-name question (sidecar: "keyboard names (Enter, Tab): keep them
verbatim") was adjudicated on the catalogue, and the translator's numbers were
checked independently. Measured over the 95 Spanish catalogue files:

- at the parent: **16** occurrences of `Intro` (16 keys) vs **6** occurrences of
  `Enter` (3 keys — the changed key twice, plus `ui.miniView.hint` and
  `ui.teamBridge.composer.hint`, the latter two counting `Shift+Enter`);
- at the head: **18** (`Intro`, 17 keys) vs **4** (`Enter`, 2 keys).

The ratio quoted for the decision ("22 Intro vs 6 Enter") is not reproducible as
stated: 22 is the *total* of both spellings at the parent (16 + 6). The direction
is nonetheless unambiguous — `Intro` is the catalogue's settled rendering in
every keyboard legend (18 occurrences across 8 files, including "Intro envía",
"Intro elige", "⌘+Intro", "Cmd/Ctrl+Intro"), `Enter` survives only in two
pre-existing strings in *other* namespaces. Spanish keyboards label the key
`Intro`, and the sidecar's "verbatim" line was written before that convention was
weighed. **The value is correct**; no catalogue change is proposed. What remains
is that the source of truth still says the opposite (nit `es-d1`).

**es-03 (nit, `ui.chat.device.footer.move_deletes_copy`)** — resolved. `…cuando
se completa el traspaso.` now matches `ui.chat.device.notice.move_hold_detail`
("en traspaso"). Within this namespace the verb is `mover` and the operation as a
noun is `traspaso`; that reads naturally ("el traspaso de la conversación") and
is consistent with the sentence's own subject ("La copia de este dispositivo se
borra…").

**es-04 (minor, `ui.chat.status.internet_offline`) and es-05 (minor,
`ui.chat.status.unreachable`)** — resolved. `El envío quedará en espera.` is
natural Spanish for a held send and joins the catalogue's large `en espera`
family ("En espera", "Solicitudes en espera", "aprobación en espera"),
where `esperará` personified the send. The subject rule holds: `Este equipo está
sin conexión` blames the machine, `No se puede contactar con el servidor de Local
Operator` blames the wire, and the second sentence is identical in both so the
two readings stay distinguishable by their first clause.

**`pairing_guidance` code span (en + es)** — resolved and verified through the
real formatter, not by substring matching. Parent rendering (reproduced):

```
en: …join one with `lop network join <token>.     (3 backticks, unterminated span)
es: …una con `lop network join <token>.           (3 backticks, same mirror bug)
```

Head rendering (`IntlMessageFormat(message, "es")`, the app's own construction in
`src/i18n/messages.ts`):

```
es: Este dispositivo no está en ninguna red. Crea una con `lop network init` o únete a una con `lop network join <token>`.
backticks = 4   literal `lop network join <token>` = true   balanced = true
```

The escaping is load-bearing in both directions: a control with the apostrophes
removed (`…join <token>.`) throws `UNCLOSED_TAG` from the same parser, so the
`'<token>'` quoting the sidecar asks for is what lets the angle brackets render as
text. The command tokens (`lop network init`, `lop network join <token>`) are
byte-identical between en and es.

## 4. Findings

### es-d1 — nit — `ui.chat.pickers.slash.enter_needs_a_pick` (context note, not copy)

The Spanish value is right; the English context note is what will undo it. It
says: *"The arrow and the key names (Enter, Tab) are keyboard names: keep them
verbatim."* The es catalogue renders this key `Intro` in 17 keys / 18
occurrences, and both other composer hints in the same file use `Intro`; a
translator following the note will write `Enter` again and recreate exactly the
split es-02 removed.

Suggested replacement for the note's last clause (no catalogue change):

```
The arrow and the key names (Tab, and the locale's recorded label for Enter —
`Intro` in es) are keyboard names: keep the arrow and Tab verbatim, and use the
locale's recorded key label for Enter.
```

And record the decision in `i18n/style-guides/es.md` ("Key names: `Intro`, `Tab`;
`Esc`, `⌘`/`Ctrl` combinations as in the catalogue"). Both files live in the core
repository, so this is out of the scope of this UI branch: recorded as
**deferred** (see `record.json`). No PR change required.

## 5. Observations, not findings

These were weighed and cleared; recording them keeps the reasoning checkable
rather than turning them into padding:

- **`equipo` = "machine"** in `internet_offline` collides with the glossary's
  `equipo` = team. The es catalogue uses "este equipo" for "this machine" in 57
  values (e.g. `ui.browser…this_machine_is_not_connected`: «Este equipo no está
  conectado a la red»), and the style guide's neutral-Spanish rule rules out the
  region-marked `ordenador`/`computadora`. The convention is right; the glossary
  simply has no row for "machine". It is pre-existing and unchanged here.
- **`traspaso` (device) vs `movimiento` (mesh)** — both name the same operation.
  `ui.mesh` uses `movimiento` in several older strings. Within `ui.chat.device`
  the term is now consistent, which is what es-03 asked for; the cross-namespace
  split is out of this file group and not a defect in the changed value.
- **Length**: `unreachable` grows 57 → 84 characters (+47%), above the style
  guide's 15-25% norm, because Spanish cannot contract "Can't" and must keep the
  product name. No `maxCells`/`maxChars` hint exists for any of the six changed
  keys, and all four surfaces wrap (`w-80` picker paragraph, `min-w-0 flex-1`
  footer span, popup `<p>` footer, `min-w-0 flex-1` strip title) with no
  `truncate`/`line-clamp`; nothing clips. Assessed geometrically from the call
  sites, not captured as a frame.
- The `es` plural in `ui.chat.device.row.conversations` carries the required
  `many` arm (`one`/`many`/`other`) that English does not have, rendering
  `1000000 de conversaciones` and `1500000 conversaciones` — correct CLDR
  behaviour, not a mismatch.
- **The previous round passed the mirrored fence bug.** The value it approved in
  `ui.chat.device.sentence.pairing_guidance` rendered with three backticks (the
  command's closing fence missing), because its mechanical check compared
  placeholders and its render pass measured output, neither of which sees fence
  parity; a substring assertion cannot either. Reproduced here: the parent value
  formats to `…lop network join <token>.` with 3 backticks. This round's check
  asserts fence parity on the rendered string, and its negative control (putting
  the old value back) fails as it should. Recorded as history, not as a finding
  against the current bytes.

## 6. Mechanical evidence (actual command output)

Run in a detached worktree at `a5356ce91c` with `node_modules` symlinked from the
primary checkout; every file hash was cross-checked against
`git show a5356ce91c:<path> | shasum -a 256`.

```
generate.mjs --check                    -> keys.gen.ts is byte-identical to a fresh generation (0)
check-duplicates.mjs                    -> ok — 853 file(s) scanned, 0 duplicate key(s) (0)
locale-parity.test.mjs                  -> 44 pass / 0 fail (ICU placeholders, key parity, no English stub)
context-parity.mjs                      -> ok — 131 allowed gap(s) in 4 namespace(s), unchanged allowance (0)
check-coverage.mjs --allowance-base 0559f7f7d8
                                        -> ok — 7 gated language(s) over 95 namespace(s); 0 allowed keys (0)
   negative control --allowance-base deadbeefdeadbeef
                                        -> exit 1 "cannot resolve the base ref" (the gate can fail)
check-strings.mjs                       -> ok — 1377 file(s) scanned, 77 literal(s) at or below baseline (0)
es-activation.test.mjs                  -> 3 pass / 0 fail
ICU/placeholder parity, 62/62 keys      -> failures 0 (real intl-messageformat 12.1.3)
   negative control (extra {label})     -> FAIL "ICU arguments differ"
   negative control (unclosed backtick) -> FAIL "backtick spans differ" + "not the balanced four-backtick command"
```

Through the app's own `t()` (bundled `src/i18n/messages` with
`locale.setLocale("es")`, the route `es-activation.test.mjs` uses), the six
changed values render as written and `pairing_guidance` yields four backticks and
two code spans with a literal `<token>`:

```
ui.chat.device.sentence.pairing_guidance
  -> Este dispositivo no está en ninguna red. Crea una con `lop network init` o únete a una con `lop network join <token>`.
ui.chat.device.footer.move_deletes_copy
  -> La copia de este dispositivo se borra cuando se completa el traspaso.
ui.chat.pickers.slash.enter_needs_a_pick
  -> Intro necesita que elijas una fila: ↓ y luego Intro · Tab completa esta fila.
ui.chat.session_status.not_signed_in_description
  -> Esta sesión se ejecuta con Radient sin un inicio de sesión que funcione, así que no podrá responder hasta que lo conectes.
ui.chat.status.internet_offline
  -> Este equipo está sin conexión. El envío quedará en espera.
ui.chat.status.unreachable
  -> No se puede contactar con el servidor de Local Operator. El envío quedará en espera.
```

RTL checks (`fribidi`, bidi hazards) do not apply to `es`.

## 7. Ledger

**A bound carried-forward block is not supported.** `docs/I18N.md` states that a
namespace edit after its audit flips its row to pending until re-audited, and
`scripts/i18n/ledger-rules.mjs` (`deriveReceiptAudit`) refuses a receipt whose
`source_sha256`/`target_sha256` differ from the bytes on disk ("it audited a
different file"). There is no `carried`/`forward` field in the rules, the checker
or the assembler. All nine rows were therefore re-recorded with the **full 62-key
scope**, one multi-namespace receipt at the head's committed bytes:

- receipt: `i18n/receipts/8bbe685ce56d.json`, sha256
  `ae29c068108f4283eed63edd201ef7fec65ff90763c5fd70f2b04b9f94623baa`
  (also the receipt's own `instance`/`auditor.session`, one block per namespace,
  `passed`, findings `{blocker 0, major 0, minor 0, nit 1}` only in
  `ui.chat.pickers`);
- before: 8 es rows stale (all but `ui.chat.status`, including five whose files
  did not change — their rows still recorded an earlier wave-A-era audit) and
  `ui.chat.status` had **no row for any locale**;
- after assembly: 9 rows `audited`, 8 with the prior audits moved to
  `superseded` by the assembler's own staleness rule, `ui.chat.status` created
  with translator `i18n-translator` / `radient/auto` / 2026-10-27;
- `ledger-check.mjs` before: 25 findings naming `es/…`; after: **0**. Total
  entries 658 → 659; the remaining 150 findings are other locales' wave-B rows,
  outside this locale's scope;
- the exact nine commands and the assembled rows are in `ledger-rows.json` and
  `assemble.sh` in this bundle's directory (and the deliver tree). The worktree
  used to prove them was discarded after the logs were written; the branch was
  not modified.

## 8. Limitations

- Copy audit only: no build, no rendered frame, no browser or native render
  claim. Fit was assessed geometrically from the call sites.
- The 56 unchanged wave-B values inherit the earlier linguistic verdict through
  byte identity; they were not re-judged line by line.
- The high-visibility strings (`ui.chat.status`, error/status copy) were read
  twice by this auditor; this is not an independent second auditor, which the
  ledger's independence rule would require as a distinct agent if the manager
  wants one for this delta.
- The previous round's receipt is named by path and described above; it is
  machine-local, not tracked. The tracked, checkable chain for this round is the
  receipt copied to `i18n/receipts/8bbe685ce56d.json` plus these records.
