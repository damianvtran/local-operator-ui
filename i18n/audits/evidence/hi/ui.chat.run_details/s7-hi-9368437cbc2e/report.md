# Hindi independent S7 additions audit — terminal clean

Scope: 29 Hindi additions (7 pages, 16 run-details, 6 notices) at `aba5d0310761cedc384c35847498d4197ce4b107` against `0ad5542379a349a98e0a8d602dbd992746fd40a2`. Spanish-only follow-on at aba5 does not change Hindi. No catalogue, ledger, allowance or generated file edited. This is a bounded translation-source audit, not a rendered-UI/design sign-off.

Auditor: reviewer, session `9368437cbc2e`, actual served model `openai/gpt-6.1-sol`. Harness announced Sonnet → Opus → GPT fallback because of provider quota; substantive audit executed on GPT.

## Derived execution evidence

`checks.json` records actual output from a serial Node 768-MiB-capped probe using repository-installed `@formatjs/icu-messageformat-parser` and `intl-messageformat`. 29 English/target AST contracts equal, including names, number skeletons, plural arms and branch-local arguments. 116 hi format calls succeeded (0/1/2/1000 for each key). Literal `$'{'NAME'}'` and `::group-off` occurrence bytes/counts match English; rendered literal `${NAME}` and ungrouped 1000 verified. Placeholder-rename and removed-skeleton negative controls detected. Six source/target catalogue SHA-256s match committed head. No manual bidi controls, unchanged English values, or unexplained Latin tokens found. Remaining Latin words are ICU arguments/syntax, Aida, MCP, OAuth and NAME.

## Linguistic inspection (audit notes, not execution logs)

### ui.agents.pages

All seven additions inspected against their English values. Connecting/loading/unreachable statuses remain terse. Reusable agents is paraphrased as बार-बार इस्तेमाल होने वाले एजेंटों without changing the feature meaning.

loading_capabilities: इस modifies बैकएंड in the singular oblique because the noun is followed by की. Hindi इस is singular oblique for both genders; it is not a masculine-only form. की agrees with feminine क्षमताएँ, not with बैकएंड. क्षमताएँ is feminine plural, so रही हैं is correct. Connecting uses masculine singular रहा है for बैकएंड. नया बैकएंड and नए-agent semantics are preserved.

Existing terminology: बैकएंड matches ui.chat.run_details.update_backend and children_unopenable, एजेंट/टीम match existing pages values. No untranslated prose or inappropriate register.

### ui.chat.run_details

All sixteen additions inspected against the English source. Result/preview, brief expansion, secure key entry, server auth method/status, serial sign-in, refusal and session restart semantics retained. Technical recovery steps remain explicit.

unavailable_clipped: यह एक संक्षिप्त प्रति है is correct. यह is direct singular for either noun gender; प्रति is feminine singular and संक्षिप्त is indeclinable. No feminine spelling change to यह or संक्षिप्त is required.

unavailable_clipped and unavailable: इस उप-एजेंट की बातचीत is correct: इस is singular oblique before the genitive; की agrees with feminine बातचीत. उपलब्ध नहीं है has singular subject बातचीत.

no_references: यह सर्वर is masculine direct singular; करता agrees with सर्वर. इसमें refers to the same server; इसके MCP एनवायरनमेंट या हेडर uses masculine oblique/plural के for the coordinated environment/headers. Declared references are संदर्भ, masculine plural, hence घोषित नहीं हैं. कोई is valid with the negative plural.

unknown_method: इस सर्वर के साइन इन का तरीका uses singular oblique इस सर्वर, genitive के before the nested oblique sign-in phrase and का agreeing with masculine तरीका. इसका कनेक्शन also agrees with masculine कनेक्शन.

busy: इस बातचीत के लिए is feminine singular in an oblique postpositional construction; इस is correct for feminine as well as masculine. Subsequent इसके पूरा होने and इसे refer to the sign-in process, not feminine बातचीत. सर्वर की पंक्ति is feminine agreement. Only one sign-in at a time remains clear.

session: इस बातचीत का सत्र uses इस with singular oblique बातचीत and masculine का agreeing with सत्र. नहीं चल रहा है and शुरू होता है agree with masculine सत्र. यही अनुरोध and दोहराया जाता है agree with masculine अनुरोध. No missed gender/number mismatch in the full demonstrative/pronominal neighborhood.

refused: इसे refers to the request; अस्वीकार कर दिया and कोई बदलाव नहीं हुआ preserve refusal/no-mutation semantics.

show_more: ICU one/other structure and both number skeletons are unchanged. Hindi one includes 0/1: पंक्ति दिखाएँ is appropriate; other uses पंक्तियाँ दिखाएँ. Actual IntlMessageFormat results at 0,1,2,1000 are recorded.

Terminology aligns with existing subagent_path_label/reader.* (उप-एजेंट, बातचीत, सत्र), mcp_auth.title/no_session and mcp.grant.* (सर्वर, साइन इन), update_backend (बैकएंड), and mcp_key.saved_note (सीक्रेट). Common technical loans एनवायरनमेंट/हेडर/कनेक्शन are consistent with the standard-Hindi style allowance for settled technical loans. MCP, OAuth and NAME are technical identifiers, not English prose residue.

### ui.notices

All six additions inspected against English. Notices are short receipts/statuses and preserve pause-until-resume, normal schedule after resume, account prerequisite, and new-chat fallback with detail.

Aida is feminine in the English she/her source. रुकी हुई है, पूछेगी, शुरू हो गई है and करेगी correctly agree with Aida (including its user-chosen {name}); सक्रिय is an indeclinable adjective. No need to masculinize Aida because it is an agent.

open_fallback: {name} की बातचीत नहीं खोली जा सकी uses feminine agreement with बातचीत, not with the person name; उसकी जगह refers to the displaced conversation. नई चैट खुली है is feminine singular throughout. {name} and {detail} are preserved.

शेड्यूल matches existing wake.managed_note. बैकएंड elsewhere in notices and run-details remains consistent. Aida is an intentional product name; एआई, खाता and चैट are translated/settled terms. No English prose or manual bidi controls.

## Review posting limitation

Three actual `gh pr view 1809 --repo damianvtran/local-operator-ui --json headRefOid` calls during this audit returned pushed head `31710e01b6b6e1e0aae6ed56d5e4467de6611740`, not requested local aba5. Parent notified via hub. No aba5-scoped PR comment posted on an unpushed head. The receipt/evidence bind the requested local aba5 and their exact en/hi bytes; the Hindi files are byte-identical across 31710..aba5.

Verdict: **clean**, terminal; blocker/major/minor/nit arrays all empty. No remediation requested. No browser was provided; no screenshot/rendered UI claim made.

Final pushed-head check: `gh pr view 1809 --repo damianvtran/local-operator-ui --json headRefOid` returned `aba5d0310761cedc384c35847498d4197ce4b107`. Evidence was computed at that exact local head.
