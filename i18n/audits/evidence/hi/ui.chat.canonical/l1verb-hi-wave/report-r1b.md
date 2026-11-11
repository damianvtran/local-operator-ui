# Hindi (`hi`) audit — slice L1 tool-row verbs — report B (l1-au-hi-B)

Auditor: i18n-auditor (team lopdev), independent of the translator (openai/gpt-6.1-sol). Served model: anthropic/claude-sonnet-5-5. No MT/translation service used; judged by reading.
Inputs: `keys.json` (182 keys), `hi.json`, `i18n/style-guides/hi.md` + `en.md`, shipped `hi/ui.chat.canonical.json` (`tool_row.generic_verb.*`, `tool_row.bridge.*`), shipped `hi/ui.projects*.json`, `hi/ui.canvas.json`.

## Verdict: **blocked** (MAJORs open, no BLOCKER)

Counts: **BLOCKER 0 · MAJOR 3 · MINOR 5 · NIT 1** (F1,F2,F3 major; F4–F8 minor; N1 nit)

## Mechanical checks (python3, actually run)
- keys: 182 in keys.json, 182 in hi.json, same set AND same order: True.
- empty values: 0. English-identical values: 0. Placeholders/braces/backticks/tags: none (none expected). Manual bidi/ZWJ/ZWNJ chars: 0.
- Latin tokens in values: only `Python` (allowed technology name).
- Duplicate values across different keys: 0 (no two distinct operations read identically).
- Length: max 4 words (limit 1–4), no value over limit. No maxCells hint exists in the sidecar (only "one to four words").
- Running-form endings: `रहा है` 41, bare `रहा` 23, bare `...ते` 27.

## Findings

### F1 — MAJOR — 27 `.running` values are bare imperfective participles ("...ते"): ungrammatical as a stand-alone verb
Pattern: e.g. `listed_agents.running` = "एजेंटों की सूची बनाते" ("while making a list of agents"). Without the auxiliary it is a clause fragment, not a present-progressive, it does not pair with its `.settled` sibling, and it differs from the 41 `रहा है` rows in the same file and from shipped `bridge.verb.*.running` ("बना रहा है", "पढ़ रहा है"). In one gutter the user sees three different running shapes.

Constraint note (derived, not assumed): every "…ते" and every bare "…रहा" value is exactly 4 words, i.e. the translator evidently dropped the auxiliary to stay inside "one to four words". Adding "रहा है" makes most of them 5–6 words. The sidecar gives only a word-count hint, no maxCells; the real constraint is the gutter width. Measured here: longest translator value 26 chars; shipped `bridge.verb.*` values reach 32 chars and 7 words, so a full form of ≤32 chars has precedent. Two compliant routes: (a) full "रहा है" form (word hint exceeded, ≤32 chars, listed in column 3); (b) for the list rows, drop "की सूची" and use "X सूचीबद्ध कर रहा है" (4 words, column 4; also settles F5). Manager/coder to pick; either is acceptable, "…ते" is not.

| key (suffix of `ui.chat.canonical.tool_row.verb.`) | current | (a) full form (words/chars) | (b) ≤4-word variant |
|---|---|---|---|
| `listed_variables.running` | चरों की सूची बनाते | चरों की सूची बना रहा है (6w/23c) | वेरिएबल सूचीबद्ध कर रहा है |
| `waited_for_jobs.running` | जॉब की प्रतीक्षा करते | जॉब की प्रतीक्षा कर रहा है (6w/26c) |  |
| `listed_agents.running` | एजेंटों की सूची बनाते | एजेंटों की सूची बना रहा है (6w/26c) | एजेंट सूचीबद्ध कर रहा है |
| `listed_teams.running` | टीमों की सूची बनाते | टीमों की सूची बना रहा है (6w/24c) | टीमें सूचीबद्ध कर रहा है |
| `listed_subagents.running` | उप-एजेंटों की सूची बनाते | उप-एजेंटों की सूची बना रहा है (6w/29c) | उप-एजेंट सूचीबद्ध कर रहा है |
| `listed_secrets.running` | गोपनीय मान सूचीबद्ध करते | गोपनीय मान सूचीबद्ध कर रहा है (6w/29c) |  |
| `described_secret.running` | गोपनीय मान वर्णित करते | गोपनीय मान वर्णित कर रहा है (6w/27c) |  |
| `updated_secret.running` | गोपनीय मान अपडेट करते | गोपनीय मान अपडेट कर रहा है (6w/26c) |  |
| `listed_projects.running` | प्रोजेक्टों की सूची बनाते | प्रोजेक्टों की सूची बना रहा है (6w/30c) | प्रोजेक्ट सूचीबद्ध कर रहा है |
| `unlinked_session_from.running` | सत्र इससे अलग करते | सत्र इससे अलग कर रहा है (6w/23c) |  |
| `updated_todos.running` | कार्य सूची अपडेट करते | कार्य सूची अपडेट कर रहा है (6w/26c) |  |
| `listed_wakes.running` | जागृतियों की सूची बनाते | जागृतियों की सूची बना रहा है (6w/28c) | जागृतियाँ सूचीबद्ध कर रहा है |
| `listed_jobs.running` | जॉब की सूची बनाते | जॉब की सूची बना रहा है (6w/22c) | जॉब सूचीबद्ध कर रहा है |
| `listed_networks.running` | नेटवर्कों की सूची बनाते | नेटवर्कों की सूची बना रहा है (6w/28c) | नेटवर्क सूचीबद्ध कर रहा है |
| `listed_network_peers.running` | नेटवर्क साथी सूचीबद्ध करते | नेटवर्क साथी सूचीबद्ध कर रहा है (6w/31c) |  |
| `diagnosed_network.running` | नेटवर्क की जाँच करते | नेटवर्क की जाँच कर रहा है (6w/25c) |  |
| `invited_device.running` | डिवाइस को आमंत्रित करते | डिवाइस को आमंत्रित कर रहा है (6w/28c) |  |
| `listed_consoles.running` | कंसोलों की सूची बनाते | कंसोलों की सूची बना रहा है (6w/26c) | कंसोल सूचीबद्ध कर रहा है |
| `captured_console.running` | कंसोल की छवि लेते | कंसोल की छवि ले रहा है (6w/22c) |  |
| `typed_in_console.running` | कंसोल में टाइप करते | कंसोल में टाइप कर रहा है (6w/24c) |  |
| `resized_console.running` | कंसोल का आकार बदलते | कंसोल का आकार बदल रहा है (6w/24c) |  |
| `updated_secure_input.running` | सुरक्षित इनपुट अपडेट करते | सुरक्षित इनपुट अपडेट कर रहा है (6w/30c) |  |
| `listed_symbols.running` | प्रतीकों की सूची बनाते | प्रतीकों की सूची बना रहा है (6w/27c) | प्रतीक सूचीबद्ध कर रहा है |
| `previewed_rename.running` | नाम-परिवर्तन की झलक देखते | नाम-परिवर्तन की झलक देख रहा है (6w/30c) |  |
| `listed_sessions.running` | सत्रों की सूची बनाते | सत्रों की सूची बना रहा है (6w/25c) | सत्र सूचीबद्ध कर रहा है |
| `resumed_session.running` | सत्र फिर शुरू करते | सत्र फिर शुरू कर रहा है (6w/23c) |  |
| `peeked_at_session.running` | सत्र की झलक देखते | सत्र की झलक देख रहा है (6w/22c) |  |

### F2 — MAJOR — Glossary/consistency: terms differ from shipped hi copy for the same concepts
- `updated_milestone.*`, `removed_milestone.*`: "पड़ाव" for milestone. Shipped hi (ui.projects.*) uses **माइलस्टोन** ("माइलस्टोन हटाया नहीं गया।"). Suggest `updated_milestone.settled` "माइलस्टोन अपडेट किया", `.running` "माइलस्टोन अपडेट कर रहा है"; `removed_milestone.settled` "माइलस्टोन हटाया", `.running` "माइलस्टोन हटा रहा है". A user would otherwise see "पड़ाव" in the tool row and "माइलस्टोन" on the project page for the same object.
- `listed_variables.*`, `read_variable.*`: "चर" for variable. Shipped hi (ui.canvas variables viewer) uses **वेरिएबल** ("वेरिएबल हटाएँ"). Suggest `listed_variables.settled` "वेरिएबल की सूची बनाई" (see F5 for list verb), `.running` "वेरिएबल की सूची बना रहा है"; `read_variable.settled` "वेरिएबल पढ़ा", `.running` "वेरिएबल पढ़ रहा है".
- all 12 `*_secret(s).*` keys (6 operations × settled/running) use "गोपनीय मान" ("confidential value"). Shipped hi (`fold.count.secret`, `composer.secret_ask_notice`, `ask_answer.secret_docked`) calls a secret **गोपनीय जानकारी**. Suggest `stored_secret.settled` "गोपनीय जानकारी सहेजी", `.running` "गोपनीय जानकारी सहेज रहा है" (note feminine perfective agreement with जानकारी: सहेजी/पाई/हटाई/अपडेट की/सूचीबद्ध की, i.e. check each settled form agrees). If the owner prefers keeping "मान", it must be changed in the shipped strings too — the two surfaces currently disagree.
  Severity MAJOR because the operator rule is whole-interface consistency and these are glossary-adjacent product terms;

### F3 — MAJOR — `ui.chat.canonical.tool_row.verb.linked_session_to.*` / `unlinked_session_from.*`: dangling pronoun "इससे" does not keep the relation to the following object
`linked_session_to.settled` "सत्र इससे जोड़ा", `.running` "सत्र इससे जोड़ रहा"; `unlinked_session_from.settled` "सत्र इससे अलग किया", `.running` "सत्र इससे अलग करते". The monospace object that follows is the project name, so the row reads "सत्र इससे जोड़ा my-project" ("session [with] this linked my-project") — "इससे" points at nothing and the postposition "से" is detached from its noun (Hindi postpositions follow the noun, so a pure preposition-style gutter cannot be copied). Suggested: `linked_session_to.settled` "सत्र प्रोजेक्ट से जोड़ा", `.running` "सत्र प्रोजेक्ट से जोड़ रहा है"; `unlinked_session_from.settled` "सत्र प्रोजेक्ट से अलग किया", `.running` "सत्र प्रोजेक्ट से अलग कर रहा है" (the row then reads "session from-project linked <name>"; 4 words max for running — within limit). The running forms also fall under F1.

### F4 — MINOR — 23 `.running` values drop the auxiliary: "...रहा" without "है"
Same word-hint trade-off as F1 (all exactly 4 words; adding है makes 5). A clipped finite form ("चला रहा", "लिख रहा") is understandable and common in terse UI, hence MINOR, but it is inconsistent with the 41 `रहा है` rows and shipped copy. Fix in the same pass as F1 using whichever route the team picks for F1 (full form below, chars within shipped precedent):

| key | current | suggested (words/chars) |
|---|---|---|
| `searched_the_web.running` | वेब पर खोज रहा | वेब पर खोज रहा है (5w/17c) |
| `installed_agent.running` | एजेंट इंस्टॉल कर रहा | एजेंट इंस्टॉल कर रहा है (5w/23c) |
| `reset_agent.running` | एजेंट रीसेट कर रहा | एजेंट रीसेट कर रहा है (5w/21c) |
| `updated_agent.running` | एजेंट अपडेट कर रहा | एजेंट अपडेट कर रहा है (5w/21c) |
| `synced_agents.running` | एजेंट सिंक कर रहा | एजेंट सिंक कर रहा है (5w/20c) |
| `updated_team.running` | टीम अपडेट कर रहा | टीम अपडेट कर रहा है (5w/19c) |
| `resumed.running` | फिर शुरू कर रहा | फिर शुरू कर रहा है (5w/18c) |
| `stored_secret.running` | गोपनीय मान सहेज रहा | गोपनीय मान सहेज रहा है (5w/22c) |
| `retrieved_secret.running` | गोपनीय मान पा रहा | गोपनीय मान पा रहा है (5w/20c) |
| `deleted_secret.running` | गोपनीय मान हटा रहा | गोपनीय मान हटा रहा है (5w/21c) |
| `updated_project.running` | प्रोजेक्ट अपडेट कर रहा | प्रोजेक्ट अपडेट कर रहा है (5w/25c) |
| `linked_session_to.running` | सत्र इससे जोड़ रहा | सत्र इससे जोड़ रहा है (5w/21c) |
| `updated_milestone.running` | पड़ाव अपडेट कर रहा | पड़ाव अपडेट कर रहा है (5w/21c) |
| `read_todos.running` | कार्य सूची पढ़ रहा | कार्य सूची पढ़ रहा है (5w/21c) |
| `cancelled_wake.running` | जागृति रद्द कर रहा | जागृति रद्द कर रहा है (5w/21c) |
| `cancelled_job.running` | जॉब रद्द कर रहा | जॉब रद्द कर रहा है (5w/18c) |
| `checked_network_status.running` | नेटवर्क स्थिति जाँच रहा | नेटवर्क स्थिति जाँच रहा है (5w/26c) |
| `read_network_log.running` | नेटवर्क लॉग पढ़ रहा | नेटवर्क लॉग पढ़ रहा है (5w/22c) |
| `joined_network.running` | नेटवर्क से जुड़ रहा | नेटवर्क से जुड़ रहा है (5w/22c) |
| `left_network.running` | नेटवर्क से निकल रहा | नेटवर्क से निकल रहा है (5w/22c) |
| `raised_panic.running` | आपात रोक लगा रहा | आपात रोक लगा रहा है (5w/19c) |
| `closed_console.running` | कंसोल बंद कर रहा | कंसोल बंद कर रहा है (5w/19c) |
| `spawned_session.running` | सत्र शुरू कर रहा | सत्र शुरू कर रहा है (5w/19c) |

### F5 — MINOR — "Listed X" has three renderings and "सूची बनाई" reads as *created a list*
`listed.*`, `listed_agents/variables/teams/subagents/sessions/projects/wakes/jobs/networks/symbols` use "…की सूची बनाई" ("made a list"), while `listed_secrets`, `listed_network_peers` use "सूचीबद्ध किए". "बनाई" suggests creating, in a column where `created_*` rows also use "बनाया/बनाई" — a read-only list could look like a write. Suggest one verb everywhere: settled "…सूचीबद्ध किए/किया/की" or "…की सूची देखी"; running "…सूचीबद्ध कर रहा है" / "…की सूची देख रहा है". E.g. `listed_agents.settled` "एजेंटों की सूची देखी", `.running` "एजेंटों की सूची देख रहा है"; bare `listed.settled` "सूची देखी" (glob lists files). Not a polarity swap, hence MINOR.

### F6 — MINOR — `listed_network_peers.*` "नेटवर्क साथी सूचीबद्ध किए" / `.running` "नेटवर्क साथी सूचीबद्ध करते"
"नेटवर्क साथी" reads as a compound noun ("network partner/companion"); the shipped hi copy has no "साथी" term for peers (shipped bridge uses "टीम सदस्य"/डिवाइस). Suggest "नेटवर्क के डिवाइस सूचीबद्ध किए" (peers are devices, cf. `invited_device`: "डिवाइस") / "नेटवर्क के डिवाइस सूचीबद्ध कर रहा है". Also fix `.running` ending per F1.

### F7 — MINOR — `diagnosed_network.*` collapses into `checked_network_status.*`
`diagnosed_network.settled` "नेटवर्क की जाँच की" vs `checked_network_status.settled` "नेटवर्क स्थिति जाँची": two different operations (`doctor` vs `status`) read near-identically. Suggest `diagnosed_network.settled` "नेटवर्क का निदान किया", `.running` "नेटवर्क का निदान कर रहा है" (or "नेटवर्क की समस्याएँ जाँचीं").

### F8 — MINOR — `captured_console.*` "कंसोल की छवि ली" for `screenshot`
"छवि" is generic (any image). Prefer "कंसोल का स्क्रीनशॉट लिया" / "कंसोल का स्क्रीनशॉट ले रहा है" — a settled loan; the shipped hi catalogue itself uses "कैप्चर" for screen capture (`permission_screen_capture`), so "कंसोल कैप्चर किया" is also defensible. Also fix `.running` ending per F1.

### N1 — NIT — `described_secret.*` "गोपनीय मान वर्णित किया" (stilted "described"); better "…का विवरण देखा" / "…का विवरण देख रहा है" (the `describe` op reads metadata).

## Checked and fine
- Destructive vs read-only polarity: all `deleted_*`, `removed_*`, `cancelled_*`, `stopped_session`, `closed_console`, `reset_agent` use हटाया/हटाई/रद्द/रोका/बंद/रीसेट; no read-only↔destructive swaps found. `viewed_*`/`read_*`/`peeked_*` are read-only forms.
- Pairs `.settled`/`.running` use the same verb stem in all 91 pairs (verified by reading; stems only differ in the F1/F4 ending). Feminine/masculine perfective object agreement ("टीम हटाई", "कुंजियाँ भेजीं") is grammatical.
- Register: no तुम/तू; polite-neutral third person like shipped bridge verbs. Nukta and "ब्राउज़/पढ़" spelling correct. No manual bidi/ZWJ.
- Latin: only "Python". `जॉब`, `शेड्यूल`, `जागृति`, `उप-एजेंट`, `सत्र`, `टीम` conform to the style guide; "जॉब की सूची" uses singular जॉब as shipped.
- Shipped `generic_verb.running/settled` ("कॉल जारी"/"कॉल पूर्ण") are a different, noun-ish style; not required to match, but `bridge.verb.*.running` ("रहा है") is the baseline that F1/F4 diverge from.

## Verdict
**blocked**: 3 MAJOR (F1 participle fragments, F2 term inconsistency with shipped copy, F3 dangling "इससे"). No BLOCKER. After F1–F3 are applied (F4–F8 recommended in the same pass), the group would pass re-audit. `status` for the ledger would be `changes_requested`; I did not write a ledger row (not requested in this slice brief).
