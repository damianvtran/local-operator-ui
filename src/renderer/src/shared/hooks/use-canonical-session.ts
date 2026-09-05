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
	type TranscriptState,
	appendLocalNote,
	applyEvent,
	applyHistoryPage,
	applyLiveSeed,
	clearTranscript,
	dropLiveRecords,
} from "@features/chat/canonical/transcript-reducer";
import {
	desktopResult,
	subscribeDesktopStream,
} from "@shared/api/local-operator/desktop-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	CanonicalFrontendState,
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
	/** Fetch the page of durable rows before the oldest painted one. */
	loadOlder: () => Promise<void>;
	/** View-only clear (the `/clear` contract): nothing is deleted. */
	clearView: () => void;
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

/** Flush cadence when no animation frame arrives (hidden window). */
const HIDDEN_FLUSH_MS = 250;

export function useCanonicalSessionStream(
	sessionId: string | undefined,
	enabled: boolean,
): CanonicalSessionHandle {
	const [view, setView] = useState<CanonicalSessionView>({
		status: "connecting",
		frontend: null,
		history: null,
		cold: false,
		subscriptionId: null,
		ownerEpoch: null,
		receipt: null,
		terminal: null,
		error: null,
		transcript: EMPTY_TRANSCRIPT,
		loadingOlder: false,
	});
	// Mutable side-channel for the frame pump; React state is the published,
	// coalesced view. Frames arriving between renders collect here.
	const pending = useRef<DesktopSessionFrame[]>([]);
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
			const needsReconcile = frames.some(
				(frame) =>
					frame.type === "snapshot" &&
					(frame.payload.history.cursor_missing ||
						frame.payload.history.entries.length === 0),
			);
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
								frontend: snapshot.frontend.snapshot,
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
				return next;
			});
			if (needsReconcile) {
				void desktopResult<DesktopHistoryPage>({
					op: "sessions.history",
					sessionId,
					limit: 100,
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
		setView((current) => ({
			...current,
			frontend: null,
			history: null,
			terminal: null,
			transcript: EMPTY_TRANSCRIPT,
			status: "connecting",
		}));
	}, [sessionId]);

	// Latest view for callbacks that must not re-create per render.
	const viewRef = useRef(view);
	viewRef.current = view;

	const loadingOlderRef = useRef(false);
	const loadOlder = useCallback(async () => {
		if (!sessionId || loadingOlderRef.current) return;
		const { transcript } = viewRef.current;
		if (!transcript.hasMore || !transcript.oldestId) return;
		loadingOlderRef.current = true;
		setView((current) => ({ ...current, loadingOlder: true }));
		try {
			const page = await desktopResult<DesktopHistoryPage>({
				op: "sessions.history",
				sessionId,
				beforeId: transcript.oldestId,
				limit: 100,
			});
			setView((current) => ({
				...current,
				loadingOlder: false,
				transcript: applyHistoryPage(current.transcript, page),
			}));
		} catch {
			// The rows already painted are still correct; the affordance simply
			// stays available for another try.
			setView((current) => ({ ...current, loadingOlder: false }));
		} finally {
			loadingOlderRef.current = false;
		}
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

	return useMemo(
		() => ({ ...view, loadOlder, clearView, addNote }),
		[view, loadOlder, clearView, addNote],
	);
}
