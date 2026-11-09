# Audit hi-upload-0a2d35091c2c — hi / ui.agents.upload (branch delta, 15 keys)

Auditor: i18n-auditor, session `0a2d35091c2c`, served model **deepseek/deepseek-flash** (provider fallback: primary `anthropic/claude-sonnet-5-5` failed on quota, then `anthropic/claude-opus-5-5`, then `openai/gpt-6.1-sol`; the whole audit ran on the third fallback — disclosed, not a preference). Independent of the translator. Head `2b72db6a56a` on `i18n/slice-upload-agent-dialog`, base `b915083bd96` (origin/main merge-base `3378319980f`).

**Verdict: passed — 0 BLOCKER, 0 MAJOR, 1 MINOR, 1 NIT.** Nothing in this delta blocks; both findings are consistency/wording and are non-gating.

Read first: the 31 pre-existing hi values of the same file (register, idiom, quotes, danda), the 15 English sources and the namespace sidecar, the hi style guide and glossary (both at `~/local-operator` `b42471d3935`), and the hi siblings that state the same propositions outside this file (`ui.agents.publication.*`, `ui.hub.pages.empty.org.body`, `ui.hub.teams.org.empty`, `ui.hub.subscriptions.enable_private`, `ui.settings.shortcuts.reserved.*`).

## Mechanical (executed)

- JSON valid; hi key set **== en key set** (46 keys, 0 missing, 0 extra); **15 added, 0 removed** vs `b915083bd96` (31 pre-existing) — matches the brief's counts exactly.
- Placeholders: 15/15 added keys carry exactly the English `{name}`/`{destination}`/`{org}` set; 0 mismatches across all 46 keys.
- ICU: all 46 values parse under `@formatjs/icu-messageformat-parser`. `target.blocked_hint` keeps `one`/`other` only with the same option keys and the same nested `{org}` branch shape as English; rendered through `intl-messageformat` at counts 0/1/2/5, `one` covers 0 and 1 as the hi style guide records, and the `0` branch is unreachable because the call site gates on `blockedTargets.length > 0` (`upload-agent-dialog.tsx:1039`).
- Unicode: no non-NFC value, no Cf/Cc, no double or edge spaces.
- Collateral: `node scripts/i18n/generate.mjs --check` byte-identical; `node --test scripts/i18n/catalogue-locale.test.mjs scripts/i18n/catalogue-duplicates.test.mjs` 11/11 pass.

## The brief's specific questions

**Name-subject re-voicing.** The English passives ("The hub reserves \"{name}\" … / … this name …") become name-subject sentences: `"“{name}” हब के किसी एक बिल्ट-इन एजेंट के लिए आरक्षित है।"` and `"यह नाम हब के किसी एक बिल्ट-इन एजेंट के लिए आरक्षित है।"`. That matches the siblings in the group (`availability.taken` "यह नाम हब पर पहले से प्रकाशित है।", `availability.free` "यह नाम उपलब्ध लगता है।") and the shipped hi of the same proposition in `ui.agents.publication.name_reserved_builtin.body`. The proposition is intact — "the hub" survives as the possessive **हब के**, the reservation target and the "one of its built-in agents" quantifier are both kept, and the two keys differ only in subject, as English does. No finding.

**Demonstrative agreement — one real divergence.** See M1: the same substituted `{destination}` is rendered with two different demonstratives inside one dialog.

**Terminology.** बिल्ट-इन is the shipped form (7 corpus occurrences) and is used identically. लिस्टिंग takes feminine agreement where a participle is involved: `receipt.title_updated` "लिस्टिंग अपडेट की गई", matching the pre-existing `title.republished`; the imperative keys have no participle so no agreement question arises.

**English residue.** Only the kept-Latin **Team** (product-plan name; this key's first sentence reproduces the shipped `ui.agents.publication.team_plan_required.body` verbatim) and **Radient** (brand), plus placeholders. No stray English.

**Register.** आप throughout; polite imperative `करें`; danda for stops; "…" for the progress label; “ ” quotes; nukta kept (एक्ज़ीक्यूशन, कॉन्फ़िगरेशन); ASCII ":" lead-in is corpus-normal (50 hi values end in ":") and mirrors the English source.

## Findings

- **HIU-R1-M1 (MINOR, non-gating)** — `not_leaving.org` uses **इसके बाहर** and `published.org_listed` uses **इसके सदस्य** for `{destination}`, while `intro.org` uses **उसके सदस्य** and `target.visibility_hint_public` uses **उसके सदस्य** for the same referent. `intro.org` (`upload-agent-dialog.tsx:949`) and `not_leaving.org` (`:961`) are two stacked `<p>` of one dialog body that receive the identical `destination: targetDisplayName`, so a reader sees the same organization as उसके and then as इसके a few lines apart. Corpus: "उसके बाहर" is the shipped idiom (3×, `ui.settings.shortcuts.reserved.*`), "इसके बाहर" occurs nowhere else; for an organization named in the same sentence the corpus is likewise distal — `ui.hub.teams.org.empty` "{org} के साथ साझा की गई टीमें यहाँ **उसके** सदस्यों को दिखती हैं।" and `ui.hub.pages.empty.org.body` "{org} में प्रकाशित एजेंट यहाँ **उसके** सदस्यों को दिखते हैं।" Suggested: **उसके बाहर** in `not_leaving.org` and **उसके सदस्य** in `published.org_listed`, i.e. one demonstrative for one referent.
- **HIU-R1-N1 (NIT, non-gating)** — `intro.org` and `target.visibility_hint_public` double the exclusive: "**केवल** उसके सदस्य **ही**". Grammatical, but a precise scan (केवल followed by the word ही) finds only these two values in the whole hi corpus; the established idiom is सिर्फ़ … ही (4×, closest analogue `ui.hub.subscriptions.enable_private` "… सिर्फ़ उस संगठन तक पहुँच की अनुमति वाले लोग ही उन्हें पा सकते हैं।") or केवल alone (केवल पढ़ने के लिए, केवल तब). Either सिर्फ़ … ही, or drop one marker.

## Rendered evidence (same `destination` value through the real formatter)

```
[intro.org]        … निर्देश-सेट Acme Corp में प्रकाशित करने वाले हैं, जहाँ केवल उसके सदस्य ही इसे पढ़ …
[not_leaving.org]  … Acme Corp के सदस्य जो आप प्रकाशित करते हैं उसे पढ़ …; इसके बाहर कोई भी नहीं कर सकता।
[published.org_listed]  "{name}" Acme Corp के साझा एजेंटों में … मौजूद है। इसके सदस्य इसे पढ़ …
[visibility_hint_public]  संगठन के एजेंट केवल उसके सदस्य ही पढ़ सकते हैं।
```

Not audited: the other six locales, the 31 pre-existing values (read only for comparison), rendered fit in the live dialog, in-app runtime ICU.
