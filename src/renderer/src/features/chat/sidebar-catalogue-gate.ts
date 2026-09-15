/**
 * When the chat sidebar may render its catalogue, and when what it is rendering
 * is a picture of the past.
 *
 * WHY this is a module of its own rather than three lines inside the component.
 * The list is one gate for three surfaces - agents, teams and chats - and the
 * gate is the conjunction of two facts main publishes (the desktop plane is
 * available AND the backend advertises `session_catalogue`), so "the list
 * disappeared" is a bug about four boolean inputs. Extracting the decision is
 * what lets a test drive those inputs directly instead of asserting against the
 * component's source text; `clear-search.ts` next door is extracted for the same
 * reason.
 *
 * THE OPERATOR'S REPORT this answers: "sometimes all the active chats and teams
 * in the UI disappear and it needs a refresh; it happens after a while of use,
 * maybe under load; after sitting a while they come back on their own."
 *
 * The mechanism, measured in the shipped code: `ready` needs `desktop_available`
 * AND `session_catalogue`, and `capabilities` SUCCEEDS with either missing - a
 * daemon this app holds no token for answers `desktop_available: false`, and a
 * backend that predates the route answers without the feature key. So the gate
 * can close while `capabilities.error` stays null. The previous decision keyed
 * the stale treatment on that error alone, so `stale` went false, `showList`
 * went false, and every block below unmounted together - chats, agents and
 * teams - with no `role="alert"` and nothing left but the "Update the backend"
 * sentence, whose remedy is only true for the version half of the problem.
 * Nothing refetched the gate either (`staleTime: 60_000`, `retry: false`, no
 * interval), which is why only a focus or an unrelated invalidation brought it
 * back - the "needs a refresh, and later it comes back by itself" shape of the
 * report exactly.
 *
 * A WITHDRAWN gate is therefore treated like a FAILED one, which is the
 * treatment already in the component for an error: keep the structure and the
 * last-known rows mounted, mark them stale, and say what happened. What differs
 * is where recovery comes from - a failed query is React Query's to retry, a
 * withdrawn gate is main's re-negotiation to finish - and the re-negotiation in
 * `useDesktopCapabilities` is what makes that bounded rather than dependent on
 * the operator touching the window.
 */

export type CatalogueGateInput = {
	/** `desktopFeatureEnabled(capabilities.data, "session_catalogue", 2)`. */
	ready: boolean;
	/** `capabilities.error` is non-null: the query itself failed. */
	failed: boolean;
	/** `capabilities.data` is present: an answer exists, success or stale. */
	answered: boolean;
	/** Whether the gate has been open at any point in this mount. */
	wasReady: boolean;
	/** Rows the canonical store holds RIGHT NOW. */
	rows: number;
};

export type CatalogueGate = {
	/** The gate was open, and a fresh answer has closed it. */
	withdrawn: boolean;
	/** What is rendered must read as last-known rather than current. */
	stale: boolean;
	/** Whether the catalogue blocks (agents, teams, chats) are mounted. */
	showList: boolean;
	/**
	 * Whether "showing the last chats and teams that loaded" is a TRUE sentence.
	 *
	 * It is a statement about the rows on screen, so it is a read of the store
	 * rather than a read of the gate: a stale render over a store that genuinely
	 * emptied must still read as empty, and claiming last-known rows over an empty
	 * list would be the same class of mistake as calling a serving daemon offline.
	 */
	lastKnownRows: boolean;
};

export function catalogueGate({
	ready,
	failed,
	answered,
	wasReady,
	rows,
}: CatalogueGateInput): CatalogueGate {
	const withdrawn = answered && !failed && !ready;
	const stale = wasReady && (failed || withdrawn);
	return {
		withdrawn,
		stale,
		showList: ready || stale,
		lastKnownRows: stale && rows > 0,
	};
}
