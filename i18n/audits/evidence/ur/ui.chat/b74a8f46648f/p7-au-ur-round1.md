# P7 Urdu independent audit — round 1

Verdict: **clean**. Audited all 6 keys. Findings: BLOCKER 0, MAJOR 0, MINOR 0, NIT 0.

Auditor: i18n-auditor; session b74a8f46648f; ACTUAL served model openai/gpt-6.1-sol (runtime session model declaration; no fallback used). Translator candidate declares anthropic/claude-sonnet-5-5, a separate translator per delegation. Date: 2026-11-11.
Scope: candidate ~/local-operator-ui/.worktrees/_p7-prep/ur.json against keys.json plus callsites.md and risks.md. No repo/catalogue/ledger edits. This is a candidate-only linguistic audit, not rendered or screen-reader execution proof.

## Checks actually executed

Python 3 mechanical pass through functions.eval: valid JSON; identical six-key set AND order; nonempty strings; exact placeholder-name parity; no English-identical values; all NFC; no manual bidi controls. All eight checks PASS. None of these six strings uses ICU plural/select, markup, code, flags or identifiers needing preservation beyond the checked placeholders. Repo-wide catalogue validator not run: this is a six-key preparation payload, not an integrated catalogue change.

Read ur/en style guides and glossary before candidate. Read source English/context sidecar, callsites and risks. Independently compared candidate terms against git-show origin/main catalogues at 3e48d8acb981b098bf512157ee0d1faf3f5fc3c9, including the actual relative-age messages (not just translator notes).

## Per-key semantic and idiom audit

| Key | Current candidate | Result |
|---|---|---|
| ui.library.preview.organized_by_agent | ایجنٹ نے {at} منظم کیا | PASS: agent attribution, ergative نے, temporal phrase before verb; matches shipped ایجنٹ and organized_by construction. Bare ایجنٹ is natural here; no need to force an indefinite article. |
| ui.library.preview.organized_by_librarian | لائبریرین نے {at} منظم کیا | PASS: exact shipped ui.library.librarian.title term, natural actor/time/verb order. |
| ui.library.preview.organized_by_system | {at} خودکار طور پر منظم ہوا | PASS: explicit automatic organization without inventing an actor; natural intransitive result construction. |
| ui.library.preview.organized_by_user | آپ نے {at} منظم کیا | PASS: direct attribution to reader using required polite آپ. |
| ui.library.preview.organized_unattributed | {at} منظم ہوا | PASS: actor remains unspecified; matches shipped unorganized ابھی منظم نہیں ہوا construction. |
| ui.chat.audio.position_value | {total} میں سے {current} | PASS: total-out-of-current relation is expressed naturally in Urdu as total میں سے current; here means elapsed out of total, not the reverse. Consistent with shipped slide_of and question_dock.hint.prefix. No count/plural needed. |

Verified shipped temporal fragments: ابھی; ... منٹ پہلے; singular گھنٹہ پہلے/plural گھنٹے پہلے; ... دن پہلے; ... ماہ پہلے; ... سال پہلے. Candidate placement gives natural sentences, e.g. ایجنٹ نے 2 گھنٹے پہلے منظم کیا and 2 گھنٹے پہلے خودکار طور پر منظم ہوا. Nothing adds a second ago/postposition. Empty age remains understandable.

RTL: logical Urdu order is correct. No manually embedded bidi controls. Clocks remain verbatim ASCII m:ss; example value is 0:12 میں سے 0:05, with each colon-separated clock an LTR numeric run. No arrows or mirrored glyph hints. No visual bidi or actual assistive-technology claim is made; those remain implementation QA.

Fit: source/target Unicode codepoint counts including placeholder syntax: agent 26/22; librarian 31/26; system 28/27; user 21/19; unattributed 14/13; position 20/24. These are codepoint counts, NOT rendered widths or terminal cells. All displayed metadata sentences are comparable or shorter by this proxy; no hard maxCells/maxChars appears in supplied contexts. The longer audio string is announced rather than displayed. Urdu shaping/diacritics cannot be certified from counts; no specific overflow defect found.

## Input hashes (SHA-256)

- keys.json: c2b57addb849fb35720fac74c79b59c1c47078534c0c50cf9e8b58c368c0a35a
- ur.json: ba4a03ef840da38c34298d5deba87c801d3343794875c1b7a055758d716f0947
- callsites.md: 25fc999688b693d45b3ad3cbcd5e11180087cd969ce6031d586fc200390f94ff
- risks.md: ee66a0fa2c3b52184bef860a53c1b5f79b1d1708978a4e7e4fa2eada06ace9a8

No findings, therefore no suggested replacement wording. Terminal for this candidate audit. No ledger write or tracked evidence creation was requested/permitted in this slice; manager owns integration/retention.
