# zh-CN audit — ui.chat.approval, PR #1881 (head 8efa3b0ff5)

Auditor: reviewer session 1b02bddb11bc, model anthropic/claude-sonnet-5-5 (no fallback). Did not write the file. Instance `pr1881-zh-cn-4e007bc9`.

## New key
`ui.chat.approval.escape.bridge_latched`

- EN: Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.
- zh-CN: 此对话中已关闭“Allow all”和auto。要开启auto，请在终端中输入/approvals auto，或使用/new开始新对话。
- Back-translation: "In this conversation, 'Allow all' and auto have been turned off. To turn auto on, enter /approvals auto in the terminal, or use /new to start a new conversation."

## Checks
- Meaning: matches the English exactly, including both commands. The sidecar asks for two short plain sentences each ending with a full stop: yes (two sentences, 。).
- Commands `/approvals auto` and `/new` verbatim, half-width, untranslated: yes.
- Style guide (core i18n/style-guides/zh-CN.md): full-width ，。; curly quotes “ ” (mainland convention); no space between CJK and Latin runs; no 您, no particles, no ！; terms 会话 not needed, 对话 used for "conversation" (same as neighbours `此对话已设为自动`). Conforms.
- Placeholders/ICU: none in either; parsed placeholder sets equal for all 18 keys.
- Direction: zh-CN is ltr in i18n/languages.json; no RTL concerns. No bidi control characters; the only non-CJK-ideograph code points above U+2000 are U+201C/U+201D, U+3002, U+FF0C.
- Byte-identity to core: the string equals `wire.bridge_taint.card_options_off` in local-operator origin/main (330e43b93fd6) `zh-CN/wire.bridge_taint.json`, compared as UTF-8 bytes (True, 132 bytes). Core's English for that key equals the UI English.
- Namespace: 18 keys in both en and zh-CN, same set, no duplicate keys, placeholders identical per key. Versus 5033f64235 the zh-CN file diff is exactly one added line; the 17 other keys are byte-unchanged and carry their previous audit.

## Findings
- MINOR (1): the sentence names the mode as Latin "auto", while the same card uses 自动 (`mode.auto`, `set_session`, `set_all`). Not a defect, since `/approvals auto` is a literal argument and the text matches core byte-for-byte. No change requested.

## Hashes (shasum -a 256, at the pinned head)
- en/ui.chat.approval.json 815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f
- zh-CN/ui.chat.approval.json 07b2d6891d821dd6164b9f45aa39ebf67de0519e63cf7c3dc63b38b053f8c9ca
- en/ui.chat.approval.context.json 9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f

## Verdict
clean-with-findings (0 blocker, 0 major, 1 minor, 0 nit). TERMINAL for this locale.
