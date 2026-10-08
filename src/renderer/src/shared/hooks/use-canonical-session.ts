/**
 * Canonical desktop session stream consumption.
 *
 * Applies the backend's stream contract to renderer state:
 *
 * - Frames after `open` up to and including `snapshot` are REPLAY: they are
 *   collected, and the snapshot (the authoritative state) is applied after
 *   them, so an old cumulative delta can never repaint newer snapshot text.
 * - After the snapshot, `frontend.update` frames apply canonical field deltas
 *   with the OWNER epoch/sequence checked independently of the HTTP receipt
 *   cursor — the two cursors are different clocks.
 * - `event` frames carry typed canonical AgentEvents; a terminal event is what
 *   resolves the "Waiting to start" latch. The receipt cursor is for
 *   dedupe/reconnect — at the receipt and, per row, at the reducer's cursor
 *   gate (a re-delivered `message_update` is refused rather than appended) —
 *   and never for deciding what is newer paint state.
 * - A `gap` frame (or any replay-with-gap open) says the receipt lost continuity:
 *   painted FRONTEND state is dropped, and the transcript's in-flight rows are
 *   KEPT and marked uncertain (`markLiveRecordsTruncated`) rather than erased,
 *   because the snapshot that follows states what happened in the interval for
 *   every id it names and erasing them repainted the answer being written as its
 *   last chunk alone.
 *
 * Per-record coalescing happens at the frame queue: one animation frame per
 * batch of IPC deliveries, not one render per token. The transcript itself is
 * folded here too, through the pure reducer in
 * `features/chat/canonical/transcript-reducer`: replayed events fold into a
 * scratch state that the snapshot's durable page then overrides, so an older
 * replay can never regress a newer painted record. `performance.mark` pairs
 * (`lop:transcript:flush`) bracket every flush so streaming cost is
 * measurable in the browser's own timeline rather than estimated.
 */

import {
	EMPTY_TRANSCRIPT,
	RECONCILE_TAIL_ENTRIES,
	RECONCILE_TAIL_MAX_ENTRIES,
	type TranscriptImage,
	type TranscriptState,
	appendLocalNote,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	clearTranscript,
	isDurableOwnerRow,
	labelGapCandidates,
	labelTargetsBehind,
	labelTargetsBehindIds,
	markLiveRecordsTruncated,
	pageLabels,
	pageOpensTurn,
	pageOrphanResultInstants,
	pageOrphanResults,
	pagePassedOldestStart,
	queuedAskEngineLive,
	reconcileLimit,
	reconcileWalkDone,
	removeRecord,
	sealDisjointBlock,
	seedCallStarts,
	seedCallsMissingLabels,
	seedSettledCalls,
	seedWaitingComposes,
} from "@features/chat/canonical/transcript-reducer";
import { tailCarriesOutcome } from "@features/chat/components/compact-receipt";
import { modelSelector } from "@features/chat/session-status/session-model";
import {
	desktopResult,
	subscribeDesktopStream,
} from "@shared/api/local-operator/desktop-api";
import { useAsideStore } from "@shared/store/aside-store";
/*
 * Read at APPLY TIME rather than subscribed to (U7): the stopped-turn fact is
 * consulted inside the stream's own callback, where a selector has no meaning - the
 * value is needed at the instant a frame lands, not at the instant a component
 * renders. `chat-page`'s `send` reaches for the same `getState()` for the same
 * reason.
 */
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { dropPaint, readPaint, writePaint } from "@shared/store/paint-cache";
import { forgetTurnCollapseOpen } from "@shared/store/turn-collapse-open";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { desktopRequestTimeoutMs } from "../../../../shared/desktop-contract";
import {
	acceptFrontendReplace,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";
import type {
	CanonicalFrontendState,
	CanonicalModel,
	DesktopHistoryPage,
	DesktopSessionFrame,
	DesktopSnapshot,
} from "../../../../shared/desktop-session-contract";
import {
	DESKTOP_STREAM_DETAIL,
	HISTORY_UNREADABLE,
	type SessionFailureNotice,
	streamFailureNotice,
} from "../../../../shared/desktop-stream-notice";
import {
	type LoadOlderOutcome,
	createOlderLoader,
} from "../../features/chat/canonical/load-older";
/* The child-pulse rule (§ 5.3): the event set, the id rule and the bump. */
import { applySubagentPulse, seedSubagentPulses } from "./subagent-pulse";

/**
 * Route the aside chunks in one frame batch to their own store.
 *
 * WHY THIS IS HERE RATHER THAN IN THE TRANSCRIPT REDUCER, and why it is not a
 * branch of the loop below either. An `aside_delta` is a live-only chunk of an
 * OFF-RECORD exchange (see the frame's own comment): it is deliberately not an
 * `event`, precisely so it can never reach `applyEvent`/`applyLiveSeed` and be
 * painted into the conversation the aside promised not to join. So it is taken
 * out of the batch before the reducer sees it, keyed by `aside_id`, and landed in
 * `aside-store` where the panel reads it.
 *
 * IT RUNS OUTSIDE THE React UPDATER below, which is load-bearing rather than
 * tidy: an updater is required to be pure and React invokes it twice under
 * StrictMode, so appending a chunk from inside it would double that chunk's text
 * on screen — a defect that would look like the model stuttering, and one the
 * authoritative settle would then hide at the end of the answer.
 */
function applyAsideDeltas(frames: DesktopSessionFrame[]): void {
	for (const frame of frames) {
		if (frame.type !== "aside_delta") continue;
		useAsideStore
			.getState()
			.applyAsideDelta(frame.payload.aside_id, frame.payload.delta);
	}
}

/**
 * Whether a frame batch can move the session VIEW at all.
 *
 * ONLY TWO TYPES CANNOT, and they are exactly the two the fold in the flush
 * treats as invisible: `heartbeat` (skipped on the first line of the loop, and
 * never touching a view field) and `aside_delta` (routed to `aside-store` by
 * `applyAsideDeltas` above, and deliberately not a transcript event). Everything
 * else - `open`, `gap`, `snapshot`, `event`, `attention`, `frontend.update`,
 * `frontend.replace` - writes something the pane paints.
 *
 * WHY THE DISTINCTION IS WORTH A FUNCTION (review round 1, F5). The flush's
 * `setView` builds and returns a FRESH view object every time it runs, so a
 * batch of nothing but aside chunks re-rendered the whole pane - the composer
 * subtree included - once per chunk, at chunk cadence, for the whole answer. The
 * pane-wide re-render per batch is pre-existing; what the aside adds is a new
 * source of batches at that cadence.
 *
 * EXISTS OUTSIDE THE UPDATER, taking the batch as an argument, because the two
 * rules it would otherwise restate (a frame's type, and whether a chunk belongs
 * to the view) live one function above and must not be spelled a second time.
 *
 * EXPORTED so the classification itself is assertable, not merely its spelling
 * (review round 2, F8): the bail-out that depends on it is one line inside an
 * effect no node test can mount, so a source-text assertion would pass with the
 * condition flipped, with an `||` for the `&&`, or with a third inert type added
 * — each of which is a transcript that stops updating while the suite stays
 * green. `scripts/btw-aside.test.mjs` drives it by value instead, including the
 * fail-safe: `some()` defaults to "moves the view" for every type that is not
 * one of the two inert ones, so a frame type this function has never heard of
 * repaints rather than going silent.
 */
export function batchMovesView(frames: DesktopSessionFrame[]): boolean {
	return frames.some(
		(frame) => frame.type !== "aside_delta" && frame.type !== "heartbeat",
	);
}

export type CanonicalSessionStatus =
	| "connecting"
	| "live"
	| "reconnecting"
	| "unavailable";

export type CanonicalSessionView = {
	status: CanonicalSessionStatus;
	frontend: CanonicalFrontendState | null;
	/**
	 * The last AUTHORITATIVE `frontend` this pane painted, held across a
	 * transient stream gap.
	 *
	 * WHY THIS IS A SECOND FIELD RATHER THAN SIMPLY NOT CLEARING `frontend`.
	 * `frontend` is not "the readings we have", it is a statement about THIS
	 * epoch: the flush computes `snapshotted = next.frontend !== null` at the top
	 * of every batch, and that boolean is what routes a replayed `event` into the
	 * scratch transcript instead of letting it apply over newer snapshot text
	 * (see the replay/snapshot ordering contract on the loop). A gap clears
	 * `frontend` precisely so the frames of the replacement stream are treated as
	 * replay again; leaving the old object there would make the next batch treat
	 * a replayed delta as post-snapshot state, which is the older-text-regresses-
	 * newer-text bug that ordering exists to prevent.
	 *
	 * So the hook keeps BOTH facts. `frontend` keeps meaning "a snapshot for the
	 * current epoch has landed"; this holds the readings the pane was last told,
	 * for the surfaces that must not blank while a reconnect is in flight — the
	 * composer's readouts. It is REPLACED WHOLESALE by the next authoritative
	 * frontend (never merged field-by-field: a half-old reading is a state the
	 * owner never published), and it is dropped on every state that is terminal
	 * or that belongs to another conversation: the FOUR terminal `unavailable`
	 * writers in the stream effect (the snapshot deadline, the 404, the spent
	 * retry budget, and the `HISTORY_UNREADABLE` arm that gives up on
	 * `/history`), a genuine session change, and `/clear`. Each of those writes
	 * sits beside the reason it exists.
	 *
	 * IT IS NOT A LIVE CLAIM, and the surfaces that read it must not present it
	 * as one: `status` is `reconnecting` for exactly as long as this is the only
	 * frontend there is, and the status strip marks the readings it draws from it
	 * (`SessionStatusStripProps["held"]`).
	 */
	heldFrontend: CanonicalFrontendState | null;
	/**
	 * A model the user just chose, painted before the owner confirms it.
	 *
	 * A PENDING value, never a claimed one: it is dropped as soon as an
	 * authoritative frame names that model and rolled back by its own picker when
	 * the owner refuses. It exists because the two clocks differ — a pick that
	 * pays a cold runtime bind measures 1.1-4.2 s, and the owner's
	 * `frontend.update` frame lands 3-6 ms BEFORE the HTTP receipt once it is warm,
	 * so the band can usually be repainted from the stream alone (latency U1).
	 * Held OUTSIDE `frontend` rather than patched into it: the published snapshot
	 * stays the owner's, and a consumer that needs the unconfirmed value has to
	 * ask for it (the status strip is the one that does).
	 */
	pendingModel: CanonicalModel | null;
	history: DesktopHistoryPage | null;
	cold: boolean;
	subscriptionId: string | null;
	/**
	 * Whether this session's durable history has been PROVEN loaded.
	 *
	 * The difference between "this conversation is empty" and "we do not know
	 * yet", which the UI cannot otherwise tell apart: an empty record list looks
	 * identical either way, and the app asserted the greeting over conversations
	 * whose hundreds of rows had simply not arrived. True only when an
	 * authoritative page has been applied for this session (a snapshot that
	 * carried one, or a settled `/history` reconcile), false for everything else
	 * - including a stream that failed, because a failure is not an answer.
	 */
	hydrated: boolean;
	/**
	 * Whether a history read FOR THIS SESSION is in flight (remote-load-hydration).
	 *
	 * The retry-able "not loaded" arm's own press must be answerable: the walk a
	 * press (or the warm re-arm) fires reads `/history`, and while it is out the
	 * slot paints the pending arm rather than repainting the identical row the
	 * reader just pressed (UX round 1, U1). It is also the press's own guard:
	 * `rehydrate` is a no-op while a read is already out, so N presses can never
	 * stack N walks - the read in flight is already the question being asked.
	 * True for exactly the span some `reconcileTail` walk of this view is out.
	 */
	historyReadPending: boolean;
	/** Owner frontend epoch — answers to pending gates are addressed by it. */
	ownerEpoch: string | null;
	/** HTTP receipt cursor for reconnects (epoch + after_seq). */
	receipt: { epoch: string; seq: number } | null;
	/** Terminal event observed for the current turn; clears the wait latch. */
	terminal: string | null;
	/**
	 * How many `turn_end` / `agent_end` events this viewer has applied.
	 *
	 * A counter rather than an event name because consecutive endings can have
	 * the same name. The code-memory panel uses each observed ending to request
	 * a fresh reading; these are completion pulses, not unique logical turns
	 * (a run can emit both endings). Starts and steering only clear the wait
	 * latch and must not trigger extra reads. A late join counts from that join,
	 * not from the session's history.
	 */
	turnsCompleted: number;
	/**
	 * Set on an unrecoverable stream failure: the ONE sentence the reader sees,
	 * and the one action that helps. A structured notice rather than a transport
	 * `detail` string, because the two transports name the same failure in
	 * different words and neither belongs on screen (design round 1, D1).
	 */
	failure: SessionFailureNotice | null;
	/**
	 * True while the painted rows came from the LOCAL PAINT CACHE rather than
	 * from the owner (M2), which is what a notification click's first frame is.
	 *
	 * A state flag rather than a rendering hint: the rows stay at full `ink` (a
	 * cached row is a real row, and opacity is banned as a state signal here), and
	 * what says "this may be behind" is one caption in the pane's status slot.
	 * Cleared by the SNAPSHOT, not by the first frame of any kind: a frontend
	 * update, an attention delta or an event all leave the cached rows in place, so
	 * only an authoritative reconcile makes them not-cached.
	 */
	stale: boolean;
	/**
	 * True when the backend says this conversation is not on this machine (M6).
	 *
	 * A terminal state, not a failure: it does not enter the retry budget and it
	 * raises no `failure` notice, because retrying asks the same question and gets
	 * the same answer. Only the transport knows it — the desktop plane answers 404
	 * for a session id this host does not have — and the click path is what
	 * reaches it, because it deliberately spends no validating round trip.
	 */
	missing: boolean;
	/** The painted conversation, durable and live, oldest first. */
	transcript: TranscriptState;
	/** Older durable rows are being fetched. */
	loadingOlder: boolean;
	/**
	 * The last "load earlier" ask, from ANY caller, failed - and nothing has been
	 * applied since.
	 *
	 * THE FAILED ROW HAS ONE OWNER, and it is this hook (loader-continuity R2).
	 * The scroll pump used to keep its own `failed` state, set from `!ok`, so it
	 * could only ever see its own asks and it read "someone else is loading" and
	 * "the session changed in flight" as failures: a healthy conversation painted
	 * the red "Could not load earlier messages" row, while a REAL failure from the
	 * align fetch, the jump walk or the mentioned-files scan never reached it.
	 * Set on a `failed` outcome from any caller; cleared by any `applied` outcome,
	 * by `/clear`, and by a session switch.
	 */
	olderFailed: boolean;
	/**
	 * How many `subagent_start|subagent_progress|subagent_end` events this viewer
	 * has seen for each child, keyed by job id (`docs/run-sidebar.md` § 5.3).
	 *
	 * A PULSE, not a transcript: the child's own transcript is a file on disk, and
	 * this is the parent stream's signal that something about a child changed —
	 * emitted at tool-batch boundaries and never per stream delta
	 * (`harness/types.py:1580-1591`), which is exactly the boundary the file is
	 * written at. A reader that wants the child's newest rows therefore needs a
	 * counter it can watch, and the counter must be part of the view because the
	 * renderer cannot observe an event the stream has already consumed.
	 *
	 * Seeded from the snapshot's own `live_events`, so a viewer that JOINS a turn
	 * in flight starts with the beats already recorded rather than at zero — a
	 * counter that began at zero for a child that had been working for a minute
	 * would make the first refetch look like the first change.
	 */
	subagentPulses: Readonly<Record<string, number>>;
	/**
	 * Call ids whose FIRST label read is still in flight.
	 *
	 * A viewer that joins a turn in flight is handed settled rows with no
	 * arguments (the seed keeps only each call's `tool_execution_end`), and the
	 * row's object column then falls back to the first line of the call's OUTPUT
	 * (`outputFallbackLine`). That stand-in is right for a call that truly has no
	 * arguments to find, but on the first frame of an open it is wrong for almost
	 * every row: the arguments are one `/history` read away, so the operator saw a
	 * run of `bash … {"text": 200, …` rows that corrected themselves only later.
	 * While a row's id is in here the row renders the column EMPTY instead. The
	 * id leaves when the walk's FIRST request settles - answered or failed, which
	 * is the moment "a read is in flight" stops being true - or after
	 * `LABEL_HOLD_MAX_MS` if that request never answers at all, whichever comes
	 * first. After that the stand-in comes back exactly as before, while the
	 * retries that are still running fill the row's label in when they land.
	 *
	 * First attempts for the CONVERSATION only, not per mount: a retry must not
	 * blank a stand-in the reader has already seen, and neither must a switch back
	 * to a conversation whose rows were painted before (round 1, QA Q1).
	 */
	labelPending: ReadonlySet<string>;
	/**
	 * The ids whose HOLD a refusal ended, and whose MARK therefore stands in its place.
	 *
	 * WHY IT IS NOT A HOLD (round 4). A walk that spends `LABEL_GAP_ATTEMPTS` attempts
	 * on failures stands down having named nothing, and at that instant the rule has
	 * no hold to justify: no read is in flight for these calls any more (term (a)),
	 * and asking term (b) - "a durable round ending can still name it" - holds them to
	 * the backstop, which measured 25 182 ms of blank-then-mark on the app (review
	 * round 3's Q-2 route) where main settles in ~188-324 ms.
	 *
	 * WHY IT IS NOT A RELEASE EITHER. The two routes that reach that stand-down are
	 * indistinguishable at the moment of the decision. A permanently refusing owner
	 * means no read can ever name these calls, so their stand-in - the first line of
	 * the call's OUTPUT - is the truth, and main is right to paint it. An owner that
	 * refuses now and answers at the next round ending means a read IS coming, and a
	 * row that stated the output in the meantime is the operator's reported symptom,
	 * exactly: `26 stand-in frames -> command`, output text on screen from 125 ms to
	 * 4 790 ms, measured on this branch's own rig when the release was taken at the
	 * stand-down.
	 *
	 * SO THE REFUSAL CHANGES WHAT THE ROW SHOWS WHILE THE QUESTION IS OPEN, not which
	 * of the two answers it guesses. The hold ends - the row is no longer owed a
	 * blank - and the MARK takes its place: one glyph meaning "a value belongs here
	 * and is not known yet", which states no fact and therefore cannot be the wrong
	 * one. It has THREE exits, and the third is the one easiest to reason wrongly about:
	 * (1) a later read that names the call gives the command; (2) a RELEASE EVENT at
	 * which the rule no longer owes the row - `releaseLabelPending` prunes the mark by
	 * the same `labelOwed` predicate that releases the hold - gives the stand-in; and
	 * (3) the backstop's own deadline gives the stand-in too, for a conversation whose
	 * reads never settle. The turn's own ending is NOT a fourth exit: nothing is keyed
	 * to it, and it clears a mark only through (2), at the next release event - which is
	 * what the refused-plus-round-ending arm measures, the stand-in at ~4 s rather than
	 * at the bound. Nor is it a licence to release early: a round ending is exactly
	 * where the retry that names these calls is issued from, and while that retry is out
	 * the row is owed a read again (term (a)), so the retry's own answer - command or
	 * stand-in - is what the reader gets.
	 *
	 * THE MARK ARRIVES AT THE RELEASE rather than after `LABEL_HOLD_MARK_MS`: the hold
	 * it replaced is already over, so there is no blank left for a clock to age, and
	 * the reader gets the cue in the frame the refusal was learned (measured 123 ms
	 * against the 25 182 ms the hold cost). That timing is a DESIGN decision this
	 * branch's coder took on the manager's instruction and handed to the designer
	 * (design round 4): the mark's own design - one static textless glyph, `--lo-ink-dim`,
	 * no motion, no count, no output text, `title` suppressed - is unchanged.
	 */
	labelMarked: ReadonlySet<string>;
	/**
	 * Whether a held column should show the LATE-HOLD mark instead of nothing.
	 *
	 * A blank cell cannot tell the reader that an answer is coming, and on this bound
	 * the blank can last as long as a read does (design round 2, D6). Two seconds
	 * into a hold - long enough that a merely slow read has answered
	 * (`LABEL_HOLD_MARK_MS`) - the held cells paint a static, textless, DIM mark: no
	 * motion, no count, no output text, and it resolves to the command or to the
	 * stand-in exactly as the blank did. One flag for the batch rather than a clock
	 * per row: the hold is armed per batch, and per-row ink on the first frame is
	 * what D3 declined.
	 */
	labelHoldLate: boolean;
};

/** The shared empty `labelPending`, so an unchanged view keeps its identity. */
const NO_LABELS_PENDING: ReadonlySet<string> = new Set();

/** The shared empty `labelMarked`, for the same reason. */
const NO_LABELS_MARKED: ReadonlySet<string> = new Set();

/**
 * `set` without `drop`, keeping its IDENTITY when nothing was removed.
 *
 * The view is committed on every page, and a set that is rebuilt unconditionally
 * re-renders the pane for a release that released nothing. Returning the same
 * reference is what tells React the answer did not change.
 */
function withoutLabels(
	set: ReadonlySet<string>,
	drop: Iterable<string>,
): ReadonlySet<string> {
	let left: Set<string> | null = null;
	for (const id of drop) {
		if (!set.has(id)) continue;
		left = left ?? new Set(set);
		left.delete(id);
	}
	return left ?? set;
}

export type CanonicalSessionHandle = CanonicalSessionView & {
	/**
	 * Fetch the page of durable rows before the oldest painted one.
	 *
	 * Resolves `true` when a page was applied and `false` when the request
	 * failed or there was nothing to ask for. It never rejects: the rows already
	 * painted stay correct through a failure, so this is not exceptional
	 * control flow. The boolean exists because scroll-driven paging has to bound
	 * its own retries, and a caller that cannot tell success from failure either
	 * retries forever or never.
	 */
	loadOlder: () => Promise<boolean>;
	/**
	 * The same ask as `loadOlder`, answering WHAT HAPPENED rather than whether a
	 * page was applied. `loadOlder` is `outcome.kind === "applied"` of this. New
	 * callers that must tell a failure from a lost race use this one.
	 */
	loadOlderDetailed: () => Promise<LoadOlderOutcome>;
	/** View-only clear (the `/clear` contract): nothing is deleted. */
	clearView: () => void;
	/**
	 * Paint a model the user chose, before the owner's frame confirms it.
	 *
	 * Optimistic registration, the shape `feat/submit-latency` (#118) uses for a
	 * sent message: the renderer paints its own intent immediately and reconciles
	 * against the authoritative frame rather than waiting for it. Deliberately a
	 * value the VIEW carries rather than a mutation of `frontend`, so a consumer
	 * that ignores it keeps seeing the owner's truth.
	 */
	paintPendingModel: (model: CanonicalModel) => void;
	/**
	 * Drop that paint without confirming it — the owner refused, or the call
	 * itself failed before any owner saw it.
	 */
	clearPendingModel: () => void;
	/**
	 * Paint a renderer-local line (a command receipt, a refusal, a hint). It
	 * is not history and never reaches the backend; it exists so a slash
	 * command's answer lands where the user typed it.
	 */
	addNote: (text: string, level?: "info" | "warning" | "error") => void;
	/**
	 * Re-arm this session's stream and history read.
	 *
	 * The action behind the failure state's Retry, and the reason that state is
	 * actionable rather than terminal: the transport failures this hook recovers
	 * from are almost always a backend being replaced underneath it, so the same
	 * subscription that just failed is expected to succeed a moment later. Does
	 * nothing when the session has no stream owner (a different session was
	 * opened, or this one unmounted).
	 */
	retry: () => void;
	/**
	 * Ask for the authoritative history read again, now.
	 *
	 * The action behind the older-history slot's "Try again" while hydration is
	 * UNPROVEN (the slot's `unproven` arm): the pane holds rows, `has_more` says
	 * the end, and no read has proven that end yet, so the reader gets one
	 * control that re-asks the same read the cold open fired.
	 *
	 * Deliberately NOT `retry` (that re-arms the stream as well - a heavier
	 * repair than this question needs) and not `loadOlder` (that pages back from
	 * a cursor; an unproven transcript has none). It fires the walk a cold open
	 * fires - with the same generation guard and the same request budget - and
	 * does nothing once a page has proven hydration, because then the arm it
	 * serves is no longer on screen.
	 */
	rehydrate: () => void;
	/**
	 * Read this session's history TAIL once, apply it, and say whether the page
	 * carried the outcome of the pass that STARTED at or after `since` (epoch ms).
	 *
	 * `since` is the pass's own instant, taken from the receipt that scheduled the
	 * read, and it is what makes the read's answer about THAT pass: an unscoped
	 * "the page carries a compaction row" reported success on any session the user
	 * had compacted before, which skipped the schedule's own backstop exactly in
	 * the repeat case it exists for (review round 3, R3-2/Q8).
	 *
	 * `epoch` is the view's epoch when the read was scheduled
	 * (`TranscriptState.viewEpoch`). A `/clear` inside the window bumps it, and a
	 * page that arrives afterwards is discarded rather than repainting rows the
	 * user had just emptied — a scheduled read must not reverse an explicit
	 * command (U11/Q7/R3-7).
	 *
	 * WHY THIS EXISTS AT ALL (UX round 2, U6 = QA round 2, Q2). A DECLINED
	 * `/compact` leaves a durable `compaction_refused` row and emits NO events
	 * (`serving.py::_record_compaction_refusal` appends it and calls `_notify()`,
	 * which publishes busy/pending-gate/projection state rather than a transcript
	 * delta), so a pane that never reads history again never learns the pass did
	 * not run: the composer empties and nothing takes its place — and there is no
	 * dialog to close either, because this change deleted it. Both review rounds
	 * measured the same thing (zero `/v1/desktop/sessions/*` reads in the 12-60 s
	 * after the command) and the row DOES paint on the next read, so the missing
	 * half is the read itself.
	 *
	 * `true` means the outcome is on screen now, which is the caller's cue to stop
	 * asking; `false` covers "nothing there yet", "the read failed" and "that is no
	 * longer the session on screen", which are the same answer to a bounded
	 * schedule. Deliberately NOT `loadOlder` (that pages back from the oldest
	 * painted row) and deliberately not `retry` (that re-arms the stream as well,
	 * which is a heavier repair than this question needs).
	 */
	refreshTail: (since: number, epoch: number) => Promise<boolean>;
	/**
	 * Whether an authoritative page for THIS session is still owed.
	 *
	 * The composed fact the composer band's loading state and the transcript
	 * pane's own hold are both claims about, and neither half of the view states
	 * it alone. `hydrated` answers "has a page been applied for this session",
	 * which a pane with NO session answers "no" to forever: a New chat is a
	 * staged DRAFT, the stream is deliberately off until the user's first send
	 * creates a session, so that answer describes a wait that is not happening.
	 * Both readers waited on it: the band showed the hydration skeleton in place
	 * of the greeting and the suggestion chips, and the pane held
	 * `Loading conversation…` and its shimmer above the splash the band had
	 * restored - two contradictory claims on one screen.
	 *
	 * Both readers are claims this hook composes once: `enabled`/`sessionId` are
	 * "there is a stream that owes us a page", `isSession` is the caller's answer
	 * to whether that id is a SESSION's, and `hydrated` is "a page has been
	 * applied". The rule lives here, and it is said once:
	 *
	 *   - `enabled`/`sessionId` are "there is a stream that owes us a page". A
	 *     draft has neither, and a caller that holds the stream off on purpose
	 *     must not strand the composer in a wait that can never end. That trade
	 *     is deliberate and it runs the OTHER way too: a disabled stream means
	 *     "nothing owed", including for a session that already has rows, so a
	 *     caller that backgrounds a stream it could resume must not read this
	 *     field as "there is nothing here" and paint the empty-conversation band
	 *     over rows that had simply not arrived. Both call sites pass
	 *     `Boolean(sessionId)` today, so no caller is in that state - the
	 *     sentence is here for the one that would be.
	 *   - `isSession` is the caller's answer to "is that id a SESSION's?", the one
	 *     fact this hook cannot derive - a NEW chat's draft now has a stream of
	 *     its own (`sessions.draft`'s minted id, the bridge that holds the warm)
	 *     and the two ids have the same shape. A draft's subscription is not a
	 *     page anyone is waiting for: no conversation exists yet, so the pane
	 *     keeps its empty state until the send creates one (UX round 1, U1: the
	 *     pane held `Loading conversation…` over that state for the ~200 ms the
	 *     draft's first frame took). Until drafts could warm, `enabled` was false
	 *     for them, and this term is what keeps that answer once the pane holds a
	 *     draft stream.
	 *   - `hydrated` stays false for a session whose stream failed, so a real
	 *     conversation whose cold history is in flight (or whose read failed)
	 *     keeps waiting instead of asserting it is empty over rows that had
	 *     simply not arrived (design D7).
	 *
	 * Deliberately NOT a redefinition of `hydrated`: that field's scope is a page
	 * that exists, and a reader of it must keep reading it that way.
	 */
	awaitingHydration: boolean;
};

const TERMINAL_EVENTS = new Set([
	"agent_end",
	"agent_start",
	"provider_start",
	"steering_delivered",
	"turn_end",
	"turn_start",
]);

/**
 * How long an unconfirmed model paint is worth keeping.
 *
 * The cold path measures 1.1-4.2 s, so this is well past any real switch — its
 * job is the case where the confirmation never arrives at all (a dropped frame
 * on a stream that did not report a gap). Without it the band would keep a
 * "not yet confirmed" mark for the rest of the session, which is a claim about
 * the present that stops being true the moment the wait it describes is over.
 */
const PENDING_MODEL_TIMEOUT_MS = 15_000;

/**
 * How many times a stream that cannot be (re)established is retried, and the
 * delay before each one.
 *
 * WHY a schedule this wide, when the previous code retried ONCE. The failure
 * this replaces was a desktop token rotation during an IN-PLACE backend
 * restart: the relay is rebuilt by main, so a retry is the entire recovery -
 * but the old code only retried when it already held a receipt cursor, and a
 * stream that never opened has none, so the consumer sat at "connecting"
 * forever and the only cure was restarting the app.
 *
 * The budget has to outlast the restart it is racing. `restart()` disposes the
 * old relay, waits up to 10s for the process to exit, sleeps 2s, and only then
 * starts a backend that reports healthy after another ~1-4s, so the stream can
 * be refused for ~12-16s. These six delays sum to 23.5s plus per-attempt
 * latency, which covers it with room to spare; they are capped at 8s so the
 * last probes do not walk out to a minute. Exhausting them is not a silent
 * stop: the view lands on `unavailable` with the reason and a Retry the user
 * can press.
 */
const STREAM_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 8000];
const STREAM_MAX_ATTEMPTS = STREAM_RETRY_DELAYS_MS.length;

/**
 * How long one connection may go without its first `snapshot` before the pane
 * stops waiting for it.
 *
 * WHY THE PANE NEEDS ITS OWN BOUND. The click used to spend a `sessions.get`
 * guard read, and that read's 20 s deadline was - by accident - the only thing
 * that ended an open against an owner that accepts the connection and then says
 * nothing (the `SIGSTOP` case: the desktop plane acquires the session bridge
 * BEFORE it answers the stream's headers, so the subscription neither errors nor
 * opens). With the read gone the stream is the open's only signal, and a stream
 * that never speaks raised no `error`, no `end` and no frame: the pane sat on
 * "Loading conversation..." indefinitely, measured at +20 s, +40 s and +75 s by
 * design round 1 (D1). Main's relay does end a silent socket at 45 s, but the
 * browser transport has no such watchdog and the renderer must not depend on
 * which transport it runs over, nor on the backend bounding its own reads.
 *
 * 20 s is the bound that read held, so the worst case a frozen owner costs is
 * unchanged from before this path lost the read, while every healthy open no
 * longer pays for it. It is per CONNECTION, not per open: the retry schedule
 * above handles connections that fail fast (a restarting backend), and each
 * retry re-arms this bound, so a flapping backend is still owned by that budget
 * rather than cut short here. Firing it lands on the same `unavailable` state
 * and the same lost-connection sentence and Reconnect control the exhausted
 * retry budget does - no new copy, one way out.
 */
export const STREAM_SNAPSHOT_DEADLINE_MS = 20_000;

/**
 * How long after the snapshot bound fires the pane asks ONCE more by itself.
 *
 * The bound is terminal so that a frozen owner costs one 20 s wait and not
 * minutes of retries. But an owner that was only stalled (a long synchronous
 * tool step, then the loop answers again) left the pane on "Lost the connection"
 * until the user pressed Reconnect, although the conversation was answering
 * again: design round 2, D5, measured 19 s of a live runtime with nothing
 * re-checking, where the tree before the bound self-healed. One silent re-check
 * is the smallest thing that restores that: the same `reopen` the Reconnect
 * control runs, fired once. While it runs the pane shows the ordinary
 * "Loading conversation..." state rather than the notice - it IS connecting
 * again, and saying so is honest - and a snapshot paints the rows (measured on
 * the built app, owner resumed at +23 s: notice at +21.5 s, loading at +30 s,
 * rows at +33 s, no press). If that connection also stays silent, its own bound
 * lands on the same notice and nothing asks again - the budget is exactly one
 * extra connection per stall, re-earned only by a snapshot.
 */
export const STREAM_SNAPSHOT_RECHECK_MS = 10_000;

/**
 * Delay before retry number `attempt` (1-based). Past the end of the schedule
 * the last delay repeats, so a caller that counts wrong cannot wait forever.
 */
export function streamRetryDelayMs(attempt: number): number {
	const index = Math.max(1, Math.min(attempt, STREAM_RETRY_DELAYS_MS.length));
	return STREAM_RETRY_DELAYS_MS[index - 1] ?? 8000;
}

/**
 * How many times a failed `/history` reconcile is retried before it is
 * surfaced.
 *
 * A failed reconcile is survivable while durable rows are painted - they stay
 * correct - which is why the old code discarded the rejection. It is NOT
 * survivable on an empty transcript: that is precisely the case where the
 * history read is the only thing that can tell an empty conversation from one
 * whose rows are still in flight, and the read failing left the app asserting
 * "empty" over a conversation with hundreds of rows. So the retry is bounded
 * and its failure is published rather than swallowed.
 */
const HISTORY_RECONCILE_ATTEMPTS = 3;

/** Flush cadence when no animation frame arrives (hidden window). */
const HIDDEN_FLUSH_MS = 250;

/**
 * How many unlabelled calls the retry bookkeeping remembers.
 *
 * Evicted oldest-first, so the entries that go are the ones nothing has asked
 * about for longest. Generous against any real seed — the owner caps its own at
 * 100 ends — and it exists only so a pathological session cannot grow the map
 * without bound.
 */
const LABEL_GAP_MAX_TRACKED = 512;

/**
 * The events after which a round's tool rows are IN the durable transcript.
 *
 * The runtime appends a round's assistant row and its tool results as the round
 * closes, so these are the only moments at which reading history back can learn
 * a call's arguments that a mid-turn seed could not carry. Deliberately NOT the
 * whole of `TERMINAL_EVENTS`: `agent_start` and `provider_start` are the same
 * set's other members and mark nothing durable at all.
 */
const DURABLE_ROUND_ENDINGS = new Set(["turn_end", "agent_end"]);

/**
 * How many read-backs one unlabelled call is worth.
 *
 * The first read usually closes the gap for a call whose rows had already
 * landed; the second catches one that was still running at the join. Past that,
 * the call has no arguments anywhere to find — a plan the harness rejected
 * emits no start and leaves no assistant row — and a permanent retry would buy a
 * history page per turn for the rest of the conversation to learn nothing.
 */
const LABEL_GAP_ATTEMPTS = 2;

/**
 * How many durable rows the SETTLE path may read back per conversation.
 *
 * A settle's read is SPECULATIVE, and it is the only read in this file that is:
 * the runtime appends a round's assistant row and its tool results together, so
 * a call that has just settled may belong to a step that is still open, and the
 * row the read is looking for does not exist yet. The read is still worth
 * taking - for a single-call step it is the row behind the paint, and it is what
 * makes the ordinary case right in the first frame - but it must not cost the
 * call its retry budget, which is spent at a durable round ending where a read
 * can always succeed (see `settled` and the retry path in the flush). What is
 * left to bound is the waste, and `LABEL_GAP_ATTEMPTS` cannot bound it because a
 * settle is not charged there: this is the whole of the speculative path's
 * allowance - one `RECONCILE_WALK_MAX_ROWS` walk per conversation, spent a tail
 * page at a time when the frame states its call's start (see the floor the
 * settle's own `started_at_epoch` feeds), and never spent again inside one
 * renderer. Review round 1, R2.
 */
export const LABEL_SETTLE_ROWS_MAX = 500;

/**
 * How many durable rows one reconcile is allowed to read back in total.
 *
 * The read walks BACKWARDS in pages until a fetched page overlaps the row the
 * snapshot painted, so the bound is on the WALK rather than on one request: a
 * page of `RECONCILE_TAIL_ENTRIES` rows that does not reach back to the
 * snapshot's newest row is exactly the case a single read cannot close. Past
 * this the reconcile stands down — the route has no forward cursor, so a wider
 * absence cannot be closed from this side at all and is the owner's to fix in
 * the snapshot it publishes.
 */
export const RECONCILE_WALK_MAX_ROWS = RECONCILE_TAIL_MAX_ENTRIES;

/**
 * How many `sessions.history` REQUESTS one reconcile walk may make.
 *
 * A second bound on the same walk, because the row bound only bounds a route
 * that fills its pages. `rows` grows by what a page actually returns, so an
 * owner that answers a request for 100 rows with 1 row and `has_more: true`
 * costs five hundred sequential requests before the row bound is reached — the
 * walk's cost would be the server's to choose rather than ours. Six is above
 * every shape the row bound can produce when pages are full (500 rows in
 * `RECONCILE_TAIL_ENTRIES`-sized pages is five), so it never bites the honest
 * case and always stops the dishonest one. Round 1, R4.
 */
export const RECONCILE_WALK_MAX_REQUESTS = 6;

/**
 * The longest a first-paint label hold may last, in milliseconds.
 *
 * SET FROM THE TRANSPORT'S OWN BOUND FOR THIS OP, NOT FROM A COMFORT NUMBER.
 * The hold leaves a row's object column EMPTY so the first frame cannot show a
 * call's output where its command belongs (see `labelPending`), and the only
 * question this constant answers is "when is a read that has not answered no
 * longer in flight?" - which nothing in this file can know, and the transport
 * can: `desktopRequestTimeoutMs("sessions.history")` is the deadline the
 * renderer itself aborts that request at (`desktopRequestDeadlineMs`'s 20 s
 * control bound plus `DESKTOP_DEADLINE_MARGIN_MS`). A cap at or below it fires
 * while a legitimately slow read is still running and paints the stand-in
 * anyway - the operator's own flash, reintroduced by the backstop that exists to
 * prevent it.
 *
 * MEASURED, both ways: a 3 s cap painted the stand-in for 66 ms before a 3.07 s
 * page landed (design round 1), and both the base and the previous head showed
 * stand-ins ahead of a 6 s page (360 frames each: reviewer and QA). A 2 s cap
 * would be worse. So the number here is the transport's, and the hold itself is
 * normally ended by the ANSWER rather than by the clock.
 *
 * IT BOUNDS ONE ATTEMPT, AND IT IS RE-ARMED PER ATTEMPT (round 2, U4; round 3,
 * Q-4). The transport's deadline is what turns a wedged invoke into a rejection -
 * the sentence that used to stand here claimed the opposite of what `withDeadline`
 * does (round 2, n3). Round 3 measured that this paragraph described code which
 * did not exist: the effect was a single shot armed once per batch, so it painted
 * the stand-in WHILE A READ WAS IN FLIGHT - 26 rows showing the call's OUTPUT from
 * 25 124 ms with the read issued at 20 005 ms still running, a 4.97 s window of the
 * wrong text - and the wedge ended at 25 159 ms, 5.2 s into attempt two's own
 * window. The effect now defers to the read it is waiting for: while anything held
 * is in flight it re-arms, and it fires only when nothing is.
 *
 * WHAT THAT COSTS, MEASURED ON THE BUILT APP rather than reasoned from the
 * constants (round 3's own rig, re-pointed at this head; `--history-mode never`,
 * 80 s, stride 2). The owner accepts `/history` and never answers, so the wire is
 * read #1 at 0 ms and read #2 at 20 004 ms (attempt one ended by the transport's
 * own 20 s bound) and nothing after: attempt two ends at 40.0 s, which is this
 * band's two attempts spent, and the walk stands down. The column is blank
 * 123 -> 2 126 ms, carries the mark from 2 126 ms, and releases the stand-in at
 * **50 126 ms** - two of these windows, the second fire finding nothing in flight.
 * The previous head measured **25.0 s** here and `main` **3.2 s** (round 3, Q-4).
 *
 * SO ~50 s IS THE WORST CASE, and it is the number this paragraph used to assert
 * as a claim: round 3 refuted it against the old effect, where it would have needed
 * two arming events and the arm produced one. It is the same arithmetic the fix
 * makes true - one window for the re-armed fire, plus the last attempt's own
 * deadline inside it - and it buys the window in the sentence above: the app never
 * states a call's OUTPUT as the row's identity while a read is out for that call.
 * The mark stands through the whole of it, so a reader is not left looking at an
 * unexplained blank column; what is long is not unstated, which is the point of
 * `LABEL_HOLD_MARK_MS`.
 *
 * WHAT IT TRADES, stated rather than implied: against an owner that accepts
 * `/history` and never answers, rows stay objectless until the transport gives
 * up at this same bound, instead of for 3 s (round 1's design D1 / QA Q3 read
 * the opposite trade as the honest one for a wedged owner; the operator's
 * 2026-09-25 decision reverses it, because a hold cut short by a clock is the
 * exact screen the report is about, while a hold bounded by the transport is a
 * read that is still genuinely in flight).
 *
 * `LABEL_HOLD_MARK_MS` below is the other half of the same problem for a read that
 * IS still in flight, and round 4 makes one case of its own: a hold that ends in a
 * REFUSAL becomes a mark immediately rather than after that window.
 */
export const LABEL_HOLD_MAX_MS = desktopRequestTimeoutMs("sessions.history");

/**
 * How long a held column stays BLANK before it shows the late-hold mark, in
 * milliseconds.
 *
 * Design round 2's D6, and its number: a blank cell cannot tell the reader an
 * answer is coming, while the stand-in is a wrong fact and a spinner is motion the
 * round declined. Two seconds is late enough that a merely slow read - the repo's
 * own read figure is 0.5-1.5 s - has answered and painted its command, so the mark
 * appears on the reads that are actually worth a cue and not on the ones that were
 * about to land. The cost, stated: a read answering in 2.0-2.5 s paints the mark
 * and then the command 100-500 ms later, one extra state on a row that was
 * going to change at that instant anyway.
 *
 * MEASURED ON THE ARMED TREE, not inferred from the constant (design round 3,
 * § 2): arrival at 2 004 / 2 006 / 2 007 / 2 022 / 2 026 ms from the hold batch
 * across five panes, and 0 marks on a 1 500 ms read whose hold ended at
 * 1 566 ms. The threshold was re-decided at that point and kept: raising it to
 * 3 000 ms would leave the reported case - a 3.0 s page - unmarked for the whole
 * hold, which is the case D6 was raised against.
 *
 * THE NUMBER WAS DEAD UNTIL ROUND 3 (D7): the flag it feeds had no writer, so the
 * constant was read by nothing at all. `labelMarkEffect` below is what reads it.
 *
 * ROUND 4 GIVES IT A SECOND, EARLIER READER, AND THAT TIMING IS THE DESIGNER'S
 * SURFACE RATHER THAN THIS FILE'S. When a walk stands down on a REFUSAL - the read
 * path refused and named nothing - the hold does not survive to be aged by this
 * clock: it ends, and the MARK takes its place in the same frame (measured 123 ms,
 * against 25 182 ms for holding to the backstop). The reader gets a cue promptly
 * instead of a blank column for 25 s, and no call's OUTPUT can be painted while a
 * later read may still name it. The mark itself is unchanged - same glyph, same ink,
 * same absence of motion, count and title - so what moved is only WHEN it appears on
 * that route, which design round 4 is asked to judge; see `labelMarked`.
 */
export const LABEL_HOLD_MARK_MS = 2_000;

/**
 * What one reconcile walk is trying to label, when it is a label read at all.
 *
 * - `targets`: the calls this read is FOR (the seed's unlabelled calls plus a
 *   round end's retries);
 * - `order`: every call the seed settled, oldest first, INCLUDING the ones a
 *   page already labelled — the positions `labelTargetsBehind` needs to tell a
 *   target older than what was read from one the running round has not
 *   written yet;
 * - `every`: `order` and `targets` as one set, the ids a fetched page is
 *   scanned for;
 * - `found`: calls the snapshot's own tail page already named, so the walk
 *   starts knowing how far back that page reached;
 * - `pending`: the ids this walk put in `labelPending`, released when it ends.
 */
type LabelWalk = {
	targets: ReadonlySet<string>;
	order: readonly string[];
	every: ReadonlySet<string>;
	found: ReadonlySet<string>;
	pending: readonly string[];
	/**
	 * Call id -> the epoch MILLISECONDS each call started, from the seed's own
	 * frames (`seedCallStarts`). The walk stops once a page's oldest row predates
	 * the oldest unlabelled target's instant (`pagePassedOldestStart`) — the one
	 * floor that does not depend on finding a turn's opening row.
	 */
	starts: ReadonlyMap<string, number>;
	/**
	 * The targets still waiting at a gate (`seedWaitingComposes`): the only startless
	 * calls whose missing instant does NOT refuse the floor (round 6, R16).
	 */
	waiting: ReadonlySet<string>;
};

/**
 * What a walk leaves behind for `walkTail` to seal against (#876): the record
 * keys of everything it fetched, the oldest entry it reached, whether the journal
 * continues behind that entry, and which of the walk's two seams it reached.
 */
type WalkSeam = {
	keys: Set<string>;
	oldest: DesktopHistoryPage["entries"][number] | null;
	hasMore: boolean;
	joined: boolean;
	reachedHeld: boolean;
};

/** A reconcile that is not a label read: connect to the painted rows and to what the pane held, nothing more. */
const NO_LABEL_WALK: LabelWalk = {
	targets: new Set(),
	order: [],
	every: new Set(),
	found: new Set(),
	pending: [],
	starts: new Map(),
	waiting: new Set(),
};

/**
 * Mounted transcripts, by session, that an optimistic echo can reach.
 *
 * The seam exists because the STORE paints the echo (it is the only place that
 * knows the session id and the admission request id at the same moment, and it
 * must do so before its first `await`), while this hook owns `commitView`. A
 * direct import the other way would make the store depend on React state.
 */
const echoTargets = new Map<
	string,
	(mutate: (state: TranscriptState) => TranscriptState) => void
>();

/**
 * Mounted panes, by session, that can re-read their own canonical snapshot.
 *
 * Exists for one case the stream cannot cover: a mutation made from ANOTHER
 * surface of the app, on a session this window may be displaying. The owner
 * pushes a frame when its own scheduler changes (`_notify_change`), so a live
 * session heals itself - but a COLD session (no runtime) is synthesised from the
 * derived wake index at subscribe time, and nothing pushes when the index moves
 * underneath it. `docs/composer-wakes.md` section 11.6 records that gap for the
 * composer's chip and the run pane's Wakes section: "a cold session's chip does
 * not track the index until re-entry".
 *
 * The Schedules page is the surface that CREATES that situation: cancelling a
 * wake there on a conversation open in the chat pane would otherwise leave the
 * pane asserting a wake that no longer exists, one screen away from the row that
 * just removed it. So the mutation asks the pane to re-read, and the pane does it
 * by re-opening its subscription without a cursor (see the resync in the effect
 * below), which is the only read that re-synthesises a cold snapshot.
 *
 * Keyed by session id and holding ONE entry per session, like `echoTargets`: the
 * pane for a session is a single subscriber, and a later mount (a session switch
 * back) re-registers over the previous entry, whose cleanup is identity-checked.
 */
const resyncTargets = new Map<string, () => void>();

/**
 * What each conversation's label read-back has learned and already paid for.
 *
 * PER CONVERSATION, NOT PER MOUNT, and that is the whole point of it being a
 * module-level map rather than the refs it replaces. A session switch unmounts
 * the pane, so anything held in a ref dies with it and the conversation is met
 * as a stranger on the way back — which is what round 1 measured (QA Q1):
 * switching away from a turn in progress and back re-blanked rows whose
 * stand-in the reader had ALREADY seen, for the length of the re-open read.
 * A row that has been painted once has been painted; only a first paint may be
 * held empty.
 *
 * What it holds, per conversation:
 *
 * - `attempts`: call id -> how many read-backs have been spent on it. The same
 *   bookkeeping the ref held before, now surviving the switch;
 * - `depth`: the deepest a label read has had to go, in rows, so a later retry
 *   starts where the last walk ended instead of re-paying its way down (see
 *   `labelDepth` in the walk below);
 * - `order`: the last snapshot seed's settled calls, oldest first, which the
 *   round-end retry needs to tell "older than what was read" from "the running
 *   round has not written it yet".
 *
 * BOUNDED BY CONVERSATIONS, the same way `paintCache` is bounded by bytes: at
 * most `LABEL_GAP_SESSIONS_MAX` of them are kept, oldest-inserted evicted first,
 * and each conversation's `attempts` is itself capped at
 * `LABEL_GAP_MAX_TRACKED` (evicted oldest-first as it fills). The entry is
 * touched on every use so the conversations in play are the ones retained.
 */
type LabelGapState = {
	attempts: Map<string, number>;
	/**
	 * The ids whose first paint this conversation has ALREADY held empty.
	 *
	 * Its own record rather than a reading of `attempts`, and only ever added to:
	 * `attempts` is the retry BUDGET and an id leaves it the moment the transcript
	 * learns its arguments, which is exactly when the hold has done its job. Keyed
	 * off that map the hold was re-armed for calls whose labels an earlier read had
	 * already FOUND — the same blanking Q1 measured, on a more common path (round
	 * 2, N1; the reviewer reproduced it 3 of 3 targets with one benign live frame
	 * between two mounts, and QA's shipped-app run could not reach it at all).
	 */
	painted: Set<string>;
	/**
	 * The ids a read was IN FLIGHT for when this paint was cached or handed on.
	 *
	 * The paint cache carries the rows and the ids whose object column must stay
	 * empty, and what makes that hold honest is that a read could still answer for
	 * them. At a cache write there is no view to ask, and "held" alone is not the
	 * answer: an id can be held with its budget spent (nothing will ever name it -
	 * the stand-in is the truth) or with a retry already abandoned. So the walk
	 * records here the ids it actually asked for, and only those are carried across
	 * a remount - which is what stops a cached id from sitting blank on a
	 * justification that is no longer true (review round 1, m1).
	 *
	 * ITS LIFETIME IS THE READ'S, NOT THE MOUNT'S (agent review round 3, M2's second
	 * half). A walk drops exactly the ids IT added when it ends - not `clear()`, which
	 * let the settle path's read and a retry for the same conversation wipe each
	 * other's pending ids - and the pane's own tear-down drops the rest of what it
	 * added, because a read abandoned at unmount is not a read the successor mount can
	 * name. The state itself outlives the mount (the map is keyed by conversation), so
	 * nothing else would clear those.
	 */
	inFlight: Set<string>;
	/**
	 * Whether this conversation's LAST read attempt on the history route FAILED.
	 *
	 * WHAT SETS IT: the stand-down after `LABEL_GAP_ATTEMPTS` attempts, which is the
	 * one place a walk concludes that the route is refusing rather than slow. A single
	 * failed attempt does not set it - that walk still has its own retry to spend.
	 * WHAT CLEARS IT: any page that arrives, because that is the same event that makes
	 * it untrue, the route answering again.
	 *
	 * WHAT READS IT: the walk's exit, which hands this walk's still-held targets to
	 * `markRefusedTargets` instead of releasing them to their stand-ins. See
	 * `labelMarked` on the view for why the refusal is not allowed to decide between
	 * the two answers, only what the row shows while neither is known.
	 */
	refused: boolean;
	depth: number;
	order: readonly string[];
	/**
	 * Call id -> the epoch MILLISECONDS the call started, from the seed's own
	 * frames (`seedCallStarts`). The walk's floor: see `pagePassedOldestStart`.
	 */
	starts: Map<string, number>;
	/**
	 * The startless calls that are still WAITING at a gate (`seedWaitingComposes`):
	 * the one kind whose missing instant may NOT refuse the floor, and so held per
	 * conversation like the instants themselves.
	 */
	waiting: Set<string>;
	/**
	 * The calls a LIVE settle named, still unlabelled (bounded).
	 *
	 * Their own record rather than a reading of `attempts`, because a settle is
	 * not charged there: it is charged when a durable round ending makes it a
	 * retry candidate, which is the moment a read for it can succeed. Keeping the
	 * ids here is what lets that retry find them at all - a call that settled live
	 * and has fallen out of the seed window is named by nothing else, which is the
	 * gap this path exists to close (review round 1, R1).
	 */
	settled: Set<string>;
	/**
	 * Rows the speculative settle reads have spent, against
	 * `LABEL_SETTLE_ROWS_MAX`.
	 *
	 * Per conversation, like the map above it. A walk the seed or a retry also
	 * needed is FREE - it was happening anyway, which is what makes N settles in
	 * one flush cost one walk - so only a walk a settle ALONE caused is charged
	 * here (review round 1, R2).
	 */
	settleRows: number;
};

const LABEL_GAP_SESSIONS_MAX = 8;

/**
 * How many ids the hold's painted-once record keeps per conversation.
 *
 * Four times the attempt budget, because this one is never pruned by progress:
 * it grows with the conversation's settled calls and is only there to stop a
 * SECOND hold for a row this window has already left empty once. Evicted
 * oldest-first, so what it can still re-hold after 2048 calls is the oldest tail
 * of a very long conversation.
 */
const LABEL_GAP_MAX_PAINTED = 2_048;

/**
 * How many calls' start instants one conversation remembers.
 *
 * The owner caps its own seed at `LIVE_EVENT_END_ROWS_MAX` (100) ends, so this is
 * several seeds' worth of history for the retry path, which needs an instant for
 * calls whose own frames have left the seed. Evicted oldest-first.
 */
const LABEL_GAP_MAX_STARTS = 1_024;

/**
 * How many waiting calls one conversation remembers.
 *
 * Same order of magnitude as the instants it accompanies, and bounded like them
 * because a long turn keeps announcing calls it has dispatched and not started.
 */
const LABEL_GAP_MAX_WAITING = 1_024;

/**
 * The key an absent session id gets.
 *
 * The hook is called with `sessionId | undefined` before a conversation is
 * picked, and that state has no rows to hold: the key is one no owner can mint
 * (session ids are hex), so an absent session shares a single throwaway entry
 * rather than growing one per render.
 */
const NO_SESSION_KEY = "";

const labelGaps = new Map<string, LabelGapState>();

/**
 * The gap state for a conversation, re-inserting it so it is the newest entry.
 *
 * The re-insert is what makes the four-line eviction below an LRU rather than a
 * "first ever seen": a session the reader is moving between stays, and a
 * conversation opened once an hour ago is the one that goes.
 */
function labelGapFor(sessionId: string | undefined): LabelGapState {
	const key = sessionId ?? NO_SESSION_KEY;
	const existing = labelGaps.get(key);
	if (existing) {
		labelGaps.delete(key);
		labelGaps.set(key, existing);
		return existing;
	}
	const fresh: LabelGapState = {
		attempts: new Map(),
		painted: new Set(),
		inFlight: new Set(),
		refused: false,
		depth: 0,
		order: [],
		starts: new Map(),
		waiting: new Set(),
		settled: new Set(),
		settleRows: 0,
	};
	labelGaps.set(key, fresh);
	while (labelGaps.size > LABEL_GAP_SESSIONS_MAX) {
		const oldest = labelGaps.keys().next().value;
		if (oldest === undefined || oldest === key) break;
		labelGaps.delete(oldest);
	}
	return fresh;
}

/**
 * Whether the OWNER'S TURN is still running, which is what makes a spent read
 * budget NON-terminal (the rule's second term).
 *
 * IT ASKS THE SESSION'S OWN LIVE STATE, NOT THE NEWEST ROW (agent review round
 * 3, M3). The version this replaces walked the transcript backwards to the
 * newest assistant-or-tool record and asked whether THAT was unsettled. On the
 * conversation this branch exists for, every newest row is a settled tool call -
 * the tail is `tool(done) | assistant(settled) | tool(done) | ... | tool(done)` -
 * so it returned false on a live owner mid-turn, and term (b) could never hold
 * on exactly the route the standing-down walk released: 68 stand-in -> command
 * flips, unmoved across two heads and two independent lanes.
 *
 * `frontend.streaming` IS the fact that question is about, and taking it from
 * here is a second READING rather than a second DEFINITION: the working line's
 * visibility and the pane's `busy` both derive from this one flag
 * (`chat-page.tsx` reads `canonical.frontend?.streaming` into `busy`, which
 * arrives at the transcript as `waiting`), which is why the working line was on
 * screen through the holds this predicate was calling over. It is live for the
 * whole provider call whatever the record list currently holds, and the owner's
 * terminal event settles the flag and the rows together - so term (b) ends when
 * the last thing that could name a call ends.
 *
 * A terminal event for the turn, or a stream that failed, ends it - nothing more
 * can name a call after that, so the release below is prompt.
 *
 * ACROSS A STREAM GAP THE LAST READING IS THE ONE TO USE, NOT THE ABSENCE OF ONE
 * (round 4, M4). `frontend` is nulled on both gap arms - the `gap` frame and
 * `open{gap}` - with the reading the pane was painting kept in `heldFrontend` for
 * exactly that reason, so reading `frontend` alone answered "the turn is over" for
 * the whole ~1.5-4 s of a routine reconnect. Both terms of the rule then failed on
 * one instant: the stand-down ends term (a) by design, and term (b) read false, so
 * `markRefusedTargets` marked the rows and `releaseLabelPending` pruned that very
 * mark by this same predicate in the SAME tick - the refusal's cue added and
 * removed at once, the row settling on the call's OUTPUT, and the reconnect's own
 * snapshot repainting the command afterwards. That is the flip this branch exists
 * to remove, on the app's most ordinary route: the reviewer measured
 * `rowsShowingOutput` 68 with one stand-in frame.
 *
 * WHY THE HELD READING IS THE HONEST ONE HERE RATHER THAN THE CONVENIENT ONE. A
 * gap is not a statement that the turn ended; it is the announcement that receipt
 * continuity broke and an authoritative snapshot is on its way - and a snapshot's
 * own seed is one of the things that can name a call, which is why `firstAttempts`
 * exists. So on the one question this predicate answers ("can something still name
 * this call?") the gap is when the answer is most clearly yes, and the reading the
 * app still holds is the one that says so. The narrower alternative - suppress the
 * release while `status === "reconnecting"` - was rejected because it would state
 * the same fact in a second place and leave this predicate answering a question
 * nobody asked; `heldFrontend` is the pane's own value for the session's state (the
 * readings strip and the destination pickers paint `frontend ?? heldFrontend`), so
 * taking the liveness from the same pair keeps ONE definition of "the turn is
 * running". It is a no-op wherever `frontend` is non-null, because `heldFrontend`
 * mirrors it on every commit that sets one.
 *
 * WHAT IT CANNOT DO: keep a row held past the session's own bounds. A gap that
 * never resolves still ends the hold at `LABEL_HOLD_MAX_MS`, and a terminal event
 * or a stream failure still ends it immediately - the two arms above.
 *
 * WHY IT EXISTS AT ALL (round 2, M3): with only the budget term, a SPENT budget
 * released the row, and a durable round ending that named those calls then
 * repainted them - 24 stand-in -> command flips on a route no shipped case
 * covered. "Spent" is not the same fact as "no round ending can still come".
 */
function turnRunning(state: {
	terminal: string | null;
	failure: unknown;
	frontend: { streaming: boolean } | null;
	heldFrontend: { streaming: boolean } | null;
}): boolean {
	if (state.terminal) return false;
	if (state.failure) return false;
	return (state.frontend ?? state.heldFrontend)?.streaming === true;
}

/**
 * Whether a call's label is still OWED, which is the question the hold asks.
 *
 * TWO TERMS, and the second is round 2's M3: (a) a call no page has named whose
 * per-call read budget (\`LABEL_GAP_ATTEMPTS\`) is not spent still has a read
 * coming - the page of a walk that stopped short, a retry at a durable round
 * ending, or the next snapshot's seed; (b) a call whose budget IS spent is still
 * owed while the owner's turn is running, because a durable round ending can
 * still name it. Only when the budget is spent AND the turn is over (nothing
 * pending and no round ending still expected) is nothing able to name the call
 * any more - and THAT is the terminal case the stand-in is the truth for.
 *
 * \`labelled\` is the caller's view of what has been named (\`argsByCall\` at the
 * moment of the decision, or the walk's own found set); the budget is read off
 * the shared per-conversation bookkeeping, which is what makes this stable across
 * a remount.
 */
function labelOwed(
	gap: LabelGapState,
	labelled: ReadonlySet<string> | ReadonlyMap<string, unknown>,
	callId: string,
	turnIsRunning: boolean,
): boolean {
	if (labelled.has(callId)) return false;
	/*
	 * TERM (a): A READ IS PENDING FOR THIS CALL - which is the WALK being in flight
	 * for it, not "its budget is unspent". The two differ exactly where round 2
	 * found the hold both too strong (Q-2: the refusing-owner route spent its retry
	 * and stood down with the budget still reading 1 of 2, so nothing but the wall
	 * clock could release it - 25.0 s of blank where the previous code settled in
	 * 198 ms) and too weak (M2: a walk that ENDED left the cache carrying nothing).
	 * A read the walk has stopped making is not pending, whatever the budget says.
	 */
	if (gap.inFlight.has(callId)) return true;
	/*
	 * TERM (b): spent or not, a durable round ending can still name it (M3). The
	 * caller reads it off the session's own live state (`turnRunning`, which asks
	 * `frontend.streaming`) rather than off the newest record, because on the
	 * conversation this rule exists for every newest record is a settled tool call.
	 */
	return turnIsRunning;
}

/**
 * Forget every conversation's label bookkeeping.
 *
 * Exported with the `__` marker for the reason `__resetPaintCache` is: a test
 * that opens the same conversation twice is testing two JOINS, not one join
 * followed by a switch back, and only a test can say which of the two it means.
 */
export function __resetLabelGapBookkeeping(): void {
	labelGaps.clear();
}

/**
 * Register a pane as the place a re-read of this session's snapshot lands, and
 * return the matching unregister.
 *
 * Exported with the same `__` marker as `__registerEchoTarget`, and for its
 * reason: a rule about delivery that a test has to be able to drive against the
 * REAL registry rather than a recorder standing in for it.
 */
export function __registerCanonicalResync(
	sessionId: string,
	resync: () => void,
): () => void {
	resyncTargets.set(sessionId, resync);
	return () => {
		// Only if still ours: a remount for the same session registers before the
		// old effect cleans up, and an unconditional delete would drop the live
		// registration.
		if (resyncTargets.get(sessionId) === resync)
			resyncTargets.delete(sessionId);
	};
}

/**
 * Re-read a session's canonical snapshot, if this window is displaying it.
 *
 * Returns whether a pane took the request. `false` is not a failure: it means
 * no pane holds that session (the common case - the user is on the Schedules
 * page, not in the conversation), so the next subscribe reads the new state
 * anyway. Never queues, unlike an echo: a stale snapshot IS the next frame a
 * pane gets when it mounts, whereas an echo is a paint nothing else can produce.
 */
export function resyncCanonicalSession(sessionId: string): boolean {
	const resync = resyncTargets.get(sessionId);
	if (!resync) return false;
	resync();
	return true;
}

/**
 * The optimistic rows this app has painted, retained until they are RESOLVED.
 *
 * WHAT REPLACED THE ONE-SHOT BUFFER, AND WHY RETENTION IS THE WHOLE CHANGE. The
 * old buffer (`pendingEchoes`) was a delivery queue: an entry was consumed the
 * moment a transcript drained it, which was right while the composer held the
 * user's text across the create hop. It no longer does - the paint happens at
 * the PRESS, before `sessions.create`, and the box empties with it (see
 * `admitChatDraft`) - so a consumed entry would leave the message represented
 * only by one pane's local state, and the three things this change is for are
 * exactly what that cannot survive: the identity flip (a remount), a switch
 * away and back (another remount), and a reload.
 *
 * An entry therefore OUTLIVES its delivery, keyed by the identity the pane
 * shows (`draft:<uuid>` before the create answers, the session id after -
 * `movePendingSendIdentity` re-keys it inside the store's own synchronous block),
 * and is dropped only when the claim is resolved: a mounted pane observes the
 * owner's durable row for that id (`resolveObservedPendingSends`), the user
 * retires a failure, or the draft is abandoned (`discardPendingSends`).
 *
 * DELIVERY STILL MUST NOT DEPEND ON MOUNT ORDER, and it does not: a paint for
 * an identity with no registered transcript is retained rather than dropped, and
 * the first transcript to register drains every retained entry
 * (`__registerEchoTarget`). The difference from the old buffer is only what
 * happens AFTER a drain - nothing is taken, so the next mount seeds the same
 * rows again through `seedPendingSends`, idempotently by record id.
 */

export type PendingSend = {
	/** The identity this entry is addressed by right now. */
	identity: string;
	/**
	 * The admission request id: the row's record id, the id the owner's durable
	 * row coalesces onto (`appendPendingUser`), and what a resolution names.
	 */
	id: string;
	/**
	 * What the row paints. Mutable because the credential seam's substitution
	 * arrives AFTER the paint on the New-chat path (there is no session to store
	 * into before the create answers) and must land on the same row:
	 * `replacePendingSendText` is a splice under the same id, never a second
	 * record.
	 */
	text: string;
	images: TranscriptImage[];
	/**
	 * THE CLAIM'S OUTCOME IS KNOWN, and the entry is kept only to keep painting the
	 * row (design review round 1's D1/D2, extended by what the re-shoot measured).
	 * The server's complete read answered the claim NO (`resolveHeldFromServer`),
	 * so nothing is "still going out" - but the row is the message's home and a
	 * later mount re-paints it from `undelivered`, so the entry has to survive.
	 * Every "is a send pending" reader skips settled entries
	 * (`pendingSendForView`); the row readers do not (`seedPendingSends`, the
	 * drain). Without the distinction, a settled entry answered for the NEXT
	 * message sent on the same conversation - it is the oldest entry, so the wait
	 * line anchored to a claim already answered and the rung was withheld from the
	 * whole new flight (measured on the away step: a second message's row on
	 * screen with no line over it).
	 */
	settled?: boolean;
	/**
	 * THE PRESS'S OWN ANCHOR FOR THE WAIT CLOCK (agent review round 2, R2-5), on
	 * the entry because the entry is what survives every remount: the latch that
	 * first read `draft.submittedAt` is per-mount, so a switch-away inside the
	 * receipt-to-owner gap (which deletes the draft row, `finishDraft`) remounted
	 * with nothing to anchor to and blanked the seconds - the same blanking the
	 * latch's snapshot closed for a single mount. The value is written at the
	 * press, so every reader of the entry sees one number.
	 */
	submittedAt?: number;
	/**
	 * Whoever asked to be told the row reached a transcript. Fires ONCE, at the
	 * first paint - synchronously when a target is mounted, from the drain when
	 * one is not - because that is the moment taking the text out of the box
	 * costs the user nothing (the composer is the only caller that acts on it;
	 * see `admitChatDraft`'s `onEchoPainted`).
	 */
	onPainted?: () => void;
	/** Whether `onPainted` has fired: a later drain must not fire it twice. */
	painted?: boolean;
};

const pendingSends = new Map<string, Map<string, PendingSend>>();

/*
 * What the registry may retain, and WHY THE LIMITS ARE WHAT THEY ARE.
 *
 * This is a retention bound, not housekeeping. An entry holds the user's
 * message text AND its images as base64 (`TranscriptImage`), and it now
 * survives delivery, so a send nothing ever resolves is that content held in
 * renderer memory for as long as the window lives. Resolution is the normal way
 * an entry leaves (the owner's row observed, the user's Edit, the draft
 * discarded); these limits exist for the rows nothing resolves.
 *
 * Per identity: a send paints at most one entry per request id, and the
 * legitimate case for more than one is a retry whose payload the user edited
 * (a new id; an unchanged retry re-paints under the SAME id and replaces its
 * entry). 4 covers that with room to spare, and past it the OLDEST goes, since
 * the newest paint is the one the user is waiting to see.
 *
 * Across identities: a user can stage drafts faster than panels mount, so the
 * map itself is capped and evicts by insertion order - `Map` preserves it, and
 * the oldest identity is the one least likely to ever be looked at.
 *
 * Both bounds only ever drop an OPTIMISTIC row, and the worst case of a drop
 * is the pre-PR behaviour: the row arrives when the owner's own frame does. The
 * durable row is the backend's either way; what an eviction never takes is the
 * draft row's own claim fields (`submittedText`, `submittedAt`, `error`),
 * which are the conversation store's and are what a later pane or the restart
 * re-synthesis reads to put the failed row back.
 */
const MAX_PENDING_SENDS_PER_IDENTITY = 4;
const MAX_PENDING_SEND_IDENTITIES = 16;

/**
 * Put one entry's row into a registered transcript's state, and let the entry
 * say it painted the first time.
 *
 * The callback fires AFTER the mutation, in the same synchronous block, so the
 * two state updates a composer cares about (the row appearing, the box emptying)
 * are batched into one commit - and only ONCE per entry, so the drain that
 * follows a seed cannot fire it a second time.
 */
function applyPendingSend(
	target: (mutate: (state: TranscriptState) => TranscriptState) => void,
	entry: PendingSend,
): void {
	target((state) =>
		appendPendingUser(state, entry.id, entry.text, entry.images),
	);
	if (!entry.painted) {
		entry.painted = true;
		entry.onPainted?.();
	}
}

/**
 * Splice new text into a record only while it is still this app's own
 * optimistic row.
 *
 * Local to this module on purpose: this is a mutation of ONE local record, not
 * a transcript rule, and the reducer deliberately has no exported spelling for
 * "rewrite the echo" - the durable semantics (upsert, coalescing) live there,
 * while the only writer of a local row's TEXT is the credential seam's late
 * substitution. `index` is untouched because the record keeps its position;
 * the owner's row having replaced ours makes this a no-op, which is exactly
 * right (the wire text won, the seam lost the race).
 */
function replaceLocalRecordText(
	state: TranscriptState,
	id: string,
	text: string,
): TranscriptState {
	const at = state.index.get(id);
	const record = at === undefined ? undefined : state.records[at];
	if (
		at === undefined ||
		!record ||
		record.kind !== "user" ||
		!record.local ||
		record.text === text
	)
		return state;
	const records = state.records.slice();
	records[at] = { ...record, text };
	return { ...state, records };
}

/**
 * Paint the user's message optimistically under `identity`, RETAINING the entry
 * until it is resolved.
 *
 * Called at the PRESS - before `sessions.create` on the New-chat path and
 * before the message request on every path - so the row is on screen for the
 * whole engage and the composer can release the text at the same commit. The
 * application is synchronous when a transcript for `identity` is mounted
 * (the existing-session path, and the draft pane, whose registration is keyed
 * by the pane's own identity); retained when none is (the flip's replacement
 * panel does not exist yet), and drained by whichever registers first.
 */
export function paintPendingSend(
	identity: string,
	send: {
		id: string;
		text: string;
		images: TranscriptImage[];
		onPainted?: () => void;
		/** Only `resynthesisePendingSend`'s resolved arm passes this; see `settled`. */
		settled?: boolean;
		/** The press's clock anchor; see `PendingSend.submittedAt`. */
		submittedAt?: number;
	},
): void {
	let entries = pendingSends.get(identity);
	if (!entries) {
		if (pendingSends.size >= MAX_PENDING_SEND_IDENTITIES) {
			// Insertion order: the least recently painted identity goes whole.
			const oldest = pendingSends.keys().next();
			if (!oldest.done) pendingSends.delete(oldest.value);
		}
		entries = new Map();
		pendingSends.set(identity, entries);
	}
	/*
	 * `set` rather than a push: a re-paint under the same id (a retry whose
	 * payload is unchanged) replaces the entry, and `Map` keeps its insertion
	 * position, so the oldest-first bound still measures by FIRST paint while
	 * the row keeps one identity.
	 */
	const entry: PendingSend = {
		identity,
		id: send.id,
		text: send.text,
		images: send.images,
		onPainted: send.onPainted,
		settled: send.settled,
		submittedAt: send.submittedAt,
	};
	entries.set(entry.id, entry);
	while (entries.size > MAX_PENDING_SENDS_PER_IDENTITY) {
		const oldest = entries.keys().next();
		if (oldest.done) break;
		entries.delete(oldest.value);
	}
	const target = echoTargets.get(identity);
	if (target) applyPendingSend(target, entry);
}

/**
 * The send this identity has painted and the owner has not answered.
 *
 * THE ONE PREDICATE for "a send this pane made is still going out": the pane's
 * collapse, the band's emptiness and the page's wait-line latch all read it, and
 * the registry drops an entry exactly when the claim stops being true (the
 * owner's row observed, or the user resolving a failure). A SETTLED entry is not
 * dropped - the row it painted is still the message's home - but it is not a
 * send still going out, so it does not answer here (`settled`).
 *
 * Oldest first, so when a retry has painted a second entry the row a reader has
 * been waiting on longest is the one named.
 */
export function pendingSendForView(
	identity: string | null | undefined,
): PendingSend | null {
	if (!identity) return null;
	const entries = pendingSends.get(identity);
	if (!entries) return null;
	for (const entry of entries.values()) {
		if (!entry.settled) return entry;
	}
	return null;
}

/**
 * Drop one entry, because its claim is over: the owner's durable row was
 * observed, the user's Edit retired a failure, or the draft was abandoned.
 */
export function resolvePendingSend(identity: string, id: string): void {
	const entries = pendingSends.get(identity);
	if (!entries) return;
	entries.delete(id);
	if (entries.size === 0) pendingSends.delete(identity);
}

/**
 * Mark a retained entry's claim as ANSWERED, keeping the entry for its row.
 *
 * The resolution path's counterpart to `resolvePendingSend`: the server's
 * complete read said the message never landed, so no owner row will ever arrive
 * to resolve the entry - but the row it painted is the message's own statement
 * and must keep painting (the design's D1/D2). A later mount re-paints the same
 * entry settled (`resynthesisePendingSend`); this call covers the tab that never
 * reloaded, so the very frame the resolution lands on stops answering "still
 * going out" to every reader of `pendingSendForView`.
 */
export function settlePendingSend(identity: string, id: string): void {
	const entry = pendingSends.get(identity)?.get(id);
	if (entry) entry.settled = true;
}

/**
 * Whether the identifier already has an entry - settled or not.
 *
 * The re-synthesis pass's guard, and it has to see settled entries: a resolved
 * row is re-painted on a later mount precisely because the entry is RETAINED,
 * so "an entry exists" is what stops a second one being painted over it. This is
 * the membership question, where `pendingSendForView` is the liveness one.
 */
export function hasPendingSend(
	identity: string | null | undefined,
	id: string,
): boolean {
	if (!identity) return false;
	return pendingSends.get(identity)?.has(id) === true;
}

/**
 * Whether this identity RETAINS an entry at all, settled or not.
 *
 * THE ROW-EXISTENCE QUESTION, as distinct from `pendingSendForView`'s liveness
 * one (agent review round 2's re-shoot). The composer stands down while a row is
 * on screen to speak the failure it is the home of (S4/J4) - and a settled
 * claim's row is still a row. The settled distinction exists for the wait line's
 * sake; using the LIVENESS predicate for this gate handed the sentence back to
 * the composer the moment a failure settled its own claim, which is the
 * duplicate statement (row + alert) J4 forbids. Measured on the round-2
 * re-shoot's first run.
 */
export function retainsPendingSend(
	identity: string | null | undefined,
): boolean {
	if (!identity) return false;
	return (pendingSends.get(identity)?.size ?? 0) > 0;
}

/**
 * Replace one entry's text in place, under the same id.
 *
 * The credential seam's substitution is the only caller: on the New-chat path
 * it runs after the paint (there is no session to store into before the create
 * answers), and the row the user is already looking at must update once rather
 * than be re-painted as a second message. `rendered` is the same message with
 * its markers substituted, so identity and position are unchanged - a text
 * splice applied now if a transcript is mounted, and left for the next seed if
 * not.
 */
export function replacePendingSendText(
	identity: string,
	id: string,
	text: string,
): void {
	const entry = pendingSends.get(identity)?.get(id);
	if (!entry) return;
	entry.text = text;
	const target = echoTargets.get(identity);
	if (target) target((state) => replaceLocalRecordText(state, id, text));
}

/**
 * Move every entry for one identity to another - the identity flip's re-key.
 *
 * Run in the SAME synchronous block that patches `draft.sessionId` (see
 * `admitChatDraft`), so the replacement panel's first frame
 * (`seedPendingSends`) already holds the row it was showing under the draft
 * key: no duplicate, no gap, and the record's own id is what the following
 * frames coalesce on.
 */
export function movePendingSendIdentity(from: string, to: string): void {
	if (from === to) return;
	const entries = pendingSends.get(from);
	if (!entries) return;
	pendingSends.delete(from);
	const destination = pendingSends.get(to) ?? new Map<string, PendingSend>();
	for (const [id, entry] of entries) {
		entry.identity = to;
		destination.set(id, entry);
	}
	pendingSends.set(to, destination);
}

/**
 * Drop every retained entry. Compilation is per-bundle, so this is WINDOW
 * state; a suite that reuses one conversation id across cases needs each case
 * to start from an empty registry rather than inheriting the previous case's
 * unresolved send. Never called by the app; exported beside
 * `__registerEchoTarget` for the same reason that is, and the harness owns the
 * state its own cases share (see `__resetPaintCache`).
 */
export function __resetPendingSends(): void {
	pendingSends.clear();
}

/**
 * Drop every entry for an identity that will not be coming back.
 *
 * Called when a draft is abandoned (`discardDraft`), so the text and images do
 * not sit in memory waiting for a pane that has no reason to mount. Safe to
 * call for an identity with nothing retained.
 */
export function discardPendingSends(identity: string): void {
	pendingSends.delete(identity);
}

/**
 * The pane's own resolution pass: drop every entry whose id the transcript now
 * holds as the OWNER's row.
 *
 * WHY THE PANE DOES THIS AND NOT THE STORE. Only a transcript can answer the
 * question - a durable row is a record, and the store never sees one. The
 * predicate is the same one `appendPendingUser`'s `local` flag exists for: our
 * optimistic row carries `local`; the owner's `message_start` (or a durable
 * history row) for the same id does not, and its arrival is the app's proof
 * that the claim ended. Cheap by construction: it walks the entries (at most 4)
 * rather than the records, on each committed transcript change.
 */
export function resolveObservedPendingSends(
	identity: string,
	transcript: TranscriptState,
): void {
	const entries = pendingSends.get(identity);
	if (!entries) return;
	for (const id of [...entries.keys()]) {
		const at = transcript.index.get(id);
		const record = at === undefined ? undefined : transcript.records[at];
		if (record?.kind === "user" && record.local !== true)
			resolvePendingSend(identity, id);
	}
}

/**
 * Register a transcript as the target for a conversation identity, draining
 * whatever was painted before it existed, and return the matching unregister.
 *
 * Extracted from the effect below so the delivery rule is exercised against the
 * REAL registry rather than a recorder standing in for it. That distinction is
 * not academic: review round 1's blocker — the draft-path echo being dropped
 * because nothing was listening yet — was invisible to every existing test
 * precisely because they aliased this seam to a stub that always recorded.
 *
 * NOTHING IS TAKEN, unlike the buffer this replaces: the entries stay, because
 * the next mount - the identity flip, a switch back, a reload - must seed the
 * same rows again. Re-applying is harmless by construction (`appendPendingUser`
 * no-ops for an id already present, and a `local` row can never overwrite the
 * owner's), which is what makes the retention safe where the old take-and-delete
 * rule existed to stop a replayed retraction from deleting a durable row.
 */
export function __registerEchoTarget(
	identity: string,
	apply: (mutate: (state: TranscriptState) => TranscriptState) => void,
): () => void {
	echoTargets.set(identity, apply);
	const entries = pendingSends.get(identity);
	if (entries) {
		for (const entry of entries.values()) applyPendingSend(apply, entry);
	}
	return () => {
		// Only if still ours: a remount for the same identity registers before the
		// old effect cleans up, and an unconditional delete would drop the live
		// registration.
		if (echoTargets.get(identity) === apply) echoTargets.delete(identity);
	};
}

/**
 * The transcript a panel starts from, with everything retained for its identity
 * applied - so the FIRST frame it paints can hold the row.
 *
 * Why this exists rather than letting the drain do it: on the New-chat path the
 * panel that receives the row is a fresh mount (the identity flips from the
 * draft key to the session id, which is what makes it remount), and its paint
 * arrives through a PASSIVE effect - after the commit that painted its first
 * frames. Those frames would therefore hold an empty transcript and a
 * `connecting` status while the user's message was already in flight (UX
 * round 1, U3). Seeding the initial state closes that gap at its source: the
 * retained rows are in the state React paints first, and the drain that follows
 * re-applies them to no effect (`appendPendingUser` is a no-op for an id
 * already present).
 *
 * A PEEK, deliberately, not a take - and now not even destructive of the
 * registry: `resolvePendingSend` is the only thing that removes an entry, and
 * a render is free to be discarded, so a seed must not mutate shared state. The
 * drain stays the only writer, and both readers replay the same rows.
 */
export function seedPendingSends(
	identity: string,
	state: TranscriptState,
): TranscriptState {
	const entries = pendingSends.get(identity);
	if (!entries) return state;
	let seeded = state;
	for (const entry of entries.values()) {
		seeded = appendPendingUser(seeded, entry.id, entry.text, entry.images);
	}
	return seeded;
}

/**
 * Whether a change of the pane's stream id is a change of CONVERSATION - i.e.
 * whether `useCanonicalSessionStream`'s reset effect must replace the transcript.
 *
 * Extracted rather than computed inline for the reason `draftIdentityFor` and
 * `panelIdentityFor` state: a rule that only exists inside an effect cannot be
 * exercised outside a renderer, and this one is load-bearing.
 *
 * THE MINT'S BRIDGE ID IS NOT A SESSION (UX round 1, U1). A draft pane's stream
 * id moves `undefined` -> the id `sessions.draft` minted when the first
 * keystroke's mint answers, while the conversation the pane SHOWS
 * (`panelIdentityFor(draftKey, id)`) is unchanged - still the draft key. The
 * reset used to read that swap as "a different session", replace the transcript
 * with the new id's cached paint (a draft bridge has none), and take the row the
 * press had just painted with it: measured on a warm-capable daemon (installed
 * `lop` 0.63.2, which advertises `session_draft_warm`) as the press reading
 * `rows:0` with the row reappearing only at the flip, Enter beating the mint's
 * answer in the 25 ms the rig types and presses. A bridge id names no session
 * page, so a swap to (or between) bridge ids never replaces the transcript; a
 * REAL session id still does, which is the rule's other arm.
 */
export function streamChangeKeepsTranscript(
	previous: string | undefined,
	next: string | undefined,
	/** Whether `next` is a session this pane can be owed a page for. */
	nextIsSession: boolean,
): boolean {
	if (previous === next) return true;
	return !nextIsSession;
}

/**
 * Remove an echo whose send was refused before anything was admitted. Never
 * call this for an ambiguous failure: see `admitChatDraft`.
 *
 * Queued like the paint it undoes, and for the same reason: a refusal can
 * resolve before the panel mounts, and a retraction that was dropped while the
 * paint it cancels was queued would leave the echo painted for a message that
 * was provably never admitted.
 */
/**
 * What became of an attempt to retract an unconfirmed echo.
 *
 * `retracted` - the row was this app's own echo and is gone, so the message is
 * not on the owner's transcript and the content belongs back with the user.
 * `owner` - the row is the owner's, which means the message WAS delivered and the
 * failure was the response to it; nothing may be retracted.
 * `queued` - no transcript is mounted for this session, so the retraction is
 * parked exactly as the echo was and the pane's own reconciliation decides it
 * when a panel mounts.
 */
export type EchoRetraction = "retracted" | "owner" | "queued";

/**
 * Retract an echo whose send failed, but ONLY while it is still our own echo.
 *
 * The counterpart of `retractPendingUser` for the case where the app cannot say
 * whether the message reached the session. Both rows would carry the same id, so
 * the id cannot answer the question - `appendPendingUser`'s `local` flag does, and
 * an owner row (its `message_start`, or a durable history row) never has it. See
 * `removeLocalRecord` for why that distinction is worth a field on the record.
 */
export function retractLocalEcho(
	sessionId: string,
	id: string,
): EchoRetraction {
	const target = echoTargets.get(sessionId);
	if (!target) {
		/*
		 * Nothing is mounted, so the row this retracts was never painted
		 * anywhere: there is no record to remove, and resolving the entry IS the
		 * whole act - a later seed must not paint a message the app knows is not
		 * on the owner's transcript. "queued" is still the right answer for the
		 * caller: the decision has been taken and no mounted pane can have seen
		 * anything else.
		 */
		resolvePendingSend(sessionId, id);
		return "queued";
	}
	let outcome: EchoRetraction = "queued";
	target((state) => {
		const record = state.records[state.index.get(id) ?? -1];
		if (!record || record.kind !== "user") return state;
		if (!record.local) {
			outcome = "owner";
			return state;
		}
		outcome = "retracted";
		return removeRecord(state, id);
	});
	/*
	 * EITHER ANSWER RESOLVES THE ENTRY. `retracted` means the row just came off
	 * the screen, so a later seed must not paint it back; `owner` means the id's
	 * record is the owner's own - the claim is answered, whether or not this
	 * pane's resolution effect has run yet. Leaving the entry in either case is
	 * the one way the new retention could resurrect a message that is provably
	 * not ours to show.
	 */
	resolvePendingSend(sessionId, id);
	return outcome;
}

export function retractPendingUser(sessionId: string, id: string): void {
	/*
	 * The ENTRY goes with the record, and it has to: with retention, a dropped
	 * record that still had an entry would be painted again by the next seed -
	 * and this call means the message is provably not on the owner's transcript,
	 * so nothing must bring its row back.
	 */
	resolvePendingSend(sessionId, id);
	const target = echoTargets.get(sessionId);
	if (target) target((state) => removeRecord(state, id));
}

/**
 * Whether the row an admission request id names is STILL ours - the verdict
 * `retractLocalEcho` reads, without its act.
 *
 * §F3's arm (agent review round 4, R17): an UNKNOWN outcome KEEPS the message
 * on screen - the row wears `Not delivered · Send again · Edit` until the
 * server's own answer resolves the claim - so the send path may not have the
 * removal `retractLocalEcho` performs. `owner` still means the message was
 * delivered, and nothing may be reported as failed. `local` and `unseen` (the
 * row is our own echo, or no transcript is mounted to hold it - in which case
 * the pane's own reconciliation reads it again when one mounts), both leave the
 * row alone and let the payload come home to the composer as well.
 */
export function peekLocalEcho(
	sessionId: string,
	id: string,
): "owner" | "local" | "unseen" {
	const target = echoTargets.get(sessionId);
	if (!target) return "unseen";
	let outcome: "owner" | "local" | "unseen" = "unseen";
	target((state) => {
		const record = state.records[state.index.get(id) ?? -1];
		if (!record || record.kind !== "user") return state;
		outcome = record.local ? "local" : "owner";
		return state;
	});
	return outcome;
}

/**
 * The paint a conversation starts from: the cached rows, and whether anything
 * was cached at all.
 *
 * The optimistic sends go on top at the CALLER (`seedPendingSends`), because
 * only the caller knows the pane's own identity: the cache is addressed by
 * session id, while the row a press just painted may still be addressed by the
 * draft key. Same order either way - a send is NEWER than the cached rows - and
 * one seeding site is one place for the rule to live.
 */
function paintSeed(sessionId: string): {
	transcript: TranscriptState;
	stale: boolean;
	owedLabels: ReadonlySet<string>;
	markLabels: ReadonlySet<string>;
} {
	const cached = readPaint(sessionId);
	if (!cached) {
		return {
			transcript: EMPTY_TRANSCRIPT,
			stale: false,
			owedLabels: NO_LABELS_PENDING,
			markLabels: NO_LABELS_MARKED,
		};
	}
	return {
		transcript: cached.transcript,
		stale: true,
		// The rows this paint was still waiting on, so the FIRST frame already knows
		// which object columns must stay empty. See `owedLabels` in `paint-cache.ts`
		// for why the store carries them beside the rows rather than leaving each
		// mount to guess.
		owedLabels: cached.owedLabels,
		// And the ones whose hold a refusal ended, whose mark was standing instead.
		// Same argument one state over: rows cannot say whether a column owes the
		// mark or may fall back to the call's OUTPUT.
		markLabels: cached.markLabels,
	};
}

/**
 * Whether a snapshot's page is, BY CONTRACT, the journal's durable tail - so a
 * `/history` read on the same open would fetch the same rows a second time.
 *
 * THE DUPLICATE (backend load diagnosis, B-F9). Every open paid two copies of one
 * 100-row page: the snapshot's own (~237 KB) and the `/history` reconcile that
 * `needsReconcile` fired right after it (~229 KB), serially, on the path to the
 * first paint. The reconcile exists for pages that can stop short of the tail,
 * and before `local-operator` b25ee8b4 (v0.54.39) that was every page: the
 * snapshot was cut at the owner's frontend `history_cursor`, a refresh
 * watermark that lags durable rows (the steer-drain case), so only a read the
 * renderer issued itself could find what the cut dropped. That is what
 * `pageIsPaintedTail`'s cursor test below still guards against.
 *
 * Since that change the page is read from the journal's tail, "the same
 * unbounded read `/history` serves" (`docs/DESKTOP_API.md`, the snapshot
 * section), and it can no longer be short of the tail. The renderer cannot ask
 * the backend's version, so it asks the FRAME: `cold_reason` arrived in
 * 93542f91 (v0.56.6), which descends from b25ee8b4, so a snapshot that carries
 * the token was necessarily built by a backend whose page is the tail. A frame
 * without it keeps today's read-back, which is the conservative direction: an
 * older backend costs the duplicate, never a missing row.
 *
 * NOT covered, deliberately, and each still reads: an EMPTY page (the contract's
 * "reconcile through `/history`" signal - today every cold facade, whose state
 * has no `history_cursor`), `cursor_missing`, and the label-gap retry, which is
 * decided separately (`missingLabels`) and does not go through this test.
 */
function pageIsJournalTail(snapshot: DesktopSnapshot): boolean {
	return (
		/*
		 * PRESENCE, not string-ness (agent review round 1, F2). The backend merges
		 * `_cold_fields()` into every snapshot, and for a LIVE owner that is
		 * `cold_reason: null` - which is exactly the case whose page is non-empty
		 * and therefore the only one that paid the duplicate. Testing
		 * `typeof === "string"` rejected it. An older backend sends no key at all,
		 * so the key's presence still discriminates versions.
		 */
		"cold_reason" in snapshot &&
		!snapshot.history.cursor_missing &&
		snapshot.history.entries.length > 0
	);
}

/**
 * The id a durable page entry paints under in the transcript index (#876).
 *
 * A tool entry keys by its CALL id — the reducer mints `tool:<call_id>` so a
 * live start and end for the same call coalesce onto one row — while every
 * other entry keys by its own id. The reconcile gate and the walk compare
 * page entries against held rows to decide whether a read is owed; without
 * this key a held tool row reads as "not held", and the comparison could not
 * recognise the very row its whole purpose is to reach.
 */
function entryRecordKey(entry: DesktopHistoryPage["entries"][number]): string {
	const callId = entry.payload?.tool_call_id;
	if (entry.payload?.role === "tool" && typeof callId === "string" && callId)
		return `tool:${callId}`;
	return entry.id;
}

export function useCanonicalSessionStream(
	sessionId: string | undefined,
	enabled: boolean,
	/**
	 * Whether `sessionId` is a SESSION this pane can be OWED a page for, or a
	 * DRAFT's bridge subscription (`sessions.draft`'s minted id).
	 *
	 * The two ids have the same shape and only the caller knows which one it
	 * holds: `SessionPanel` passes `sessionId ?? draft?.warmId`, so the pane's own
	 * `sessionId` is the answer. A draft's stream exists to hold the engage open,
	 * not to deliver a page - nothing here is "still loading" until the user's
	 * first send creates a conversation (see `awaitingHydration`). Every
	 * pre-draft caller passes a session id and keeps the `true` default.
	 */
	isSession = true,
	/**
	 * The conversation identity THIS PANE addresses - `panelIdentityFor(draftKey,
	 * id)`, i.e. the draft key before the create answers and the session id
	 * after.
	 *
	 * It is the key of the echo registry and of the first-frame seed, and it is
	 * deliberately not `sessionId`: for a fresh draft the stream id is the minted
	 * warm (or nothing at all), while the row a press paints is addressed by the
	 * pane's own key. Defaults to `sessionId`, which is what every pre-draft
	 * caller's identity is.
	 */
	identity: string | undefined = sessionId,
): CanonicalSessionHandle {
	const [view, setView] = useState<CanonicalSessionView>(() => {
		const seed = enabled && sessionId ? paintSeed(sessionId) : null;
		return {
			status: "connecting",
			frontend: null,
			// Nothing has been painted yet, so there is no reading to hold: a pane
			// that has never had a snapshot is genuinely without readings, and a
			// held copy here would be a claim this mount never received.
			heldFrontend: null,
			pendingModel: null,
			history: null,
			cold: false,
			subscriptionId: null,
			ownerEpoch: null,
			receipt: null,
			terminal: null,
			turnsCompleted: 0,
			failure: null,
			/*
			 * SEEDED, and only here. A panel mounted while a send for its own identity
			 * is already painted must paint that row in its FIRST frame: on the
			 * New-chat path this mount IS the identity flip the send triggers, and a
			 * drain reaches the panel through a passive effect - one commit too late -
			 * unless the initial state already holds it. See `seedPendingSends` for why
			 * this is a peek rather than a take, and why the drain that follows is
			 * harmless.
			 *
			 * The echo is applied OVER the cached paint rather than instead of it.
			 * They are different claims about the same first frame: the paint is this
			 * window's memory of the conversation (the click-path states this branch
			 * exists for are painted from it), and the echo is a message just sent
			 * into that conversation. Seeding the echo alone would drop the rows the
			 * click path came for; seeding the paint alone would drop the echo. So the
			 * echo composes on top of the paint and neither seam is lost.
			 */
			transcript: identity
				? seedPendingSends(identity, seed?.transcript ?? EMPTY_TRANSCRIPT)
				: EMPTY_TRANSCRIPT,
			// A cached paint is a real memory of a real transcript, but it is not the
			// owner's current state — so it says so until the snapshot lands.
			stale: seed?.stale ?? false,
			missing: false,
			loadingOlder: false,
			olderFailed: false,
			// No child has been heard from yet: the snapshot that follows seeds the
			// counter from its own `live_events`.
			subagentPulses: {},
			/*
			 * The rows a cached paint was still waiting on, in the SAME frame as the
			 * rows themselves. A cache that paints result text into the object column
			 * and corrects it one read later is the jitter this hold exists to prevent,
			 * and the only place the distinction can be made is here: the rows cannot
			 * say whether their arguments are absent or merely not read yet.
			 *
			 * EMPTY for a mount with no cache: there is nothing painted to hold, and the
			 * snapshot's own flush registers its targets (`firstAttempts`).
			 */
			labelPending: seed?.owedLabels ?? NO_LABELS_PENDING,
			labelMarked: seed?.markLabels ?? NO_LABELS_MARKED,
			labelHoldLate: false,
			/*
			 * NOT hydrated, even when the initial transcript above was seeded from a
			 * pending echo. The two are different claims: an echo is this renderer's own
			 * optimistic paint of a message it just sent, while `hydrated` means an
			 * AUTHORITATIVE page for this session has been applied. A seeded echo is
			 * therefore no evidence at all about whether the conversation is empty - it
			 * is evidence that we sent something - and the panel still waits for the
			 * snapshot or the `/history` reconcile before the composer may say the
			 * conversation has nothing in it. (#118's seeding does not need hydration for
			 * what it is for: the echo makes `transcript.records` non-empty on the first
			 * frame, which is what suppresses the greeting and paints the message.)
			 */
			hydrated: false,
			// No walk of this mount has been dispatched yet; the first read raises
			// this, and its exit lowers it again.
			historyReadPending: false,
		};
	});

	/*
	 * THE ONE WRITER OF THE VIEW, and it lands the new value on a ref BEFORE React
	 * sees anything.
	 *
	 * WHY THIS EXISTS AT ALL (review round 1, M3): the echo registry ANSWERS A
	 * QUESTION about the transcript - `peekLocalEcho` reports whether the row
	 * under an admission request id is still this app's own echo or the owner's -
	 * and that answer decides whether a failed payload is treated as delivered or
	 * handed back to the composer beside the kept row. The answer was read from
	 * inside the update,
	 * so REACT'S SCHEDULING decided it: an update already queued in the same batch
	 * (which is exactly the case that matters, the owner's row arriving as the
	 * failure resolves) meant the updater had not run when the registry asked, the
	 * answer fell back to "queued", and a delivered message was handed back to the
	 * composer as a draft - the duplicate QA measured. Computing against the ref and
	 * then committing the VALUE makes every read of the view synchronous and every
	 * mutation exactly-once, without making React render any differently.
	 *
	 * Every mutation in this hook goes through here, and that is checkable rather than
	 * aspirational: `setView` appears in this file exactly ONCE, on the line below, and
	 * `scripts/canonical-chat.test.mjs` pins the count. A bare `setView(` beside it is a
	 * write the ref cannot see, and the next commit from here spreads the stale ref over
	 * it - which is not theoretical: it is what left released labels held in round 8.
	 */
	const viewRef = useRef(view);
	const commitView = useCallback(
		(
			update: (current: CanonicalSessionView) => CanonicalSessionView,
		): CanonicalSessionView => {
			const next = update(viewRef.current);
			if (next === viewRef.current) return next;
			viewRef.current = next;
			setView(next);
			return next;
		},
		[],
	);
	/*
	 * Which session the transcript IN `view` belongs to, so the reset effect
	 * below can tell another session's rows from this one's own seeded echo.
	 *
	 * WHY THIS EXISTS RATHER THAN A SECOND SEED. `seedPendingSends` above puts a
	 * retained row in a panel's FIRST frame - and the effect below used to
	 * overwrite that same state with `EMPTY_TRANSCRIPT` one commit later, because
	 * its only question was "did the session id change". On the New-chat path the
	 * panel that mounts IS the identity flip, so its first render is the seeded
	 * one and the reset then wiped the echo it had just been given: measured in
	 * the live app, the row was seeded (records: 1 at +74 ms) and the mounted
	 * transcript read 0 records for the whole eleven seconds the pane was waiting,
	 * with the message appearing only when the owner's durable row arrived with
	 * the first frame (UX round 2, U1). Seeding again in the effect would be a
	 * second mechanism doing the initializer's job and would still lean on effect
	 * ORDER (the drain registration is declared below), so the reset asks whether
	 * this state is already this session's instead.
	 *
	 * A ref rather than state: it is read inside the effect's updater, must not
	 * schedule a render of its own, and only ever changes at a session boundary -
	 * the same moments the effect itself runs.
	 *
	 * A SESSION BOUNDARY, NOT EVERY STREAM-ID CHANGE: the mint's bridge id is not
	 * a session, and the swap to it must not read as one (see
	 * `streamChangeKeepsTranscript`, UX round 1's U1).
	 */
	const transcriptSession = useRef<string | undefined>(sessionId);
	// Mutable side-channel for the frame pump; React state is the published,
	// coalesced view. Frames arriving between renders collect here.
	const pending = useRef<DesktopSessionFrame[]>([]);
	// Read outside the React updater (see the flush comment), so the painted set
	// is tracked here rather than through the view state itself.
	const paintedIds = useRef<TranscriptState["index"]>(EMPTY_TRANSCRIPT.index);
	/*
	 * Call ids a mid-turn snapshot's seed could not label, how many times we have
	 * read back for each, how deep that read had to go, and the seed order a
	 * round-end retry measures itself against. See `seedCallsMissingLabels`: the
	 * seed keeps only the settling frame, so a viewer that joins a turn in flight
	 * is handed rows with no arguments, and the arguments live in the durable
	 * transcript - which does not hold the round that is still running yet.
	 *
	 * THAT is why this outlives its flush. A single read-back at the snapshot can
	 * only label the calls whose rows became durable BEFORE the join; the round
	 * in flight becomes durable at its own turn end, so the read has to be
	 * repeated once per round for as long as the gap lasts. Capped per id rather
	 * than globally, because the gap closes for most calls on the first retry and
	 * a call that can never be labelled must not buy a history page per turn for
	 * the rest of the conversation: a rejected plan never emitted a start and has
	 * no assistant row either, so nothing will ever name it.
	 *
	 * IT ALSO OUTLIVES THE MOUNT, unlike the three refs it replaces: the state
	 * lives in `labelGaps` keyed by conversation, so a switch away and back does
	 * not make a conversation that has already painted its rows a stranger whose
	 * first paint may be held empty again (round 1, QA Q1).
	 */
	const labelGapRef = useRef<LabelGapState>(labelGapFor(sessionId));
	/**
	 * The ids THIS MOUNT has a label read out for, so teardown drops its own.
	 *
	 * `labelGapRef.current.inFlight` outlives the mount - it lives in `labelGaps`
	 * keyed by conversation - but the READS do not: this pane's walks are abandoned
	 * the moment it goes away. Without this set, the tear-down can only clear the
	 * whole in-flight set (which takes a successor's ids with it) or nothing (which
	 * leaves this pane's ids justifying a hold on a read nobody can still name).
	 * `labelGapRef.current` is re-pointed at another conversation on a session
	 * change, so the tear-down reads this set BEFORE the pointer moves - the stream
	 * effect's cleanup runs first, on the deps that moved.
	 */
	const inFlightOwned = useRef<Set<string>>(new Set());
	/*
	 * `labelGapRef.current.attempts` is the per-call count the comment above is
	 * about.
	 *
	 * `labelGapRef.current.depth` is the deepest a label read has had to go in
	 * this conversation, in rows, so a later label read never starts shallower
	 * than one that already needed that depth. The calls a round-end retry is for
	 * are the OLDEST of the gap - the newer ones were labelled by the first read
	 * - so the retry used to be sized `reconcileLimit(remaining)`, a read that got
	 * SMALLER exactly as the calls it was for got further away, and on the
	 * reported session it labelled none of them. It is floored only by a walk that
	 * actually LABELLED a call at that depth (round 1, R1): a walk that read deep
	 * and found nothing has learned nothing about where the next read should
	 * start, and flooring on it is how one unpresent call made every later retry
	 * in the session a 500-row read.
	 *
	 * `labelGapRef.current.order` is the newest snapshot seed's settled calls,
	 * oldest first: the positions a round-end retry (which arrives with no
	 * snapshot) measures its walk against, so a retry for calls of the round still
	 * running stops where the durable rows end instead of paging to the walk's
	 * bound.
	 */
	const receiptRef = useRef<{ epoch: string; seq: number } | null>(null);
	const reconnectRef = useRef<{ epoch?: string; afterSeq?: number }>({});
	/**
	 * The user-visible Retry, owned by the effect that holds the stream.
	 *
	 * A ref rather than a callback returned from the effect because the action
	 * has to be reachable from the published view while the effect stays the
	 * only thing that opens a subscription: the handle's `retry` reads this at
	 * call time, so it always names the CURRENT session's recovery or nothing at
	 * all.
	 */
	const retryRef = useRef<(() => void) | null>(null);
	/*
	 * `rehydrate`'s own door, on the same lifetime rule as `retryRef`: non-null
	 * only while this effect owns the stream, so a click after the session
	 * changed (or after unmount) cannot re-read the old session.
	 */
	const hydrateRef = useRef<(() => void) | null>(null);
	/*
	 * How many `reconcileTail` walks are out for this view, so the pending paint
	 * and the no-stack guard read one number. A count rather than a flag because
	 * the walks OVERLAP - a label walk and the warm re-arm's walk can be in
	 * flight for one conversation - and only the last exit may clear the paint.
	 */
	const historyReadsRef = useRef(0);
	const generationRef = useRef(0);

	useEffect(() => {
		if (!sessionId || !enabled) return;
		const generation = ++generationRef.current;
		let dispose: (() => void) | null = null;
		/*
		 * True while WE are the reason the stream is being torn down.
		 *
		 * The two transports disagree about what an `end` means, and this hook has
		 * to survive both: Electron's relay says nothing when a subscription is
		 * dropped, while the browser EventSource path emits `end` from its own
		 * dispose (see `subscribeDesktopStream`). Treated as a failure, that
		 * self-inflicted `end` consumed a second retry attempt per failure AND
		 * re-entered `connect()` from inside the teardown - so the budget was spent
		 * at double rate and two subscriptions raced, which is the opposite of the
		 * bounded recovery this exists for.
		 */
		let closingIntentionally = false;
		let raf = 0;
		let fallback = 0;
		/** Failed connection attempts since the last snapshot; see
		 * `STREAM_RETRY_DELAYS_MS` for the budget this counts against. */
		let attempt = 0;
		let retryTimer = 0;
		let reconcileTimer = 0;
		/** Armed per connection until its first snapshot; see `STREAM_SNAPSHOT_DEADLINE_MS`. */
		let snapshotTimer = 0;
		/** The one silent re-check after a fired bound; see `STREAM_SNAPSHOT_RECHECK_MS`. */
		let recheckTimer = 0;
		let rechecked = false;
		const clearSnapshotTimer = () => {
			if (!snapshotTimer) return;
			window.clearTimeout(snapshotTimer);
			snapshotTimer = 0;
		};

		/**
		 * Read the durable tail back and merge it, walking further back until a
		 * fetched page has reached BOTH seams this walk owes: the rows the frame
		 * batch painted, and the rows this pane held before it (#876).
		 *
		 * WHY A SNAPSHOT ALONE CANNOT BUY THIS READ. A snapshot's history page used to
		 * be read `through_id=<the owner's published history_cursor>`, so its newest
		 * entry WAS that cursor by construction — the two agreed even when the cursor
		 * was stale. That made the page unverifiable from the frame: a page stopping
		 * short of the durable tail (rows written after the cursor was captured, e.g.
		 * while this reader was on another conversation) was non-empty and reported
		 * `cursor_missing: false`, indistinguishable from a complete one. Comparing
		 * `history.entries` against `frontend.snapshot.history_cursor` therefore proved
		 * nothing — they were one value on two fields.
		 *
		 * THE SENTENCE THAT REPLACED IT is that the two owner shapes ARE now
		 * distinguishable from the frame alone, by the one test no cursor-bounded page
		 * can pass: a page whose newest entry is NOT the published cursor has served
		 * rows PAST its own watermark, which only a page read from the journal's tail
		 * can do. So a page that is non-empty, ends on a row this viewer already had on
		 * screen, and extends past the cursor is the journal tail and this viewer is at
		 * it: nothing exists between them to fetch, and the read is skipped (see
		 * `needsReconcile` below). Everything else still reads, including the shape
		 * this read was written for — a page ending AT the cursor, and a page whose
		 * newest row this viewer never painted.
		 *
		 * AND THAT SKIP IS BOUNDED BY THE SEAM, NOT THE FRAME (#876). "The page is
		 * the journal's tail" is a fact about the journal; it says nothing about
		 * whether the page CONNECTS to what this pane holds. A reopen whose cached
		 * block sat hours behind the page took the skip as unconditional and lost
		 * the five hours between them — so the journal-tail arm of the gate asks the
		 * held question too (`pageIsPaintedTail` below), and the walk carries the
		 * same seam as its second connection.
		 *
		 * THE BOUND, which is different in the two cases:
		 *
		 *  - something WAS painted (the common case): the first read is the tail,
		 *    and it is the only one unless it fails a CONNECTION — the walk then
		 *    continues until both are made: to the rows this batch painted, and to
		 *    the rows the pane HELD before it (`heldIds`, captured before this
		 *    flush's own commits; a held set that included this batch's rows would
		 *    make the test true by construction, which is #876's stand-down). The
		 *    walk is stopped by `has_more` or by `RECONCILE_WALK_MAX_ROWS` (500
		 *    rows, read in `RECONCILE_TAIL_ENTRIES`-sized pages). A snapshot whose
		 *    page already connects costs exactly one page, which is what this path
		 *    paid before the guard existed.
		 *  - NOTHING was painted (a cold or cursor-less snapshot, an attention
		 *    frame naming an unpainted anchor with no snapshot in the batch): no
		 *    fetched page can ever satisfy the connection test, so a walk would run
		 *    to its bound for nothing — five sequential reads, and five full file
		 *    passes on the owner side, where one page is the whole coverage. One
		 *    page, then out.
		 *
		 *    A LABEL walk is the exception, and it is why this bound is stated as
		 *    "one page unless the read has a goal": a round-end retry paints no
		 *    snapshot and the calls it is for are the OLDEST of the gap, so it pages
		 *    with `before_id` until every target is named, until a page holds the row
		 *    that opened the turn (`pageOpensTurn`), or until the row or request
		 *    bound stops it — see `walkTail`. Continuing in
		 *    `RECONCILE_TAIL_ENTRIES`-sized pages was also wrong for it: a further
		 *    page is sized `reconcileLimit(stillBehind)`, and never below the depth a
		 *    walk has already had to reach.
		 *
		 * `painted` is built from the FRAMES, not from the painted view: an
		 * updater runs lazily, so at this point the view may not hold what this
		 * very flush painted, and a connection test against a stale view would
		 * walk back on every open. `heldIds` is the opposite side of the same
		 * capture, for the opposite reason: it must NOT include this flush's own
		 * rows, so it is read from `paintedIds` before any commit this flush can
		 * run.
		 */
		/**
		 * Charge one read's worth of the per-call budget, and record that a read is IN
		 * FLIGHT for those calls.
		 *
		 * ONE PLACE, because both facts are inseparable: an id's budget is spent by a
		 * read that asked about it, and while that read is out the backstop may not fire
		 * (round 2, U4). The failure arm charges too - a read that FAILED is an attempt
		 * spent even though it named nothing, which is what keeps the refusing-owner
		 * route settling promptly instead of at the backstop (round 2, Q-2: 25.0 s
		 * against the 0.2 s it used to take).
		 */
		const chargeLabelAttempts = (ids: Iterable<string>) => {
			for (const id of ids)
				labelGapRef.current.attempts.set(
					id,
					(labelGapRef.current.attempts.get(id) ?? 0) + 1,
				);
		};

		/**
		 * Let the stand-in speak for the rows whose label can no longer be found.
		 *
		 * RELEASED WHEN THE LABEL IS SETTLED, NOT WHEN A READ ENDS. A read ending is
		 * not the same fact as "this call cannot be labelled": a walk that stopped
		 * short, a page that did not reach a call's assistant row, a failed attempt
		 * with a retry left, a snapshot whose seed will nominate the call again - in
		 * every one of those a read is still coming, and painting the stand-in in the
		 * meantime is the repaint the hold exists to prevent (review round 1, M1 and
		 * U1: the release was per-WALK, so a row could flip on the very next page of
		 * the same walk). So an id leaves the hold when - and only when - the view has
		 * the command (`argsByCall`, whatever read produced it) or the call's per-call
		 * read budget is spent with nothing found anywhere (`labelOwed`), which is the
		 * terminal case the stand-in is the truth for.
		 *
		 * NO IDS NAMED MEANS EVERY HELD ID: a RETRY walk's targets are already in
		 * `painted`, so its `pending` set is empty and a release keyed to that set
		 * could never settle the ids the retry just spent the budget of.
		 *
		 * THROUGH THE ONE WRITER, and the wall-clock backstop is deliberately NOT
		 * cancelled here: it follows the SET (see the effect below), so a partial
		 * release leaves the remaining rows their own deadline rather than a row held
		 * with no bound at all.
		 */
		const releaseLabelPending = (ids?: readonly string[]) => {
			commitView((state) => {
				const releasing = new Set<string>();
				for (const id of ids ?? state.labelPending) {
					if (!state.labelPending.has(id)) continue;
					if (
						labelOwed(
							labelGapRef.current,
							state.transcript.argsByCall,
							id,
							turnRunning(state),
						)
					)
						continue;
					releasing.add(id);
				}
				/*
				 * AND THE MARKED SET IS PRUNED BY THE SAME PREDICATE (round 4). A marked id is
				 * one whose hold a refusal ended while it was still owed, so "still owed" is the
				 * whole of its claim - and the moment that stops being true the stand-in is the
				 * truth, exactly as it is for a held id. Without this the mark would outlive its
				 * own justification and hold a row to the backstop after a round ending whose
				 * retry refused too: measured on the app's refused-plus-round-ending arm, whose
				 * stand-in belongs at ~4.1 s rather than at the 25 s bound.
				 *
				 * READ OFF THE WHOLE SET rather than the caller's `ids`: a walk names the calls it
				 * was for, and a marked id whose walk has ended is decided by the rule like any
				 * other. `argsByCall` is the `labelled` view here, so an id a page has since named
				 * is pruned in the same pass.
				 */
				let marked: Set<string> | null = null;
				for (const id of state.labelMarked) {
					if (
						labelOwed(
							labelGapRef.current,
							state.transcript.argsByCall,
							id,
							turnRunning(state),
						)
					)
						continue;
					marked = marked ?? new Set(state.labelMarked);
					marked.delete(id);
				}
				if (releasing.size === 0 && !marked) return state;
				const left = new Set(state.labelPending);
				for (const id of releasing) left.delete(id);
				return {
					...state,
					labelPending: left.size ? left : NO_LABELS_PENDING,
					labelMarked:
						marked && marked.size === 0
							? NO_LABELS_MARKED
							: (marked ?? state.labelMarked),
				};
			});
		};

		/**
		 * End the hold on the rows this REFUSAL released, and keep their mark standing.
		 *
		 * THE OTHER EXIT OF A WALK THAT NAMED NOTHING. `releaseLabelPending` answers "is
		 * this call owed to a read?" and, on the refusing route, answering it alone paints
		 * the call's OUTPUT - right for an owner that will refuse forever, wrong for one
		 * whose round ending is about to name the call, and the two are the same walk up
		 * to the instant the answer would arrive (see `labelMarked` on the view). So a
		 * refused stand-down does not decide between them: it ends the hold, because no
		 * read is in flight for these ids any more, and hands the ids to the mark, which
		 * states no fact and therefore cannot state the wrong one.
		 *
		 * ONLY THE IDS THE REFUSAL ACTUALLY RELEASED. An id absent from `labelPending`
		 * was not held by this walk - a page named it, or its hold had already ended - and
		 * marking it would put the cue on a row whose exit this refusal did not decide.
		 * Marking is also idempotent, so the retries of one refusal cost nothing here.
		 */
		const markRefusedTargets = (ids: Iterable<string>) => {
			commitView((state) => {
				let left: Set<string> | null = null;
				let marked: Set<string> | null = null;
				for (const id of ids) {
					if (!state.labelPending.has(id)) continue;
					left = left ?? new Set(state.labelPending);
					left.delete(id);
					marked = marked ?? new Set(state.labelMarked);
					marked.add(id);
				}
				if (!left || !marked) return state;
				return {
					...state,
					labelPending: left.size ? left : NO_LABELS_PENDING,
					labelMarked: marked,
				};
			});
		};

		const reconcileTail = async (
			generation: number,
			painted: ReadonlySet<string>,
			labels: LabelWalk = NO_LABEL_WALK,
			/**
			 * Which attempt this is on the NOTHING-PAINTED failure path below, 1-based so
			 * it names a delay in `STREAM_RETRY_DELAYS_MS` directly. A parameter rather
			 * than a local because the retry re-enters this function: a counter inside it
			 * would reset to the first delay on every re-entry, which is a backoff that
			 * never backs off. Callers that are not retrying (`flush`, `reopen`) omit it.
			 */
			historyAttempt = 1,
			/**
			 * Reports what each page of this walk COST, in rows, so the caller can
			 * charge a bounded budget to the read it caused. Only the settle path
			 * passes one: its read is speculative, and `LABEL_SETTLE_ROWS_MAX` is
			 * what bounds the waste where the per-call attempt budget cannot
			 * (review round 1, R2).
			 */
			onSpend?: (rows: number) => void,
			/**
			 * The rows THIS PANE HELD before the batch, as record ids — the seam
			 * BEHIND the fetched pages that the walk must also reach before it may
			 * stand down (#876; `walkTail` carries both connections). Defaults to
			 * `painted`: a caller with no separate held set (the retry paths, whose
			 * connection target IS what is already on screen) means the two sets are
			 * one.
			 */
			held: ReadonlySet<string> = painted,
			/**
			 * The oldest row the batch's own snapshot page DELIVERED, or `null` when
			 * the batch carried none (every retry path, and any flush without a
			 * snapshot). It is the only edge a seal may cut at when the walk itself
			 * fetched nothing: a row the journal handed over, as opposed to a row that
			 * merely happens to be new on the pane (#876, review round 3).
			 */
			batchEdge: { id: string; ts: number } | null = null,
		) => {
			/*
			 * THIS WALK IS A READ THE PANE CAN PAINT (remote-load-hydration, U1): the
			 * count is raised here and lowered in the finally below, so the slot's
			 * `historyReadPending` is true for exactly the span a `/history` read is
			 * out - including between this walk's own pages. The view write is
			 * skipped for a superseded generation; the COUNT is kept balanced either
			 * way, because a leaked count would block every later press.
			 */
			historyReadsRef.current += 1;
			if (generationRef.current === generation) {
				commitView((current) =>
					current.historyReadPending
						? current
						: { ...current, historyReadPending: true },
				);
			}
			/*
			 * `labelPending` is released on EVERY exit of this walk except the one that
			 * hands the same walk to a timer (the nothing-painted backoff below), which
			 * carries the ids with it. A walk that ends by label, by bound, by failure
			 * or by a newer generation all mean the same thing to a row: its first read
			 * is over, so the stand-in may speak again.
			 */
			/*
			 * THIS WALK IS A PENDING READ FOR ITS TARGETS, which is what term (a) of the
			 * rule reads: while the walk is out - including between its own pages - the rows
			 * it is for are held. Dropped when the walk ends, or kept when a retry timer
			 * takes it over, because that read is still pending.
			 *
			 * `inFlightOwned` records what this MOUNT put there so a tear-down can drop
			 * its own and nothing else (see its declaration).
			 */
			for (const id of labels.targets) {
				labelGapRef.current.inFlight.add(id);
				inFlightOwned.current.add(id);
			}
			let handedOff = false;
			try {
				handedOff = await walkTail(
					generation,
					painted,
					held,
					batchEdge,
					labels,
					historyAttempt,
					onSpend,
				);
			} finally {
				/*
				 * The walk is over unless a timer owns it: drop the pending read and let the
				 * release answer the rule.
				 *
				 * WHAT THAT ANSWER IS DEPENDS ON THE TURN, and the refusing-owner route changed
				 * with `turnRunning` (agent review round 3, M3). Term (a) is now false - the read
				 * the walk stopped making is not pending - but the call is still owed while the
				 * owner's turn runs, because a durable round ending can still name it. Measured
				 * on the built app: 26 rows mark from 2 196 ms and the stand-in lands at
				 * 25 197 ms (the backstop's first fire, nothing in flight), where round 3's head
				 * settled at 413 ms because term (b) was inert and a walk that fell short
				 * released everything it could not name - which is exactly the release that the
				 * round's own `turn_end` then repainted, 68 stand-in -> command flips. The turn
				 * ending is what releases them promptly, and the round's own cases assert both
				 * directions. No ids are named to the release, because a RETRY walk is already
				 * painted (its own `pending` is empty) and the RULE, not the walk, decides what
				 * is owed.
				 *
				 * DROPPED BY TARGET, NOT `clear()` (agent review round 3, M2's second half):
				 * the settle path's read and this walk's retry can both be out for one
				 * conversation, and a wholesale clear let whichever finished first wipe the
				 * other's pending ids - a release on a read that was still running.
				 */
				/*
				 * The read is over - or a timer owns it, and the backoff gap until it
				 * re-enters is not painted (the row's own words are true across that
				 * gap, and the alternative is a count nobody can lower if the timer is
				 * torn down before it fires). Only the LAST walk out clears the paint;
				 * the write is unconditional because false on a view that is already
				 * false is free, and a live walk's count keeps it true.
				 */
				historyReadsRef.current = Math.max(0, historyReadsRef.current - 1);
				if (historyReadsRef.current === 0) {
					commitView((current) =>
						current.historyReadPending
							? { ...current, historyReadPending: false }
							: current,
					);
				}
				if (!handedOff) {
					for (const id of labels.targets)
						labelGapRef.current.inFlight.delete(id);
					/*
					 * AND WHEN THE ROUTE REFUSED, THE HOLD BECOMES THE MARK (round 4). The read this
					 * walk was for is over and it named nothing; what the row shows next depends on
					 * whether that was a refusal or a walk that stopped short, and only the first of
					 * the two may not state the call's output. Read off the flag the stand-down set,
					 * which is cleared by any page, so a walk that got an answer anywhere in it takes
					 * the ordinary release below.
					 *
					 * BEFORE the release, deliberately: the hand-off removes these ids from
					 * `labelPending`, so the release that follows cannot paint the very stand-in the
					 * mark exists to keep off the row.
					 */
					if (labelGapRef.current.refused) markRefusedTargets(labels.targets);
					releaseLabelPending();
				}
			}
		};

		/**
		 * The body of `reconcileTail`; answers whether a timer now owns the walk.
		 *
		 * THE ONE EXIT THAT SEALS (#876). `walkPages` has a dozen ways out, and the
		 * hole this exists for is the same however the walk left: it fetched the
		 * tail, never reached the rows the pane held, and stopped (a bound, the
		 * failure stand-down, the label floor, a page budget). Each of those used
		 * to leave the held block painted beside the fetched tail with the gap
		 * between them unmarked, and the cursor still pointing BEFORE the held
		 * block, so no later "load earlier" could ever page into the gap. Doing the
		 * seal here, after `walkPages` returns, covers every exit with one
		 * statement instead of one per `return`, and a new exit added to the walk
		 * later is covered without anyone remembering to.
		 *
		 * WHICH EXITS DO NOT SEAL, and why each is not a hole:
		 *  - a timer owns the walk (`handedOff`): the walk is not over, and the
		 *    re-entry carries the same held set;
		 *  - the generation moved: this pane no longer shows these rows;
		 *  - the view was cleared under the walk (`viewEpoch`): sealing would set
		 *    `hasMore` over a transcript the reader just emptied, offering the
		 *    cleared history back;
		 *  - the held seam was reached (`reachedHeld`), or nothing was held: the
		 *    fetched chain is contiguous with every row the pane has;
		 *  - the journal ran out (`!hasMore`): there is nothing behind the fetched
		 *    chain to be missing, so a held row older than it is not a hole but a
		 *    row the journal no longer has, which this change leaves to the
		 *    behaviour it always had;
		 *  - no page was fetched: there is no fetched edge to seal AT.
		 */
		const walkTail = async (
			generation: number,
			painted: ReadonlySet<string>,
			held: ReadonlySet<string>,
			batchEdge: { id: string; ts: number } | null,
			labels: LabelWalk,
			historyAttempt: number,
			onSpend?: (rows: number) => void,
		): Promise<boolean> => {
			const seam: WalkSeam = {
				keys: new Set(),
				oldest: null,
				hasMore: false,
				joined: false,
				reachedHeld: held.size === 0,
			};
			const epochAtStart = viewRef.current.transcript.viewEpoch;
			const handedOff = await walkPages(
				generation,
				painted,
				held,
				batchEdge,
				labels,
				historyAttempt,
				seam,
				onSpend,
			);
			if (
				handedOff ||
				generationRef.current !== generation ||
				seam.reachedHeld ||
				viewRef.current.transcript.viewEpoch !== epochAtStart
			)
				return handedOff;
			/*
			 * A BATCH THAT ALREADY TOUCHES WHAT THE PANE HELD IS ONE BLOCK, so a chain
			 * joined to it is joined to the held rows too, whatever else ended the walk.
			 * `painted === held` is a caller with no separate batch (the retry paths),
			 * where the intersection is the whole set and proves nothing.
			 */
			const batchTouchesHeld =
				painted !== held && [...painted].some((id) => held.has(id));
			if (batchTouchesHeld && seam.joined) return handedOff;
			let edge: { id: string; ts: number } | null;
			if (seam.oldest) {
				// A journal that ends at the fetched chain has nothing behind it to be
				// missing: `hasMore` would be a claim the journal contradicts.
				if (!seam.hasMore) return handedOff;
				edge = {
					id: seam.oldest.id,
					ts: Math.round((seam.oldest.ts ?? 0) * 1000),
				};
			} else {
				/*
				 * No page of the walk arrived (an empty answer, or the read failed). A
				 * seal needs an edge the journal DELIVERED and a held block provably
				 * disjoint from it, and the only candidate left is the batch's own
				 * snapshot page: its oldest entry (`batchEdge`), sealed only when that
				 * page does not touch the held rows (`batchTouchesHeld`) and says the
				 * journal goes on behind it. No snapshot page (`batchEdge` null) means
				 * there is no proof of a disjoint block at all, so nothing is sealed.
				 *
				 * WHY NOT "THE OLDEST DURABLE ROW THE PANE DID NOT HOLD BEFORE". That was
				 * the edge in rounds 1-2 and it was wrong three ways: a tool that settled
				 * mid-flush (CI: 93 rows -> 2), a row born live in a flush that carried no
				 * page (review round 3, R3-1: any tool that starts and ends in one flush),
				 * and a pre-flush index that a walk's own commits never refreshed (QA
				 * round 3, Q3-1). Each is a row that is NEW on the pane without being a
				 * row the journal delivered, and its `ts` is the viewer's clock, newer
				 * than the whole held block. Keying the edge to the page removes the
				 * class rather than one member of it.
				 */
				if (batchTouchesHeld || !batchEdge) return handedOff;
				edge = batchEdge;
			}
			if (!edge) return handedOff;
			const sealed = commitView((current) => {
				const transcript = sealDisjointBlock(
					current.transcript,
					edge,
					seam.keys,
				);
				return transcript === current.transcript
					? current
					: { ...current, transcript };
			});
			// The ref is "the index the last commit left behind": the next flush asks
			// it what the pane holds, and a dropped row it still listed would make a
			// page "connect" to a row that is no longer on screen.
			paintedIds.current = sealed.transcript.index;
			return handedOff;
		};

		/** The walk itself; see `walkTail` for what happens when it ends. */
		const walkPages = async (
			generation: number,
			painted: ReadonlySet<string>,
			held: ReadonlySet<string>,
			batchEdge: { id: string; ts: number } | null,
			labels: LabelWalk,
			historyAttempt: number,
			seam: WalkSeam,
			onSpend?: (rows: number) => void,
		): Promise<boolean> => {
			/*
			 * THE VIEW THIS WALK WAS STARTED FOR (#876, QA round 3, Q3-2). A `/clear`
			 * bumps `viewEpoch` and is view-only, so nothing else tells a walk that the
			 * rows it is about to merge are the rows the reader just removed. The walk
			 * is up to 500 rows / 6 requests wide now, so the window in which a page
			 * could repaint a cleared history is no longer one request. Checked after
			 * every await that precedes a commit (the failure arm and the page merge),
			 * and by `walkTail` before it seals. A superseded walk commits nothing.
			 */
			const epochAtStart = viewRef.current.transcript.viewEpoch;
			const cleared = () =>
				viewRef.current.transcript.viewEpoch !== epochAtStart;
			const fetchedIds = new Set<string>();
			let beforeId: string | undefined;
			let rows = 0;
			let requests = 0;
			/** Whether some page has overlapped the painted rows yet; latched. */
			let joined = false;
			/**
			 * Whether some fetched page has reached the rows THIS PANE HELD before the
			 * batch — the walk's second seam (#876). `joined` alone asked "does the
			 * fetch meet what this BATCH painted", which the first tail fetch
			 * satisfies by construction whenever the batch carried a snapshot page;
			 * the seam behind that page — the cached block a reopen came back with —
			 * needs its own reach, or the walk stands down over a hole. Nothing held
			 * (a cold open) is satisfied by definition: no seam exists behind the page
			 * for a walk to close.
			 */
			let reachedHeld = held.size === 0;
			/** Whether a fetched page has reached the row this turn opened with. */
			let reachedTurnStart = false;
			/*
			 * WHETHER THE PANE WAS COLD WHEN THIS WALK STARTED, captured here rather
			 * than read from `state` at commit time (remote-load-hydration). The first
			 * request goes out a synchronous instant after this line, so this is the
			 * cold value the ANSWER was given under - and the answer's meaning depends
			 * on it: a peer's empty page answered while cold proves nothing (see the
			 * proof rule in the page commit below), while one answered after a warm
			 * may. Reading `state.cold` at commit instead would let a warm that landed
			 * WHILE the read was in flight re-classify the stale cold answer as
			 * authoritative - the exact over-claim this capture exists to keep out.
			 */
			const coldAtDispatch = viewRef.current.cold;
			/*
			 * THE LABEL GOAL, the half the walk used to lack. It stopped as soon as a
			 * page CONNECTED to a painted row, but the label gap needs a page that
			 * reaches back to the OLDEST missing call's assistant row, which on a turn
			 * of more than a page of calls is many rows past the connection. So the walk
			 * now also keeps paging until no target is still behind what it has read
			 * (`labelTargetsBehind`), and connecting is one required condition rather
			 * than a sufficient one (`reconcileWalkDone`). Measured on the reported
			 * session (`<session>`, 134 calls in one turn): the old rule left 23 calls
			 * labelled only by their output after the first read, and the round-end
			 * retry labelled none of them.
			 */
			const found = new Set(labels.found);
			const behind = () =>
				labelTargetsBehind(labels.order, labels.targets, found);
			/**
			 * The target calls still BEHIND what has been read, by the walk's own rule
			 * (`labelTargetsBehindIds`): evicted-and-unfound targets, then targets older
			 * than the oldest call a page has named. Round 4's R11 is why the floor is
			 * given this set rather than every unfound target — a call of the round still
			 * running is newer than everything found and no page can label it yet, so
			 * letting it refuse the floor bought pages that could not end the walk.
			 */
			const behindIds = (): string[] =>
				labelTargetsBehindIds(labels.order, labels.targets, found);
			/**
			 * The orphans still unfound, with the instant their own result row was
			 * journaled: the floor's second input (R6a). An orphan whose instant the
			 * page did not state contributes nothing, which leaves the floor to the
			 * seed's targets.
			 */
			const behindOrphanInstants = (): Map<string, number> => {
				const behind = new Map<string, number>();
				for (const id of orphans) {
					if (found.has(id)) continue;
					const at = orphanStarts.get(id);
					if (at !== undefined) behind.set(id, at);
				}
				return behind;
			};
			/*
			 * Calls a page showed the RESULT of without ever showing the row that
			 * named them, and which no other page has named since (`pageOrphanResults`,
			 * round 1's QA Q4). They are targets too: their arguments are one row
			 * older than the page that produced them, which is a page this walk can
			 * reach. `orphans` is what is still unfound, `known` is every call id the
			 * walk can account for, and `orphanGrace` bounds the cost of one that has
			 * no start to find anywhere — one page of courtesy, then the walk stops
			 * treating it as behind rather than paging to the bound for it. Without
			 * the grace a repeatedly-pruned transcript would buy a page per open for
			 * rows that cannot be labelled at all.
			 */
			const known = new Set(labels.every);
			for (const id of found) known.add(id);
			const orphans = new Set<string>();
			/** Call id -> the epoch ms its own result row was journaled (R6a). */
			const orphanStarts = new Map<string, number>();
			let orphanGrace = 1;
			// The first read is sized to FINISH the job in one request where it can
			// (`reconcileLimit`), and never smaller than the deepest first read this
			// session has already needed: the calls a retry is for are the OLDEST
			// ones, so a retry that reads less than the read that missed them cannot
			// reach them either.
			const labelling = labels.targets.size > 0;
			let limit = Math.max(
				reconcileLimit(behind()),
				labelling ? labelGapRef.current.depth : 0,
			);
			/**
			 * The painted path's own budget: one immediate retry, then a quiet stand-down
			 * (see the failure arm). Counted here rather than passed because this path
			 * never re-enters the function.
			 */
			let failures = 0;
			while (
				rows < RECONCILE_WALK_MAX_ROWS &&
				requests < RECONCILE_WALK_MAX_REQUESTS
			) {
				requests += 1;
				let page: DesktopHistoryPage;
				try {
					page = await desktopResult<DesktopHistoryPage>({
						op: "sessions.history",
						sessionId,
						...(beforeId ? { beforeId } : {}),
						// Never past the walk's own bound: the route clamps at 500 anyway,
						// and asking for more than the bound leaves is a page the loop
						// would refuse to continue from.
						limit: Math.min(limit, RECONCILE_WALK_MAX_ROWS - rows),
					});
				} catch {
					// A cleared view has nothing left to read for: without this the
					// nothing-painted branch below would take the emptied pane for a pane
					// that never loaded, and retry the read that repaints the history.
					if (cleared()) return false;
					/*
					 * The failure arm, where this branch's hardening meets #152's walk, and the
					 * two cases here are not the same case:
					 *
					 *  - ROWS ARE PAINTED, the common one. A failed read costs nothing: the
					 *    rows on screen are correct and the stream keeps delivering, so one
					 *    immediate retry and then a quiet stand-down, exactly as #152 reasoned
					 *    it - blanking the conversation would be worse than the rows that are
					 *    missing.
					 *  - NOTHING IS PAINTED. This read is the ONLY thing that can tell an empty
					 *    conversation from one whose rows have not arrived, so a failure here
					 *    must not be swallowed: it is retried on the stream's own backoff
					 *    schedule and then PUBLISHED, because a view that claims "empty" over
					 *    a conversation holding hundreds of rows is the defect this branch is
					 *    about. It is also the arm that puts `Retry` on screen while a stream
					 *    retry is still pending. `hydrated` stays false throughout, so the
					 *    composer cannot offer the greeting while this is being tried.
					 */
					if (viewRef.current.transcript.records.length > 0) {
						if (failures++ > 0) {
							/*
							 * ROUND 4: the route refused for the whole walk. Recorded HERE, where the
							 * conclusion is actually drawn, rather than inferred from "the walk found
							 * nothing" at the exit - a walk that stops short has found nothing too, and
							 * its rows are owed to the next page, not to a refusal. Cleared by any page
							 * that arrives (`walkTail`'s own page path), which is the event that makes it
							 * untrue.
							 */
							labelGapRef.current.refused = true;
							return false;
						}
						continue;
					}
					if (historyAttempt < HISTORY_RECONCILE_ATTEMPTS) {
						reconcileTimer = window.setTimeout(() => {
							reconcileTimer = 0;
							// The retry is for the view it was scheduled against: a `/clear` in
							// the backoff gap must not be answered with the history it removed.
							if (generationRef.current !== generation || cleared()) {
								releaseLabelPending();
								return;
							}
							void reconcileTail(
								generation,
								painted,
								labels,
								historyAttempt + 1,
								onSpend,
								held,
								batchEdge,
							);
						}, streamRetryDelayMs(historyAttempt));
						return true;
					}
					// Nothing is painted and nothing could be read: this conversation is
					// unreachable, and saying so with a way back is the only honest state
					// left. `hydrated` stays false, so the composer may not claim the
					// conversation is empty either.
					//
					// AND IT TAKES THE HELD READINGS WITH IT (agent review round 1,
					// MINOR 3). This is a FOURTH terminal `unavailable` writer, and the
					// hold's contract says every terminal state drops it: a reading kept
					// past the point where the app has given up on the conversation is the
					// one thing R2 forbids. It was the state MAJOR 1 turned into a mask,
					// because `frontend` is deliberately left painted here and the mirror
					// had therefore refilled the hold from it.
					//
					// `commitView` rather than `setView` is MAIN's shape, kept: the fold
					// that brought #495 renamed this arm's writer, and the held-readings
					// change is re-applied on top of it rather than the other way round.
					commitView((state) => ({
						...state,
						status: "unavailable",
						failure: HISTORY_UNREADABLE,
						heldFrontend: null,
					}));
					return false;
				} finally {
					/*
					 * No read is in flight for this walk's targets any more, which is the
					 * fact the paint cache needs (see `inFlight`) and the release below
					 * does not: the release asks whether the LABEL is settled, not whether
					 * a read is running.
					 */
					/*
					 * A read has ENDED, which is not the same fact as "this call is settled":
					 * `releaseLabelPending` releases the ids the view can now answer for (the
					 * call is labelled, or its read budget is spent with nothing found) and
					 * leaves the rest held, because a read for them is still coming - the next
					 * page of this walk, a retry at a durable round ending, or the next
					 * snapshot's seed. `finally` so it covers every arm of the catch,
					 * including the ones that return, and so the generation-discard path below
					 * is covered by the same statement that covers the answered one (review
					 * round 1, n2: the earlier wording described only the answered arm).
					 */
					/*
					 * Every held id, not the walk's own `pending` set: a RETRY walk's
					 * targets are already in `painted`, so its `pending` is empty and a
					 * release keyed to it could never settle the ids the retry just spent
					 * the budget of. Re-evaluating what is held is also what makes this
					 * call idempotent and safe from every arm.
					 */
					releaseLabelPending();
				}
				if (generationRef.current !== generation || cleared()) return false;
				/*
				 * A PAGE ARRIVED, so the refusal is over: the route that refused is answering
				 * again, and the rows it was refusing for are owed to a read once more. This
				 * is the ONLY clear, and it is the event that makes the flag untrue - not a
				 * clock and not a mount, so a switch back to a conversation whose route was
				 * refusing still knows that it was.
				 */
				labelGapRef.current.refused = false;
				const oldest = page.entries[0];
				rows += page.entries.length;
				onSpend?.(page.entries.length);
				// Merged even when it is the page we already have: durable rows win
				// by id, so a repeat is free and a partial one is completed.
				commitView((state) => {
					const transcript = applyHistoryPage(state.transcript, page);
					/*
					 * THE IDS **THIS COMMIT** LABELLED ARE RELEASED IN THE SAME COMMIT, and
					 * this is the half of the hold a separate update could not get right.
					 *
					 * WHY HERE, AND WHY ONLY THESE. The page that carries a call's arguments
					 * is applied here, one statement after the fetch that answered - so a
					 * release written on the fetch's side of the await is a separate update,
					 * and wherever a renderer commits those two apart the reader sees the
					 * reported jitter exactly: the row drops its empty column for the output
					 * stand-in, then paints its command on the next frame. Folded in, the
					 * commit that gives a row its arguments is the commit that lets it go.
					 *
					 * AND THE SET IS THIS PAGE'S, NOT THE WALK'S (review round 1, M1). The
					 * first version deleted `labels.pending` - every target the walk holds -
					 * so a target this page did not reach was let go and repainted when the
					 * NEXT page of the same walk named it: measured at 24 stand-in-to-command
					 * repaints on the suite's own fall-short route, 68 on the failure arm.
					 * The ids named by this page's own rows are the only ones this commit can
					 * answer for; the rest stay held, and the walk's own exit or the backstop
					 * releases them once their read budget is spent.
					 */
					const named = pageLabels(page.entries, known);
					const left = new Set(state.labelPending);
					for (const id of named) left.delete(id);
					return {
						...state,
						/*
						 * A PAGE PROVES HYDRATION WHEN IT COULD SEE THE CONVERSATION
						 * (remote-load-hydration). A resolved page normally is the proof the
						 * snapshot could not give - applied-or-empty alike, because the backend
						 * answered with this session's durable tail. The exception is a read
						 * answered by a COLD facade: there is no runtime holding this
						 * conversation, so the empty page it serves is "nothing to paint yet"
						 * (the wire's own word - an empty page beside `cold: true` is the
						 * renderer's signal to reconcile through `/history`, which is the read
						 * that got here), and it is byte-identical to a genuinely empty
						 * conversation's page (`entries: []`, `has_more: false`,
						 * `cursor_missing: false`). Marking hydration proven from it let the
						 * pane claim an empty conversation - and, once rows arrived, the end of
						 * history - over a conversation nobody had read; a stored remote
						 * session's first open is where that was measured.
						 *
						 * THE RULE TURNS ON THE READ'S COLD STATE, NOT ON WHERE THE ROWS LIVE,
						 * because the read itself is the only place the two can be told apart -
						 * and even there only by whether the facade had an owner. This device's
						 * own journal read answers the same empty page for a missing file as
						 * for an unwritten one, and the daemon's local and peer readers are
						 * byte-identical on the wire; "is this conversation a peer's" is a fact
						 * of the catalogue, which lands seconds later (a federated read) and
						 * cannot classify the answer that already arrived. So EVERY empty page
						 * read while cold proves nothing, and the warm transition re-arms the
						 * read instead (the `warmedUnproven` trigger in `flush`); once warm,
						 * emptiness is the conversation's own statement and this commits true.
						 * The cost is stated: a LOCAL empty session holds the placeholder
						 * until its runtime warms, which in a visible window is the lease's own
						 * second.
						 *
						 * The terms, each one necessary: a NON-EMPTY page is rows, which prove
						 * themselves wherever they live; `!coldAtDispatch` is "the read went
						 * out to a session that had an owner" - and it is captured when the
						 * walk STARTED (see `walkTail`), so a warm that lands while the read
						 * is in flight cannot re-classify the stale cold answer.
						 */
						hydrated:
							state.hydrated || page.entries.length > 0 || !coldAtDispatch,
						labelPending: left.size ? left : NO_LABELS_PENDING,
						/*
						 * A MARKED ID THIS PAGE NAMED STOPS BEING MARKED (round 4). The mark is a
						 * row's WHOLE object column while it stands, so an id left in this set after a
						 * read named it would hide the command that just arrived - the row would keep
						 * the cue and never show the answer it was waiting for.
						 */
						labelMarked: withoutLabels(state.labelMarked, named),
						transcript,
					};
				});
				/*
				 * Nothing to latch: the release is per id and idempotent ("the ids the view
				 * can answer for, if they are still held"), so the `finally` owns the whole
				 * question and a second call from here would only be a second no-op.
				 */
				/*
				 * §F2's LAST BULLET, ON THE READ THE CONTRACT NAMES (UX round 1's U5b): a
				 * held send is resolved by the server's OWN answer, and on a reconnect that
				 * answer is this one - the authoritative tail, fetched once per reconcile
				 * (the snapshot's own page is the other, and both are offered; whichever
				 * arrives first settles the claim). Only the TAIL page can conclude
				 * anything (`beforeId === undefined` is the first, tail-most page of the
				 * walk) and only a page that is not `cursor_missing` counts as complete: a
				 * walked-back window is not the tail, so its silence about a recent
				 * message proves nothing.
				 *
				 * AND THE PAGE TRAVELS WHOLE, not as a bare id list: `complete` is the
				 * page's CONTINUITY, and the store draws the `undelivered` verdict only
				 * when the page also REACHES back past the claim (issue #847). Handing over
				 * the ids alone was what let a shallow-but-complete tail page answer "did
				 * not land" for a message older than its window.
				 */
				if (sessionId && beforeId === undefined) {
					useCanonicalSessionsStore
						.getState()
						.resolveHeldFromServer(
							sessionId,
							page.entries,
							!page.cursor_missing,
						);
				}
				/*
				 * How many target calls were still behind what had been read when this
				 * page arrived; a page that names one LOWERS it, which is the only
				 * thing that makes this read worth remembering (see the depth floor
				 * below). Counting `found` instead was wrong: `found` also holds the
				 * calls the snapshot's own page already labelled, so every page that
				 * merely repeated them grew it and every walk looked like one that had
				 * earned its depth (round 1, R1 - it floored a session's retries at 217
				 * rows for a walk that had labelled nothing).
				 */
				const behindBefore = behind();
				for (const id of pageLabels(page.entries, known)) {
					found.add(id);
					known.add(id);
				}
				/*
				 * The turn's opening row, once a page has reached it, is the end of the
				 * road (`pageOpensTurn`): every call the seed names was journaled at or
				 * after it, so nothing further back can label anything. Latched, and
				 * tested below with the other exits.
				 */
				if (pageOpensTurn(page.entries)) reachedTurnStart = true;
				if (labelling) {
					const pageOrphans = pageOrphanResults(page.entries, known);
					for (const id of pageOrphans) {
						orphans.add(id);
						known.add(id);
					}
					/*
					 * The orphan's assistant row is the row just above its result, so the
					 * result's own `ts` is the instant that stands in for its start — see
					 * `pageOrphanResultInstants` for why that is the floor that lets the
					 * walk take the ONE extra page finding it (round 3, R6a).
					 */
					for (const [id, at] of pageOrphanResultInstants(
						page.entries,
						pageOrphans,
					))
						orphanStarts.set(id, at);
					for (const id of [...orphans]) if (found.has(id)) orphans.delete(id);
					// One page of courtesy for a result whose start is a row or two
					// older; past it the call has no start to find here.
					if (orphans.size > 0 && orphanGrace-- <= 0) orphans.clear();
				}
				/*
				 * Nothing on screen means nothing to connect TO, so the connection half
				 * is satisfied by definition and only the label goal can keep the walk
				 * going — which is exactly the round-end retry's case: it paints no
				 * snapshot, and it used to stop after one page by this very test while
				 * the calls it was for sat further back.
				 */
				// Latched: once a page connected, the pages behind it are older still
				// and cannot un-connect the walk.
				joined =
					joined ||
					painted.size === 0 ||
					page.entries.some(
						(entry) => painted.has(entry.id) || fetchedIds.has(entry.id),
					);
				/*
				 * The held seam, latched the same way and deliberately NOT through
				 * `fetchedIds`: that arm says the chain is contiguous, which `beforeId`
				 * already guarantees — only a page carrying a HELD row proves the chain
				 * has reached what this pane had. `entryRecordKey` is what makes the
				 * comparison exact for tool rows.
				 */
				reachedHeld =
					reachedHeld ||
					page.entries.some((entry) => held.has(entryRecordKey(entry)));
				for (const entry of page.entries) fetchedIds.add(entry.id);
				// What `walkTail` seals against if the walk ends short: the fetched
				// chain's oldest edge and whether the journal goes on behind it. Pages
				// are contiguous (`beforeId` is exclusive), so the last non-empty
				// page's first entry IS the chain's oldest.
				for (const entry of page.entries) seam.keys.add(entryRecordKey(entry));
				if (oldest) seam.oldest = oldest;
				seam.hasMore = page.has_more;
				seam.joined = joined;
				seam.reachedHeld = reachedHeld;
				// The orphan results count as missing until their own rows are read.
				const stillBehind = behind() + orphans.size;
				/*
				 * The floor for the next label read, and only when this page EARNED it:
				 * a page that read `rows` rows and labelled nothing has said nothing
				 * about where a later read should start, and recording it is how one
				 * call with no rows anywhere turned every later retry in the session
				 * into a bound-sized read (round 1, R1).
				 */
				if (labelling && behind() < behindBefore)
					labelGapRef.current.depth = Math.min(
						RECONCILE_TAIL_MAX_ENTRIES,
						Math.max(labelGapRef.current.depth, rows),
					);
				// No `beforeId`-progress clause belongs here. The reader's `before_id`
				// is EXCLUSIVE (it breaks before appending the boundary row), so a page
				// can never hand back its own boundary row as its oldest; and a
				// transcript replaced under the walk is caught by the `fetchedIds`
				// overlap test above, which sees the tail it hands back.
				/*
				 * The turn's opening row is a floor for a LABEL walk only. A walk that
				 * is merely connecting (an ordinary reconcile with no targets) is
				 * merging durable rows on the way down to the row the snapshot painted;
				 * it may legitimately have to pass a turn's opening row to get there, and
				 * stopping it early would leave older rows unfetched on screen. The
				 * argument for the floor is about the SEED's calls, which is the label
				 * walk's subject and nobody else's.
				 */
				/*
				 * The two floors, and why both are here rather than one of them. The
				 * turn boundary answers "no call of this turn can be older than this
				 * row" and needs a turn row to exist behind the page; a journal that is
				 * ONE long turn has none, which is the shape round 2's Q1 measured (4
				 * requests and 409 rows where `origin/main` reads one page). The start
				 * instants answer the same question per CALL — this call's own assistant
				 * row is written at or AFTER this call's start, never before it
				 * (`seedCallStarts` states the measurement and why that direction is the
				 * safe one) — which holds on any journal shape. Whichever is reached
				 * first ends the walk,
				 * and `labelling` gates both: a connecting walk may legitimately have to
				 * pass either to reach the row the snapshot painted.
				 */
				/*
				 * THE FLOORS STOP LABELLING, NOT THE WALK (#876). `pagePassedOldestStart`
				 * and `reachedTurnStart` answer "no further page can NAME a target call" —
				 * facts about the label goal. They used to return outright, which was also
				 * a quiet exit for the CONNECTION duties the same walk carries: a label
				 * walk that hit its floor before reaching the pane's held rows stood down
				 * over the seam, and on a reopen that seam is the reported missing hours.
				 * A floor therefore zeroes the label debt and the walk's own done test
				 * decides — it keeps its remaining purpose (a connection still unmade)
				 * until that test or a bound ends it.
				 */
				let labelFloor = false;
				if (labelling) {
					const behindTargets = behindIds();
					const floored = pagePassedOldestStart(
						page.entries,
						behindTargets,
						labels.starts,
						behindOrphanInstants(),
						// Every startless call may refuse the floor but one still waiting at a
						// gate: it cannot have a durable row yet, so no page can label it and
						// the floor has nothing to protect (round 6, R16). These are the
						// EXEMPT ones, which is why the filter keeps the waiting set.
						new Set(
							behindTargets.filter((callId) => labels.waiting.has(callId)),
						),
					);
					labelFloor = floored || reachedTurnStart;
				}
				if (
					reconcileWalkDone(joined && reachedHeld, labelFloor ? 0 : stillBehind)
				)
					return false;
				if (!oldest || !page.has_more) return false;
				beforeId = oldest.id;
				// A further page is sized for what is still missing behind it; a walk
				// that only needs to connect keeps the ordinary page.
				limit =
					stillBehind > 0
						? reconcileLimit(stillBehind)
						: RECONCILE_TAIL_ENTRIES;
			}
			return false;
		};

		const flush = () => {
			if (raf) cancelAnimationFrame(raf);
			if (fallback) clearTimeout(fallback);
			raf = 0;
			fallback = 0;
			if (generationRef.current !== generation) return;
			const frames = pending.current;
			pending.current = [];
			if (frames.length === 0) return;
			/*
			 * WHAT THIS PANE HELD WHEN THE BATCH ARRIVED (#876), as record ids — the
			 * seam behind the fetched pages that a reconcile must reach before it may
			 * stand down. Captured BEFORE any commit this flush can run, and that is
			 * the point rather than a detail: by the time the walk is asked, this
			 * batch's own rows are in hand, and a held set that included them would
			 * satisfy the connection by construction — which is how a reopen's walk
			 * stood down over a hole it was already holding one end of.
			 *
			 * ONLY ROWS THE JOURNAL OWNS COUNT AS HELD (#876, review round 1). The
			 * index also lists this app's own unconfirmed user echo, and an echo is
			 * keyed by the admission request UUID — which is ALSO the id the owner
			 * gives the durable row. A send that landed while a stale cached paint was
			 * on screen therefore puts that id in the index, and when the owner has
			 * already journaled it as the newest row the new tail page contains it:
			 * "the page reaches a held row" would then be true of the ECHO alone, and
			 * the gate and the walk would stand down over the very hole this exists
			 * to close, with no read. An echo is evidence of a send, not of a journal
			 * row the pane holds, so it (and every other row `sealDisjointBlock`
			 * refuses to drop: a streaming answer, an unsettled call, the app's own
			 * notices) is left out, by the SAME rule — one definition of "a row paging
			 * can bring back" for what a seam is owed and what a seal may drop. A pane
			 * holding only such rows has no seam to close, so it defers as a cold pane
			 * does (`heldIds.size === 0`). Keyed by `record.id`, which for a tool row is
			 * already `tool:<call_id>`, the key `entryRecordKey` gives its page entry.
			 */
			const heldIds = new Set<string>();
			for (const record of viewRef.current.transcript.records)
				if (isDurableOwnerRow(record)) heldIds.add(record.id);
			/*
			 * READ FROM THE LIVE VIEW, NOT FROM `paintedIds` (QA round 3, Q3-1).
			 * `paintedIds` is "the index the last flush left behind" and is refreshed
			 * only at a flush, a seal and a reset, so rows a walk's own pages, a
			 * `loadOlder` or an echo committed in between are on the pane and absent
			 * from it. This is what the pane holds at the instant before this flush's
			 * commits, which `viewRef` is. (The gate's older-backend arm still reads
			 * `paintedIds` for its own reason, below.)
			 *
			 * `heldIds` IS A CONNECTION PROOF AND NOTHING ELSE. The gate,
			 * `reachedHeld`, `batchTouchesHeld` and the empty-set defer ask one
			 * question - "does a fetched page overlap a row the JOURNAL owns that this
			 * pane holds" - which is why the rows that are not journal rows are left
			 * out. It is deliberately NOT the set a seal tests an edge against: a seal
			 * cuts only at a row the journal delivered (`batchEdge`, below), so it has
			 * no use for a set of what the pane held.
			 */
			let batchEdge: { id: string; ts: number } | null = null;
			for (const frame of frames) {
				if (frame.type !== "snapshot") continue;
				const page = frame.payload.history;
				const first = page.entries[0];
				// A page that is the whole journal has nothing behind it to be missing.
				if (!first || !page.has_more) continue;
				const ts = Math.round((first.ts ?? 0) * 1000);
				if (ts > 0 && (!batchEdge || ts < batchEdge.ts))
					batchEdge = { id: first.id, ts };
			}
			/*
			 * The off-record chunks first, and outside the state update: see
			 * `applyAsideDeltas` for why they can be neither a reducer branch nor a write
			 * from inside the updater.
			 */
			applyAsideDeltas(frames);
			// Decided here, from the frames, not inside the React updater: an
			// updater runs lazily (and twice under StrictMode), so a side effect
			// keyed off it would either never fire or fire on the discarded pass.
			//
			// WHICH SNAPSHOTS DO, and which no longer do.
			//
			// Every snapshot used to. The read is for rows that became durable and
			// were never painted — written while this reader was away, or swallowed
			// by a receipt gap — and against an owner that bounds its page at a stale
			// cursor the unbounded read is the only thing that can find them. But
			// when the page already IS the journal tail, the read is a second full
			// pass over the same rows on the owner, on the machine that is already
			// the reason the receipt broke: the one cost that grows with load, and
			// one that a reconnect loop multiplied.
			//
			// WHICH SNAPSHOTS DO — and #876 is why there are TWO regimes in the gate
			// below, not one unconditional defer:
			//
			//   - A page from a backend that stamps `cold_reason` IS the journal's
			//     tail by contract (`pageIsJournalTail`), so no cursor proof is owed.
			//     It may still not stand down the read: the tail is the tail of the
			//     JOURNAL, and this pane can hold a block disjoint from it — the
			//     reopen in #876, whose cached rows ended five hours before the page
			//     began. It defers only when it CONNECTS to the rows this pane held
			//     (or nothing is held): an overlap is the page's own proof that
			//     nothing lies between the two.
			//   - An older backend's page proves less, so the pre-existing test
			//     stands unchanged: non-empty, not ending ON the published cursor
			//     (the one thing a `through_id=<cursor>` read can never do), and its
			//     newest row already on screen (`paintedIds`, the index the LAST
			//     flush left behind — not the ids this batch is painting, which would
			//     make the test true by construction). A page whose newest row this
			//     viewer has never seen is a row with something behind it, and reads.
			// A cold snapshot, a cursor-less or `cursor_missing` one, an attention
			// frame naming an unpainted anchor and a label-gap retry all still read:
			// none of them passes the gate, and for the first two nothing painted can
			// satisfy any connection test anyway.
			const pageIsPaintedTail = (
				frame: Extract<DesktopSessionFrame, { type: "snapshot" }>,
			) => {
				const entries = frame.payload.history.entries;
				const newest = entries.at(-1);
				if (!newest) return false;
				if (pageIsJournalTail(frame.payload)) {
					// The seam behind the page, not the page itself: see the two regimes
					// above and the #876 note on the journal-tail arm.
					return (
						heldIds.size === 0 ||
						entries.some((entry) => heldIds.has(entryRecordKey(entry)))
					);
				}
				if (newest.id === frame.payload.frontend.snapshot.history_cursor)
					return false;
				// The same key the journal-tail arm uses: a tool result's entry id is
				// not the `tool:<call_id>` its row is held under (#876, review round 1).
				return heldIds.has(entryRecordKey(newest));
			};
			const paintedAnchor = (anchor: string | null | undefined) =>
				anchor != null && paintedIds.current.has(anchor);
			const needsReconcile = frames.some((frame) =>
				frame.type === "attention"
					? !paintedAnchor(frame.payload.anchor_id)
					: frame.type === "snapshot" && !pageIsPaintedTail(frame),
			);
			/*
			 * A WARM THAT LANDS AFTER THE COLD READS RE-ARMS THE HISTORY READ
			 * (remote-load-hydration). A stored remote session opens cold: the daemon
			 * serves an empty page from a facade with no owner, and every read it
			 * answers while cold is blind (see the proof rule in `walkTail`). When the
			 * owner engages - the pane's watch lease, the first keystroke's `/warm`,
			 * or a peer-side start - the facade binds and the flip arrives as a frame
			 * that carries `cold: false`. The daemon publishes that flip in THREE
			 * shapes, and all three are matched here: a fresh `snapshot`; the
			 * attach-settled `frontend.replace`; and the retained-dial late sync,
			 * which - measured live on the `/warm` route (QA round 1, Q1) - publishes
			 * the flip as a `frontend.update` carrying `cold: false` on the frame's
			 * own envelope, with NO snapshot and NO replace anywhere in the batch.
			 * Without the update arm this batch fires no read at all: it carries no
			 * snapshot whose page could owe a reconcile and no labels to retry, so
			 * the pane would sit un-hydrated until some user action.
			 *
			 * EDGE-TRIGGERED, deliberately - the condition is the FLIP (the view was
			 * cold, and this batch says warm), not "the view is warm": that is what
			 * re-arms the read on a later cold spell without becoming a poll, and it
			 * stops the moment a page proves hydration. The walk it fires is the same
			 * one a cold open fires, under the same request budget.
			 */
			const warmedUnproven =
				viewRef.current.cold &&
				!viewRef.current.hydrated &&
				frames.some((frame) =>
					frame.type === "snapshot"
						? frame.payload.cold === false
						: frame.type === "frontend.replace"
							? frame.payload.cold === false
							: frame.type === "frontend.update"
								? frame.payload.cold === false
								: false,
				);
			// The second reason to read back: a snapshot's live seed names calls that
			// settled before this viewer arrived, and the seed carries no arguments for
			// them (see `knownArgs`), so those rows render nothing but their output —
			// `exit code: 0` for every bash call. Everything the transcript IN HAND can
			// label is its session map plus the assistant rows of the page arriving in
			// this very batch; what is left is the gap, and its size decides the page
			// below instead of a fixed constant.
			//
			// Gathered here, from the frames and the last painted view, rather than
			// inside the updater like `paintedIds`: the decision must be made before
			// this flush returns, and an updater runs lazily (and twice under
			// StrictMode).
			const labelled = new Set<string>(
				viewRef.current.transcript.argsByCall.keys(),
			);
			const seedEvents: Record<string, unknown>[] = [];
			// Every id the frames in this batch put on screen. A durable entry id
			// and a live message id are the same id space (that is why the reducer
			// coalesces on it), which is what makes this the connection proof
			// `reconcileTail` tests a fetched page against.
			const paintedEntryIds = new Set<string>();
			for (const frame of frames) {
				if (frame.type !== "snapshot") continue;
				for (const entry of frame.payload.history.entries) {
					paintedEntryIds.add(entry.id);
					const calls = entry.payload?.tool_calls;
					if (!Array.isArray(calls)) continue;
					for (const call of calls as Record<string, unknown>[]) {
						if (call && typeof call.id === "string") labelled.add(call.id);
					}
				}
				for (const data of frame.payload.frontend.snapshot.live_events ?? []) {
					const message = (data as { message?: { id?: unknown } }).message;
					if (typeof message?.id === "string") paintedEntryIds.add(message.id);
				}
				seedEvents.push(...(frame.payload.frontend.snapshot.live_events ?? []));
			}
			/*
			 * A round just ended, which is the moment the round BEFORE it becomes
			 * durable — so it is the only moment a retry can learn anything. Reading
			 * back on every frame batch instead would spend its budget on the frames
			 * that arrive before the rows exist and label nothing.
			 */
			const roundEnded = frames.some(
				(frame) =>
					frame.type === "event" &&
					DURABLE_ROUND_ENDINGS.has(String(frame.payload.type ?? "")),
			);
			/*
			 * Retry candidates are filtered through the SAME budget the retry path
			 * uses, so a seed that keeps naming a call nothing can ever label does not
			 * reset its count: without this, each new snapshot granted an exhausted id
			 * two more reads — a slow drip against the history endpoint rather than the
			 * per-call bound `labelGapCandidates` promises.
			 */
			const seedMissing = labelGapCandidates(
				labelGapRef.current.attempts,
				seedCallsMissingLabels(seedEvents, labelled),
				labelled,
				LABEL_GAP_ATTEMPTS,
			);
			/*
			 * The retry's candidates are the ids the budget already tracks PLUS the calls
			 * a live settle named - because a settle is not charged in `attempts`, a call
			 * that settled while its step was still open would otherwise be named by no
			 * candidate set at all when the durable moment arrives, and the row would keep
			 * its stand-in for good (review round 1, R1).
			 */
			const retryLabels = roundEnded
				? labelGapCandidates(
						labelGapRef.current.attempts,
						[
							...labelGapRef.current.attempts.keys(),
							...labelGapRef.current.settled,
						],
						labelled,
						LABEL_GAP_ATTEMPTS,
					)
				: [];
			/*
			 * THE LIVE SETTLE, the seed's sibling and the third carrier of an
			 * argument-less row. A `tool_execution_end` states no arguments in either
			 * carrier, so the row it paints asks the durable assistant row for its
			 * command - and the seed path above is the one that used to ask. A settle
			 * that arrives LIVE, during the turn instead of inside a snapshot, asked for
			 * nothing, while the two moments that could have covered for it are neither
			 * of them guaranteed:
			 *
			 *  - the seed keeps only the turn's newest `LIVE_EVENT_END_ROWS_MAX` (100)
			 *    ends, so a call that has fallen out of that window is named by no later
			 *    snapshot at all;
			 *  - the round-end retry (`retryLabels` above) draws its candidates from a
			 *    budget only the seed path filled, so a settle it never tracked was not
			 *    retried either.
			 *
			 * Measured on the reported conversation (`b747a2c8d3bb`): a 24.2-hour turn
			 * with 170 calls in it, whose whole app-log history carries three
			 * `sessions.history` reads - `limit=100` at 2026-09-24 00:00:05, and
			 * `limit=100` plus one `limit=100&before_id=…` at 2026-09-25 09:17:25-26 -
			 * every one of them a plain tail or a reader's own page, and NOT ONE with a
			 * computed limit, i.e. no label read was ever asked for. (What that log
			 * cannot say is why: the reads it shows are consistent with a settle naming
			 * nothing, which is what the code did; the code-verifiable half is the case
			 * in `seed-label-gap.test.mjs` that fails on the head which had no settle
			 * path at all - review round 1, R3.) The row then kept its output stand-in -
			 * the call's result painted where its command belongs - until the reader
			 * scrolled its assistant row into a page.
			 *
			 * WHAT ASKS, AND WHAT IS CHARGED, are deliberately two different things. The
			 * read a settle asks for is speculative (the call's row is written when its
			 * STEP commits, so a settle from an open step is asking for a row that does
			 * not exist yet) and it is not charged to `LABEL_GAP_ATTEMPTS`; that budget
			 * is spent at the durable round ending, where the same call is a retry
			 * candidate and a read can always succeed. A call whose arguments the
			 * transcript already holds is in `labelled` and asks for nothing: every
			 * producer that teaches them (a live start, a durable page) writes
			 * `argsByCall` in the same step.
			 */
			const settledEvents: Record<string, unknown>[] = [];
			for (const frame of frames) {
				if (frame.type !== "event") continue;
				const event = frame.payload as Record<string, unknown>;
				if (String(event.type ?? "") !== "tool_execution_end") continue;
				if (!String(event.tool_call_id ?? "")) continue;
				settledEvents.push(event);
			}
			const settleCandidates: string[] = [];
			for (const event of settledEvents) {
				const callId = String(event.tool_call_id ?? "");
				if (labelled.has(callId)) continue;
				if (labelGapRef.current.settled.has(callId)) continue;
				settleCandidates.push(callId);
			}
			for (const callId of settleCandidates) {
				labelGapRef.current.settled.add(callId);
			}
			while (labelGapRef.current.settled.size > LABEL_GAP_MAX_TRACKED) {
				const oldest = labelGapRef.current.settled.values().next().value;
				if (oldest === undefined) break;
				labelGapRef.current.settled.delete(oldest);
			}
			/*
			 * The settle's OWN clock, when the frame states one: the runtime carries the
			 * call's start onto the retained end (`started_at_epoch`), and that instant
			 * is the walk's floor. Without it a settle target is startless,
			 * `pagePassedOldestStart` refuses to stop for it, and the speculative read
			 * pays the whole `RECONCILE_WALK_MAX_ROWS` for a row that is either in the
			 * next page or nowhere (review round 1, R2 measured 5 requests / 500 rows per
			 * pre-commit settle). With it the tail page is already older than a call that
			 * started moments ago, so the walk stops there - one page, one request.
			 */
			for (const [callId, at] of seedCallStarts(settledEvents))
				labelGapRef.current.starts.set(callId, at);
			while (labelGapRef.current.starts.size > LABEL_GAP_MAX_STARTS) {
				const oldest = labelGapRef.current.starts.keys().next().value;
				if (oldest === undefined) break;
				labelGapRef.current.starts.delete(oldest);
			}
			const settleAsk =
				labelGapRef.current.settleRows < LABEL_SETTLE_ROWS_MAX
					? settleCandidates
					: [];
			const missingLabels = [
				...new Set([...seedMissing, ...retryLabels, ...settleAsk]),
			];
			/*
			 * The rows whose FIRST label read this is. Their object column is held
			 * empty until the walk below ends (`labelPending`), because the stand-in it
			 * would otherwise show is the call's OUTPUT, painted where the command
			 * belongs, on rows whose command is one read away. A retry is left alone:
			 * that row has already shown its stand-in, and blanking it now would be
			 * the row flickering rather than the first frame being right.
			 */
			const firstAttempts = missingLabels.filter(
				(id) => !labelGapRef.current.painted.has(id),
			);
			if (seedEvents.length > 0) {
				labelGapRef.current.order = seedCallsMissingLabels(
					seedEvents,
					new Set(),
				);
				/*
				 * The seed's own start instants, kept past this flush because a
				 * round-end retry arrives with no seed at all and still needs the
				 * floor (`pagePassedOldestStart`).
				 */
				for (const [callId, at] of seedCallStarts(seedEvents))
					labelGapRef.current.starts.set(callId, at);
				while (labelGapRef.current.starts.size > LABEL_GAP_MAX_STARTS) {
					const oldest = labelGapRef.current.starts.keys().next().value;
					if (oldest === undefined) break;
					labelGapRef.current.starts.delete(oldest);
				}
				for (const callId of seedWaitingComposes(seedEvents))
					labelGapRef.current.waiting.add(callId);
				/*
				 * A seed that names the same call as started, settled or a stated
				 * verdict RETRACTS the earlier announcement that it was waiting — the
				 * set outlives the seed that filled it, so a later statement has to be
				 * able to take an exemption back, or a call that has since run stays
				 * exempt from the floor and loses the label a page would have given it
				 * (round 7, R18). The delete comes after the add on purpose: one seed
				 * naming a call both ways must end up NOT exempt.
				 */
				for (const callId of seedSettledCalls(seedEvents))
					labelGapRef.current.waiting.delete(callId);
				while (labelGapRef.current.waiting.size > LABEL_GAP_MAX_WAITING) {
					const oldest = labelGapRef.current.waiting.values().next().value;
					if (oldest === undefined) break;
					labelGapRef.current.waiting.delete(oldest);
				}
			}
			/*
			 * Bookkeeping BEFORE the request, because this counts ATTEMPTS: a read that
			 * fails or arrives too early must still not be retried forever. An id the
			 * transcript has learned is dropped; an EXHAUSTED one is KEPT, because
			 * deleting it would let the next snapshot's seed re-admit it with a fresh
			 * budget. The map's oldest entries are evicted past a plausible bound so
			 * the bookkeeping cannot outgrow any seed the owner can send.
			 */
			for (const id of [...labelGapRef.current.attempts.keys()]) {
				if (labelled.has(id)) labelGapRef.current.attempts.delete(id);
			}
			/*
			 * WHAT IS CHARGED, and why a settle is not among them: this loop is the
			 * per-call budget, spent per READ THAT COULD HAVE ANSWERED. A settle's
			 * speculative read (`settleAsk`) is not one of those - the row it wants is
			 * written when the call's step commits, so the read may be asking for a row
			 * that does not exist yet - and charging it here is how the first head of
			 * this change spent both of a call's attempts before the durable round
			 * ending that could have labelled it (review round 1, R1). Its ids are kept
			 * in `settled` instead, and charged in the retry path the moment a durable
			 * ending makes them candidates again.
			 */
			chargeLabelAttempts([...seedMissing, ...retryLabels]);
			while (labelGapRef.current.attempts.size > LABEL_GAP_MAX_TRACKED) {
				const oldest = labelGapRef.current.attempts.keys().next().value;
				if (oldest === undefined) break;
				labelGapRef.current.attempts.delete(oldest);
			}
			performance.mark("lop:transcript:flush:start");

			commitView((current) => {
				let next = { ...current };
				// Replay collects until the snapshot lands; applying an old delta
				// over newer snapshot text is exactly the bug this ordering exists
				// to prevent. Replayed EVENTS fold into a scratch transcript instead:
				// the snapshot's durable page is applied over it afterwards, so a row
				// that became durable wins and an in-flight tail survives — and the
				// scratch is painted when the batch ends without one (see the fold
				// below the loop), because the frames of one reconnect are not obliged
				// to arrive in one flush.
				let snapshotted = next.frontend !== null;
				let replayTranscript: TranscriptState | null = null;
				const now = Date.now();
				for (const frame of frames) {
					if (frame.type === "heartbeat") continue;
					if (frame.type === "gap") {
						// Receipt continuity broke: the authoritative snapshot that follows
						// is the only thing that can say what happened in the interval, so
						// painted FRONTEND state is dropped and the view says "reconnecting"
						// rather than claiming a state it cannot prove.
						//
						// The transcript's live rows are KEPT and marked rather than
						// dropped — dropping them is what made a blip look like the answer
						// being erased and rewritten from its last chunk. See
						// `markLiveRecordsTruncated` for what is marked and why exactly
						// those rows.
						//
						// THE READINGS ARE KEPT TOO, in `heldFrontend`, and that is the
						// difference between a gap and a lie: the pane still knows the
						// model, the effort, the context window and the spend it was last
						// told, and blanking them made a ~1.5-4 s reconnect look like a
						// conversation being reloaded from scratch. `next.frontend` is read
						// here because this is the LAST batch in which it is still the
						// value the pane painted - one line later it is null.
						next = {
							...next,
							frontend: null,
							heldFrontend: next.frontend ?? next.heldFrontend,
							history: null,
							terminal: null,
							status: "reconnecting",
							transcript: markLiveRecordsTruncated(next.transcript),
						};
						snapshotted = false;
						continue;
					}
					// From here the frame is a receipt with an epoch/seq cursor.
					//
					// The cursor as it stood BEFORE this frame is read first and kept
					// beside the assignment, because `frontend.replace` below is ordered
					// against it: checking the value this very frame is about to write
					// would reject every replacement (remediation contract § C).
					const priorCursor = receiptRef.current;
					if (frame.type === "open" || "seq" in frame) {
						receiptRef.current = { epoch: frame.epoch, seq: frame.seq };
						next = { ...next, receipt: receiptRef.current };
					}

					if (frame.type === "open") {
						next = {
							...next,
							subscriptionId: frame.payload.subscription_id,
						};
						if (frame.payload.gap) {
							// The same hold as the `gap` arm above, for the same reason:
							// an `open{gap}` is the reopen AFTER a broken receipt, and the
							// readings it must not blank are the ones on screen right now.
							const held = next.frontend ?? next.heldFrontend;
							next = {
								...next,
								frontend: null,
								heldFrontend: held,
								history: null,
								transcript: markLiveRecordsTruncated(next.transcript),
							};
							/*
							 * AND THE PAINT SAYS IT IS NOT LIVE, WHICH IS THE HALF THAT
							 * MAKES THE HOLD HONEST.
							 *
							 * A `gap` FRAME does this itself (the arm above), because the
							 * server sends one before it closes. This arm had no such write,
							 * and with the hold in place that becomes a lie rather than a
							 * blank: a reconnect the renderer asks for ITSELF (the resync
							 * after another surface changed something, `reopen`) reaches an
							 * `open{gap}` with `status` still `live`, so four held readings
							 * would be painted as current over a stream that has not
							 * replayed anything yet.
							 *
							 * FROM `live` ONLY, AND THAT IS A CORRECTION RATHER THAN A
							 * TIDY-UP (agent review round 1, MAJOR 1). The write is about the
							 * resync from a live pane. `unavailable` is a TERMINAL state the
							 * app has already given up on, and the pane gates BOTH the
							 * failure notice and its Reconnect control on
							 * `status === "unavailable" && failure`
							 * (`canonical-transcript.tsx`). Overwriting it here left
							 * `failure` standing while the status said `reconnecting`, so the
							 * diagnosis and the only control that can act disappeared behind
							 * a line claiming progress. Two doors reach that state with a
							 * non-null hold: the `HISTORY_UNREADABLE` arm below, and the
							 * retry arm, which deliberately PRESERVES `unavailable` +
							 * `failure` across its own `connect()`.
							 *
							 * The road not taken, recorded: clearing `failure` in this same
							 * write. The failure is a true statement the app has already
							 * made, and the retry arm keeps it ON PURPOSE; a status write is
							 * not the place to retract a diagnosis.
							 *
							 * Keyed on there being something TO hold, which is also what
							 * makes the FIRST open of a fresh mount correct: it answers
							 * `gap: true` too (there is no earlier epoch for the bridge to
							 * match against), and calling that pane "reconnecting" would
							 * replace its honest "connecting" - a pane that has never
							 * connected - with a claim that it once was.
							 */
							if (held && next.status === "live")
								next = { ...next, status: "reconnecting" };
							snapshotted = false;
						}
						continue;
					}
					if (!snapshotted) {
						if (frame.type === "event") {
							replayTranscript = applyEvent(
								replayTranscript ?? next.transcript,
								frame.payload,
								now,
								{
									/*
									 * The replay's own cursor, and the point of passing it: a frame this
									 * viewer has already folded — a window re-sent because the receipt
									 * cursor was behind the applied position — carries a seq at or behind
									 * the row's, and `message_update` refuses it rather than appending the
									 * fragment a second time. Without this, folding the replay over the
									 * PAINTED transcript re-applies every re-sent delta and the text
									 * doubles (the operator's "chunks not in the proper overlap/order").
									 */
									frame: { epoch: frame.epoch, seq: frame.seq },
								},
							);
						}
						if (frame.type === "snapshot") {
							const snapshot = frame.payload;
							// Order matters and is the contract: replayed events, then
							// the durable page (authoritative for every id it names),
							// then the live seed for the turn still in flight.
							let transcript = replayTranscript ?? next.transcript;
							if (!snapshot.history.cursor_missing) {
								transcript = applyHistoryPage(transcript, snapshot.history);
							}
							/*
							 * AND A SNAPSHOT RESOLVES A HELD SEND (§F2's last bullet, UX round 1's
							 * U5b). This frame is "the frame that follows a reconnect or a fresh
							 * subscription" (the note below says the same of the pulse seed), and
							 * its page is the server's own statement of what this conversation
							 * holds — the acknowledgement §F2 says a held state clears from, never
							 * from the local send. The store decides: an answer that NAMES the held
							 * request landed; one that does not proves it did not only on a page
							 * that is both COMPLETE (no `cursor_missing`) and DEEP ENOUGH to see
							 * back to the claim (the store's own reach test, issue #847 — the page
							 * travels whole rather than as an id list because of it). Passed
							 * unconditionally because both arms are cheap and the claim's existence
							 * is the store's test.
							 */
							if (sessionId) {
								useCanonicalSessionsStore
									.getState()
									.resolveHeldFromServer(
										sessionId,
										snapshot.history.entries,
										!snapshot.history.cursor_missing,
									);
							}
							// A cold session (no live owner) snapshots with no history
							// cursor and therefore an empty page, and a replaced cursor
							// reports cursor_missing. Both are the contract's "reconcile
							// through /history" case: the authoritative tail is fetched
							// once per snapshot and merged durable-wins.
							transcript = applyLiveSeed(
								transcript,
								snapshot.frontend.snapshot,
								now,
								// The seed states the turn as of THIS snapshot, so rows it mints
								// or extends record the snapshot frame's cursor as their
								// position — a later replay of an older frame is then refused
								// rather than appended (see the reducer's cursor gate).
								{ epoch: frame.epoch, seq: frame.seq },
							);
							next = {
								...next,
								// The pulse is SEEDED here rather than merged: a snapshot is the
								// authoritative statement of what this viewer has seen, and it is
								// the frame that follows a reconnect or a fresh subscription —
								// exactly the moments a counter carried over from before would be
								// counting events the new subscription never delivered.
								subagentPulses: seedSubagentPulses(
									snapshot.frontend.snapshot.live_events,
								),
								status: "live",
								// The reconcile, in the same commit as the rows: the caption
								// and the cached rows it describes go together, so the reader
								// never sees a reconciled transcript labelled as last-saved or
								// the reverse.
								stale: false,
								frontend: {
									...snapshot.frontend.snapshot,
									attention: mergeCompletionAttention(
										next.frontend?.attention,
										snapshot.frontend.snapshot.attention,
										sessionId,
									),
								},
								history: snapshot.history,
								cold: snapshot.cold,
								ownerEpoch: snapshot.frontend.epoch,
								failure: null,
								// A page that was APPLIED is proof, and its absence is not: with
								// `cursor_missing` the snapshot deliberately carries no usable
								// page, so the answer is still owed to the `/history` reconcile
								// this batch fires (see `reconcileTail`). `next.hydrated` is
								// OR-ed in so a later snapshot cannot un-prove what an earlier
								// page already established.
								//
								// AN EMPTY PAGE PROVES NOTHING EITHER (UX round 1, U2). A
								// snapshot whose page carries no entries — a session with an
								// empty or absent journal — used to satisfy this on
								// `!cursor_missing` alone and set `hydrated`, so the composer
								// could then claim the conversation was EMPTY while the
								// authoritative read was still failing. That is the walked
								// defect: press Reconnect with the backend down and the history
								// error is replaced by "What can I help you with today?" over a
								// conversation whose history nobody has read. An empty page is
								// exactly the case `/history` exists to settle, and it is
								// already asked once per snapshot, so the greeting waits for
								// that answer.
								hydrated:
									next.hydrated ||
									(!snapshot.history.cursor_missing &&
										snapshot.history.entries.length > 0),
								transcript,
							};
							snapshotted = true;
							replayTranscript = null;
						}
						continue;
					}
					if (frame.type === "attention") {
						if (next.frontend)
							next = {
								...next,
								frontend: {
									...next.frontend,
									attention: mergeCompletionAttention(
										next.frontend.attention,
										frame.payload,
										sessionId,
									),
								},
							};
						continue;
					}
					if (frame.type === "frontend.update") {
						const update = frame.payload;
						if (!next.frontend) continue;
						// An owner epoch rollover (a cold session's first owner binding,
						// or a replaced owner) arrives as an update whose changes carry
						// the NEW epoch and every field. Adopt it wholesale; from then on
						// the ordinary same-epoch sequence check applies. An update for
						// some other epoch that does not announce itself is stale.
						const rollover =
							update.epoch !== next.ownerEpoch &&
							update.changes.epoch === update.epoch;
						if (
							rollover ||
							(update.epoch === next.ownerEpoch &&
								next.frontend.sequence < update.sequence)
						) {
							// Field deltas, not a full repaint: spread only the changed
							// keys over the current state.
							next = {
								...next,
								ownerEpoch: rollover ? update.epoch : next.ownerEpoch,
								frontend: {
									...next.frontend,
									...update.changes,
									attention: mergeCompletionAttention(
										next.frontend.attention,
										update.changes.attention,
										sessionId,
									),
									sequence: update.sequence,
								},
								/*
								 * AND THE COLD PAIR RIDES THIS FRAME TOO (remote-load-hydration, QA round 1
								 * Q1). The daemon merges the same fields the snapshot carries onto every
								 * update it publishes, because the frame that tells a retained-dial cold
								 * viewer its owner came back is exactly this one (a rollover update: new
								 * epoch, full changes, `cold: false` - see `_frontend` in the daemon). The
								 * fold spread `changes` only, so the flip used to be dropped on the floor
								 * here: the view stayed `cold: true` and the warm re-arm could never see
								 * it. Written only when the envelope states it - the field is ADDITIVE,
								 * and an absent one must not un-state what a snapshot established.
								 */
								...(typeof update.cold === "boolean"
									? { cold: update.cold }
									: {}),
							};
						}
						continue;
					}
					if (frame.type === "frontend.replace") {
						/*
						 * An accepted move's own authoritative repaint, and the reason it is
						 * not a delta.
						 *
						 * A move rewrites the facade's cwd without moving the owner's clock,
						 * so the bridge publishes this explicit replacement rather than a
						 * same-sequence `frontend.update` - which the rule just above would
						 * (and must) reject as stale, leaving a mounted viewer on the
						 * directory the session has already left (backend review R4).
						 *
						 * It replaces the PAINT PROJECTION and nothing else: `history`,
						 * `transcript`, the durable rows, hydration and the subscription id
						 * all survive, because this spreads them rather than rebuilding the
						 * view. `cold` comes from the frame too - it is the facade's ACTUAL
						 * cold status at publish time, which is what a cold move changes.
						 *
						 * Attention still goes through the receipt-revision helper: the paint
						 * copy inside a replacement can be older than attention the stream has
						 * already delivered, and attention may only ever rise.
						 *
						 * The `frontend.update` rule above is left exactly as it was. This
						 * branch is only about ACCEPTING the replacement: the next real owner
						 * delta at sequence N+1 must still apply over a replacement at N, and
						 * an ordinary stale delta must still be rejected.
						 */
						if (
							next.frontend &&
							acceptFrontendReplace(priorCursor, sessionId, frame)
						) {
							const replaced = frame.payload.frontend;
							next = {
								...next,
								frontend: {
									...replaced.snapshot,
									attention: mergeCompletionAttention(
										next.frontend.attention,
										replaced.snapshot.attention,
										sessionId,
									),
								},
								ownerEpoch: replaced.epoch,
								cold: frame.payload.cold,
							};
						}
						continue;
					}
					if (frame.type === "event") {
						const eventType = String(frame.payload.type ?? "");
						if (TERMINAL_EVENTS.has(eventType)) {
							next = {
								...next,
								terminal: eventType,
							};
						}
						if (DURABLE_ROUND_ENDINGS.has(eventType)) {
							// Separate from the wait latch: starts/steering end a wait,
							// not a round whose namespace consumers need to re-read.
							next = { ...next, turnsCompleted: next.turnsCompleted + 1 };
						}
						const transcript = applyEvent(next.transcript, frame.payload, now, {
							/*
							 * The live frame's own cursor: the row records the position its
							 * text belongs to, so a re-delivery of the same frame (an
							 * interleaved flush after a reconnect) is refused rather than
							 * appended twice.
							 */
							frame: { epoch: frame.epoch, seq: frame.seq },
							/*
							 * READ AT APPLY TIME, not captured: the store is written by the
							 * interrupt's receipt, which lands BEFORE the killed call's end event
							 * comes back through this stream — the same ordering the strip's own
							 * `stoppedTurns` docstring states. `getState()` rather than a selector
							 * because this value is needed inside a socket callback rather than
							 * during a render, which is the shape `chat-page`'s `send` already uses
							 * for the same reason.
							 */
							userStoppedAt: sessionId
								? (useCanonicalSessionsStore.getState().stoppedTurns[
										sessionId
									] ?? null)
								: null,
							/*
							 * The queued-engine mode for the settle-only `ask` rule (design
							 * §3 rows 2/6), read at apply time from the very frontend state
							 * this pane is painting (`queuedAskEngineLive`). An absent read —
							 * no snapshot yet, a core that predates the `asks` field — keeps
							 * today's mount, and the settle marker still drops a divert.
							 */
							queuedAskEngine: queuedAskEngineLive(next.frontend),
						});
						if (transcript !== next.transcript) {
							next = { ...next, transcript };
						}
						/*
						 * The child pulse (§ 5.3), bumped in this branch because this is the
						 * one place a live event is applied — a second listener would be a
						 * second consumer of the same stream, and the two could disagree
						 * about which events happened.
						 *
						 * The event set, the id rule and the bump all live in
						 * `applySubagentPulse`, and this call site holds none of them: the
						 * member and the filter cannot drift from the module's because there
						 * is no second copy to drift. The step returns the SAME map for an
						 * event that is not a beat, which is what keeps an unrelated frame
						 * from looking like a change to the reader.
						 *
						 * It rides the same `next` object as everything else, so a beat that
						 * arrives in a coalesced frame does not cost an extra render: the
						 * reader that watches this counter is re-rendered because the frame
						 * arrived, not because the pulse is a separate piece of state.
						 */
						const pulsed = applySubagentPulse(
							next.subagentPulses,
							frame.payload,
						);
						if (pulsed !== next.subagentPulses) {
							next = { ...next, subagentPulses: pulsed };
						}
					}
				}
				/*
				 * Replayed events are painted even when no snapshot landed in the SAME
				 * batch.
				 *
				 * A receipt gap's replay is a run of real event frames between the `open`
				 * and the snapshot that follows, and the frames of one reconnect are not
				 * obliged to arrive in one flush: the rAF (or its 250 ms backstop) can fall
				 * between them. The scratch state was folded to be applied at the snapshot
				 * and then thrown away when the snapshot turned out to be in a later batch
				 * -- so the events the receipt cursor had just caught up on were silently
				 * lost, and the rows they carried only reappeared if some later read
				 * happened to cover them. Painting them here costs nothing when the
				 * snapshot IS in the same batch (it is applied over this state, and the
				 * durable page wins by id), and it is the difference between losing text
				 * and holding it when the batch boundary falls inside the replay.
				 */
				if (!snapshotted && replayTranscript) {
					next = { ...next, transcript: replayTranscript };
				}
				performance.mark("lop:transcript:flush:end");
				performance.measure(
					"lop:transcript:flush",
					"lop:transcript:flush:start",
					"lop:transcript:flush:end",
				);
				paintedIds.current = next.transcript.index;
				/*
				 * AN OFF-RECORD BATCH PAINTS NOTHING, so it must not repaint the pane
				 * either (review round 1, F5). The loop above has still RUN for these
				 * frames, which is what keeps `receiptRef` current — the receipt cursor is
				 * advanced by the same arm for every frame carrying an epoch and a seq, and
				 * THE REF is what bounds a reconnect's replay. The only field such a batch
				 * writes into `next` is the view's mirror of that cursor, and every other
				 * field of `next` is the reference `current` already holds: returning
				 * `current` therefore hands React the identical object and the pane does not
				 * re-render at all, while an aside answer streams into the panel and the
				 * conversation, the composer and the transcript are left alone.
				 *
				 * AND IT CANNOT SKIP THE HOLD BELOW. An off-record batch is one whose
				 * frames are all `aside_delta`/`heartbeat` (see `batchMovesView`), and
				 * `firstAttempts` is built from snapshot seeds and round-ending event
				 * frames only - a batch of those two types carries neither, so
				 * `firstAttempts` is empty here and the hold has nothing to apply. The
				 * guard sits above the hold rather than below it so that the early return
				 * can never be the reason a held row went unheld.
				 */
				if (!batchMovesView(frames)) return current;
				if (firstAttempts.length > 0) {
					// In the same commit as the rows they describe, so no frame paints
					// a seeded row's stand-in before the hold is in place.
					const held = new Set(next.labelPending);
					for (const id of firstAttempts) held.add(id);
					next = { ...next, labelPending: held };
					/*
					 * The hold's backstop is NOT armed here, deliberately: a hold can
					 * also arrive with a cached paint (`paintSeed`, in the very first
					 * frame), and a cap that only the flush could arm would leave those
					 * rows objectless forever. The backstop effect (above the stream
					 * effect) owns the deadline for every hold, whatever put the row in
					 * the set.
					 */
				}
				/*
				 * The hold's SOURCE: whatever authoritative frontend this batch left
				 * painted becomes the copy a later gap falls back to.
				 *
				 * WRITTEN ONCE, HERE, rather than at each of the four arms that can
				 * publish a frontend (`snapshot`, `frontend.update`, `frontend.replace`,
				 * and the attention merge that rides `frontend.update`). Four call sites
				 * would be four chances for a new arm to forget, and the failure of a
				 * forgotten one is invisible: the readings would simply be one frame
				 * stale in a state nobody screenshots. A rule over the batch's OUTCOME
				 * covers every arm that exists and every arm added later, because it asks
				 * the only question that matters - is there an authoritative frontend
				 * painted now?
				 *
				 * IDENTITY, NOT A DEEP COMPARE: every arm above builds a NEW object (a
				 * spread of the old one, or the snapshot's own), so reference equality
				 * is the exact test for "this batch published a frontend". It is a
				 * cheap test, not a promise about WHICH batches reassign the hold - an
				 * attention-only batch builds a new frontend object too, so it does
				 * reassign. What the identity test buys is that a batch which published
				 * nothing (the early return above) cannot blank or churn the hold.
				 *
				 * WHOLESALE, and that is a requirement rather than an implementation
				 * detail: the held copy is a whole published state, so a fresh snapshot
				 * REPLACES it. Merging old and new fields would be a state the owner
				 * never published and could not be asked about.
				 */
				if (next.frontend !== null && next.frontend !== next.heldFrontend)
					next = { ...next, heldFrontend: next.frontend };
				return next;
			});
			if (firstAttempts.length > 0) {
				/*
				 * Painted once is forever FOR THIS CONVERSATION: recorded here, in the
				 * same breath as the hold, so a later mount cannot hold the same row
				 * again however the attempt map has moved on (round 2, N1).
				 */
				for (const id of firstAttempts) labelGapRef.current.painted.add(id);
				while (labelGapRef.current.painted.size > LABEL_GAP_MAX_PAINTED) {
					const oldest = labelGapRef.current.painted.values().next().value;
					if (oldest === undefined) break;
					labelGapRef.current.painted.delete(oldest);
				}
			}
			/*
			 * A walk a settle ALONE asked for is paid out of the settle budget; one the
			 * seed, a retry or the reconcile also needed is FREE, because it was
			 * happening anyway. That is the coalescing: N settles in one flush are one
			 * walk, and a settle whose call a page already names costs nothing further.
			 */
			const settleOnly =
				settleAsk.length > 0 &&
				seedMissing.length === 0 &&
				retryLabels.length === 0 &&
				!needsReconcile &&
				/* The warm's own read is not "happening anyway": it is not the
				 * settle's debt, so a settle-only batch does not pay for it. */
				!warmedUnproven;
			if (needsReconcile || missingLabels.length > 0 || warmedUnproven) {
				const targets = new Set(missingLabels);
				const order = labelGapRef.current.order;
				void reconcileTail(
					generation,
					paintedEntryIds,
					missingLabels.length > 0
						? {
								targets,
								order,
								starts: labelGapRef.current.starts,
								waiting: labelGapRef.current.waiting,
								every: new Set([...order, ...targets]),
								found: new Set(
									pageLabels(
										frames.flatMap((frame) =>
											frame.type === "snapshot"
												? frame.payload.history.entries
												: [],
										),
										new Set(order),
									),
								),
								pending: firstAttempts,
							}
						: NO_LABEL_WALK,
					/*
					 * The first attempt, stated rather than defaulted: the settle
					 * budget's callback rides behind it (see `onSpend`).
					 */
					1,
					settleOnly
						? (spent: number) => {
								labelGapRef.current.settleRows += spent;
							}
						: undefined,
					/*
					 * The seam this batch cannot prove from its own rows: the held set,
					 * captured before this flush's commits (see the top of `flush`). #876.
					 */
					heldIds,
					batchEdge,
				);
			}
		};

		/**
		 * Tear the current subscription down, marking it as OUR decision so the
		 * browser transport's `end` is not mistaken for a dead stream.
		 */
		const closeStream = () => {
			const closing = dispose;
			dispose = null;
			if (!closing) return;
			closingIntentionally = true;
			// Cleared in `finally`, not left standing: the browser transport emits its
			// `end` SYNCHRONOUSLY from inside this call, while Electron's says nothing
			// at all - so a flag that outlived the call would swallow the NEXT real
			// failure's retry on the native path.
			try {
				closing();
			} finally {
				closingIntentionally = false;
			}
		};

		const connect = () => {
			clearSnapshotTimer();
			snapshotTimer = window.setTimeout(() => {
				snapshotTimer = 0;
				if (generationRef.current !== generation) return;
				// Terminal, not a retry: a connection that accepted and then said
				// nothing for the whole bound is the frozen-owner case, and asking it
				// again six more times would turn one 20 s wait into minutes. The
				// user's Reconnect (`reopen`) re-arms everything.
				closeStream();
				commitView((current) => ({
					...current,
					subscriptionId: null,
					status: "unavailable",
					failure: streamFailureNotice(DESKTOP_STREAM_DETAIL.ended),
					// A connection that accepted and then said nothing is the frozen-owner
					// case, and it is TERMINAL for this attempt: the pane states the
					// failure and offers Reconnect rather than holding readings over a
					// stream that is not coming back on its own. Held here would be the
					// one thing R2 forbids - a reading kept past the point where anything
					// says it is still being refreshed.
					heldFrontend: null,
				}));
				if (rechecked) return;
				rechecked = true;
				recheckTimer = window.setTimeout(() => {
					recheckTimer = 0;
					if (generationRef.current !== generation) return;
					reopen();
				}, STREAM_SNAPSHOT_RECHECK_MS);
			}, STREAM_SNAPSHOT_DEADLINE_MS);
			dispose = subscribeDesktopStream(
				{
					sessionId,
					epoch: reconnectRef.current.epoch,
					afterSeq: reconnectRef.current.afterSeq,
				},
				(event) => {
					if (generationRef.current !== generation) return;
					// `end` and `error` are the same event for this consumer: the stream
					// is gone. `end` is not ignorable, because the only paths that end a
					// stream we did not ask to end are a transport failure or main's relay
					// being disposed under a backend restart - and an intentionally
					// disposed subscription carries a bumped generation, so anything that
					// reaches here was NOT ours. Ignoring it was half of the reported bug:
					// the renderer got a dead stream and no reason to do anything about
					// it.
					if (event.kind === "error" || event.kind === "end") {
						// Our own teardown's `end`, not a dead stream: nothing to recover
						// from and nothing to report.
						if (closingIntentionally) return;
						// The failure paths below own the outcome now, including the retry
						// that re-arms the bound for its own connection.
						clearSnapshotTimer();
						closeStream();
						/*
						 * 404 is about the SESSION, not the transport: the desktop plane
						 * answers it for an id this host does not have. It is terminal by
						 * construction — retrying asks the same question and gets the same
						 * answer — so it does not enter the retry budget and raises no
						 * `failure` notice, which is transport vocabulary. The click path
						 * is what reaches it, because it deliberately spends no validating
						 * round trip on the latency path (M6).
						 */
						if (event.kind === "error" && event.status === 404) {
							// Its paint goes with it: a later click on the same id would
							// otherwise paint rows for a transcript that no longer exists,
							// with nothing to tell the reader they are fiction. Its expansions
							// go too (agent review round 1, R1-2): `forgetTurnCollapseOpen` is
							// the same sibling of `dropPaint` the store's own doc names, and an
							// id this host does not have should not keep a remembered set.
							if (sessionId) {
								dropPaint(sessionId);
								forgetTurnCollapseOpen(sessionId);
							}
							commitView((current) => ({
								...current,
								subscriptionId: null,
								status: "unavailable",
								missing: true,
								failure: null,
								// 404 is about the SESSION, so it is the one terminal state
								// that must take the readings with it: the conversation this
								// machine does not have has no model, no context window and no
								// spend to report, and holding them would describe a session
								// that, as far as this host can answer, does not exist. The
								// same reasoning that drops the paint above (see its comment)
								// applies to every other reading of the same session.
								heldFrontend: null,
							}));
							return;
						}
						const detail =
							event.kind === "error"
								? (event.detail ?? "The event stream failed.")
								: "The event stream closed unexpectedly.";
						// The subscription the watch lease names died with the stream. Held,
						// it makes the lease keep posting a subscription id the backend no
						// longer holds (the 422 the operator's log shows), so it is dropped
						// here and re-established by the next `open` frame.
						commitView((current) => ({ ...current, subscriptionId: null }));
						if (attempt >= STREAM_MAX_ATTEMPTS) {
							commitView((current) => ({
								...current,
								status: "unavailable",
								// The transport's detail is machine register and differs per
								// transport; the reader gets the product sentence for that
								// condition instead (D1).
								failure: streamFailureNotice(detail),
								// The retry budget is spent, and that is the state R3 keeps
								// terminal: what says the connection is not live is the
								// failure notice and its Reconnect, so a reading held past it
								// would be the only thing on the pane still claiming to
								// describe a stream. Cleared with the budget.
								heldFrontend: null,
							}));
							return;
						}
						attempt += 1;
						/*
						 * The retry below is a WINDOW WITH NO SUBSCRIPTION, and that is a fact
						 * #118's `useWarmSession` depends on - so it is recorded here rather
						 * than left to be discovered. That hook's precondition is that the warm
						 * is issued from inside the panel holding this subscription, because
						 * the desktop bridge is reference-counted and DETACHING CANCELS AN
						 * IN-FLIGHT WARM; a warm sent while this effect is between attempts
						 * therefore loses its head start and the send engages inline, which is
						 * the degraded case that hook documents as "exactly today's behaviour,
						 * never worse" - nothing on the send path waits on warm state. The
						 * alternative was the state this replaces (no subscription ever came
						 * back, so every send paid the cold engage until the app was
						 * restarted), so the gap is strictly the smaller cost. Do not "fix" it
						 * by holding a stream open across the backoff: a refused subscription
						 * does not hold the bridge either.
						 */
						// The receipt cursor still bounds what a reconnect has to replay, so
						// it is retained when there is one - but a retry no longer REQUIRES
						// one. A stream that never opened has no receipt, and gating on it is
						// what left the consumer waiting forever.
						const receipt = receiptRef.current;
						if (receipt) {
							reconnectRef.current = {
								epoch: receipt.epoch,
								afterSeq: receipt.seq,
							};
						}
						commitView((current) =>
							current.status === "unavailable" && attempt > 1
								? current
								: { ...current, status: "reconnecting", failure: null },
						);
						retryTimer = window.setTimeout(() => {
							retryTimer = 0;
							if (generationRef.current !== generation) return;
							connect();
						}, streamRetryDelayMs(attempt));
						return;
					}
					if (event.data === undefined) return;
					try {
						const frame = JSON.parse(event.data) as DesktopSessionFrame;
						// Reaching a snapshot is the only proof the stream really works: an
						// authenticated `open` can still be followed by an immediate close,
						// and resetting the budget there would let that pair retry forever.
						if (frame.type === "snapshot") {
							attempt = 0;
							clearSnapshotTimer();
							// A later stall is a new one and earns its own re-check.
							rechecked = false;
						}
						pending.current.push(frame);
						// One flush per animation frame while the window paints. A
						// hidden or backgrounded window stops delivering animation
						// frames entirely, so a timer backstop keeps state (and the
						// notification path that reads it) current at a coarser rate.
						if (!raf) raf = requestAnimationFrame(flush);
						if (!fallback) fallback = window.setTimeout(flush, HIDDEN_FLUSH_MS);
					} catch {
						// A malformed frame is skipped, never fatal: the next snapshot
						// heals any state it would have touched.
					}
				},
			);
		};

		/*
		 * Re-read the owner's snapshot because a DIFFERENT surface of this app just
		 * changed something this pane displays.
		 *
		 * The cursor is dropped first, and that is the whole point: a reconnect that
		 * keeps `epoch`/`afterSeq` asks only for what happened SINCE those frames,
		 * while the state that moved here (a cold session's wake list, synthesised
		 * from the derived index at subscribe time) is older than the cursor. Asking
		 * without one is what makes the backend answer with a fresh snapshot, and a
		 * snapshot is the only read that re-synthesises the cold path.
		 *
		 * Deliberately NOT published as a user action: the caller is a mutation
		 * elsewhere in the app that has already succeeded, so there is nothing to
		 * press and nothing to explain. The pane's own `retry` stays the only control
		 * on this handle, and its budget reset (`attempt = 0`) is not needed here.
		 *
		 * A pending RETRY is cancelled first, and that ordering is load-bearing
		 * rather than tidy: this used to assume "a resync only runs while a
		 * subscription is live", which is false inside the backoff window above
		 * (`dispose` is null and `retryTimer` is armed to call `connect()` itself).
		 * A wake write from the Schedules page landing in that window would connect
		 * here, then have the timer connect a SECOND stream over it - the first
		 * handle overwritten and never disposed, so it keeps delivering frames into
		 * this reducer and outlives the pane's unmount, whose cleanup closes only the
		 * newest (the reviewer's R4: code-read, and the fix is the ordering).
		 */
		const resync = () => {
			if (retryTimer !== 0) {
				window.clearTimeout(retryTimer);
				retryTimer = 0;
			}
			reconnectRef.current = {};
			receiptRef.current = null;
			closeStream();
			connect();
		};

		/*
		 * The user's own way back, published on the handle as `retry`.
		 *
		 * Deliberately re-arms BOTH halves rather than only the stream: the state
		 * that offers this action is "we could not reach this conversation", and
		 * which half failed (the stream, the history read, or both) is not
		 * something the reader can tell or should have to. Resetting the counters
		 * first matters - otherwise a Retry after exhaustion would immediately
		 * exhaust its budget again and do nothing visible.
		 */
		const reopen = () => {
			attempt = 0;
			// A user's Reconnect makes the pending silent re-check redundant, and a
			// re-check that already ran must not be armed again by its own bound.
			if (recheckTimer) {
				window.clearTimeout(recheckTimer);
				recheckTimer = 0;
			}
			/*
			 * Cancel the pending retries BEFORE re-arming both halves.
			 *
			 * A timer armed before this press fires AFTER it and calls `connect()` a
			 * second time, overwriting the single `dispose` closure - so the
			 * subscription this press opens can never be disposed and keeps delivering
			 * frames until the panel unmounts (R1-1). The effect owns exactly one
			 * subscription and one outstanding read, and this is where that is
			 * enforced; the backoff's own timer clears before it re-arms for the same
			 * reason.
			 */
			if (retryTimer) {
				// `window.clearTimeout`, symmetric with the `window.setTimeout` that
				// armed it: the two have to name the same timer host, and the harness
				// that drives this hook substitutes `window` to prove a queued retry
				// was really cancelled.
				window.clearTimeout(retryTimer);
				retryTimer = 0;
			}
			if (reconcileTimer) {
				window.clearTimeout(reconcileTimer);
				reconcileTimer = 0;
			}
			commitView((current) => ({
				...current,
				failure: null,
				status:
					current.status === "unavailable" ? "connecting" : current.status,
			}));
			if (!viewRef.current.hydrated) {
				// The painted set comes from the VIEW here, not from a batch of frames:
				// a Retry arrives with no frames in hand, and what the walk's connection
				// test needs is what is on screen now.
				void reconcileTail(
					generation,
					new Set(viewRef.current.transcript.index.keys()),
				);
			}
			if (dispose) return;
			connect();
		};

		connect();
		// Non-null only while this effect owns the stream, so a Retry pressed after
		// the session changed (or after unmount) cannot re-open the old session.
		retryRef.current = reopen;
		/*
		 * `rehydrate` fires the walk `reopen` fires for an unhydrated view, without
		 * the stream re-arm - the slot's "Try again" is a question about the
		 * READ, not about the connection. Gated on `!hydrated` for the same reason
		 * `reopen`'s walk is: a click that lands after a page proved hydration has
		 * nothing to re-ask.
		 */
		hydrateRef.current = () => {
			/*
			 * AND A PRESS WHILE A READ IS ALREADY OUT IS ANSWERED BY THAT READ (UX
			 * round 1, U1): N presses must not stack N walks for one question - the
			 * read in flight is already asking it, and the pending paint is the
			 * view's half of the same acknowledgement.
			 */
			if (!viewRef.current.hydrated && historyReadsRef.current === 0) {
				void reconcileTail(
					generation,
					new Set(viewRef.current.transcript.index.keys()),
				);
			}
		};
		// Same lifetime rule for the resync: it is addressable by session id from
		// another feature, and it must not outlive the pane it re-reads for.
		const unregisterResync = __registerCanonicalResync(sessionId, resync);

		return () => {
			generationRef.current += 1;
			retryRef.current = null;
			hydrateRef.current = null;
			unregisterResync();
			dispose?.();
			if (raf) cancelAnimationFrame(raf);
			if (fallback) clearTimeout(fallback);
			if (retryTimer) clearTimeout(retryTimer);
			if (reconcileTimer) clearTimeout(reconcileTimer);
			if (labelHoldTimerRef.current) {
				window.clearTimeout(labelHoldTimerRef.current);
				labelHoldTimerRef.current = 0;
			}
			if (labelMarkTimerRef.current) {
				window.clearTimeout(labelMarkTimerRef.current);
				labelMarkTimerRef.current = 0;
			}
			if (recheckTimer) window.clearTimeout(recheckTimer);
			clearSnapshotTimer();
			pending.current = [];
		};
	}, [commitView, sessionId, enabled]);

	// A different session is a different transcript; the reconnect cursor is
	// per-session too, so both reset together.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change only
	useEffect(() => {
		reconnectRef.current = {};
		receiptRef.current = null;
		// The transcript is replaced below, so a previous session's anchors must
		// not suppress the first reconcile of the new one.
		paintedIds.current = EMPTY_TRANSCRIPT.index;
		/*
		 * Kept when the state already belongs to THIS session. The panel that
		 * mounts on the New-chat flip is exactly that case: it mounted with the id
		 * it keeps, carrying the row `seedPendingSends` gave its first frame, and
		 * replacing that with an empty transcript is the defect UX round 2's U1
		 * measured. A real change of session id still resets, because the state on
		 * screen then belongs to a conversation nobody is looking at.
		 *
		 * AND THE MINT'S BRIDGE ID KEEPS IT TOO (UX round 1, U1): the draft pane's
		 * stream id moves `undefined` -> the minted warm id mid-press, the
		 * conversation does not change, and this reset used to wipe the row the
		 * press had just painted. The rule and the measurement are on
		 * `streamChangeKeepsTranscript`.
		 */
		const sameSession = streamChangeKeepsTranscript(
			transcriptSession.current,
			sessionId,
			isSession,
		);
		transcriptSession.current = sessionId;
		// The cached rows when this window has shown the conversation before, so a
		// switch paints in its first frame; empty otherwise. The paint is NOT
		// written from here — the panel is keyed by identity, so a switch unmounts
		// this hook, and the cleanup effect below is the only moment that always
		// happens.
		const seed = sessionId ? readPaint(sessionId) : null;
		/*
		 * THE SEED IS A PAINT LIKE ANY OTHER (#876). `paintedIds` is "the index
		 * the LAST flush left behind", and for a conversation this window has shown
		 * before, the cached rows ARE what it left behind; nothing else assigns the
		 * ref before the first batch's own flush, so without this it read EMPTY on
		 * a seeded mount, and every question of the form "does an arriving frame
		 * connect to what this pane holds" — the reconcile gate, the walk's held
		 * seam — was answered for a pane holding nothing. That is the state #876
		 * was reported in: a window whose own cache said "you have five hours of
		 * this conversation" got a reconnect that read back past none of them.
		 */
		paintedIds.current = sameSession
			? viewRef.current.transcript.index
			: (seed?.transcript ?? EMPTY_TRANSCRIPT).index;
		commitView((current) => ({
			...current,
			frontend: null,
			/*
			 * The held readings follow the TRANSCRIPT's rule, not `frontend`'s, and
			 * the two differ here on purpose. `frontend` is always dropped - a new
			 * subscription owes its own snapshot whatever the id - but a held
			 * reading is only ever the previous state of THIS conversation, so it
			 * survives a remount that keeps the conversation (the New-chat identity
			 * flip, which mounts this hook with the id it keeps) and goes with a
			 * genuine session change, where the readings on screen describe a
			 * conversation nobody is looking at any more.
			 */
			heldFrontend: sameSession ? current.heldFrontend : null,
			// A different session's unconfirmed paint describes the model of a
			// conversation that is no longer on screen.
			pendingModel: null,
			history: null,
			terminal: null,
			/*
			 * The completion counter shares the transcript's lifetime, so it is kept
			 * under the same rule. It is a monotonic count the code-memory panel
			 * compares against its own last reading, and resetting it on a remount
			 * that deliberately keeps the transcript would describe a turn this
			 * viewer never saw end. A genuine session change still restarts it — the
			 * previous conversation's endings say nothing about the new one.
			 */
			turnsCompleted: sameSession ? current.turnsCompleted : 0,
			// All three follow the SAME rule: keep this conversation's own state, and
			// reset it only when the conversation really changed. `stale` and `missing`
			// travel with the transcript they describe - a kept transcript with a
			// reset "this paint is old" flag would claim rows the owner never sent.
			transcript: sameSession
				? current.transcript
				: (seed?.transcript ?? EMPTY_TRANSCRIPT),
			stale: sameSession ? current.stale : seed !== null,
			missing: sameSession ? current.missing : false,
			status: "connecting",
			// A different session's children are different children, and a pulse
			// carried across is a counter no reader can match to a job.
			subagentPulses: {},
			// The previous session's pending label reads name its own calls.
			/*
			 * The rows the cached paint was still waiting on, for the same reason the
			 * initial state above seeds them: this mount paints rows in its FIRST frame,
			 * and a row whose arguments are one read away must not paint its result line
			 * in the meantime.
			 */
			labelPending: seed?.owedLabels ?? NO_LABELS_PENDING,
			labelMarked: seed?.markLabels ?? NO_LABELS_MARKED,
			labelHoldLate: false,
			// And this session's history is unknown again: the previous session's
			// page proves nothing about this one, so the composer must not state
			// that this conversation is empty until its own page lands.
			hydrated: false,
			// Belt to the early return's braces: whatever a superseded page in
			// flight does, a freshly opened session is not loading older rows.
			loadingOlder: false,
			// And no read of ITS history is out: a superseded walk's paint must not
			// follow the reader to the next conversation.
			historyReadPending: false,
			// A failure belongs to the journal it happened on; a new session has not
			// failed to load anything yet.
			olderFailed: false,
		}));
		// The retry bookkeeping is per SESSION: a previous session's outstanding call
		// ids would each buy a history page for the new one, sized by the old gap,
		// that can only be a no-op. `reconnectRef`, `receiptRef` and `paintedIds` are
		// cleared here for the same reason.
		/*
		 * The conversation's own bookkeeping, NOT a fresh one: `labelGapFor` returns
		 * what an earlier visit to this conversation already learned and paid for.
		 * Resetting here is what made a switch back re-hold rows the reader had
		 * already seen (round 1, QA Q1).
		 */
		labelGapRef.current = labelGapFor(sessionId);
		/*
		 * `isSession` rides the deps because the rule reads it: the property is
		 * "is this change a change of conversation", and `undefined` -> the mint's
		 * bridge id is not one (UX round 1, U1).
		 */
	}, [sessionId, isSession]);

	/*
	 * Cache this conversation's paint on the way out.
	 *
	 * The panel is keyed by identity, so a switch to another conversation UNMOUNTS
	 * this hook rather than re-running it with a new id — which makes this cleanup
	 * the only moment that always happens. It is also the right moment for the
	 * reason the cache exists: the rows the ref holds here are exactly the rows
	 * that were last on screen.
	 *
	 * Read from the ref rather than from `view`: a cleanup closes over the render
	 * that created it, and for an unmount that render is not the last one.
	 */
	useEffect(() => {
		if (!sessionId) return;
		return () => {
			const painted = viewRef.current.transcript;
			// Nothing to cache for a conversation this window never painted: an
			// empty transcript would be a cache hit that correctly paints nothing.
			if (painted.records.length > 0)
				writePaint(sessionId, {
					transcript: painted,
					/*
					 * What this paint was still waiting on, carried beside the rows: the
					 * next mount paints them in its first frame, and the rows alone cannot
					 * tell an outstanding read from a spent one.
					 *
					 * INTERSECTED WITH THE WALK'S OWN REQUEST, not just "held" (review
					 * round 1, m1). A held id whose budget is spent is one NO read will
					 * name - the stand-in is the true answer for it - and carrying it would
					 * make the next mount hold a row on a justification that is false.
					 */
					owedLabels: new Set(
						[...viewRef.current.labelPending].filter((id) =>
							labelOwed(
								labelGapRef.current,
								viewRef.current.transcript.argsByCall,
								id,
								turnRunning(viewRef.current),
							),
						),
					),
					/*
					 * AND THE MARKED SET TRAVELS WHOLE (round 4). These ids are not held - a refusal
					 * ended their hold - so `owedLabels` above cannot carry them, and the next mount
					 * would paint the call's OUTPUT on its first frame for a conversation whose read
					 * path was refusing. No intersection with `labelOwed` here, deliberately: what
					 * the mark needs is not "is a read owed" but "has no read named this yet", and
					 * an id whose read answered would have left the set in the commit that named it.
					 */
					markLabels: new Set(viewRef.current.labelMarked),
				});
			/*
			 * AND THIS PANE'S OUTSTANDING READS GO WITH IT (agent review round 3, M2's
			 * second half). `inFlight` is term (a) of the rule, so an id left in it
			 * outlives the pane that put it there: the walk that owned it is abandoned
			 * at this instant, and a switch back would then hold that row on a read
			 * nobody can still name - to the backstop, rather than to any read.
			 *
			 * AFTER THE WRITE, deliberately. The cache's question is what THIS paint was
			 * waiting on, and a read that was genuinely out when the reader left is
			 * exactly what `owedLabels` is for: measured on the hanging-read control,
			 * the real tear-down writes owed 68 and the cached mount paints 0
			 * stand-ins. Dropping first would erase the very fact the field carries and
			 * put the 68 stand-ins back on the first frame - which is why this runs
			 * here rather than in the stream effect's cleanup, where React would reach
			 * it first.
			 *
			 * DROPPING THIS MOUNT'S OWN IDS rather than `clear()`: a retry the walk
			 * handed to its own timer can be out for the same conversation, and wiping
			 * the whole set would take that read's justification with it. The successor
			 * mount makes its own entries after this runs.
			 */
			for (const id of inFlightOwned.current)
				labelGapRef.current.inFlight.delete(id);
			inFlightOwned.current.clear();
		};
	}, [sessionId]);

	/*
	 * The first-paint hold's wall-clock backstop, and the ONE place its deadline is
	 * armed.
	 *
	 * WHY ONE PLACE. The hold does not arrive from a single source: the seed's
	 * flush registers its targets in the commit that paints their rows, and a
	 * cached paint arrives holding its own rows in the very FIRST frame
	 * (`paintSeed`), before any flush has run. A cap armed only by the flush would
	 * leave a cache-held row objectless for as long as the owner stayed quiet. So
	 * the deadline follows the SET rather than its writers: armed when the set
	 * becomes non-empty, cleared when it empties, and fired unconditionally, because
	 * a request that never answers is exactly the case a stricter test cannot
	 * recognise.
	 *
	 * WHAT IT IS SET FROM is the transport's own bound for this op rather than a
	 * comfort number - see `LABEL_HOLD_MAX_MS`, which is where design round 1's 2 s,
	 * QA's 3 s and the 6 s page it still painted through are accounted for.
	 *
	 * A deadline already running is NOT restarted when a row is added to the set.
	 * Restarting on every change would let a busy stream - a turn settling calls
	 * every second, for hours - hold the earliest rows blank far past any bound a
	 * reader could be shown as one. A row added late therefore shares the batch's
	 * own deadline, which is the oldest arming still in the set's lifetime.
	 */
	const labelHoldTimerRef = useRef(0);
	useEffect(() => {
		/*
		 * BOTH SETS ARE ON THIS DEADLINE (round 4). A marked id has no hold left to end,
		 * so `fire` below is the only thing that can ever resolve it to the stand-in, and
		 * the marked set is therefore armed by the same rule the held one follows: the
		 * deadline follows the sets, armed when either becomes non-empty, cleared when
		 * both are empty, and a batch already running is not restarted by an arrival.
		 */
		if (view.labelPending.size === 0 && view.labelMarked.size === 0) {
			if (labelHoldTimerRef.current) {
				window.clearTimeout(labelHoldTimerRef.current);
				labelHoldTimerRef.current = 0;
			}
			return;
		}
		if (labelHoldTimerRef.current) return;
		/*
		 * The fire, and its ONE REFUSAL (agent review round 3, U4/Q-4).
		 *
		 * A read that is still out for a held id is not a read that has stopped
		 * answering, and the batch deadline cannot tell the two apart - it was armed
		 * once, when the set became non-empty. Firing on the clock alone therefore
		 * painted the stand-in WHILE A READ WAS IN FLIGHT: measured on the abort-then-
		 * retry arm, 26 rows showed the call's OUTPUT in the command column for 4.97 s
		 * from 25 124 ms while the read issued at 20 005 ms was still running, and on
		 * the wedge the hold ended at 25 159 ms, 5.2 s into attempt two's own 20 s
		 * window. So the deadline defers to the read: while anything held is in flight
		 * it RE-ARMS rather than fires, and the bound is per ATTEMPT rather than per
		 * batch.
		 *
		 * WHAT THAT COSTS, measured rather than claimed (see the constant's own
		 * comment for the number and the route): a wedged owner holds longer than one
		 * window, because the timer now waits for the attempts to run out instead of
		 * cutting in front of them. That is the trade this rule makes everywhere else -
		 * blank over a wrong fact - and it is bounded, because the transport's deadline
		 * ends each attempt and `LABEL_GAP_ATTEMPTS` bounds how many there are.
		 *
		 * IT CANNOT LOOP FOREVER: `inFlight` only ever holds ids whose walk is out, and
		 * a walk is out for at most `LABEL_GAP_ATTEMPTS` transport windows. The moment
		 * the last one ends, the next fire finds nothing in flight and releases.
		 */
		const fire = () => {
			labelHoldTimerRef.current = 0;
			const held = viewRef.current.labelPending;
			const marked = viewRef.current.labelMarked;
			if (held.size === 0 && marked.size === 0) return;
			const gap = labelGapRef.current;
			/*
			 * THE DEFERRAL COVERS BOTH SETS. A marked id whose retry is out is a read that
			 * can still name the call - the same fact this refusal exists for on a held one
			 * (U4) - and a marked row that fired early would put the call's OUTPUT in the
			 * command column while that read was still running, which is the 4.97 s the
			 * round measured.
			 */
			for (const id of held) {
				if (gap.inFlight.has(id)) {
					labelHoldTimerRef.current = window.setTimeout(
						fire,
						LABEL_HOLD_MAX_MS,
					);
					return;
				}
			}
			for (const id of marked) {
				if (gap.inFlight.has(id)) {
					labelHoldTimerRef.current = window.setTimeout(
						fire,
						LABEL_HOLD_MAX_MS,
					);
					return;
				}
			}
			commitView((state) =>
				state.labelPending.size === 0 && state.labelMarked.size === 0
					? state
					: {
							...state,
							labelPending: NO_LABELS_PENDING,
							labelMarked: NO_LABELS_MARKED,
						},
			);
		};
		labelHoldTimerRef.current = window.setTimeout(fire, LABEL_HOLD_MAX_MS);
	}, [commitView, view.labelPending, view.labelMarked]);

	/**
	 * The late-hold mark's arm, and the ONLY writer of `labelHoldLate`.
	 *
	 * WHY IT EXISTS (design round 3, D7 - BLOCKER). The round-2 commit threaded the
	 * flag view -> pane -> row and had `ToolLedgerRow` render the mark off it, but
	 * nothing ever set it true: `git grep labelHoldLate` found the type declaration,
	 * two `false` initialisers and the consumers, and `LABEL_HOLD_MARK_MS` was named
	 * only in comments. So `summaryHold` was a constant false, the mark's
	 * `data-label-hold` and its `title` suppression were unreachable, and the app
	 * shipped a described cue no reader could see - 5 395 head pane frames and 0
	 * marks, and the built chunk writing `labelHoldLate:!1` twice and `:!0` never.
	 *
	 * ARMED PER HOLD BATCH, exactly as the view type's own doc says a batch is
	 * defined: the window starts when the held set becomes non-empty and is NOT
	 * restarted when another row joins it - the same rule the backstop follows, and
	 * for the same reason. A row added late joins the batch that is already late and
	 * is marked with it rather than given a fresh two seconds of blank, so a busy
	 * stream cannot hold a reader on blank cells indefinitely by adding to the set.
	 *
	 * CLEARED when the held set empties, which covers both exits the mark has: the
	 * rows resolve (the command arrives, or the terminal release paints the
	 * stand-in) and the release empties the set. A PARTIAL release leaves it
	 * standing, and that is the intent rather than an oversight: the one flag is
	 * read per row through `labelPending === true && labelHoldLate === true`, so the
	 * rows that are still owed keep their mark and the rows that resolved drop it in
	 * the same commit.
	 *
	 * A FRESH MOUNT STARTS BLANK. The flag is seeded `false` on both seeds and this
	 * effect arms its own window from that mount's own set, so a cached switch-back
	 * is not marked on its first frame: the design round's decision that the first
	 * paint is untouched and the mark is a late state only holds across the mount.
	 *
	 * WHAT IT IS NOT: a bound. It cannot release anything - it writes one boolean and
	 * never touches `labelPending` - so arming it cannot make a hold shorter, and a
	 * mark that stands past the point a read answers is resolved by the same release
	 * the blank was.
	 */
	const labelMarkTimerRef = useRef(0);
	useEffect(() => {
		if (view.labelPending.size === 0) {
			if (labelMarkTimerRef.current) {
				window.clearTimeout(labelMarkTimerRef.current);
				labelMarkTimerRef.current = 0;
			}
			// The clear is conditional so an already-clean view keeps its identity,
			// which is the same reason `NO_LABELS_PENDING` is shared.
			commitView((state) =>
				state.labelHoldLate ? { ...state, labelHoldLate: false } : state,
			);
			return;
		}
		if (view.labelHoldLate) return;
		if (labelMarkTimerRef.current) return;
		labelMarkTimerRef.current = window.setTimeout(() => {
			labelMarkTimerRef.current = 0;
			commitView((state) =>
				state.labelPending.size === 0 || state.labelHoldLate
					? state
					: { ...state, labelHoldLate: true },
			);
		}, LABEL_HOLD_MARK_MS);
	}, [commitView, view.labelPending, view.labelHoldLate]);
	// The conversation currently on screen, read at resolution time rather than
	// closed over, so an in-flight page can tell whether it is still wanted.
	const sessionRef = useRef(sessionId);
	sessionRef.current = sessionId;
	/*
	 * A per-VIEW generation of the conversation on screen: bumped every time
	 * `sessionId` changes, so leaving A and coming back to A is a NEW view.
	 *
	 * WHY THE BARE ID IS NOT ENOUGH (loader-continuity round 1, R1-3). A page still
	 * out for A when the reader goes A -> B -> A compared equal to the returning
	 * view by id, so it was treated as current: it landed on A's freshly reset
	 * transcript (`oldestId` null), where the reducer's first-page rule seeded the
	 * cursor from that deep page, and the rows between it and the tail were never
	 * fetched - the dead-zone class this loader exists to close, by a narrow race.
	 * Comparing the epoch makes "the same conversation" mean "the same visit to it".
	 * Written in render, like `sessionRef`, so it is already correct in the first
	 * frame of the new view and idempotent under a repeated render.
	 */
	const epochRef = useRef({ id: sessionId, epoch: 0 });
	if (epochRef.current.id !== sessionId)
		epochRef.current = { id: sessionId, epoch: epochRef.current.epoch + 1 };

	/*
	 * The older-page loader. One per mounted hook, and NOT keyed to a session: it
	 * is single-flight PER conversation (`load(key, ...)`), so a page still out for
	 * the conversation the reader just left neither blocks the new one nor is
	 * applied to it (it resolves `stale`).
	 *
	 * There is deliberately no cursor kept here. The store's own `oldestId` is the
	 * only statement of where history stops (`applyHistoryPage` advances it for
	 * every continuation, even a page that adds no record); the ref that used to
	 * shadow it after a `cursor_missing` existed only because the store could not
	 * advance, and a second authority is how the reader came to ask for one page
	 * for ever.
	 */
	const olderLoader = useRef<ReturnType<typeof createOlderLoader> | null>(null);
	if (olderLoader.current === null) olderLoader.current = createOlderLoader();
	const loadOlderDetailed = useCallback(async (): Promise<LoadOlderOutcome> => {
		const loader = olderLoader.current;
		if (!sessionId || !loader) return { kind: "nothing-to-load" };
		// The session this request is being made for. A page that resolves after
		// the reader has switched conversations describes a transcript that is no
		// longer on screen, and `applyHistoryPage` would happily splice it into the
		// new one (clause H); the loader checks `isCurrent` before it applies.
		const requested = sessionId;
		const epoch = epochRef.current.epoch;
		const stillHere = () => epochRef.current.epoch === epoch;
		// Single-flight is per VIEW for the same reason `isCurrent` is: a page left
		// out for a previous visit to this conversation resolves `stale`, and handing
		// that promise to the returning reader would answer their ask with a dropped
		// page instead of one for the transcript they are looking at.
		const outcome = await loader.load(`${requested}#${epoch}`, {
			getTranscript: () => viewRef.current.transcript,
			readPage: (beforeId) =>
				desktopResult<DesktopHistoryPage>({
					op: "sessions.history",
					sessionId: requested,
					beforeId,
					limit: 100,
				}),
			isCurrent: stillHere,
			commit: (update) =>
				commitView((current) => {
					const transcript = update(current.transcript);
					return transcript === current.transcript
						? current
						: { ...current, transcript };
				}).transcript,
			/*
			 * The in-flight flag is written for the conversation that OWNS the page,
			 * so a switch mid-request cannot leave the OLD session's spinner disabled
			 * ("Loading earlier messages" with no request out and no way to retry).
			 */
			setLoading: (loading) => {
				if (!stillHere()) return;
				commitView((current) =>
					current.loadingOlder === loading
						? current
						: { ...current, loadingOlder: loading },
				);
			},
		});
		/*
		 * The failed row's single writer (R2): every caller lands here, so a failure
		 * from the align fetch, the jump walk or the mentioned-files scan reaches the
		 * slot, and any applied page clears it. `stale` and `nothing-to-load` touch
		 * nothing - they say nothing about the health of the journal on screen.
		 */
		if (stillHere()) {
			if (outcome.kind === "failed")
				commitView((current) =>
					current.olderFailed ? current : { ...current, olderFailed: true },
				);
			else if (outcome.kind === "applied")
				commitView((current) =>
					current.olderFailed ? { ...current, olderFailed: false } : current,
				);
		}
		return outcome;
	}, [commitView, sessionId]);
	const loadOlder = useCallback(
		async (): Promise<boolean> =>
			(await loadOlderDetailed()).kind === "applied",
		[loadOlderDetailed],
	);

	const refreshingTailRef = useRef(false);
	/*
	 * The bounded re-read the direct `/compact` path schedules; the handle's own
	 * note carries the finding it closes. One page, no cursor — the tail, where a
	 * pass's outcome lands — applied through the same `applyHistoryPage` the
	 * stream's reconciliation uses.
	 *
	 * The in-flight guard is `loadOlder`'s, for the same reason: two overlapping
	 * schedules would apply the same page twice, and a page resolving after the
	 * reader moved on describes a transcript that is no longer on screen.
	 */
	const refreshTail = useCallback(
		async (since: number, epoch: number): Promise<boolean> => {
			if (!sessionId || refreshingTailRef.current) return false;
			const requested = sessionId;
			refreshingTailRef.current = true;
			try {
				const page = await desktopResult<DesktopHistoryPage>({
					op: "sessions.history",
					sessionId: requested,
					limit: 100,
				});
				if (sessionRef.current !== requested) return false;
				/*
				 * The cleared-view guard, and it is the only reason this compares
				 * epochs: a `/clear` is view-only, so nothing else would notice that the
				 * view this read was scheduled for is gone — and the page it is holding
				 * is the durable tail, i.e. exactly the rows `/clear` removed.
				 */
				if (viewRef.current.transcript.viewEpoch !== epoch) return false;
				commitView((current) => ({
					...current,
					/*
					 * `keepPaging`: this is a TAIL read, so its `has_more` describes the
					 * session rather than this reader's position — letting it through put
					 * "load earlier" back on a fully-loaded transcript and resumed the
					 * mentioned-files scan's paging (R3-5).
					 */
					transcript: applyHistoryPage(current.transcript, page, {
						keepPaging: true,
					}),
				}));
				/*
				 * Scoped to THIS pass: an outcome written at or after the receipt that
				 * scheduled the read. An older pass's row — any session's whose last 100
				 * entries contain one — reports `false`, which is what keeps the second
				 * scheduled read a real backstop.
				 */
				return tailCarriesOutcome(page.entries, since);
			} catch {
				// The rows already painted are still correct; the next scheduled read is
				// the retry, and there is no view state to unwind.
				return false;
			} finally {
				refreshingTailRef.current = false;
			}
		},
		[commitView, sessionId],
	);

	// Registered for as long as this pane is on screen, so the store's echo
	// reaches the transcript the user is looking at. Registration is keyed by
	// the PANE'S OWN IDENTITY rather than by session: a fresh draft has no
	// session id yet, and the row its press paints is addressed by the draft key
	// - while two panels for one session would be the same conversation, and the
	// last mounted one is the one being looked at.
	useEffect(() => {
		if (!identity) return;
		const apply = (mutate: (state: TranscriptState) => TranscriptState) => {
			commitView((current) => {
				const transcript = mutate(current.transcript);
				return transcript === current.transcript
					? current
					: { ...current, transcript };
			});
		};
		/*
		 * The same function the delivery test drives, so the registration and
		 * drain the app performs are the ones under test. Draining here is what
		 * makes the New-chat path work: a paint fired while no transcript was
		 * mounted is retained, and this is the first moment a transcript can
		 * receive it. At the press itself the DRAFT pane's own registration is the
		 * target - one identity earlier than the session - so the row paints
		 * synchronously with the press and the composer clears with it.
		 */
		return __registerEchoTarget(identity, apply);
	}, [commitView, identity]);

	/*
	 * THE OWNER'S ROW ENDS THE CLAIM. When a non-local user record for a
	 * retained id is in the transcript, the message is on the owner's side and
	 * the optimistic entry has nothing left to say - `resolveObservedPendingSends`
	 * drops it, so the pane's collapse, the band and the wait-line latch all stop
	 * reading a claim whose row is now durable. Walks the ENTRIES (at most four),
	 * not the records, on each committed transcript change.
	 */
	useEffect(() => {
		if (!identity) return;
		resolveObservedPendingSends(identity, view.transcript);
	}, [identity, view.transcript]);

	const clearView = useCallback(() => {
		commitView((current) => ({
			...current,
			transcript: clearTranscript(current.transcript),
			// The failure described rows the reader has just cleared.
			olderFailed: false,
			/*
			 * The held copy goes with it, and costs nothing visible: `/clear` is
			 * VIEW-only, so `frontend` is still painted and the readings still come
			 * from it. What this buys is the invariant - `heldFrontend` is only ever
			 * the fallback for a pane that was painting an authoritative frontend a
			 * moment ago, and a cleared view is the one state that deliberately has
			 * nothing behind it. If a gap follows, the hold is re-taken from the
			 * still-live `frontend` by the gap arm itself.
			 */
			heldFrontend: null,
		}));
	}, [commitView]);

	const retry = useCallback(() => {
		retryRef.current?.();
	}, []);

	const rehydrate = useCallback(() => {
		hydrateRef.current?.();
	}, []);

	const addNote = useCallback(
		(text: string, level: "info" | "warning" | "error" = "info") => {
			commitView((current) => ({
				...current,
				transcript: appendLocalNote(current.transcript, text, level),
			}));
		},
		[commitView],
	);

	const paintPendingModel = useCallback(
		(model: CanonicalModel) => {
			commitView((current) => ({ ...current, pendingModel: model }));
		},
		[commitView],
	);

	const clearPendingModel = useCallback(() => {
		commitView((current) =>
			current.pendingModel === null
				? current
				: { ...current, pendingModel: null },
		);
	}, [commitView]);

	/*
	 * Reconcile the paint against the authoritative frames.
	 *
	 * An effect over the published frontend rather than a clause inside the frame
	 * reducer: the reducer is a pure fold of the stream with one job, and this is a
	 * comparison of two fields with two different lifetimes. It compares when
	 * there is something new to compare — a new owner snapshot, or a paint the
	 * user just made — and clears only when the owner's own spec names the painted
	 * model: a frame that merely arrives is not evidence the switch landed.
	 *
	 * The dependency array is what the comment above used to claim without having
	 * it: the effect ran after EVERY render with no array at all, which is extra
	 * comparisons rather than a bug, but left the file describing a trigger it did
	 * not have (reviewer round 1, minor 3). `view.frontend` and `view.pendingModel`
	 * are both read here and are the only two things that can change the answer, so
	 * the array is exact — and with it in place the `useExhaustiveDependencies`
	 * suppression that used to sit here had nothing left to suppress (`biome`
	 * reported it as `suppressions/unused`), so it is gone rather than kept as
	 * decoration.
	 */
	useEffect(() => {
		const pending = view.pendingModel;
		if (!pending) return;
		const painted = modelSelector(pending);
		if (!painted) return;
		const frontend = view.frontend;
		if (
			modelSelector(frontend?.selected_model) === painted ||
			modelSelector(frontend?.effective_model) === painted
		) {
			commitView((current) => ({ ...current, pendingModel: null }));
		}
	}, [commitView, view.frontend, view.pendingModel]);

	// The bounded backstop for a confirmation that never arrives; see the constant.
	useEffect(() => {
		if (!view.pendingModel) return;
		const timer = window.setTimeout(
			() => commitView((current) => ({ ...current, pendingModel: null })),
			PENDING_MODEL_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [commitView, view.pendingModel]);

	return useMemo(
		() => ({
			...view,
			/*
			 * Composed here rather than at the consumer, and not stored in the view
			 * state: it is derived from the hook's own arguments, which the state
			 * does not observe, so a stored copy would go stale the moment the panel
			 * changed session. See `CanonicalSessionHandle.awaitingHydration` for why
			 * the composer needs it and why `hydrated` is left alone.
			 */
			awaitingHydration:
				enabled && Boolean(sessionId) && isSession && !view.hydrated,
			loadOlder,
			loadOlderDetailed,
			refreshTail,
			clearView,
			addNote,
			paintPendingModel,
			clearPendingModel,
			retry,
			rehydrate,
		}),
		[
			view,
			enabled,
			sessionId,
			isSession,
			loadOlder,
			loadOlderDetailed,
			refreshTail,
			clearView,
			addNote,
			paintPendingModel,
			clearPendingModel,
			retry,
			rehydrate,
		],
	);
}
