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
	DesktopNotification,
	DesktopSessionFrame,
	PendingDesktopGate,
} from "../shared/desktop-session-contract";

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
		// is looking. The backend decides which; this app does not second-guess it.
		if (n.focus_policy === "when_unfocused" && this.anyFocused()) return;
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
		}
		// `body_is_failure` is additive and optional on the wire (see the type):
		// absent from a backend that predates the flag, which falls through to the
		// bare body it rendered before the flag existed rather than throwing.
		this.show(
			sessionId,
			n.title,
			n.status,
			n.body,
			n.body_is_snippet,
			n.body_is_failure ?? false,
		);
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

	private anyFocused(): boolean {
		for (const state of this.windows.values()) {
			if (state.visible && state.focused) return true;
		}
		return false;
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
		sessionId: string,
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
