/**
 * The machine-wide desktop feed: one authenticated subscription held by MAIN,
 * with no window in the loop.
 *
 * WHY THIS EXISTS. Every notification path before it was per-session: the
 * bridge was created while a route held one, and the desktop opened exactly one
 * such route — the conversation on screen. So with the app running and focused
 * on session A, a completion in session B produced no composed frame, no
 * banner, nothing; the only signal was the sidebar's unseen mark, five seconds
 * late, from a `sessions.list` poll that is not cheap. With the window closed
 * and the app alive in the dock — the operator's own reported case — nobody
 * announced it at all.
 *
 * The fix is one global SSE route the backend owns, and this class is its
 * client. Three properties are load-bearing rather than incidental:
 *
 * 1. **It runs with no window.** The subscription is held by main, so
 *    closing the last window does not stop it. Frames are forwarded to a window
 *    when there is one and dropped when there is not; the banner path is the
 *    notifier, which is main's.
 * 2. **It is capability-gated and a no-op without the capability.** An older
 *    backend does not advertise `features.desktop_feed`, so no socket is
 *    opened and no presence is beaten — and, because the renderer's catalogue
 *    polling is gated on the same key, an old backend keeps the 5 s poll it has
 *    always had. Neither skew direction can double-toast.
 * 3. **Silence is an error.** A half-open socket after sleep/wake is
 *    indistinguishable from a quiet machine if "no frames" is treated as
 *    normal: the app looks connected while nothing can reach it, which is
 *    strictly worse than the five-second poll it replaced. Three missed
 *    heartbeats therefore tear the socket down and reconnect.
 *
 * The frames are the SESSION envelope's shape (`DesktopFeedFrame`), and a
 * `notification` frame's payload is the bridge's payload verbatim — same
 * `dedupe_key`. That is what lets `DesktopNotifier.observe` consume either
 * source unchanged and collapse a pair into one banner.
 */

import type {
	DesktopFeedState,
	DesktopResponse,
} from "../shared/desktop-contract";
import {
	type DesktopFeedFrame,
	FEED_NOTIFIABLE_KINDS,
} from "../shared/desktop-session-contract";

/** The backend's own beat, used until an `open` frame says otherwise. */
const DEFAULT_HEARTBEAT_SECONDS = 15;

/**
 * The bounds a backend-supplied cadence is clamped into.
 *
 * The value sizes a local liveness bound, so it is not free: under a second,
 * ordinary jitter on a loaded machine reads as three missed beats and the feed
 * reconnects on a healthy socket; over a minute, a genuinely dead socket stays
 * unnoticed for that long.
 */
const MIN_HEARTBEAT_SECONDS = 1;
const MAX_HEARTBEAT_SECONDS = 60;

/**
 * How many missed heartbeats mean the socket is dead.
 *
 * Three, matching the presence lease's own 3-beats-per-TTL relationship: one
 * missed beat is a loaded machine or a GC pause, two is suspicious, three is
 * longer than the backend would ever take to notice a beat is missing. A
 * shorter bound reconnects on ordinary jitter and would churn the feed during
 * exactly the load that makes the mark late.
 */
const MISSED_HEARTBEATS = 3;

/** Reconnect pacing. Bounded at both ends so a dead backend is not hammered. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** How often the presence lease is renewed. Three beats per 45 s TTL. */
const PRESENCE_INTERVAL_MS = 15_000;

/** Watchdog tick. Fine enough to bound detection, coarse enough to be free. */
const WATCHDOG_TICK_MS = 1_000;

/** `data:` lines carry one optional space after the colon, which SSE strips. */
const SSE_DATA_PREFIX = /^ /;

/** One relay frame's ceiling, matching the backend's per-frame bound. */
const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type DesktopFeedOptions = {
	/**
	 * Ask the backend what it advertises. The gate, and the reason no socket is
	 * opened against a backend that cannot serve one.
	 */
	request: (input: unknown) => Promise<DesktopResponse>;
	/**
	 * Renew the machine-wide presence lease against the live subscription.
	 *
	 * A route rather than a local file because the desktop may be paired to a
	 * backend on another host and cannot write to that host's disk — and because
	 * the server holds the lease against this socket, so a dropped feed revokes
	 * the claim instead of leaving a stale "somebody is here" for a full TTL.
	 */
	beatPresence: (presence: {
		subscriptionId: string;
		canNotify: boolean;
		/** What this app can deliver over the feed; see the contract's note. */
		canNotifyKinds: readonly ("complete" | "error")[];
		/** The conversation a window is displaying, or "" for none. */
		sessionId: string;
		window: {
			exists: boolean;
			focused: boolean;
			visible: boolean;
			minimized: boolean;
		};
	}) => Promise<DesktopResponse>;
	/**
	 * What THIS app can say about its own window right now.
	 *
	 * Injected rather than read from the relay because the relay is transport:
	 * the window, its focus and the conversation it displays are main's facts,
	 * and the notifier is the one place that keeps them (it already tracks them
	 * for the session-scoped suppression). A relay that guessed would be a
	 * second opinion about which conversation is on screen.
	 *
	 * Absent means a windowless app, which is a real state rather than a missing
	 * value: macOS keeps the app alive in the dock with no window, and such an
	 * app can raise a banner but cannot be displaying anything.
	 */
	/**
	 * How often the presence lease is renewed.
	 *
	 * Injectable so a test can reach a SECOND beat without waiting out the
	 * production cadence - three beats per the lease's 45 s TTL is the default
	 * and the value that must ship.
	 */
	presenceIntervalMs?: number;
	presenceContext?: () => {
		sessionId: string;
		window: {
			exists: boolean;
			focused: boolean;
			visible: boolean;
			minimized: boolean;
		};
	} | null;
};

export class DesktopFeedRelay {
	private controller: AbortController | null = null;
	/**
	 * The live body reader, so the watchdog can END the read rather than only
	 * signal the fetch.
	 *
	 * Aborting the controller is not enough on its own to be sure of this: it
	 * aborts a fetch in flight, and whether that also rejects a body read already
	 * in progress is the platform's business (undici does; a test double need
	 * not). `cancel()` is the reader's own guarantee — the pending `read()`
	 * resolves `done` and the pump reconnects — so the watchdog does not depend
	 * on a behaviour it cannot assert here.
	 */
	private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	private running = false;
	private stopped = false;
	private connected = false;
	private subscriptionId: string | null = null;
	private heartbeatMs = DEFAULT_HEARTBEAT_SECONDS * 1000;
	private lastFrameAt = 0;
	private watchdog: NodeJS.Timeout | null = null;
	private presence: NodeJS.Timeout | null = null;
	private reconnectTimer: NodeJS.Timeout | null = null;
	/**
	 * Settles the promise `pause()` is parked on.
	 *
	 * The timer IS the only thing that would resolve it, so a `stop()` that only
	 * cleared the timer left `pump()` awaiting a promise nothing could settle — a
	 * leak nobody would find later (the relay refuses to restart, so it had no
	 * visible symptom). Held so teardown ends the wait explicitly.
	 */
	private reconnectResolve: (() => void) | null = null;
	private attempt = 0;

	/**
	 * Single observer per kind, not a subscriber set.
	 *
	 * The relay has exactly two consumers and both are main's: one fan-out that
	 * puts a frame in front of the notifier and (when a window exists) in front
	 * of the renderer, and one that mirrors the connection state to the sidebar.
	 * A set would suggest that consumers can come and go independently, and the
	 * lifecycle here is the opposite of that — the observers are re-attached
	 * whenever the relay is rebuilt for a rotated backend URL, which is a thing
	 * this class cannot do for itself.
	 */
	private frameObserver: ((frame: DesktopFeedFrame) => void) | null = null;
	private stateObserver: ((state: DesktopFeedState) => void) | null = null;

	constructor(
		private readonly backendUrl: string,
		private readonly token: string | null,
		private readonly options: DesktopFeedOptions,
	) {}

	get isConnected(): boolean {
		return this.connected;
	}

	/** True when this relay can authenticate at all. */
	get available(): boolean {
		return Boolean(this.token);
	}

	observe(observer: ((frame: DesktopFeedFrame) => void) | null): void {
		this.frameObserver = observer;
	}

	watchState(observer: ((state: DesktopFeedState) => void) | null): void {
		this.stateObserver = observer;
		// An immediate answer, so a subscriber that joins after a reconnect does
		// not render "disconnected" until the next transition.
		observer?.({ connected: this.connected });
	}

	/**
	 * Open the feed if the backend supports it. Idempotent, and safe to call
	 * again on every backend-ready transition: a restart or an
	 * external-backend rotation re-runs the capability gate against the backend
	 * that is actually there now.
	 */
	async start(): Promise<void> {
		if (this.running || this.stopped) return;
		if (!this.token) {
			this.setConnected(false);
			return;
		}
		this.running = true;
		let features: Record<string, unknown> | undefined;
		try {
			const response = await this.options.request({ op: "capabilities" });
			const body = response.body as {
				result?: { features?: Record<string, unknown> };
			} | null;
			features = body?.result?.features;
		} catch {
			// Unreachable says nothing about what the backend supports, so the
			// feed stays closed. The renderer keeps the 5 s catalogue poll it
			// falls back to when the capability is absent, so nothing is lost but
			// latency, and the next backend-ready transition retries.
			this.running = false;
			this.setConnected(false);
			return;
		}
		if (this.stopped) return;
		if (!(Number(features?.desktop_feed ?? 0) >= 1)) {
			this.running = false;
			this.setConnected(false);
			return;
		}
		void this.pump();
	}

	/** Tear everything down. Idempotent. */
	stop(): void {
		this.stopped = true;
		this.running = false;
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		this.reconnectResolve?.();
		this.reconnectResolve = null;
		this.endSocket();
		this.setConnected(false);
	}

	/** Abort the socket and its timers, leaving `stopped` alone. */
	private endSocket(): void {
		if (this.watchdog) {
			clearInterval(this.watchdog);
			this.watchdog = null;
		}
		if (this.presence) {
			clearInterval(this.presence);
			this.presence = null;
		}
		this.subscriptionId = null;
		this.controller?.abort();
		this.controller = null;
	}

	/** Read until the socket ends, then pace a reconnect. */
	private async pump(): Promise<void> {
		while (!this.stopped) {
			// The loop IS the reconnect: `readOnce` returns on end, error or watchdog.
			await this.readOnce();
			if (this.stopped) return;
			this.setConnected(false);
			// Paced, so a dead backend is retried without being hammered.
			await this.pause();
		}
	}

	private pause(): Promise<void> {
		const delay = Math.min(
			RECONNECT_MAX_MS,
			RECONNECT_MIN_MS * 2 ** Math.min(this.attempt, 5),
		);
		this.attempt += 1;
		return new Promise((resolve) => {
			this.reconnectResolve = resolve;
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = null;
				this.reconnectResolve = null;
				resolve();
			}, delay);
			this.reconnectTimer.unref?.();
		});
	}

	private async readOnce(): Promise<void> {
		const controller = new AbortController();
		this.controller = controller;
		const url = new URL("/v1/desktop/events", this.backendUrl);
		try {
			const response = await fetch(url, {
				headers: {
					Accept: "text/event-stream",
					Authorization: `Bearer ${this.token}`,
				},
				redirect: "error",
				signal: controller.signal,
			});
			if (!response.ok || !response.body) {
				// Includes 401/403/503, which are all "this app cannot hold the
				// feed": no frames follow, and the reconnect below retries once
				// the backend is reachable again.
				return;
			}
			this.attempt = 0;
			this.setConnected(true);
			this.startWatchdog();
			const reader = response.body.getReader();
			this.reader = reader;
			const decoder = new TextDecoder();
			let buffer = "";
			for (;;) {
				// Reads are serial by nature; the watchdog is what bounds a stall.
				const { done, value } = await reader.read();
				if (done) break;
				// ANY byte resets the watchdog, not just a heartbeat: a busy feed
				// is alive by definition, and the heartbeat exists for the quiet
				// case rather than as a cadence to be checked for its own sake.
				this.lastFrameAt = Date.now();
				buffer += decoder.decode(value, { stream: true });
				for (;;) {
					const boundary = buffer.indexOf("\n\n");
					if (boundary < 0) {
						if (buffer.length > MAX_FRAME_BYTES) {
							reader.cancel().catch(() => undefined);
							return;
						}
						break;
					}
					const record = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					for (const line of record.split("\n")) {
						if (!line.startsWith("data:")) continue;
						this.dispatch(line.slice(5).replace(SSE_DATA_PREFIX, ""));
					}
				}
			}
		} catch {
			// An aborted fetch is the watchdog's own teardown and a network error
			// is what the reconnect exists for; neither is worth a log line a user
			// would see.
		} finally {
			if (this.controller === controller) this.controller = null;
			this.reader = null;
			if (this.watchdog) {
				clearInterval(this.watchdog);
				this.watchdog = null;
			}
			if (this.presence) {
				clearInterval(this.presence);
				this.presence = null;
			}
			this.subscriptionId = null;
		}
	}

	private dispatch(data: string): void {
		let frame: DesktopFeedFrame;
		try {
			frame = JSON.parse(data) as DesktopFeedFrame;
		} catch {
			// A malformed frame is skipped rather than fatal: the feed is
			// live-only with no replay, so there is nothing to repair and the
			// next frame is unaffected.
			return;
		}
		if (frame.type === "open") {
			this.subscriptionId = frame.payload.subscription_id;
			/*
			 * The backend's cadence sizes a LOCAL liveness bound, so it is clamped
			 * rather than trusted: a value under a second would make ordinary jitter
			 * on a loaded machine look like three missed beats, and the feed would
			 * tear down and reconnect on a healthy socket. The ceiling matters for
			 * the same reason in reverse — a cadence far longer than any real one
			 * would leave a dead socket unnoticed for that long.
			 */
			if (typeof frame.payload.heartbeat_seconds === "number") {
				this.heartbeatMs =
					Math.min(
						MAX_HEARTBEAT_SECONDS,
						Math.max(MIN_HEARTBEAT_SECONDS, frame.payload.heartbeat_seconds),
					) * 1000;
			}
			this.startPresence();
		}
		try {
			this.frameObserver?.(frame);
		} catch {
			// A consumer's failure must not stop the feed: the notifier and the
			// window are independent consumers, and a renderer that has gone away
			// mid-send must not close a socket that is still carrying banners.
		}
	}

	/**
	 * Tear the socket down when it has gone quiet for three heartbeats.
	 *
	 * A half-open socket reports no error, no end and no data: the reader simply
	 * never resolves. Without this the app would look connected while no
	 * completion could reach it, which is the silent-failure state this whole
	 * change exists to remove.
	 */
	private startWatchdog(): void {
		this.lastFrameAt = Date.now();
		if (this.watchdog) clearInterval(this.watchdog);
		this.watchdog = setInterval(() => {
			if (Date.now() - this.lastFrameAt < this.heartbeatMs * MISSED_HEARTBEATS)
				return;
			// `cancel` ends the outstanding read and `abort` closes the socket;
			// `readOnce`'s finally block then clears the timers and `pump`
			// reconnects.
			void this.reader?.cancel().catch(() => undefined);
			this.controller?.abort();
		}, WATCHDOG_TICK_MS);
		this.watchdog.unref?.();
	}

	/**
	 * Renew the presence lease for as long as this subscription is live.
	 *
	 * The first beat is immediate: the backend holds the lease against the
	 * subscription, so waiting a full interval would leave a window in which the
	 * app can deliver a banner while the backend still believes nobody is there
	 * and toasts on its own host instead.
	 */
	private startPresence(): void {
		if (this.presence) clearInterval(this.presence);
		const beat = () => {
			const subscriptionId = this.subscriptionId;
			if (!subscriptionId) return;
			/*
			 * Read at EVERY beat, not captured at construction: the relay is built
			 * when the backend becomes reachable and this answer changes the moment
			 * a window opens or the user navigates. A captured value would report
			 * the state at relay-construction for the lifetime of the lease.
			 */
			const context = this.options.presenceContext?.() ?? {
				sessionId: "",
				window: {
					exists: false,
					focused: false,
					visible: false,
					minimized: false,
				},
			};
			void this.options
				.beatPresence({
					subscriptionId,
					canNotify: true,
					// Always the FEED's kinds, never a window's: this app delivers a
					// completion window or no window, which is why the feed exists.
					canNotifyKinds: FEED_NOTIFIABLE_KINDS,
					sessionId: context.sessionId,
					window: context.window,
				})
				.catch(() => undefined);
		};
		beat();
		this.presence = setInterval(
			beat,
			this.options.presenceIntervalMs ?? PRESENCE_INTERVAL_MS,
		);
		this.presence.unref?.();
	}

	private setConnected(connected: boolean): void {
		if (this.connected === connected) return;
		this.connected = connected;
		try {
			this.stateObserver?.({ connected });
		} catch {
			// As above: a subscriber cannot break the feed.
		}
	}
}
