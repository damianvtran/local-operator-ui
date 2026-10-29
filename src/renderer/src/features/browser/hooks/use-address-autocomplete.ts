import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AddressHistoryEntry,
	AddressHistoryRequest,
	AddressHistoryResponse,
} from "../../../../../shared/browser-address-history";
import { ADDRESS_HISTORY_DEFAULT_LIMIT } from "../../../../../shared/browser-address-history";

/**
 * The address field's ranked suggestions for the text currently typed.
 *
 * WHY THIS IS NO LONGER A SNAPSHOT: main now owns a persistent history store
 * and ranks it, so the request carries the (debounced) query and a limit, and
 * the answer is the top N. The renderer no longer holds — or sorts — the whole
 * table; it derives display text, the target URL and the inline suffix from the
 * rows it was given.
 *
 * THE DEBOUNCE IS THE POINT: 120 ms is long enough that ordinary typing sends
 * one request per pause rather than one per key, and short enough that the list
 * feels attached to the field. The PREVIOUS results are kept while a new query
 * is in flight, so the list does not blank between keystrokes; `requestId` is
 * what makes that safe, because an older reply can never overwrite a newer one.
 *
 * THE FRESHNESS RULES, all enforced here rather than in the component:
 *   - one request in flight, and a newer query arriving during it is coalesced
 *     into one follow-up request rather than a queue;
 *   - a response is discarded unless its `requestId` is the newest one, its
 *     `activeTabId` is still the tab being edited, and the tab has not changed.
 *     Main also refuses a stale `expectedTabId`, which covers the gap before the
 *     reply lands.
 *   - a tab change clears the last results IMMEDIATELY: they describe another
 *     tab's field.
 *
 * A FAILURE IS NOT AN ACTION FAILURE: the field keeps typing and navigating. This
 * hook reports its own `error` flag so the list can say suggestions are
 * unavailable, and the safe fallback is exactly plain URL editing.
 */

/** How long the field waits after a keystroke before asking main. */
export const ADDRESS_QUERY_DEBOUNCE_MS = 120;
/** How long a focused field waits before re-reading after a state invalidation. */
export const ADDRESS_HISTORY_REFRESH_DEBOUNCE_MS = 100;

export interface AddressAutocompleteOptions {
	/** The tab the draft belongs to, or null when no tab is open. */
	tabId: number | null;
	/** The text currently in the field. Debounced here, not by the caller. */
	query: string;
	/** Fetch through the chrome hook, so the bridge has one accessor. */
	requestHistory: (
		request: AddressHistoryRequest,
	) => Promise<AddressHistoryResponse>;
	/** Subscribe to main's projection invalidations. */
	subscribe: (callback: () => void) => () => void;
	/** False when the host has no history bridge at all (a story, a harness). */
	enabled?: boolean;
}

export interface AddressAutocompleteState {
	entries: AddressHistoryEntry[];
	loading: boolean;
	error: boolean;
	/** The field gained focus: read immediately. */
	onFocus: () => void;
	/** The field lost focus: drop the results and any outstanding work. */
	onBlur: () => void;
}

export function useAddressAutocomplete(
	options: AddressAutocompleteOptions,
): AddressAutocompleteState {
	const { tabId, query, enabled = true } = options;
	const requestHistoryRef = useRef(options.requestHistory);
	const subscribeRef = useRef(options.subscribe);
	requestHistoryRef.current = options.requestHistory;
	subscribeRef.current = options.subscribe;
	const [entries, setEntries] = useState<AddressHistoryEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);

	const focusedRef = useRef(false);
	const tabIdRef = useRef(tabId);
	const queryRef = useRef(query);
	const latestRequestRef = useRef(0);
	const inFlightRef = useRef(false);
	const pendingRef = useRef(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	tabIdRef.current = tabId;
	queryRef.current = query;

	const clearDebounce = useCallback((): void => {
		if (debounceRef.current !== null) {
			clearTimeout(debounceRef.current);
			debounceRef.current = null;
		}
	}, []);

	const request = useCallback((): void => {
		if (!enabled) return;
		if (!focusedRef.current || tabIdRef.current === null) return;
		if (inFlightRef.current) {
			pendingRef.current = true;
			return;
		}
		inFlightRef.current = true;
		const requestId = latestRequestRef.current + 1;
		latestRequestRef.current = requestId;
		const expectedTabId = tabIdRef.current;
		const requestQuery = queryRef.current;
		setLoading(true);
		requestHistoryRef
			.current({
				requestId,
				expectedTabId,
				query: requestQuery,
				limit: ADDRESS_HISTORY_DEFAULT_LIMIT,
			})
			.then((response) => {
				if (!mountedRef.current) return;
				if (!focusedRef.current) return;
				if (response.requestId !== latestRequestRef.current) return;
				if (tabIdRef.current !== expectedTabId) return;
				if (response.activeTabId !== expectedTabId) return;
				setEntries(response.entries);
				setError(false);
			})
			.catch(() => {
				if (!mountedRef.current) return;
				if (!focusedRef.current) return;
				if (requestId !== latestRequestRef.current) return;
				// A failed read must not keep offering destinations it can no longer
				// vouch for. The field degrades quietly.
				setEntries([]);
				setError(true);
			})
			.finally(() => {
				if (!mountedRef.current) return;
				inFlightRef.current = false;
				if (requestId === latestRequestRef.current) setLoading(false);
				if (pendingRef.current) {
					pendingRef.current = false;
					clearDebounce();
					debounceRef.current = setTimeout(() => {
						debounceRef.current = null;
						request();
					}, ADDRESS_QUERY_DEBOUNCE_MS);
				}
			});
	}, [enabled, clearDebounce]);

	/**
	 * `request` changes identity with `enabled`, and `enabled` now flips whenever
	 * the tab moves between own-state (the DOM list) and a presented page (the
	 * native child). The subscription below must NOT follow it: tearing down and
	 * re-adding a `onStateChanged` listener on every such flip is churn on a
	 * window-wide channel, and a bridge that tracks one listener per channel (the
	 * start-page harness's fake does) drops every OTHER consumer's callback when
	 * this one unsubscribes - a landed page then never reaches the surface. The
	 * listener reads the latest `request` through a ref instead.
	 */
	const requestRef = useRef(request);
	requestRef.current = request;

	/** Coalesced invalidation from main: only while this field is focused. */
	const invalidated = useCallback((): void => {
		if (!focusedRef.current) return;
		if (debounceRef.current !== null) return;
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			requestRef.current();
		}, ADDRESS_HISTORY_REFRESH_DEBOUNCE_MS);
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			clearDebounce();
		};
	}, [clearDebounce]);

	useEffect(() => {
		const unsubscribe = subscribeRef.current(invalidated);
		return unsubscribe;
	}, [invalidated]);

	// The typed text is debounced while the field is focused. The previous
	// entries stay on screen until the next answer, so there is no flicker; the
	// requestId guard makes that safe.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the trigger, not a value the body reads - the request reads `queryRef`, so a stale closure cannot send an older query.
	useEffect(() => {
		if (!focusedRef.current) return;
		clearDebounce();
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			request();
		}, ADDRESS_QUERY_DEBOUNCE_MS);
		return clearDebounce;
	}, [query, request, clearDebounce]);

	// A tab change invalidates the results IMMEDIATELY, even while the field
	// still has focus (Cmd+2, Ctrl+Tab). An old candidate must never be offered
	// under the new tab's draft.
	const previousTabRef = useRef(tabId);
	useEffect(() => {
		if (previousTabRef.current === tabId) return;
		previousTabRef.current = tabId;
		latestRequestRef.current += 1;
		setEntries([]);
		setError(false);
		setLoading(false);
		clearDebounce();
		if (focusedRef.current) request();
	}, [tabId, request, clearDebounce]);

	const onFocus = useCallback((): void => {
		focusedRef.current = true;
		request();
	}, [request]);

	const onBlur = useCallback((): void => {
		focusedRef.current = false;
		latestRequestRef.current += 1;
		pendingRef.current = false;
		clearDebounce();
		setEntries([]);
		setError(false);
		setLoading(false);
	}, [clearDebounce]);

	return { entries, loading, error, onFocus, onBlur };
}
