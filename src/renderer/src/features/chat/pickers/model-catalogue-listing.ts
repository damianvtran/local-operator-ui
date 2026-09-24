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
				notice: PROVIDER_LISTING_FAILED,
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
 * It names the STATE of the rows (they are the shipped ones, not a provider's)
 * and something the user can DO about it, because the alternative the operator
 * saw was a red line of transport copy with every row deleted and only the
 * control that had just failed left to press (UX U3). Sentence case, monospace
 * for machine voice only; the button it names is the one beside the list.
 */
export const PROVIDER_LISTING_FAILED =
	"The provider listing failed. The rows below are the shipped models; Refresh from providers tries again.";
