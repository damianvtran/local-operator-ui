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
 * WHAT THE BANNER SAYS. Sender as the title, place as the subtitle, and a
 * short preview of the newest message as the body, composed by the renderer
 * (`team-bridge-banner-format.ts`) from one history read the signed-in human is
 * entitled to. This module persists only the sequence number it was told
 * about, never the text, and never logs a field of the payload.
 *
 * ONE BANNER PER ACCOUNT/CONVERSATION. Every banner for that pair carries the same
 * OS identifier (`teamBridgeBannerId`), so macOS (`UNNotificationRequest`'s
 * identifier) and Windows (the toast `Tag`) REPLACE the delivered one in place
 * rather than stacking a second; the renderer's count line ("3 new messages")
 * is what grows. The same id survives an app restart, which the in-memory
 * `close()` replacement below cannot. A replacement inside `COALESCE_MS` is
 * silent: a burst should sound once, not once per message.
 *
 * QUIET WHEN ACTIVE. A focused window showing THAT conversation is already
 * painting the message; a banner there interrupts the screen the person is on.
 * Main checks real focus rather than trusting the renderer's report, and the
 * renderer contributes only which conversation is on screen (`viewing`).
 */

import { type BrowserWindow, type NativeImage, Notification } from "electron";
import {
	type TeamBridgeNotifyAuthority,
	type TeamBridgeNotifyRequest,
	type TeamBridgeOpenResult,
	type TeamBridgeOpenTarget,
	parseTeamBridgeNotifyAuthority,
	parseTeamBridgeNotifyRequest,
	teamBridgeNotifyOwnerMatches,
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
	/** Stable per conversation: the OS replaces a delivered banner by it. */
	id: string;
	/** Notification Center's thread grouping (macOS) / toast group (Windows). */
	groupId: string;
	title: string;
	/** macOS only; elsewhere it is folded into the body before this point. */
	subtitle?: string;
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
	/** Test seam; production reads `process.platform` (subtitle support). */
	platform?: NodeJS.Platform;
	/** Test seam for the coalescing clock. */
	now?: () => number;
};

export type TeamBridgeNotifyResult = { shown: boolean };

/**
 * How close two banners for one conversation must be to count as one burst.
 *
 * The watcher polls every 30 s, so messages inside one poll are already one
 * banner by construction; this covers the poll boundary and a focus-refetch
 * landing just after a timed poll. Ten seconds is "a few seconds" with margin
 * for a slow history read, and short enough that a reply minutes later sounds.
 */
export const TEAM_BRIDGE_COALESCE_MS = 10_000;

/**
 * The OS identifier for an account's conversation banner.
 *
 * Namespaced so it can never collide with the `DesktopNotifier`'s random ids,
 * and built from the already-validated owner and conversation IDs (`SAFE_ID`), so it is a
 * legal `UNNotificationRequest` identifier and toast tag as-is.
 */
export function teamBridgeBannerId(
	accountId: string,
	conversationId: string,
): string {
	// SAFE_ID permits colons; escape each component so two different pairs
	// cannot collapse to one OS identifier at the account separator.
	return `team-bridge:${encodeURIComponent(accountId)}:${encodeURIComponent(conversationId)}`;
}

/**
 * The text lines one platform can render.
 *
 * Electron documents `subtitle` as macOS-only: on Windows and Linux the field
 * is dropped silently, and a banner without its place would not say whether the
 * message was a DM or a channel post. There the place leads the body instead,
 * the same "one shape that degrades on no platform" join `DesktopNotifier.show`
 * applies to its status line.
 */
export function teamBridgeBannerLines(
	request: Pick<TeamBridgeNotifyRequest, "title" | "subtitle" | "body">,
	platform: NodeJS.Platform,
): Pick<TeamBridgeBannerOptions, "title" | "subtitle" | "body"> {
	if (!request.subtitle) return { title: request.title, body: request.body };
	if (platform === "darwin") {
		return {
			title: request.title,
			subtitle: request.subtitle,
			body: request.body,
		};
	}
	return {
		title: request.title,
		body: `${request.subtitle} — ${request.body}`,
	};
}

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
	viewing: boolean | undefined,
): boolean {
	if (!window) return false;
	/*
	 * `viewing: false` is the renderer saying the focused window is on some
	 * OTHER screen (another conversation, a chat session): the person is not
	 * looking at this message, so focus alone does not silence it. ABSENT keeps
	 * the original rule (focus is quiet) for a renderer that cannot say.
	 */
	if (viewing === false) return false;
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
	/** When each conversation's live banner was raised, for `COALESCE_MS`. */
	private readonly raisedAt = new Map<string, number>();
	/** The banners this process must keep reachable for their clicks to fire. */
	private lifetime = new NotificationLifetime();
	private pendingOpen: TeamBridgeOpenTarget | null = null;
	private pendingUnavailable = false;
	/** Last settled owner outlives renderer documents and credential refresh. */
	private settledOwner: string | undefined;
	private awaitingDocument = false;
	private authority: TeamBridgeNotifyAuthority | null = null;
	// Unknown revokes delivery, not the epoch's established identity. Otherwise
	// A -> unknown -> B could silently replace A without a credential write.
	private epochOwner: string | undefined;
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

	/** Only the authorized shell's journal subscription calls this, NEVER notify.
	 * Delayed requests cannot promote their captured owner to live authority.
	 * Epochs only advance; same-epoch settlement may resolve an unknown owner,
	 * but a different known owner cannot replace it without a credential write.
	 * This fences client races, not a compromised renderer or server-side auth. */
	setAuthority(input: unknown): void {
		const next = parseTeamBridgeNotifyAuthority(input);
		if (!next) throw new Error("Invalid Team Bridge notification authority.");
		const current = this.authority;
		if (
			current &&
			(next.epoch < current.epoch ||
				(next.epoch === current.epoch &&
					this.epochOwner &&
					next.accountId &&
					next.accountId !== this.epochOwner))
		)
			return;
		if (
			current?.epoch === next.epoch &&
			current.accountId === next.accountId &&
			current.settling === next.settling
		)
			return;
		// A refresh temporarily has no account. Hold existing banners/clicks,
		// but do not admit new delivery until the account actually settles.
		if (!next.settling && this.settledOwner !== next.accountId) this.revoke();
		if (!next.settling) this.settledOwner = next.accountId;
		if (!current || next.epoch > current.epoch) this.epochOwner = undefined;
		this.epochOwner ??= next.accountId;
		this.authority = next;
		this.awaitingDocument = false;
		if (!next.settling && this.pendingOpen) this.options.host.signalOpen();
	}

	/** Document epochs restart on reload. Only main's document lifecycle can
	 * reset that counter; an IPC payload cannot lower it. */
	resetAuthority(): void {
		// A new document has a new epoch journal, not a new signed-in person.
		// Keep the last settled owner and banners; suspend admission until its
		// replacement reports the actual account. No-window clicks remain live.
		this.authority = null;
		this.epochOwner = undefined;
		this.awaitingDocument = true;
	}

	private revoke(): void {
		// Preserve only neutral stale feedback after a settled account change.
		if (this.pendingOpen) this.pendingUnavailable = true;
		for (const notification of this.banners.values()) notification.close?.();
		this.banners.clear();
		this.raisedAt.clear();
		// Some adapters do not emit close. Drop this owner's retention registry
		// anyway; other desktop notification owners keep their own lifetimes.
		this.lifetime = new NotificationLifetime();
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
		if (
			this.awaitingDocument ||
			this.authority?.settling ||
			!teamBridgeNotifyOwnerMatches(request.owner, this.authority)
		)
			return { shown: false };
		if (this.options.show === "never") return { shown: false };
		if (!this.canNotify()) return { shown: false };
		if (teamBridgeWindowIsQuiet(this.options.window(), request.viewing)) {
			return { shown: false };
		}
		const previous = this.options.store.notifiedSeq(
			request.owner.accountId,
			request.conversationId,
		);
		if (previous !== undefined && request.seq <= previous) {
			return { shown: false };
		}
		const now = (this.options.now ?? Date.now)();
		const lastRaised = this.raisedAt.get(request.conversationId);
		const burst =
			this.banners.has(request.conversationId) &&
			lastRaised !== undefined &&
			now - lastRaised < TEAM_BRIDGE_COALESCE_MS;
		this.replace(request.conversationId);
		/*
		 * NAMED `notification`, NOT `banner`, BECAUSE THE WINDOW-MODE GUARD READS
		 * THE NAME (scripts/window-mode.test.mjs). That guard allows Electron's
		 * own Notification show call by the one spelling and refuses every other
		 * show call under `src/main/`; a banner object named `banner` is
		 * indistinguishable to it from a window. The variable is a Notification
		 * and the name now says so. This is the same rule the allow-list states:
		 * the exemption is one line, and it is spelled.
		 */
		const notification = this.createBanner({
			id: teamBridgeBannerId(request.owner.accountId, request.conversationId),
			groupId: teamBridgeBannerId(
				request.owner.accountId,
				request.conversationId,
			),
			...teamBridgeBannerLines(
				request,
				this.options.platform ?? process.platform,
			),
			silent: burst,
			...(this.options.icon ? { icon: this.options.icon } : {}),
		});
		/*
		 * RETAINED AND WIRED BY THE SAME CALL, for the reason
		 * `notification-lifetime.ts` states at length: a collected wrapper's
		 * click emits nothing, and this is the one supported way to attach the
		 * handler. The extra `close` listener is map bookkeeping, not lifetime.
		 */
		// Native Notification owns the displayed text until OS dismissal. Our
		// long-lived click/close handlers need only routing IDs, never preview
		// text: do not capture the preview-bearing IPC request in these closures.
		const conversationId = request.conversationId;
		const target: TeamBridgeOpenTarget = {
			owner: request.owner,
			conversationId,
			tenantId: request.tenantId,
			...(request.threadId ? { threadId: request.threadId } : {}),
		};
		this.retainTarget(notification, target);
		notification.show();
		this.banners.set(request.conversationId, notification);
		this.raisedAt.set(request.conversationId, now);
		// Recorded only after `show()`: a banner that failed to exist was never
		// a thing the user was told about, and advancing first would suppress
		// the retry forever.
		this.options.store.record(
			request.owner.accountId,
			request.conversationId,
			request.seq,
		);
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
	takePendingOpen(): TeamBridgeOpenResult | null {
		// Mount pulls can precede the new document's auth read. Keep the click
		// parked until settlement instead of consuming it under an unknown owner.
		if (this.awaitingDocument || this.authority?.settling) return null;
		const pending = this.pendingOpen;
		this.pendingOpen = null;
		if (!pending) return null;
		const unavailable = this.pendingUnavailable;
		this.pendingUnavailable = false;
		return !unavailable && pending.owner.accountId === this.authority?.accountId
			? pending
			: { unavailable: true };
	}

	private replace(conversationId: string): void {
		const previous = this.banners.get(conversationId);
		if (!previous) return;
		this.banners.delete(conversationId);
		previous.close?.();
	}

	/** Separate scope makes it impossible for handlers to retain the IPC request. */
	private retainTarget(
		notification: TeamBridgeBanner,
		target: TeamBridgeOpenTarget,
	): void {
		const conversationId = target.conversationId;
		this.lifetime.retain(notification, () => {
			const live = this.banners.get(conversationId) === notification;
			if (live) this.banners.delete(conversationId);
			// A click racing native withdrawal still deserves visible feedback,
			// but A -> B -> A must not revive a banner that was already revoked.
			this.open(target, !live);
		});
		notification.once("close", () => {
			if (this.banners.get(conversationId) === notification) {
				this.banners.delete(conversationId);
			}
		});
	}

	private open(target: TeamBridgeOpenTarget, unavailable = false): void {
		/*
		 * ALWAYS PARKED FIRST, THEN SIGNALLED. The signal wakes a loaded renderer,
		 * but a renderer that is loading or reloading has no listener yet and the
		 * event would be lost. The target therefore stays pending until a renderer
		 * asks for it (`takePendingOpen`), which happens on mount and on every
		 * signal - so a dropped signal costs latency, never the click.
		 */
		this.pendingOpen = target;
		this.pendingUnavailable = unavailable;
		const window = this.options.window();
		if (window && !window.isDestroyed()) {
			this.options.host.signalOpen();
			this.options.present?.(window);
			return;
		}
		this.options.host.reopen();
	}
}
