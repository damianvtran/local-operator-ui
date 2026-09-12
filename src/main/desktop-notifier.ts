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
 * raises a gate notification, and a backend-composed `notification` frame
 * raises a completion or error one. Dedupe is by `session:epoch:request_id`
 * (gates) and by the backend-minted `dedupe_key` (composed notifications)
 * across every window, so two windows on one session yield one toast.
 *
 * Completion content is COMPOSED BY THE BACKEND and rendered here verbatim.
 * Only the backend can read the `display.notification_session_name` privacy
 * flag, only it can apply the snippet-iff-complete rule (a failed turn's last
 * assistant line is the success sentence from before the failure), and only
 * one composer keeps the TUI, the detached-runtime fallback and this app
 * saying the same words. This class must never re-word a title, status or
 * body. See docs/design/descriptive-notifications.md 2 and 8.
 *
 * A completion toast also CLAIMS delivery before it fires, because a TUI on
 * the same machine can see the same completion. The claim is taken last, only
 * once the toast is certain: a claim taken for a banner we then suppress would
 * mark the completion delivered while nobody was told, and no other surface
 * could ever tell them (7.3). It is not a read receipt and must never touch
 * `sessions.seen`, which would clear the sidebar's unseen mark for a session
 * the user never opened.
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
import type {
	DesktopNotification,
	DesktopSessionFrame,
	PendingDesktopGate,
} from "../shared/desktop-session-contract";

const NOTIFY_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_KEYS = 2048;

/**
 * Longest a composed notification's rendered body may be.
 *
 * The backend already bounds and sanitises each part; this is the belt-and-
 * braces bound on the CONCATENATION, which no single backend field describes.
 */
const MAX_BODY_CHARS = 240;

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
	/**
	 * `features.notification_contract` from `/v1/capabilities`; 0 means legacy.
	 *
	 * A HARD switch, not a heuristic. At >= 1 the backend owns every completion
	 * toast and the legacy event path must stay silent or one turn produces two
	 * banners. Absent or unfetchable stays 0 on purpose: a missing capability
	 * response is a transient HTTP failure far more often than it is an old
	 * backend, and failing toward silence would lose completions outright.
	 */
	private notificationContract = 0;
	/**
	 * Whether a composed `notification` frame has ever arrived on this run.
	 *
	 * The capability fetch and the frame stream are two different round trips,
	 * and only the second one is proof. A backend swapped underneath a running
	 * app (the health check restarts one, external-backend discovery finds
	 * another) can start composing notifications while `notificationContract` is
	 * still the stale 0 read at connect — and 0 means the legacy `agent_end`
	 * toast fires too, which is the double banner this whole change exists to
	 * remove. A frame in hand cannot be stale, so it latches the gate shut on
	 * its own. One-way on purpose: a backend that has composed once owns
	 * notifications for the rest of the run.
	 */
	private sawComposedNotification = false;

	constructor(
		private readonly window: () => BrowserWindow | null,
		private readonly request: (input: unknown) => Promise<DesktopResponse>,
	) {}

	get canNotify(): boolean {
		return Notification.isSupported();
	}

	/**
	 * Record what the connected backend advertises for `notification_contract`.
	 *
	 * Called at backend-connect and again whenever the backend URL rotates
	 * (external-backend discovery), because the app can move from a new backend
	 * to an old one without restarting. A non-number or a failed fetch resets to
	 * 0 rather than keeping a stale claim: keeping `1` against a backend that
	 * emits no frames is the one way this gate goes silent.
	 */
	/**
	 * Read `features.notification_contract` from the connected backend.
	 *
	 * Called once the backend is reachable and BEFORE any window exists, so the
	 * gate is settled before the first frame can arrive. A throw or a non-200
	 * leaves the gate at 0, which is the legacy path rather than silence: see
	 * `notificationContract`.
	 */
	async refreshNotificationContract(): Promise<void> {
		try {
			const response = await this.request({ op: "capabilities" });
			if (response.status !== 200) return;
			const body = response.body as {
				result?: { features?: Record<string, unknown> };
			} | null;
			this.setNotificationContract(
				body?.result?.features?.notification_contract,
			);
		} catch {
			// Unfetchable is treated as absent, deliberately. A missing capability
			// response is a transient HTTP failure far more often than it is an old
			// backend, and going silent on a transient failure loses completions.
		}
	}

	setNotificationContract(version: unknown): void {
		this.notificationContract =
			typeof version === "number" && Number.isFinite(version) && version > 0
				? version
				: 0;
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
			if (gate) this.gate(sessionId, gate);
			return;
		}
		if (frame.type === "frontend.update") {
			this.epochs.set(sessionId, frame.payload.epoch);
			const gate = frame.payload.changes.pending_gate;
			if (gate) this.gate(sessionId, gate);
			return;
		}
		if (frame.type === "notification") {
			this.sawComposedNotification = true;
			void this.composed(sessionId, frame.payload);
			return;
		}
		if (frame.type === "event") {
			// LEGACY PATH ONLY. A backend advertising `notification_contract` owns
			// every completion toast, so this must stay silent against it or the
			// user gets two banners for one turn.
			//
			// `turn_end` is dropped unconditionally, on every backend version: it
			// is ONE MODEL CALL finishing (local_operator/tui/events.py,
			// TurnBoundaryEnd), and an agentic turn is many of them. Toasting it
			// was the reported defect — "Turn complete" per step.
			//
			// `agent_end` survives here only because dropping it too would leave an
			// old backend with no completion signal at all. It is still wrong (it
			// arrives while `task` children run), which is exactly what the
			// backend-composed path fixes. The event itself is NEVER filtered out
			// of the stream: the transcript reducer settles on it.
			if (this.notificationContract > 0 || this.sawComposedNotification) return;
			if (String(frame.payload.type ?? "") === "agent_end") {
				this.turn(sessionId, frame.seq);
			}
		}
	}

	/**
	 * Deliver one backend-composed notification.
	 *
	 * The order of these four checks is load-bearing and is the whole of 7.3.
	 * Dedupe and the focus gate run BEFORE the claim so a toast we are not going
	 * to show never burns the cross-surface claim; the claim runs immediately
	 * before delivery so the claimant really is the deliverer.
	 */
	private async composed(
		sessionId: string,
		n: DesktopNotification,
	): Promise<void> {
		// Keyed on the backend's own string and nothing else: the bridge epoch
		// resets on reconnect, so any locally derived key re-toasts a completion
		// that was merely re-delivered.
		if (!this.claim(n.dedupe_key)) return;
		// A gate arrives as `always` because the user may be reading another
		// conversation in the same window; a completion is only news when nobody
		// is looking. The backend decides which; this app does not second-guess it.
		if (n.focus_policy === "when_unfocused" && this.anyFocused()) return;
		if (n.completion_token) {
			// Claim LAST, immediately before delivery: an unclaimed completion stays
			// available to another surface (a TUI on this machine), while a claim
			// taken for a toast we then suppressed would be delivered to nobody,
			// for good. See docs/design/descriptive-notifications.md 7.3.
			const won = await this.claimDelivery(sessionId, n.completion_token);
			if (!won) return;
		}
		this.show(sessionId, n.title, n.status, n.body);
	}

	/**
	 * Ask the backend whether this surface owns this completion's toast.
	 *
	 * Fails CLOSED. A rejected or non-200 claim yields no toast, because the
	 * failure mode of failing open is the duplicate banner on every surface this
	 * whole mechanism exists to prevent — and the durable signal survives either
	 * way: the session stays unseen in the sidebar.
	 */
	private async claimDelivery(
		sessionId: string,
		completionToken: string,
	): Promise<boolean> {
		try {
			const response = await this.request({
				op: "sessions.notified",
				sessionId,
				completionToken,
			});
			if (response.status !== 200) return false;
			const body = response.body as { result?: { claimed?: unknown } } | null;
			return body?.result?.claimed === true;
		} catch {
			return false;
		}
	}

	private anyFocused(): boolean {
		for (const state of this.windows.values()) {
			if (state.visible && state.focused) return true;
		}
		return false;
	}

	private gate(sessionId: string, gate: PendingDesktopGate): void {
		const { request_id: requestId, kind, title, detail } = gate;
		const key = `gate:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${requestId}`;
		if (!this.claim(key)) return;
		// A gate is worth a toast even when the window is focused: the user
		// may be reading another conversation in the same window.
		//
		// The fallback is kind-aware because an untitled `ask` used to announce
		// "Approval needed" — the wrong promise entirely: the user goes looking
		// for a yes/no button and finds a question. `kind` is already on the wire.
		const fallback = kind === "ask" ? "Question" : "Approval needed";
		// No status: a gate's own title/detail is the whole card, and inventing a
		// state category here would be this app composing copy the backend owns.
		this.show(sessionId, title || fallback, "", detail);
	}

	/**
	 * Legacy completion toast: canned copy, reached only against a backend that
	 * does not advertise `notification_contract`. Keyed on `session:epoch:seq`
	 * as it always was — an old backend mints no `dedupe_key` to key on.
	 */
	private turn(sessionId: string, seq: number): void {
		const key = `turn:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${seq}`;
		if (!this.claim(key)) return;
		// Completion is only news when nobody is looking.
		if (this.anyFocused()) return;
		this.show(sessionId, "Turn complete", "", "The agent finished its turn.");
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

	/**
	 * Render one toast.
	 *
	 * `status` leads the body rather than riding `subtitle`. Electron's
	 * `subtitle` option is documented macOS-only, so on Windows and Linux the
	 * state category would simply vanish and those users would read a bare
	 * snippet with no indication of whether the turn succeeded or failed. One
	 * shape that degrades on no platform beats a second, platform-forked one.
	 * The strings themselves are the backend's, unchanged; only the join is
	 * ours, and it is the first thing the OS shows before it clips.
	 */
	private show(
		sessionId: string,
		title: string,
		status: string,
		body: string,
	): void {
		const notification = new Notification({
			title,
			body: `${status ? `${status} — ` : ""}${body}`.slice(0, MAX_BODY_CHARS),
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
