/*
 * The scripted desktop backend behind `scripts/session-switch.html`.
 *
 * THE SAME SHAPE AS THE REAL BRIDGE. The renderer never talks HTTP itself: in
 * Electron `desktopRequest` calls `window.api.desktop.request`, and the stream
 * comes from `window.api.desktop.stream.subscribe`. This file installs exactly
 * those two, so every layer above them is the SHIPPED one - the typed
 * vocabulary in `desktop-contract.ts`, the store, the session stream hook, the
 * transcript reducer, and the React tree. What is scripted here is the owner at
 * the other end, and its two knobs are the ones a switch can actually feel:
 * the per-op service time (how long the backend takes to answer) and the
 * stream's snapshot delay (how long a new subscription takes to deliver the
 * transcript).
 *
 * WHY SCRIPTED RATHER THAN A REAL BACKEND. A real `local-operator serve` on
 * this host answers `sessions.get` in single-digit milliseconds, which makes it
 * useless as a knob: the question "is the pre-commit round trip what the user
 * feels" is a question about how the switch scales with an owner that is not
 * instantaneous, and a switch whose whole cost is a network hop cannot be
 * attributed by measuring the hop at its best case. The defaults below are
 * therefore deliberately *reported as parameters* by the driver - the run
 * prints them next to the numbers - so no reader has to guess what was assumed.
 * The render half (everything after the commit) needs no such assumption: it is
 * the real component tree and its real React work, and it is where the
 * hypothesis in the brief is actually testable.
 *
 * The frame shapes are the contract's, not a convenience: `open`, then one
 * `snapshot` carrying the authoritative frontend state and the history page,
 * which is the shape a cold subscription receives (see
 * `src/shared/desktop-session-contract.ts` and `src/main/desktop-stream.ts`).
 */

import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
	DesktopSessionFrame,
} from "../../src/shared/desktop-session-contract";

/** One row of `sessions.list`, in the backend's `BackendSessionRow` shape. */
export type SessionFixture = {
	id: string;
	name: string;
	mtime: number;
};

export type DurableEntry = DesktopHistoryPage["entries"][number];

/**
 * One transcript record, as the fixtures below declare it. The two builders
 * turn these into the durable wire rows the transcript reducer reads, so the
 * harness never hand-writes `payload.content`.
 */
export type TranscriptStep =
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string }
	| { kind: "tool"; name: string; output: string };

/**
 * How long the scripted owner takes per operation, and how long a fresh stream
 * subscription takes to deliver its snapshot. Milliseconds.
 */
export type BridgeLatency = {
	capabilities?: number;
	"sessions.list"?: number;
	"sessions.get"?: number;
	"sessions.history"?: number;
	default?: number;
	/** Delay between `open` and `snapshot` on a new subscription. */
	stream?: number;
};

export type BridgeConfig = {
	sessions: SessionFixture[];
	stepsBySession: Record<string, TranscriptStep[]>;
	latency?: BridgeLatency;
	/**
	 * Session ids whose `sessions.get` FAILS with a 404.
	 *
	 * The rollback path is the half of an optimistic commit that a timing
	 * harness cannot see, and it is the half a reviewer is entitled to watch:
	 * a switch to a session that is gone must end with the error and the
	 * outgoing conversation still on screen, not with a chat that will not
	 * open. Driving it here means the claim is checked in the real renderer
	 * rather than only in the store's own unit test.
	 */
	failGet?: string[];
};

type DesktopRequestLike = { op: string; [key: string]: unknown };

type BridgeEvent = {
	kind: "data" | "error" | "end";
	data?: string;
	detail?: string;
};

/** What the driver reads back out of the page. */
export type BridgeLog = {
	/** Every request, with the time it was issued and the time it settled. */
	requests: Array<{
		op: string;
		sessionId?: string;
		startedAt: number;
		settledAt: number;
	}>;
	/** Every stream subscription, with `open` and `snapshot` delivery times. */
	streams: Array<{
		sessionId: string;
		subscribedAt: number;
		openedAt: number;
		snapshotAt: number;
	}>;
	latency: Required<BridgeLatency>;
};

export type BridgeHandle = {
	log: BridgeLog;
	dispose: () => void;
};

const now = () => performance.now();

/**
 * The frontend state a cold subscription snapshots.
 *
 * Every field the canonical surface reads is present with a settled value:
 * this harness measures the switch, and a missing field would make a component
 * take a branch the app never takes for a real session, which is how a
 * measurement turns into a fiction.
 */
function frontendState(
	sessionId: string,
	title: string,
): CanonicalFrontendState {
	return {
		state_version: 1,
		session_id: sessionId,
		epoch: `epoch-${sessionId}`,
		sequence: 4,
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

/**
 * A durable history page built from transcript steps.
 *
 * Ids are `e<index>` and timestamps ascend, which is the order the reducer
 * expects and the order a real page arrives in. Tool rows carry their output on
 * the `tool` role's `content`, exactly as `durableRecord` reads it; assistant
 * rows that carried a tool call keep the `tool_calls` stub whose `id` pairs the
 * two, because the tool row is keyed on the call id rather than on its own
 * entry id.
 */
export function historyPage(
	sessionId: string,
	steps: TranscriptStep[],
): DesktopHistoryPage {
	const entries: DurableEntry[] = [];
	const base = 1_760_000_000;
	let toolIndex = 0;
	steps.forEach((step, index) => {
		const ts = base + index;
		const id = `${sessionId}-e${index}`;
		if (step.kind === "user") {
			entries.push({
				id,
				ts,
				type: "message",
				payload: {
					kind: "message",
					role: "user",
					content: [{ type: "text", text: step.text }],
				},
			});
			return;
		}
		if (step.kind === "assistant") {
			entries.push({
				id,
				ts,
				type: "message",
				payload: {
					kind: "message",
					role: "assistant",
					content: [{ type: "text", text: step.text }],
					stop_reason: "endTurn",
				},
			});
			return;
		}
		toolIndex += 1;
		const callId = `call-${sessionId}-${toolIndex}`;
		entries.push({
			id,
			ts,
			type: "message",
			payload: {
				kind: "message",
				role: "user",
				content: [{ type: "text", text: "run it" }],
				tool_calls: [
					{
						id: callId,
						name: step.name,
						arguments: JSON.stringify({ path: "notes.md" }),
					},
				],
			},
		});
		entries.push({
			id: `${id}-result`,
			ts: ts + 0.5,
			type: "message",
			payload: {
				kind: "message",
				role: "tool",
				tool_call_id: callId,
				tool_name: step.name,
				content: [{ type: "text", text: step.output }],
				provider_payload: { duration_s: 0.4 },
			},
		});
	});
	return { entries, has_more: false, cursor_missing: false };
}

/**
 * The preload surfaces the chat surface reaches for that are NOT the desktop
 * control plane.
 *
 * `window.electron.ipcRenderer.invoke("get-platform-info")` is called from
 * `MessageInput`'s mount effect, and a throw there takes the whole React tree
 * down - so a harness without it renders an empty document and reports it as
 * "never became ready". Nothing here is measured: these are the window's own
 * affordances (dialogs, file pickers, platform report), not the data path the
 * switch pays for.
 */
function installPreloadStubs() {
	const electron = {
		ipcRenderer: {
			invoke: async (channel: string) =>
				channel === "get-platform-info" ? { platform: "darwin" } : null,
			send: () => {},
			/* The speech manager subscribes on mount and unsubscribes on unmount,
			 * so both halves have to exist: a stub that only has `on` unmounts a
			 * tree with a `TypeError` and takes the harness with it. This is the
			 * same shape `edit-api.stories.tsx` uses for the same reason. */
			on: () => () => {},
			removeListener: () => electron.ipcRenderer,
		},
	};
	const window_ = window as unknown as {
		electron?: unknown;
		api?: Record<string, unknown>;
	};
	window_.electron ??= electron;
	/*
	 * `getHomeDirectory` is a preload surface the chat surface reads on mount
	 * (the cwd chip). Without it the chip logs a caught `TypeError` on every
	 * mount; harmless, but a harness that prints errors the app does not have
	 * trains its reader to ignore the error channel. Nothing here is measured.
	 */
	window_.api ??= {};
	window_.api.getHomeDirectory ??= async () => "/Users/operator";
	/*
	 * The shell's own preload surfaces (the updater, the platform report). The
	 * harness now mounts the whole app rather than the chat page alone, so the
	 * banners that live beside the chat read these on mount - and a missing one
	 * throws inside an effect, which unmounts the tree and leaves a blank page
	 * that looks like a harness bug rather than a mock gap.
	 *
	 * The same set, and the same reason, as the shell story's fixture:
	 * `shell.stories.tsx` stubs exactly this much to render the app shell
	 * outside Electron. Nothing here is measured.
	 */
	const unsub = () => () => {};
	window_.api.systemInfo ??= {
		getAppVersion: async () => "0.20.0",
		getPlatformInfo: async () => ({
			platform: "darwin",
			arch: "arm64",
			nodeVersion: "22.14.0",
			electronVersion: "35.5.1",
			chromeVersion: "130.0.6723.152",
		}),
	};
	window_.api.updater ??= {
		checkForUpdates: async () => ({ updateInfo: {}, cancellationToken: null }),
		checkForBackendUpdates: async () => null,
		/*
		 * A verdict-shaped answer, mirroring the shipped `UpdateCheckVerdict`
		 * (`src/main/update-check-verdict.ts`) - the real bridge resolves that value
		 * and the banner reads `result.affirmation` off it, so a fake that returns
		 * `void` misdescribes the contract this file exists to reproduce.
		 *
		 * Both channels are `unavailable` on purpose: this page scripts an owner it
		 * never asks a version question of, and "we could not find out" is the
		 * truthful reading of that - where `current` on both channels would EARN the
		 * shipped affirmation and put an update toast on a frame that exists to
		 * photograph the session switch instead.
		 */
		checkForAllUpdates: async () => ({
			app: "unavailable",
			server: "unavailable",
			affirmation: null,
		}),
		updateBackend: async () => false,
		downloadUpdate: async () => [],
		quitAndInstall: () => {},
		quitForUpdateInstall: async () => true,
		getLastInstallAttempt: async () => null,
		/*
		 * Every subscription the shell's update banner takes on mount, from the
		 * call sites in `src/renderer/src` rather than from the story's fixture:
		 * the fixture predates several of these, and a missing one throws inside
		 * the mount effect (`window.api.updater.onBackendUpdateManualRequired is
		 * not a function`), unmounting the tree and leaving a blank page.
		 */
		onUpdateAvailable: unsub,
		onUpdateNotAvailable: unsub,
		onUpdateDevMode: unsub,
		onUpdateNpxAvailable: unsub,
		onUpdateDownloaded: unsub,
		onUpdateProgress: unsub,
		onUpdateError: unsub,
		onUpdateInstallBlocked: unsub,
		onUpdateInstallFailed: unsub,
		onUpdateInstallInFlight: unsub,
		onBeforeQuitForUpdate: unsub,
		onBackendUpdateAvailable: unsub,
		onBackendUpdateDevMode: unsub,
		onBackendUpdateNotAvailable: unsub,
		onBackendUpdateCompleted: unsub,
		onBackendUpdateError: unsub,
		onBackendUpdateManualRequired: unsub,
	};
	window_.api.showItemInFolder ??= () => {};
}

/**
 * Install the scripted owner on `window.api.desktop`.
 *
 * Returns the log the driver reads. `dispose` restores whatever was there, so
 * the same page can be re-run in a second configuration.
 */
export function installSwitchBridge(config: BridgeConfig): BridgeHandle {
	installPreloadStubs();
	const latency: Required<BridgeLatency> = {
		capabilities: config.latency?.capabilities ?? 1,
		"sessions.list": config.latency?.["sessions.list"] ?? 2,
		"sessions.get": config.latency?.["sessions.get"] ?? 12,
		"sessions.history": config.latency?.["sessions.history"] ?? 14,
		default: config.latency?.default ?? 1,
		stream: config.latency?.stream ?? 12,
	};
	const log: BridgeLog = { requests: [], streams: [], latency };
	const titles = new Map(config.sessions.map((row) => [row.id, row.name]));

	const wait = (ms: number) =>
		ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

	const historyFor = (sessionId: string) =>
		historyPage(sessionId, config.stepsBySession[sessionId] ?? []);

	const answer = (request: DesktopRequestLike) => {
		switch (request.op) {
			case "capabilities":
				return {
					desktop_contract: 3,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { session_catalogue: 3, canonical_stream: 2 },
				};
			case "sessions.list":
				return { sessions: config.sessions, truncated: false };
			case "sessions.get": {
				const sessionId = String(request.sessionId);
				if (config.failGet?.includes(sessionId)) return { notFound: true };
				if (!config.sessions.some((row) => row.id === sessionId))
					return { notFound: true };
				return {
					session: {
						id: sessionId,
						name: titles.get(sessionId) ?? sessionId,
						mtime: Date.now() / 1000,
					},
				};
			}
			case "sessions.history":
				return historyFor(String(request.sessionId));
			default:
				return null;
		}
	};

	const previous = window.api?.desktop;

	const desktop = {
		request: async (request: DesktopRequestLike) => {
			const startedAt = now();
			const ms = latency[request.op as keyof BridgeLatency] ?? latency.default;
			await wait(ms);
			const result = answer(request);
			const settledAt = now();
			log.requests.push({
				op: request.op,
				sessionId:
					typeof request.sessionId === "string" ? request.sessionId : undefined,
				startedAt,
				settledAt,
			});
			if (result && "notFound" in result)
				return { status: 404, body: { detail: "Unknown session." } };
			return { status: 200, body: { result } };
		},

		stream: {
			subscribe: (
				args: { sessionId: string },
				onEvent: (event: BridgeEvent) => void,
			) => {
				const subscribedAt = now();
				const entry = {
					sessionId: args.sessionId,
					subscribedAt,
					openedAt: 0,
					snapshotAt: 0,
				};
				log.streams.push(entry);
				const epoch = `epoch-${args.sessionId}`;
				let seq = 0;
				let cancelled = false;
				const send = (frame: DesktopSessionFrame) => {
					if (cancelled) return;
					onEvent({ kind: "data", data: JSON.stringify(frame) });
				};
				void (async () => {
					await wait(latency.stream);
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
					entry.openedAt = now();
					await wait(latency.stream);
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
					entry.snapshotAt = now();
				})();
				return {
					dispose: () => {
						cancelled = true;
						onEvent({ kind: "end" });
					},
				};
			},
		},
	};

	window.api = { ...(window.api ?? {}), desktop } as typeof window.api;
	return {
		log,
		dispose: () => {
			if (previous) window.api = { ...window.api, desktop: previous };
		},
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
