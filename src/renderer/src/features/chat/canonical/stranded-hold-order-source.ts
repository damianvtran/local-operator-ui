import fixtureJson from "../../../../../../scripts/fixtures/stranded-send-order.json";
import { t } from "../../../../../i18n/messages";
import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";

/**
 * Captured full-journal line windows, NOT enumeration of selected story pages.
 * The fixture test header records held306..400, send401, exchange402..435,
 * stream436..621, newer506..605, newer2606..705 (one-based complete-row lines).
 * Overlaps must agree; silent rows consume ordinals too. This is a synthetic
 * replay domain over those captured offsets, not the live backend generation.
 */
export const CAPTURED_REPLAY_DOMAIN = "synthetic-replay-captured-journal-lines";
export const capturedJournalOrdinals = new Map<string, number>();
for (const [rows, first] of [
	[fixtureJson.held.entries, 305],
	[fixtureJson.exchange.rows, 401],
	[fixtureJson.stream.rows, 435],
	[fixtureJson.newer.entries, 505],
	[fixtureJson.newer2.entries, 605],
] as const) {
	for (const [offset, row] of rows.entries()) {
		const seq = first + offset;
		const prior = capturedJournalOrdinals.get(row.id);
		if (prior !== undefined && prior !== seq)
			throw new Error("Captured journal windows disagree on an entry position");
		capturedJournalOrdinals.set(row.id, seq);
	}
}
capturedJournalOrdinals.set(fixtureJson.send.id, 400);

export function capturedOrderPage(
	entries: DesktopHistoryPage["entries"],
): DesktopHistoryPage {
	return {
		entries: entries.map((row) => {
			const seq = capturedJournalOrdinals.get(row.id);
			if (seq === undefined)
				throw new Error(
					t(
						"ui.chat.canonical.stranded_hold_order_source.entry_is_not_in_the_captured_journal_windows",
					),
				);
			return { ...row, journal_seq: seq };
		}),
		has_more: true,
		cursor_missing: false,
		journal_order_state: "ready",
		journal_generation: CAPTURED_REPLAY_DOMAIN,
	};
}
