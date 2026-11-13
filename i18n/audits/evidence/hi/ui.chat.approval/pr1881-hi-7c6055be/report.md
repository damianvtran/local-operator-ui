# Hindi (hi) audit — local-operator-ui PR #1881 @ 8efa3b0ff5bb, ui.chat.approval

Auditor: reviewer session c9b847b0e147, model anthropic/claude-sonnet-5-5 (no fallback). Did not write the files.

## New key `ui.chat.approval.escape.bridge_latched`

- EN: Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation.
- HI: इस बातचीत में “Allow all” और auto बंद हैं। auto चालू करने के लिए टर्मिनल में /approvals auto टाइप करें, या नई बातचीत के लिए /new इस्तेमाल करें।
- Back-translation: "In this conversation, 'Allow all' and auto are off. To turn auto on, type /approvals auto in the terminal, or use /new for a new conversation."

Result: meaning matches exactly (both modes off, how to turn auto on, the /new alternative). Two short sentences, each ends with a danda, as the sidecar asks. Polite imperative (टाइप करें, इस्तेमाल करें), आप register, no "!" or "कृपया": conforms to i18n/style-guides/hi.md. `/approvals auto` and `/new` are byte-verbatim Latin. बातचीत for conversation, टर्मिनल for terminal: natural. Typographic quotes “ ” and danda ।: per the style guide.

## Checks by parsing bytes

- Byte-identical to core: the new value equals `wire.bridge_taint.card_options_off` in core origin/main `hi/wire.bridge_taint.json` (True); the core English source equals the UI English.
- Key set hi == en: 18 == 18; no duplicate keys in either file.
- Placeholders / ICU arms identical per key: 0 mismatches (the new key has none).
- No Unicode format or control characters (category Cf/Cc) in the new value: no bidi marks, ZWJ or ZWNJ. NFC-normalised. Only non-ASCII punctuation: “ ” and ।.
- `git diff 5033f64235..8efa3b0ff5 -- hi/ui.chat.approval.json`: exactly one added line (the new key). The other 17 keys are carried from their previous audit.
- Hashes (shasum -a 256): en 815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f; hi baef7d01953b10e6c227e5b2a1536e47a1441ac665abc8408a6760c81901a2aa; context 9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f.

## Finding

- MINOR — the sentence writes the mode as Latin `auto` twice in prose, while the rest of the namespace renders the same mode as `ऑटो` (mode.auto, set_session, set_all, session_saved, default_saved, default_saved_session_failed). The user sees a chip reading "ऑटो" next to a note saying "auto". The typed `/approvals auto` token must stay Latin. Not blocking and not fixable here without breaking the core byte-identity; follow-up: change the two prose "auto" to "ऑटो" in core and UI together. "Allow all" in Latin quotes is acceptable (a mode name from the terminal, not a UI string).

## Verdict

clean-with-findings: 0 blocker, 0 major, 1 minor, 0 nit. Receipt status passed. This audit is TERMINAL for hi.
