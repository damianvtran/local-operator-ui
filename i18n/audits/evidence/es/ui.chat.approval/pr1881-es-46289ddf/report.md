# es audit — PR #1881, `ui.chat.approval` @ 8efa3b0ff5bb (instance pr1881-es-46289ddf)

Auditor: reviewer session f7bc238e97e6, model anthropic/claude-sonnet-5-5 (no fallback). Did not write the files; first audit of this locale/namespace by me.

## New key
- key: `ui.chat.approval.escape.bridge_latched`
- en: "Allow all and auto are off in this conversation. To turn auto on, type /approvals auto in the terminal, or use /new for a fresh conversation."
- es: "“Allow all” y el modo auto están desactivados en esta conversación. Para activar el modo auto, escribe /approvals auto en la terminal, o usa /new para empezar una conversación nueva."
- back-translation: "“Allow all” and auto mode are deactivated in this conversation. To activate auto mode, type /approvals auto in the terminal, or use /new to start a new conversation."

Checks:
- Meaning: exact. Both sentences kept, same two remedies (typed command in the terminal; /new), nothing softened or added. "desactivados" = off; "en la terminal" keeps the deliberate "in the terminal" wording.
- Commands: `/approvals auto` and `/new` present verbatim (substring check), not translated, not quoted.
- Register: tú ("escribe", "usa"), terse, sentence case, no "!", curly quotes “ ” per style guide. "terminal", "conversación", "modo auto" match the es guide and the catalogue's neighbours.
- `“Allow all”` is kept English and quoted: it is the TUI's literal, untranslated row label (core tui/widgets/approval.py `("Allow all", "A", …)`), so quoting it as a label is right. The quotes are an es addition vs en; harmless.
- Placeholders/ICU: none, in en or es. Non-ASCII bytes are only “ ” á ó ó; no control or bidi characters.
- Byte-identical to core: `json.loads(origin/main:local_operator/i18n/catalogues/es/wire.bridge_taint.json)["wire.bridge_taint.card_options_off"]` equals the es value byte for byte (verified by parse). The core file's own prior audit is separate and not re-claimed here.

## Rest of namespace
- Parsed: 18 keys in en, es and the context sidecar; key sets equal; no duplicate keys; placeholder sets identical per key (`{detail}`, `{mode}`, `{globalMode}` unchanged); no plural arms in this namespace.
- `git diff 5033f64235..8efa3b0ff5 --numstat -- es/ui.chat.approval.json` = `1 0`: one added line. All 17 pre-existing es values byte-identical to 5033f64235. They carry their previous audit.
- Worktree clean at the pinned head, so the hashes below are of committed bytes.

## sha256 (shasum -a 256)
- en: 815a4ff369d33bc106b35aa74589f4f000811d24aa24519094c4373283d7ec8f
- es: 240d348c20a0737109301f0149c1effcb02c2b8e07a83667b3f062d5c0a46ed0
- context: 9ee5d1341420c59b38f1d451848f2da76bc9397c5d7811196356fbd98968bb2f

## Findings: none (0 blocker, 0 major, 0 minor, 0 nit)
Not counted, for the PR author (not a locale defect, identical in en): the desktop card has no "Allow all" control (only Aprobar/Denegar and the two set-auto links), so the sentence names a TUI row. Core's copy of the sentence has the same shape. Also: `modo auto` lowercase here vs "Auto" capitalised in sibling set_all/set_session; matches core's es wording elsewhere and en lowercases too; no change needed.

## Verdict: clean. Round is TERMINAL for es.
