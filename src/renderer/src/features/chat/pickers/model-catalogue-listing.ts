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

/** The scope a catalogue can be asked for — the wire's own two values. */
export type CatalogueScope = "usable" | "all";

type CatalogueRow = DesktopModelCatalogue["models"][number];

/**
 * The row's selector, in the one spelling the wire and the rows share.
 *
 * ONE SPELLING FOR BOTH READERS (agent review round 1, R1-5): this module's
 * scope filter and `destination-pickers.tsx`'s row map used to keep separate
 * copies, one tier apart — a row carrying `value` without `selector` was
 * spelled two ways by two halves of the same feature. The full tier list lives
 * here now and both callers import it.
 *
 * The local fallbacks matter because an older backend may omit `selector`
 * (`selector` is required by the contract but only since the same era as
 * `scope`) and the pane path can carry a bare `value`; a row with none of the
 * three still has a provider and an id.
 */
export function catalogueSelectorOf(row: {
	selector?: string | null;
	value?: string;
	provider: string;
	model_id: string;
}): string {
	return row.selector ?? row.value ?? `${row.provider}/${row.model_id}`;
}

const selectorOf = catalogueSelectorOf;

/**
 * The three answers a catalogue row's auth can have, in one place.
 *
 * `needs-sign-in` is the state the whole feature turns on: the row is listed
 * (or was, before scope filtering) and cannot run until a credential exists.
 * `unknown` is `credentials_known === false` — the store could not be read, so
 * `connected` is the listing default rather than a statement about auth.
 */
export type RowAuth = "runnable" | "needs-sign-in" | "unknown";

/**
 * One row's auth state, from the document's own facts.
 *
 * THE ONE PREDICATE behind the row's group, its description, the scope union's
 * reading of it and the pick itself (agent review round 1, R1-5's class: the
 * spellings were drifting apart one caller at a time). The catalogue route
 * always resolves `connected`, so a falsy value is a claim — the wire sends
 * the boolean.
 */
export function rowAuthOf(
	row: { connected?: boolean },
	credentialsKnown: boolean,
): RowAuth {
	if (!credentialsKnown) return "unknown";
	return row.connected ? "runnable" : "needs-sign-in";
}

/**
 * The provider whose sign-in a pick must start, for a selector the composer's
 * INLINE list has a row for — or null when there is nothing to intercept.
 *
 * THE COMPOSER'S HALF OF THE DIALOG'S RULE (UX round 1, U2). Picking a model
 * row that needs a sign-in starts the Connect gesture on every surface, not
 * only in the dialog; the inline `/model` popup used to switch the session
 * onto the same row it labelled "no credential", which is the stranded state
 * this feature exists to remove, with the safe behaviour only on the thicker
 * surface.
 *
 * `=== false` is the inline route's own spelling, stated where its caveat is
 * built (`slash-argument-rows.ts`): `commands.entities` publishes `connected`
 * already resolved on the store's own thread, so only an explicit false is a
 * claim about auth there. The catalogue route reads the same fact through
 * `rowAuthOf`, whose contract carries the field. The row's provider comes from
 * the selector's own first segment, the same split every picker makes.
 */
export function connectProviderForSelector(
	rows: readonly { value: string; connected?: boolean }[],
	selector: string,
): string | null {
	const row = rows.find((candidate) => candidate.value === selector);
	if (!row || row.connected !== false) return null;
	const provider = row.value.split("/")[0] ?? "";
	return provider || null;
}

export type ScopedCatalogue = {
	/** The rows this view may list. */
	rows: CatalogueRow[];
	/**
	 * The count the "Show all supported models (N need sign-in)" control may
	 * PRINT, or `null` when there is no honest number to print.
	 *
	 * Only a wire `usable` answer carries one (`hidden`). The client-side
	 * fallback deliberately does NOT manufacture one from the rows it filtered:
	 * its filter mirrors the backend's own access predicate (flavours, revoked
	 * rows, keyless locals) without being it, and a printed number that drifts
	 * from the predicate would be contradicted by the rows below it.
	 */
	hidden: number | null;
	/**
	 * Rows this client dropped itself (the fallback), so the control can offer
	 * the full list WITHOUT claiming a count — `removed > 0` is the whole of
	 * what it vouches for.
	 */
	removed: number;
};

/**
 * The rows a scope may list, from the document in hand.
 *
 * THE RULE, one place, because two readers must agree about it and the second
 * one is easy to forget: a NEW backend filters server-side and reports what it
 * did (`scope`, `hidden`), while a backend that predates the `scope` parameter
 * answers with everything and says nothing — so THIS client applies the same
 * filter to that answer, on `row.connected`, and shows no count.
 *
 * `current` is the session's model selector. Both halves of the filter keep
 * that row whatever its auth state — the backend's `picker_rows(usable,
 * current)` exemption, mirrored — because the one row a user must always see
 * is the one the session is running.
 *
 * `credentials_known === false` means the store could not be read, so
 * `connected` is the listing default rather than a statement about auth: the
 * filter is not applied at all there, which is the existing rule ("show
 * everything rather than claim the user owns no models") carried into the
 * scope rather than a new one beside it.
 */
export function scopeCatalogue(
	data: DesktopModelCatalogue | undefined,
	scope: CatalogueScope,
	current: string | null,
): ScopedCatalogue {
	const rows = data?.models ?? [];
	if (!data) return { rows, hidden: null, removed: 0 };
	/*
	 * Absence is `all`, the same reading every other consumer of this contract
	 * makes (`desktop-control-contract.ts`): a backend that answers without
	 * `scope` cannot have filtered, whatever this client asked for.
	 */
	const docScope = data.scope ?? "all";
	if (docScope === "usable") {
		/*
		 * A server-filtered `usable` answer is taken as it stands — filtering it
		 * again could only drop the current-model row the backend kept, because
		 * the client's predicate is a mirror and not the predicate.
		 *
		 * `hidden` is read off the document even when the VIEW is `all` (the
		 * toggle's in-flight moment, or the count after a toggle): it was true
		 * when the usable document was fetched and nothing in this render has
		 * contradicted it, so the control keeps its number while the fuller list
		 * loads rather than flickering between labelled states.
		 */
		return {
			rows,
			hidden: typeof data.hidden === "number" ? data.hidden : null,
			removed: 0,
		};
	}
	if (scope === "all" || data.credentials_known === false) {
		return { rows, hidden: null, removed: 0 };
	}
	const kept = rows.filter(
		(row) => row.connected || selectorOf(row) === current,
	);
	return { rows: kept, hidden: null, removed: rows.length - kept.length };
}
