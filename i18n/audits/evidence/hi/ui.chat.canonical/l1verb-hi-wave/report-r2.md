# Round-2 delta audit — `hi` — tool-row verbs (L1, 182 keys)

- **Audit ID:** `l1verb-hi-a2` · **Round:** 2 (delta re-audit of the translator's v2)
- **Date:** 2026-11-11
- **Locale:** `hi` · **Namespace:** `ui.chat.canonical` (file group: tool-row verb column, 182 keys / 91 settled+running pairs)
- **Auditor:** `i18n-auditor`, independent of the translator. Session `c311bc9814dd`. **Served model: `deepseek/deepseek-flash`**, as declared by this harness session's model header; no fallback model was used and no tool-side model pin was applied. Translator of record: session `f580f0b9670b`, model `openai/gpt-6.1-sol` — a different session and a different model, so this is not the translator's own work.
- **Verdict: clean.** 0 BLOCKER · 0 MAJOR · 0 MINOR · 0 NIT. Ledger status supported by this audit: `passed` (no BLOCKER/MAJOR remains).
- **Round-2 scope:** (1) the diff v1→v2 (87 of 182 keys) plus any unchanged key a changed neighbour now contradicts; (2) adjudication of the disposition table in `hi.v2-changes.md`; (3) a full *mechanical* pass over all 182 v2 keys; (4) width/fit against the verb column's `shrink-0` contract. Unchanged keys that round 1 read and approved were not re-litigated; where I read one anyway it is recorded under "Considered and not raised".

## Inputs (hashes computed here)

| Role | Path | SHA-256 |
|---|---|---|
| English source + inline context/notes | `_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Round-1 translation (baseline for the diff) | `_l1-prep/hi.json` | `41bcec4ff53bee4f45b37aa630d5b985f80646e6c8d121866efbdf193e3c97d8` |
| **Translation under audit (v2)** | `_l1-prep/hi.v2.json` | `56791690a9c9ee6b42838775a52c39b4807e8e2fc5d85ac6bf6fdc56bbbe95a6` |
| Translator's disposition table | `_l1-prep/hi.v2-changes.md` | `3233a594ed8ced5bb0d0f214a59268a90aea0c620e70d4d83f97eafefc2a5dba` |
| Round-1 report A (input to the dispositions) | `_l1-prep/audit-hi-A.md` | `f7ac66d26798395ff19d40e51c3df992a6e36310860eec57ecff1acafe0ca33d` |
| Round-1 report B (input to the dispositions) | `_l1-prep/audit-hi-B.md` | `20f7d0eccee461662757a15d0b09b73100c45ea38e9c869475624b4788702fcf` |
| Shipped `hi` catalogue (precedent, not yet containing the batch: 0/182 keys) | `src/i18n/catalogues/hi/ui.chat.canonical.json` @ `6c0b841` | `9396b17c8e3796c97eb1fc058f5600566ece111ac372578ff663541ccd559eca` |
| Shipped `en` catalogue (fidelity control) | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `6c0b841` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |
| Style guide / glossary read first | `i18n/style-guides/hi.md`, `en.md`, `i18n/glossary.md` | `82292dc8…`, `c967c910…`, `0eb34437…` |

Worktree HEAD: `6c0b841872d89a507dc9d45d9a2f68c92ebb6e5d`. No translation or MT service was used anywhere in this audit; every judgement below is a reading.

## Commands actually run

Everything below was executed in this session; `audit.log` beside this record is the captured output of (2)–(6).

1. Read, in this order: `i18n/style-guides/hi.md`, `i18n/glossary.md` (incl. §1, §2 and the wave-3 binding), `keys.json` (all 182 English values + context), `hi.json`, `hi.v2.json`, `hi.v2-changes.md`, `audit-hi-A.md`, `audit-hi-B.md`, both round-1 findings sections in full.
2. `~/local-operator/.venv/bin/python verify.py` — the mechanical suite over v2 (structure, pairs, width, shipped-term evidence). **Result: `mechanical checks passed`** (exit 0). `rich.cells.cell_len` is used because that is the width function the TUI budgets with; it is imported from the `~/local-operator` venv (same table, not a re-implementation).
3. Disposition-table verification: parsed all 87 `C##` rows out of `hi.v2-changes.md` and asserted `old == hi.json[key]` and `new == hi.v2.json[key]` for each, then compared the declared set against the actual diff set. **Result: 87 rows, 0 mismatches, `declared == changed` True, no undeclared change, no declared-but-unchanged key.**
4. Shipped-evidence re-verification (counts recomputed here, not taken from the note): `ui.mesh` पीयर 3 / साथी 0; `ui.projects` माइलस्टोन 26 / पड़ाव 0; `ui.canvas` वेरिएबल 17 / चर 2 (both inside चरण / चरणों); `ui.onboarding.tour` स्क्रीनशॉट 1 (`attachments.body.4`) / छवि 0; `fold.count.secret` = गोपनीय जानकारी; `tool_row.bridge.verb.*.running` 17 strings, **17/17 end `है`**; जॉब्स 2 shipped precedents (`ui.chat.run_details.jobs`, `ui.chat.composer.status.jobs_action`); सूचीबद्ध 10 values across 6 catalogues; सिंक 1 shipped precedent for the concept (`ui.settings.language.general.last_known`, "पिछली सिंक हुई भाषा"); इंतज़ार 83 / प्रतीक्षा 3; टीमों · प्रोजेक्टों · सत्रों all 0 in the shipped chat catalogue.
5. Round-1 baseline counts for the delta: v1 had **50 of 91** running forms without `है` (27 bare `-ते`, 23 dangling `…रहा`) — matches A:M1's count exactly; v2 has **0**.
6. Report B's own word-count annotations: extracted all 50 `(Nw/Mc)` cells and recomputed. The annotations are self-consistent, **but F3's prose claim "4 words max for running" is wrong**: the two forms B suggested there count **6** (`सत्र प्रोजेक्ट से जोड़ रहा है`, 29 chars) and **7** (`सत्र प्रोजेक्ट से अलग कर रहा है`, 31 chars) words under Python's `split()`.
7. `sed -n '738,750p' ~/local-operator/local_operator/network/cli.py` — read-only: `panic = actions.add_parser("panic", help="Incident: broadcast a revoke and rotate")`, and `trust` re-admits "after a panic". Used only to judge `raised_panic`'s wording; no network operation was executed.
8. `grep -n` on `src/renderer/src/features/chat/components/trace/tool-row.tsx` — confirmed the render contract the width rule depends on: the verb span is `"shrink-0 whitespace-nowrap text-body-sm"` and "the verb never [truncates]" (the object is the `min-w-0 truncate` half). `ui.chat.canonical.tool_row.bridge.verb.*` is fed into that same `verb` slot by `trace/bridge-row-model.ts`, so shipped bridge verbs are same-slot width precedent.

**Not run, deliberately:** `scripts/i18n/ledger-assemble.mjs`. It derives the row's `source_sha256`/`target_sha256` from the **shipped** catalogues on disk and refuses a receipt that does not name those bytes; the batch is 0/182 in `hi/ui.chat.canonical.json`, so any row I could write today would describe bytes that will never ship, and `ledger-check` would fail it as stale. The row is assembled by the wave after the batch lands (command in "Ledger" below). I did not run `pnpm check-i18n` either: those gates validate the committed catalogues, not a staged batch — this audit's mechanical evidence is commands 2–6 above.

## 1. The delta: 87 changed keys, judged

The disposition table is exactly accurate (command 3). All 87 changes are of these five kinds, and I read every one of them:

| Kind | Keys | Judgement |
|---|---|---|
| Running form completed with `है` (A:M1, B:F1, B:F4) | 50 | Correct and complete: all 91 running values now end `है`; no bare `-ते` remains; pair stems match. Of the 55 running rows edited in total, 50 are the clipped forms A:M1 counted (27 `-ते` + 23 `…रहा`) and 5 were already full and changed only for a term (`listed`, `read_variable`, `removed_milestone`, `found_definition`, `found_references`). |
| Term aligned to shipped copy (A:M2–M4, B:F2, B:F6) | पीयर ×2, माइलस्टोन ×4, वेरिएबल ×4, गोपनीय जानकारी ×12 | Correct. Re-verified every count myself; the shipped word is now the batch's word in all four concept families, with the agreement re-inflected per gender (see §3). |
| List verb unified on सूचीबद्ध (A:m1, B:F5) | 28 (`listed*`) | Correct, and it fixes a real misread: `सूची बनाई` read as *create* in a column where `created_*` legitimately says `बनाया/बनाई`. All 28 list rows now use one verb, in object agreement (`किए` masc pl, `कीं` fem pl, `की` fem sg, `किया` bare). |
| Meaning sharpeners (A:m3–m5, B:F7, B:F8, B:N1) | ढूँढ ×4, निदान ×2, स्क्रीनशॉट ×2, पैनिक सक्रिय ×2, विवरण देखा ×2 | Correct: `खोज` stays with grep/web/agent search, LSP lookups take `ढूँढ`, `doctor` takes `निदान`, the screenshot op takes the shipped loan, and `describe` reads metadata (`विवरण देखा`) rather than claiming `वर्णित`. |
| Explicit relation + wording (A:n1–n3, B:F3) | `प्रोजेक्ट से` ×4, नाम-बदलाव ×2, जॉब्स ×4, `को` dropped ×2 | Correct. Polarity survives: linking keeps `जोड़ा`, unlinking `अलग किया`; the dangling `इससे` is gone; `डिवाइस आमंत्रित किया` now matches its siblings' shape (`डिवाइस हटाया`). |

**Accuracy spot-checks on the changed values** (read against the source context, not the English alone): `Edited` → संपादित किया matches shipped canvas `संपादित करें`; `Synced agents` → एजेंट सिंक किए has a shipped precedent (`पिछली सिंक हुई भाषा`), so `सिंक` is not an invented loan; `Found definition` / `Found references` → ढूँढी / ढूँढे keeps the LSP lookup distinct from `Searched` (खोजा) while the row's outcome column still carries success — the settled verb is the *operation's* name, not a success claim, and ढूँढना is the natural verb for a targeted lookup; `Raised panic` → पैनिक सक्रिय किया preserves the alarm (cli.py:744 calls it an incident that broadcasts revoke+rotate), and it keeps the mesh-loan register the guide endorses.

## 2. Disposition of every round-1 finding (what was declined, adjudicated)

**Declined: none.** The table's "0 declined, 0 deferred" is true as written: 21 finding IDs (A: M1–M4, m1–m5, n1–n3 = 12; B: F1–F8, N1 = 9) each have a row, and I verified the substance of each against v2 — every one is actually fixed, not merely marked fixed. Two adjudications are still owed, because the translator chose different *wording* than a finding suggested, and because one finding's own evidence was wrong:

| Item | Translator's position | My adjudication |
|---|---|---|
| **B:F6** — B said `साथी` is wrong (right) and suggested `नेटवर्क के डिवाइस`; translator used `नेटवर्क पीयर` instead | "audited problem is real, but A:M2 and the mesh scan establish the shipped exact-concept term" | **Upheld (translator).** पीयर 3 values in `ui.mesh`, साथी 0. B's suggestion would have named *peers* as *devices*, and `डिवाइस` is already the word for the device object in `invited_device`/`removed_device` — adopting it would have created the very two-names-one-concept defect B was fixing. The finding is accepted; only its remedy is superseded. |
| **"Grammar caveat"** — B's suggested running forms are 6 and 7 words, "not 4" | recorded as a width exception, disclosed rather than hidden | **Upheld (translator), verified.** B's F3 prose says "4 words max for running"; the two forms count 6 and 7 words (29 and 31 chars) under `split()`. The caveat is factually right, and the disclosure is the correct response. |

I also re-verified that no round-1 finding was dropped silently: the 21 IDs in `hi.v2-changes.md` are exactly the IDs in the two reports (A: 4 MAJOR + 5 MINOR + 3 NIT; B: 3 MAJOR + 5 MINOR + 1 NIT).

## 3. Full mechanical pass on v2 (all 182 keys) — all PASS

| Check | Result |
|---|---|
| JSON valid; **no duplicate keys in raw text** (the `check-duplicates.mjs` premise: `JSON.parse` hides a merge duplicate) | PASS — 0 duplicates in v1 and v2 |
| Key count 182; key set == `keys.json`; **key order == `keys.json`** | PASS |
| No empty/whitespace-only, no leading/trailing/double space, no terminal punctuation | PASS |
| Placeholders / braces / ICU / markup / backticks in source or target | none exist in this group — nothing to preserve, nothing broken |
| Bidi/zero-width controls (LRM/RLM/ZWJ/ZWNJ/embedding/isolate) | PASS — 0 |
| Latin tokens | only `Python`, as the technology name, in the two `ran_python` keys |
| No identical `hi` value for two different English strings | PASS — 0 collisions |
| No two `hi` values for the same English | PASS — 0 |
| 91 settled/running pairs, both forms present | PASS |
| Every running form is a complete present progressive (ends `है`); no bare `-ते` | PASS — 0 / 0 (v1: 50) |
| Pair verb stems correspond | read all 91 by hand; the scripted 2-char-prefix heuristic flags none. Stated limit: the heuristic cannot separate a verb swap when the object noun is long, so the pairing claim rests on my reading of the 91 pairs, not on that check |
| Object gender agreement in the settled forms (fem sg / fem pl / masc pl / bare) | correct and systematic: `टीम हटाई`, `टीमें सूचीबद्ध कीं`, `जागृतियाँ सूचीबद्ध कीं`, `गोपनीय जानकारी … की/हटाई/सहेजी/पाई`, `कार्य सूची पढ़ी/अपडेट की`, `कुंजियाँ भेजीं`; `प्रोजेक्ट/नेटवर्क/कंसोल/जॉब/सत्र/प्रतीक/वेरिएबल/माइलस्टोन/एजेंट` take `किए/किया/हटाया` |
| Same concept never named two ways (per operation family) | PASS — सत्र, टीम, जॉब/जॉब्स, जागृति/जागृतियाँ, गोपनीय जानकारी, नेटवर्क, पीयर, डिवाइस, प्रोजेक्ट, एजेंट/उप-एजेंट, वेरिएबल, माइलस्टोन, प्रतीक, परिभाषा, संदर्भ, कार्य सूची, कंसोल, स्क्रीनशॉट, कुंजियाँ, नाम-बदलाव, लॉग — one rendering each |
| Register: `आप`, no तुम/तू, no `!`, no padding honorifics, nukta kept (फ़/ज़/ड़), danda not used where the source has none | PASS |
| Safety wording: destructive rows read destructive (`हटाया/हटाई`, `रद्द किया/की`, `रोका`, `बंद किया`, `रीसेट किया`, `पैनिक सक्रिय किया`), read-only rows stay read-only (`देखा/देखी`, `पढ़ा`, `सूचीबद्ध`, `जाँचा`, `झलक देखी`, `निदान किया`) | PASS — no polarity swap, and the `पैनिक` row cannot be read as a reassurance |

## 4. Width and fit — measured, no finding

The verb column never truncates (`shrink-0 whitespace-nowrap`), so an over-long verb is squeezed out of the *object*, never clipped itself. Measured with `rich.cells.cell_len` over all 182 values:

- **v2 max: 24 cells** (`गोपनीय जानकारी का विवरण देख रहा है`), median 12, mean 12.1.
- **Same-slot shipped precedent: `tool_row.bridge.verb.*` reaches 26 cells / 7 words running** (`Team Bridge का उपयोग कर रहा है`) **and 27 cells / 7 words** (`Team Bridge का उपयोग नहीं कर सका`). `bridge-row-model.ts` feeds those into the same `verb` slot, so this is precedent for this column, not for a different surface.
- Nothing exceeds 24 cells; nothing exceeds 7 words. 16 running rows sit at 6–7 words (Hindi needs the object noun the source itself carries, plus `कर` + `रहा` + `है`), and the widest of them is 4 cells under the shipped running maximum. The sidecar's "one to four words" is a soft hint; cells are the binding metric and the budget holds with margin.
- Wide-glyph/combining risk: Devanagari conjuncts measure ≥ their base width here (matras and nukta counted 0), so `cell_len` is the conservative number and it still passes.

## 5. Findings

**None.** No BLOCKER, no MAJOR, no MINOR, no NIT in the delta or in v2 as a whole.

### Considered and not raised (so the next reader does not have to re-open them)

- **`waited_for_jobs` = जॉब्स की प्रतीक्षा …` — प्रतीक्षा vs इंतज़ार.** Shipped copy prefers इंतज़ार heavily (83 values vs 3), but one of those 3 is the same construction with a background-work object (`पृष्ठभूमि कार्य की प्रतीक्षा`), the batch row is exactly that shape, and both round-1 auditors supplied this wording themselves (A:n2). A register preference with precedent on both sides is not a finding, and re-litigating an auditor's own suggested wording would be padding.
- **`found_definition` / `found_references` → ढूँढी / ढूँढे.** Reads as "looked up" rather than "found"; accepted because the settled verb names the *operation* (the outcome column carries success), the running form needs exactly this verb, and any `found` verb would re-collide with खोजा (grep/web/agent search), which is the defect A:m5 removed.
- **Bare-modifier compounds** like `नेटवर्क पीयर`, `नेटवर्क स्थिति`, `नेटवर्क लॉग`. `…के` would be more grammatical, but the file uses the bare form consistently (unchanged rows too) and it is terser; changing only the changed rows would create the inconsistency.
- **`paused` = विराम दिया** (0 shipped occurrences of विराम). Unchanged in v2 and not a round-1 finding: outside this round's scope. Flagged here as an observation only, for whoever next owns this namespace.

## 6. Ledger

`status` this audit supports: **`passed`** (0 BLOCKER / 0 MAJOR remaining), per `ledger-rules.mjs`'s `supportedStatus`. **No ledger row was written and none can be written yet**: the namespace's shipped file does not contain this batch (0/182 keys), and `ledger-assemble.mjs` refuses a receipt that does not name the on-disk bytes — correctly, since the row's hashes must describe what ships. After the wave merges the 182 keys into `hi/ui.chat.canonical.json`, assemble the row from a receipt that names **that** file's hashes:

```
node scripts/i18n/ledger-assemble.mjs --locale hi \
  --file src/i18n/catalogues/hi/ui.chat.canonical.json \
  --auditor-instance c311bc9814dd --auditor-model deepseek/deepseek-flash \
  --result clean --receipt <path to the post-merge receipt> \
  --scope "tool-row verb column, 182 keys / 91 pairs" \
  --note "R1 A+B blocked; v2 delta (87 keys) round-2 audit clean 0/0/0/0 on hi.v2.json 56791690…; evidence i18n/audits/evidence/hi/ui.chat.canonical/l1verb-hi-a2/record.json"
```

Note length must stay ≤280 characters at assembly time; the text above is a template, not a pre-approved note.

**Verdict scope:** this pass describes `hi.v2.json` at `56791690…` only. Any further edit to a key voids this for that key and needs a delta re-audit of the touched keys.
