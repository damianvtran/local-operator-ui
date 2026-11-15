# ru audit — PR #1881, ui.chat.approval.escape.bridge_latched

Auditor: reviewer (session dd688a5a4b25), model anthropic/claude-sonnet-5-5, no fallback. Instance `pr1881-ru-5fe57626`. Head `8efa3b0ff5bb6aec505c559b9e3518d75a6a240b`. Independent: did not write these files.

## The new key

EN: `Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.`

RU: `В этой беседе «Allow all» и auto отключены. Чтобы включить auto, введите /approvals auto в терминале или используйте /new, чтобы начать новую беседу.`

Back-translation: "In this conversation 'Allow all' and auto are disabled. To enable auto, enter /approvals auto in the terminal, or use /new to start a new conversation."

- Meaning matches the English exactly: both things are off (plural «отключены» agrees with the two subjects); the way back is the typed command or a fresh conversation. Two sentences, each ending with a full stop, as the sidecar asks.
- `/approvals auto` and `/new` are byte-identical Latin tokens (parsed: both present verbatim).
- Style guide: «вы» imperative (введите, используйте), no «Пожалуйста», no "!", «ёлочки» quotes, sentence case, «терминал» is the settled word. «Одобрения» is not needed here: the sentence does not name the feature.
- No placeholders or ICU in EN or RU (verified by regex); no format/bidi/control characters (Unicode category Cf/Cc scan: none). 149 characters.

## Checks by parsing
- Key set: EN 18 = RU 18 = context sidecar 18, same order, no duplicate keys.
- Placeholders per key: identical in all 18 keys.
- `git diff 5033f64235..8efa3b0ff5 -- ru/ui.chat.approval.json`: exactly one added line (1 insertion, 0 deletions), the new key. The other 17 keys are unchanged and carry their previous audit.
- Byte-identity to core: the ru value of `wire.bridge_taint.card_options_off` in local-operator origin/main equals the PR's value byte for byte; the core English value equals the PR's English value too. This audit does not re-audit the core file.

## Findings (2 MINOR, 0 NIT, 0 BLOCKER/MAJOR)
1. MINOR: «беседа» in the new key vs «разговор» in sibling keys of the same namespace (default_saved). Core uses «беседа»; the UI catalogue uses «разговор». Fixing it would break byte-identity with core, so it needs a core + UI change together. Not blocking.
2. MINOR: the mode name in "«Allow all» и auto отключены" is lowercase Latin, while sibling keys render the mode as «Авто». The second `auto` (argument of `/approvals auto`) must stay Latin and is correct; «Allow all» is a TUI label kept Latin per core. Not blocking.

## Verdict
clean-with-findings. No BLOCKER and no MAJOR: this locale's round is TERMINAL; the two minors are follow-ups.

sha256 (pinned head): en `815a4ff3…8ec8f`, ru `c81bc2f348323e0b6e69ae72ea417596a48c764e3fd5127e20ae1e49eac60145`, context `9ee5d134…bb2f`. Full values are in the receipt.
