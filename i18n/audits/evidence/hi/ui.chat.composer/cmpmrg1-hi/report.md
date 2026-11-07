# Audit cmpmrg1-hi — hi / ui.chat.composer (merged delta, six keys)

Auditor: i18n-auditor, session 482065669a31, model anthropic/claude-sonnet-5-5 (no fallback). Independent of the translators. HEAD 801b1ad29d47. Verdict: **passed** (0 BLOCKER, 0 MAJOR, 1 MINOR).

Read first: hi style guide and glossary (transcript → ट्रांसक्रिप्ट; hints → संकेत; polite imperative for controls; 3rd-person present for key hints; Latin key names untouched), English source and sidecar, then sibling hi strings (`placeholder.waiting`, `stop_work_hint`, `secret_*`, `question_dock.hint.*`, `run_details.reader.read_only_footer`).

Mechanical: no placeholders/ICU/markup in the six English or Hindi values; key set equals English (72); NFC, no format chars, no stray spaces. Widths (cells / maxCells): 13/24, 32/48, 11/24, 30/48, 49/64; `secret_closure_notice` 95, no hint.

| key | hi | verdict |
|---|---|---|
| secret_closure_notice | सवालों के पैनल में गोपनीय अनुरोध का जवाब दें — जवाब मिलने तक यह बॉक्स रुका हुआ है, और आपका ड्राफ़्ट बना रहता है। | OK. Both facts (paused until answered, draft kept) and clause order/em dash kept; no security or attempt-limit claim added. "सवालों के पैनल" and "गोपनीय" match the sibling `secret_*` / `ui.chat.asks` copy. |
| insert_transcript | ट्रांसक्रिप्ट डालें | OK. Glossary term; not "confirm", as the sidecar requires. |
| insert_transcript_hint | जाँचने के लिए ट्रांसक्रिप्ट डालें (Enter) | OK. Review purpose kept, `(Enter)` byte-identical. |
| send_recording | रिकॉर्डिंग भेजें | OK. Same term as `composer_media.recording`; the hint carries the transcribe step. |
| send_recording_hint | अभी ट्रांसक्राइब करके भेजें, बिना जाँचे | Correct, see M1. |
| steer_hint | एजेंट को अभी दिशा दें (Enter) · Esc इस टर्न को रोकता है | OK. "दिशा देना" for steer, "टर्न" and "Esc … रोकता है" match `placeholder.waiting` and `question_dock.hint.*`; key names Latin; "·" separator kept. |

## Findings
- **CMPMRG1-HI-M1 (MINOR, non-gating)** `ui.chat.composer.send_recording_hint`: "अभी ट्रांसक्राइब करके भेजें, बिना जाँचे". Meaning is right, but the sidecar asks to say plainly that there is no review step, and "बिना जाँचे" is a terse colloquial adverbial. Better: "अभी ट्रांसक्राइब करके भेजें, जाँचने का मौका नहीं मिलेगा" (or "…, बिना जाँच के"). Both fit 48 cells.

Not audited: unchanged keys, live rendered fit, runtime ICU.
