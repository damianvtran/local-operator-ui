/**
 * Keeps shown Electron notifications reachable until they can no longer serve a
 * click, and lets go the moment they can.
 *
 * WHY THIS EXISTS, in the operator's own words: clicking a notification "often
 * does not open the conversation it is about". The banner is not broken and
 * neither is its click handler — the OBJECT carrying it is gone. Electron's
 * main-process `Notification` is a V8 wrapper, and the native side keeps only a
 * raw delegate pointer (`presenter_->CreateNotification(this, id)`); when V8
 * collects the wrapper, gin's weak callbacks destroy the `api::Notification`
 * and its destructor nulls that delegate (`set_delegate(nullptr)`,
 * `shell/browser/api/electron_api_notification.cc` at the pinned v44.3.0). The
 * delivered banner still sits in Notification Center — macOS retains it
 * independently of this process — but clicking it emits nothing, because the
 * click now finds a null delegate. Upstream states the failure exactly:
 * electron/electron#16922 ("the event listener will execute only if
 * click/close/reply happens shortly after the notification is created") and
 * #12690 ("click event is not triggered from notification center if the user
 * waits ~1 minute or more"). A handler on an otherwise-unreferenced
 * notification therefore works only until the GC runs, which is why the defect
 * reads as intermittent rather than deterministic.
 *
 * THE RULE, mirrored from the Web Notifications spec's own garbage-collection
 * section (an object with event listeners must not be collected while its
 * listeners remain): whoever attaches a click handler holds a strong reference
 * until the notification SETTLES. Settled is click (after the caller's callback
 * has run — never before, or the handler would be dropped by its own cleanup),
 * close (the user or the OS dismissed it), or failed (it was never delivered —
 * an unsigned dev build, a denied permission).
 *
 * WHY A BOUND AND NOT A TTL. A TTL is the obvious way to keep this finite and
 * it reintroduces precisely the defect this module exists for: banners sit in
 * Notification Center for hours, and a TTL would hand the click to a collected
 * object at the moment the user finally clicks — the long tail is the point, so
 * time cannot be what ends an entry. Entries end on their own settle events,
 * and the bound is the only forced exit: it gives up the OLDEST entries, the
 * ones a person has already scrolled past. The bound is sized for the tail
 * rather than for the moment — several hundred entries is days to a couple of
 * weeks of ordinary completions, and the whole set costs on the order of a
 * megabyte, against the OS objects Notification Center is holding anyway.
 *
 * WHAT IT IS NOT. Not a delivery gate, not a raise policy, and not a rate
 * limiter: it has no opinion about whether a banner should exist, and no
 * runtime Electron import — the type below is structural so every test double
 * in this repository can satisfy it without an Electron fixture.
 */

/**
 * How many notifications one owner keeps reachable before the oldest gives up
 * its handler. 512 is the tail-sized default the module doc argues for; a
 * caller can lower it (tests do) but production passes nothing.
 */
export const NOTIFICATION_LIFETIME_BOUND = 512;

/**
 * The slice of `Notification` this module needs, structural for the same reason
 * `RaisableWindow` in `window-raise.ts` is: the notifier, the consent notifier
 * and every test double can satisfy it without this module naming Electron.
 *
 * Only `once` is required — all three settle events are one-shot, and the click
 * is registered here rather than by the caller so the retention and the handler
 * cannot drift apart.
 */
export interface LifetimeNotification {
	once(event: "click" | "close" | "failed", listener: () => void): unknown;
}

/**
 * One registry per notification-raising owner (the desktop notifier owns the
 * backend-composed banners and console completions; the consent notifier owns
 * the site-approval banner). Instances are deliberately not shared: each owner
 * has its own bound and its own tests, and a shared registry would make one
 * owner's bound a promise about the other's memory.
 */
export class NotificationLifetime {
	private readonly live = new Set<LifetimeNotification>();

	constructor(private readonly bound: number = NOTIFICATION_LIFETIME_BOUND) {
		if (!Number.isInteger(bound) || bound < 1) {
			throw new Error(
				`NotificationLifetime bound must be a positive integer, got ${String(bound)}`,
			);
		}
	}

	/**
	 * Keep `notification` reachable and wire `onClick` as its click handler.
	 *
	 * ONE CALL FORMS THE WHOLE LIFETIME, and that is load-bearing rather than
	 * cosmetic: a caller that attached its own `on("click")` and forgot to
	 * retain would reproduce the defect with every test green, so this is the
	 * only supported way to attach the click. The callback runs first and the
	 * release runs in a `finally`, so a routing path that throws still settles
	 * the entry instead of holding a dead handler until the bound reaps it.
	 */
	retain(notification: LifetimeNotification, onClick: () => void): void {
		this.live.add(notification);
		const release = () => {
			this.live.delete(notification);
		};
		notification.once("click", () => {
			try {
				onClick();
			} finally {
				release();
			}
		});
		notification.once("close", release);
		notification.once("failed", release);
		/*
		 * The bound is a FIFO, and `Set` iteration order is insertion order, so
		 * the first value is always the oldest entry. One pass can evict more
		 * than one entry only if a caller lowered the bound below the current
		 * size, which cannot happen in production — the loop states the
		 * invariant instead of assuming it.
		 */
		while (this.live.size > this.bound) {
			const oldest = this.live.values().next().value;
			if (oldest === undefined) break;
			this.live.delete(oldest);
		}
	}

	/** How many notifications this owner is currently keeping reachable. */
	get size(): number {
		return this.live.size;
	}
}
