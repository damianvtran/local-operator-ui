# Round-3 (delta) audit — Urdu (`ur`, RTL), `ui.chat.canonical.tool_row.verb.*`

- **Auditor** `i18n-auditor` (team `lopdev`), session `61867371ec45`
- **Actual served model** `deepseek/deepseek-flash` (harness session header `Model: deepseek/deepseek-flash`; no fallback observed, no role or model pin applied)
- **Date** 2026-11-11 · **Round** 3 (delta) · **Locale** `ur` (RTL) · **Namespace** `ui.chat.canonical`
- **Slice** L1 tool-row verbs (182 keys) · **Audited bytes** `.worktrees/_l1-prep/ur.v3.json` (`sha256 5fb741868…`)
- **Independent**: I translated nothing and edited no catalogue, context sidecar, ledger, receipt or prep byte (verified: `git status --porcelain src/i18n/catalogues` is empty). No MT service, translation API, SDK or back-translation was used — the judgement is reading-based and every count below was recomputed here.

Scope, as briefed: the **3 keys** that changed between `ur.v2.json` and `ur.v3.json`
(`listed_network_peers.settled`, `sent_keys.settled`, `sent_keys.running`), judged against
their English value/`context.role`/`notes` and against their sibling forms; the disposition
of round-2 findings `F-01` and `F-02`; and a **full mechanical pass over all 182 values**.
The 179 unchanged values were read once for disagreement with the changed neighbours, not
re-litigated for style.

## Verdict

**blocked** — `changes_requested` in ledger terms.

| | count |
|---|---|
| BLOCKER | 0 |
| MAJOR | 1 |
| MINOR | 0 |
| NIT | 2 |

Two of the three changed values are **right**, and one of them (`sent_keys`) closes its
round-2 finding completely. The third cannot pass: it removes F-01's imperative defect and
puts a **gender/number agreement error** in its place. The wording that would fix the
agreement inside the same verb (`دکھائیں`) is unusable — it is byte-identical to the polite
imperative, which is what round 1 and round 2 objected to in the first place — so the fix has
to change the verb family, and that is a 2-key change (settled + running pair).

## Disposition of the round-2 findings this delta answers

| Round-2 | Asks for | Now | Verdict |
|---|---|---|---|
| **F-01** (MAJOR) `listed_network_peers.settled` imperative in a status column | a past form, parallel with the progressive sibling | `نیٹ ورک ڈیوائسز دکھائے` — past, no imperative reading ✔ — but masculine-plural agreement against a feminine-plural object ✘ | **register fixed, still open** → `R3-01` |
| **F-02** (MINOR) `sent_keys.*` passive in an active column | active forms, same verb, no imperative homograph | `کلیدیں ارسال کیں` / `کلیدیں ارسال کر رہا` | **closed** |

**F-01 was prescribed as `دکھائے` by the round-2 report itself (its `receipt.json` `F-01.suggested`),
and the remediation implemented that prescription verbatim.** This is therefore a defect in the
earlier recommendation, not a translator error: the register was correctly read, and the
suggested replacement was not checked for agreement before it was written down. That is exactly
what the second independent pass is for, so it is stated here plainly rather than softened.

## Findings

### MAJOR

**R3-01 · `ui.chat.canonical.tool_row.verb.listed_network_peers.settled` — masculine-plural agreement on a feminine-plural object**
current `نیٹ ورک ڈیوائسز دکھائے` ("listed network devices", 22 cells) · suggested **`ڈیوائسز کی فہرست بنائی`** (22 cells), with running **`ڈیوائسز کی فہرست بنا رہا`** (24 cells)

- `دکھائے` is the **masculine plural** past participle. The object is **feminine plural**:
  - shipped `ui.mesh.mesh_drop.network_not_destination` — «{network} میں ڈیوائسز ہوتی ہیں» → f.pl `ہوتی ہیں`;
  - shipped `ui.notices.chat.mark_all_read_deferred` — «{count} دوسری ڈیوائسز پر ہیں اور وہ ڈیوائسز … صاف ہو جائیں گی» → f.pl `گی`;
  - `ڈیوائس` itself is feminine throughout the corpus («یہ ڈیوائس … رکن ہے», «دوسری ڈیوائس پر برقرار رہتی ہے», «ڈیوائس کی کلید بدلی جائے گی», and this very slice's «ڈیوائس ہٹائی», «ڈیوائس کو دعوت دی»).
  Correct agreement would be **`دکھائیں`** — and that string is unusable: it is byte-identical to the آپ-form imperative, and **all 56** shipped `دکھائیں` occurrences in `src/i18n/catalogues/ur/` are "show X" imperatives («تمام دکھائیں», «کم دکھائیں», «Finder میں دکھائیں», «کلید دکھائیں»); **none** is a past status. Rounds 1 and 2 were right about the homograph, and round 2 was right that the short verb cannot carry this row.
- It is also the **only** value in the 182 that disagrees with its object. The file's own convention agrees the settled form with the object: `previewed_rename.settled` «نام کی تبدیلی دکھائی» (f.sg), `viewed_team.settled` «ٹیم دیکھی», `removed_device.settled` «ڈیوائس ہٹائی», `searched_agents.settled` «ایجنٹ تلاش کیے» (m.pl), `found_references.settled` «حوالے ڈھونڈ لیے» (m.pl), `updated_todos.settled` «کاموں کی فہرست اپ ڈیٹ کی».
- Fix — move to the family that carries its own feminine head noun `فہرست` (f.sg → `بنائی`), which the file already uses in 12 settled keys with their 12 running pairs (`X کی فہرست بنائی` / `… بنا رہا`, plus the generic `listed` = `فہرست بنائی`; 30 of the 182 values contain `فہرست`), one shipped tool-row verb («گفتگوؤں کی فہرست بنائی»), and the sibling row `listed_networks` «نیٹ ورکس کی فہرست بنائی»:
  - **`ڈیوائسز کی فہرست بنائی`** (22 cells, identical to today's width) / running **`ڈیوائسز کی فہرست بنا رہا`** (24 cells). Unambiguous past, correct agreement, no width growth. Dropping the `نیٹ ورک` qualifier is in-family: the neighbouring device rows already do it (`ڈیوائس کو دعوت دی`, `ڈیوائس ہٹائی`), and the row's `context.role` already scopes it to the `network` tool's `peers` operation.
  - If the manager wants the qualifier kept: **`نیٹ ورک ڈیوائسز کی فہرست بنائی`** (30 cells) / **`نیٹ ورک ڈیوائسز کی فہرست بنا رہا`** (32 cells, measured with `rich.cells.cell_len`). That sits on the brief's 32-cell mark and would be the widest label in the slice (current max 29, `listed_subagents.running`), so it needs a recorded width exception rather than passing silently.
  - The en sidecar's "the pair must use the same verb" makes this a **2-key** fix (`settled` + `running`); a one-key change to the short verb family cannot be made correct, which is the whole point of `R3-01`.
- Not raised to BLOCKER: the row still reads as the listing of the network's devices, and the meaning is not unsafe or inverted; no placeholder, ICU or plural-category structure is involved. The defect is agreement/idiom, which is this rubric's MAJOR class. If the manager weighs a misgendered verb in a permanent transcript row as meaning-level, escalating to BLOCKER is defensible — I am naming the line I drew, not hiding it.

### NIT

**R3-n1 · the delta adds a term call that is still unrecorded** — `send keys → ارسال`.
Round-2 `F-04` asks the wave to record its new term calls in `i18n/style-guides/ur.md` before the
namespace ships; the guide still carries none of `job → جاب/جابز`, `peer → ڈیوائس`,
`reset → ری سیٹ`, `update → اپ ڈیٹ`, and this round adds one more: `ارسال کیں` for the console
`keys` op, chosen over `بھیجی` because `بھیجیں` is the آپ imperative and `بھیجی گئیں` is passive.
The vocabulary split from `sent` = «بھیجا» (row 27) is deliberate and I recommend **keeping it**
— pair consistency with `sent_keys.running` outranks matching the plain `sent` row — but the
reason belongs in the guide, or a later wave will "unify" it back into the homograph. No wording change.

**R3-n2 · record the `دکھائیں` homograph as a locale call** — the feminine-plural past of `دکھانا`
is byte-identical to the polite imperative, and 56/56 shipped occurrences are imperatives. One
line in the `ur` guide ("a bare `دکھائیں` in a status gutter reads as an imperative; use the
`فہرست` family or a different verb for a feminine-plural object") closes a defect class that has
now cost two rounds. No wording change.

## Mechanical pass (whole file, 182 values)

Executed by `checks.py` in this bundle; full stdout in `audit.log`. **24 PASS / 0 FAIL.**

- 182 values, JSON valid, key **set and order** identical to `keys.json`; nothing added or dropped vs `ur.v2.json`.
- v2 → v3 changes **exactly** the 3 briefed keys.
- No empty/whitespace-only values; no leading/trailing/double/odd whitespace; all values NFC-stable.
- No manual bidi controls or other format/control characters (U+061C, U+200B–200F, U+202A–202E, U+2066–2069, U+FEFF and every `Cc`/`Cf` all absent) — correct for a locale whose render layer applies FSI/PDI itself.
- No placeholders or ICU braces in any value; the English source carries no `{…}` and no plural/select, so **CLDR category checks are N/A for this slice**; no markup, no backtick code spans to preserve.
- No Arabic-only letter forms where Urdu requires `ی`/`ک`/`ہ` (U+064A/0643/0629/0649/06D5 absent); no Arabic-Indic or Urdu-Indic digits (guide: Latin digits in v1).
- Latin characters limited to the kept-English token `Python`, exactly on the two `ran_python` rows; **zero English-identical values**, so the operator's "no English left in the interface" acceptance holds for this slice.
- No terminal punctuation, no Latin punctuation or Urdu full stop inside prose, no Devanagari danda — labels are punctuation-free like the English.
- Running forms: 90 end `رہا`, 1 ends `جاری` (the carried `F-03`) — unchanged by this delta and still non-gating.
- Widths (`rich.cells.cell_len`): file max **29** cells (en max 23), nothing over 32; the three delta keys measure 22 / 16 / 19 cells.
- The shipped `ur` catalogue still carries **0** of the 182 keys (159 namespace files), so no repo gate validates these bytes yet; `ledger-check` cannot hold them (see below).

## Carried from round 2 (unchanged, not re-counted)

- `F-02` — **closed** by this delta.
- `F-03` `searched_the_web.running` = «ویب پر تلاش جاری» — still the lone nominal status; still recommended for a later wave (`ویب پر تلاش کر رہا`), still non-gating on the shipped-corpus precedent.
- `F-04` — still open; fold `R3-n1` into it.
- `F-05` width acceptance, `F-06`–`F-09` — untouched, no new evidence against them.

## Commands actually run (full stdout in `audit.log`)

| Command | Result |
|---|---|
| `python3` diff `ur.v2.json` → `ur.v3.json` | exactly 3 changed keys, 0 added, 0 dropped; order == `keys.json` |
| `~/local-operator/.venv/bin/python checks.py` | 24 PASS / 0 FAIL, widths and shipped-key count printed |
| `node scripts/i18n/context-parity.mjs` | exit 0 — "every English key is covered, apart from 129 allowed gap(s) in 4 namespace(s)" |
| `node scripts/i18n/generate.mjs --check` | exit 0 — `keys.gen.ts` byte-identical to a fresh generation |
| `node scripts/i18n/ledger-check.mjs` | exit 1 — 24 findings, incl. `ur/ui.chat.canonical: missing 182 key(s)` and stale `source_sha256`; **same 24 and same classes as the round-2 run**, i.e. pre-existing staging state, not caused by this audit |
| `node scripts/i18n/ledger-assemble.mjs …` (write attempt) | refused, exit 2 — see `receipt.json` `ledger`; the namespace is not key-complete in the shipped catalogue, so no row can be assembled for these bytes |
| corpus queries over `src/i18n/catalogues/ur/*.json` (8,872 strings) | agreement evidence in `audit.log` §"corpus evidence"; 56 `دکھائیں` values listed and read one by one |

## Not covered here (by design)

- **Rendered appearance**: no screenshot, no bidi terminal run. Width is measured, not rendered; the trailing Latin object token after these labels (`… بنائی <id>`) composes through the render layer's FSI/PDI isolation — QA/design own the real row. The guide's rule not to "fix" a string for bidi was obeyed; no manual controls were added or expected.
- **The 179 unchanged values' style** — approved earlier and only re-read for agreement; the registered findings from rounds 1–2 stand as recorded there.
- **Integration, ledger row and receipts** — impossible for these bytes until the catalogue carries the namespace (proved by the refusal above, not assumed).
