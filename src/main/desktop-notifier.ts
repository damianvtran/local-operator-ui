/**
 * Native notifications and the desktop watch lease, owned by main.
 *
 * Why main: the backend suppresses its own OS-toast fallback while a desktop
 * lease says `can_notify`, so whoever claims that flag must actually deliver.
 * Only main can — the renderer may be hidden, throttled or gone — and only
 * main knows whether `Notification.isSupported()`. A lease claiming delivery
 * that never happens would silently swallow a pending approval.
 *
 * Frames come from TWO subscriptions. The per-window stream relay carries the
 * conversation on screen (one subscription per window, no second connection),
 * and the machine-wide feed (`desktop-feed.ts`) carries the sessions no window
 * holds at all — which is the case the app was silent about, and the one that
 * matters when the last window is closed and the app is alive in the dock. Both
 * land in `observe`, and the backend's own `dedupe_key` collapses a pair into
 * one banner. A `pending_gate` appearing in a snapshot or update raises a gate
 * notification, and a backend-composed `notification` frame raises a completion
 * or error one. Dedupe is by `session:epoch:request_id`
 * (gates) and by the backend-minted `dedupe_key` (composed notifications)
 * across every window, so two windows on one session yield one toast.
 *
 * Which path raises a completion is decided by ONE fact, read from the
 * backend: `features.notification_contract`. The legacy `agent_end` toast is
 * deferred until that read settles rather than racing it, because `agent_end`
 * arrives before the composed frame and a guess of "no contract" while the
 * answer is still in flight is exactly the two-banners-per-turn defect. The
 * read is re-issued every time the backend becomes reachable, which is also
 * how a downgrade to an older backend gets its legacy signal back.
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
	DesktopFeedFrame,
	DesktopNotification,
	DesktopSessionFrame,
	PendingDesktopGate,
} from "../shared/desktop-session-contract";
import type { WindowShow } from "./window-mode";
import { type RaiseReport, raiseWindow } from "./window-raise";

const NOTIFY_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_KEYS = 2048;

/**
 * Bounded retry for the capability read.
 *
 * The read is issued once the backend service reports itself up, so the first
 * attempt normally answers. These retries cover the narrow window where
 * `/health` is answering but `/v1/capabilities` transiently is not. The budget
 * is deliberately under a second in total: while a probe is unsettled the
 * legacy completion toast is DEFERRED, not dropped, and a user waiting on a
 * completion banner must never wait longer than they would notice.
 */
const CONTRACT_PROBE_ATTEMPTS = 3;
const CONTRACT_PROBE_RETRY_MS = 250;

/**
 * Longest a composed notification's rendered body may be.
 *
 * The backend already bounds and sanitises each part; this is the belt-and-
 * braces bound on the CONCATENATION, which no single backend field describes.
 */
const MAX_BODY_CHARS = 240;

/** `rstrip(":")` from the backend's `gate_body`, hoisted per `useTopLevelRegex`. */
const TRAILING_COLONS = /:+$/;

/**
 * The house body for a gate with nothing to say, COPIED FROM THE BACKEND.
 *
 * These are `local_operator/tui/notify.py`'s `BODY_APPROVAL` and `BODY_ASK`,
 * reached through `BODIES` in `local_operator/notifications/compose.py`. They
 * are duplicated here rather than fetched because a gate banner must render
 * with no extra round trip, and the backend does not put them on the
 * `pending_gate` payload (unlike a completion, which arrives pre-composed).
 *
 * IF THESE DRIFT FROM THE BACKEND CONSTANTS THE TWO SURFACES SAY DIFFERENT
 * WORDS FOR THE SAME STATE. `gateBody` below mirrors `compose.py::gate_body`
 * and is pinned against that function's own test vectors in
 * `scripts/desktop-notifier.test.mjs` (T-U17), which is the only drift check
 * available across two repositories.
 */
const GATE_BODIES: Record<string, string> = {
	ask: "Waiting for your answer",
	approval: "Waiting for approval",
};

/**
 * The body for a parked `ask`/`approval`: the action, or the sentence.
 *
 * A DIRECT MIRROR of `local_operator/notifications/compose.py::gate_body`,
 * down to the trailing-colon trim, so the desktop banner and the backend's own
 * OS fallback cannot word the same gate differently.
 *
 * NOT `${gateTitle}: ${gateDetail}`. A tool's `describe_approval` already
 * leads with its own action word (`_describe_path_approval` emits `"write:
 * /path"`) and the gate's title IS the tool name, so the naive form rendered
 * every file and shell approval as `"write: write: /path"` — on the banner the
 * user is actually blocked on (design review round 2, D3-1). The prefix is
 * applied only when the detail does not already carry it.
 *
 * An empty detail falls back to the house vocabulary rather than to the bare
 * tool name: `write` alone says less than `Waiting for approval`, and it is
 * reachable without a malformed payload — `_describe_path_approval` returns
 * `""` for a blank path argument (D3-2).
 *
 * `gateTitle` is passed EMPTY when the caller already shows it on the title
 * line, which is the one input shape the backend never has: there the title
 * slot is the session name, so the gate title has nowhere else to go.
 */
function gateBody(kind: string, gateTitle: string, gateDetail: string): string {
	let subject = (gateDetail ?? "").trim();
	if (
		subject &&
		gateTitle &&
		!subject.toLowerCase().startsWith(gateTitle.toLowerCase())
	) {
		// `rstrip(":")` in the original: a detail that itself ends in a colon
		// would otherwise render a dangling separator.
		subject = `${gateTitle}: ${subject}`
			.trim()
			.replace(TRAILING_COLONS, "")
			.trim();
	}
	return subject || GATE_BODIES[kind] || GATE_BODIES.approval;
}

/**
 * Whether a frame is a BURST DIGEST rather than one conversation's completion.
 *
 * Read from the fields, never from the title: the backend caps per-tick banners
 * and composes ONE frame for the remainder with `burst_count` and `session_ids`
 * on it (`_digest_payload`), and `session_id` is set to the last overflow member
 * only because a session frame must name a session. Matching on the strings
 * would make this routing decision depend on wording the backend owns.
 */
function isBurstDigest(n: DesktopNotification): boolean {
	return (n.burst_count ?? 0) > 1 || (n.session_ids?.length ?? 0) > 1;
}

/**
 * How many MEMBERS a frame names: the completions one banner stands for.
 *
 * A SEPARATE QUESTION FROM `isBurstDigest`, and asking the wrong one is R3-1.
 * The backend composes a digest for the per-tick overflow whatever its SIZE —
 * `overflow = candidates[BURST_LIMIT:]` over a ceiling of 3 — so the commonest
 * overflow is a SINGLE member, and that frame's `burst_count` and `session_ids`
 * are both 1. `isBurstDigest` is therefore false for it, the claim step was
 * skipped entirely, and its member stayed claimable: a second surface could
 * announce the same completion again, which is the duplicate-banner hole R2-5
 * exists to close. The member marker is the field the backend sends for exactly
 * this purpose, and the only one that does not depend on the overflow's size.
 */
function digestMemberCount(n: DesktopNotification): number {
	/*
	 * CLAIMABLE PAIRS, not raw array entries (review round 5, R5-2). The claim loop
	 * below skips a pair that carries no id or no token, so counting raw length made
	 * the two disagree about what a member is: `[{session_id: "", completion_token:
	 * ""}]` is type-legal, claims nothing, and counted as one member — which sent the
	 * frame down the "every member is somebody else's" path and dropped its banner
	 * (0 banners in the probe). One definition, read by both.
	 */
	return (n.member_tokens ?? []).filter(
		(member) => !!member?.session_id && !!member?.completion_token,
	).length;
}

/**
 * The collaborators a caller gets by saying nothing.
 *
 * Named rather than inlined so the one place that accepts "no host" is
 * greppable, and so the reasoning sits where the default does. A test that
 * builds a notifier to exercise delivery alone is the caller: it has no windows
 * and no click to serve, so "always alive" and "nothing to reopen" are the
 * honest answers there rather than a convenience. Production always passes a
 * real host (`index.ts`), which is what makes the click path unable to become a
 * silent no-op again.
 */
const SILENT_HOST: DesktopNotifierHost = {
	windowAlive: () => true,
	noteDisplayed: () => undefined,
	reopen: () => undefined,
};

/**
 * How long a renderer's report of what it is displaying stays believed.
 *
 * THREE BEATS, matching the watch lease the renderer renews every 15 s and the
 * 45 s TTL everything else about presence uses, so "the renderer is still there"
 * reads the same way here as everywhere else.
 *
 * WHY A REPORT EXPIRES AT ALL (review round 2, R2-4). The map is cleared when a
 * WINDOW closes, but a pane that navigates away neither closes the window nor
 * sends anything — so the last report stood for the life of the process and the
 * machine-wide presence kept renewing a conversation no pane was displaying. The
 * backend believes fresh presence, so it then suppressed that session's feed
 * banner while the completion was on nobody's screen.
 *
 * Deliberately separate from whether this app can NOTIFY: a windowless app can
 * raise a completion banner perfectly well and must keep doing so. What expires
 * is the claim to be DISPLAYING a conversation.
 */
const RENDERER_REPORT_TTL_MS = 45_000;

type WatchState = {
	visible: boolean;
	focused: boolean;
	/**
	 * When the renderer last reported this state, on the Node clock.
	 *
	 * Read by `presence()` and `anyDisplayingFocused` through
	 * `RENDERER_REPORT_TTL_MS`: a report is evidence with an age, not a standing
	 * fact (review round 2, R2-4).
	 */
	seenAt: number;
	/**
	 * The conversation this window is DISPLAYING, from the renderer's own watch
	 * heartbeat. Not decoration: the completion gate is session-scoped (B1), and
	 * without this the notifier can only answer "is any window focused", which is
	 * the predicate that swallowed every background completion while the user sat
	 * in the app on another conversation.
	 *
	 * `""` means the renderer is not displaying one: it has not named one yet (it
	 * is still booting), or it has withdrawn the one it had because the pane left
	 * the conversation. Deliberately NOT a wildcard: an unnamed window suppresses
	 * nothing.
	 */
	session: string;
};

/**
 * What a click on a banner needs from the app that owns the windows.
 *
 * The notifier owns DELIVERY and the app owns WINDOWS, and the two cannot be
 * the same object without the notifier importing `createWindow` from the entry
 * point. A caller that says nothing gets `SILENT_HOST` below — which is the
 * honest answer for a unit test with no windows and no click to serve, and is
 * why production must pass a real one: a `reopen` that does nothing would be
 * exactly the silent no-op this change removes.
 */
export type DesktopNotifierHost = {
	/**
	 * Whether a window we have heard a heartbeat from is still there.
	 *
	 * A window can disappear without a `closed` event reaching the notifier — a
	 * renderer process that dies takes its `webContents` id with it — so the
	 * heartbeat map is filtered through this on every read rather than trusted.
	 */
	windowAlive: (windowId: number) => boolean;
	/**
	 * The conversation the renderer has just reported it is DISPLAYING.
	 *
	 * Called from the watch heartbeat, which is the only place main learns this,
	 * and it has two consumers main owns: the viewer record's `current_session`
	 * (so a click can route here and can skip a redundant switch), and the held
	 * first present of a click-created window — that report is the "conversation
	 * is on screen" milestone a window milestone cannot stand in for (B3).
	 *
	 * It is a callback rather than something the notifier does itself because
	 * neither consumer has anything to do with delivery.
	 */
	noteDisplayed: (sessionId: string) => void;
	/**
	 * Recreate the window if there is none, and open this conversation in it.
	 *
	 * Called ONLY when there is no window: with one, the notifier sends and
	 * raises directly, because the renderer is already mounted and can take the
	 * message. Recreation lives in the app because it owns `createWindow` and the
	 * readiness handshake that makes a click-created window safe to show (B3).
	 *
	 * `null` is a real target and not a missing value: it is the catalogue. A
	 * burst digest names a COUNT of conversations, so the click has no single
	 * conversation to open and must land where all of them are listed.
	 */
	reopen: (sessionId: string | null) => void;
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
	 * The capability read in flight, or the last one that settled.
	 *
	 * `null` only before the first read is ever issued.
	 */
	private contractProbe: Promise<void> | null = null;
	/**
	 * Generation of the newest capability read, so the LAST-STARTED one wins.
	 *
	 * Probes are not idempotent and they overlap: the backend-ready hook can
	 * fire twice in a tick (external-backend discovery and `start()` both
	 * reported ready), a health-check restart can fire it while an earlier probe
	 * is still retrying, and `awaitContract` starts one of its own. Without this
	 * the shared fields are written by whichever probe SETTLES last, which on a
	 * transient blip is the older read — a successful answer clobbered by a
	 * stale failure, decided by timing rather than by recency (review round 2,
	 * R2-2).
	 *
	 * A superseded probe therefore writes nothing at all and returns. It is not
	 * cancelled — its in-flight `fetch` is left to settle on its own, because
	 * the only cost is one wasted response and the alternative is threading an
	 * `AbortSignal` through the desktop transport for no user-visible gain.
	 */
	private contractGeneration = 0;
	/**
	 * Whether a capability read has ever come back with a real HTTP answer.
	 *
	 * This is the distinction that closes the double-banner window BY
	 * CONSTRUCTION. A `notificationContract` of 0 has three causes that look
	 * identical on the field alone: the backend answered and has no contract
	 * (old backend, legacy path is correct), nobody has asked yet, and the ask
	 * never reached a backend at all. Only the first is an answer. The other two
	 * are the cold start the review reproduced — the read went to a port nothing
	 * was listening on, was swallowed, and the legacy `agent_end` toast then
	 * fired alongside the composed frame, two banners for one turn.
	 *
	 * So the legacy path re-asks until it has a genuine answer rather than
	 * reading an unanswered 0 as "no contract". Failing toward the legacy path
	 * rather than toward silence (design 4.3) is preserved: once a bounded probe
	 * really has failed at the moment the toast is due, the toast is raised.
	 *
	 * ONCE TRUE THIS AND `notificationContract` MOVE ONLY TOGETHER. A failed
	 * probe that reset the value while leaving this true produced a pair meaning
	 * "we were told there is no contract" when in fact we were told nothing, and
	 * `awaitContract` then declined to re-ask — the double banner returned and
	 * STAYED, every turn, until the next backend bounce (review round 2, R2-1).
	 */
	private contractAnswered = false;

	constructor(
		private readonly window: () => BrowserWindow | null,
		private readonly request: (input: unknown) => Promise<DesktopResponse>,
		/**
		 * How this process is allowed to raise its window, from the resolved
		 * launch plan. In `headless` no banner is delivered at all: the run has
		 * nobody at the screen, so a toast would interrupt whoever IS at the
		 * screen, and the banner's own click handler is a path that would raise a
		 * window that mode promises never to show.
		 *
		 * Defaults to `focus`, which is the shipped behaviour, so a caller that
		 * says nothing keeps the app it has today.
		 */
		private readonly windowRaise: WindowShow = "focus",
		/** Window state the notifier cannot see from here. See the type. */
		private readonly host: DesktopNotifierHost = SILENT_HOST,
		/**
		 * Where the click's raise reports itself, threaded in rather than imported so
		 * this module keeps its one dependency on Electron (`Notification`) and the
		 * desktop suite keeps bundling it without a logger. Omitted means silent,
		 * which is what a caller with no log sink wants and never "unordered".
		 */
		private readonly raiseReport?: RaiseReport,
	) {}

	get canNotify(): boolean {
		return Notification.isSupported();
	}

	/**
	 * Read `features.notification_contract` from the connected backend.
	 *
	 * Call this every time the backend becomes reachable — first start, a health
	 * check restarting it, external-backend discovery rotating the URL. It is
	 * wired to `BackendServiceManager.onBackendReady` for exactly that reason:
	 * issuing it earlier (inside `app.whenReady()`) queries a port nothing is
	 * listening on yet on the ordinary self-managed cold start, and a swallowed
	 * failure there leaves the gate on the legacy path against a backend that
	 * composes — two banners for one turn.
	 *
	 * Re-reading is also the downgrade story the design names (4.3): an app
	 * pointed from a new backend at an old one re-reads 0 and gets its legacy
	 * completion signal back. The previous one-way latch could not do that.
	 *
	 * A throw or a non-200 after the bounded retry leaves the gate at 0, which
	 * is the legacy path rather than silence: see `notificationContract`.
	 */
	refreshNotificationContract(): Promise<void> {
		const generation = ++this.contractGeneration;
		const probe = this.probeNotificationContract(generation);
		this.contractProbe = probe;
		return probe;
	}

	private async probeNotificationContract(generation: number): Promise<void> {
		for (let attempt = 0; attempt < CONTRACT_PROBE_ATTEMPTS; attempt++) {
			let response: DesktopResponse | null = null;
			try {
				response = await this.request({ op: "capabilities" });
			} catch {
				// Unfetchable is retried, then treated as nothing learned. A missing
				// capability response is a transient HTTP failure far more often than
				// it is an old backend, and going silent on a transient failure loses
				// completions.
			}
			// Checked AFTER the await and before any write: a newer read has been
			// started against a backend this one may no longer describe, and the
			// newest read is the only one entitled to decide.
			if (generation !== this.contractGeneration) return;
			if (response?.status === 200) {
				const body = response.body as {
					result?: { features?: Record<string, unknown> };
				} | null;
				// A 200 is an ANSWER even when the key is absent: that is an old
				// backend, and retrying would only delay the legacy path it wants.
				this.applyNotificationContract(
					body?.result?.features?.notification_contract,
				);
				this.contractAnswered = true;
				return;
			}
			if (attempt + 1 < CONTRACT_PROBE_ATTEMPTS) {
				await new Promise((resolve) =>
					setTimeout(resolve, CONTRACT_PROBE_RETRY_MS),
				);
				if (generation !== this.contractGeneration) return;
			}
		}
		// EVERY ATTEMPT FAILED, SO NOTHING IS WRITTEN. A failure teaches nothing
		// about the backend, and the two fields this could touch mean different
		// things together than apart:
		//
		// - Never answered: `notificationContract` is already 0 (the only writers
		//   are the 200 path and `setNotificationContract`, both of which set
		//   `contractAnswered`), so a reset here was always a no-op. The legacy
		//   path re-asks on the next `awaitContract`, which is the cold-start fix.
		// - Already answered: resetting the value while leaving `contractAnswered`
		//   true asserted "the backend told us it has no contract" on the strength
		//   of a read that reached no backend at all. A health-check restart whose
		//   `/health` recovers before `/v1/capabilities` finishes warming hit this
		//   on an ordinary run, and the legacy toast then fired against a still
		//   composing backend on EVERY subsequent turn (R2-1).
		//
		// Holding a stale `1` cannot go silent on completions in exchange: the
		// legacy toast is raised by `agent_end`, which arrives on the same backend
		// stream, so a backend too unreachable to answer this read emits no turn
		// to announce either. The downgrade direction (design 4.3) is carried by a
		// SUCCESSFUL re-read returning no key, which is unaffected here.
	}

	/**
	 * Block until a capability read has ANSWERED against the current backend,
	 * or until a fresh bounded probe has failed here and now.
	 *
	 * Issuing the probe itself when none has answered is what makes the legacy
	 * path safe by construction rather than by call-site discipline. The failure
	 * the review reproduced is a read fired before the backend existed: it is
	 * not enough to move that call later, because any read can lose its race
	 * with a backend that is still starting, and a swallowed one leaves a 0 that
	 * reads exactly like an old backend. Re-asking at the moment the answer is
	 * actually needed cannot be beaten by a slow start.
	 *
	 * Loops rather than awaiting once because a backend rotation can start a
	 * new probe while we are waiting on the old one, and the legacy path must
	 * never be decided on the previous backend's answer.
	 */
	private async awaitContract(): Promise<void> {
		if (!this.contractAnswered) this.refreshNotificationContract();
		let awaited: Promise<void> | null = null;
		while (this.contractProbe !== awaited) {
			awaited = this.contractProbe;
			await awaited;
		}
	}

	/**
	 * Record the contract version a backend reported.
	 *
	 * Being told the value directly IS an answer, so this also stops the legacy
	 * path issuing a probe of its own and overwriting it.
	 *
	 * Bumps the generation for the same reason a probe does: this is the newest
	 * reading of the backend, so an older probe still in flight must not settle
	 * on top of it.
	 */
	setNotificationContract(version: unknown): void {
		this.contractGeneration++;
		this.applyNotificationContract(version);
		this.contractAnswered = true;
	}

	/**
	 * Normalise a reported contract value. Both callers are ANSWERS and both
	 * set `contractAnswered` themselves; nothing else may write this field.
	 * That invariant is the fix for R2-1, so a third caller that resets the
	 * value without answering re-opens it.
	 */
	private applyNotificationContract(version: unknown): void {
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
	 *
	 * ``windowId`` IS THE WEB CONTENTS ID (``event.sender.id``, from the IPC
	 * handler), and the map is keyed on it because that is what a close cleanup can
	 * still name after the window is gone. Every reader must use the SAME id — see
	 * `presence()`, where reading the ``BrowserWindow`` id instead made the
	 * machine-wide presence report an empty session id for a window it was
	 * claiming was focused on a conversation (review round 2, R2-3).
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
			session: args.sessionId,
			// THE REPORT'S AGE, part of the record rather than a separate map
			// (R2-4): a state that cannot expire is a state that outlives its pane.
			seenAt: Date.now(),
		});
		// Before the request: the record and the held present are this app's own
		// bookkeeping, and making them wait on a round trip would tie them to the
		// backend's availability for no reason.
		this.host.noteDisplayed(args.sessionId);
		return this.request({
			op: "sessions.watch",
			sessionId: args.sessionId,
			subscriptionId: args.subscriptionId,
			visible: args.visible && args.focused,
			canNotify: this.canNotify,
		});
	}

	/**
	 * Forget a window's watch state on close.
	 *
	 * This had NO CALLER while `mainWindow.on("closed")` nulled the window
	 * without telling the notifier, and `webContents` ids are not reused — so
	 * after one window close the map held `{visible: true, focused: true}` for
	 * the life of the process and every `when_unfocused` completion was
	 * suppressed for good. That is the strongest candidate for the operator's
	 * "I don't reliably get notified", and the fix is this call plus the
	 * liveness read in `anyDisplayingFocused`.
	 */
	forgetWindow(windowId: number): void {
		this.windows.delete(windowId);
	}

	/**
	 * Withdraw the DISPLAYED conversation when the pane that reported it leaves.
	 *
	 * THE NAVIGATION HALF OF R2-4. `forgetWindow` runs when a window closes, and
	 * the report now expires on its own after `RENDERER_REPORT_TTL_MS` — but
	 * navigating from a conversation to the catalogue or Settings stops the watch
	 * and unsubscribes its stream while leaving the window, and therefore the map
	 * entry, exactly where it was. Main's own feed then kept renewing "showing A"
	 * every beat and the backend, which treats fresh presence as authoritative,
	 * suppressed A's banner while no pane displayed it.
	 *
	 * IDENTITY-SAFE BY CONSTRUCTION, which is the part a naive clear gets wrong: a
	 * cleanup runs asynchronously after the pane has already changed, so an
	 * unconditional clear would wipe the session a DEEPER pane has since
	 * subscribed to. This withdraws only the report that names the conversation
	 * being left.
	 */
	releaseWatch(windowId: number, sessionId: string): void {
		const state = this.windows.get(windowId);
		if (!state) return;
		/*
		 * An EMPTY id withdraws NOTHING (review round 3, N3-2). The argument is
		 * typed `string`, and reading an empty one as "clear whatever this window
		 * reports" is the single input that skips the identity check this method
		 * exists for: a caller that sent "" would un-claim a conversation it is not
		 * leaving, which is the hazard the check is here to prevent. Nothing sends
		 * it today (the renderer hook early-returns on a falsy id), but the type
		 * permits it, so the guard is at the door rather than at the caller.
		 */
		if (!sessionId || state.session !== sessionId) return;
		this.windows.set(windowId, { ...state, session: "" });
	}

	/**
	 * Called by the stream relay for every parsed frame it forwards, and by the
	 * machine-wide feed for the frames it carries.
	 *
	 * ONE method for both sources on purpose. A `notification` frame's payload is
	 * byte-identical whichever way it arrived — same `dedupe_key`, minted by the
	 * backend — so two entry points would be two places to keep that true, and
	 * the pair would eventually be delivered twice instead of once.
	 */
	observe(
		sessionId: string,
		frame: DesktopSessionFrame | DesktopFeedFrame,
	): void {
		if (!this.canNotify) return;
		/*
		 * The single delivery gate for every banner, ahead of every claim. A
		 * `headless` run is an agent looking at the app, not a person watching
		 * it: delivering there interrupts whoever is really at the machine, and
		 * the cross-surface claims below are taken "immediately before delivery"
		 * (design 7.3), so they must not be taken for a banner that is never
		 * shown. `inactive` still delivers — its window is visible, so the
		 * ordinary "only news when nobody is looking" rule applies unchanged.
		 */
		if (this.windowRaise === "never") return;
		/*
		 * A `frontend.replace` is read by the SAME branch as the snapshot, and
		 * deliberately so: its payload is literally the same `{frontend, cold}`
		 * shape (the bridge publishes its bounded `state()`), and this notifier keeps
		 * no cwd or title cache to go stale - only the owner epoch it keys banner
		 * claims by and the pending gate. A replacement carries the facade's current
		 * projection at the SAME owner epoch, so re-reading it is consistent rather
		 * than a step back, and skipping it would be worse: a gate raised by the move
		 * itself can ride this frame, and a branch that ignored it would drop that
		 * banner while every other frame shape still raised one.
		 */
		if (frame.type === "snapshot" || frame.type === "frontend.replace") {
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
			void this.composed(sessionId, frame.payload);
			return;
		}
		if (frame.type === "event") {
			// `turn_end` is dropped unconditionally, on every backend version: it
			// is ONE MODEL CALL finishing (local_operator/tui/events.py,
			// TurnBoundaryEnd), and an agentic turn is many of them. Toasting it
			// was the reported defect — "Turn complete" per step. Dropped here,
			// synchronously, because no backend answer can make it notifiable.
			if (String(frame.payload.type ?? "") !== "agent_end") return;
			void this.legacyTurn(sessionId, frame.seq);
		}
	}

	/**
	 * The legacy completion toast, raised only against a backend that composes
	 * none of its own.
	 *
	 * DEFERRED, never raced. A backend advertising `notification_contract` owns
	 * every completion toast, so this must stay silent against it or the user
	 * gets two banners for one turn: the legacy one here plus the composed frame.
	 * `agent_end` is published the moment the turn's last model call returns,
	 * while the composed frame follows from the backend's 1 s attention poll
	 * (design 6.1) — so the event reliably arrives FIRST, and any check that
	 * reacts to a frame already in hand closes the window one frame too late.
	 * Waiting for the capability read to settle is what closes it by
	 * construction. The wait is bounded by `CONTRACT_PROBE_*` and only ever
	 * applies before the first answer of a run.
	 *
	 * `agent_end` survives on this path only because dropping it too would leave
	 * an old backend with no completion signal at all. It is still wrong (it
	 * arrives while `task` children run), which is exactly what the
	 * backend-composed path fixes. The event itself is NEVER filtered out of the
	 * stream: the transcript reducer settles on it.
	 */
	private async legacyTurn(sessionId: string, seq: number): Promise<void> {
		await this.awaitContract();
		if (this.notificationContract > 0) return;
		this.turn(sessionId, seq);
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
		// is looking at THAT conversation. The backend decides which; this app does
		// not second-guess it.
		if (
			n.focus_policy === "when_unfocused" &&
			this.anyDisplayingFocused(sessionId)
		)
			return;
		if (n.completion_token) {
			// Claim LAST, immediately before delivery: an unclaimed completion stays
			// available to another surface (a TUI on this machine), while a claim
			// taken for a toast we then suppressed would be delivered to nobody,
			// for good. See docs/design/descriptive-notifications.md 7.3.
			const outcome = await this.claimDelivery(sessionId, n.completion_token);
			if (outcome !== "won") {
				// A FAILED claim is not a lost one. On a transport error or a non-200
				// the backend never advanced `claim_delivery`, so the completion is
				// still unclaimed and still owed to somebody — but the local dedupe
				// key is already spent, and the natural retry (design 7.5: two
				// Electron windows on one session produce two frames with the SAME
				// `dedupe_key`) would be swallowed for the full TTL. Release the key
				// so the next frame can re-attempt. A clean `{claimed: false}` KEEPS
				// it: another surface legitimately owns this one and re-attempting
				// would just re-lose the same race.
				if (outcome === "failed") this.delivered.delete(n.dedupe_key);
				return;
			}
		} else if (digestMemberCount(n) > 0 || isBurstDigest(n)) {
			/*
			 * A DIGEST IS CLAIMED MEMBER BY MEMBER (review round 2, R2-5; the same
			 * contract as backend #1116's R8).
			 *
			 * The digest itself has no `completion_token` — no single completion owns
			 * it — so the branch above skipped it entirely, and nothing marked its
			 * MEMBERS delivered. An individual frame for one of them (another feed
			 * instance, a TUI on this machine, a re-delivery) then raised a SECOND
			 * banner for a completion the digest had already announced, which is the
			 * cross-surface arbitration the whole claim exists to provide.
			 *
			 * The backend names the pairs and does NOT preclaim them, so the claim can
			 * be taken here — immediately before delivery, exactly like a single
			 * frame, and never when the frame was merely queued.
			 *
			 * PARTIAL RACES ARE THE NORMAL CASE, not an error: a member another surface
			 * already claimed was already delivered by that surface, so it is simply
			 * not this digest's to announce. What matters is that ZERO won members
			 * means every one of them is somebody else's, and then there is nothing
			 * left to say — the local dedupe key is released so a later regrouped
			 * digest of the same members can try again rather than being swallowed.
			 *
			 * There is NO local cap here. The backend's per-tick ceiling composes the
			 * digest; a second, independent cap in this app would be a different
			 * promise about the same burst, and the two would drift.
			 *
			 * THE MEMBER MARKER IS THE TRIGGER, NOT THE SIZE (review round 3, R3-1).
			 * A one-member overflow takes this branch too, which is what stops its
			 * completion being claimable twice. The `|| isBurstDigest(n)` arm beside
			 * it is for a frame from a backend that predates `member_tokens` — the
			 * pre-R8 shape named only session ids — so that shape is attempted here
			 * exactly as it was before.
			 */
			const won = await this.claimDigestMembers(n);
			/*
			 * A MEMBERLESS DIGEST IS NOT A LOST ONE (review round 4, R4-1).
			 *
			 * The `|| isBurstDigest(n)` arm above is for a backend that predates
			 * `member_tokens`, and that shape has nothing to try at all: `won` is 0
			 * because there is nothing to arbitrate, NOT because another surface owns
			 * every member. Returning there dropped the banner outright — and
			 * `desktop-session-contract.ts` promises the opposite in as many words
			 * ("the digest still renders, its members are simply not arbitrated"), so
			 * the bail-out is conditional on there being members to lose. The local
			 * dedupe key stays spent in that case: the digest IS announced, and a
			 * re-delivery of the same burst must not announce it twice.
			 */
			if (won === 0 && digestMemberCount(n) > 0) {
				this.delivered.delete(n.dedupe_key);
				return;
			}
		}
		// `body_is_failure` is additive and optional on the wire (see the type):
		// absent from a backend that predates the flag, which falls through to the
		// bare body it rendered before the flag existed rather than throwing.
		this.show(
			/*
			 * A BURST DIGEST is not about one conversation (R1-2). The backend
			 * caps per-tick banners and publishes ONE frame for the remainder,
			 * carrying `burst_count` and `session_ids` and setting `session_id`
			 * to the LAST overflow member — it must name something for the frame
			 * to be a valid session frame at all. Routing its click to that id
			 * opened one arbitrary member of the burst, which is the "the click
			 * did not land where I expected" defect this change exists to
			 * remove, so a digest opens the catalogue instead.
			 *
			 * Detected on the fields themselves rather than on a title string:
			 * the strings are the backend's to word, and a surface that matched
			 * on them would route a re-worded digest to a random conversation.
			 *
			 * A ONE-MEMBER DIGEST LANDS ON ITS OWN CONVERSATION, and that is a
			 * decision rather than a fall-through (review round 3, R3-1). The frame
			 * above is the case the claim branch now recognises and this one does
			 * not: `burst_count` is 1 and it names exactly one conversation, so the
			 * banner says one thing and the click goes there — the operator's own
			 * request ("a click landing on the exact conversation") read literally.
			 * Folding the member marker into `isBurstDigest` would send it to the
			 * catalogue and lose that navigation for no gain in correctness, since
			 * it is the CLAIM that has to happen for every member, not the routing.
			 */
			isBurstDigest(n) ? null : sessionId,
			n.title,
			n.status,
			n.body,
			n.body_is_snippet,
			n.body_is_failure ?? false,
		);
	}

	/**
	 * Claim a burst digest's members, and report how many this surface won.
	 *
	 * One `sessions.notified` per member, through the SAME atomic claim a single
	 * frame uses — that is the point of the contract: the arbitration lives in one
	 * place (the backend's `claim_delivery`), so a digest and an individual banner
	 * for one of its members cannot both win.
	 *
	 * Members are claimed SEQUENTIALLY rather than in parallel, deliberately: this
	 * runs on the delivery path with a banner's worth of latency behind it, and a
	 * burst is capped at a handful of members by the backend's own ceiling.
	 *
	 * A `failed` claim is treated as NOT won, which makes the whole digest fail
	 * closed when the backend is unreachable — the same choice the single-frame
	 * path makes, and for the same reason: showing the banner anyway would risk a
	 * second banner for completions another surface may also have reached.
	 */
	private async claimDigestMembers(n: DesktopNotification): Promise<number> {
		const members = n.member_tokens ?? [];
		let won = 0;
		for (const member of members) {
			if (!member?.session_id || !member?.completion_token) continue;
			const outcome = await this.claimDelivery(
				member.session_id,
				member.completion_token,
			);
			if (outcome === "won") won += 1;
		}
		return won;
	}

	/**
	 * Ask the backend whether this surface owns this completion's toast.
	 *
	 * Fails CLOSED on the TOAST: neither `lost` nor `failed` shows anything,
	 * because the failure mode of failing open is the duplicate banner on every
	 * surface this whole mechanism exists to prevent.
	 *
	 * The two non-winning outcomes are still reported separately, because they
	 * differ in who owns the completion afterwards. `lost` means the backend
	 * answered and another surface has it. `failed` means the backend was never
	 * reached or never answered cleanly, so nothing was claimed anywhere and the
	 * completion is still owed to somebody — see the caller.
	 */
	private async claimDelivery(
		sessionId: string,
		completionToken: string,
	): Promise<"won" | "lost" | "failed"> {
		try {
			const response = await this.request({
				op: "sessions.notified",
				sessionId,
				completionToken,
			});
			// A non-200 includes the local 422 the transport returns for a schema
			// miss, so a backend minting a non-UUID completion token retries rather
			// than silently losing every completion.
			if (response.status !== 200) return "failed";
			const body = response.body as { result?: { claimed?: unknown } } | null;
			return body?.result?.claimed === true ? "won" : "lost";
		} catch {
			return "failed";
		}
	}

	/**
	 * Whether a LIVE window is displaying `sessionId` in the foreground.
	 *
	 * THE completion gate, and the predicate is deliberately two facts rather
	 * than one. `anyFocused()` alone answers "is the app in front", which is not
	 * the question: with the app focused on session A, a completion in session B
	 * was suppressed and announced to nobody — and rung 3 had already deferred
	 * to rung 2, so nothing else could raise it either. That is the operator's
	 * reported symptom, made permanent by the presence mechanism itself (B1).
	 *
	 * Only a window showing THIS conversation is a reason not to banner, because
	 * only then is the completion already on screen.
	 *
	 * Dead windows are filtered rather than assumed gone. `forgetWindow` runs on
	 * `closed`, but a renderer process that dies takes its `webContents` id with
	 * it and no `closed` event reaches this map, and `webContents` ids are not
	 * reused — so an unfiltered stale `{visible: true, focused: true}` entry
	 * suppresses every completion for the life of the process.
	 */
	private anyDisplayingFocused(sessionId: string): boolean {
		for (const [id, state] of this.windows) {
			if (!state.visible || !state.focused) continue;
			if (state.session !== sessionId) continue;
			if (!this.host.windowAlive(id)) continue;
			// ...and the report has to be CURRENT (R2-4). A live window whose renderer
			// stopped reporting — a wedged pane, a navigation that never beat again —
			// is not evidence that this conversation is on screen, and treating it as
			// such suppresses the banner for the conversation nobody can see.
			if (Date.now() - state.seenAt > RENDERER_REPORT_TTL_MS) continue;
			return true;
		}
		return false;
	}

	/**
	 * What this app can say about itself for the machine-wide presence claim.
	 *
	 * The claim is not "a desktop is connected" - the backend already knows that
	 * from the socket. It is the two answers only the app has, and both are
	 * read by the delivery ladder: `session_id` + `window` decide `attended`
	 * (rung 1's "a watching surface already has it"), and a MISSING window is not
	 * a missing value - it means this app is watching nothing, which is the
	 * correct answer for the operator's own windowless case and the wrong answer
	 * for a window that is merely minimised.
	 *
	 * `sessionId` comes from this notifier's own heartbeat map rather than from
	 * the renderer, so it cannot disagree with the completion gate above: the
	 * same value that suppresses a banner is the value that tells the backend
	 * not to raise someone else's. An app that names a conversation it is not
	 * showing suppresses the banner for a conversation nobody can see.
	 *
	 * Dead windows answer "no window" rather than "last known window": a
	 * destroyed window has no `is*()` to read, and reporting its stale state
	 * would advertise a surface that cannot display anything.
	 *
	 * THE SESSION IS READ BY THE ID THE WRITER USED (review round 2, R2-3).
	 * `heartbeat` keys this map on `event.sender.id` — the WEB CONTENTS id —
	 * because that is what the IPC event carries and what the close cleanup
	 * captures. This accessor read `window.id`, the BrowserWindow id, which merely
	 * happens to be equal early in a session and drifts as soon as anything else
	 * is created (the browser host's own webContents, a second window). It then
	 * reported a focused, visible window with `session_id: ""`, so the backend
	 * could not recognise the conversation actually on screen and bannered it as
	 * background.
	 */
	presence(): {
		sessionId: string;
		window: {
			exists: boolean;
			focused: boolean;
			visible: boolean;
			minimized: boolean;
		};
	} {
		const window = this.window();
		if (!window || window.isDestroyed()) {
			return {
				sessionId: "",
				window: {
					exists: false,
					focused: false,
					visible: false,
					minimized: false,
				},
			};
		}
		const reported = this.windows.get(window.webContents.id);
		const current =
			reported && Date.now() - reported.seenAt <= RENDERER_REPORT_TTL_MS;
		return {
			sessionId: current ? reported.session : "",
			window: {
				exists: true,
				focused: window.isFocused(),
				visible: window.isVisible(),
				minimized: window.isMinimized(),
			},
		};
	}

	/**
	 * Raise the banner for a pending approval or question.
	 *
	 * A gate is worth a toast even when the window is focused: the user may be
	 * reading another conversation in the same window.
	 *
	 * When the backend supplies `session_name`, the banner takes the SHAPE of a
	 * completion banner — session name as the title, the gate's own title
	 * leading the detail. Without it, a gate named only its category while
	 * completions named their session, so the banner a user can safely ignore
	 * identified itself and the banner holding a run hostage did not; with two
	 * or three sessions running, that one cannot be triaged without clicking,
	 * which is the action the user was deciding whether to take.
	 *
	 * The name is rendered ONLY as the backend sent it. `session_name` is
	 * additive and optional: it is absent on an older backend and empty when the
	 * `session_names_in_notifications()` privacy flag is off. The backend owns
	 * that decision because only it can read the flag, so this app must never
	 * resolve the name from a snapshot instead — doing so would leak a name the
	 * user opted out of, on every gate, forever.
	 */
	private gate(sessionId: string, gate: PendingDesktopGate): void {
		const { request_id: requestId, kind, title, detail } = gate;
		const key = `gate:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${requestId}`;
		if (!this.claim(key)) return;
		// The fallback is kind-aware because an untitled `ask` used to announce
		// "Approval needed" — the wrong promise entirely: the user goes looking
		// for a yes/no button and finds a question. `kind` is already on the wire.
		const fallback = kind === "ask" ? "Question" : "Approval needed";
		const sessionName = gate.session_name?.trim() || "";
		if (!sessionName) {
			// No name to lead with, so the shape is unchanged: the gate's own title
			// up top, the detail below. `title.trim()` because a whitespace-only
			// title is truthy and would render a banner with no title at all, which
			// macOS fills with the posting app's name (D3-3).
			//
			// The gate title is passed to `gateBody` as EMPTY: it is already on the
			// title line here, so prefixing the body with it would say the same word
			// twice. What `gateBody` still supplies is the empty-detail case —
			// `PendingGateState.detail` defaults to "" and is untrimmed on the wire,
			// and it is reachable from a real tool (`_describe_path_approval`
			// returns "" for a blank path) — where the house vocabulary says what the
			// banner wants, rather than a bare verb or no body at all (D3-2).
			this.show(
				sessionId,
				title.trim() || fallback,
				"",
				gateBody(kind, "", detail),
			);
			return;
		}
		// Named: the session takes the title line, so the gate's own title has to
		// lead the body or the banner never says what is being asked. `fallback`
		// stands in when the gate is untitled, keeping "Question" for an ask that
		// has none.
		//
		// Through `gateBody` rather than a join of its own: for a tool approval the
		// title IS the tool name and the detail already leads with it, so the naive
		// form rendered "write: write: /Users/damian/notes.md" — a worse banner with
		// the privacy flag ON than off, the inverse of what this change is for
		// (D3-1).
		this.show(
			sessionId,
			sessionName,
			"",
			gateBody(kind, title.trim() || fallback, detail),
		);
	}

	/**
	 * Legacy completion toast: canned copy, reached only against a backend that
	 * does not advertise `notification_contract`. Keyed on `session:epoch:seq`
	 * as it always was — an old backend mints no `dedupe_key` to key on.
	 */
	private turn(sessionId: string, seq: number): void {
		const key = `turn:${sessionId}:${this.epochs.get(sessionId) ?? ""}:${seq}`;
		if (!this.claim(key)) return;
		// Completion is only news when nobody is looking AT THIS CONVERSATION.
		//
		// Session-scoped here too, and not only on the composed path: this is the
		// fallback for a backend old enough to compose nothing, and it reaches an
		// ORDINARY run — a provider fallback mid-session, or a downgrade by a
		// health-check restart (design 4.3). Leaving it window-scoped would keep
		// the reported defect alive on exactly the backends that cannot send a
		// composed frame at all, and it has the session id in hand to do better.
		if (this.anyDisplayingFocused(sessionId)) return;
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
	 * The strings themselves are the backend's, unchanged; only the join is ours.
	 *
	 * The design doc's stated reason for keeping the status out of the title —
	 * "macOS clips a title at ~43 characters" — is FALSE on a current macOS
	 * banner: rendered frames show an 80-character title wrapping across two
	 * lines, not clipping (design review round 1). The real constraint is a
	 * total budget of roughly five text lines for title and body together, after
	 * which macOS truncates the BODY with its own ellipsis. That is why the join
	 * is spent sparingly below.
	 *
	 * WHETHER THE BODY NAMES THE OUTCOME ITSELF decides whether the status earns
	 * its place, and the backend sends two flags for the two kinds of body that
	 * do not. A model-written snippet describes the work, and the session's own
	 * recorded failure text describes the cause ("anthropic: 429
	 * rate_limit_error - credit balance too low"); neither says whether the turn
	 * succeeded, so the category in front of it is the only thing that does. The
	 * house bodies ("Task complete", "Stopped with an error") already name the
	 * state, so prefixing them renders "Complete — Task complete": one fact
	 * asserted twice in the two lines a banner gets, which is what every user
	 * with the session-name privacy flag off would have received.
	 *
	 * Reading only `body_is_snippet` split the world in two where the backend
	 * made it three, and it inverted the intent of the failure text (design
	 * round 1, D4): a raw 429 envelope under a session name reads as routine log
	 * noise, so the ONE banner that demands action was the one that never said
	 * anything had gone wrong — and it was worse with the privacy flag ON (the
	 * default, which is what produces the failure text) than off, where the user
	 * at least got "Stopped with an error" (QA round 1, Q-1).
	 *
	 * These are the backend's own flags for exactly this difference, so this app
	 * still re-words nothing (design 8.4). Gates pass `status = ""` and are
	 * unaffected either way.
	 */
	private show(
		/*
		 * Where the click lands: a conversation id, or `null` for the catalogue.
		 * A digest banner names several conversations and has no single one to
		 * open, so the honest target is the list they are all in.
		 */
		sessionId: string | null,
		title: string,
		status: string,
		body: string,
		isSnippet = false,
		isFailure = false,
	): void {
		const lead = (isSnippet || isFailure) && status ? `${status} — ` : "";
		const notification = new Notification({
			title,
			body: `${lead}${body}`.slice(0, MAX_BODY_CHARS),
			silent: false,
		});
		notification.on("click", () => {
			const target = this.window();
			if (!target || target.isDestroyed()) {
				/*
				 * No window: the app is alive in the dock, which is the operator's
				 * own reported case. This used to return here, so the click did
				 * nothing at all.
				 *
				 * Recreation is the app's business (`index.ts` owns `createWindow`)
				 * and it also owns the part that makes this safe: a `webContents.send`
				 * into a window that has not loaded is dropped silently, so the
				 * session id is QUEUED and delivered once the renderer reports the
				 * conversation on screen. Sending it here directly would turn the
				 * reported no-op into a rarer one.
				 */
				this.host.reopen(sessionId);
				return;
			}
			/*
			 * SEND BEFORE RAISING (B3).
			 *
			 * A click is the operator asking for the window, but only `normal` may
			 * answer by activating the app: `raiseWindow` orders an `inactive`
			 * window without taking focus and leaves a `headless` one off screen.
			 * The conversation is delivered either way — the renderer decides how
			 * to open it, and this line only names it.
			 *
			 * The order is the fix, not a preference. Raising first shows the
			 * window holding whatever conversation it was on, for as long as the
			 * switch takes, and that flash reads as a click that landed on the
			 * wrong row. Naming the conversation first means whatever comes
			 * forward is already correct — the same "switch first, then focus"
			 * rule the backend's own click client states.
			 */
			target.webContents.send("desktop-open-conversation", { sessionId });
			raiseWindow(target, this.windowRaise, {
				trigger: "banner-click",
				report: this.raiseReport,
			});
		});
		notification.show();
	}
}
