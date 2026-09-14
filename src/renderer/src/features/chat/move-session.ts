/**
 * Moving a LIVE session's working directory: one write path, one copy table.
 *
 * Every way a user can ask for a move lands here - the composer's working
 * directory chip, the `session.move` picker, and a typed `/move <path>` - so the
 * sentences and the failure handling cannot drift between three surfaces that
 * answer the same question. The backend route
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
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import type { DesktopMoveReceipt } from "../../../../shared/desktop-session-contract";
import type { TranscriptRecord } from "./canonical/transcript-reducer";

/**
 * The chip's read-only sentence when the backend cannot move a live session.
 *
 * One constant for the three places that state it - the chip's tooltip, the
 * picker that cannot run and a typed `/move <path>` - because a copy in each is
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
 * Move a session's working directory, and say what happened.
 *
 * Returns the receipt the backend answered, or `null` when the move did not
 * happen (the refusal - busy, skewed, bad path, unmounted volume, transport - is
 * in `note`'s line). The receipt is returned rather than a bare success because
 * its `cwd` is load-bearing for the caller: the chip holds its optimistic value
 * until the canonical stream reports THAT directory, and no other value can
 * settle it (`useSessionMove`).
 *
 * The tense of the `rebound` sentence is deliberately the TUI's own with one
 * change. The TUI says "restarted there" because it awaits the successor; this
 * response returns as soon as the runtime has been ASKED to retire, so
 * "restarting" is the claim the backend can actually make.
 */
export async function runMoveSession(input: {
	sessionId: string;
	cwd: string;
	note: (text: string, error?: boolean) => void;
	evalUsed: boolean;
}): Promise<DesktopMoveReceipt | null> {
	try {
		const receipt = await desktopResult<DesktopMoveReceipt>({
			op: "sessions.move",
			sessionId: input.sessionId,
			requestId: uuidv4(),
			cwd: input.cwd,
		});
		input.note(moveReceiptLine(receipt, input.evalUsed));
		return receipt;
	} catch (error) {
		// The backend's own sentence when it authored one - "this session is
		// working right now...", "no such directory: ...", the 409 ladder's
		// reconnect notice - and the fallback above when it did not. A generic
		// "something went wrong" here would throw away the only thing that tells
		// the user which of those happened.
		input.note(userFacingMessage(error, MOVE_FAILED_FALLBACK), true);
		return null;
	}
}

/**
 * The receipt in one line - the transcript note AND the picker's result strip.
 *
 * Exported because those two surfaces say the same thing about the same move: the
 * strip is the answer while the dialog is up, the note is the durable copy, and a
 * sentence composed twice is how one of them starts describing a different
 * outcome than the other.
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
	evalUsed: boolean;
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
	await runMoveSession({
		sessionId: context.sessionId,
		cwd: context.cwd,
		note: context.note,
		evalUsed: context.evalUsed,
	});
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
	const seen = useRef<Set<string>>(new Set());
	// The latch is a ref so it survives re-renders without re-scanning, but the
	// caller needs ONE repaint when it flips - the transcript delta that carries
	// the eval row is what wakes this effect, and the repaint is what lets the
	// next commit read the new value.
	const [, bump] = useState(0);
	const records = canonical.transcript.records;

	useEffect(() => {
		if (!sessionId) return;
		if (seen.current.has(sessionId)) return;
		if (!transcriptRanEval(records)) return;
		seen.current.add(sessionId);
		bump((value) => value + 1);
	}, [records, sessionId]);

	return Boolean(sessionId && seen.current.has(sessionId));
}

/** What a pending move looks like while it is in flight. */
export type PendingMove = {
	/**
	 * The session the move addresses. Held so a value for ANOTHER session can never
	 * paint: a user who switches conversation mid-move must not see the other
	 * session's pending directory on this one's chip.
	 */
	sessionId: string;
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
};

/**
 * The pending latch's four transitions - the three rules, as pure functions.
 *
 * Exported rather than left inline in the hook because each one IS a rule that
 * keeps the chip from naming a directory the session does not work in, and a rule
 * that exists only inside a React effect is a rule no test can falsify. Every
 * transition is total and keyed by session id: a value belonging to ANOTHER
 * session is never touched, which is what makes a conversation switch mid-move
 * leave both chips correct (the TUI's own eval-flag bug, in a different place).
 */

/** A commit: the optimistic value is painted before the request leaves. */
export function pendingAfterCommit(
	sessionId: string,
	path: string,
): PendingMove {
	return { sessionId, path, target: null };
}

/**
 * A refusal: the optimistic value is DROPPED, so the chip reverts to the value
 * the canonical stream reports rather than stranding the path the backend
 * refused. This is rule 2, and it is the whole reason the write path returns a
 * result instead of only writing a note.
 */
export function pendingAfterFailure(
	pending: PendingMove | null,
	sessionId: string | undefined,
): PendingMove | null {
	return pending?.sessionId === sessionId ? null : pending;
}

/** The receipt: the resolved directory, which is what the stream must agree with. */
export function pendingAfterReceipt(
	pending: PendingMove | null,
	sessionId: string | undefined,
	target: string,
): PendingMove | null {
	if (!pending || pending.sessionId !== sessionId) return pending;
	return { ...pending, target };
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
 */
export function useSessionMove(input: {
	sessionId: string | undefined;
	canonical: CanonicalSessionHandle;
	capabilities: DesktopCapabilities | null | undefined;
}): {
	/** What the chip should display: the optimistic value, else the stream's. */
	cwd: string | undefined;
	/** Commit a chosen directory. A no-op without the capability. */
	moveTo: (path: string) => void;
	/** A move is in flight for THIS session. */
	busy: boolean;
} {
	const { sessionId, canonical } = input;
	const [pending, setPending] = useState<PendingMove | null>(null);
	const enabled = desktopFeatureEnabled(input.capabilities, "session_move");
	const addNote = canonical.addNote;
	const evalUsed = useEvalUsage(sessionId, canonical);
	const streamCwd = canonical.frontend?.cwd;

	const note = useCallback(
		(text: string, error = false) => {
			addNote(text, error ? "error" : "info");
		},
		[addNote],
	);

	const moveTo = useCallback(
		(path: string) => {
			// Belt as well as braces: the chip is read-only without the capability,
			// so this cannot normally be reached - but a caller that ignored the gate
			// would otherwise spend a round trip learning 404 (the reason the gate
			// exists at all).
			if (!enabled || !sessionId) return;
			setPending(pendingAfterCommit(sessionId, path));
			void (async () => {
				const receipt = await runMoveSession({
					sessionId,
					cwd: path,
					note,
					evalUsed,
				});
				if (!receipt) {
					setPending((current) => pendingAfterFailure(current, sessionId));
					return;
				}
				setPending((current) =>
					pendingAfterReceipt(current, sessionId, receipt.cwd),
				);
			})();
		},
		[enabled, sessionId, note, evalUsed],
	);

	// Rule 3's two exits: the stream agreeing, and a bounded wait after the
	// receipt. See `pendingAfterStream` and `MOVE_SETTLE_TIMEOUT_MS`.
	useEffect(() => {
		setPending((current) => pendingAfterStream(current, sessionId, streamCwd));
	}, [sessionId, streamCwd]);

	useEffect(() => {
		if (!pending || pending.sessionId !== sessionId || pending.target === null)
			return;
		const timer = setTimeout(() => {
			setPending((current) => pendingAfterFailure(current, sessionId));
		}, MOVE_SETTLE_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [pending, sessionId]);

	const active = pending && pending.sessionId === sessionId ? pending : null;

	return useMemo(
		() => ({
			cwd: active?.path ?? streamCwd,
			moveTo,
			busy: Boolean(active),
		}),
		[active, moveTo, streamCwd],
	);
}

/**
 * The capability read the picker and the dispatch branch need on their own.
 *
 * A thin wrapper over `useDesktopCapabilities` so both call sites ask the same
 * question the same way the chip does - `session_move`, not `commands`.
 */
export function useSessionMoveCapability(): {
	capabilities: DesktopCapabilities | null | undefined;
	enabled: boolean;
} {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "session_move");
	return useMemo(
		() => ({ capabilities: capabilities.data, enabled }),
		[capabilities.data, enabled],
	);
}
