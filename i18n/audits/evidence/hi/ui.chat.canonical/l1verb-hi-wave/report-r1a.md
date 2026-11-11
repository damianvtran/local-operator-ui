# Audit — `hi` — tool-row verbs (L1 batch, 182 keys)

- **Audit ID:** `l1verb-hi-a`
- **Date:** 2026-11-11
- **Locale:** `hi` · **Namespace:** `ui.chat.canonical` (file group: tool-row verb column, 182 new keys / 91 settled+running pairs)
- **Auditor:** `i18n-auditor`, independent from the translator. Session `ecb08badad9d`. **Served model: `deepseek/deepseek-flash`** (as declared by this harness session's model header; no fallback model was used for this run). Translator of record: `openai/gpt-6.1-sol` — a different model, so this is not the translator's own work.
- **Scope:** the 182 keys of `keys.json` / `hi.json`, every key read and judged. Not in scope: the merged 258 keys of the shipped `hi/ui.chat.canonical.json` (already audited; read only for terminology and layout precedent).
- **Verdict: blocked (changes requested).** 4 MAJOR findings; `passed` requires no BLOCKER and no MAJOR remaining.

## Inputs (hashes computed here)

| Role | Path | SHA-256 |
|---|---|---|
| English source + context/notes | `_l1-prep/keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| Translation under audit | `_l1-prep/hi.json` | `41bcec4ff53bee4f45b37aa630d5b985f80646e6c8d121866efbdf193e3c97d8` |
| Merged English catalogue (fidelity check) | `src/i18n/catalogues/en/ui.chat.canonical.json` @ `6c0b841` | `a385671b988e5f03df6f650beb4a06f73c9efaead2316dfa9ab15bf043798765` |
| Shipped hi catalogue (precedent) | `src/i18n/catalogues/hi/ui.chat.canonical.json` @ `6c0b841` | `9396b17c8e3796c97eb1fc058f5600566ece111ac372578ff663541ccd559eca` |

`keys.json` English is byte-identical to the merged English catalogue for all 182 keys (checked), so the audit reads the real source and not a stale copy. The batch is **not yet merged** into `hi/ui.chat.canonical.json` (0 of 182 keys present there).

Style guide and glossary read first: `i18n/style-guides/hi.md`, `i18n/style-guides/en.md`, `i18n/glossary.md`. No translation or MT service was used anywhere in this audit.

## Commands actually run

1. `python3 i18n/audits/evidence/hi/ui.chat.canonical/l1verb-hi-a/verify.py` — the script is stored beside the record so `audit.log` is regenerable; all checks PASSED:
   - key count 182; key set equal to `keys.json`; key order equal
   - no empty values; no leading/trailing/double spaces; no terminal punctuation
   - no placeholders in source or target (this group has none)
   - no bidi/zero-width controls; Latin appears only as `Python` (allowed technology name)
   - no identical `hi` value shared by two different English strings
   - every value 1–4 words (wide-glyph/overflow risk nil: max 21 estimated base glyphs vs 28 in already-shipped `bridge.verb` copy)
   - source English matches the merged `en` catalogue
2. `grep`/`json` scans of the shipped `hi` catalogues for term precedent — counts printed in `audit.log`, quoted per finding below.
3. `python3` pair review of all 91 settled/running pairs, incl. the has-`है` / bare-`-ते` count.

## Findings

### BLOCKER — 0

### MAJOR

**M1 — 50 of 91 `.running` values are not a complete Hindi present progressive (broken pair with `.settled`).**
27 end in a bare `-ते` participle (`…की सूची बनाते`, `…करते`, `…देखते`, `…लेते`) — a non-finite/habitual form that reads as a truncated third-person-plural clause, not "is doing"; 23 end in `…रहा` with the copula missing (`…कर रहा`, `…खोज रहा`). Both patterns break the `.settled`/`.running` pairing the source notes require ("the pair must use the same verb"), and both contradict precedent: **17 of 17** already-shipped `tool_row.bridge.verb.*.running` values carry `है` (`पढ़ रहा है`, `भेज रहा है`, `पोस्ट कर रहा है`), and the 41 other running values in this same batch carry it too (`कंसोल खोल रहा है`, `Python चला रहा है`). Full remediation list, with suggested wording:

*27 bare `-ते`:*
| Key (after `verb.`) | English | Current | Suggested |
|---|---|---|---|
| listed_variables.running | Listing variables | चरों की सूची बनाते | वेरिएबलों की सूची बना रहा है |
| waited_for_jobs.running | Waiting for jobs | जॉब की प्रतीक्षा करते | जॉब की प्रतीक्षा कर रहा है |
| listed_agents.running | Listing agents | एजेंटों की सूची बनाते | एजेंटों की सूची बना रहा है |
| listed_teams.running | Listing teams | टीमों की सूची बनाते | टीमों की सूची बना रहा है |
| listed_subagents.running | Listing subagents | उप-एजेंटों की सूची बनाते | उप-एजेंटों की सूची बना रहा है |
| listed_secrets.running | Listing secrets | गोपनीय मान सूचीबद्ध करते | गोपनीय मान सूचीबद्ध कर रहा है |
| described_secret.running | Describing secret | गोपनीय मान वर्णित करते | गोपनीय मान वर्णित कर रहा है |
| updated_secret.running | Updating secret | गोपनीय मान अपडेट करते | गोपनीय मान अपडेट कर रहा है |
| listed_projects.running | Listing projects | प्रोजेक्टों की सूची बनाते | प्रोजेक्टों की सूची बना रहा है |
| unlinked_session_from.running | Unlinking session from | सत्र इससे अलग करते | सत्र इससे अलग कर रहा है |
| updated_todos.running | Updating todos | कार्य सूची अपडेट करते | कार्य सूची अपडेट कर रहा है |
| listed_wakes.running | Listing wakes | जागृतियों की सूची बनाते | जागृतियों की सूची बना रहा है |
| listed_jobs.running | Listing jobs | जॉब की सूची बनाते | जॉब की सूची बना रहा है |
| listed_networks.running | Listing networks | नेटवर्कों की सूची बनाते | नेटवर्कों की सूची बना रहा है |
| listed_network_peers.running | Listing network peers | नेटवर्क साथी सूचीबद्ध करते | नेटवर्क पीयर सूचीबद्ध कर रहा है |
| diagnosed_network.running | Diagnosing network | नेटवर्क की जाँच करते | नेटवर्क की जाँच कर रहा है |
| invited_device.running | Inviting device | डिवाइस को आमंत्रित करते | डिवाइस को आमंत्रित कर रहा है |
| listed_consoles.running | Listing consoles | कंसोलों की सूची बनाते | कंसोलों की सूची बना रहा है |
| captured_console.running | Capturing console | कंसोल की छवि लेते | कंसोल की छवि ले रहा है |
| typed_in_console.running | Typing in console | कंसोल में टाइप करते | कंसोल में टाइप कर रहा है |
| resized_console.running | Resizing console | कंसोल का आकार बदलते | कंसोल का आकार बदल रहा है |
| updated_secure_input.running | Updating secure input | सुरक्षित इनपुट अपडेट करते | सुरक्षित इनपुट अपडेट कर रहा है |
| listed_symbols.running | Listing symbols | प्रतीकों की सूची बनाते | प्रतीकों की सूची बना रहा है |
| previewed_rename.running | Previewing rename | नाम-परिवर्तन की झलक देखते | नाम-परिवर्तन की झलक देख रहा है |
| listed_sessions.running | Listing sessions | सत्रों की सूची बनाते | सत्रों की सूची बना रहा है |
| resumed_session.running | Resuming session | सत्र फिर शुरू करते | सत्र फिर शुरू कर रहा है |
| peeked_at_session.running | Peeking at session | सत्र की झलक देखते | सत्र की झलक देख रहा है |

*23 `…रहा` without `है` — append ` है` (suggestions shown take the M2–M4 term fixes too where they apply):*
| Key (after `verb.`) | English | Current | Suggested |
|---|---|---|---|
| searched_the_web.running | Searching the web | वेब पर खोज रहा | वेब पर खोज रहा है |
| installed_agent.running | Installing agent | एजेंट इंस्टॉल कर रहा | एजेंट इंस्टॉल कर रहा है |
| reset_agent.running | Resetting agent | एजेंट रीसेट कर रहा | एजेंट रीसेट कर रहा है |
| updated_agent.running | Updating agent | एजेंट अपडेट कर रहा | एजेंट अपडेट कर रहा है |
| synced_agents.running | Syncing agents | एजेंट सिंक कर रहा | एजेंट सिंक कर रहा है |
| updated_team.running | Updating team | टीम अपडेट कर रहा | टीम अपडेट कर रहा है |
| resumed.running | Resuming | फिर शुरू कर रहा | फिर शुरू कर रहा है |
| stored_secret.running | Storing secret | गोपनीय मान सहेज रहा | गोपनीय मान सहेज रहा है |
| retrieved_secret.running | Retrieving secret | गोपनीय मान पा रहा | गोपनीय मान पा रहा है |
| deleted_secret.running | Deleting secret | गोपनीय मान हटा रहा | गोपनीय मान हटा रहा है |
| updated_project.running | Updating project | प्रोजेक्ट अपडेट कर रहा | प्रोजेक्ट अपडेट कर रहा है |
| linked_session_to.running | Linking session to | सत्र इससे जोड़ रहा | सत्र इससे जोड़ रहा है |
| updated_milestone.running | Updating milestone | पड़ाव अपडेट कर रहा | माइलस्टोन अपडेट कर रहा है |
| read_todos.running | Reading todos | कार्य सूची पढ़ रहा | कार्य सूची पढ़ रहा है |
| cancelled_wake.running | Cancelling wake | जागृति रद्द कर रहा | जागृति रद्द कर रहा है |
| cancelled_job.running | Cancelling job | जॉब रद्द कर रहा | जॉब रद्द कर रहा है |
| checked_network_status.running | Checking network status | नेटवर्क स्थिति जाँच रहा | नेटवर्क स्थिति जाँच रहा है |
| read_network_log.running | Reading network log | नेटवर्क लॉग पढ़ रहा | नेटवर्क लॉग पढ़ रहा है |
| joined_network.running | Joining network | नेटवर्क से जुड़ रहा | नेटवर्क से जुड़ रहा है |
| left_network.running | Leaving network | नेटवर्क से निकल रहा | नेटवर्क से निकल रहा है |
| raised_panic.running | Raising panic | आपात रोक लगा रहा | आपात रोक लगा रहा है |
| closed_console.running | Closing console | कंसोल बंद कर रहा | कंसोल बंद कर रहा है |
| spawned_session.running | Spawning session | सत्र शुरू कर रहा | सत्र शुरू कर रहा है |

**M2 — `peer` is renamed `साथी`; the shipped copy says `पीयर`.**
Current: `listed_network_peers.settled` = `नेटवर्क साथी सूचीबद्ध किए`, `.running` = `नेटवर्क साथी सूचीबद्ध करते`. Problem: `ui.mesh.json` (already shipped) uses `पीयर` in 3 values (`पीयर का रिले नहीं चल रहा`, `पीयर ने जवाब दिया, पर हैंडशेक बंद कर दिया`) and never `साथी`; the same network surface would name one concept two ways. Suggested: `नेटवर्क पीयर सूचीबद्ध किए` / `नेटवर्क पीयर सूचीबद्ध कर रहा है`.

**M3 — `milestone` is renamed `पड़ाव`; the shipped copy says `माइलस्टोन`.**
Current: `updated_milestone` `पड़ाव अपडेट किया`, `removed_milestone` `पड़ाव हटाया` (+ running forms). Problem: `ui.projects.json` uses `माइलस्टोन` in 26 values, including the near-identical `माइलस्टोन हटाया नहीं गया` and `माइलस्टोन अपडेट नहीं किया गया`; `पड़ाव` appears nowhere in the shipped hi copy. Suggested: `माइलस्टोन अपडेट किया`, `माइलस्टोन हटाया`, running `… कर रहा है` / `हटा रहा है`.

**M4 — `variable` is rendered `चर`; the shipped copy says `वेरिएबल`.**
Current: `listed_variables` `चरों की सूची बनाई`, `read_variable` `चर पढ़ा` (+ running forms). Problem: `ui.canvas.json` uses `वेरिएबल` in 17 values (`वेरिएबल संपादित करें`, `वेरिएबल लोड हो रहे हैं`, `वेरिएबल हटाएँ`) and never `चर` (its two `चर` string hits are inside `चरण`/`चरणों`, "steps"). A user who sees `वेरिएबल` in the viewer would see `चर` in the tool row. Suggested: `वेरिएबलों की सूची बनाई`, `वेरिएबल पढ़ा`; running `वेरिएबलों की सूची बना रहा है`, `वेरिएबल पढ़ रहा है`.

### MINOR

**m1 — `Listed`/`Listing` is rendered two ways inside this batch.** `सूची बनाई` / `सूची बनाते` in 12 of the 14 `listed_*` keys vs `सूचीबद्ध किए` / `सूचीबद्ध करते` in `listed_secrets` and `listed_network_peers`. Pick one. Recommendation: `सूचीबद्ध किए` — it is the shipped word for the list action (`सभी शेड्यूल सूचीबद्ध करने का अनुरोध विफल` in `ui.common.errors.json`, `यहाँ सूचीबद्ध चैट से परे` in `ui.chat.sidebar.json`) and it is terser for the long objects (`प्रोजेक्ट सूचीबद्ध कर रहा है` vs `प्रोजेक्टों की सूची बना रहा है`). If the wave prefers everyday `सूची बनाना`, that is defensible too — but then `listed_secrets` and `listed_network_peers` must change with it.

**m2 — `secret` is `गोपनीय मान`, shipped copy says `गोपनीय जानकारी`; `described` is the literary `वर्णित किया`.** Shipped: `ui.chat.canonical.fold.count.secret` = `गोपनीय जानकारी`, `ui.chat.ask_answer.secret_docked` = `गोपनीय अनुरोध…`. `ui.canvas` uses `मान` for a *value*, so `गोपनीय मान` also brushes against that meaning. Suggest `गोपनीय जानकारी` (or record `गोपनीय मान` as a deliberate call in the hi guide). For `described_secret`, `वर्णित किया` is Sanskritised against the guide's "prefer common Hindi words over heavy Sanskritisation"; suggest `गोपनीय जानकारी का विवरण देखा` — if that overflows the gutter, `विवरण देखा` with the object carrying the name.

**m3 — `raised_panic`: `आपात रोक लगाई` is a nonce compound.** `आपात` alone means "emergency/calamity"; `आपात रोक` is not an established term, and the operation is the mesh `panic`. The severity reads correctly (no safety misread, hence MINOR not BLOCKER). Suggest `आपातकाल घोषित किया` or, keeping the mesh register of loans (`मेश`, `रिले`), `पैनिक सक्रिय किया`; running `… कर रहा है`.

**m4 — `captured_console`: `कंसोल की छवि ली` for the `screenshot` operation.** Shipped hi already uses the loan for this exact action (`स्क्रीनशॉट` in `ui.onboarding.tour…`); `छवि` alone is "image" and less recognisable as the op. Suggest `कंसोल का स्क्रीनशॉट लिया` / `… ले रहा है`. If `छवि` is chosen deliberately (gutter width), record it in the hi guide.

**m5 — Two English distinctions collapse onto one Hindi verb, which the source notes warn against.** (a) `Found definition` / `Found references` use the same `खोज` stem as `Searched` (grep/web) and `Searched agents`: `परिभाषा खोजी`, `संदर्भ खोजे`, `एजेंट खोजे`. (b) `Diagnosed network` uses the same `जाँच` as `Checked network status` (`नेटवर्क की जाँच की` vs `नेटवर्क स्थिति जाँची`). Suggest `परिभाषा ढूँढी` / `संदर्भ ढूँढे` for the lsp lookups and a `doctor`-specific verb for the diagnosis (`नेटवर्क का निदान किया`, if that fits the gutter).

### NIT (max 5; these do not gate)

**n1 —** `previewed_rename` `नाम-परिवर्तन` is stilted: suggest `नाम-बदलाव की झलक देखी` (same 4 words, fewer cells).
**n2 —** `waited_for_jobs` `जॉब की प्रतीक्षा की` reads singular for "jobs"; `जॉब्स की प्रतीक्षा की` matches the plural.
**n3 —** `invited_device` `डिवाइस को आमंत्रित किया` carries `को` where every sibling row drops it (`डिवाइस हटाया`, `डिवाइस…`); `डिवाइस आमंत्रित किया` keeps the column uniform.

## Checked and found clean (no finding raised)

- **Meaning/polarity and safety:** every destructive row (`deleted_team`, `deleted_project`, `deleted_secret`, `removed_device`, `removed_milestone`, `cancelled_*`, `stopped_session`, `closed_console`, `raised_panic`) reads as destructive; no read-only row (`read_*`, `listed_*`, `viewed_*`, `peeked_at*`, `checked_*`, `diagnosed_network`) reads as destructive. `stored`/`retrieved`/`deleted` secret are three distinct verbs (`सहेजा`/`पाया`/`हटाया`).
- **Gender/agreement:** `टीम` rows consistently take feminine (`बनाई`, `देखी`, `अपडेट की`, `हटाई`), `प्रोजेक्ट`/`नेटवर्क`/`संदेश`/`मान`/`कंसोल` masculine, `कार्य सूची`/`जागृति`/`परिभाषा` feminine (`पढ़ी`, `रद्द की`, `खोजी`), `कुंजियाँ भेजीं`.
- **Glossary/style calls honoured:** `session`→`सत्र`, `wake`→`जागृति` (plural oblique `जागृतियों`), `job`→`जॉब`, `team`→`टीम`, `project`→`प्रोजेक्ट`, `todos`→`कार्य सूची` (matches `ui.chat.run_details.todos.title`), `subagent`→`उप-एजेंट`, `mesh`→`मेश`, `schedule`→`शेड्यूल`, `prompt`-class loans left Latin; `monitor`/`tool` names never translated; `Python` kept Latin as a technology name.
- **Trailing-preposition rows:** `linked_session_to` / `unlinked_session_from` keep a workable relation to the following object (`सत्र इससे जोड़ा` / `सत्र इससे अलग किया` — `जोड़ना`/`अलग करना` both construe with `से`), and the pair contrasts correctly. `peeked_at` uses `झलक देखी`, parallel with its sibling.
- **Width:** no finding. Longest value is 21 estimated base glyphs (`सुरक्षित इनपुट अपडेट करते`), against 28 already shipped in `tool_row.bridge.verb` copy; all values are 1–4 words. (Width is a computed estimate — combining matras counted 0, conjuncts not discounted further; `cell_len` in the repo is the authority.)
- **No placeholders, no ICU plurals, no markup, no bidi characters** in this group, so those classes have nothing to check here.
- **Not applicable:** RTL (hi), wide-glyph/Latin-embedded directionality.

## Ledger / evidence

- Evidence bundle written here: `i18n/audits/evidence/hi/ui.chat.canonical/l1verb-hi-a/` (`record.json`, `audit.log`, `verify.py`). It is **untracked** until the wave stages it.
- I did **not** run `scripts/i18n/ledger-assemble.mjs` for `(hi, ui.chat.canonical)`: the namespace file has not merged this batch yet (0 of 182 keys present), so any `target_sha256` I record now would describe bytes that never ship and `ledger-check` would fail it as stale. The row must be assembled by the wave after the batch lands in `hi/ui.chat.canonical.json`, with this audit's counts (blocker 0, major 4, minor 5, nit 3 → `changes_requested` until re-audited).
- The verdict in this report describes `hi.json` at `41bcec4f…` only. Any edit to a key above voids it for that key and needs a re-audit of the delta.
