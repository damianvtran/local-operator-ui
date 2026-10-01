import { useCallback, useEffect, useRef } from "react";

/**
 * A stable identity for a callback that must still run the latest render's
 * closure when it is invoked.
 *
 * WHY THIS EXISTS. The chat pane re-renders at stream-flush cadence — once per
 * batch of stream frames — and the composer subtree is memoised so that a flush
 * which changes nothing the composer actually reads does not re-execute its
 * full render. A memo boundary compares props shallowly, so any callback prop
 * that is rebuilt on every render of the page defeats it: `send` in
 * `chat-page.tsx` is declared as a plain function and would otherwise hand the
 * boundary a fresh identity once per flush.
 *
 * WHY NOT `useCallback` AT THE CALL SITE. The callbacks this wraps are declared
 * over the whole page — `send` closes over the admitted draft's identity, the
 * gate, the send lock, the stores and the error setters. A dependency list
 * derived by hand for a body that size is a stale closure waiting to happen;
 * the wrapper has no dependency list to get wrong. Its SEMANTICS are the ones
 * the fresh closure had: every invocation runs the latest render's function,
 * read through a ref after each commit — the same idiom `message-input.tsx`
 * already uses for its host callbacks (`onCredentialsStoredRef`), so an
 * event-time call always sees the current state.
 */
export function useStableCallback<Args extends unknown[], Result>(
	callback: (...args: Args) => Result,
): (...args: Args) => Result {
	const latest = useRef(callback);
	useEffect(() => {
		latest.current = callback;
	});
	return useCallback((...args: Args) => latest.current(...args), []);
}
