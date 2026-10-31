# hi audit — ui.agents.descriptions + ui.agents.detail.install

- Instance: `5f1c69790d92-agents-hi`
- Locale: `hi` · Date: 2026-10-30
- Auditor: i18n-auditor, session `5f1c69790d92`, model `radient/auto`
  (harness fallback chain from `anthropic/claude-sonnet-5-5`: quota → `openai/gpt-6-astra` → `kimi/k3.1-pro` → `radient/auto`)
- Translator lane: session `bfeac33a273e`, model `radient/auto` (read from its own log; not observed live)
- **Independence disclosure:** translator and auditor ended on the same underlying model through the same quota fallback. Independence here is by agent and session, not by model. Stated, not glossed.
- Verdict: **PASS** — 0 BLOCKER, 0 MAJOR, 4 MINOR, 4 NIT

## Inputs audited (sha256)

| role | path | sha256 |
|---|---|---|
| en | `src/i18n/catalogues/en/ui.agents.descriptions.json` | `ec18513f0ebaa99be4c329a8ea5896631fd2b9e4f4d53febdc5c7acd049b5511` |
| en | `src/i18n/catalogues/en/ui.agents.detail.install.json` | `964c83098370d82d74df8c21d6f1f69e74a76f4ea73b3af7bc16ac06981fbcf0` |
| en ctx | `…descriptions.context.json` | `6311128dc89d50d886f3066f9cea2c802482a7db9979d9c5cc4bd93cdd8a7398` |
| en ctx | `…detail.install.context.json` | `f82578e4390f18d396fa229286d5395492618bd93ccbfa43d8d0dbe5a6530307` |
| hi (shipping bytes) | `ui.agents.descriptions.json` | `16aaf542b53ebe7c1b9941c287cccaa3b692f4880b928044413acb84b3c53eb4` |
| hi (shipping bytes) | `ui.agents.detail.install.json` | `6720bcf334c63b5e7444d01c28963fd70775893da987d959880018a89a0a64c7` |

The scratchpad English exports I read are value-identical to the committed catalogues
(verified by JSON equality) but differ in indentation, so their byte hashes differ; the
ledger comparison must use the committed English bytes above.

## Mechanical (run, not assumed)

- `node --test scripts/i18n/locale-parity.test.mjs` — baseline 44/44 pass; with the two
  shipping files copied verbatim into `src/i18n/catalogues/hi/` → 44/44 pass, including the
  hi cases: ships at least one message · defines each key in at most one namespace file ·
  carries EVERY key of each namespace file it ships · names only keys the English source
  defines · preserves every ICU placeholder · is not an English stub. Copies removed
  afterwards; `git status` clean.
- 14/14 values: NFC round-trip clean · no BOM · no ZWSP/ZWNJ/ZWJ · no NBSP or double
  spaces · no stray whitespace · every description ends in danda `।` with no space before
  it · `installing` ends in U+2026, not three dots · key set and order identical to English
  · valid JSON, tab-indented, trailing newline, matching repository catalogue style.
- No ICU arguments, plurals or selects exist in these 14 English values, so CLDR category
  coverage is not exercisable here — declared n/a, not silently skipped.
- Kept-Latin tokens intact: `AI`, `UX`, `QA`, `diff`, `MR`, `PR`, `unicode`, and the
  `C-`/`D-`/`T-`/`U-` finding prefixes. None translated or transliterated.
- Width (`cell_len`, combining marks counted zero): descriptions 0.81×–1.16× of English
  (max `ux_reviewer` 1.16×, then `reviewer` 1.15×) — no description is materially longer
  than its source. `install_to_edit` 1.67× (25 vs 15 cells), `installing` 1.55× (17 vs 11).
- No rendered frame was captured in this audit. Overflow, 256 px wrapping and the header
  row are the design pass's evidence, not claimed here.

## Findings

### H1 · MINOR · accuracy/terminology · `ui.agents.descriptions.librarian`
`लाइब्रेरी का व्यवस्थापक एजेंट: …` — "organizing agent" becomes *administrator/manager*, a
different function from organising the catalogue, and the same roster lists a Manager agent,
so the two roles read closer than the source makes them.
→ `लाइब्रेरी को व्यवस्थित करने वाला एजेंट: …` (or `लाइब्रेरी का संयोजक एजेंट`), rest unchanged.

### H2 · MINOR · accuracy · `ui.agents.descriptions.copy_reviewer`
`…और AI जैसी बनावटी बातें` — "AI-isms" are AI-flavoured writing tells; the Hindi says
"AI-like artificial things", dropping the writing object, while every other criterion in
that list is a property of the text.
→ `…और AI जैसी बनावटी भाषा` (or `…और AI की पहचान देने वाली घिसी-पिटी बातें`).

### H3 · MINOR · orthography · `ui.agents.descriptions.reviewer`
`खामियाँ ढूँढता है` — ड़ carries no nukta; the hi style guide binds nukta as spelling.
The catalogue's only other use, `ui.teamBridge.create.channel_description` (`ढूँढकर`), has
the same defect, so a fix should cover both.
→ `खामियाँ ढूँढ़ता है` — or the everyday `खामियाँ खोजता है`, which sidesteps the orthography.

### H4 · MINOR · fit · `ui.agents.detail.install.action.install_to_edit`
`संपादन के लिए इंस्टॉल करें` — 25 cells vs 15 (1.67×; 26 vs 15 characters). Not an observed
overflow: the label shares a `shrink-0` header row with `नई चैट` and the key has no
`maxCells` hint. The pending label is *shorter* than this one, so the button does not grow
when the install starts.
→ Keep if the header tolerates it; `संपादन हेतु इंस्टॉल करें` (23 cells) is the lever if it
does not. Confirm on a rendered frame in the design round.

### H5 · NIT · clarity · `ui.agents.descriptions.aida`
`आपकी ओर से एजेंट और टीमें चलाती हैं` — the object has no `को`, so the clause can be read
with `एजेंट और टीमें` as subject ("agents and teams run on your behalf"). The following
clauses resolve it, but a card is read at a glance.
→ `आपकी ओर से एजेंटों और टीमों को चलाती हैं`.

### H6 · NIT · idiom · `ui.agents.descriptions.designer`
`स्रोत के बजाय रेंडर किए गए फ़्रेम से` — the English verb ("judged") has no Hindi
counterpart, so the comparison hangs off the noun phrase and `फ़्रेम से` is a thin instrument.
→ `स्रोत के बजाय रेंडर किए गए फ़्रेम के आधार पर`.

### H7 · NIT · accuracy · `ui.agents.descriptions.tui_designer`
`कीबोर्ड से चलने वाले फ़्लो` — flattens "keyboard-first" to "keyboard-driven"; the priority
claim (the keyboard decides the design) is lost.
→ `कीबोर्ड-प्रधान फ़्लो`.

### H8 · NIT · register · `ui.agents.descriptions.aida`
`चलाती हैं … नज़र रखती हैं … बताती हैं` — honorific plural, while every other agent in the
same list is plain singular (`करता है`). Reads as deliberate persona warmth (the sidecar asks
for a warm register) but is a register split inside one roster.
→ No change required if deliberate; align to `चलाती है … रखती है … बताती है` if the roster
should read uniformly.

## Checked and accepted (no finding)

- `लाइब्रेरी` for the Library surface matches `ui.library.*` and
  `ui.chat.directory.folder.library`.
- `मुद्दे` for "findings" and `समीक्षा` for review match `ui.code_review.*`.
- `कार्यक्षेत्र`, `एजेंट`, `टीम`, `ऑपरेटर` follow `i18n/glossary.md` §2 and the existing
  hi corpus (`ui.projects`, `ui.mesh`).
- `इंस्टॉल` matches `ui.common.updates.*` and `ui.agents.detail.alert.builtin_body`, so the
  button and the alert above it agree.
- Transliterated technical loans (`कोडबेस`, `टूलसेट`, `व्यूपोर्ट`, `रिग`, `डिज़ाइन`,
  `कैटलॉग`, `फ़्रेम`) follow the hi guide's loan policy (टोकन/डिवाइस precedent). `रिग` is
  opaque, but the English "rig" is equally opaque to a source reader: the opacity is
  inherited from the source, not introduced — accepted, not a finding.
- Negations survive where the claim depends on them: architect "never modifies", reviewer
  "never edits the code it reviews", qa_tester "without editing the repository", scout
  "changes nothing".
- No value is identical to its English source.

## Second pass

The 14 values were re-read once after the first pass, focused on claim survival, negation
and at-a-glance reading. That pass produced H5 and confirmed H1–H4; no BLOCKER or MAJOR was
withdrawn, and none was found.

## Handoff

- Ledger result derived from these counts: `clean-with-findings`
  (0 blocker, 0 major, 4 minor, 4 nit).
- `node scripts/i18n/ledger-assemble.mjs --locale hi --file <catalogue>
  --auditor-instance 5f1c69790d92-agents-hi --auditor-model radient/auto
  --result clean-with-findings --receipt <this receipt>`
  (`--translator-agent` / `--translator-model` are required for a new row).
- The ledger gate requires the receipt at repo-relative `i18n/receipts/<instance>.json`;
  copy `receipt.json` there byte-for-byte so `receipt_sha256` matches.

## Delivered files

| file | what it is |
|---|---|
| `receipt.json` | the audit receipt; ledger-loadable (verified with `ledger-assemble.mjs` + `checkLedger`) |
| `verdict.txt` | `PASS` plus the one-line reason |
| `findings.md` | this report |
| `record.ui.agents.descriptions.json`, `record.ui.agents.detail.install.json` | the canonical evidence records, ready to copy to `i18n/audits/evidence/hi/<namespace>/agentsblurbs-20261030-5f1c697/record.json` |
| `ledger-rows.json` | the two ledger rows as `scripts/i18n/ledger-assemble.mjs` produced them, with the canonical notes |
| `auditor.log` | the harness-captured console log of THIS audit run (written by the runtime, not by me); hash it at commit time since it keeps growing until the session ends |

The auditor wrote no repository file. The untracked `es/` evidence and `i18n/receipts/831557fc5ffe-agents-es.json`
in the checkout belong to the parallel Spanish lane, not to this audit.
