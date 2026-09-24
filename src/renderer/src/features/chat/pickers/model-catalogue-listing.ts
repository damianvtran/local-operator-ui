/**
 * What a `models.catalogue` answer means: the rows it holds, the providers that
 * failed, and whether the listing failed outright.
 *
 * Its own module rather than three expressions inside `ModelPicker` because the
 * rule it encodes is the one that was wrong, and the wrong version was
 * invisible: a per-provider failure and a total failure both arrived as one
 * `loadError`, and the host drew the note INSTEAD of the list. On the
 * operator's own catalogue that replaced 1450 usable rows with a wall of 21
 * provider names while the footer went on advertising the arrow keys — the
 * measured state in the design audit's D4.
 *
 * The distinction is real on the wire: `DesktopModelCatalogue.errors` is a
 * partial-failure map keyed by provider, and an answer that carries it still
 * carries `models`. So a partial failure is a NOTE (`notice`, drawn above the
 * list), and so is a total one once the caller has rows to draw - the registry
 * document the dialog opened on (see the `isError` branch below, review round 1
 * R1-1) - while `loadError` (drawn in place of the list) is reserved for a read
 * that has nothing behind it at all.
 *
 * Not in `destination-pickers.tsx` because that file imports React and the
 * whole picker surface, and a rule this easy to get wrong is worth asserting on
 * its own (see `scripts/picker-feedback.test.mjs`).
 */

import type { DesktopModelCatalogue } from "../../../../../shared/desktop-control-contract";

/** Which providers failed to list, in the order the owner reported them. */
export function failedProviders(
	data: DesktopModelCatalogue | undefined,
): string[] {
	const errors = data?.errors;
	if (!errors || typeof errors !== "object") return [];
	return Object.keys(errors);
}

/**
 * The listing's two independent outcomes.
 *
 * `notice` names how many providers did not answer and says plainly that the
 * rows below are the ones that did — so a user can tell an empty provider from
 * a missing one without opening a log — and `noticeDetail` carries the ids
 * themselves, for the tooltip. The count is the sentence because the ids are
 * names nobody can act on: the operator's own catalogue produced 21 of them,
 * three wrapped lines, occupying the top of the dialog before any row was
 * reachable (design D16, UX nit). `loadError` is only ever the query's own
 * failure, where there is nothing to draw.
 */
export function catalogueListing(
	data: DesktopModelCatalogue | undefined,
	query: { isError: boolean; error: unknown },
	errorText: (error: unknown) => string,
	/**
	 * Whether the document handed in above really is the shipped REGISTRY's.
	 *
	 * The caller knows: it draws `live.data ?? registry.data`, so this is true
	 * exactly when the live query has no data of its own. It is a parameter rather
	 * than something read here because only the caller can see both queries, and
	 * the sentence below is a claim about provenance (round 2, code review R2-1).
	 */
	drawnFromRegistry: boolean,
): {
	loadError: string | null;
	notice: string | null;
	noticeDetail: string | null;
} {
	if (query.isError) {
		/*
		 * A FAILED READ IS ONLY A WALL OF ERROR TEXT WHEN THERE IS NOTHING TO DRAW.
		 *
		 * This is the rule design D4 established for the partial failure, applied to
		 * the total one, and it is what keeps the automatic listing from undoing the
		 * dialog's first paint (review round 1, R1-1; UX U3 is the same defect read
		 * from the user's side). `keepPreviousData` carries the previous key's rows
		 * only while the new key is PENDING - a query that settles as `error` has no
		 * data at all - so a live listing that failed used to take the painted
		 * registry rows with it, on every open, with no click behind the read.
		 *
		 * The caller therefore hands this the document the picker should DRAW (the
		 * live answer when there is one, the registry's own otherwise). Rows in hand
		 * mean a NOTE naming what the user can do, and the failure's own words stay
		 * in the tooltip where the developer-facing sentence belongs; no rows at all
		 * means the query's failure IS the body, which is the state this branch was
		 * written for.
		 */
		const rows = data?.models ?? [];
		if (rows.length > 0) {
			return {
				loadError: null,
				notice: providerListingNotice(drawnFromRegistry),
				noticeDetail: errorText(query.error),
			};
		}
		return {
			loadError: errorText(query.error),
			notice: null,
			noticeDetail: null,
		};
	}
	const failed = failedProviders(data);
	if (failed.length === 0)
		return { loadError: null, notice: null, noticeDetail: null };
	return {
		loadError: null,
		notice: `Some providers did not answer (${failed.length}). The rows below are the ones that did.`,
		noticeDetail: failed.join(", "),
	};
}

/**
 * What the dialog says when the provider listing failed and it still has rows.
 *
 * It names the STATE of the rows and something the user can DO about it, because
 * the alternative the operator saw was a red line of transport copy with every
 * row deleted and only the control that had just failed left to press (UX U3).
 * Sentence case, monospace for machine voice only; the button it names is the
 * one beside the list.
 *
 * WHY THE PROVENANCE IS A PARAMETER AND NOT A CONSTANT (round 2, code review
 * R2-1). The first version said "the rows below are the shipped models"
 * unconditionally, and that sentence is FALSE in the state round 2 found: on a
 * SAME-KEY refetch failure react-query keeps `data`, so the failed cadence tick
 * - or the failed click that asked for the provider listing - draws the previous
 * LIVE answer, provider rows, under a claim about the registry. A failed FIRST
 * live read is the other way round: there is no live data, the document drawn is
 * the registry's, and the original sentence is exactly true. Both are real, so
 * the sentence has to follow the document rather than the failure.
 *
 * The label it quotes is written out HERE rather than imported from the control,
 * which is the constraint this note lives under: the button's label is its own
 * concern and the picker has no accessible handle on it from this module, so a
 * rename of that control has to come back through this string - see the `\u00a0`
 * below, which keeps the quoted phrase on one line the way the button renders it.
 */
export const providerListingNotice = (drawnFromRegistry: boolean): string =>
	`The provider listing failed. The rows below are ${
		drawnFromRegistry ? "the shipped models" : "the last listing that answered"
	}; Refresh\u00a0from\u00a0providers tries again.`;
