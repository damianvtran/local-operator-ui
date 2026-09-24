import { Notification } from "electron";

/**
 * One native banner per pending site approval.
 * Design: docs/design/ui-browser-tab.md 9.2 ("the bar alone is not enough when
 * the window is on another Space or behind something"), 11.4 (focus).
 *
 * WHY THIS IS NOT THE `DesktopNotifier`. That class delivers the BACKEND's
 * completion and gate banners, and its whole vocabulary — `GATE_BODIES`, the
 * `notification_contract` switch, the read receipts — is a mirror of
 * `local_operator/notifications/compose.py` pinned against that function's test
 * vectors. A site approval is not a backend gate: the request is raised by this
 * app's own host, no backend can word it, and routing it through the mirror
 * would either invent a gate `kind` the backend does not have or let the same
 * state be described in two vocabularies. So this is the smallest module that
 * raises a banner for the one event the backend cannot know about, and it
 * deliberately owns no other notification.
 *
 * WHAT THE CLICK DOES, AND WHAT IT DELIBERATELY DOES NOT DO ITSELF. The click
 * is the OPERATOR'S OWN act, and its whole promise is "take me to the request you
 * just told me about" — which is worthless if the window it lands in is behind
 * another application or on another Space, exactly the state the banner exists
 * for (design 9.2). So the click hands the request up through `onAttention`, and
 * the WIRING decides what to do with it: `browser/index.ts` names the request to
 * the renderer first and then comes forward through `window-raise.ts`, the one
 * module that decides whether a window is shown. This file still never calls
 * `show`, `showInactive` or `focus`, and its callback still carries no window:
 * a banner that could raise a window by itself would be a second raise policy
 * beside the app's own.
 *
 * WHY THE MODE GATE. In `headless` a run has nobody at the screen, and in
 * `inactive` the app has deliberately not been brought forward: a banner in
 * either case interrupts whoever is really at the machine. So the banner is
 * raised only when the launch plan would itself have focused the window
 * (`show === "focus"`), which is the same gate `presentWindow` applies — and it
 * is also why the raise on the click is a no-op in both other modes, since
 * `raiseWindow` reads the same plan.
 */

/** The banner's copy. Sentence case, no emoji, and it names the origin because
 * the origin is what the user is being asked about (design 9.3).
 *
 * TWO SHAPES, because the queue is real now: one pending request is a specific
 * ask about one site, and several are a count — a banner that named one origin
 * while three were waiting would be the half-truth this feature's copy standard
 * exists to prevent. */
export const CONSENT_TITLE = "Site approval needed";

export function consentBody(count: number, origin: string): string {
	return count === 1
		? `An agent wants to open ${origin}. Approve or deny it in the browser tab.`
		: `${count} site approvals are waiting. Approve or deny them in the browser tab.`;
}

export interface ConsentNotifierOptions {
	/** The launch plan's own answer to "would this window be brought forward?".
	 * `"focus"` is a normal launch; the other two mean nobody is at the screen. */
	show: "focus" | "inactive" | "never";
	/** Told which pending request the user clicked, and WHO ASKED for it.
	 *
	 * The `requester` is the host's own identity string for the asker (the
	 * `session:<id>` spelling `host.ts` publishes), passed through rather than
	 * resolved here: this module has no opinion about session identity and must
	 * not grow one — the wiring that owns the renderer channel is what turns it
	 * into the conversation the click should land on. Never a window raise. */
	onAttention: (entryId: string, requester: string) => void;
	log?: (message: string) => void;
	/**
	 * How a banner is built, injectable so the ONE-BANNER-PER-COUNT-CHANGE rule has
	 * an observer at all.
	 *
	 * It has none otherwise: a native banner is raised only when the launch plan
	 * would itself have focused the window (`show === "focus"`), and the runs this
	 * project can automate are headless, where no banner is ever raised. A rule that
	 * only prose and a headless run can speak for is a rule that fails on the day
	 * someone changes the diff to a per-entry loop again — which is exactly the
	 * change this seam was added to make fail in CI.
	 */
	createNotification?: (options: {
		title: string;
		body: string;
		silent: boolean;
	}) => {
		on(event: "click", listener: () => void): void;
		show(): void;
	};
}

/** The live count the last banner was raised for. */
export class ConsentNotifier {
	private announced = 0;

	constructor(private readonly options: ConsentNotifierOptions) {}

	/**
	 * Announce a change in the size of the pending set — ONE banner per increase.
	 *
	 * WHY A COUNT WATERMARK RATHER THAN A SET OF ANNOUNCED IDS, which is what this
	 * was: with one prompt slot the set could hold at most one entry, and with a
	 * real queue (`approvals.ts` no longer displaces) the old rule raised one
	 * banner PER UNANNOUNCED ENTRY — up to 16 banners for one busy minute, against
	 * a rule that exists to avoid interrupting the operator (design 9.2, 11.4).
	 * The count of the live set is the thing the user can act on, so an increase is
	 * the event and a banner is the whole response to it.
	 *
	 * WHAT THIS GIVES UP, deliberately: a request that replaces another without
	 * changing the count (a displacement at the cap, a cancel plus an arrival in
	 * one refresh) raises no second banner. The alternative is a banner per entry,
	 * and the banner's job is to bring the user to the band — where the tray shows
	 * the whole live set, numbered. The click names the OLDEST live entry, which is
	 * the one the tray selects by default — and it carries that entry's requester,
	 * so the wiring can land the operator on the conversation that asked rather
	 * than on the queue.
	 */
	announce(
		pending: ReadonlyArray<{
			entryId: string;
			origin: string;
			/** The asker's identity string, forwarded to `onAttention` verbatim. */
			requester: string;
		}>,
	): void {
		const count = pending.length;
		const increased = count > this.announced;
		this.announced = count;
		if (!increased) return;
		if (this.options.show !== "focus") return;
		const create = this.options.createNotification;
		if (!create && !Notification.isSupported()) return;
		const oldest = pending[0];
		if (!oldest) return;
		try {
			const notification = (create ?? ((options) => new Notification(options)))(
				{
					title: CONSENT_TITLE,
					body: consentBody(count, oldest.origin),
					silent: false,
				},
			);
			notification.on("click", () =>
				this.options.onAttention(oldest.entryId, oldest.requester),
			);
			// Electron's own banner API on a `Notification`, not a window:
			// `scripts/window-mode.test.mjs` allow-lists this exact call.
			notification.show();
		} catch (error) {
			// A banner that cannot be raised is a missing convenience, never a
			// reason a consent request fails to exist: the band in the chrome band
			// is the primary channel.
			this.options.log?.(
				`[browser] could not raise a consent banner: ${String(error)}`,
			);
		}
	}
}
