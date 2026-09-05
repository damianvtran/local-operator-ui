/**
 * Native notifications and the desktop watch lease, owned by main.
 *
 * Why main: the backend suppresses its own OS-toast fallback while a desktop
 * lease says `can_notify`, so whoever claims that flag must actually deliver.
 * Only main can — the renderer may be hidden, throttled or gone — and only
 * main knows whether `Notification.isSupported()`. A lease claiming delivery
 * that never happens would silently swallow a pending approval.
 *
 * Frames come from the existing stream relay (one subscription per window,
 * no second connection): a `pending_gate` appearing in a snapshot or update
 * raises a gate notification; a turn-ending event raises a completion one.
 * Dedupe is by `session:epoch:request_id` (gates) and `session:epoch:seq`
 * (turns) across every window, so two windows on one session yield one toast.
 *
 * Clicking a notification asks the renderer to open that conversation. It
 * never answers a gate: approval is an explicit in-app action with identity
 * checks the click path does not carry.
 *
 * The lease is a heartbeat, not a flag: the renderer reports visibility and
 * focus every few seconds and main forwards it with `can_notify`. A crashed
 * renderer stops heartbeating, the 45s lease expires on the backend, and its
 * OS fallback resumes on its own — no cleanup path to forget.
 */

import { type BrowserWindow, Notification } from "electron";
import type { DesktopResponse } from "../shared/desktop-contract";
import type { DesktopSessionFrame } from "../shared/desktop-session-contract";

const NOTIFY_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_KEYS = 2048;

type WatchState = {
	visible: boolean;
	focused: boolean;
};

export class DesktopNotifier {
	private readonly delivered = new Map<string, number>();
	/** Last known frontend epoch per session, to key dedupe on owner epoch. */
	private readonly epochs = new Map<string, string>();
	/** Window state per (window id) used to decide whether a toast is needed. */
	private readonly windows = new Map<number, WatchState>();

	constructor(
		private readonly window: () => BrowserWindow | null,
		private readonly request: (input: unknown) => Promise<DesktopResponse>,
	) {}

	get canNotify(): boolean {
		return Notification.isSupported();
	}

	/**
	 * Renderer heartbeat. Forwarded to the backend as the watch lease for the
	 * renderer's active subscription; `can_notify` is asserted only when main
	 * can really deliver. A focused window is interactive; a visible-but-
	 * unfocused one still watches but is not; a hidden one is neither.
	 */
	async heartbeat(
		windowId: number,
		args: {
			sessionId: string;
			subscriptionId: string;
			visible: boolean;
			focused: boolean;
		},
	): Promise<DesktopResponse> {
		this.windows.set(windowId, {
			visible: args.visible,
			focused: args.focused,
		});
		return this.request({
			op: "sessions.watch",
			sessionId: args.sessionId,
			subscriptionId: args.subscriptionId,
			visible: args.visible && args.focused,
			canNotify: this.canNotify,
		});
	}

	forgetWindow(windowId: number): void {
		this.windows.delete(windowId);
	}

	/** Called by the stream relay for every parsed frame it forwards. */
	observe(sessionId: string, frame: DesktopSessionFrame): void {
		if (!this.canNotify) return;
		if (frame.type === "snapshot") {
			this.epochs.set(sessionId, frame.payload.frontend.epoch);
			const gate = frame.payload.frontend.snapshot.pending_gate;
			if (gate) this.gate(sessionId, gate.request_id, gate.title, gate.detail);
			return;
		}
		if (frame.type === "frontend.update") {
			this.epochs.set(sessionId, frame.payload.epoch);
			const gate = frame.payload.changes.pending_gate;
			if (gate) this.gate(sessionId, gate.request_id, gate.title, gate.detail);
			return;
		}
		if (frame.type === "event") {
			const eventType = String(frame.payload.type ?? "");
			if (eventType === "agent_end" || eventType === "turn_end") {
				this.turn(sessionId, frame.seq);
			}
		}
	}

	private anyFocused(): boolean {
		for (const state of this.windows.values()) {
			if (state.visible && state.focused) return true;
		}
		return false;
	}

	private gate(
		sessionId: string,
		requestId: string,
		title: string,
		detail: string,
	): void {
		const key = `gate:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${requestId}`;
		if (!this.claim(key)) return;
		// A gate is worth a toast even when the window is focused: the user
		// may be reading another conversation in the same window.
		this.show(sessionId, title || "Approval needed", detail);
	}

	private turn(sessionId: string, seq: number): void {
		const key = `turn:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${seq}`;
		if (!this.claim(key)) return;
		// Completion is only news when nobody is looking.
		if (this.anyFocused()) return;
		this.show(sessionId, "Turn complete", "The agent finished its turn.");
	}

	private claim(key: string): boolean {
		const now = Date.now();
		const seen = this.delivered.get(key);
		if (seen !== undefined && now - seen < NOTIFY_TTL_MS) return false;
		this.delivered.set(key, now);
		if (this.delivered.size > MAX_DEDUPE_KEYS) {
			// Evict oldest first; the map preserves insertion order.
			const oldest = this.delivered.keys().next().value;
			if (oldest !== undefined) this.delivered.delete(oldest);
		}
		return true;
	}

	private show(sessionId: string, title: string, body: string): void {
		const notification = new Notification({
			title,
			body: body.slice(0, 240),
			silent: false,
		});
		notification.on("click", () => {
			const target = this.window();
			if (!target) return;
			if (target.isMinimized()) target.restore();
			target.show();
			target.focus();
			// The renderer decides how to open the conversation; main only
			// names it. Nothing here touches the gate.
			target.webContents.send("desktop-open-conversation", { sessionId });
		});
		notification.show();
	}
}
