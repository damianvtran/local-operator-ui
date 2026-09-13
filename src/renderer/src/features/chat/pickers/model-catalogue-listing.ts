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
 * list) and only a query that threw is `loadError` (drawn in place of the
 * list).
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
 * `notice` names the providers that did not answer and says plainly that the
 * rows below are the ones that did — so a user can tell an empty provider from
 * a missing one without opening a log. `loadError` is only ever the query's own
 * failure, where there is nothing to draw.
 */
export function catalogueListing(
	data: DesktopModelCatalogue | undefined,
	query: { isError: boolean; error: unknown },
	errorText: (error: unknown) => string,
): { loadError: string | null; notice: string | null } {
	if (query.isError) {
		return { loadError: errorText(query.error), notice: null };
	}
	const failed = failedProviders(data);
	if (failed.length === 0) return { loadError: null, notice: null };
	return {
		loadError: null,
		notice: `Some providers did not answer: ${failed.join(", ")}. The rows below are the ones that did.`,
	};
}
