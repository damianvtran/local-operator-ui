# ur audit — ui.chat.approval, PR #1881 @ 8efa3b0ff5bb (2026-11-12)

Auditor: reviewer session 7612fe555964, model anthropic/claude-sonnet-5-5 (no fallback), instance `pr1881-ur-bbac41af`. Independent: did not write or previously audit these files.

**Verdict: clean-with-findings (0 BLOCKER, 0 MAJOR, 2 MINOR, 0 NIT). Round is TERMINAL for ur.**

## The new key

Source (en, equals core `wire.bridge_taint.card_options_off`):
> Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.

Target (ur, byte-identical to core ur):
> اس گفتگو میں “Allow all” اور auto بند ہیں۔ auto آن کرنے کے لیے ٹرمینل میں /approvals auto ٹائپ کریں، یا نئی گفتگو کے لیے /new استعمال کریں۔

Back-translation: "In this conversation “Allow all” and auto are off. To turn auto on, type /approvals auto in the terminal, or use /new for a new conversation."

- Meaning: exact, two sentences, same order. The plural verb «ہیں» agrees with the two subjects. «نئی گفتگو» = "fresh conversation". It does not weaken the safety meaning: both switches are off, and the only routes back are the two named commands.
- Idiom/register (style guide ur.md): respectful imperatives «ٹائپ کریں / استعمال کریں», no Hindi vocabulary, «گفتگو» matches the namespace, «ٹرمینل» is a settled loanword, Urdu quotes “ ” and «۔». «Allow all» stays Latin like a verbatim UI label (style guide: labels stay English); `/approvals auto` and `/new` are verbatim.
- ICU/placeholders: none, none needed.
- RTL bytes: 0 bidi/format characters (parsed), scripts Arabic+Latin only, 0 ASCII full stops.
- Bare bidi (FriBidi 1.0.16 `--rtl`): the two commands paint `approvals auto/` and `new/`. The style guide forbids a text-level fix. The runtime seam `src/i18n/bidi.ts isolateSigils` (run for real) fixes `/new`; `/approvals auto` ends up as two chunks, painted `auto /approvals` left-to-right (correct when read right-to-left). See finding 1.

## Rest of the namespace

- 18 keys in en = ur = context sidecar, same order, 0 duplicate lines; per-key ICU argument sets equal en (0 mismatches).
- `git diff 5033f64235..8efa3b0ff5` on the ur file is +1/−0 (the new key only). The other 17 keys are unchanged and CARRY their previous audit (not re-audited).
- Byte-identity to core verified by reading `local_operator/i18n/catalogues/ur/wire.bridge_taint.json` at origin/main 330e43b93fd6 (Buffer.equals true; en value also equals core en).
- `node --test scripts/i18n/ur-activation.test.mjs`: 3/3 pass.

## Findings

1. MINOR (render, not wording) — `/approvals auto` is isolated by `isolateSigils` only up to `/approvals`; `auto` sits outside, so it paints `auto /approvals` visually. Same as shipped `/mcp reauth` in ui.chat.pickers. No change to the string (forbidden by the style guide, and byte-identity). Optional fix: extend `isolateSigils` to take the following argument word.
2. MINOR (terminology) — Latin `auto` in prose here vs «خودکار» in the sibling keys of this card (`mode.auto`, `set_session`, `set_all`, `default_saved`). Defensible as the command argument and matches core; changing it needs core in step. Not required.

Observation (not a finding on the ur text): the English source names “Allow all”; the desktop approval card's buttons are Approve/Deny (the “Allow all” label is core TUI wording). Source-level, all locales alike.

## Files
Receipt: receipt-ur.json (sha256s: en 815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f, ur ca83c72097bb0d0b3bbd2d2a2c71fb2fc13909a1edd4456ddceb5a9259914306, context 9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f).
