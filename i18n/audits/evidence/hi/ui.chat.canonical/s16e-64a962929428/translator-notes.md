# Notes — hi, slice S16e-renderer (generation card stop / settlement / failure-class)

Draft: `draft-hi-s16e.json` (12 keys, source order, tab-indented, UTF-8 NFC, trailing newline)
Draft sha256: `41e9e50f80fb89f3d39a822b1fb95461f3d8b4cd9ece1b3ed899c1fec39a9831`

Role: translator only. I did not audit this locale and did not edit the repo
(the worktree was read-only for this task), so no catalogue file, ledger row or
commit was touched. This draft is the handoff artifact.

## Inputs actually used (with hashes)

| Input | Path | sha256 |
|---|---|---|
| English source | `~/local-operator-ui/.worktrees/i18n-s16e/src/i18n/catalogues/en/ui.chat.canonical.json` | `b967adc3…37e17` |
| English context sidecar | `…/en/ui.chat.canonical.context.json` | `ec598772…7b7` |
| Shipped Hindi on this surface | `…/hi/ui.chat.canonical.json` | `5bad55ca…689b` |
| UI i18n HOWTO | `…/docs/I18N.md` (worktree @ bd8e9054) | `d58ad473…1f5c` |
| Core glossary | `~/local-operator/i18n/glossary.md` | `0eb34437…62f8` |
| Hindi style guide | `~/local-operator/i18n/style-guides/hi.md` | `82292dc8…40d5` |
| Core i18n contract | `~/local-operator/docs/design/i18n.md` | `92eca5a1…e096` |
| Brief | parent session scratchpad `s16e-brief.json` | `a0326137…bef0c` (verified) |

Register: आप, polite, terse, standard Hindi (style guide §Formality). Full stops are
danda `।` everywhere a sentence ends; the class labels carry no final punctuation,
as English. Em dash kept with spaces, ` — `, because the shipped Hindi catalogue
already does that (`ask_queue.status.timed_out`, `canvas…goals_viewer…`,
`code_review.cooling`'s neighbours).

## Term decisions, with the evidence I based each on

The decisive constraint: this surface already ships in Hindi, so its nouns win.

| Concept | hi | Evidence in shipped `hi/ui.chat.canonical.json` |
|---|---|---|
| image / video / voiceover / sound effect | तस्वीर / वीडियो / वॉइसओवर / साउंड इफ़ेक्ट | `image_gen.state.running`, `…state.done`, `…state.failed` |
| batch | बैच (`… का बैच`) | `image_gen.state.done_batch`, `…state.failed_batch` |
| provider | प्रोवाइडर | `sound.stop.warning`, `image_gen.control.stop_hint_queued` |
| charge, to be charged | शुल्क, शुल्क लगेगा / शुल्क नहीं लगेगा | `sound.stop.warning` ("ऑडियो बनने पर उसका शुल्क लगेगा"), `sound.cost.no_charge` ("कोई शुल्क नहीं।") |
| final charge / settlement | अंतिम शुल्क … की पुष्टि | `sound.cost.estimated_zero` ("अनुमानित लागत $0; **अंतिम शुल्क की पुष्टि नहीं हुई**।") |
| stop (the control) | रोकें / रोकने का अनुरोध | `image_gen.control.stop` ("रोकें"), `…control.stop_hint_running`, `sound.stop.request_stop` |
| cancel (the provider capacity) | रद्द करना | `sound.stop.warning` ("रद्द करने का कोई endpoint नहीं है") |
| `endpoint` | Latin, undeclined | `sound.stop.warning` — kept English, matching the glossary's wave-2 kept-English set |
| tool | टूल | `agents.detail.section.tools`, `agents.detail.tools.empty` |
| arguments | आर्ग्युमेंट | `pickers.destination_pickers.needs_an_argument`, `settings.integrations…arguments` |
| invalid | अमान्य | `error_block.invalid_key`, `common.errors.usage_rollup_invalid`, `mesh_reach.attempt_bad_address` |
| denied / refused | अस्वीकृत | `tool_row.bridge.outcome.refused` ("अस्वीकृत") |
| failed | विफल | `tool_row.outcome.failed`, `image_gen.state.failed_batch` |
| rate limited | दर सीमा | `code_review.cooling` ("{host} पर {time} तक **दर सीमा** लगी है"), `code_review.…rate_limited` |
| gate | गेट | `chat.pickers` ("स्वीकृति और प्रश्न **गेट** अब भी रुककर आपका इंतज़ार करते हैं") |
| busy (service) | व्यस्त | `agents.publication.busy` ("हब व्यस्त है…"), `chat.ask_queue.busy` ("एजेंट व्यस्त है") |
| pending | लंबित | `ask_panel.pending`, `code_review.ci_pending` |
| `id` | Latin | `pickers.destination_pickers.search_by_title_or_id` ("शीर्षक या id से खोजें"), `library.menu.copy_asset_id` |

## Per-key judgement calls

1. **state.cancelled_batch** — each branch is a full translated sentence and sits
   in the *same family* as `state.failed_batch` ("… का बैच विफल रहा।"): only the
   predicate changes, to "रोक दिया गया।". Select keywords `video / voiceover /
   sound_effect / other` stay English; `{material}` name and kind untouched. The
   `other` branch faithfully reuses the plural-oblique `तस्वीरों का बैच` from the
   shipped `done_batch` / `failed_batch`, rather than inventing `तस्वीर का बैच`.
2. **cancel.queued** — reuses the shipped clause shape "प्रोवाइडर को कॉल किए जाने
   से पहले" from `control.stop_hint_queued`, so the card says the same thing in
   the hint and in the state line. Semicolon keeps the two clauses as one
   sentence as in English. "you will not be charged" is a firm promise, not a
   hedge: "कोई शुल्क नहीं लगेगा।" (the exact negation of the shipped "शुल्क
   लगेगा"), not "शायद" or "नहीं लगना चाहिए".
3. **cancel.running** — "रोकने का अनुरोध किया गया।" for "Stop requested.", because
   this card's stop vocabulary is रोकें/रोकने का अनुरोध, not the loan स्टॉप.
   The second sentence deliberately reproduces the shipped `sound.stop.warning`
   wording nearly verbatim — same fact, same words, one term per concept — and
   is *not* allowed to read as a guarantee (no "शुल्क नहीं लगेगा" here).
   `cancel.checking` is not appended inside this value, per the sidecar.
4. **cancel.checking** — "Checking for settlement." I render settlement with the
   concept the shipped catalogue already names for an unsettled final charge:
   "शुल्क की पुष्टि" (`sound.cost.estimated_zero`). Empty space between the two
   sentences is space, not `।` — the callsite joins them, so this value is one
   complete sentence with its own danda, as required. Four words rather than
   three; Hindi has no shorter idiomatic form that still names the charge.
5. **settlement.pending** — "Settlement pending — …" becomes "शुल्क की पुष्टि
   लंबित — …", keeping the English's fragment + dash + clause shape (`लंबित` is
   used as an invariant predicate, as in the shipped `CI लंबित`). It states that
   a charge is outstanding and never an amount or a zero; "the final charge will
   appear once the provider reports it" → "प्रोवाइडर के रिपोर्ट करने पर अंतिम
   शुल्क दिखेगा।" (`रिपोर्ट`, `दिखेगा` both attested in the shipped catalogue).
6. **error.audio_rate_limited** — two short sentences, calm and actionable.
   "व्यस्त है" matches the shipped busy lines; "थोड़ी देर में फिर कोशिश करें।" is
   the shipped retry collocation (`consent_unavailable`, `agents.publication.busy`).
   No promised success and no specific wait duration.
7. **error_class.audio_rate_limited** — "ऑडियो दर सीमा". I follow the repo's own
   shipped term दर सीमा rather than inventing a calque nobody says; two words,
   label register, no punctuation, will not wrap.
8. **error_class.unknown_tool** — "अज्ञात टूल" (अज्ञात as in `अज्ञात स्रोत`,
   `अज्ञात त्रुटि`).
9. **error_class.invalid_arguments** — "अमान्य आर्ग्युमेंट". Hindi uses the
   singular for the class here; the only attested form in the catalogue is
   singular आर्ग्युमेंट (`आर्ग्युमेंट चाहिए`, `कमांड आर्ग्युमेंट`), and plural
   आर्ग्युमेंट्स does not appear anywhere in the shipped Hindi. Flagging this as
   the one place English's plural is not mirrored.
10. **error_class.duplicate_id** — "डुप्लिकेट id". `id` stays Latin (established);
    दोहराया गया id would be three words and reads as a sentence, not a class.
11. **error_class.denied** — "अस्वीकृत", one word, matching the shipped
    अस्वीकृत for a refused call. This is a permission denial, not a failure, and
    विफल would have blurred it into `gate_failed`.
12. **error_class.gate_failed** — "गेट विफल", keeping गेट as the shipped Hindi
    catalogue keeps it, and विफल for the failure class.

## Things I judged identical to English / kept Latin

No full string stayed English. The only Latin inside the values is `endpoint`
(cancel.running) and `id` (error_class.duplicate_id) — both are tokens the
shipped Hindi catalogue already leaves in Latin on this very surface, so this is
conformance, not drift.

## Glossary proposals (missing terms I had to decide)

- `gate` → **गेट** (attested once in shipped `ui.chat.pickers`; worth a row in
  `glossary.md` §2 so the next wave does not invent द्वार/नियंत्रक).
- `rate limit` → **दर सीमा** (attested in shipped `ui.code_review`; §2 has no row).
- `duplicate` (as a failure class, not the "make a copy" verb) → **डुप्लिकेट**,
  under the hi guide's "living English loan" rule. Not attested in the shipped
  catalogue; propose rather than assume.
- `settlement` → **शुल्क की पुष्टि**, following the shipped
  `sound.cost.estimated_zero`. If the programme prefers a distinct noun for
  settlement, this slice is where the call is made, not later.

## Validator

- The repo's own ICU parser is `intl-messageformat` (imported by
  `src/i18n/messages.ts`), the same parser the render path uses. The worktree has
  no `node_modules`, so I ran one small script against the primary checkout's
  installed copy read-only (`intl-messageformat` 12.1.3): all 12 values parse, and
  formatting with locale `hi` renders every `{material, select, …}` branch, with
  `image` correctly falling through to `other`.
- `pnpm check-i18n` was **not** run: it needs an install in this worktree, and the
  machine memory guard plus the read-only brief forbid that. Structure was
  therefore verified by the parser above plus a byte-level check (12 keys in brief
  order, valid UTF-8 JSON, NFC normalised, tab-indented, trailing newline, brace
  and branch-keyword parity with English).

## Open questions

- None blocking. Two judgment calls worth an auditor's eye: singular
  "अमान्य आर्ग्युमेंट" for English's plural, and "डुप्लिकेट" as a Devanagari loan.
