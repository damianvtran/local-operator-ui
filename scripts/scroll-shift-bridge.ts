/*
 * The scripted desktop owner for the scroll-shift harness.
 *
 * SAME SHAPE AS THE REAL BRIDGE, plus one thing `session-switch-bridge.ts` has
 * no use for: a LIVE TURN the harness plays on demand. The renderer never talks
 * HTTP itself: in Electron `desktopRequest` calls `window.api.desktop.request`
 * and the stream comes from `window.api.desktop.stream.subscribe`. This file
 * installs exactly those two, so every layer above them is the SHIPPED one -
 * the typed vocabulary in `desktop-contract.ts`, the store, the session stream
 * hook, the transcript reducer, `CanonicalTranscript`, `useScrollPaging` - and
 * what is scripted is only the owner at the other end.
 *
 * WHY A SECOND SCRIPTED OWNER. The switch harness's bridge stops at `open` +
 * `snapshot` because everything it measures is over by then. The behaviour
 * under test here BEGINS at the snapshot: a young conversation's transcript
 * grows while the reader watches it, one `message_update` frame at a time, and
 * the question is where the layout puts each frame. So this bridge carries a
 * `play(sessionId, script)` door: after the pane's stream has subscribed and
 * snapshotted, the door emits a turn - `message_start`, then one
 * `message_update` per chunk with the script's own cadence, then `message_end`
 * - and every frame goes through the same consumer a real turn's frames take.
 *
 * WHAT IS SCRIPTED, EXACTLY. The cadence and the text. The frame SHAPES are the
 * contract's (`DesktopSessionFrame`'s `event` receipts; the producer's
 * delta-only `message_update`), and the consumer is the shipped one, so a shape
 * that drifts from the wire breaks this rig the way it would break the app.
 */
import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
	DesktopSessionFrame,
} from "../src/shared/desktop-session-contract";
import { DESKTOP_STREAM_DETAIL } from "../src/shared/desktop-stream-notice";
import {
	type SessionFixture,
	type TranscriptStep,
	historyPage,
	installPreloadStubs,
} from "./session-switch-bridge";

export type ScrollShiftConfig = {
	sessions: SessionFixture[];
	stepsBySession: Record<string, TranscriptStep[]>;
	/** How long a fresh stream subscription takes to open and to snapshot. */
	stream?: { openMs?: number; snapshotMs?: number };
};

/**
 * One turn, as the harness plays it. `afterMs` is the delay BEFORE the chunk's
 * frame - the gap the previous chunk was on screen for - so the script reads as
 * "type this, wait, type that".
 */
export type LiveTurnScript = {
	/** The assistant message id this turn paints. */
	messageId: string;
	/** The chunks, in order. */
	chunks: Array<{ text: string; afterMs: number }>;
	/** Delay before `message_start`, i.e. before the row appears at all. */
	startAfterMs?: number;
	/** Whether to follow the last chunk with `message_end` (default true). */
	end?: boolean;
	/** Whether to bracket the turn with `frontend` streaming flags (default true). */
	frontend?: boolean;
};

/** One frame this bridge emitted, for the driver's log. */
export type EmittedFrame = {
	t: number;
	sessionId: string;
	seq: number;
	kind: string;
	/** The chunk's length, for update frames; the text's for starts/ends. */
	size?: number;
};

export type ScrollShiftHandle = {
	/** Play a scripted turn against `sessionId`'s live subscription. */
	play: (sessionId: string, script: LiveTurnScript) => Promise<void>;
	/** Every frame emitted, in order. */
	emitted: EmittedFrame[];
	/** Whether a pane is currently subscribed to `sessionId`. */
	hasSubscriber: (sessionId: string) => boolean;
};

const now = () => performance.now();

/** The frontend state a cold subscription snapshots; see the switch bridge. */
function frontendState(
	sessionId: string,
	title: string,
): CanonicalFrontendState {
	return {
		state_version: 1,
		session_id: sessionId,
		epoch: `epoch-${sessionId}`,
		sequence: 5,
		attention: {
			anchor_id: null,
			kind: null,
			viewed: true,
			completion_token: null,
			session_name: title,
			focus_policy: "when_unfocused",
		},
		cwd: "/Users/operator/workspace",
		conversation_title: title,
		conversation_title_user_set: true,
		conversation_title_forked: false,
		goal: "",
		active_agent: "operator",
		active_team: "",
		selected_model: { provider: "anthropic", name: "claude-sonnet-4" },
		effective_model: { provider: "anthropic", name: "claude-sonnet-4" },
		streaming: false,
		generation: 1,
		pending_gate: null,
		history_cursor: "cursor-1",
		live_events: [],
		queued_steering: [],
		jobs: [],
		todos: [],
		wakes: [],
		mcp_servers: [],
		model_catalogue: [],
		context_tokens: 1234,
		context_is_estimate: false,
		context_window: 200_000,
		context_breakdown: null,
		cumulative_parent_cost: 0.12,
		subagent_cost: 0,
		cost_knowledge: "exact",
	} as CanonicalFrontendState;
}

/** A live subscription's per-session state, kept for `play`. */
type Subscription = {
	sessionId: string;
	epoch: string;
	/** Emit one frame to this subscription. */
	send: (frame: DesktopSessionFrame) => void;
	/** Emit one `event` receipt whose payload is the producer's own event. */
	emitEvent: (event: Record<string, unknown>) => void;
	/** Emit a `frontend.update` receipt. */
	emitFrontend: (changes: Partial<CanonicalFrontendState>) => void;
	disposed: () => boolean;
};

export function installScrollShiftOwner(
	config: ScrollShiftConfig,
): ScrollShiftHandle {
	installPreloadStubs();
	const openMs = config.stream?.openMs ?? 8;
	const snapshotMs = config.stream?.snapshotMs ?? 8;
	const titles = new Map(config.sessions.map((row) => [row.id, row.name]));
	const subscriptions = new Map<string, Subscription>();
	const emitted: EmittedFrame[] = [];

	const wait = (ms: number) =>
		ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

	const historyFor = (sessionId: string): DesktopHistoryPage =>
		historyPage(sessionId, config.stepsBySession[sessionId] ?? []);

	type Answer = { status: number; body: unknown };
	const answer = (request: { op: string; sessionId?: unknown }): Answer => {
		switch (request.op) {
			case "capabilities":
				return {
					status: 200,
					body: {
						result: {
							desktop_contract: 3,
							desktop_available: true,
							desktop_auth: "bearer",
							/*
							 * `session_interrupt` is advertised, so the composer renders the
							 * stop control instead of the "predates the stop control" notice.
							 * The notice is a real element in the band and a legitimate subject
							 * of its own, but for the scroll traces it is a 27.5px band change
							 * that would ride along with every measurement of the working
							 * line. The harness measures the working line's arrival; the
							 * notice is turned off so the two cannot be confused.
							 */
							features: {
								session_catalogue: 3,
								canonical_stream: 2,
								session_interrupt: 1,
							},
						},
					},
				};
			case "sessions.list":
				return {
					status: 200,
					body: { result: { sessions: config.sessions, truncated: false } },
				};
			case "sessions.get": {
				const sessionId = String(request.sessionId);
				if (!config.sessions.some((row) => row.id === sessionId))
					return { status: 404, body: { detail: "Unknown session." } };
				return {
					status: 200,
					body: {
						result: {
							session: {
								id: sessionId,
								name: titles.get(sessionId) ?? sessionId,
								mtime: Date.now() / 1000,
							},
						},
					},
				};
			}
			case "sessions.history":
				return {
					status: 200,
					body: { result: historyFor(String(request.sessionId)) },
				};
			default:
				return { status: 200, body: { result: null } };
		}
	};

	const desktop = {
		request: async (request: { op: string }) => {
			await wait(1);
			return answer(request);
		},
		stream: {
			subscribe: (
				args: { sessionId: string },
				onEvent: (event: {
					kind: "data" | "error" | "end";
					data?: string;
					detail?: string;
					status?: number;
				}) => void,
			) => {
				let cancelled = false;
				let seq = 0;
				const epoch = `epoch-${args.sessionId}`;
				const send = (frame: DesktopSessionFrame) => {
					if (cancelled) return;
					onEvent({ kind: "data", data: JSON.stringify(frame) });
				};
				const emitEvent = (event: Record<string, unknown>) => {
					seq += 1;
					emitted.push({
						t: now(),
						sessionId: args.sessionId,
						seq,
						kind: String(event.type ?? "event"),
						size:
							typeof event.delta === "string"
								? (event.delta as string).length
								: undefined,
					});
					send({
						session_id: args.sessionId,
						epoch,
						seq,
						type: "event",
						payload: event,
					});
				};
				const emitFrontend = (changes: Partial<CanonicalFrontendState>) => {
					seq += 1;
					send({
						session_id: args.sessionId,
						epoch,
						seq,
						type: "frontend.update",
						payload: {
							epoch,
							sequence: Number(changes.sequence ?? 0),
							changes,
							job_trajectory_appends: {},
							job_trajectory_replacements: [],
						},
					});
				};
				const subscription: Subscription = {
					sessionId: args.sessionId,
					epoch,
					send,
					emitEvent,
					emitFrontend,
					disposed: () => cancelled,
				};
				subscriptions.set(args.sessionId, subscription);
				void (async () => {
					await wait(openMs);
					if (cancelled) return;
					seq += 1;
					send({
						session_id: args.sessionId,
						epoch,
						seq,
						type: "open",
						payload: {
							subscription_id: `sub-${args.sessionId}`,
							gap: false,
							watch_ttl_seconds: 45,
						},
					});
					await wait(snapshotMs);
					if (cancelled) return;
					seq += 1;
					send({
						session_id: args.sessionId,
						epoch,
						seq,
						type: "snapshot",
						payload: {
							frontend: {
								state_version: 1,
								epoch,
								sequence: 5,
								snapshot: frontendState(
									args.sessionId,
									titles.get(args.sessionId) ?? args.sessionId,
								),
								live_cursor: null,
							},
							history: historyFor(args.sessionId),
							cold: true,
						},
					});
				})();
				return {
					dispose: () => {
						cancelled = true;
						if (subscriptions.get(args.sessionId) === subscription)
							subscriptions.delete(args.sessionId);
						onEvent({ kind: "end" });
					},
				};
			},
		},
	};
	window.api = { ...(window.api ?? {}), desktop } as typeof window.api;

	/**
	 * Play one scripted turn on a live subscription.
	 *
	 * Waits (bounded) for the pane to have subscribed, then emits the script.
	 * The waiting is the harness's job rather than the scene's because the
	 * pane's subscription is what a real turn needs to be heard by, and a
	 * script that started before it would paint nothing - the failure mode
	 * being invisible except as "the stream did nothing".
	 */
	const play = async (sessionId: string, script: LiveTurnScript) => {
		const deadline = now() + 15_000;
		while (subscriptions.get(sessionId)?.disposed() !== false) {
			if (now() > deadline)
				throw new Error(`no live subscription for ${sessionId} after 15s`);
			await wait(20);
		}
		const sub = subscriptions.get(sessionId) as Subscription;
		await wait(script.startAfterMs ?? 0);
		const full: string[] = [];
		sub.emitEvent({
			type: "message_start",
			message: { id: script.messageId, role: "assistant", content: [] },
		});
		if (script.frontend ?? true) {
			sub.emitFrontend({ epoch: sub.epoch, streaming: true, sequence: 6 });
		}
		for (const chunk of script.chunks) {
			await wait(chunk.afterMs);
			if (sub.disposed()) return;
			full.push(chunk.text);
			sub.emitEvent({
				type: "message_update",
				message: {
					id: script.messageId,
					role: "assistant",
					content: [],
				},
				delta: chunk.text,
			});
		}
		if (script.end ?? true) {
			sub.emitEvent({
				type: "message_end",
				message: {
					id: script.messageId,
					role: "assistant",
					content: [{ type: "text", text: full.join("") }],
					stop_reason: "endTurn",
				},
			});
			if (script.frontend ?? true) {
				sub.emitFrontend({ epoch: sub.epoch, streaming: false, sequence: 7 });
			}
		}
	};

	return {
		play,
		emitted,
		hasSubscriber: (sessionId) => subscriptions.has(sessionId),
	};
}

declare global {
	interface Window {
		api?: {
			desktop?: unknown;
			[key: string]: unknown;
		};
	}
}
