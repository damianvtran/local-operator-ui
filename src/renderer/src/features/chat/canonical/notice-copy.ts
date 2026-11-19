/**
 * The renderer-authored notice sentences, held as DATA until the row paints.
 *
 * WHY THIS MODULE EXISTS. The reducer folds events into `TranscriptRecord`s that
 * live in state for the whole conversation. A notice whose `text` was resolved
 * through `t()` at reduce time is frozen in the language the app held at that
 * moment: switching the language picker re-renders the rows, but a stored
 * sentence has nothing left to re-read, so `Interrupted` stays English (or stays
 * French) until the transcript reloads. The record therefore carries BOTH:
 *
 *   - `text`  - the sentence in the locale active when the record was built, kept
 *               so every consumer that only wants a string (search, copy, the
 *               partition predicates, tests) keeps working unchanged;
 *   - `copy`  - the sentence as an id plus its arguments, which `noticeText`
 *               re-resolves on every call.
 *
 * Views that paint a notice go through `noticeText`, never `record.text`, and
 * subscribe to the locale (`useI18nLocale`) so a language change re-renders them.
 *
 * WHAT IS NOT HERE: sentences the backend wrote (a compaction `detail`, a
 * relayed incident) are inserted verbatim as arguments and are never translated;
 * and the closure/retirement sentences (`CLOSED_OUTCOME_TEXT`,
 * `RETIRED_OUTCOME_TEXT`) stay byte-identical constants because they mirror the
 * core's `harness/rows.py` words.
 *
 * Each id maps to a LITERAL `t()` key in `noticeCopyText` so the generated key
 * map keeps checking the call sites; do not widen this to a computed key.
 */
import { t } from "@shared/i18n";

export type NoticeCopy =
	| { id: "interrupted" }
	| { id: "stopped_with_error" }
	/**
	 * `sentence` is the runtime's reason with the empty case already defaulted.
	 * The joiner depends on it: the runtime's common reason already opens with a
	 * clause ending in a colon, and a second colon read as two nested claims
	 * (design round 2, N1), so such a reason is joined with an em dash.
	 */
	| { id: "compaction_not_run"; sentence: string };

/** Resolve a notice's sentence in the ACTIVE locale. Cheap; call it at render. */
export function noticeCopyText(copy: NoticeCopy): string {
	switch (copy.id) {
		case "interrupted":
			return t("ui.chat.canonical.notice.interrupted");
		case "stopped_with_error":
			return t("ui.chat.canonical.notice.stopped_with_error");
		case "compaction_not_run":
			return copy.sentence.includes(":")
				? t("ui.chat.canonical.notice.compaction_not_run_after_colon", {
						detail: copy.sentence,
					})
				: t("ui.chat.canonical.notice.compaction_not_run", {
						detail: copy.sentence,
					});
	}
}

/**
 * The text a notice paints now: its `copy` re-resolved when it has one, else the
 * stored `text` (a backend-authored or constant sentence that no locale changes).
 */
export function noticeText(record: {
	text: string;
	copy?: NoticeCopy;
}): string {
	return record.copy ? noticeCopyText(record.copy) : record.text;
}
