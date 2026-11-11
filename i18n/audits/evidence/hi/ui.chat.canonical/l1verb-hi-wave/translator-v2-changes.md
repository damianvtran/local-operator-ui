# Hindi L1 tool-row verbs — remediation v2

## Scope and provenance

- Date: 2026-11-11. Translator: `i18n-translator`; session `f580f0b9670b`; actual served model: `openai/gpt-6.1-sol` (session model header). No fallback or MT service used.
- Scope: 182 keys / 91 settled-running pairs in `keys.json`; only `hi.v2.json` and this remediation note created. Original `hi.json`, both audit reports, shipped catalogues, ledger and audit evidence are unchanged.
- State: **translated / awaiting independent re-audit**, not audited or passed. No ledger assertion made.
- Result derived by direct JSON comparison: **87 changed keys**, **21 finding IDs fixed** (A:12; B:9); **0 declined**, **0 deferred**. A and B have overlapping findings; counts are IDs, not unique defects.
- Inputs read: Hindi/English style guides, shared glossary, core HOWTO and RFC §§2.2/6; both complete audit reports; all source tool roles; shipped Hindi catalogues for exact-concept precedent.

## Evidence behind decisions

- Direct scan: `ui.mesh.json` has पीयर in 3 values and साथी in 0; `ui.projects.json` has माइलस्टोन in 26 values and पड़ाव in 0; `ui.canvas.json` has वेरिएबल in 17 values and no standalone चर. Its two चर substring matches are चरण/चरणों, confirmed by reading their complete values.
- `ui.chat.canonical.fold.count.secret` uses गोपनीय जानकारी. `tool_row.bridge.verb.*.running` has 17 strings, all ending है; settled values already use neutral perfective status phrases. Commands’ polite imperative rule in `hi.md` §Formality applies to commands, not narration of finished/running actions, so no imperative rewrite is appropriate.
- `hi.md` §§Locale calls/Product-name policy endorse सत्र, जागृति, जॉब and उप-एजेंट; existing कंसोल, कार्य सूची and अपडेट terms retained. Python remains Latin. Plural जॉब्स has 2 shipped precedents (run-details jobs label and composer jobs action).
- For panic, read-only inspection of `local_operator/network/cli.py:744` establishes `Incident: broadcast a revoke and rotate`; this is why पैनिक सक्रिय is preferable to generic आपातकाल घोषित. No network operation was executed.

## Finding dispositions

Change references below resolve to the exact key / old → new table immediately afterward. Every referenced key is actually changed in v2. Suggestions can be improved without declining the finding (notably B:F6).

| Finding | Severity | Decision and reasoning | Exact changed-key rows |
|---|---|---|---|
| A:M1 | MAJOR | **fixed** — All 50 clipped running forms restored to full present progressive, matching the 17/17 shipped bridge running forms. The 41 already-full forms remain in the same register. | C03, C05, C09, C11, C12, C13, C14, C15, C17, C18, C20, C21, C23, C25, C27, C29, C31, C33, C35, C36, C38, C40, C42, C45, C46, C48, C49, C51, C52, C53, C55, C57, C58, C60, C62, C63, C64, C66, C68, C70, C71, C72, C73, C74, C80, C82, C84, C85, C86, C87 |
| A:M2 | MAJOR | **fixed** — Use पीयर, the shipped mesh term (3 values); साथी has 0 mesh occurrences. | C56, C57 |
| A:M3 | MAJOR | **fixed** — Use माइलस्टोन: 26 project values; पड़ाव has 0. | C41, C42, C43, C44 |
| A:M4 | MAJOR | **fixed** — Use वेरिएबल: 17 canvas values. The two substring hits for चर are actually चरण/चरणों, not variable terminology. | C04, C05, C06, C07 |
| A:m1 | MINOR | **fixed** — Use सूचीबद्ध consistently for every list/glob operation; avoid suggesting list creation. | C01, C02, C04, C05, C10, C11, C16, C17, C19, C20, C26, C27, C34, C35, C47, C48, C50, C51, C54, C55, C56, C57, C67, C68, C79, C80, C83, C84 |
| A:m2 | MINOR | **fixed** — Use shipped गोपनीय जानकारी with feminine perfective agreement; describe reads metadata, so विवरण देखा replaces वर्णित किया. | C22, C23, C24, C25, C26, C27, C28, C29, C30, C31, C32, C33 |
| A:m3 | MINOR | **fixed** — Use पैनिक सक्रिय किया / कर रहा है. cli.py parser describes an incident action broadcasting revocation and rotation, not declaring an emergency; preserve operation specificity rather than a vague emergency-stop compound. | C65, C66 |
| A:m4 | MINOR | **fixed** — Use स्क्रीनशॉट, the same exact-action loan shipped in ui.onboarding.tour.attachments.body.4. | C69, C70 |
| A:m5 | MINOR | **fixed** — Use ढूँढना for targeted LSP lookup and निदान for network doctor, distinct from grep/web खोज and network status जाँच. | C59, C60, C75, C76, C77, C78 |
| A:n1 | NIT | **fixed** — Use everyday नाम-बदलाव rather than formal नाम-परिवर्तन. | C81, C82 |
| A:n2 | NIT | **fixed** — Use plural जॉब्स for multi-job operations; shipped run-details and composer copy has this plural in 2 values. Singular cancellation remains जॉब. | C08, C09, C50, C51 |
| A:n3 | NIT | **fixed** — Drop optional को in both halves of the invite pair, reducing width without losing the device object. | C61, C62 |
| B:F1 | MAJOR | **fixed** — Replace every bare imperfective participle with full रहा है; use सूचीबद्ध to shorten list phrases. | C05, C09, C11, C17, C20, C27, C29, C31, C35, C40, C46, C48, C51, C55, C57, C60, C62, C68, C70, C71, C72, C73, C80, C82, C84, C86, C87 |
| B:F2 | MAJOR | **fixed** — Align all milestone, variable and secret terms with shipped copy; feminine agreement for जानकारी. | C04, C05, C06, C07, C41, C42, C43, C44, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31, C32, C33 |
| B:F3 | MAJOR | **fixed** — Replace dangling इससे with explicit प्रोजेक्ट से in both pairs, following the auditor’s lexical repair. The following monospace name identifies that project; link vs unlink keeps जोड़ा vs अलग किया. See grammar caveat below. | C37, C38, C39, C40 |
| B:F4 | MINOR | **fixed** — Restore है in all 23 rows; no mixed clipped register remains. | C03, C12, C13, C14, C15, C18, C21, C23, C25, C33, C36, C38, C42, C45, C49, C52, C53, C58, C63, C64, C66, C74, C85 |
| B:F5 | MINOR | **fixed** — Unify on सूचीबद्ध, not सूची बनाई. This describes enumeration rather than creating an object. | C01, C02, C04, C05, C10, C11, C16, C17, C19, C20, C26, C27, C34, C35, C47, C48, C50, C51, C54, C55, C56, C57, C67, C68, C79, C80, C83, C84 |
| B:F6 | MINOR | **fixed** — Fix साथी to पीयर, not the suggested डिवाइस: audited problem is real, but A:M2 and direct mesh scan establish the shipped exact-concept term. Device remains डिवाइस in actual device operations. | C56, C57 |
| B:F7 | MINOR | **fixed** — Use निदान for doctor, retaining जाँच for status. | C59, C60 |
| B:F8 | MINOR | **fixed** — Use explicit कंसोल का स्क्रीनशॉट, rather than generic छवि or less-specific कैप्चर. | C69, C70 |
| B:N1 | NIT | **fixed** — Use विवरण देखा / देख रहा है for read-only secret metadata, replacing stilted वर्णित. | C28, C29 |

### Grammar caveat for prefix-only layout

Hindi normally places a project name before its postposition, whereas this interface irreversibly places the opaque name after the verb-column phrase. No translation can produce unrestricted natural Hindi argument order under that renderer contract. B:F3’s repair makes the relation explicit as प्रोजेक्ट से and the following monospace name appositional; the main verb still precedes the external monospace object. It removes the dangling deictic without dropping linking/unlinking semantics. This is label-style UI, not a claim that `सत्र प्रोजेक्ट से जोड़ा <name>` is ordinary Hindi prose. B’s suggested running word counts are incorrect: Python counts 6 and 7 words, not 4. This is recorded as a width exception, not hidden. The independent re-auditor should check the assembled row.

## Exact per-key changes

All keys below have prefix `ui.chat.canonical.tool_row.verb.`; full keys in JSON are unchanged.

| Change | Key suffix | Old | New |
|---|---|---|---|
| C01 | `listed.settled` | सूची बनाई | सूचीबद्ध किया |
| C02 | `listed.running` | सूची बना रहा है | सूचीबद्ध कर रहा है |
| C03 | `searched_the_web.running` | वेब पर खोज रहा | वेब पर खोज रहा है |
| C04 | `listed_variables.settled` | चरों की सूची बनाई | वेरिएबल सूचीबद्ध किए |
| C05 | `listed_variables.running` | चरों की सूची बनाते | वेरिएबल सूचीबद्ध कर रहा है |
| C06 | `read_variable.settled` | चर पढ़ा | वेरिएबल पढ़ा |
| C07 | `read_variable.running` | चर पढ़ रहा है | वेरिएबल पढ़ रहा है |
| C08 | `waited_for_jobs.settled` | जॉब की प्रतीक्षा की | जॉब्स की प्रतीक्षा की |
| C09 | `waited_for_jobs.running` | जॉब की प्रतीक्षा करते | जॉब्स की प्रतीक्षा कर रहा है |
| C10 | `listed_agents.settled` | एजेंटों की सूची बनाई | एजेंट सूचीबद्ध किए |
| C11 | `listed_agents.running` | एजेंटों की सूची बनाते | एजेंट सूचीबद्ध कर रहा है |
| C12 | `installed_agent.running` | एजेंट इंस्टॉल कर रहा | एजेंट इंस्टॉल कर रहा है |
| C13 | `reset_agent.running` | एजेंट रीसेट कर रहा | एजेंट रीसेट कर रहा है |
| C14 | `updated_agent.running` | एजेंट अपडेट कर रहा | एजेंट अपडेट कर रहा है |
| C15 | `synced_agents.running` | एजेंट सिंक कर रहा | एजेंट सिंक कर रहा है |
| C16 | `listed_teams.settled` | टीमों की सूची बनाई | टीमें सूचीबद्ध कीं |
| C17 | `listed_teams.running` | टीमों की सूची बनाते | टीमें सूचीबद्ध कर रहा है |
| C18 | `updated_team.running` | टीम अपडेट कर रहा | टीम अपडेट कर रहा है |
| C19 | `listed_subagents.settled` | उप-एजेंटों की सूची बनाई | उप-एजेंट सूचीबद्ध किए |
| C20 | `listed_subagents.running` | उप-एजेंटों की सूची बनाते | उप-एजेंट सूचीबद्ध कर रहा है |
| C21 | `resumed.running` | फिर शुरू कर रहा | फिर शुरू कर रहा है |
| C22 | `stored_secret.settled` | गोपनीय मान सहेजा | गोपनीय जानकारी सहेजी |
| C23 | `stored_secret.running` | गोपनीय मान सहेज रहा | गोपनीय जानकारी सहेज रहा है |
| C24 | `retrieved_secret.settled` | गोपनीय मान पाया | गोपनीय जानकारी पाई |
| C25 | `retrieved_secret.running` | गोपनीय मान पा रहा | गोपनीय जानकारी पा रहा है |
| C26 | `listed_secrets.settled` | गोपनीय मान सूचीबद्ध किए | गोपनीय जानकारी सूचीबद्ध की |
| C27 | `listed_secrets.running` | गोपनीय मान सूचीबद्ध करते | गोपनीय जानकारी सूचीबद्ध कर रहा है |
| C28 | `described_secret.settled` | गोपनीय मान वर्णित किया | गोपनीय जानकारी का विवरण देखा |
| C29 | `described_secret.running` | गोपनीय मान वर्णित करते | गोपनीय जानकारी का विवरण देख रहा है |
| C30 | `updated_secret.settled` | गोपनीय मान अपडेट किया | गोपनीय जानकारी अपडेट की |
| C31 | `updated_secret.running` | गोपनीय मान अपडेट करते | गोपनीय जानकारी अपडेट कर रहा है |
| C32 | `deleted_secret.settled` | गोपनीय मान हटाया | गोपनीय जानकारी हटाई |
| C33 | `deleted_secret.running` | गोपनीय मान हटा रहा | गोपनीय जानकारी हटा रहा है |
| C34 | `listed_projects.settled` | प्रोजेक्टों की सूची बनाई | प्रोजेक्ट सूचीबद्ध किए |
| C35 | `listed_projects.running` | प्रोजेक्टों की सूची बनाते | प्रोजेक्ट सूचीबद्ध कर रहा है |
| C36 | `updated_project.running` | प्रोजेक्ट अपडेट कर रहा | प्रोजेक्ट अपडेट कर रहा है |
| C37 | `linked_session_to.settled` | सत्र इससे जोड़ा | सत्र प्रोजेक्ट से जोड़ा |
| C38 | `linked_session_to.running` | सत्र इससे जोड़ रहा | सत्र प्रोजेक्ट से जोड़ रहा है |
| C39 | `unlinked_session_from.settled` | सत्र इससे अलग किया | सत्र प्रोजेक्ट से अलग किया |
| C40 | `unlinked_session_from.running` | सत्र इससे अलग करते | सत्र प्रोजेक्ट से अलग कर रहा है |
| C41 | `updated_milestone.settled` | पड़ाव अपडेट किया | माइलस्टोन अपडेट किया |
| C42 | `updated_milestone.running` | पड़ाव अपडेट कर रहा | माइलस्टोन अपडेट कर रहा है |
| C43 | `removed_milestone.settled` | पड़ाव हटाया | माइलस्टोन हटाया |
| C44 | `removed_milestone.running` | पड़ाव हटा रहा है | माइलस्टोन हटा रहा है |
| C45 | `read_todos.running` | कार्य सूची पढ़ रहा | कार्य सूची पढ़ रहा है |
| C46 | `updated_todos.running` | कार्य सूची अपडेट करते | कार्य सूची अपडेट कर रहा है |
| C47 | `listed_wakes.settled` | जागृतियों की सूची बनाई | जागृतियाँ सूचीबद्ध कीं |
| C48 | `listed_wakes.running` | जागृतियों की सूची बनाते | जागृतियाँ सूचीबद्ध कर रहा है |
| C49 | `cancelled_wake.running` | जागृति रद्द कर रहा | जागृति रद्द कर रहा है |
| C50 | `listed_jobs.settled` | जॉब की सूची बनाई | जॉब्स सूचीबद्ध किए |
| C51 | `listed_jobs.running` | जॉब की सूची बनाते | जॉब्स सूचीबद्ध कर रहा है |
| C52 | `cancelled_job.running` | जॉब रद्द कर रहा | जॉब रद्द कर रहा है |
| C53 | `checked_network_status.running` | नेटवर्क स्थिति जाँच रहा | नेटवर्क स्थिति जाँच रहा है |
| C54 | `listed_networks.settled` | नेटवर्कों की सूची बनाई | नेटवर्क सूचीबद्ध किए |
| C55 | `listed_networks.running` | नेटवर्कों की सूची बनाते | नेटवर्क सूचीबद्ध कर रहा है |
| C56 | `listed_network_peers.settled` | नेटवर्क साथी सूचीबद्ध किए | नेटवर्क पीयर सूचीबद्ध किए |
| C57 | `listed_network_peers.running` | नेटवर्क साथी सूचीबद्ध करते | नेटवर्क पीयर सूचीबद्ध कर रहा है |
| C58 | `read_network_log.running` | नेटवर्क लॉग पढ़ रहा | नेटवर्क लॉग पढ़ रहा है |
| C59 | `diagnosed_network.settled` | नेटवर्क की जाँच की | नेटवर्क का निदान किया |
| C60 | `diagnosed_network.running` | नेटवर्क की जाँच करते | नेटवर्क का निदान कर रहा है |
| C61 | `invited_device.settled` | डिवाइस को आमंत्रित किया | डिवाइस आमंत्रित किया |
| C62 | `invited_device.running` | डिवाइस को आमंत्रित करते | डिवाइस आमंत्रित कर रहा है |
| C63 | `joined_network.running` | नेटवर्क से जुड़ रहा | नेटवर्क से जुड़ रहा है |
| C64 | `left_network.running` | नेटवर्क से निकल रहा | नेटवर्क से निकल रहा है |
| C65 | `raised_panic.settled` | आपात रोक लगाई | पैनिक सक्रिय किया |
| C66 | `raised_panic.running` | आपात रोक लगा रहा | पैनिक सक्रिय कर रहा है |
| C67 | `listed_consoles.settled` | कंसोलों की सूची बनाई | कंसोल सूचीबद्ध किए |
| C68 | `listed_consoles.running` | कंसोलों की सूची बनाते | कंसोल सूचीबद्ध कर रहा है |
| C69 | `captured_console.settled` | कंसोल की छवि ली | कंसोल का स्क्रीनशॉट लिया |
| C70 | `captured_console.running` | कंसोल की छवि लेते | कंसोल का स्क्रीनशॉट ले रहा है |
| C71 | `typed_in_console.running` | कंसोल में टाइप करते | कंसोल में टाइप कर रहा है |
| C72 | `resized_console.running` | कंसोल का आकार बदलते | कंसोल का आकार बदल रहा है |
| C73 | `updated_secure_input.running` | सुरक्षित इनपुट अपडेट करते | सुरक्षित इनपुट अपडेट कर रहा है |
| C74 | `closed_console.running` | कंसोल बंद कर रहा | कंसोल बंद कर रहा है |
| C75 | `found_definition.settled` | परिभाषा खोजी | परिभाषा ढूँढी |
| C76 | `found_definition.running` | परिभाषा खोज रहा है | परिभाषा ढूँढ रहा है |
| C77 | `found_references.settled` | संदर्भ खोजे | संदर्भ ढूँढे |
| C78 | `found_references.running` | संदर्भ खोज रहा है | संदर्भ ढूँढ रहा है |
| C79 | `listed_symbols.settled` | प्रतीकों की सूची बनाई | प्रतीक सूचीबद्ध किए |
| C80 | `listed_symbols.running` | प्रतीकों की सूची बनाते | प्रतीक सूचीबद्ध कर रहा है |
| C81 | `previewed_rename.settled` | नाम-परिवर्तन की झलक देखी | नाम-बदलाव की झलक देखी |
| C82 | `previewed_rename.running` | नाम-परिवर्तन की झलक देखते | नाम-बदलाव की झलक देख रहा है |
| C83 | `listed_sessions.settled` | सत्रों की सूची बनाई | सत्र सूचीबद्ध किए |
| C84 | `listed_sessions.running` | सत्रों की सूची बनाते | सत्र सूचीबद्ध कर रहा है |
| C85 | `spawned_session.running` | सत्र शुरू कर रहा | सत्र शुरू कर रहा है |
| C86 | `resumed_session.running` | सत्र फिर शुरू करते | सत्र फिर शुरू कर रहा है |
| C87 | `peeked_at_session.running` | सत्र की झलक देखते | सत्र की झलक देख रहा है |

## Width exceptions and justification

52 values exceed the English 1–4-word hint: **36 at 5 words, 14 at 6, 2 at 7**. All exceptions are individually listed below. Full Hindi progressive morphology needs `रहा है`; dropping either part or replacing it with a bare `…ते` recreates A:M1/B:F1/B:F4. सूचीबद्ध reduces enumeration phrases. Additional words below retain established two-word product terms, postpositions or necessary operation distinctions. No maxCells/maxChars is supplied in this source; the task explicitly says the column does not truncate. Word count alone is not rendered-width proof: no screenshot or fitting claim is made here.

| Key suffix | Words | Characters (code points) | Value | Why retained |
|---|---|---|---|---|
| `searched_the_web.running` | 5 | 17 | वेब पर खोज रहा है | Operation-specific verb/object retained; full progressive |
| `listed_variables.running` | 5 | 26 | वेरिएबल सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `waited_for_jobs.running` | 6 | 28 | जॉब्स की प्रतीक्षा कर रहा है | Natural प्रतीक्षा करना construction and plural job object; full progressive |
| `listed_agents.running` | 5 | 24 | एजेंट सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `installed_agent.running` | 5 | 23 | एजेंट इंस्टॉल कर रहा है | Operation-specific verb/object retained; full progressive |
| `reset_agent.running` | 5 | 21 | एजेंट रीसेट कर रहा है | Operation-specific verb/object retained; full progressive |
| `updated_agent.running` | 5 | 21 | एजेंट अपडेट कर रहा है | Operation-specific verb/object retained; full progressive |
| `synced_agents.running` | 5 | 20 | एजेंट सिंक कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_teams.running` | 5 | 24 | टीमें सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `updated_team.running` | 5 | 19 | टीम अपडेट कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_subagents.running` | 5 | 27 | उप-एजेंट सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `resumed.running` | 5 | 18 | फिर शुरू कर रहा है | Operation-specific verb/object retained; full progressive |
| `stored_secret.running` | 5 | 26 | गोपनीय जानकारी सहेज रहा है | Established two-word secret term; full progressive |
| `retrieved_secret.running` | 5 | 24 | गोपनीय जानकारी पा रहा है | Established two-word secret term; full progressive |
| `listed_secrets.running` | 6 | 33 | गोपनीय जानकारी सूचीबद्ध कर रहा है | Established two-word secret term; full progressive |
| `described_secret.settled` | 5 | 28 | गोपनीय जानकारी का विवरण देखा | Established गोपनीय जानकारी plus explicit metadata विवरण; full progressive |
| `described_secret.running` | 7 | 34 | गोपनीय जानकारी का विवरण देख रहा है | Established गोपनीय जानकारी plus explicit metadata विवरण; full progressive |
| `updated_secret.running` | 6 | 30 | गोपनीय जानकारी अपडेट कर रहा है | Established two-word secret term; full progressive |
| `deleted_secret.running` | 5 | 25 | गोपनीय जानकारी हटा रहा है | Established two-word secret term; full progressive |
| `listed_projects.running` | 5 | 28 | प्रोजेक्ट सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `updated_project.running` | 5 | 25 | प्रोजेक्ट अपडेट कर रहा है | Operation-specific verb/object retained; full progressive |
| `linked_session_to.running` | 6 | 29 | सत्र प्रोजेक्ट से जोड़ रहा है | Explicit project relation replaces dangling pronoun; full progressive |
| `unlinked_session_from.settled` | 5 | 26 | सत्र प्रोजेक्ट से अलग किया | Explicit project relation replaces dangling pronoun; full progressive |
| `unlinked_session_from.running` | 7 | 31 | सत्र प्रोजेक्ट से अलग कर रहा है | Explicit project relation replaces dangling pronoun; full progressive |
| `updated_milestone.running` | 5 | 25 | माइलस्टोन अपडेट कर रहा है | Operation-specific verb/object retained; full progressive |
| `read_todos.running` | 5 | 21 | कार्य सूची पढ़ रहा है | Two-word object term preserves exact operation; full progressive |
| `updated_todos.running` | 6 | 26 | कार्य सूची अपडेट कर रहा है | Two-word object term preserves exact operation; full progressive |
| `listed_wakes.running` | 5 | 28 | जागृतियाँ सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `cancelled_wake.running` | 5 | 21 | जागृति रद्द कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_jobs.running` | 5 | 24 | जॉब्स सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `cancelled_job.running` | 5 | 18 | जॉब रद्द कर रहा है | Operation-specific verb/object retained; full progressive |
| `checked_network_status.running` | 5 | 26 | नेटवर्क स्थिति जाँच रहा है | Two-word object term preserves exact operation; full progressive |
| `listed_networks.running` | 5 | 26 | नेटवर्क सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_network_peers.running` | 6 | 31 | नेटवर्क पीयर सूचीबद्ध कर रहा है | Two-word object term preserves exact operation; full progressive |
| `read_network_log.running` | 5 | 22 | नेटवर्क लॉग पढ़ रहा है | Two-word object term preserves exact operation; full progressive |
| `diagnosed_network.running` | 6 | 26 | नेटवर्क का निदान कर रहा है | Required relation/operation detail plus full progressive |
| `invited_device.running` | 5 | 25 | डिवाइस आमंत्रित कर रहा है | Operation-specific verb/object retained; full progressive |
| `joined_network.running` | 5 | 22 | नेटवर्क से जुड़ रहा है | Operation-specific verb/object retained; full progressive |
| `left_network.running` | 5 | 22 | नेटवर्क से निकल रहा है | Operation-specific verb/object retained; full progressive |
| `raised_panic.running` | 5 | 22 | पैनिक सक्रिय कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_consoles.running` | 5 | 24 | कंसोल सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `captured_console.running` | 6 | 29 | कंसोल का स्क्रीनशॉट ले रहा है | Required relation/operation detail plus full progressive |
| `typed_in_console.running` | 6 | 24 | कंसोल में टाइप कर रहा है | Required relation/operation detail plus full progressive |
| `resized_console.running` | 6 | 24 | कंसोल का आकार बदल रहा है | Required relation/operation detail plus full progressive |
| `updated_secure_input.running` | 6 | 30 | सुरक्षित इनपुट अपडेट कर रहा है | Two-word object term preserves exact operation; full progressive |
| `closed_console.running` | 5 | 19 | कंसोल बंद कर रहा है | Operation-specific verb/object retained; full progressive |
| `listed_symbols.running` | 5 | 25 | प्रतीक सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `previewed_rename.running` | 6 | 27 | नाम-बदलाव की झलक देख रहा है | Required relation/operation detail plus full progressive |
| `listed_sessions.running` | 5 | 23 | सत्र सूचीबद्ध कर रहा है | Operation-specific verb/object retained; full progressive |
| `spawned_session.running` | 5 | 19 | सत्र शुरू कर रहा है | Operation-specific verb/object retained; full progressive |
| `resumed_session.running` | 6 | 23 | सत्र फिर शुरू कर रहा है | Operation-specific verb/object retained; full progressive |
| `peeked_at_session.running` | 6 | 22 | सत्र की झलक देख रहा है | Required relation/operation detail plus full progressive |

## Glossary proposals

- Codify existing shipped calls for the next glossary maintenance pass: peer → पीयर; variable → वेरिएबल; milestone → माइलस्टोन; secret → गोपनीय जानकारी; console → कंसोल; todos → कार्य सूची; update → अपडेट. These are observed consistency choices, not newly invented alternatives.
- New operation-specific proposal: panic activation → पैनिक सक्रिय करना (security incident operation; tool identifier `panic` stays English when shown as an identifier). No current shipped Hindi पैनिक or आपात usage was found in the catalogue scan.
- Enumeration action → सूचीबद्ध करना, matching shipped errors/sidebar usage. Targeted LSP lookup → ढूँढना; network diagnosis → निदान करना. These are contextual verb choices, not identifier translations.

## Validation actually executed

1. `python3` loaded `keys.json`, `hi.json`, and the written `hi.v2.json`; asserted exact 182-key set/order, nonempty trimmed strings, no English-identical strings (Python exception), no manual bidi/zero-width controls, Latin only Python, and all 91 running forms ending रहा है. **PASS**. Changed keys: 87. Word histogram: `{1: 7, 2: 34, 3: 41, 4: 48, 5: 36, 6: 14, 7: 2}`. Longest string: 34 code points (`described_secret.running`). These are mechanical checks, not a self-audit.
2. From manager worktree: `pnpm check-i18n:catalogues` — **exit 1**. Generator byte-identical; duplicate scan 1,428 files / 0 duplicates; literal scan 1,660 files / 0 at-or-below-baseline literals, 40 allowed data literals. Ledger check then fails with **24 findings across 1,106 rows**: all seven target `ui.chat.canonical` catalogues still lack the 182 new keys, source hashes stale and receipts name old English bytes. This is the actual unintegrated staging state: v2 is outside the served catalogue tree and has no new independent audit receipts. No stale receipt/hash was rewritten to manufacture a pass. Integration and new independent receipts belong to the manager after re-audit.
3. Because the chain short-circuited, ran `node scripts/i18n/context-parity.mjs` separately: **exit 0**, every English key covered except 129 already allowed gaps in 4 namespaces. This check validates the worktree sidecars, not the staging translation.

### Input/output SHA-256

| File | SHA-256 |
|---|---|
| `keys.json` | `b3f3bfe3688d1461a061009e98a58802171eb181343fdb8fcfd0af07652ca419` |
| `hi.json` | `41bcec4ff53bee4f45b37aa630d5b985f80646e6c8d121866efbdf193e3c97d8` |
| `hi.v2.json` | `56791690a9c9ee6b42838775a52c39b4807e8e2fc5d85ac6bf6fdc56bbbe95a6` |
