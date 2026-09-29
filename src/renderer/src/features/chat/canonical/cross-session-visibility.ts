/**
 * The one predicate the desktop reads cross-session visibility through: which
 * transcript records a reader is shown when `display.hide_cross_session` is on.
 *
 * WHERE THE FILTER SITS, AND WHY. Every desktop transcript view is downstream
 * of ONE records array: `buildRows` mints the row list from it, and the
 * visible window, the run folds, the turn-collapse plan and the working line
 * all consume that product. Filtering after `buildRows` would leave half of
 * those consumers reading an unfiltered list, and the failure is not cosmetic:
 * `deriveWorkingLine` names a running tool from the records ("running send"),
 * and a collapse bar counts the rows it is given. So the filter sits at the
 * seam where records become rows (`canonical-transcript.tsx`), and every
 * consumer inherits it — the same "enforce at the layer that BUILDS rows"
 * doctrine the TUI and phone windows follow.
 *
 * THE HIDDEN SET IS THE CROSS-REPO CONTRACT (frozen in the design doc; the TUI
 * and mobile implementations enforce the identical set): custom rows projected
 * as `kind: "peer"` — an inbound `lop send` receipt — and `kind: "tool"` rows
 * whose tool name is exactly `send`. Nothing else: `wake` receipts, `hub`
 * traffic and every other tool stay visible, because the option hides
 * CROSS-SESSION traffic, not delegation or scheduled wakes.
 *
 * IDENTITY IS PART OF THE CONTRACT, not an optimisation. The default
 * (`hide === false`) returns the SAME array reference, and so does a session
 * with nothing to drop under `hide === true` — the memos downstream
 * (`buildRows`' wrapper-reuse pass, the working-line memo, the collapse plan)
 * key on reference equality, so minting a fresh array on the default path
 * would rebuild the row list and re-derive the working line on every commit.
 * Default-off must be byte-identical, and reference equality here is how that
 * is enforced rather than hoped for.
 */
import type { TranscriptRecord } from "./transcript-reducer";

export function visibleRecords(
	records: TranscriptRecord[],
	hide: boolean,
): TranscriptRecord[] {
	if (!hide) return records;
	let dropped = false;
	const kept: TranscriptRecord[] = [];
	for (const record of records) {
		if (
			record.kind === "peer" ||
			(record.kind === "tool" && record.toolName === "send")
		) {
			dropped = true;
			continue;
		}
		kept.push(record);
	}
	return dropped ? kept : records;
}
