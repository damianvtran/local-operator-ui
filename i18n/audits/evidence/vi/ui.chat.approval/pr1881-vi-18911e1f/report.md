# vi audit — PR #1881, ui.chat.approval (pinned head 8efa3b0ff5bb)

Auditor: reviewer, session 7be2ff8560d4, model anthropic/claude-sonnet-5-5 (no fallback). Did not write the files. Instance: pr1881-vi-18911e1f.

## New key: ui.chat.approval.escape.bridge_latched

- en: "Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation."
- vi: "“Allow all” và auto đã tắt trong cuộc trò chuyện này. Để bật auto, hãy gõ /approvals auto trong terminal, hoặc dùng /new để bắt đầu cuộc trò chuyện mới."
- Back-translation: "“Allow all” and auto are turned off in this conversation. To turn on auto, please type /approvals auto in the terminal, or use /new to start a new conversation."

Meaning matches: both things off, scope is this conversation, two ways out (typed command, or a fresh conversation). Nothing is softened or dropped on this safety sentence. `/approvals auto` and `/new` are verbatim.
Idiom: natural Vietnamese ("đã tắt", "hãy gõ", "để bắt đầu … mới"); pronoun dropped as the style guide asks; no "!", sentence case, curly quotes “ ” per the style guide. "terminal" is kept English, as elsewhere in the vi catalogue. "cuộc trò chuyện" matches the catalogue's conversation term.
Placeholders/ICU: none in en or vi. Characters: NFC; no bidi/control characters in any value except “ ” and — (typography, not bidi controls).

## Byte-identity to core
vi value == core `wire.bridge_taint.card_options_off` in local_operator/i18n/catalogues/vi/wire.bridge_taint.json at origin/main 330e43b93f: verified True by Python equality after parsing both files. Core English for that key is the same sentence as the UI English (no quotes in en; vi adds “ ” around the button name).

## Rest of the namespace
- Key set: 18 en = 18 vi, sets equal; no duplicate keys in either file.
- Placeholder sets ({mode}, {detail}, {globalMode}) equal per key; no ICU plural arms.
- `git diff 5033f64235..8efa3b0ff5 -- vi/ui.chat.approval.json` shows exactly one added line (the new key); the other 17 keys carry their previous audit.
- Sidecar: new key's note says to keep /approvals auto and /new verbatim; vi complies.

## Findings (1 MINOR, 0 NIT, 0 BLOCKER, 0 MAJOR)
- MINOR: the sentence uses lowercase English "auto", while the same card labels the mode "Tự động" (ui.chat.approval.mode.auto). "auto" is defensible (argument of the typed command; core wire.bridge_taint.* also uses "auto"), so no change is required while the string stays byte-identical to core. Worth a joint core+UI wording pass later.

## sha256 at pinned head
- en/ui.chat.approval.json 815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f
- vi/ui.chat.approval.json 9c2f68a256b6e49c94320b721f4e6d75e31894228580eb1278d2adf077503623
- en/ui.chat.approval.context.json 9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f

## Verdict: clean-with-findings (status passed). No blocker or major; this round is TERMINAL for vi.
