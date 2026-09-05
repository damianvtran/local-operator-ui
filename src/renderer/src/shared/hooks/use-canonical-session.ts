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
 * batch of IPC deliveries, not one render per token.
 */

import { subscribeDesktopStream } from "@shared/api/local-operator/desktop-api";
import { useEffect, useMemo, useRef, useState } from "react";
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
};

const TERMINAL_EVENTS = new Set([
	"agent_end",
	"agent_start",
	"provider_start",
	"steering_delivered",
	"turn_end",
	"turn_start",
]);

export function useCanonicalSessionStream(
	sessionId: string | undefined,
	enabled: boolean,
): CanonicalSessionView {
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

		const flush = () => {
			raf = 0;
			if (generationRef.current !== generation) return;
			const frames = pending.current;
			pending.current = [];
			if (frames.length === 0) return;

			setView((current) => {
				let next = { ...current };
				// Replay collects until the snapshot lands; applying an old delta
				// over newer snapshot text is exactly the bug this ordering exists
				// to prevent.
				const replayQueue: DesktopSessionFrame[] = [];
				let snapshotted = next.frontend !== null;
				for (const frame of frames) {
					if (frame.type === "heartbeat") continue;
					if (frame.type === "gap") {
						// Receipt continuity broke: drop painted state and wait for the
						// authoritative snapshot that follows rather than patching over
						// an unknown interval.
						next = {
							...next,
							frontend: null,
							history: null,
							terminal: null,
							status: "reconnecting",
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
							next = { ...next, frontend: null, history: null };
							snapshotted = false;
						}
						continue;
					}
					if (!snapshotted) {
						replayQueue.push(frame);
						if (frame.type === "snapshot") {
							next = {
								...next,
								status: "live",
								frontend: frame.payload.frontend.snapshot,
								history: frame.payload.history,
								cold: frame.payload.cold,
								ownerEpoch: frame.payload.frontend.epoch,
								error: null,
							};
							snapshotted = true;
							replayQueue.length = 0;
						}
						continue;
					}
					if (frame.type === "frontend.update") {
						const update = frame.payload;
						if (
							next.frontend &&
							update.epoch === next.ownerEpoch &&
							next.frontend.sequence < update.sequence
						) {
							// Field deltas, not a full repaint: spread only the changed
							// keys over the current state.
							next = {
								...next,
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
					}
				}
				return next;
			});
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
						if (!raf) raf = requestAnimationFrame(flush);
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
			pending.current = [];
		};
	}, [sessionId, enabled]);

	return useMemo(() => view, [view]);
}
