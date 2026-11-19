# Audit report — fr, ui.chat.approval (PR #1881, head 8efa3b0ff5)

Auditor: reviewer, session ac1d33b102dd, model anthropic/claude-sonnet-5-5 (no fallback).
Did not write these files; had not audited this locale before. Receipt: `receipt-fr.json`, instance `pr1881-fr-459652a5`.

## Verdict: clean (TERMINAL) — 0 BLOCKER, 0 MAJOR, 0 MINOR, 0 NIT

## New key `ui.chat.approval.escape.bridge_latched`

- EN: `Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.`
- FR: `« Allow all » et le mode auto sont désactivés dans cette conversation. Pour activer le mode auto, tapez /approvals auto dans le terminal, ou utilisez /new pour démarrer une nouvelle conversation.`
- Back-translation: "'Allow all' and auto mode are disabled in this conversation. To enable auto mode, type /approvals auto in the terminal, or use /new to start a new conversation."

Checks:
- **Meaning.** Matches the English sentence for sentence: two sentences, both off, the same remedy (`/approvals auto` in the terminal) and the same alternative (`/new`). "désactivés" is the right sense of "off" (a state, not an error). The "allow all" option is not made to sound available.
- **Commands.** `/approvals auto` and `/new` are verbatim, and the glossary says `/approvals` stays. The context note says to keep both exactly.
- **"Allow all".** Left in English inside « » on purpose. It is the TUI's own English label (`local_operator/tui/widgets/approval.py`: `("A", "answer('a')", "Allow all")`), so the user can find that exact label. The English source also uses it as a name.
- **Idiom and register.** Natural French, `tapez` and `utilisez` are vous-imperatives with no "Veuillez", as style-guide fr.md requires. "démarrer une nouvelle conversation" is idiomatic for "a fresh conversation". The sentence is not a literal copy.
- **Typography.** Bytes parsed: `«` U+00AB, `»` U+00BB, and U+202F (narrow no-break space) inside both guillemets, per French typography. Other non-ASCII: three U+00E9 only. No bidi or control characters.
- **Placeholders/ICU.** None, as in English; the context sidecar says `placeholders: {}`.
- **Terminology.** "conversation" matches the namespace; "mode auto" is how fr already speaks of the mode (`set_session`: "Activer Auto…", `mode.auto`: "Auto"). Lowercase "auto" mirrors the English sentence, so it is not a defect.
- **Byte-identity with core.** `git show origin/main:local_operator/i18n/catalogues/fr/wire.bridge_taint.json` (local-operator 330e43b93f), key `wire.bridge_taint.card_options_off`: equal to the UI value by string and by UTF-8 bytes (python check printed True/True).

## Rest of the namespace

- Parsed: en 18 keys, fr 18 keys, same key set; no duplicate keys; context sidecar covers the same 18 keys.
- ICU placeholders (`{mode}`, `{detail}`, `{globalMode}`) identical per key: 0 mismatches.
- `git diff 5033f64235..8efa3b0ff5 -- src/i18n/catalogues/fr/ui.chat.approval.json` shows exactly one added line (the new key). All 17 prior values are byte-equal to the base (`5033f64235` is the merge-base). Those 17 keys carry their previous audit (ledger instance `564797e3-s3c-fr`, clean-with-findings); they were not re-judged.
- Worktree was clean; the file's git blob (8e4cb0a37b) is the committed one.

## Hashes at the pinned head (`shasum -a 256`)

- en `815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f`
- fr `ef0e242dca891b7739fd81a46d6fce5c5791aec3508e5dfa954564281fa55ca2`
- context `9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f`

## Limits

- The core file's own audit is out of scope here, as the task said.
- Core was read at origin/main 330e43b93f, not at the commit the UI branch was cut from.
- I did not run `ledger-assemble.mjs` or `ledger-check`; the receipt shape follows `ebc5b152-s3c-es.json` and the header contract.
