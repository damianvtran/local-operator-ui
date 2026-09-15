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
 * WHY THE CLICK DOES NOT RAISE THE WINDOW. "Never steal focus" is the product's
 * rule for every browser this project starts (design 11.4), and a banner click
 * is exactly the moment a stray `show()` would interrupt the operator in another
 * application. The click therefore only tells the renderer to bring the browser
 * route forward; the app's own `window-raise.ts` is still the only module that
 * decides whether a window comes up, and this one never calls it.
 *
 * WHY THE MODE GATE. In `headless` a run has nobody at the screen, and in
 * `inactive` the app has deliberately not been brought forward: a banner in
 * either case interrupts whoever is really at the machine. So the banner is
 * raised only when the launch plan would itself have focused the window
 * (`show === "focus"`), which is the same gate `presentWindow` applies.
 */

/** The banner's copy. Sentence case, no emoji, and it names the origin because
 * the origin is what the user is being asked about (design 9.3). */
export const CONSENT_TITLE = "Site approval needed";

export function consentBody(origin: string): string {
	return `An agent wants to open ${origin}. Approve or deny it in the browser tab.`;
}

export interface ConsentNotifierOptions {
	/** The launch plan's own answer to "would this window be brought forward?".
	 * `"focus"` is a normal launch; the other two mean nobody is at the screen. */
	show: "focus" | "inactive" | "never";
	/** Told which pending request the user clicked, so the renderer can bring the
	 * browser route forward. Never a window raise. */
	onAttention: (entryId: string) => void;
	log?: (message: string) => void;
}

/** The entries already announced, so a re-render of the same pending request
 * cannot produce a second banner. */
export class ConsentNotifier {
	private readonly announced = new Set<string>();

	constructor(private readonly options: ConsentNotifierOptions) {}

	/**
	 * Announce the pending entries that have not been announced yet.
	 *
	 * Called with the CURRENT pending list on every change rather than on an
	 * "added" event: the store's change hook is one callback for a mutable set,
	 * and a diff against what was already announced is both simpler and correct
	 * when an entry is superseded and replaced by a new one with a new id.
	 */
	announce(pending: ReadonlyArray<{ entryId: string; origin: string }>): void {
		const live = new Set(pending.map((entry) => entry.entryId));
		for (const entryId of [...this.announced]) {
			if (!live.has(entryId)) this.announced.delete(entryId);
		}
		if (this.options.show !== "focus") return;
		if (!Notification.isSupported()) return;
		for (const entry of pending) {
			if (this.announced.has(entry.entryId)) continue;
			this.announced.add(entry.entryId);
			try {
				const notification = new Notification({
					title: CONSENT_TITLE,
					body: consentBody(entry.origin),
					silent: false,
				});
				notification.on("click", () => this.options.onAttention(entry.entryId));
				// Electron's own banner API on a `Notification`, not a window:
				// `scripts/window-mode.test.mjs` allow-lists this exact call.
				notification.show();
			} catch (error) {
				// A banner that cannot be raised is a missing convenience, never a
				// reason a consent request fails to exist: the bar in the chrome band
				// is the primary channel.
				this.options.log?.(
					`[browser] could not raise a consent banner: ${String(error)}`,
				);
			}
		}
	}
}
