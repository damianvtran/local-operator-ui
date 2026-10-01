import { useCallback, useEffect, useRef } from "react";

/**
 * A stable identity for a callback that must still run the most recently
 * COMMITTED render's closure when it is invoked.
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
 * the wrapper has no dependency list to get wrong.
 *
 * WHAT IS GUARANTEED, EXACTLY (review round 1, R2). The ref is written in a
 * PASSIVE effect, so it holds the current render's closure once that commit's
 * effects have flushed. An invocation that happens after a commit — an event
 * handler, which is every call site in this app — therefore sees the current
 * closure, the same idiom `message-input.tsx` already uses for its host
 * callbacks (`onCredentialsStoredRef`). The one case it does NOT cover is a
 * call made SYNCHRONOUSLY inside the same commit that produced the closure,
 * before the passive effect runs: that call sees the previous render's closure.
 * This is stated rather than papered over, and it is not reachable from the
 * call sites here (`send` and the slash dispatcher are invoked from user
 * events). A `useLayoutEffect` write would not remove the window either — it
 * still cannot precede a render-phase call in the same commit — so it would buy
 * a narrower one at the cost of re-ordering the ref update against children's
 * layout effects; the honest fix is to describe the guarantee precisely.
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
