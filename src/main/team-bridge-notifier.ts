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
import { t } from "../i18n/index";
import {
	TEAM_BRIDGE_NOTIFY_MAX_TITLE,
	type TeamBridgeNotifyAuthority,
	type TeamBridgeNotifyRequest,
	type TeamBridgeOpenResult,
	type TeamBridgeOpenTarget,
	isTeamBridgeNotifyId,
	parseTeamBridgeNotifyAuthority,
	parseTeamBridgeNotifyRequest,
	safeTeamBridgeBannerText,
	teamBridgeNotifyOwnerMatches,
} from "../shared/team-bridge-notify";
import {
	type LifetimeNotification,
	NotificationLifetime,
} from "./notification-lifetime";
import type {
	TeamBridgeNotificationDirectory,
	TeamBridgeNotificationImageSource,
} from "./team-bridge-notification-images";
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
	/** Sender composite or app fallback. Electron 44.3.0 maps macOS icon to
	 * UNNotificationAttachment (thumbnail); the bundle icon remains attribution.
	 * Windows uses appLogoOverride/crop=none; Linux passes libnotify image-data. */
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
	/** Memory-only enrichment, bounded by TEAM_BRIDGE_IMAGE_WAIT_MS. A late
	 * result is for the next banner; it never mutates or re-posts this one. */
	images?: TeamBridgeNotificationImageSource;
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
	/** Test seams for the bounded credential-refresh wait. Production uses the
	 * platform timer; a test clock keeps that window deterministic. */
	setSettleTimer?: (callback: () => void, delay: number) => unknown;
	clearSettleTimer?: (timer: unknown) => void;
	/** Test seams for the bounded composite wait. Same reason as the settle
	 * seams: the deadline is a promise race, so a real 250 ms sleep per case
	 * would only slow the suite without proving anything more. */
	setWaitTimer?: (callback: () => void, delay: number) => unknown;
	clearWaitTimer?: (timer: unknown) => void;
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
/** Operator-approved ceiling for a cache-miss composite (decision a-a06c).
 * The fallback is unconditional at this deadline; no post-path retry exists. */
export const TEAM_BRIDGE_IMAGE_WAIT_MS = 250;

/**
 * How long a credential refresh may stay unresolved before its banners are
 * withdrawn.
 *
 * WHILE SETTLING THE BANNERS ARE KEPT, because the person is usually still the
 * same account. But a refresh that never settles - an account read that fails, a
 * callout the user abandons - never says so, and their message previews would
 * then sit in Notification Center indefinitely on a machine that may be handed
 * to someone else. Ten minutes covers an interactive re-authentication (typing a
 * password, an SSO round trip) without outliving the session. The deadline
 * withdraws the banners and leaves their clicks answering with the neutral
 * stale sentence instead of routing.
 */
export const TEAM_BRIDGE_SETTLE_TIMEOUT_MS = 10 * 60_000;

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
	/** Armed only while a credential refresh is unresolved; see the timeout doc. */
	private settleTimer: unknown;
	/** Bumped by every withdrawal. A notify that waited across one must not post. */
	private revision = 0;
	/** Banners withdrawn on purpose: their clicks answer as stale, not as a route. */
	private readonly revokedBanners = new WeakSet<TeamBridgeBanner>();
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
	 * and a different known owner replaces it only through a real credential
	 * write OR a document reload (whose fresh journal restarts the counter).
	 * This fences client races, not a compromised renderer or server-side auth. */
	setAuthority(input: unknown): void {
		const next = parseTeamBridgeNotifyAuthority(input);
		if (!next) throw new Error("Invalid Team Bridge notification authority.");
		const current = this.authority;
		if (current && next.epoch < current.epoch) return;
		if (
			current?.epoch !== next.epoch ||
			current.accountId !== next.accountId ||
			current.settling !== next.settling
		) {
			this.options.images?.clear();
		}
		/*
		 * A SETTLED OWNER THAT CHANGED WITHOUT AN EPOCH BUMP IS A SWITCH THAT
		 * BYPASSED THIS JOURNAL - a credential replaced outside the app (a CLI
		 * sign-in), followed by the window-focus re-read. The old fence simply
		 * returned, which left the previous pass's `settling` in place: the
		 * departing account's previews stayed delivered, their clicks were held
		 * forever, and the new account was admitted nothing.
		 *
		 * So treat it as what it is - a completed sign-out for delivery - without
		 * admitting the new owner through an epoch that never advanced: withdraw,
		 * remember who is settled, answer any parked click, and stay closed until a
		 * real credential write establishes the next owner.
		 */
		if (
			current &&
			next.epoch === current.epoch &&
			this.epochOwner &&
			next.accountId &&
			next.accountId !== this.epochOwner
		) {
			if (!next.settling) {
				this.clearSettleDeadline();
				this.settledOwner = next.accountId;
				this.authority = { epoch: next.epoch, settling: false };
				this.revoke();
				if (this.pendingOpen) this.options.host.signalOpen();
			}
			return;
		}
		if (
			current?.epoch === next.epoch &&
			current.accountId === next.accountId &&
			current.settling === next.settling
		)
			return;
		// A refresh temporarily has no account. Hold existing banners/clicks,
		// but do not admit new delivery until the account actually settles.
		// NOTE the tradeoff: a hold whose account read never answers is bounded by
		// `TEAM_BRIDGE_SETTLE_TIMEOUT_MS` rather than by this branch, and a DELIBERATE
		// sign-out does not come through here at all - the renderer publishes it as
		// already-settled, so its banners are withdrawn on the press itself.
		if (!next.settling && this.settledOwner !== next.accountId) this.revoke();
		if (!next.settling) this.settledOwner = next.accountId;
		if (next.settling) this.armSettleDeadline();
		else this.clearSettleDeadline();
		if (!current || next.epoch > current.epoch) this.epochOwner = undefined;
		this.epochOwner ??= next.accountId;
		this.authority = next;
		this.awaitingDocument = false;
		if (!next.settling && this.pendingOpen) this.options.host.signalOpen();
	}

	/** The renderer already fetched this roster; main revalidates its narrow
	 * envelope and drops entries whose member/hash disappeared, then warms the
	 * rest. Tenant scoping prevents one roster refreshing another tenant. */
	syncDirectory(input: unknown): void {
		if (
			this.awaitingDocument ||
			this.authority?.settling ||
			!this.authority?.accountId
		)
			return;
		const authority = this.authority;
		if (!authority?.accountId) return;
		const directory = input as Partial<TeamBridgeNotificationDirectory> | null;
		if (
			!directory ||
			// Narrow at the boundary (review n1): core would refuse a bad tenant,
			// but an id this module cannot key on should never reach the cache.
			!isTeamBridgeNotifyId(directory.tenantId) ||
			!Array.isArray(directory.members)
		)
			return;
		this.options.images?.syncDirectory({
			owner: { accountId: authority.accountId, epoch: authority.epoch },
			tenantId: directory.tenantId,
			members: directory.members as TeamBridgeNotificationDirectory["members"],
		});
	}

	resetAuthority(): void {
		this.options.images?.clear();
		this.clearSettleDeadline();
		// A new document has a new epoch journal, not a new signed-in person.
		// Keep the last settled owner and banners; suspend admission until its
		// replacement reports the actual account. No-window clicks remain live.
		this.authority = null;
		this.epochOwner = undefined;
		this.awaitingDocument = true;
	}

	/**
	 * Withdraw banners when a settling period never resolves.
	 *
	 * The timer is deliberately owned here rather than in the renderer: main is
	 * where the delivered banner and its preview live, so main is where they must
	 * be given up even if the renderer is gone.
	 */
	private armSettleDeadline(): void {
		this.clearSettleDeadline();
		const setTimer =
			this.options.setSettleTimer ??
			((callback: () => void, delay: number) => {
				const timer = setTimeout(callback, delay);
				// A queued deadline must not hold this process open by itself.
				timer.unref?.();
				return timer;
			});
		this.settleTimer = setTimer(() => {
			// Nothing settled, so this is a sign-out for privacy purposes: waiting
			// longer cannot make a preview that is already delivered safer. The
			// authority is marked SETTLED with no account so a click on a withdrawn
			// banner answers immediately instead of being held forever, and a late
			// successful refresh can still establish an owner again.
			this.settleTimer = undefined;
			this.settledOwner = undefined;
			this.authority = this.authority
				? { epoch: this.authority.epoch, settling: false }
				: null;
			this.revoke();
			/*
			 * The parked click has to be told, not wait for an unrelated event.
			 * `revoke()` already answers it as unavailable, but the renderer only
			 * reads that answer when main signals it or the window is asked for a
			 * target on mount - and a settled-to-absent update carrying the same
			 * epoch and no account is DEDUPED by `setAuthority` above, so a later
			 * sign-out settlement would never signal either. Signalling here is
			 * what makes the deadline a second exit rather than a privacy-only
			 * withdrawal.
			 */
			if (this.pendingOpen) this.options.host.signalOpen();
		}, TEAM_BRIDGE_SETTLE_TIMEOUT_MS);
	}

	private clearSettleDeadline(): void {
		if (this.settleTimer === undefined) return;
		const clearTimer =
			this.options.clearSettleTimer ??
			((timer: unknown) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>));
		clearTimer(this.settleTimer);
		this.settleTimer = undefined;
	}

	private revoke(): void {
		// Fences every banner still inside its image wait: see `notify`.
		this.revision += 1;
		this.options.images?.clear();
		// Preserve only neutral stale feedback after a settled account change.
		if (this.pendingOpen) this.pendingUnavailable = true;
		for (const notification of this.banners.values()) {
			// Membership is what makes a later click answer as stale instead of
			// routing: a banner replaced by a newer one, or dismissed by the OS,
			// was never withdrawn by this module and keeps its route.
			this.revokedBanners.add(notification);
			notification.close?.();
		}
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
	async notify(input: unknown): Promise<TeamBridgeNotifyResult> {
		const request = parseTeamBridgeNotifyRequest(input);
		if (request === null) {
			throw new Error("Invalid Team Bridge notification payload.");
		}
		// Cheap refusals first, so a suppressed banner never spends a photo
		// request. The SAME predicate runs again after the wait (below).
		if (!this.admits(request)) return { shown: false };
		/*
		 * THE WAIT IS THE ONLY AWAIT IN THIS METHOD, AND EVERYTHING THAT READS OR
		 * MUTATES DELIVERY STATE COMES AFTER IT (review M1). While a banner waits
		 * up to 250 ms the account can sign out or switch, the window can gain
		 * focus, and a second notify for the same conversation can arrive. So:
		 *
		 * - `revision` is captured before and compared after. `revoke()` bumps
		 *   it; a banner that waited across a withdrawal belongs to the withdrawn
		 *   set, and posting it would put a private preview on screen AFTER the
		 *   sign-out closed everything else.
		 * - admission (owner/epoch/settling/quiet/seq) is re-run on the live state.
		 * - replace, the burst decision, show and seq recording all happen in one
		 *   synchronous block after the wait, so two notifies racing in one
		 *   conversation serialise there: the later seq replaces the earlier, an
		 *   equal or older seq is refused, and exactly one banner stays tracked
		 *   in `this.banners`, where `revoke()` can close it.
		 *
		 * Each notification owns its own deadline; no shared queue/lock means an
		 * in-flight first banner cannot delay a second one. A late photo is only
		 * cached: it never replaces or re-posts a delivered banner.
		 *
		 * THE RACE LIVES HERE, NOT IN THE CACHE. The cache is enrichment; this is
		 * the post path, and it is the layer that must never wait on one. A slow,
		 * broken or foreign image source therefore cannot delay a banner either.
		 */
		const revision = this.revision;
		const icon = (await this.withImageDeadline(request)) ?? this.options.icon;
		if (revision !== this.revision || !this.admits(request))
			return { shown: false };
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
		const sender = request.sender;
		const title = sender
			? safeTeamBridgeBannerText(
					sender.kind === "person_agent"
						? t("ui.teamBridge.chief.label", {
								person: sender.display_name,
								agent: sender.agent_name ?? "",
							})
						: sender.display_name,
					TEAM_BRIDGE_NOTIFY_MAX_TITLE,
				)
			: request.title;
		const notification = this.createBanner({
			id: teamBridgeBannerId(request.owner.accountId, request.conversationId),
			groupId: teamBridgeBannerId(
				request.owner.accountId,
				request.conversationId,
			),
			...teamBridgeBannerLines(
				{ ...request, title },
				this.options.platform ?? process.platform,
			),
			silent: burst,
			...(icon ? { icon } : {}),
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
		// Only AFTER show/seq recording. Same-tag replacement can re-alert on
		// macOS/Windows and Linux has no public stable-id replacement guarantee.
		// Until each platform proves otherwise, completion warms future fallback
		// only: never close/re-show or mutate this event's routing/lifetime.
		return { shown: true };
	}

	/**
	 * Whether this request may raise a banner against the LIVE state.
	 *
	 * One predicate, called before and after the bounded image wait, so the two
	 * checks cannot drift apart. Every clause reads state the wait can change.
	 */
	private admits(request: TeamBridgeNotifyRequest): boolean {
		if (
			this.awaitingDocument ||
			this.authority?.settling ||
			!teamBridgeNotifyOwnerMatches(request.owner, this.authority)
		)
			return false;
		if (this.options.show === "never") return false;
		if (!this.canNotify()) return false;
		if (teamBridgeWindowIsQuiet(this.options.window(), request.viewing))
			return false;
		const previous = this.options.store.notifiedSeq(
			request.owner.accountId,
			request.conversationId,
		);
		return previous === undefined || request.seq > previous;
	}

	/**
	 * Await one sender composite for AT MOST `TEAM_BRIDGE_IMAGE_WAIT_MS`.
	 *
	 * Resolves early on a hit. On a miss it starts (or joins) the cache's
	 * single flight and resolves at the deadline even if that flight never
	 * settles, so a hub that hangs costs the banner 250 ms and no more. A
	 * composite that lands later stays in the cache for the next banner; this
	 * promise has already resolved and nothing here re-posts or replaces a
	 * delivered banner.
	 *
	 * No retry exists on this path, by construction: the wait is tried once per
	 * notification, and a refusal is remembered by the cache, not by this call.
	 */
	private async withImageDeadline(
		request: TeamBridgeNotifyRequest,
	): Promise<NativeImage | string | undefined> {
		const images = this.options.images;
		if (!images) return undefined;
		const reading = images.read(request, TEAM_BRIDGE_IMAGE_WAIT_MS);
		const setTimer =
			this.options.setWaitTimer ??
			((callback: () => void, delay: number) => {
				const timer = setTimeout(callback, delay);
				timer.unref?.();
				return timer;
			});
		const clearTimer =
			this.options.clearWaitTimer ??
			((timer: unknown) =>
				clearTimeout(timer as ReturnType<typeof setTimeout>));
		let timer: unknown;
		try {
			// When the deadline wins, post what is ALREADY in memory: the initials
			// warmed at directory load (QA Q-1, plan a-a06c "else initials"). A
			// synchronous lookup, never a second request in the post path.
			return (
				(await Promise.race([
					reading,
					new Promise<undefined>((resolve) => {
						timer = setTimer(
							() => resolve(undefined),
							TEAM_BRIDGE_IMAGE_WAIT_MS,
						);
					}),
				])) ?? images.peek(request)
			);
		} finally {
			// Reading rejects? `read` never does; this guard keeps a future one from
			// becoming an unhandled rejection that would silence the banner.
			reading.catch(() => undefined);
			if (timer !== undefined) clearTimer(timer);
		}
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
			// A banner REPLACED by a newer one, or dismissed by the OS, belongs to the
			// account that is still signed in: that click routes to the conversation.
			// Only a banner this process withdrew answers with the stale sentence.
			this.open(target, this.revokedBanners.has(notification));
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
