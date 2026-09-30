import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import {
	type TranscriptState,
	applyHistoryPage,
	reanchorAfterCursorMiss,
	reanchorCandidate,
} from "./transcript-reducer";

/**
 * What one "load earlier" ask DID, as a value the caller can act on.
 *
 * WHY THIS EXISTS. `loadOlder` used to answer a boolean, and `false` meant four
 * different things: the request failed, someone else already had a page out,
 * the reader switched conversation while it was in flight, and there was nothing
 * left to ask for. The scroll pump treated every `false` as a FAILURE - it
 * counted it toward the three-strikes budget that switches the automatic path
 * off, and it painted the red "Could not load earlier messages" row - so a
 * healthy conversation that merely lost a race (the open-time align fetch, the
 * mentioned-files scan) showed an error. One value per outcome removes the
 * guess: only `failed` is a failure.
 *
 * - `applied`: a page was fetched and merged. `newRecords` may be 0 (a page of
 *   silent or already-held rows still moves the cursor); `exhausted` is the
 *   store's own statement that no older page remains.
 * - `nothing-to-load`: no cursor, or `hasMore` is false. Not a failure and not
 *   applied.
 * - `stale`: the conversation changed while the page was in flight. The page is
 *   dropped (a foreign page must never reach the transcript on screen) and it is
 *   NOT a failure of anything the reader is looking at.
 * - `failed`: the only two failures - the request itself (`request`), or a
 *   cursor the journal cannot locate even after one re-anchor
 *   (`cursor-missing`).
 */
export type LoadOlderOutcome =
	| { kind: "applied"; newRecords: number; exhausted: boolean }
	| { kind: "nothing-to-load" }
	| { kind: "stale" }
	| { kind: "failed"; reason: "request" | "cursor-missing" };

/** Everything the loader needs from its host, so it owns no React or IPC. */
export type OlderLoaderDeps = {
	/** The transcript on screen NOW (read at each decision, never closed over). */
	getTranscript: () => TranscriptState;
	/** One `sessions.history` read with `before_id` set. Rejects on failure. */
	readPage: (beforeId: string) => Promise<DesktopHistoryPage>;
	/** Whether the conversation this ask was made for is still the one on screen. */
	isCurrent: () => boolean;
	/**
	 * Apply an update to the transcript and return the result. The updater runs
	 * against the LATEST state, which is the point: the merge is decided inside
	 * it, not on a snapshot taken before the request went out.
	 */
	commit: (
		update: (current: TranscriptState) => TranscriptState,
	) => TranscriptState;
	/** The host's in-flight flag (`loadingOlder`). Called true on dispatch, false on settle. */
	setLoading?: (loading: boolean) => void;
};

/**
 * The single-flight "load one older page" operation the session hook is made of.
 *
 * SINGLE FLIGHT IS HERE, AND IT SHARES RATHER THAN REFUSES. A caller arriving
 * while a page is out for the SAME conversation is handed the SAME promise, so
 * the align fetch, the jump walk, the mentioned-files scan and the reader's own
 * scroll can all ask at once and exactly one page is spent. There is no
 * `false`-because-busy any more; that answer was the source of the false
 * failures. A page still in flight for a DIFFERENT conversation does not block a
 * new one (it will resolve `stale` and be dropped).
 *
 * THE CURSOR IS THE STORE'S. The old hook kept a second cursor in a ref
 * (`historyCursorRef`) because a page that changed no record could not advance
 * the store's cursor. Continuations now advance it unconditionally
 * (`applyHistoryPage`, `pagedBefore`), so the store is the sole authority and the
 * ref is gone - two authorities is how the reader came to ask for the same page
 * for ever.
 *
 * KEPT OUT OF THE HOOK so the regression simulation drives the code that ships,
 * not a restatement of it.
 */
export function createOlderLoader() {
	let flight: {
		key: string | null;
		promise: Promise<LoadOlderOutcome>;
	} | null = null;

	const run = async (
		deps: OlderLoaderDeps,
		anchorAtDispatch: string,
	): Promise<LoadOlderOutcome> => {
		deps.setLoading?.(true);
		try {
			let anchor = anchorAtDispatch;
			let page = await deps.readPage(anchor);
			// A page for a conversation the reader has left is dropped before it can
			// buy a retry, and it is not a failure of the one they are looking at.
			if (!deps.isCurrent()) return { kind: "stale" };
			if (page.cursor_missing) {
				/*
				 * ONE re-anchored retry, and the choice of anchor is the fix (spec
				 * section 6, C2). The backend answers a `before_id` it cannot locate
				 * with THE CURRENT TAIL. Re-anchoring to that tail's own first entry
				 * (#634) sent a reader N pages deep back to a page they already held,
				 * one click per page. The deepest cursor the reader still holds that
				 * the journal can serve is the oldest held record that carries a real
				 * entry id; the tail page's own oldest is only the last resort.
				 */
				const held = reanchorCandidate(deps.getTranscript());
				const next =
					held !== null && held !== anchor
						? held
						: reanchorAfterCursorMiss(page, anchor);
				if (next === null) return { kind: "failed", reason: "cursor-missing" };
				anchor = next;
				page = await deps.readPage(anchor);
				if (!deps.isCurrent()) return { kind: "stale" };
				// A second miss is the honest dead end: applying the tail would report a
				// click that loaded nothing as a success, and a third ask would loop.
				if (page.cursor_missing)
					return { kind: "failed", reason: "cursor-missing" };
			}
			let before = deps.getTranscript();
			const after = deps.commit((current) => {
				before = current;
				/*
				 * `pagedBefore` is a CLAIM that the store's cursor is where this ask
				 * started, and it is trusted only while that is true (spec R1). A
				 * `replace`, a `/clear` or a snapshot may have moved the store while
				 * the page was out; asserting a continuation then would drag the cursor
				 * to a position the reader is no longer at, so the page is applied as
				 * an ordinary tail-type read instead - which can only move it further
				 * back in time, never forward.
				 */
				return applyHistoryPage(
					current,
					page,
					current.oldestId === anchorAtDispatch
						? { pagedBefore: anchor }
						: undefined,
				);
			});
			return {
				kind: "applied",
				newRecords: Math.max(0, after.records.length - before.records.length),
				exhausted: !after.hasMore,
			};
		} catch {
			// The rows already painted are still correct; the affordance simply
			// stays available for another try.
			return { kind: "failed", reason: "request" };
		} finally {
			deps.setLoading?.(false);
		}
	};

	return {
		/** Whether a page is out for this conversation. */
		busy: (key: string | null): boolean =>
			flight !== null && flight.key === key,
		/**
		 * Ask for the next older page of `key`'s conversation. Resolves, never
		 * rejects.
		 */
		load(key: string | null, deps: OlderLoaderDeps): Promise<LoadOlderOutcome> {
			if (flight !== null && flight.key === key) return flight.promise;
			const transcript = deps.getTranscript();
			if (!transcript.hasMore || !transcript.oldestId)
				return Promise.resolve({ kind: "nothing-to-load" });
			const mine: { key: string | null; promise: Promise<LoadOlderOutcome> } = {
				key,
				promise: run(deps, transcript.oldestId),
			};
			flight = mine;
			// Cleared by identity: a newer flight for another conversation must not be
			// erased by an older one settling late.
			const clear = () => {
				if (flight === mine) flight = null;
			};
			mine.promise.then(clear, clear);
			return mine.promise;
		},
	};
}
