/**
 * Team Bridge message banners, owned by main.
 *
 * WHY MAIN AND NOT THE RENDERER'S WEB NOTIFICATION API. Two reasons this app
 * has already paid for elsewhere: the renderer can be hidden, throttled or
 * gone, and only main knows whether the window is really focused (an occluded
 * or minimised window still reports `visibilityState === "visible"`). Main also
 * owns the notification lifetime, the app icon and the persisted seq cursor,
 * so this module is the one place a duplicate, a stale click or a quiet-screen
 * banner can be prevented.
 *
 * WHY IT IS NOT THE `DesktopNotifier`. That class mirrors the BACKEND's
 * completion/gate vocabulary and its `notification_contract` switch. A Team
 * Bridge message is not a backend-composed completion: the renderer composes
 * the two display strings from conversation metadata it already holds, and
 * this module only validates, dedupes and delivers them. Sharing the class
 * would make one surface's vocabulary the other's.
 *
 * WHAT THE RENDERER DOES NOT DO. It never fetches a message body for a banner.
 * The body is "<sender label> sent a message" from the list row's own metadata
 * or "New message"; this module persists only the sequence number it was told
 * about, never the text.
 *
 * QUIET WHEN ACTIVE. A focused window is already showing the badge and the
 * rail; an OS banner there would interrupt the screen the person is on. Main
 * checks real focus rather than trusting the renderer's report.
 */

import { type BrowserWindow, type NativeImage, Notification } from "electron";
import {
	type TeamBridgeNotifyRequest,
	type TeamBridgeOpenTarget,
	parseTeamBridgeNotifyRequest,
} from "../shared/team-bridge-notify";
import {
	type LifetimeNotification,
	NotificationLifetime,
} from "./notification-lifetime";
import type { TeamBridgeNotifyStore } from "./team-bridge-notify-store";

/**
 * What this module needs from Electron's `Notification`, structural for the
 * same reason `notification-lifetime.ts` is: the tests inject a fake without
 * an Electron process, and `close` is optional because the replacement rule
 * tolerates a platform that cannot dismiss a delivered banner.
 */
export interface TeamBridgeBanner extends LifetimeNotification {
	show(): void;
	close?(): void;
}

export type TeamBridgeBannerOptions = {
	title: string;
	body: string;
	silent: boolean;
	/** The app icon. macOS uses the bundle's own and ignores this field. */
	icon?: NativeImage | string;
};

/**
 * The two app capabilities a click needs, injected so this module never
 * imports `index.ts` and never decides window policy itself.
 */
export type TeamBridgeNotifierHost = {
	/**
	 * Tell a loaded renderer that a pending target exists. Deliberately carries
	 * NO payload: a push into a renderer that is still loading (a reload, a
	 * just-created window) is dropped silently, so main keeps the target until
	 * the renderer PULLS it. The signal is an optimisation for the common case;
	 * the pull is the delivery.
	 */
	signalOpen: () => void;
	/** No window at all: ask the app for one. The pending target waits for the
	 * new renderer's mount pull, which is why this needs no argument. */
	reopen: () => void;
};

export type TeamBridgeNotifierOptions = {
	window: () => BrowserWindow | null;
	/**
	 * This process's launch plan. `never` is `headless`: nobody is at the
	 * screen, and the same rule that silences the other notifier applies.
	 */
	show: "focus" | "inactive" | "never";
	store: TeamBridgeNotifyStore;
	host: TeamBridgeNotifierHost;
	icon?: NativeImage | string;
	/** Test seam; production constructs Electron's `Notification`. */
	createBanner?: (options: TeamBridgeBannerOptions) => TeamBridgeBanner;
	/** Test seam; production asks `Notification.isSupported()`. */
	canNotify?: () => boolean;
	/** Bring the clicked window forward. Injected from `index.ts`. */
	present?: (window: BrowserWindow) => void;
};

export type TeamBridgeNotifyResult = { shown: boolean };

/**
 * Whether a banner would interrupt a screen the user is already on.
 *
 * `isVisible` and `isMinimized` are belt-and-braces beside `isFocused`: a
 * focused window is visible by definition, but a fake in a test (and a future
 * Electron change) should not be able to make this true for a window that is
 * not there.
 */
function teamBridgeWindowIsQuiet(
	window: Pick<
		BrowserWindow,
		"isDestroyed" | "isVisible" | "isMinimized" | "isFocused"
	> | null,
): boolean {
	if (!window) return false;
	return (
		!window.isDestroyed() &&
		window.isVisible() &&
		!window.isMinimized() &&
		window.isFocused()
	);
}

export class TeamBridgeNotifier {
	/** The live banner per conversation, so a new seq REPLACES it. */
	private readonly banners = new Map<string, TeamBridgeBanner>();
	/** The banners this process must keep reachable for their clicks to fire. */
	private readonly lifetime = new NotificationLifetime();
	private pendingOpen: TeamBridgeOpenTarget | null = null;
	private readonly createBanner: (
		options: TeamBridgeBannerOptions,
	) => TeamBridgeBanner;
	private readonly canNotify: () => boolean;

	constructor(private readonly options: TeamBridgeNotifierOptions) {
		this.createBanner =
			options.createBanner ??
			((bannerOptions) => new Notification(bannerOptions));
		this.canNotify = options.canNotify ?? (() => Notification.isSupported());
	}

	/**
	 * Validate, dedupe and deliver one banner.
	 *
	 * REFUSAL IS AN ERROR, not a quiet `false`: a malformed payload is a bug in
	 * the caller, and the IPC handler should reject rather than let the renderer
	 * believe it raised something. A well-formed payload that is suppressed
	 * (quiet, muted by focus, duplicate, unsupported) answers `shown: false`.
	 */
	notify(input: unknown): TeamBridgeNotifyResult {
		const request = parseTeamBridgeNotifyRequest(input);
		if (request === null) {
			throw new Error("Invalid Team Bridge notification payload.");
		}
		if (this.options.show === "never") return { shown: false };
		if (!this.canNotify()) return { shown: false };
		if (teamBridgeWindowIsQuiet(this.options.window())) {
			return { shown: false };
		}
		const previous = this.options.store.notifiedSeq(request.conversationId);
		if (previous !== undefined && request.seq <= previous) {
			return { shown: false };
		}
		this.replace(request.conversationId);
		const banner = this.createBanner({
			title: request.title,
			body: request.body,
			silent: false,
			...(this.options.icon ? { icon: this.options.icon } : {}),
		});
		/*
		 * RETAINED AND WIRED BY THE SAME CALL, for the reason
		 * `notification-lifetime.ts` states at length: a collected wrapper's
		 * click emits nothing, and this is the one supported way to attach the
		 * handler. The extra `close` listener is map bookkeeping, not lifetime.
		 */
		this.lifetime.retain(banner, () => {
			this.banners.delete(request.conversationId);
			this.open(request);
		});
		banner.once("close", () => {
			if (this.banners.get(request.conversationId) === banner) {
				this.banners.delete(request.conversationId);
			}
		});
		banner.show();
		this.banners.set(request.conversationId, banner);
		// Recorded only after `show()`: a banner that failed to exist was never
		// a thing the user was told about, and advancing first would suppress
		// the retry forever.
		this.options.store.record(request.conversationId, request.seq);
		return { shown: true };
	}

	/**
	 * The target a click parked for the renderer.
	 *
	 * Consumed exactly once: the renderer asks for it on mount and on every
	 * `team-bridge:open` signal, and a later pull gets `null` rather than
	 * replaying a conversation the user has already seen. The value was built
	 * from an already-validated notification payload, so this read does not
	 * re-parse ids.
	 */
	takePendingOpen(): TeamBridgeOpenTarget | null {
		const pending = this.pendingOpen;
		this.pendingOpen = null;
		return pending;
	}

	private replace(conversationId: string): void {
		const previous = this.banners.get(conversationId);
		if (!previous) return;
		this.banners.delete(conversationId);
		previous.close?.();
	}

	private open(request: TeamBridgeNotifyRequest): void {
		const target: TeamBridgeOpenTarget = {
			conversationId: request.conversationId,
			tenantId: request.tenantId,
		};
		/*
		 * ALWAYS PARKED FIRST, THEN SIGNALLED. The signal wakes a loaded renderer,
		 * but a renderer that is loading or reloading has no listener yet and the
		 * event would be lost. The target therefore stays pending until a renderer
		 * asks for it (`takePendingOpen`), which happens on mount and on every
		 * signal - so a dropped signal costs latency, never the click.
		 */
		this.pendingOpen = target;
		const window = this.options.window();
		if (window && !window.isDestroyed()) {
			this.options.host.signalOpen();
			this.options.present?.(window);
			return;
		}
		this.options.host.reopen();
	}
}
