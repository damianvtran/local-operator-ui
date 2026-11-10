import { randomUUID } from "node:crypto";
import type {
	MediaKind,
	MediaPermissionDecision,
	MediaPermissionView,
} from "../../shared/browser-media-permission";
import { readJson, writeJsonAtomic } from "./atomic-json";

/**
 * Camera and microphone for the driven browser: a per-origin decision the HUMAN
 * makes, remembered in the browser profile's own state directory.
 *
 * WHY THIS EXISTS. The browser session used to deny every permission
 * (`profile.ts`), so a video-call site's `getUserMedia` was rejected silently and
 * the user's "Use microphone and camera" click produced no prompt at all. This
 * module is the one exception to that default: `media` (and only `media`) is
 * routed here, and every other permission stays a constant refusal.
 *
 * THE SECURITY INVARIANT — only a real human click can grant:
 *   1. A grant is minted only by `decide()`, and `decide()` is reachable only
 *      through the `browser-media-permission-decide` IPC channel, which
 *      `ipc.ts`'s `authorize()` restricts to the app window's own top frame at
 *      the trusted renderer URL. The driven pages have no preload and cannot
 *      send on it; the agent drives pages over CDP and the harness RPC
 *      (`rpc.ts`/`host.ts`), and neither exposes a media decision. There is
 *      deliberately NO agent-facing method here — do not add one.
 *   2. The decision must echo the prompt's random `id`, which is projected only
 *      to the chrome renderer (never to a page or to the agent's state), and it
 *      must arrive with `trusted: true`, the renderer's `event.isTrusted` for the
 *      click. A scripted `.click()` inside the chrome renders `isTrusted: false`
 *      and is dropped — defence in depth behind (1), not a replacement for it.
 *   3. A remembered allow is applied silently only to USER-owned tabs. On an
 *      agent-owned tab every request prompts again and an allow there is
 *      one-shot and not persisted, so a site the user allowed for their own
 *      call cannot become a silent recording surface for an agent's tab.
 *
 * ATTRIBUTION (v1 is top-level only). A request is considered only when the
 * requesting frame's origin equals the tab's top-level origin; a cross-origin
 * subframe is denied without a prompt. Chrome would instead attribute an
 * `allow="camera"`-delegated iframe to the top-level origin; that is a wider
 * surface than the reported use (a call site at the top level) needs, so it is
 * left out until a real site requires it. The origin shown is the browser-side
 * one Electron hands the handler, never a string the page chose.
 *
 * LIFETIME: the Electron callback is held until the user decides. Dismiss, a
 * main-frame navigation, the tab closing and the host stopping all answer
 * `false`, so no callback is ever leaked or answered twice.
 *
 * macOS: an in-app allow is not enough on its own — the OS (TCC) also gates
 * this app's camera/microphone. After the user allows, a `not-determined` OS
 * status asks macOS (its own system prompt); `denied`/`restricted` denies the
 * request and projects a `system-blocked` notice pointing at System Settings,
 * since nothing inside the app can change that answer.
 *
 * RESET: decisions are per origin and are erased by the existing "forget this
 * site" action and by "clear browsing data — everything" (wired in `index.ts`).
 * There is no site-settings page in v1; the in-place recovery for a Block is the
 * `blocked` band (below), which never touches the site's cookies.
 *
 * THE `<usermedia>` ELEMENT (review Q1/U1). Google Meet's "Use microphone and
 * camera" is Chromium's page-embedded permission element, not a
 * `getUserMedia` call. Measured on Electron 45.1.0 (a hidden-window probe that
 * clicked `<usermedia>` with `type="camera microphone"`, `"microphone"` and
 * `"camera"`): every click sends TWO `media` requests whose details are only
 * `{ isMainFrame, requestingUrl }` — no `mediaTypes`, whatever the `type`. So
 * the narrowest set main can know is camera + microphone, and an unnamed
 * request is treated as exactly that (`kindsOf`). Both requests then name the
 * same set, so they coalesce into ONE prompt and one decision answers both.
 * A request that names only devices other than audio/video is still denied.
 * The page is not told when that Allow changes its permission state, so a
 * page that waits for the change (Google Meet) is reloaded once if it does not
 * capture by itself: see `ELEMENT_FOLLOW_UP_MS` (review Q3/U10).
 *
 * MERGE RULE (review R1). Decisions are stored PER DEVICE: a decision writes
 * exactly the devices its prompt named and leaves every other device's answer
 * as it was (Block on a microphone-only prompt never touches a stored camera
 * Allow). A request is granted without a prompt only when EVERY device it names
 * is allowed, and denied when ANY is blocked. After each decision the tab's
 * other waiting requests from the same origin are re-read against that rule, so
 * an Allow for camera + microphone also answers a microphone-only request that
 * was queued behind it, instead of asking the user again.
 *
 * BLOCKED BAND (review U2). On a user-owned tab, a request denied because of a
 * remembered Block raises a `blocked` view so the user can see why the page did
 * nothing and Allow from there (a trusted click, like every grant). Dismissing
 * it is "not now" (review U11): the band stays hidden for
 * `BLOCKED_BAND_QUIET_MS`, so a page retrying in a loop cannot pin it on screen,
 * and the next request from the same origin after that re-raises it, so a
 * user's later retry never fails silently. Navigation clears the quiet period.
 */

/**
 * How long a dismissed blocked band stays hidden on its tab (review U11). Not a
 * bound on a measured distribution: it is a rate limit on how often a page's own
 * retries can re-surface the band. Electron's permission request carries no
 * user-gesture flag, so main cannot tell a click-driven retry from a loop; a
 * person who dismisses the band and then tries again on the page (find the
 * button, click it) takes longer than this, while a page retrying every second
 * can show it at most once per window.
 */
export const BLOCKED_BAND_QUIET_MS = 3_000;

/**
 * THE ELEMENT FOLLOW-UP (review Q3/U10, the operator's Google Meet flow).
 *
 * After the user allows a `<usermedia>` element's request on our prompt, the
 * page's permission state flips to `granted`, but the page is never TOLD:
 * Electron's permission manager publishes no permission-change notification
 * (its 45.1.0 `ElectronPermissionManager` has no subscription path), so
 * `PermissionStatus` `change` never fires. A page that follows the element's
 * `promptaction` with its own `getUserMedia` works; Google Meet waits for that
 * change event instead and keeps its "Use microphone and camera" dialog up
 * until a reload (QA round 2, runs M2/M4/M5: no capture request for 16 s).
 * After a reload the page reads `granted` at load and captures straight away
 * (Meet: `getUserMedia` for audio and video ~1 s after load, both live).
 *
 * So: when an Allow on our prompt grants an element request on a USER tab, wait
 * `ELEMENT_FOLLOW_UP_MS` for the page's own capture (any `media` request that
 * names a device, from the same origin, on that tab). If it comes, the page
 * picked up the grant and nothing happens. If it does not, the tab is reloaded
 * once, which is what the user would otherwise have to discover by themselves.
 *
 * Alternatives measured and rejected, in the real app on meet.google.com:
 *   - Disabling Blink's `UserMediaElement` (webPreferences
 *     `disableBlinkFeatures`) does remove the element, but Meet then shows no
 *     camera/microphone dialog at all: Electron's check handler can only answer
 *     granted/denied (no `prompt`), so an undecided site reads `denied` and Meet
 *     offers nothing to click. It also needs a process-wide switch to hold,
 *     since a reused renderer process keeps the element.
 *   - Answering the element's unnamed `media` check from the stored answers:
 *     still no `change` event, and Meet's second click stopped working.
 *
 * Scope, deliberately narrow: only after a decision on OUR prompt (the moment
 * the state changed), only for the element's unnamed requests (a page's own
 * `getUserMedia` resolves directly), only on user tabs (an agent tab's Allow is
 * one-shot and a reload would ask again), and cancelled by navigation, tab
 * close, dispose, or a newer element grant.
 *
 * The wait, measured in the real app (PR #1843 round-2 evidence): on local
 * `<usermedia>` pages that call `getUserMedia` from `promptaction`, the page's
 * own capture request reached main 3, 5, 14 and 486 ms after the Allow (n=4,
 * the 486 ms one a cold first page); Meet sent none in 16 s (QA round 2) and
 * none in 10 s (round-2 remediation run). 2.5 s is five times the slowest page
 * that did follow up, and short enough that the meeting visibly moves on right
 * after Allow.
 */
export const ELEMENT_FOLLOW_UP_MS = 2_500;

export type StoredMediaDecision = "allow" | "block";

/** The persisted document. Versioned so a future shape can be read or dropped
 * deliberately rather than misread. */
export interface MediaPermissionsDocument {
	version: 1;
	origins: Record<string, Partial<Record<MediaKind, StoredMediaDecision>>>;
}

/** Electron's `systemPreferences.getMediaAccessStatus` answers, plus the
 * `unknown` a platform without TCC reports through the adapter. */
export type SystemMediaStatus =
	| "not-determined"
	| "granted"
	| "denied"
	| "restricted"
	| "unknown";

/** The OS gate, injected so tests can stand in for TCC and non-macOS platforms
 * can answer "granted" without touching `systemPreferences`. */
export interface SystemMediaAccess {
	status: (kind: MediaKind) => SystemMediaStatus;
	/** Show the OS prompt; resolves to whether access is now granted. */
	ask: (kind: MediaKind) => Promise<boolean>;
}

export interface MediaTabFacts {
	tabId: number;
	owner: "user" | "agent";
}

export interface MediaPermissionsOptions {
	/** `<userData>/browser/media-permissions.json`, or null for an in-memory
	 * store (tests). */
	filePath: string | null;
	system: SystemMediaAccess;
	/** The registry tab behind a webContents, or null for anything that is not a
	 * tab (a popup, an overlay) — those are denied. */
	tabFor: (webContentsId: number) => MediaTabFacts | null;
	/** The tab's projection changed (a prompt appeared or went away). */
	onChanged?: () => void;
	log?: (message: string) => void;
	now?: () => number;
	/** Reload a tab whose page did not pick up an element grant; see
	 * `ELEMENT_FOLLOW_UP_MS`. */
	reloadTab?: (tabId: number) => void;
	/** Timer seam (tests); returns a cancel. Defaults to `setTimeout`. */
	setTimer?: (fn: () => void, ms: number) => () => void;
}

/** What the request handler passes in, already read off Electron's arguments. */
export interface MediaRequestInput {
	webContentsId: number;
	/** The tab's current top-level URL (`webContents.getURL()`). */
	topUrl: string;
	/** `details.securityOrigin` when present, else `details.requestingUrl`. */
	requestingOrigin: string;
	/** Electron's `details.mediaTypes`; anything other than audio/video is
	 * ignored. */
	mediaTypes: readonly string[] | undefined;
}

export interface MediaCheckInput {
	webContentsId: number | null;
	topUrl: string;
	requestingOrigin: string;
	/** Electron's check `details.mediaType`: `audio`, `video` or `unknown`. */
	mediaType: string | undefined;
}

interface Pending {
	id: string;
	tabId: number;
	origin: string;
	kinds: MediaKind[];
	owner: "user" | "agent";
	at: number;
	/** Asked by a `<usermedia>` element (no device named); see
	 * `ELEMENT_FOLLOW_UP_MS`. */
	element: boolean;
	/** Every Electron callback waiting on this one prompt (a page that calls
	 * `getUserMedia` twice before answering gets one prompt, both answered). */
	callbacks: Array<(granted: boolean) => void>;
}

const OS_NAME: Record<MediaKind, "microphone" | "camera"> = {
	audio: "microphone",
	video: "camera",
};

/**
 * The ONLY URLs the system-blocked notice's "Open System Settings" may open
 * (review U6/D3): macOS's Privacy & Security panes for this app's camera and
 * microphone access. A fixed allowlist in main, keyed by device, so the
 * renderer can name a notice but never a URL handed to `shell.openExternal`.
 */
export const SYSTEM_SETTINGS_URL = {
	camera:
		"x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
	microphone:
		"x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
} as const;

/**
 * `scheme://host[:port]` for a URL or origin string, or null. Only a
 * potentially-trustworthy origin may use capture devices — the web platform
 * already requires a secure context for `getUserMedia`, and this keeps the
 * store from ever holding an `http://` site's grant: https, or http on a
 * loopback host (a developer's local app).
 */
export function mediaOriginOf(raw: string): string | null {
	if (!raw) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.protocol === "https:") return url.origin;
	if (
		url.protocol === "http:" &&
		(url.hostname === "localhost" ||
			url.hostname === "127.0.0.1" ||
			url.hostname === "[::1]")
	) {
		return url.origin;
	}
	return null;
}

function kindsOf(mediaTypes: readonly string[] | undefined): MediaKind[] {
	// No device named at all: the `<usermedia>` permission element, which asks
	// for camera + microphone (see the module comment for the measurement).
	if (!mediaTypes || mediaTypes.length === 0) return ["audio", "video"];
	const kinds: MediaKind[] = [];
	for (const type of mediaTypes ?? []) {
		if ((type === "audio" || type === "video") && !kinds.includes(type)) {
			kinds.push(type);
		}
	}
	// A stable order, so `[video, audio]` and `[audio, video]` coalesce.
	return kinds.sort();
}

export class MediaPermissions {
	private readonly options: MediaPermissionsOptions;
	private readonly now: () => number;
	private readonly setTimer: (fn: () => void, ms: number) => () => void;
	private document: MediaPermissionsDocument;
	/** Per tab, in arrival order; the head is the one the chrome shows. */
	private readonly pending = new Map<number, Pending[]>();
	/** The last macOS refusal per tab, shown until dismissed or navigated away. */
	private readonly systemBlocked = new Map<
		number,
		{ id: string; origin: string; kinds: MediaKind[]; at: number }
	>();
	/** A remembered Block turned a user tab's request away; see `blocked`. */
	private readonly blockedNotice = new Map<
		number,
		{ id: string; origin: string; kinds: MediaKind[]; at: number }
	>();
	/** When the user dismissed each tab's blocked band; cleared on navigation.
	 * The band stays hidden for `BLOCKED_BAND_QUIET_MS` after it (review U11). */
	private readonly blockedDismissed = new Map<number, number>();
	/**
	 * Bumped by `clearTab` (navigation, close, dispose). An OS ask is awaited
	 * AFTER the entry has left `pending`, so `clearTab` cannot reach its
	 * callbacks; the grant re-reads this after the await and answers `false`
	 * (and raises no notice) when the document that asked is gone (review R2).
	 */
	private readonly generation = new Map<number, number>();
	/** Per tab: an element grant waiting for the page's own capture request. */
	private readonly followUp = new Map<
		number,
		{ origin: string; cancel: () => void }
	>();
	private disposed = false;

	constructor(options: MediaPermissionsOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		this.setTimer =
			options.setTimer ??
			((fn, ms) => {
				const timer = setTimeout(fn, ms);
				return () => clearTimeout(timer);
			});
		this.document = this.load();
	}

	private load(): MediaPermissionsDocument {
		const empty: MediaPermissionsDocument = { version: 1, origins: {} };
		if (!this.options.filePath) return empty;
		const raw = readJson<MediaPermissionsDocument>(this.options.filePath);
		// A corrupt or foreign document reads as "nothing decided": every site
		// prompts again, which is the fail-closed direction.
		if (
			!raw ||
			raw.version !== 1 ||
			typeof raw.origins !== "object" ||
			raw.origins === null
		) {
			return empty;
		}
		const origins: MediaPermissionsDocument["origins"] = {};
		for (const [origin, entry] of Object.entries(raw.origins)) {
			if (mediaOriginOf(origin) !== origin || !entry) continue;
			const clean: Partial<Record<MediaKind, StoredMediaDecision>> = {};
			for (const kind of ["audio", "video"] as const) {
				const value = entry[kind];
				if (value === "allow" || value === "block") clean[kind] = value;
			}
			if (Object.keys(clean).length > 0) origins[origin] = clean;
		}
		return { version: 1, origins };
	}

	private save(): void {
		if (!this.options.filePath) return;
		if (!writeJsonAtomic(this.options.filePath, this.document)) {
			this.options.log?.(
				"[browser] could not save camera/microphone site decisions",
			);
		}
	}

	private remember(
		origin: string,
		kinds: readonly MediaKind[],
		decision: StoredMediaDecision,
	): void {
		const entry = { ...(this.document.origins[origin] ?? {}) };
		for (const kind of kinds) entry[kind] = decision;
		this.document.origins[origin] = entry;
		this.save();
	}

	/** The remembered decisions, for tests and diagnostics. */
	decisions(): MediaPermissionsDocument {
		return JSON.parse(JSON.stringify(this.document));
	}

	/**
	 * The permission CHECK handler's answer. True only for an origin + device the
	 * USER allowed, on a user-owned tab, while the OS also grants it — the same
	 * facts under which `request()` would grant without a prompt, so the two
	 * handlers cannot disagree. Everything else is false, which makes the page
	 * fall through to a request (and so to the prompt).
	 */
	check(input: MediaCheckInput): boolean {
		if (this.disposed || input.webContentsId === null) return false;
		const kind = input.mediaType;
		if (kind !== "audio" && kind !== "video") return false;
		const origin = mediaOriginOf(input.requestingOrigin);
		if (!origin || origin !== mediaOriginOf(input.topUrl)) return false;
		const tab = this.options.tabFor(input.webContentsId);
		if (!tab || tab.owner !== "user") return false;
		if (this.document.origins[origin]?.[kind] !== "allow") return false;
		return this.options.system.status(kind) === "granted";
	}

	/** Everything that denies a request before any decision is consulted, as
	 * the reason string for the log; otherwise the facts the request needs. */
	private screen(
		input: MediaRequestInput,
	): string | { origin: string; kinds: MediaKind[]; tab: MediaTabFacts } {
		if (this.disposed) return "the browser is stopping";
		const kinds = kindsOf(input.mediaTypes);
		if (kinds.length === 0) return "no camera or microphone was named";
		const origin = mediaOriginOf(input.requestingOrigin);
		if (!origin) return "the requesting page is not a secure origin";
		// v1 is top-level only (see the module comment).
		if (origin !== mediaOriginOf(input.topUrl)) {
			return `a frame from ${origin} is not the page's own site`;
		}
		const tab = this.options.tabFor(input.webContentsId);
		if (!tab) return `${origin} is not in a browser tab`;
		return { origin, kinds, tab };
	}

	/**
	 * The permission REQUEST handler for `media`. Always answers `callback`
	 * exactly once: now, or when the user decides, or `false` when the prompt
	 * stops being answerable (dismiss, navigation, tab close, dispose).
	 */
	request(
		input: MediaRequestInput,
		callback: (granted: boolean) => void,
	): void {
		const screened = this.screen(input);
		if (typeof screened === "string") {
			this.options.log?.(`[browser] denied camera/microphone: ${screened}`);
			callback(false);
			return;
		}
		const { origin, kinds, tab } = screened;
		const element = !input.mediaTypes || input.mediaTypes.length === 0;
		// The page's own capture after an element grant: it picked the grant up.
		if (!element) this.cancelFollowUp(tab.tabId, origin);
		const stored = this.document.origins[origin] ?? {};
		const blocked = kinds.filter((kind) => stored[kind] === "block");
		if (blocked.length > 0) {
			this.options.log?.(
				`[browser] denied camera/microphone: ${origin} is blocked for ${blocked.map((k) => OS_NAME[k]).join(" and ")}`,
			);
			callback(false);
			this.raiseBlocked(tab, origin, blocked);
			return;
		}
		if (
			tab.owner === "user" &&
			kinds.every((kind) => stored[kind] === "allow")
		) {
			void this.grantThroughSystem(tab.tabId, origin, kinds, [callback]);
			return;
		}

		const queue = this.pending.get(tab.tabId) ?? [];
		const same = queue.find(
			(entry) => entry.origin === origin && entry.kinds.join() === kinds.join(),
		);
		if (same) {
			same.callbacks.push(callback);
			same.element ||= element;
			return;
		}
		queue.push({
			id: randomUUID(),
			tabId: tab.tabId,
			origin,
			kinds,
			owner: tab.owner,
			at: this.now(),
			element,
			callbacks: [callback],
		});
		this.pending.set(tab.tabId, queue);
		this.options.log?.(
			`[browser] ${origin} asked for ${kinds.map((k) => OS_NAME[k]).join(" and ")}; waiting for the user`,
		);
		this.options.onChanged?.();
	}

	/** Show (or widen) the blocked band, for a USER tab only: an agent's tab has
	 * nobody watching it to recover, and its denial is the safe answer. */
	private raiseBlocked(
		tab: MediaTabFacts,
		origin: string,
		blocked: readonly MediaKind[],
	): void {
		if (tab.owner !== "user") return;
		const dismissedAt = this.blockedDismissed.get(tab.tabId);
		if (dismissedAt !== undefined) {
			if (this.now() - dismissedAt < BLOCKED_BAND_QUIET_MS) return;
			this.blockedDismissed.delete(tab.tabId);
		}
		const current = this.blockedNotice.get(tab.tabId);
		if (current && current.origin === origin) {
			const kinds = [...new Set([...current.kinds, ...blocked])].sort();
			if (kinds.join() === current.kinds.join()) return;
			current.kinds = kinds;
		} else {
			this.blockedNotice.set(tab.tabId, {
				id: randomUUID(),
				origin,
				kinds: [...blocked].sort(),
				at: this.now(),
			});
		}
		this.options.onChanged?.();
	}

	/** The macOS Settings pane for a LIVE system-blocked notice, or null. Main
	 * opens a fixed URL from it (`SYSTEM_SETTINGS_URL`); the renderer names only
	 * the notice, never a URL. Camera wins when both were refused: it is the one
	 * a video call cannot start without. */
	systemSettingsPaneFor(
		tabId: number,
		id: string,
	): keyof typeof SYSTEM_SETTINGS_URL | null {
		const notice = this.systemBlocked.get(tabId);
		if (!notice || notice.id !== id) return null;
		return notice.kinds.includes("video") ? "camera" : "microphone";
	}

	/** The active tab's projection: the head prompt, else a macOS refusal, else
	 * a remembered Block that just turned the page away. */
	viewFor(tabId: number): MediaPermissionView | null {
		const head = this.pending.get(tabId)?.[0];
		if (head) {
			return {
				kind: "prompt",
				tabId,
				id: head.id,
				origin: head.origin,
				kinds: [...head.kinds],
				ownerKind: head.owner,
				at: head.at,
			};
		}
		const system = this.systemBlocked.get(tabId);
		if (system) {
			return {
				kind: "system-blocked",
				tabId,
				...system,
				kinds: [...system.kinds],
			};
		}
		const blocked = this.blockedNotice.get(tabId);
		return blocked
			? { kind: "blocked", tabId, ...blocked, kinds: [...blocked.kinds] }
			: null;
	}

	/**
	 * The user's answer, from the chrome. Returns whether it was accepted; a stale
	 * id, a tab with nothing pending, or an untrusted (scripted) click is dropped
	 * and changes nothing. See the module comment for why this is the ONLY path
	 * that grants.
	 */
	async decide(
		tabId: number,
		id: string,
		decision: MediaPermissionDecision,
		gesture: { trusted: boolean },
	): Promise<boolean> {
		if (this.disposed) return false;
		const blocked = this.systemBlocked.get(tabId);
		if (blocked && blocked.id === id) {
			// The macOS notice has one action: dismiss. Nothing to grant.
			this.systemBlocked.delete(tabId);
			this.options.onChanged?.();
			return true;
		}
		const notice = this.blockedNotice.get(tabId);
		if (notice && notice.id === id) {
			if (decision === "allow") {
				// Allow from the blocked band is a grant like any other: trusted only.
				if (gesture.trusted !== true) {
					this.options.log?.(
						"[browser] ignored a camera/microphone answer that was not a user click",
					);
					return false;
				}
				// Shown on user tabs only (`raiseBlocked`), so remembering is right.
				this.remember(notice.origin, notice.kinds, "allow");
				this.options.log?.(
					`[browser] the user allowed ${notice.kinds.map((k) => OS_NAME[k]).join(" and ")} for ${notice.origin} (was blocked)`,
				);
			} else {
				this.blockedDismissed.set(tabId, this.now());
			}
			this.blockedNotice.delete(tabId);
			this.options.onChanged?.();
			return true;
		}
		const queue = this.pending.get(tabId);
		const head = queue?.[0];
		if (!queue || !head || head.id !== id) return false;
		if (gesture.trusted !== true) {
			this.options.log?.(
				"[browser] ignored a camera/microphone answer that was not a user click",
			);
			return false;
		}
		// R5: read the document's generation ONCE, before any OS ask. The siblings
		// leave `queue` here, so `clearTab` cannot reach them; if they each read the
		// generation when their own grant starts, a navigation during the head's
		// macOS dialog would hand them the NEW document's generation and grant (or
		// raise a system-blocked band) for a page that has gone.
		const generation = this.generation.get(tabId) ?? 0;
		queue.shift();
		// An agent-owned tab's answer is one-shot either way (invariant 3, and
		// review Q2 for Block): it covers this document's waiting requests below,
		// and nothing is persisted for the origin.
		if (head.owner === "user" && decision !== "dismiss") {
			this.remember(head.origin, head.kinds, decision);
		}
		const siblings = this.settleSiblings(queue, head, decision);
		if (queue.length === 0) this.pending.delete(tabId);

		if (decision === "allow") {
			this.options.log?.(
				`[browser] the user allowed ${head.kinds.map((k) => OS_NAME[k]).join(" and ")} for ${head.origin}`,
			);
			this.options.onChanged?.();
			// Serially, so a device macOS has not decided is asked once: the head's
			// ask settles its status before a sibling reads it.
			for (const entry of [head, ...siblings]) {
				const granted = await this.grantThroughSystem(
					tabId,
					entry.origin,
					entry.kinds,
					entry.callbacks,
					generation,
				);
				// Armed in the microtask after the callbacks ran: the page's own
				// capture request, if any, is a later IPC task, so it always finds
				// the follow-up armed and cancels it.
				if (granted && entry.element && entry.owner === "user") {
					this.armFollowUp(tabId, entry.origin, generation);
				}
			}
			return true;
		}
		this.options.log?.(
			`[browser] the user ${decision === "block" ? "blocked" : "dismissed"} ${head.kinds.map((k) => OS_NAME[k]).join(" and ")} for ${head.origin}`,
		);
		for (const callback of head.callbacks) callback(false);
		this.options.onChanged?.();
		return true;
	}

	/**
	 * Review R1: after a decision on `head`, answer every other waiting request in
	 * the same tab from the same origin that the MERGE RULE (module comment) now
	 * settles. Removes them from `queue` in place. Denied ones are answered here;
	 * the fully-allowed ones are returned for the caller to grant through the OS
	 * half. Requests the decision does not fully settle keep waiting.
	 *
	 * On a user tab the rule reads the stored answers (which `decide` just
	 * updated). On an agent tab nothing is stored, so the one-shot answer covers
	 * only the devices this prompt named: a waiting request is settled when the
	 * human's answer covers it on that same document, and asked otherwise.
	 */
	private settleSiblings(
		queue: Pending[],
		head: Pending,
		decision: MediaPermissionDecision,
	): Pending[] {
		if (decision === "dismiss") return [];
		const answerFor = (kind: MediaKind): StoredMediaDecision | undefined =>
			head.owner === "user"
				? this.document.origins[head.origin]?.[kind]
				: head.kinds.includes(kind)
					? decision
					: undefined;
		const granted: Pending[] = [];
		for (let i = queue.length - 1; i >= 0; i--) {
			const entry = queue[i];
			if (entry.origin !== head.origin) continue;
			const answers = entry.kinds.map(answerFor);
			if (answers.includes("block")) {
				queue.splice(i, 1);
				for (const callback of entry.callbacks) callback(false);
			} else if (answers.every((answer) => answer === "allow")) {
				queue.splice(i, 1);
				granted.unshift(entry);
			}
		}
		return granted;
	}

	/**
	 * The OS half of a grant. Asks macOS only for a device whose status is still
	 * `not-determined`; a `denied`/`restricted` device denies the whole request
	 * (a call that asked for both must not silently start with one) and raises
	 * the System Settings notice.
	 */
	private async grantThroughSystem(
		tabId: number,
		origin: string,
		kinds: readonly MediaKind[],
		callbacks: ReadonlyArray<(granted: boolean) => void>,
		/** The document generation the request belongs to; `decide` passes the one
		 * it read before any OS ask (R5), `request` the current one. */
		generation: number = this.generation.get(tabId) ?? 0,
	): Promise<boolean> {
		const refused: MediaKind[] = [];
		for (const kind of kinds) {
			const status = this.options.system.status(kind);
			if (status === "granted") continue;
			if (status === "not-determined") {
				let granted = false;
				try {
					granted = await this.options.system.ask(kind);
				} catch {
					granted = false;
				}
				if (granted) continue;
			}
			refused.push(kind);
		}
		// R2: the OS ask may have outlived the document (navigation, tab close,
		// stop). Its answer then belongs to nobody: deny, and raise no notice on a
		// tab that has moved on.
		if (this.disposed || (this.generation.get(tabId) ?? 0) !== generation) {
			for (const callback of callbacks) callback(false);
			return false;
		}
		if (refused.length > 0) {
			this.systemBlocked.set(tabId, {
				id: randomUUID(),
				origin,
				kinds: refused,
				at: this.now(),
			});
			this.options.log?.(
				`[browser] macOS has ${refused.map((k) => OS_NAME[k]).join(" and ")} access turned off for this app; denied ${origin}`,
			);
			for (const callback of callbacks) callback(false);
			this.options.onChanged?.();
			return false;
		}
		for (const callback of callbacks) callback(true);
		return true;
	}

	/** See `ELEMENT_FOLLOW_UP_MS`. One per tab: a newer grant replaces it. */
	private armFollowUp(tabId: number, origin: string, generation: number): void {
		this.cancelFollowUp(tabId);
		const cancel = this.setTimer(() => {
			this.followUp.delete(tabId);
			if (this.disposed || (this.generation.get(tabId) ?? 0) !== generation) {
				return;
			}
			this.options.log?.(
				`[browser] ${origin} did not start the camera or microphone after the user allowed it; reloading the tab so the page picks up the permission`,
			);
			this.options.reloadTab?.(tabId);
		}, ELEMENT_FOLLOW_UP_MS);
		this.followUp.set(tabId, { origin, cancel });
	}

	/** Drop the tab's follow-up; with `origin`, only if it is for that origin. */
	private cancelFollowUp(tabId: number, origin?: string): void {
		const pending = this.followUp.get(tabId);
		if (!pending || (origin !== undefined && pending.origin !== origin)) return;
		pending.cancel();
		this.followUp.delete(tabId);
	}

	/** A main-frame navigation: the document that asked is gone, so its
	 * prompts are answered `false` and its notice no longer applies. */
	clearTab(tabId: number): void {
		const queue = this.pending.get(tabId);
		const had =
			Boolean(queue?.length) ||
			this.systemBlocked.has(tabId) ||
			this.blockedNotice.has(tabId);
		this.generation.set(tabId, (this.generation.get(tabId) ?? 0) + 1);
		this.cancelFollowUp(tabId);
		this.pending.delete(tabId);
		this.systemBlocked.delete(tabId);
		this.blockedNotice.delete(tabId);
		this.blockedDismissed.delete(tabId);
		for (const entry of queue ?? []) {
			for (const callback of entry.callbacks) callback(false);
		}
		if (had) this.options.onChanged?.();
	}

	/** The tab closed: same as a navigation, nothing may outlive it. The
	 * generation entry is kept (not deleted) so an OS ask still in flight for the
	 * closed tab reads a moved generation; tab ids are not reused. */
	forget(tabId: number): void {
		this.clearTab(tabId);
	}

	/** "Forget this site": erase the origin's remembered decisions. */
	forgetOrigin(rawOrigin: string): void {
		const origin = mediaOriginOf(rawOrigin);
		if (!origin || !this.document.origins[origin]) return;
		delete this.document.origins[origin];
		this.save();
	}

	/** "Clear browsing data — everything". */
	clearAll(): void {
		this.document = { version: 1, origins: {} };
		this.save();
	}

	/** The host is stopping: answer everything still waiting. */
	dispose(): void {
		if (this.disposed) return;
		const tabs = new Set([
			...this.pending.keys(),
			...this.systemBlocked.keys(),
			...this.blockedNotice.keys(),
			...this.followUp.keys(),
		]);
		for (const tabId of tabs) this.clearTab(tabId);
		this.disposed = true;
	}
}
