/**
 * What counts as "new activity" for a reader who has scrolled away from the
 * newest row, and where the jump-to-latest chip is allowed to stand.
 *
 * The chip itself has existed since the chat redesign; what did not exist was a
 * fact to put in its label. `hasNewActivity` was a prop with no producer, so a
 * reader who was scrolled up when an answer started streaming saw exactly the
 * same control as a reader who had simply scrolled up over a finished turn. The
 * register below is that producer, kept pure so its clauses can be driven in
 * memory (`scripts/new-activity.test.mjs`) rather than by performing a
 * scroll-and-wait in front of a screen.
 *
 * THE THREE THINGS THAT ARE NOT THE SAME, and each one has a clause:
 *
 * - A record APPENDED at the tail is activity. The newest id changed and the
 *   list grew.
 * - The tail GROWING is activity. A streaming answer keeps its id and its row;
 *   only its body lengthens. That is why the fingerprint carries an extent and
 *   not just a count.
 * - A PAGE OF OLDER HISTORY is NOT activity. It also grows the list, which is
 *   why the count alone cannot answer this question: an older page prepends, so
 *   the newest id is unchanged. A reader who scrolled up to load history must
 *   not be told that something new arrived below them.
 *
 * The register is armed only while the reader is NOT following the tail, and it
 * is cleared the moment they are back at it by any means - a wheel, a drag, the
 * chip itself. Activity that arrives under a following reader is not news: they
 * are watching it arrive.
 */

import { TAIL_EPS_PX } from "./scroll-paging";
import type { TranscriptRecord } from "./transcript-reducer";

/**
 * The transcript's tail, in the three facts that separate "new" from "more".
 *
 * `count` is the loaded row count, `newestId` says whether the tail changed
 * identity, and `newestExtent` says whether the same tail row grew. The extent
 * is a size proxy, not the rendered height: measuring the DOM would need a
 * layout pass per token, and every kind's growing body is a string we already
 * hold (`recordExtent`).
 */
export type ActivityFingerprint = {
	count: number;
	newestId: string | null;
	newestExtent: number;
};

export type NewActivityState = {
	fingerprint: ActivityFingerprint;
	pending: boolean;
};

export const EMPTY_FINGERPRINT: ActivityFingerprint = {
	count: 0,
	newestId: null,
	newestExtent: 0,
};

/**
 * How the tail moved between two fingerprints.
 *
 * `older-page` and `baseline` are the two "the list grew but nothing new
 * arrived" cases: a history page prepends under an unchanged newest id, and the
 * first page to land in an empty pane is the transcript appearing rather than
 * activity in it. `reset` is a wholesale replacement the caller did not name as
 * a conversation switch - treated as a new baseline, because claiming activity
 * for a list the reader has never seen is the one answer that cannot be checked.
 */
export type TailArrival =
	| "none"
	| "appended"
	| "grew"
	| "older-page"
	| "baseline"
	| "reset";

/**
 * The size of one record's replaceable body.
 *
 * Only the tail is measured, and only to answer "did the same row grow", so the
 * proxy is the string length the wire already stores: an assistant answer's
 * text, a peer message's body, a tool call's output plus the argument bytes it
 * is still being dictated into. Kinds whose body never streams return zero;
 * they only ever arm the register by appending, which the id already catches.
 */
export const recordExtent = (record: TranscriptRecord): number => {
	switch (record.kind) {
		case "assistant":
		case "custom":
		case "notice":
		case "user":
		case "wake":
			return record.text.length;
		case "peer":
			return record.body.length;
		case "tool":
			// `output` is null until the call settles; `argumentBytes` is the
			// composing surface's own live figure (it grows while the model dictates
			// the arguments), so the two together cover a tool row's whole growth.
			return (record.output?.length ?? 0) + record.argumentBytes;
		default:
			return 0;
	}
};

/** The tail facts of `records`, ordered oldest -> newest. */
export const activityFingerprint = (
	records: readonly TranscriptRecord[],
): ActivityFingerprint => {
	const newest = records.length > 0 ? records[records.length - 1] : null;
	return {
		count: records.length,
		newestId: newest?.id ?? null,
		newestExtent: newest ? recordExtent(newest) : 0,
	};
};

export const tailArrival = (
	prev: ActivityFingerprint,
	next: ActivityFingerprint,
): TailArrival => {
	if (next.count === 0) return prev.count === 0 ? "none" : "reset";
	if (prev.count === 0) return "baseline";
	if (next.count > prev.count) {
		// The tail keeps its identity: whatever grew the list sits above it, which
		// is a page of older history, never news at the bottom.
		return next.newestId === prev.newestId ? "older-page" : "appended";
	}
	if (next.count < prev.count) return "reset";
	// Equal lengths with a different newest id is a list replaced under the
	// register (a conversation swap the caller did not name); it is not activity.
	if (next.newestId !== prev.newestId) return "reset";
	return next.newestExtent > prev.newestExtent ? "grew" : "none";
};

export const initialActivityState = (
	fingerprint: ActivityFingerprint = EMPTY_FINGERPRINT,
): NewActivityState => ({ fingerprint, pending: false });

/**
 * Fold the latest tail fingerprint into the register.
 *
 * `following` is the scroller's own reading - the same `TAIL_EPS_PX` window the
 * paging policy follows the tail by - so the chip's label and the paging
 * policy's notion of "at the newest row" are one fact and cannot drift into the
 * band where paging refuses to follow but the chip says there is nothing new.
 *
 * A following reader clears the register: they are at the tail, so anything
 * that arrives is on screen. A reader away from it accumulates: either this
 * change is activity, or an earlier one still is.
 */
export const advanceNewActivity = (
	state: NewActivityState,
	next: ActivityFingerprint,
	following: boolean,
): NewActivityState => {
	const arrival = tailArrival(state.fingerprint, next);
	const arrived = arrival === "appended" || arrival === "grew";
	const pending = following ? false : state.pending || arrived;
	if (pending === state.pending && fingerprintEqual(state.fingerprint, next)) {
		return state;
	}
	return { fingerprint: next, pending };
};

const fingerprintEqual = (
	a: ActivityFingerprint,
	b: ActivityFingerprint,
): boolean =>
	a.count === b.count &&
	a.newestId === b.newestId &&
	a.newestExtent === b.newestExtent;

/**
 * The paging policy's own "the reader is following the tail" - deliberately
 * the same epsilon, in the same direction, and reusing the same constant
 * (`TAIL_EPS_PX`), because two numbers here is how the chip and the policy
 * came to disagree over the 24-50px band in the first place.
 */
export const followsTail = (scrollTopPx: number): boolean =>
	Math.abs(scrollTopPx) <= TAIL_EPS_PX;

/**
 * Whether the jump-to-latest control belongs on screen: the scroller has
 * somewhere to go, and the reader is not already at the newest row.
 *
 * The invariant the tests hold: on a scrollable transcript this is exactly the
 * negation of `followsTail`, so "chip hidden" and "following" are one fact.
 */
export const chipVisibleAt = (
	scrollTopPx: number,
	scrollHeightPx: number,
	clientHeightPx: number,
): boolean => scrollHeightPx - clientHeightPx > 1 && !followsTail(scrollTopPx);
