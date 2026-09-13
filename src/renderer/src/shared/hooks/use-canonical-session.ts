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
import { modelSelector } from "@features/chat/session-status/session-model";
import {
	desktopResult,
	subscribeDesktopStream,
} from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeCompletionAttention } from "../../../../shared/desktop-session-contract";
import type {
	CanonicalFrontendState,
	CanonicalModel,
	DesktopHistoryPage,
	DesktopSessionFrame,
} from "../../../../shared/desktop-session-contract";

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
	/** Owner frontend epoch — answers to pending gates are addressed by it. */
	ownerEpoch: string | null;
	/** HTTP receipt cursor for reconnects (epoch + after_seq). */
	receipt: { epoch: string; seq: number } | null;
	/** Terminal event observed for the current turn; clears the wait latch. */
	terminal: string | null;
	/** Set on an unrecoverable stream failure. */
	error: string | null;
	/** The painted conversation, durable and live, oldest first. */
	transcript: TranscriptState;
	/** Older durable rows are being fetched. */
	loadingOlder: boolean;
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

export function useCanonicalSessionStream(
	sessionId: string | undefined,
	enabled: boolean,
): CanonicalSessionHandle {
	const [view, setView] = useState<CanonicalSessionView>(() => ({
		status: "connecting",
		frontend: null,
		pendingModel: null,
		history: null,
		cold: false,
		subscriptionId: null,
		ownerEpoch: null,
		receipt: null,
		terminal: null,
		error: null,
		/*
		 * SEEDED, and only here. A panel mounted while its own echo is already
		 * buffered must paint that echo in its FIRST frame: on the New-chat path
		 * this mount IS the identity flip the send triggers, and the echo reaches
		 * the panel through a passive effect - one commit too late - unless the
		 * initial state already holds it. See `seedPendingEchoes` for why this is
		 * a peek rather than a take, and why the drain that follows is harmless.
		 */
		transcript:
			enabled && sessionId
				? seedPendingEchoes(sessionId, EMPTY_TRANSCRIPT)
				: EMPTY_TRANSCRIPT,
		loadingOlder: false,
	}));
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
	const generationRef = useRef(0);

	useEffect(() => {
		if (!sessionId || !enabled) return;
		const generation = ++generationRef.current;
		let dispose: (() => void) | null = null;
		let raf = 0;
		let fallback = 0;

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
			// A cold session (no live owner) snapshots with no history cursor and
			// so an empty page; a replaced cursor reports cursor_missing. Both are
			// the contract's "reconcile through /history" case: the authoritative
			// tail is fetched once per snapshot and merged durable-wins.
			// An attention frame only justifies a refetch when it names an anchor
			// the transcript has not painted: the backend publishes one after
			// every successful ACK, so reconciling on all of them spent a
			// 100-entry history fetch on a frame where only `unseen` changed.
			const paintedAnchor = (anchor: string | null | undefined) =>
				anchor != null && paintedIds.current.has(anchor);
			const needsReconcile = frames.some((frame) =>
				frame.type === "attention"
					? !paintedAnchor(frame.payload.anchor_id)
					: frame.type === "snapshot" &&
						((frame.payload.frontend.snapshot.attention?.completion_token !=
							null &&
							!paintedAnchor(
								frame.payload.frontend.snapshot.attention?.anchor_id,
							)) ||
							frame.payload.history.cursor_missing ||
							frame.payload.history.entries.length === 0),
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
			for (const frame of frames) {
				if (frame.type !== "snapshot") continue;
				for (const entry of frame.payload.history.entries) {
					const calls = entry.payload?.tool_calls;
					if (!Array.isArray(calls)) continue;
					for (const call of calls as Record<string, unknown>[]) {
						if (call && typeof call.id === "string") labelled.add(call.id);
					}
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
								status: "live",
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
								error: null,
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
					if (frame.type === "event") {
						const eventType = String(frame.payload.type ?? "");
						if (TERMINAL_EVENTS.has(eventType)) {
							next = { ...next, terminal: eventType };
						}
						const transcript = applyEvent(next.transcript, frame.payload, now);
						if (transcript !== next.transcript) {
							next = { ...next, transcript };
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
				void desktopResult<DesktopHistoryPage>({
					op: "sessions.history",
					sessionId,
					limit: reconcileLimit(missingLabels.length),
				})
					.then((page) => {
						if (generationRef.current !== generation) return;
						setView((state) => ({
							...state,
							transcript: applyHistoryPage(state.transcript, page),
						}));
					})
					.catch(() => {
						// Painted rows stay; the stream keeps delivering. A failed
						// reconcile is not a reason to blank the conversation.
					});
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
					if (event.kind === "end") return;
					if (event.kind === "error") {
						// One automatic reconnect with the retained receipt cursor; a
						// second failure is surfaced, not retried forever.
						setView((current) => {
							if (current.status === "reconnecting") {
								return {
									...current,
									status: "unavailable",
									error: event.detail ?? "The event stream failed.",
								};
							}
							return { ...current, status: "reconnecting" };
						});
						dispose?.();
						dispose = null;
						const receipt = receiptRef.current;
						if (receipt) {
							reconnectRef.current = {
								epoch: receipt.epoch,
								afterSeq: receipt.seq,
							};
							setView((current) => {
								if (current.status === "unavailable") return current;
								connect();
								return current;
							});
						}
						return;
					}
					if (event.data === undefined) return;
					try {
						const frame = JSON.parse(event.data) as DesktopSessionFrame;
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

		connect();

		return () => {
			generationRef.current += 1;
			dispose?.();
			if (raf) cancelAnimationFrame(raf);
			if (fallback) clearTimeout(fallback);
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
		setView((current) => ({
			...current,
			frontend: null,
			// A different session's unconfirmed paint describes the model of a
			// conversation that is no longer on screen.
			pendingModel: null,
			history: null,
			terminal: null,
			transcript: EMPTY_TRANSCRIPT,
			status: "connecting",
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
			loadOlder,
			clearView,
			addNote,
			paintPendingModel,
			clearPendingModel,
		}),
		[view, loadOlder, clearView, addNote, paintPendingModel, clearPendingModel],
	);
}
