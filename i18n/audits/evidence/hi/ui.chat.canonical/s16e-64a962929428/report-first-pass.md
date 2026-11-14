# Independent i18n audit — `hi` / `ui.chat.canonical` / slice S16e

**Verdict: `passed`** — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT.
PR `damianvtran/local-operator-ui#1884` (S16e-renderer). Audited 2026-11-12.

| | |
|---|---|
| Locale / namespace | `hi` / `ui.chat.canonical` |
| Keys audited | 12 / 12 (every key) |
| Draft audited | `…/s16e/hi/draft-hi-s16e.json`, sha256 `41e9e50f80fb89f3d39a822b1fb95461f3d8b4cd9ece1b3ed899c1fec39a9831` (matches the hash in the task) |
| English source | `src/i18n/catalogues/en/ui.chat.canonical.json` sha256 `b967adc33296c5ef0264a8a3ffd698fdfc5a50e4a3ebc8de99114a599b837e17` (equals the task-stated English hash; its 12 values are byte-identical to the brief's `en` strings) |
| Context sidecar | brief `s16e-brief.json` sha256 `a0326137bff43ed38fc4a1c63d4a26e1887cfd56d4826df0e615df28055bef0c` |
| Shipped hi catalogue (terminology authority) | sha256 `5bad55ca446e6e2e0bc853d503d94280f444cd009402431c65e8ce997528689b` |
| Glossary / style guide | `0eb34437…62f8` / `82292dc8…40d5` |
| Worktree | `~/local-operator-ui/.worktrees/i18n-s16e` @ `bd8e90542506e8bec4a98862b868095409b28329` (read-only; no edits, commits, installs or builds) |
| Auditor | `i18n-auditor`, session `d8a457984829`, model **`deepseek/deepseek-flash`** (session runtime model; no fallback model used) |
| Independence | Different session from the translator (`3ef6295a5545`). The translator's `notes-hi-s16e.md` was read only **after** my own view of all 12 keys was formed. I did not translate these strings and did not edit them. |

No translation/MT service was used to compare or back-translate; every judgement below is a reading of the English, the sidecar, the shipped Hindi catalogue, the glossary and the hi style guide.

## Findings

| ID | Sev | Key | Current | Problem | Suggested |
|---|---|---|---|---|---|
| HI-S16E-01 | MINOR | `image_gen.error_class.audio_rate_limited` | ऑडियो दर सीमा | The label set is otherwise adjectival/participial — अस्वीकृत, गेट विफल, अज्ञात टूल, अमान्य आर्ग्युमेंट — so the one bare noun compound reads as the *constraint* ("audio rate limit"), not the state "rate limited"; it is also the only label the shipped catalogue attests only inside a clause (दर सीमा **लगी है**) or hyphenated as a noun (दर-सीमा). | ऑडियो दर-सीमित (fallback if a participle is unwanted: ऑडियो दर-सीमा) |
| HI-S16E-02 | NIT | `image_gen.cancel.checking` | शुल्क की पुष्टि जाँची जा रही है। | `पुष्टि जाँची जा रही है` reads as "the confirmation is being examined" — checking a confirmation rather than confirming the charge; the shipped same-construction line (`pickers.usage_view.checking_for_an_updated_usage_report`) checks a *report*, so the pattern does not carry over to पुष्टि cleanly. | शुल्क की पुष्टि की जा रही है। |

That is the whole list. Two keys were examined closely and **accepted as-is** (below); nothing else met even NIT level.

## Per-axis result

**1. Mechanical — passed.** Repo parser path (`@formatjs/icu-messageformat-parser` + `intl-messageformat` 12.1.3 from `~/local-operator-ui/node_modules`), one small node script, read-only: all 12 values parse; key set identical to English (none added or dropped); `{material}` name and kind identical and the select keyword set `video | voiceover | sound_effect | other` equal to English with `other` present; every branch formats to a non-empty string with no brace leak (`image` and any unknown token correctly fall through to `other`); terminator parity holds (prose keys end in danda `।`, class labels carry none); valid JSON, NFC, no ZWJ/ZWNJ or bidi-control bytes.
Negative controls (a pass must not be vacuous): dropping the `sound_effect` branch → keyword-set mismatch; dropping `other` → `MISSING_OTHER_CLAUSE`; renaming `{material}` → `{medium}` → mismatch; an unclosed brace → `MALFORMED_ARGUMENT`. **4/4 raised** — see `audit.log` §1. Disclosure: my *first* checker build missed the dropped-branch control (my AST walker read `el.value.options`, while this parser puts `options` on the element, so it compared nothing); I fixed the walker and re-ran. The `audit.log` in this bundle is the regenerated run showing the fixed checker, i.e. the log does not itself show that earlier vacuous pass — this sentence is the record of it, and the control is what changed.

`pnpm check-i18n` was not run: the draft is not a catalogue file, so those gates would judge the committed catalogues rather than these 12 values, and installing in the shared worktree is out of scope. `scripts/i18n/ledger-assemble.mjs` (the RFC's audit-ledger writer) was deliberately **not** run — it derives `target_sha256` from the file on disk and would correctly refuse a 12-key draft that is not yet `src/i18n/catalogues/hi/ui.chat.canonical.json`; writing a row now would name bytes no auditor saw. Handoff + the exact command are in the receipt (`ledger_handoff`), and the caution matters: **when the row is written, confirm the merged 12 values are byte-identical to this draft** before promoting `status`.

**2. Accuracy — passed.** The two promises are kept, in the right directions and in the right places:
- `cancel.queued` promises firmly: "कोई शुल्क नहीं लगेगा।" — the exact negation of the shipped "शुल्क लगेगा", not a hedge ("शायद"/"नहीं लगना चाहिए"). This is the only value allowed to promise no charge and it is used only for the queued fact.
- `cancel.running` promises nothing: it states the request (रोकने का अनुरोध किया गया), the provider's lack of a cancellation endpoint, that the generation continues, and that a charge applies **if** audio is produced (ऑडियो बनने पर उसका शुल्क लगेगा). No no-charge wording; no guarantee of cancellation. Its second sentence reproduces the shipped `sound.stop.warning` fact-for-fact, which is a consistency *win*, not drift.
- `settlement.pending` states an outstanding charge and **never an amount**: "शुल्क की पुष्टि लंबित — … अंतिम शुल्क दिखेगा।" No figure, no zero, no "quote ≈ charge".
- `state.cancelled_batch`: all four branches are complete sentences, verbatim `… का बैच` (with the shipped oblique plural `तस्वीरों का बैच`), differing from `failed_batch` only in the predicate — the intended family.
- `error.audio_rate_limited` is calm and actionable, promises no success and names no wait duration.
- The six class labels stay mutually distinguishable: अस्वीकृत (denied) vs गेट विफल (gate failed) vs अज्ञात टूल vs अमान्य आर्ग्युमेंट vs डुप्लिकेट id vs दर सीमा. No bleed.

**3. Idiom & register — passed (with HI-S16E-02).** आप-register polite imperatives ("थोड़ी देर में फिर कोशिश करें"), no "कृपया", no "!", terse everyday Hindi, danda for full stops, ` — ` spaced em dash exactly as the shipped catalogue does. No calques of note: `प्रोवाइडर को कॉल किए जाने से पहले` and `रोकने का अनुरोध` are the shipped collocations. No Latin-script English sentence survives; the only Latin inside the values is `endpoint` and `id` (both tokens the shipped hi catalogue already keeps Latin).

**4. Terminology — passed.** Every term reused from the shipped catalogue on this surface: तस्वीर/वीडियो/वॉइसओवर/साउंड इफ़ेक्ट (nukta kept), बैच, प्रोवाइडर, शुल्क (`शुल्क लगेगा` / `कोई शुल्क नहीं`), रोकना vs रद्द करना (stop vs the provider's cancellation capacity), लंबित (pending), व्यस्त (busy), विफल, अस्वीकृत, टूल, आर्ग्युमेंट, गेट, अंतिम शुल्क की पुष्टि (settlement, from `sound.cost.estimated_zero`). Glossary §2 rows are not contradicted (tool → टूल ✓). `endpoint` is on the glossary's kept-English set. Material nouns are byte-identical to the shipped `failed_batch` branches (verified in `audit.log` §6).

**5. Fit — passed.** The longest value (`cancel.running`, 2 sentences) matches the English's own length and wraps inside the card; the sidecar's only length hints are for the labels (1–3 words) and every label is 1–2 words (`अस्वीकृत` 1, `गेट विफल` 2, `अज्ञात टूल` 2, `अमान्य आर्ग्युमेंट` 2, `डुप्लिकेट id` 2, `ऑडियो दर सीमा` 3). No `maxCells` budget is declared for these keys, so no overflow judgement beyond "won't wrap" applies; Devanagari conjunct widths here are unremarkable.

**6. RTL — N/A** (this is `hi`). For completeness: no hand-inserted bidi controls or ZWJ/ZWNJ in any value.

**Second independent pass (high-visibility "errors" group, requested by the manager).** I re-derived the six `error_class.*` labels and `error.audio_rate_limited` from the sidecar's own instructions ("A class of failure, not a sentence… short enough not to wrap") without consulting my first pass, and separately re-read the three label-vs-sentence keys. The first pass held on all of them except the rate-limit label register point (HI-S16E-01, already recorded) — no finding was dropped or added by the second pass.

## Examined and accepted (not findings)

- **`अमान्य आर्ग्युमेंट` for "Invalid arguments"** — English's plural is not mirrored. Hindi marks a class of failure with the singular, and the only attested form in the shipped catalogue is singular (`आर्ग्युमेंट चाहिए`, `कमांड आर्ग्युमेंट`); `आर्ग्युमेंट्स` appears nowhere. Accepted.
- **`डुप्लिकेट id` (lowercase Latin)** — the shipped hi catalogue uses **both** `id` (14 values, e.g. `शीर्षक या id से खोजें`, `एसेट की id`) and `ID` (25 values). Either casing is conformant; the draft mirrors the English source's lowercase. Not a finding (I drafted one, then dropped it once I counted the shipped usage).
- **`प्रोवाइडर के रिपोर्ट करने पर`** — sound Hindi (`के … करने पर`), and `रिपोर्ट`/`दिखेगा` are both attested. Accepted.
- **`जनरेशन जारी रहेगा`** (future where English has present "continues") — same fact, and the phrase is byte-identical to the shipped `sound.stop.warning`. Accepted; a change here would *create* inconsistency.

## Notes for the implementer

1. Only HI-S16E-01 (MINOR) is worth acting on in the remediation wave: one label. HI-S16E-02 is a one-line polish (`जाँची जा रही है` → `की जा रही है`).
2. The draft is otherwise merge-ready on the audit axes I own. This verdict says nothing about rendering — it is a text audit, not rendered-frame evidence.
3. Ledger: after the keys land, run `ledger-assemble` with this receipt's identity (`deepseek/deepseek-flash`, instance = my session id, result `clean-with-findings` since a MINOR remains) and re-confirm the merged bytes equal the draft's before promoting status.

## Artifacts (this session's scratchpad — temporary; the tracked bundle is the implementer's to create under `i18n/audits/evidence/hi/ui.chat.canonical/<audit-id>/`)

| File | sha256 |
|---|---|
| `receipt.json` | `472a81877fb8c7a9dd3d0cb840f4277309a972424652d953c52e4660239478b8` |
| `audit.log` | `8ee4ccb3ff1d3cb1aa5f2a6223b161477211bea10f141e4eeb1d2b825b7b29ad` |
| `report.md` | this file (hash reported in the delivery message) |
| `audit.sh` | `ad2e469484b1efdb7e24977882a3509e21368ff03ee3dc1fdc4f1d657177a7fe` |
| `icu-check.mjs` | `ee090526f9624d405a381451bc505fe549a07dfb972751397c8b17e16ec2f410` |
| `icu-check.log` | `bd4d0431d6a28a68769b5dd81f91a0f110fd6bff2715ff9bc3ad681304948d2f` |
| `draft-hi.json` (byte copy analysed) | `41e9e50f80fb89f3d39a822b1fb95461f3d8b4cd9ece1b3ed899c1fec39a9831` |

`audit.log` is a real transcript: `audit.sh` regenerates it by re-running the commands, so every `$` line is a command that ran and the lines under it are its actual output. The receipt's `axes` block is audit notes, not an execution log.
