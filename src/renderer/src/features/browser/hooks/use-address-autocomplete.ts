import { useCallback, useEffect, useRef, useState } from "react";
import type {
	AddressHistoryEntry,
	AddressHistoryRequest,
	AddressHistoryResponse,
	AddressHistoryScope,
} from "../../../../../shared/browser-address-history";

/**
 * The address field's disposable history snapshot.
 *
 * WHY A SNAPSHOT AND NOT A SUBSCRIPTION TO THE PROJECTION: the projection carries
 * only each tab's CURRENT url (`chromeState().tabs[].url`), so ranking from it
 * would lose every earlier page in the stack and the restore fallback. Main reads
 * the real stacks on request; this hook holds the answer only for the focused
 * edit, and throws it away on blur, tab change or scope change.
 *
 * THE FRESHNESS RULES, all enforced here rather than in the component:
 *   - one request in flight, and `browser-state-changed` invalidations while
 *     focused are COALESCED (100 ms) into the next request instead of forming a
 *     queue per navigation event;
 *   - a response is discarded unless its `requestId` is the newest one, its
 *     `activeTabId` is still the tab being edited, and the scope has not changed.
 *     Main also refuses a stale `expectedTabId`, which covers the gap before the
 *     reply lands.
 *
 * A FAILURE IS NOT AN ACTION FAILURE: the field keeps typing and navigating. This
 * hook reports its own `error` flag so the list can say suggestions are
 * unavailable, and the proposal's safe fallback is exactly plain URL editing.
 */

/** How long a focused field waits before re-reading after a state invalidation. */
export const ADDRESS_HISTORY_REFRESH_DEBOUNCE_MS = 100;

export interface AddressAutocompleteOptions {
	/** The tab the draft belongs to, or null when no tab is open. */
	tabId: number | null;
	/** The surface's display scope; `scopeKey` is its stable identity. */
	scope: AddressHistoryScope;
	scopeKey: string;
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
	truncated: boolean;
	/** The field gained focus: read immediately. */
	onFocus: () => void;
	/** The field lost focus: drop the snapshot and any outstanding work. */
	onBlur: () => void;
}

export function useAddressAutocomplete(
	options: AddressAutocompleteOptions,
): AddressAutocompleteState {
	const { tabId, scope, scopeKey, enabled = true } = options;
	const requestHistoryRef = useRef(options.requestHistory);
	const subscribeRef = useRef(options.subscribe);
	requestHistoryRef.current = options.requestHistory;
	subscribeRef.current = options.subscribe;
	const [entries, setEntries] = useState<AddressHistoryEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);
	const [truncated, setTruncated] = useState(false);

	const focusedRef = useRef(false);
	const tabIdRef = useRef(tabId);
	const scopeRef = useRef(scope);
	const scopeKeyRef = useRef(scopeKey);
	const latestRequestRef = useRef(0);
	const inFlightRef = useRef(false);
	const pendingRef = useRef(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mountedRef = useRef(true);

	tabIdRef.current = tabId;
	scopeRef.current = scope;
	scopeKeyRef.current = scopeKey;

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
		const requestScope = scopeRef.current;
		const requestScopeKey = scopeKeyRef.current;
		setLoading(true);
		requestHistoryRef
			.current({
				requestId,
				expectedTabId,
				scope: requestScope,
			})
			.then((response) => {
				if (!mountedRef.current) return;
				if (!focusedRef.current) return;
				if (response.requestId !== latestRequestRef.current) return;
				if (tabIdRef.current !== expectedTabId) return;
				if (scopeKeyRef.current !== requestScopeKey) return;
				if (response.activeTabId !== expectedTabId) return;
				setEntries(response.entries);
				setTruncated(response.truncated);
				setError(false);
			})
			.catch(() => {
				if (!mountedRef.current) return;
				if (!focusedRef.current) return;
				if (requestId !== latestRequestRef.current) return;
				// Keep the previous entries? No: a failed read must not keep offering
				// destinations it can no longer vouch for. The field degrades quietly.
				setEntries([]);
				setTruncated(false);
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
					}, ADDRESS_HISTORY_REFRESH_DEBOUNCE_MS);
				}
			});
	}, [enabled, clearDebounce]);

	/** Coalesced invalidation from main: only while this field is focused. */
	const invalidated = useCallback((): void => {
		if (!focusedRef.current) return;
		if (debounceRef.current !== null) return;
		debounceRef.current = setTimeout(() => {
			debounceRef.current = null;
			request();
		}, ADDRESS_HISTORY_REFRESH_DEBOUNCE_MS);
	}, [request]);

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

	// A tab or scope change invalidates the snapshot IMMEDIATELY, even while the
	// field still has focus (Cmd+2, Ctrl+Tab, the pane's scope switch). An old
	// candidate must never be offered under the new tab's draft.
	const previousKeyRef = useRef(`${tabId ?? "none"}|${scopeKey}`);
	useEffect(() => {
		const nextKey = `${tabId ?? "none"}|${scopeKey}`;
		if (previousKeyRef.current === nextKey) return;
		previousKeyRef.current = nextKey;
		latestRequestRef.current += 1;
		setEntries([]);
		setTruncated(false);
		setError(false);
		setLoading(false);
		clearDebounce();
		if (focusedRef.current) request();
	}, [tabId, scopeKey, request, clearDebounce]);

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
		setTruncated(false);
		setError(false);
		setLoading(false);
	}, [clearDebounce]);

	return { entries, loading, error, truncated, onFocus, onBlur };
}
