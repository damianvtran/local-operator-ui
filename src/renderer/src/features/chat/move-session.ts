/**
 * Moving a LIVE session's working directory: one write path, one copy table.
 *
 * Every way a user can ask for a move lands here - the composer's working
 * directory chip, and a typed `/move <path>` - so the sentences and the failure
 * handling cannot drift between two surfaces that answer the same question. (The
 * bare `/move` form chooses no directory itself: it focuses the composer's chip
 * and opens its menu, so the choice happens in one control with one write path,
 * rather than in a dialog that would host that same chip one popper deep.) The
 * backend route
 * (`POST /v1/desktop/sessions/{id}/working-directory`, reached as the
 * `sessions.move` op) is the only thing that can actually move a session: the
 * directory a runtime starts in is baked in at spawn, so the work happens in the
 * server process against the session's viewer, and the TUI's `/move` machinery
 * behind it owns the cold/bound/busy semantics. Nothing here duplicates them.
 *
 * TWO THINGS THIS FILE IS CAREFUL ABOUT, both of them defects if it were not:
 *
 *  1. The label printed to the user is the BACKEND's (`MoveReceipt.label`),
 *     never a path formatted here. Only the process that owns the session knows
 *     how to spell `~`, and a client-side home would print the CLIENT's home for
 *     a remote backend - a different directory with the same name. The absolute
 *     `cwd` is the value the optimistic chip compares against the canonical
 *     stream; the label is what the user reads. `useSessionMove` below is the
 *     only consumer of the first, `note` of the second.
 *  2. `evalUsed` is a per-session LATCH, not a live reading, and its limits are
 *     the TUI's own (see `useEvalUsage`). The eval interpreter registry lives in
 *     the runtime child, so no viewer can ask "is a kernel resident" without a
 *     wire op that would exist for one clause of one sentence. "This
 *     conversation has run `eval`" is the claim, never "you had live variables".
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { DesktopMoveReceipt } from "../../../../shared/desktop-session-contract";
import type { TranscriptRecord } from "./canonical/transcript-reducer";

/**
 * The chip's read-only sentence when the backend cannot move a live session.
 *
 * One constant for the places that state it - the chip's tooltip and a typed
 * `/move <path>` - because a copy in each is
 * how one refusal starts reading three ways. It names both remedies rather than
 * only "update": a user who cannot update this minute still has a way forward
 * (a new chat in the directory they want), and the old sentence they used to
 * read ("set when the session starts and cannot be changed afterwards") becomes
 * FALSE against a backend that can move one - which is the one wording change
 * this feature owes users who never touch it.
 */
export const MOVE_UNAVAILABLE_REASON =
	"This backend cannot move a live session. Start a new chat to use a different folder, or update the backend.";

/**
 * The chip's read-only sentence while the session it belongs to is being CREATED.
 *
 * A second reason, because the first one is false here. The composer's chip has
 * no write path in the window between a draft being sent and its session being
 * live: `draftKey` survives admission (the pane is keyed on the session identity
 * so it does not remount), while a move would race the directory
 * `sessions.create` is creating. Reading that window with the capability sentence
 * above claimed three untrue things at once - that the backend cannot move a live
 * session, that the user should start a new chat (they are watching one start),
 * and that updating the backend would help (agent review m1).
 *
 * It is deliberately not phrased as an error: nothing failed, and half a second
 * later the chip is editable. The tooltip is the only place it appears, because a
 * transient creation is not worth a transcript note.
 */
export const MOVE_NOT_READY_REASON =
	"This session is still starting. Its working directory can be moved as soon as it is live.";

/**
 * Whether this renderer may move a live session against this backend.
 *
 * TWO contracts, and both are required, which is why this is one exported
 * predicate rather than the same pair of calls repeated on the three surfaces
 * that gate on it (the composer's chip, the typed `/move <path>` form, and the
 * hook that owns the request latch). Two flags for one decision is how one
 * surface ends up offering a move another refuses.
 *
 *  - `session_move` is **2** as of the exclusivity fence: a move now refuses
 *    while another actual attached facade (a terminal, another viewer) is
 *    registered, so a backend at version 1 no longer behaves the way this
 *    renderer's copy promises. Version 1 remains READABLE by the old
 *    presence-only check, which is why the bump does not hide the route - it
 *    only withdraws the promise the renderer makes about it.
 *  - `frontend_replace` is the replacement frame a move publishes, and it is the
 *    ONLY thing that carries the accepted directory to a viewer that is already
 *    mounted: the cold path has no successor runtime to republish it. A renderer
 *    that cannot consume that frame must therefore keep its move controls
 *    DISABLED even against a backend advertising `session_move`, or the move
 *    would be accepted and then never painted.
 *
 * `desktopFeatureEnabled` fails closed on absent capabilities, so an older
 * backend - which advertises neither key, or `session_move: 1` - keeps the
 * read-only chip it has always rendered.
 */
export function sessionMoveEnabled(
	capabilities: DesktopCapabilities | null | undefined,
): boolean {
	return (
		desktopFeatureEnabled(capabilities, "session_move", 2) &&
		desktopFeatureEnabled(capabilities, "frontend_replace")
	);
}

/**
 * What is said when a move fails for a reason the backend did not author.
 *
 * A transport failure, a dropped owner or a crash has no sentence of its own, and
 * quoting the exception is the failure mode `userFacingMessage` exists to stop.
 * The wording states only what is certainly true: the directory did not change.
 */
const MOVE_FAILED_FALLBACK = "The working directory was not changed.";

/**
 * How long the optimistic value is held waiting for the stream to agree.
 *
 * The successor boot is documented at 1-3 s (spawn, bind, publish), and this is
 * several times that so a slow machine is not treated as a failed move. Past it
 * the chip falls back to the canonical stream's own value: holding a value the
 * stream never confirms would be the one thing this latch exists to prevent - a
 * chip that names a directory the session does not work in.
 */
export const MOVE_SETTLE_TIMEOUT_MS = 15_000;

/**
 * What a move resolved to, for the surfaces that asked for it.
 *
 * A receipt-or-null answered "did it happen", which was not enough for the
 * surfaces that have to SAY what happened: the chip's live region may only
 * announce the backend's own outcome (design review D3, UX U1 - it used to
 * announce a success decided by a client-side existence check the moment the
 * request was already refused), and the recents list may only remember a
 * directory a move actually reached (UX U7). Both are the sentence or the
 * receipt, so the sentence travels with the result rather than being recomposed
 * by every caller.
 */
export type MoveRunOutcome =
	/** The backend answered. `receipt.outcome` says whether anything moved. */
	| { kind: "settled"; receipt: DesktopMoveReceipt; sentence: string }
	/** The move did not happen, in the backend's own sentence where it had one. */
	| { kind: "refused"; sentence: string };

/**
 * What a COMMIT resolved to, which is the run outcome plus the two ways a commit
 * never became a request.
 */
export type MoveCommitOutcome =
	| MoveRunOutcome
	/**
	 * A second commit while this session's first was still settling. Dropped, and
	 * deliberately not posted: one receipt settles one latch, so a second request
	 * in flight would let the FIRST reply land on the second latch and paint a
	 * directory the session is not in (agent review m2).
	 */
	| { kind: "in-flight" }
	/** No write path here (no capability, or no session): nothing was posted. */
	| { kind: "unavailable" };

/**
 * Move a session's working directory, and say what happened.
 *
 * The outcome carries the receipt, because its `cwd` is load-bearing for the
 * caller: the chip holds its optimistic value until the canonical stream reports
 * THAT directory, and no other value can settle it (`useSessionMove`).
 *
 * `requestId` is the caller's, not a fresh one per call: the op carries it on the
 * wire, and the latch that waits for the reply is keyed by the same id, so a late
 * reply to a superseded request is identifiable rather than merely unlikely.
 *
 * The tense of the `rebound` sentence is deliberately the TUI's own with one
 * change. The TUI says "restarted there" because it awaits the successor; this
 * response returns as soon as the runtime has been ASKED to retire, so
 * "restarting" is the claim the backend can actually make.
 */
export async function runMoveSession(input: {
	sessionId: string;
	cwd: string;
	requestId: string;
	note: (text: string, error?: boolean) => void;
	evalUsed: boolean;
}): Promise<MoveRunOutcome> {
	try {
		const receipt = await desktopResult<DesktopMoveReceipt>({
			op: "sessions.move",
			sessionId: input.sessionId,
			requestId: input.requestId,
			cwd: input.cwd,
		});
		const sentence = moveReceiptLine(receipt, input.evalUsed);
		input.note(sentence);
		return { kind: "settled", receipt, sentence };
	} catch (error) {
		// The backend's own sentence when it authored one - "this session is
		// working right now...", "no such directory: ...", the 409 ladder's
		// reconnect notice - and the fallback above when it did not. A generic
		// "something went wrong" here would throw away the only thing that tells
		// the user which of those happened.
		const sentence = userFacingMessage(error, MOVE_FAILED_FALLBACK);
		input.note(sentence, true);
		return { kind: "refused", sentence };
	}
}

/**
 * The receipt in one line, for the transcript note that reports the move.
 *
 * Exported because more than one caller needs the same sentence about the same
 * move, and a sentence composed twice is how one surface starts describing a
 * different outcome than the other.
 *
 * THE NOTE IS NOT DURABLE, and this comment used to claim it was ("the note is
 * the durable copy", UX review U11). It is written with `appendLocalNote`: it
 * lives in the renderer's view, never in the conversation on disk, so after an
 * app restart the transcript shows the conversation and none of the move
 * receipts, while the chip and the stream still name the moved directory. That
 * is a real limitation of this release rather than a defect in the sentence -
 * persisting a lifecycle receipt is a change to the transcript's own storage -
 * and the honest thing is to say it here instead of calling a client-side line
 * durable.
 */
export function moveReceiptLine(
	receipt: DesktopMoveReceipt,
	evalUsed: boolean,
): string {
	if (receipt.outcome === "unchanged") return `already in ${receipt.label}`;
	if (receipt.outcome === "cold") return `moved to ${receipt.label}`;
	return evalUsed
		? `moved to ${receipt.label} — this session's runtime is restarting there, so everything you set up in eval was lost`
		: `moved to ${receipt.label} — this session's runtime is restarting there`;
}

/**
 * The context the picker registry hands the argument form of `/move`.
 *
 * Declared here rather than in `picker-registry` because the runner that fills
 * it is here: the registry's table points at `runMoveSessionFromDispatch`
 * without having to know what a move needs to read.
 */
export type MoveRunContext = {
	sessionId: string;
	cwd: string;
	canonical: CanonicalSessionHandle;
	note: (text: string, error?: boolean) => void;
	moveTo: (path: string) => Promise<MoveCommitOutcome>;
};

/**
 * The registry's `runArgs`: a typed `/move <path>` IS the action.
 *
 * The one destination on the desktop whose arguments execute rather than open
 * something, which is the TUI's rule in the same words (`_cmd_move` applies the
 * argument form and only opens the picker for the bare form). It saves a round
 * trip whose only answer would be "please now do the thing" - and it means a
 * path is never posted to the command endpoint, where it could only be answered
 * with the runtime's wrong refusal for `move`.
 */
export async function runMoveSessionFromDispatch(
	context: MoveRunContext,
): Promise<void> {
	// Typed arguments and the chip share one admission latch. Calling the raw
	// transport here would allow a second move while the chip's request settles.
	const outcome = await context.moveTo(context.cwd);
	if (outcome.kind === "in-flight") {
		context.note("A working-directory move is already in progress.", true);
	} else if (outcome.kind === "unavailable") {
		context.note(MOVE_UNAVAILABLE_REASON, true);
	}
}

/**
 * Whether a transcript has run `eval`.
 *
 * Pure and exported so the claim `useEvalUsage` makes is testable without a
 * DOM: the latch's own state is a React ref, but the QUESTION it answers is this
 * predicate, and a predicate that only existed inside an effect is a predicate
 * nothing can falsify. `eval` is the runtime's own name for the tool
 * (`toolName`), which is the same field the canonical tool row renders from.
 */
export function transcriptRanEval(
	records: readonly TranscriptRecord[],
): boolean {
	return records.some(
		(record) => record.kind === "tool" && record.toolName === "eval",
	);
}

/**
 * Has this conversation run `eval`?
 *
 * The desktop's port of the TUI's eval-warning latch, and it is a latch for the
 * same reason: the registry of live interpreters lives in the runtime child, so
 * "a kernel is resident right now" is not knowable from here at all. What IS
 * knowable is the canonical transcript the app already holds: a `tool` record
 * named `eval` means this conversation has used the eval tool.
 *
 * Keyed by SESSION id and not by a bare boolean - the bug the TUI hit and fixed
 * with a set of ids. A boolean would carry one session's `eval` into the next
 * one's receipt, and the clause would then claim something false about a
 * conversation that never ran one.
 *
 * Two limits, both inherited from the TUI rather than accepted quietly: a
 * resumed session is covered by the history replay the app performs on open (so
 * only what was paged in is seen), and a call older than the fetched window
 * under-warns. Under-warning is the direction the TUI chose deliberately - this
 * clause is a courtesy, not a guard - and a second source of the fact (a scan of
 * the session's transcript on disk, which reaches ~100 MB) is exactly what it
 * declined to build.
 */
export function useEvalUsage(
	sessionId: string | undefined,
	canonical: CanonicalSessionHandle,
): boolean {
	const latch = useRef<EvalLatch>(EMPTY_EVAL_LATCH);
	// The latch is a ref so it survives re-renders without re-scanning, but the
	// caller needs ONE repaint when it flips - the transcript delta that carries
	// the eval row is what wakes this effect, and the repaint is what lets the
	// next commit read the new value.
	const [, bump] = useState(0);
	const records = canonical.transcript.records;

	useEffect(() => {
		const next = evalLatchAfterObserving(latch.current, sessionId, records);
		if (next === latch.current) return;
		latch.current = next;
		bump((value) => value + 1);
	}, [records, sessionId]);

	return evalLatchHolds(latch.current, sessionId);
}

/**
 * The latch's shape: the ids of the sessions whose conversation has run `eval`.
 *
 * A SET, never a bare boolean, and that is the whole point of the type. The
 * receipt's eval clause is about ONE conversation, and a boolean would carry the
 * first conversation's `eval` into every later one - the same defect the TUI
 * fixed with a set of ids (`tui/app.py`). Naming the type is what lets the
 * keying be asserted as BEHAVIOUR rather than by grepping the hook's source for
 * a spelling of `false` (agent review n1: the old pin passed a rewrite that
 * used `useState(false)`, which is the defect it existed to catch).
 */
export type EvalLatch = ReadonlySet<string>;

/** The empty latch, shared so "nothing observed yet" is one value. */
export const EMPTY_EVAL_LATCH: EvalLatch = new Set<string>();

/**
 * Fold one observation into the latch.
 *
 * Returns the SAME set when nothing changed, which is what lets the caller skip
 * a repaint without comparing contents. `sessionId` undefined is the sessionless
 * composer (a draft): there is no id to key, so nothing is recorded, and the
 * clause cannot be claimed for a conversation that does not exist yet.
 */
export function evalLatchAfterObserving(
	latch: EvalLatch,
	sessionId: string | undefined,
	records: readonly TranscriptRecord[],
): EvalLatch {
	if (!sessionId || latch.has(sessionId)) return latch;
	if (!transcriptRanEval(records)) return latch;
	return new Set(latch).add(sessionId);
}

/** Whether the latch holds this session - and only this session. */
export function evalLatchHolds(
	latch: EvalLatch,
	sessionId: string | undefined,
): boolean {
	return Boolean(sessionId && latch.has(sessionId));
}

/** What a pending move looks like while it is in flight. */
export type PendingMove = {
	/**
	 * The session the move addresses. Held so a value for ANOTHER session can never
	 * paint: a user who switches conversation mid-move must not see the other
	 * session's pending directory on this one's chip.
	 */
	sessionId: string;
	/**
	 * The request's own `uuidv4()` - the id this move travels on.
	 *
	 * The op already carries it on the wire (`requestId`), and holding it beside the
	 * latch is what makes a LATE reply identifiable: two commits in quick
	 * succession are two requests, and without an identity the first one's receipt
	 * would settle the second one's latch and paint a directory that move never
	 * asked for (agent review m2).
	 */
	requestId: string;
	/** The path the user chose, painted by the chip immediately. */
	path: string;
	/**
	 * The absolute directory the receipt named, or null until it answers.
	 *
	 * The stream's `frontend.cwd` is compared against THIS value and never against
	 * the path the user typed, because a typed path is not the directory in force:
	 * `~`, a relative path and a symlink all resolve inside the backend, against a
	 * home and a working directory this renderer does not own.
	 */
	target: string | null;
	/** Absolute receipt deadline; switching panes must not restart the wait. */
	settleBy?: number;
};

/**
 * The pending latch's four transitions - the three rules, as pure functions.
 *
 * Exported rather than left inline in the hook because each one IS a rule that
 * keeps the chip from naming a directory the session does not work in, and a rule
 * that exists only inside a React effect is a rule no test can falsify. Every
 * transition is total and keyed by session id or by request id: a value belonging
 * to ANOTHER session - or to a SUPERSEDED request - is never touched, which is
 * what makes a conversation switch mid-move leave both chips correct (the TUI's
 * own eval-flag bug, in a different place) and what stops a stale reply from
 * settling the current latch.
 */

/** Keep independently pending sessions; stale replies cannot replace a neighbour. */
export function updatePendingMoves(
	moves: ReadonlyMap<string, PendingMove>,
	sessionId: string,
	update: (move: PendingMove | null) => PendingMove | null,
): ReadonlyMap<string, PendingMove> {
	const previous = moves.get(sessionId) ?? null;
	const next = update(previous);
	if (next === previous) return moves;
	const result = new Map(moves);
	if (next) result.set(sessionId, next);
	else result.delete(sessionId);
	return result;
}

/** A commit: the optimistic value is painted before the request leaves. */
export function pendingAfterCommit(
	sessionId: string,
	requestId: string,
	path: string,
): PendingMove {
	return { sessionId, requestId, path, target: null };
}

/**
 * A refusal: the optimistic value is DROPPED, so the chip reverts to the value
 * the canonical stream reports rather than stranding the path the backend
 * refused. This is rule 2, and it is the whole reason the write path returns a
 * result instead of only writing a note.
 *
 * The bounded wait of rule 3's second exit calls this too: past the timeout the
 * stream's value wins and the chip stops claiming anything. Both exits are keyed
 * by the REQUEST id, so neither can clear a latch a newer move just armed.
 */
export function pendingAfterFailure(
	pending: PendingMove | null,
	requestId: string,
): PendingMove | null {
	return pending?.requestId === requestId ? null : pending;
}

/** The receipt: the resolved directory, which is what the stream must agree with. */
export function pendingAfterReceipt(
	pending: PendingMove | null,
	requestId: string,
	target: string,
	now = Date.now(),
): PendingMove | null {
	if (!pending || pending.requestId !== requestId) return pending;
	return {
		...pending,
		target,
		settleBy: pending.settleBy ?? now + MOVE_SETTLE_TIMEOUT_MS,
	};
}

/**
 * A stream frame: rule 3.
 *
 * The value is held until the stream reports exactly the directory the receipt
 * named - NOT until any frame arrives, and not `undefined` either. A late frame
 * carrying the OLD cwd is expected after a `rebound` (the retiring runtime's last
 * words name the directory it was started in), so treating "a frame arrived" as
 * agreement would revert the chip to a directory the session has already left.
 */
export function pendingAfterStream(
	pending: PendingMove | null,
	sessionId: string | undefined,
	streamCwd: string | undefined,
): PendingMove | null {
	if (!pending || pending.sessionId !== sessionId) return pending;
	return pending.target !== null && streamCwd === pending.target
		? null
		: pending;
}

/**
 * The composer chip's view of a move: what to show, how to ask, and whether one
 * is in flight.
 *
 * The three rules that keep the chip from naming a directory the session does
 * not work in are stated in the design and enforced here, each in one place:
 *
 *  1. the displayed value is the PROP (`cwd`) and never the chip's own local
 *     state, so a move that fails reverts to what the stream reports;
 *  2. `pending` is cleared the moment the move FAILS, which is what makes a
 *     refusal revert rather than strand the optimistic value;
 *  3. `pending` SURVIVES a late `frontend.update` still carrying the OLD cwd.
 *     That frame is expected, not a signal that the move was undone: after a
 *     `rebound` the old runtime is retiring and its last frames name the old
 *     directory. The latch is cleared only by an observed
 *     `frontend.cwd === target`, or by `MOVE_SETTLE_TIMEOUT_MS`, after which the
 *     stream's value wins and the chip stops claiming anything.
 *
 * One commit per settle. A second commit on the SAME session while its first is
 * still in flight returns `in-flight` and posts nothing: the latch holds one
 * request's identity, so a second request would leave the first one's receipt
 * with nothing to settle and let its directory paint under the second path.
 * A commit on a DIFFERENT session is not affected - the latch is keyed by
 * session, so switching conversations and moving there is an ordinary move, and
 * each session retains its own request identity and absolute settle deadline.
 * Returning to A after moving B cannot admit a second operation on A.
 */
export function useSessionMove(input: {
	sessionId: string | undefined;
	canonical: CanonicalSessionHandle;
	capabilities: DesktopCapabilities | null | undefined;
}): {
	/** What the chip should display: the optimistic value, else the stream's. */
	cwd: string | undefined;
	/**
	 * Commit a chosen directory. A no-op without the capability, and a dropped
	 * no-op while this session's previous commit is still settling.
	 */
	moveTo: (path: string) => Promise<MoveCommitOutcome>;
	/** A move is in flight for THIS session. */
	busy: boolean;
} {
	const { sessionId, canonical } = input;
	const [moves, setMoves] = useState<ReadonlyMap<string, PendingMove>>(
		new Map(),
	);
	const pending = sessionId ? (moves.get(sessionId) ?? null) : null;
	const enabled = sessionMoveEnabled(input.capabilities);
	const addNote = canonical.addNote;
	const evalUsed = useEvalUsage(sessionId, canonical);
	const streamCwd = canonical.frontend?.cwd;

	/*
	 * The write path reads the latch through a REF, not through the render's value.
	 *
	 * Two commits inside one tick (a double Enter, a menu row plus a keypress) would
	 * both see the same rendered `pending` and both post, which is exactly the
	 * two-requests-one-latch state `moveTo` refuses. The ref is assigned
	 * synchronously at commit time and mirrored after every render, so the second
	 * caller sees the first one's request.
	 */
	const pendingRef = useRef(moves);
	useEffect(() => {
		pendingRef.current = moves;
	}, [moves]);

	const note = useCallback(
		(text: string, error = false) => {
			addNote(text, error ? "error" : "info");
		},
		[addNote],
	);

	const moveTo = useCallback(
		async (path: string): Promise<MoveCommitOutcome> => {
			// Belt as well as braces: the chip is read-only without the capability,
			// so this cannot normally be reached - but a caller that ignored the gate
			// would otherwise spend a round trip learning 404 (the reason the gate
			// exists at all).
			if (!enabled || !sessionId) return { kind: "unavailable" };
			const inFlight = pendingRef.current.get(sessionId);
			if (inFlight) {
				return { kind: "in-flight" };
			}
			const requestId = uuidv4();
			const committed = pendingAfterCommit(sessionId, requestId, path);
			pendingRef.current = new Map(pendingRef.current).set(
				sessionId,
				committed,
			);
			setMoves(pendingRef.current);
			const outcome = await runMoveSession({
				sessionId,
				cwd: path,
				requestId,
				note,
				evalUsed,
			});
			setMoves((current) =>
				updatePendingMoves(current, sessionId, (move) =>
					outcome.kind === "settled"
						? pendingAfterReceipt(move, requestId, outcome.receipt.cwd)
						: pendingAfterFailure(move, requestId),
				),
			);
			return outcome;
		},
		[enabled, sessionId, note, evalUsed],
	);

	// Rule 3's first exit: the stream agreeing, keyed by session so another
	// session's frames say nothing about this latch.
	useEffect(() => {
		if (!sessionId || !pending) return;
		setMoves((current) =>
			updatePendingMoves(current, sessionId, (move) =>
				pendingAfterStream(move, sessionId, streamCwd),
			),
		);
		// The stream may arrive BEFORE the receipt. Reconcile on either edge.
	}, [pending, sessionId, streamCwd]);

	/*
	 * Rule 3's second exit: the bounded wait, armed against the RECEIPT.
	 *
	 * Deliberately not gated on the latch's session being the VISIBLE one. It used
	 * to be, so a move abandoned by a session switch held its optimistic value for a
	 * further `MOVE_SETTLE_TIMEOUT_MS` after the user came back - the wait restarted
	 * from the return rather than running from the receipt (agent review m2, second
	 * half). The timer is keyed by the request id, so a newer move's latch is not
	 * cleared by an older move's deadline.
	 */
	useEffect(() => {
		const timers = [...moves.values()].flatMap((move) => {
			if (move.settleBy === undefined) return [];
			return [
				setTimeout(
					() => {
						setMoves((current) =>
							updatePendingMoves(current, move.sessionId, (value) =>
								pendingAfterFailure(value, move.requestId),
							),
						);
					},
					Math.max(0, move.settleBy - Date.now()),
				),
			];
		});
		return () => {
			for (const timer of timers) clearTimeout(timer);
		};
	}, [moves]);

	const active = pending && pending.sessionId === sessionId ? pending : null;

	return useMemo(
		() => ({
			cwd: active?.target ?? active?.path ?? streamCwd,
			moveTo,
			busy: Boolean(active),
		}),
		[active, moveTo, streamCwd],
	);
}
