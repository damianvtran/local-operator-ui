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
 *   resolves the "Waiting to start" latch. The receipt cursor is only for
 *   dedupe/reconnect, never for deciding what is newer paint state.
 * - A `gap` frame (or any replay-with-gap open) invalidates painted state; the
 *   consumer must re-read via the snapshot that follows rather than patching.
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
	RECONCILE_TAIL_MAX_ENTRIES,
	type TranscriptImage,
	type TranscriptState,
	appendLocalNote,
	appendPendingUser,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	clearTranscript,
	dropLiveRecords,
	labelGapCandidates,
	reconcileLimit,
	removeRecord,
	seedCallsMissingLabels,
} from "@features/chat/canonical/transcript-reducer";
import { tailCarriesOutcome } from "@features/chat/components/compact-receipt";
import { modelSelector } from "@features/chat/session-status/session-model";
import {
	desktopResult,
	subscribeDesktopStream,
} from "@shared/api/local-operator/desktop-api";
import { dropPaint, readPaint, writePaint } from "@shared/store/paint-cache";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	acceptFrontendReplace,
	mergeCompletionAttention,
} from "../../../../shared/desktop-session-contract";
import type {
	CanonicalFrontendState,
	CanonicalModel,
	DesktopHistoryPage,
	DesktopSessionFrame,
} from "../../../../shared/desktop-session-contract";
import {
	HISTORY_UNREADABLE,
	type SessionFailureNotice,
	streamFailureNotice,
} from "../../../../shared/desktop-stream-notice";
/* The child-pulse rule (§ 5.3): the event set, the id rule and the bump. */
import { applySubagentPulse, seedSubagentPulses } from "./subagent-pulse";

export type CanonicalSessionStatus =
	| "connecting"
	| "live"
	| "reconnecting"
	| "unavailable";

export type CanonicalSessionView = {
	status: CanonicalSessionStatus;
	frontend: CanonicalFrontendState | null;
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
};

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
	 * Both terms are this hook's own inputs, which is why the rule is here and
	 * said once:
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
const RECONCILE_WALK_MAX_ROWS = RECONCILE_TAIL_MAX_ENTRIES;

/**
 * Mounted transcripts, by session, that an optimistic echo can reach.
 *
 * The seam exists because the STORE paints the echo (it is the only place that
 * knows the session id and the admission request id at the same moment, and it
 * must do so before its first `await`), while this hook owns `setView`. A
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
 * Echoes for a session whose transcript had not registered yet, replayed the
 * moment one does.
 *
 * WHY THIS QUEUE EXISTS, AND WHY DELIVERY MUST NOT DEPEND ON MOUNT ORDER. On
 * the New-chat path the session id does not exist until `createSession`
 * returns, and the panel keyed on it has not mounted — let alone flushed the
 * passive effect that registers it — at the moment the store paints the echo,
 * because the store patches the id and fires the echo in ONE synchronous
 * block. An unqueued `echoTargets.get(id)?.(...)` therefore dropped the echo
 * silently on exactly the path the echo exists for: review round 1 measured
 * the draft send at 0 landed / 1 dropped / 0 painted, while the
 * existing-session send was 1/0/1.
 *
 * That silent drop was worse than the bug it replaced. With the composer now
 * clearing on the echo's own paint, a dropped echo means the box empties and
 * the transcript stays blank for the whole engage — where previously the text
 * at least stayed visible while the user waited.
 *
 * A queue rather than a second key: keying the registry on the panel identity
 * would make delivery depend on the renderer and the store agreeing about what
 * names a conversation before admission, which is the disagreement that caused
 * this. Buffering makes the echo addressable by session id BEFORE any panel for
 * that session exists, so the store keeps one vocabulary and the mount race
 * stops being load-bearing.
 */
const pendingEchoes = new Map<string, PendingEcho[]>();

/**
 * One buffered echo, and whoever asked to be told that it landed.
 *
 * `onPainted` is how the composer learns that the text it just handed to the
 * store is now IN a transcript. That moment is the only one at which taking the
 * text out of the box costs the user nothing, which is why the callback fires
 * AT THE APPLICATION SITE - synchronously with the mutation when a transcript is
 * mounted, and from the drain when one is not - and never on a timer. Firing it
 * anywhere else puts the composer and the transcript in different frames, which
 * is the defect UX round 1 measured on the New-chat path: the box emptied at
 * Enter and the echo could not exist until `sessions.create` returned
 * (p50 142 ms / max 409 ms at load 433-445), so for the whole create hop the
 * user was looking at an empty box and an empty transcript.
 *
 * The drain's call reaches whichever composer registered, and on the New-chat
 * path that is NOT the one which asked: the identity flip unmounts the draft
 * composer before the panel exists to receive the echo, so the callback lands on
 * a component that is gone while the visible panel paints the echo in its first
 * state. A caller therefore reads the callback as "the echo is in a transcript
 * now", never as "your box was cleared" (round 7, F1).
 */
type PendingEcho = {
	mutate: (state: TranscriptState) => TranscriptState;
	onPainted?: () => void;
};

/*
 * What the buffer may retain, and WHY THE LIMITS ARE WHAT THEY ARE.
 *
 * This is a retention bound, not housekeeping. A queued mutation closes over
 * the user's message text AND its images as base64 (`TranscriptImage`), so an
 * echo for a session that never mounts is that content held in renderer memory
 * for the lifetime of the window - after a failed send the user believes they
 * abandoned, and with no UI anywhere showing it. The drain is destructive, so
 * anything that MOUNTS costs nothing; these limits exist purely for the
 * sessions that never do.
 *
 * Per session: a send admits at most one echo plus at most one retraction for
 * the same request id, so 4 covers the legitimate case (a retry that re-echoes
 * before the first mount) with room to spare. Past that the OLDEST goes, since
 * the newest paint is the one the user is waiting to see.
 *
 * Across sessions: a user can stage drafts faster than panels mount, so the map
 * itself is capped and evicts by insertion order - `Map` preserves it, and the
 * oldest un-mounted session is the one least likely to ever be looked at.
 *
 * Both bounds only ever drop an OPTIMISTIC row. The durable message is the
 * backend's, and it paints from the owner's own `message_start` when the panel
 * mounts, so the worst case of an eviction is the pre-PR behaviour: the user
 * waits for the real row instead of seeing an echo.
 */
const MAX_PENDING_ECHOES_PER_SESSION = 4;
const MAX_PENDING_ECHO_SESSIONS = 16;

/**
 * Apply now if a transcript is listening, otherwise hold it for the one that
 * is about to mount.
 */
function deliverEcho(
	sessionId: string,
	mutate: (state: TranscriptState) => TranscriptState,
	onPainted?: () => void,
): void {
	const target = echoTargets.get(sessionId);
	if (target) {
		target(mutate);
		// AFTER the mutation, in the same synchronous block, so the two state
		// updates a composer cares about (the row appearing, the box emptying)
		// are batched into one commit. Cheaper to reason about than to schedule.
		onPainted?.();
		return;
	}
	const queued = pendingEchoes.get(sessionId);
	if (queued) {
		queued.push({ mutate, onPainted });
		if (queued.length > MAX_PENDING_ECHOES_PER_SESSION) queued.shift();
		return;
	}
	if (pendingEchoes.size >= MAX_PENDING_ECHO_SESSIONS) {
		// Insertion order: the least recently buffered session is evicted whole.
		const oldest = pendingEchoes.keys().next();
		if (!oldest.done) pendingEchoes.delete(oldest.value);
	}
	pendingEchoes.set(sessionId, [{ mutate, onPainted }]);
}

/**
 * Drop anything buffered for a session that will not be coming back.
 *
 * Called when a draft is abandoned or its send fails terminally, so the text
 * and images do not sit in memory waiting for a panel that has no reason to
 * mount. Safe to call for a session with nothing buffered.
 */
export function discardPendingEchoes(sessionId: string): void {
	pendingEchoes.delete(sessionId);
}

/**
 * Register a transcript as the echo target for a session, draining whatever
 * was painted before it existed, and return the matching unregister.
 *
 * Extracted from the effect below so the delivery rule is exercised against the
 * REAL registry rather than a recorder standing in for it. That distinction is
 * not academic: review round 1's blocker — the draft-path echo being dropped
 * because nothing was listening yet — was invisible to every existing test
 * precisely because they aliased this seam to a stub that always recorded.
 */
export function __registerEchoTarget(
	sessionId: string,
	apply: (mutate: (state: TranscriptState) => TranscriptState) => void,
): () => void {
	echoTargets.set(sessionId, apply);
	/*
	 * Taken and deleted BEFORE applying, so a mutation that throws cannot be
	 * replayed onto the next mount and a remount cannot paint the same echo
	 * twice. Re-painting would be harmless alone — `appendPendingUser` no-ops
	 * for an id already present — but a retraction replayed after its own paint
	 * had coalesced with the owner's row would delete a durable message.
	 */
	const queued = pendingEchoes.get(sessionId);
	if (queued) {
		pendingEchoes.delete(sessionId);
		for (const { mutate, onPainted } of queued) {
			apply(mutate);
			onPainted?.();
		}
	}
	return () => {
		// Only if still ours: a remount for the same session registers before the
		// old effect cleans up, and an unconditional delete would drop the live
		// registration.
		if (echoTargets.get(sessionId) === apply) echoTargets.delete(sessionId);
	};
}

/**
 * Paint the user's message optimistically, keyed by the admission request id
 * so the owner's durable row coalesces with it instead of duplicating it.
 */
export function echoPendingUser(
	sessionId: string,
	id: string,
	text: string,
	images: TranscriptImage[],
	onPainted?: () => void,
): void {
	deliverEcho(
		sessionId,
		(state) => appendPendingUser(state, id, text, images),
		onPainted,
	);
}

/**
 * The transcript a panel starts from, with anything already buffered for its
 * session applied - so the FIRST frame it paints can hold the echo.
 *
 * Why this exists rather than letting the drain do it: on the New-chat path the
 * panel that receives the echo is a fresh mount (the identity flips from the
 * draft key to the session id, which is what makes it remount), and its echo
 * arrives through a PASSIVE effect - after the commit that painted its first
 * frames. Those frames therefore held an empty transcript and a `connecting`
 * status while the user's message was already in flight (UX round 1, U3: the
 * echo "can only reach the new panel in a mount effect, so that panel's first
 * frames cannot hold it"). Seeding the initial state closes that gap at its
 * source: the buffered echo is in the state React paints first, and the drain
 * that follows re-applies it to no effect (`appendPendingUser` is a no-op for an
 * id already present, and a retraction is idempotent).
 *
 * A PEEK, deliberately, not a take. Mutating the buffer from an initializer
 * would consume an echo in a render React is free to discard, and a render-phase
 * side effect on a shared map is exactly the kind of ownership this file keeps in
 * one place. The drain stays the only consumer.
 */
export function seedPendingEchoes(
	sessionId: string,
	state: TranscriptState,
): TranscriptState {
	const queued = pendingEchoes.get(sessionId);
	if (!queued) return state;
	let seeded = state;
	for (const { mutate } of queued) seeded = mutate(seeded);
	return seeded;
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
export function retractPendingUser(sessionId: string, id: string): void {
	deliverEcho(sessionId, (state) => removeRecord(state, id));
}

/**
 * The paint a conversation starts from: the cached rows with any queued
 * optimistic echo applied on top, and whether anything was cached at all.
 *
 * The echo goes LAST because an echo is NEWER than the paint — the cached rows
 * are what the panel last displayed, and a buffered echo is a mutation that
 * happened after it stopped. Same order the live path produces.
 */
function paintSeed(sessionId: string): {
	transcript: TranscriptState;
	stale: boolean;
} {
	const cached = readPaint(sessionId);
	if (!cached) {
		return {
			transcript: seedPendingEchoes(sessionId, EMPTY_TRANSCRIPT),
			stale: false,
		};
	}
	return {
		transcript: seedPendingEchoes(sessionId, cached.transcript),
		stale: true,
	};
}

export function useCanonicalSessionStream(
	sessionId: string | undefined,
	enabled: boolean,
): CanonicalSessionHandle {
	const [view, setView] = useState<CanonicalSessionView>(() => {
		const seed = enabled && sessionId ? paintSeed(sessionId) : null;
		return {
			status: "connecting",
			frontend: null,
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
			 * SEEDED, and only here. A panel mounted while its own echo is already
			 * buffered must paint that echo in its FIRST frame: on the New-chat path
			 * this mount IS the identity flip the send triggers, and the echo reaches
			 * the panel through a passive effect - one commit too late - unless the
			 * initial state already holds it. See `seedPendingEchoes` for why this is
			 * a peek rather than a take, and why the drain that follows is harmless.
			 *
			 * The echo is applied OVER the cached paint rather than instead of it.
			 * They are different claims about the same first frame: the paint is this
			 * window's memory of the conversation (the click-path states this branch
			 * exists for are painted from it), and the echo is a message just sent
			 * into that conversation. Seeding the echo alone would drop the rows the
			 * click path came for; seeding the paint alone would drop the echo. So the
			 * echo composes on top of the paint and neither seam is lost.
			 */
			transcript:
				enabled && sessionId
					? seedPendingEchoes(sessionId, seed?.transcript ?? EMPTY_TRANSCRIPT)
					: EMPTY_TRANSCRIPT,
			// A cached paint is a real memory of a real transcript, but it is not the
			// owner's current state — so it says so until the snapshot lands.
			stale: seed?.stale ?? false,
			missing: false,
			loadingOlder: false,
			// No child has been heard from yet: the snapshot that follows seeds the
			// counter from its own `live_events`.
			subagentPulses: {},
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
		};
	});
	/*
	 * Which session the transcript IN `view` belongs to, so the reset effect
	 * below can tell another session's rows from this one's own seeded echo.
	 *
	 * WHY THIS EXISTS RATHER THAN A SECOND SEED. `seedPendingEchoes` above puts a
	 * buffered echo in a panel's FIRST frame - and the effect below used to
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
	 */
	const transcriptSession = useRef<string | undefined>(sessionId);
	// Mutable side-channel for the frame pump; React state is the published,
	// coalesced view. Frames arriving between renders collect here.
	const pending = useRef<DesktopSessionFrame[]>([]);
	// Read outside the React updater (see the flush comment), so the painted set
	// is tracked here rather than through the view state itself.
	const paintedIds = useRef<TranscriptState["index"]>(EMPTY_TRANSCRIPT.index);
	/*
	 * Call ids a mid-turn snapshot's seed could not label, and how many times we
	 * have read back for each. See `seedCallsMissingLabels`: the seed keeps only
	 * the settling frame, so a viewer that joins a turn in flight is handed rows
	 * with no arguments, and the arguments live in the durable transcript —
	 * which does not hold the round that is still running yet.
	 *
	 * THAT is why this outlives its flush. A single read-back at the snapshot can
	 * only label the calls whose rows became durable BEFORE the join; the round
	 * in flight becomes durable at its own turn end, so the read has to be
	 * repeated once per round for as long as the gap lasts. Capped per id rather
	 * than globally, because the gap closes for most calls on the first retry and
	 * a call that can never be labelled must not buy a history page per turn for
	 * the rest of the conversation: a rejected plan never emitted a start and has
	 * no assistant row either, so nothing will ever name it.
	 */
	const labelGapRef = useRef<Map<string, number>>(new Map());
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

		/**
		 * Read the durable tail back and merge it, walking further back until the
		 * page CONNECTS to a row the snapshot painted.
		 *
		 * WHY A SNAPSHOT ALONE BUYS THIS READ. A snapshot's history page is read
		 * `through_id=<the owner's published history_cursor>`, so its newest entry
		 * IS that cursor by construction — the two agree even when the cursor is
		 * stale. That makes the page unverifiable from the frame: a page stopping
		 * short of the durable tail (rows written after the cursor was captured,
		 * e.g. while this reader was on another conversation) is non-empty and
		 * reports `cursor_missing: false`, indistinguishable from a complete one.
		 * Comparing `history.entries` against `frontend.snapshot.history_cursor`
		 * therefore proves nothing — they are one value on two fields. The
		 * unbounded route (`sessions.history`, no cursor) reads the tail whatever
		 * cursor the owner published, and that is what makes it the read which
		 * closes this: against an owner that still bounds its page by a stale
		 * cursor it delivers the rows in between, and against one that publishes a
		 * genuine page (the backend half of this defect, landing separately) it is
		 * a redundant second read of rows already in hand — absorbed by the
		 * reducer's id-keyed merge for the cost of one bounded page. Kept
		 * unconditional because a client cannot tell the two owners apart from the
		 * frame it was handed.
		 *
		 * THE BOUND, which is different in the two cases:
		 *
		 *  - something WAS painted (the common case): the first read is the tail,
		 *    and it is the only one unless it does not reach back to a painted row —
		 *    the walk then continues until it does, stopped by `has_more` or by
		 *    `RECONCILE_WALK_MAX_ROWS` (500 rows, read in
		 *    `RECONCILE_TAIL_ENTRIES`-sized pages). A snapshot whose page already
		 *    reaches the tail costs exactly one page, which is what this path paid
		 *    before the guard existed.
		 *  - NOTHING was painted (a cold or cursor-less snapshot, an attention
		 *    frame naming an unpainted anchor with no snapshot in the batch, a
		 *    label-gap retry): no fetched page can ever satisfy the connection test,
		 *    so a walk would run to its bound for nothing — five sequential reads,
		 *    and five full file passes on the owner side, where one page is the
		 *    whole coverage. One page, then out.
		 *
		 * `painted` is built from the FRAMES, not from the painted view: an
		 * updater runs lazily, so at this point the view may not hold what this
		 * very flush painted, and a connection test against a stale view would
		 * walk back on every open.
		 */
		const reconcileTail = async (
			generation: number,
			painted: ReadonlySet<string>,
			missingCalls: number,
			/**
			 * Which attempt this is on the NOTHING-PAINTED failure path below, 1-based so
			 * it names a delay in `STREAM_RETRY_DELAYS_MS` directly. A parameter rather
			 * than a local because the retry re-enters this function: a counter inside it
			 * would reset to the first delay on every re-entry, which is a backoff that
			 * never backs off. Callers that are not retrying (`flush`, `reopen`) omit it.
			 */
			historyAttempt = 1,
		) => {
			const fetchedIds = new Set<string>();
			let beforeId: string | undefined;
			let rows = 0;
			/**
			 * The painted path's own budget: one immediate retry, then a quiet stand-down
			 * (see the failure arm). Counted here rather than passed because this path
			 * never re-enters the function.
			 */
			let failures = 0;
			while (rows < RECONCILE_WALK_MAX_ROWS) {
				let page: DesktopHistoryPage;
				try {
					page = await desktopResult<DesktopHistoryPage>({
						op: "sessions.history",
						sessionId,
						...(beforeId ? { beforeId } : {}),
						limit: reconcileLimit(missingCalls),
					});
				} catch {
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
						if (failures++ > 0) return;
						continue;
					}
					if (historyAttempt < HISTORY_RECONCILE_ATTEMPTS) {
						reconcileTimer = window.setTimeout(() => {
							reconcileTimer = 0;
							if (generationRef.current !== generation) return;
							void reconcileTail(
								generation,
								painted,
								missingCalls,
								historyAttempt + 1,
							);
						}, streamRetryDelayMs(historyAttempt));
						return;
					}
					// Nothing is painted and nothing could be read: this conversation is
					// unreachable, and saying so with a way back is the only honest state
					// left. `hydrated` stays false, so the composer may not claim the
					// conversation is empty either.
					setView((state) => ({
						...state,
						status: "unavailable",
						failure: HISTORY_UNREADABLE,
					}));
					return;
				}
				if (generationRef.current !== generation) return;
				const oldest = page.entries[0];
				rows += page.entries.length;
				// Merged even when it is the page we already have: durable rows win
				// by id, so a repeat is free and a partial one is completed.
				setView((state) => ({
					...state,
					// A page that RESOLVED is the proof hydration was waiting for,
					// applied-or-empty alike: the backend answered with this session's
					// durable tail, so the view may now speak about the conversation at
					// all - which is what lets the composer offer the greeting.
					hydrated: true,
					transcript: applyHistoryPage(state.transcript, page),
				}));
				// Nothing on screen means nothing to connect TO: every further page
				// would be merged by the same test that cannot fire. One page is the
				// coverage, and the walk past it is dead work on both sides of the
				// wire — see the two bound cases above.
				if (painted.size === 0) return;
				const connected = page.entries.some(
					(entry) => painted.has(entry.id) || fetchedIds.has(entry.id),
				);
				for (const entry of page.entries) fetchedIds.add(entry.id);
				// No overlap, or nothing further back: the walk is over either way.
				//
				// No `beforeId`-progress clause belongs here. The reader's `before_id`
				// is EXCLUSIVE (it breaks before appending the boundary row), so a page
				// can never hand back its own boundary row as its oldest; and a
				// transcript replaced under the walk is caught by the `fetchedIds`
				// overlap test above, which sees the tail it hands back.
				if (connected || !oldest || !page.has_more) return;
				beforeId = oldest.id;
			}
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
			// Decided here, from the frames, not inside the React updater: an
			// updater runs lazily (and twice under StrictMode), so a side effect
			// keyed off it would either never fire or fire on the discarded pass.
			//
			// EVERY snapshot justifies the read. A cold session (no live owner)
			// snapshots with no history cursor and so an empty page, and a replaced
			// cursor reports cursor_missing — both are the contract's "reconcile
			// through /history" case. What changed is the third one: a NON-empty
			// page without cursor_missing used to be accepted as complete, and it
			// cannot be known to be — see `reconcileTail`. On the two paths that
			// painted nothing the read is one page and no more; on the path that did
			// it is one page unless the tail does not reach it, which is the same
			// page this path already paid for the other two.
			// An attention frame only justifies a refetch when it names an anchor
			// the transcript has not painted: the backend publishes one after
			// every successful ACK, so reconciling on all of them spent a
			// 100-entry history fetch on a frame where only `unseen` changed.
			const paintedAnchor = (anchor: string | null | undefined) =>
				anchor != null && paintedIds.current.has(anchor);
			const needsReconcile = frames.some((frame) =>
				frame.type === "attention"
					? !paintedAnchor(frame.payload.anchor_id)
					: frame.type === "snapshot",
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
				labelGapRef.current,
				seedCallsMissingLabels(seedEvents, labelled),
				labelled,
				LABEL_GAP_ATTEMPTS,
			);
			const retryLabels = roundEnded
				? labelGapCandidates(
						labelGapRef.current,
						labelGapRef.current.keys(),
						labelled,
						LABEL_GAP_ATTEMPTS,
					)
				: [];
			const missingLabels = [...new Set([...seedMissing, ...retryLabels])];
			/*
			 * Bookkeeping BEFORE the request, because this counts ATTEMPTS: a read that
			 * fails or arrives too early must still not be retried forever. An id the
			 * transcript has learned is dropped; an EXHAUSTED one is KEPT, because
			 * deleting it would let the next snapshot's seed re-admit it with a fresh
			 * budget. The map's oldest entries are evicted past a plausible bound so
			 * the bookkeeping cannot outgrow any seed the owner can send.
			 */
			for (const id of [...labelGapRef.current.keys()]) {
				if (labelled.has(id)) labelGapRef.current.delete(id);
			}
			for (const id of missingLabels) {
				labelGapRef.current.set(id, (labelGapRef.current.get(id) ?? 0) + 1);
			}
			while (labelGapRef.current.size > LABEL_GAP_MAX_TRACKED) {
				const oldest = labelGapRef.current.keys().next().value;
				if (oldest === undefined) break;
				labelGapRef.current.delete(oldest);
			}
			performance.mark("lop:transcript:flush:start");

			setView((current) => {
				let next = { ...current };
				// Replay collects until the snapshot lands; applying an old delta
				// over newer snapshot text is exactly the bug this ordering exists
				// to prevent. Replayed EVENTS still fold into a scratch transcript:
				// the snapshot's durable page is applied over it afterwards, so a
				// row that became durable wins and an in-flight tail survives.
				const replayQueue: DesktopSessionFrame[] = [];
				let snapshotted = next.frontend !== null;
				let replayTranscript: TranscriptState | null = null;
				const now = Date.now();
				for (const frame of frames) {
					if (frame.type === "heartbeat") continue;
					if (frame.type === "gap") {
						// Receipt continuity broke: drop painted state and wait for the
						// authoritative snapshot that follows rather than patching over
						// an unknown interval. Durable rows stay painted (they cannot
						// be wrong); only live projections are dropped.
						next = {
							...next,
							frontend: null,
							history: null,
							terminal: null,
							status: "reconnecting",
							transcript: dropLiveRecords(next.transcript),
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
							next = {
								...next,
								frontend: null,
								history: null,
								transcript: dropLiveRecords(next.transcript),
							};
							snapshotted = false;
						}
						continue;
					}
					if (!snapshotted) {
						replayQueue.push(frame);
						if (frame.type === "event") {
							replayTranscript = applyEvent(
								replayTranscript ?? next.transcript,
								frame.payload,
								now,
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
							// A cold session (no live owner) snapshots with no history
							// cursor and therefore an empty page, and a replaced cursor
							// reports cursor_missing. Both are the contract's "reconcile
							// through /history" case: the authoritative tail is fetched
							// once per snapshot and merged durable-wins.
							transcript = applyLiveSeed(
								transcript,
								snapshot.frontend.snapshot,
								now,
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
							replayQueue.length = 0;
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
						const transcript = applyEvent(next.transcript, frame.payload, now);
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
				performance.mark("lop:transcript:flush:end");
				performance.measure(
					"lop:transcript:flush",
					"lop:transcript:flush:start",
					"lop:transcript:flush:end",
				);
				paintedIds.current = next.transcript.index;
				return next;
			});
			if (needsReconcile || missingLabels.length > 0) {
				void reconcileTail(generation, paintedEntryIds, missingLabels.length);
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
							// with nothing to tell the reader they are fiction.
							if (sessionId) dropPaint(sessionId);
							setView((current) => ({
								...current,
								subscriptionId: null,
								status: "unavailable",
								missing: true,
								failure: null,
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
						setView((current) => ({ ...current, subscriptionId: null }));
						if (attempt >= STREAM_MAX_ATTEMPTS) {
							setView((current) => ({
								...current,
								status: "unavailable",
								// The transport's detail is machine register and differs per
								// transport; the reader gets the product sentence for that
								// condition instead (D1).
								failure: streamFailureNotice(detail),
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
						setView((current) =>
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
						if (frame.type === "snapshot") attempt = 0;
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
		 * on this handle, and its budget reset (`attempt = 0`) is not needed here
		 * because a resync only runs while a subscription is live.
		 */
		const resync = () => {
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
			setView((current) => ({
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
					reconcileLimit(0),
				);
			}
			if (dispose) return;
			connect();
		};

		connect();
		// Non-null only while this effect owns the stream, so a Retry pressed after
		// the session changed (or after unmount) cannot re-open the old session.
		retryRef.current = reopen;
		// Same lifetime rule for the resync: it is addressable by session id from
		// another feature, and it must not outlive the pane it re-reads for.
		const unregisterResync = __registerCanonicalResync(sessionId, resync);

		return () => {
			generationRef.current += 1;
			retryRef.current = null;
			unregisterResync();
			dispose?.();
			if (raf) cancelAnimationFrame(raf);
			if (fallback) clearTimeout(fallback);
			if (retryTimer) clearTimeout(retryTimer);
			if (reconcileTimer) clearTimeout(reconcileTimer);
			pending.current = [];
		};
	}, [sessionId, enabled]);

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
		 * it keeps, carrying the echo `seedPendingEchoes` gave its first frame, and
		 * replacing that with an empty transcript is the defect UX round 2's U1
		 * measured. A real change of session id still resets, because the state on
		 * screen then belongs to a conversation nobody is looking at.
		 */
		const sameSession = transcriptSession.current === sessionId;
		transcriptSession.current = sessionId;
		// The cached rows when this window has shown the conversation before, so a
		// switch paints in its first frame; empty otherwise. The paint is NOT
		// written from here — the panel is keyed by identity, so a switch unmounts
		// this hook, and the cleanup effect below is the only moment that always
		// happens.
		const seed = sessionId ? readPaint(sessionId) : null;
		setView((current) => ({
			...current,
			frontend: null,
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
			// And this session's history is unknown again: the previous session's
			// page proves nothing about this one, so the composer must not state
			// that this conversation is empty until its own page lands.
			hydrated: false,
			// Belt to the early return's braces: whatever a superseded page in
			// flight does, a freshly opened session is not loading older rows.
			loadingOlder: false,
		}));
		// The retry bookkeeping is per SESSION: a previous session's outstanding call
		// ids would each buy a history page for the new one, sized by the old gap,
		// that can only be a no-op. `reconnectRef`, `receiptRef` and `paintedIds` are
		// cleared here for the same reason.
		labelGapRef.current = new Map();
	}, [sessionId]);

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
				writePaint(sessionId, { transcript: painted });
		};
	}, [sessionId]);

	// Latest view for callbacks that must not re-create per render.
	const viewRef = useRef(view);
	viewRef.current = view;
	// The conversation currently on screen, read at resolution time rather than
	// closed over, so an in-flight page can tell whether it is still wanted.
	const sessionRef = useRef(sessionId);
	sessionRef.current = sessionId;

	const loadingOlderRef = useRef(false);
	const loadOlder = useCallback(async (): Promise<boolean> => {
		if (!sessionId || loadingOlderRef.current) return false;
		const { transcript } = viewRef.current;
		if (!transcript.hasMore || !transcript.oldestId) return false;
		// The session this request is being made for. A page that resolves after
		// the reader has switched conversations describes a transcript that is no
		// longer on screen, and `applyHistoryPage` would happily splice it into
		// the new one (clause H). Scroll paging makes this reachable in a way
		// clicking never did: a page can be in flight for any scroll that happens
		// to precede a click in the sidebar.
		const requested = sessionId;
		loadingOlderRef.current = true;
		setView((current) => ({ ...current, loadingOlder: true }));
		try {
			const page = await desktopResult<DesktopHistoryPage>({
				op: "sessions.history",
				sessionId: requested,
				beforeId: transcript.oldestId,
				limit: 100,
			});
			if (sessionRef.current !== requested) {
				// Clear the flag before standing down. The rows are not spliced (a
				// foreign page must never reach this transcript), but `loadingOlder`
				// is the OLD session's view state and nothing else clears it: the
				// `finally` below resets only the module-level ref, and the
				// session-switch effect deliberately leaves view fields alone. Left
				// true, switching back showed a disabled "Loading earlier messages"
				// spinner with no request in flight and no way to clear it short of
				// a reload — and because the affordance renders disabled in that
				// state, the reader could not even retry.
				setView((current) => ({ ...current, loadingOlder: false }));
				return false;
			}
			setView((current) => ({
				...current,
				loadingOlder: false,
				transcript: applyHistoryPage(current.transcript, page),
			}));
			return true;
		} catch {
			// The rows already painted are still correct; the affordance simply
			// stays available for another try.
			setView((current) => ({ ...current, loadingOlder: false }));
			return false;
		} finally {
			loadingOlderRef.current = false;
		}
	}, [sessionId]);

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
				setView((current) => ({
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
		[sessionId],
	);

	// Registered for as long as this session is on screen, so the store's echo
	// reaches the transcript the user is looking at. Registration is keyed by
	// session rather than by panel: two panels for one session would be the same
	// conversation, and the last mounted one is the one being looked at.
	useEffect(() => {
		if (!sessionId) return;
		const apply = (mutate: (state: TranscriptState) => TranscriptState) => {
			setView((current) => {
				const transcript = mutate(current.transcript);
				return transcript === current.transcript
					? current
					: { ...current, transcript };
			});
		};
		/*
		 * The same function the delivery test drives, so the registration and
		 * drain the app performs are the ones under test. Draining here is what
		 * makes the New-chat path work: the store fires the echo in the same
		 * synchronous block that patches the session id, so the buffer is where it
		 * lands and this is the first moment a transcript can receive it.
		 */
		return __registerEchoTarget(sessionId, apply);
	}, [sessionId]);

	const clearView = useCallback(() => {
		setView((current) => ({
			...current,
			transcript: clearTranscript(current.transcript),
		}));
	}, []);

	const retry = useCallback(() => {
		retryRef.current?.();
	}, []);

	const addNote = useCallback(
		(text: string, level: "info" | "warning" | "error" = "info") => {
			setView((current) => ({
				...current,
				transcript: appendLocalNote(current.transcript, text, level),
			}));
		},
		[],
	);

	const paintPendingModel = useCallback((model: CanonicalModel) => {
		setView((current) => ({ ...current, pendingModel: model }));
	}, []);

	const clearPendingModel = useCallback(() => {
		setView((current) =>
			current.pendingModel === null
				? current
				: { ...current, pendingModel: null },
		);
	}, []);

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
			setView((current) => ({ ...current, pendingModel: null }));
		}
	}, [view.frontend, view.pendingModel]);

	// The bounded backstop for a confirmation that never arrives; see the constant.
	useEffect(() => {
		if (!view.pendingModel) return;
		const timer = window.setTimeout(
			() => setView((current) => ({ ...current, pendingModel: null })),
			PENDING_MODEL_TIMEOUT_MS,
		);
		return () => window.clearTimeout(timer);
	}, [view.pendingModel]);

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
			awaitingHydration: enabled && Boolean(sessionId) && !view.hydrated,
			loadOlder,
			refreshTail,
			clearView,
			addNote,
			paintPendingModel,
			clearPendingModel,
			retry,
		}),
		[
			view,
			enabled,
			sessionId,
			loadOlder,
			refreshTail,
			clearView,
			addNote,
			paintPendingModel,
			clearPendingModel,
			retry,
		],
	);
}
