/**
 * Typed projection of the embedded browser's extension manager (design
 * extension-manager-design.md §4.2). Shared by main, preload and renderer.
 *
 * WHY a closed request union with a strict decoder: the desktop renderer is the
 * ONLY caller (main authorizes the sender), but the channel still treats every
 * payload as untrusted bytes. Install is deliberately NOT an op here: an install
 * only originates from the Chrome Web Store page's own button in a user-owned,
 * presented, focused tab, followed by a native dialog that a renderer or agent
 * cannot click (see src/main/browser/extensions/webstore.ts).
 *
 * No extension path, CRX bytes, vault data or exception text crosses this
 * boundary: errors are categories, and a running worker is NOT a claim that the
 * extension's features (for example a password manager's passkeys) work.
 */

/** Chrome extension ids are 32 letters a-p (hex digits remapped). Every
 * id-bearing request is matched against this before it reaches a filesystem
 * path, so `..` or `../x` can never name a directory (design §1 row 2d). */
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function isExtensionId(value: unknown): value is string {
	return typeof value === "string" && EXTENSION_ID_PATTERN.test(value);
}

export type ExtensionStatus =
	| "enabled"
	| "disabled"
	| "loading"
	| "error"
	| "needs-reconsent";

/** `worker`: the MV3 service worker had not started by the deadline. The
 * extension stays loaded and is shown as "not ready" with a Retry action; main
 * also flips it to enabled on its own if the worker reaches `running` later
 * (QA Q3: a deadline missed under heavy host load is not a permanent error). */
export type ExtensionError =
	| null
	| "startup"
	| "download"
	| "verify"
	| "worker";

export interface ExtensionSummary {
	id: string;
	name: string;
	version: string;
	status: ExtensionStatus;
	error: ExtensionError;
	hasPopup: boolean;
	hasOptions: boolean;
	/** data: URL from the verified package, bounded in size; null when absent. */
	iconDataUrl: string | null;
	/** Access derived from the VERIFIED manifest that the user consented to. */
	allSites: boolean;
	hosts: string[];
	permissions: string[];
	/** A newer verified version that asks for more access waits for approval. */
	pendingVersion: string | null;
	/** Manifest description (resolved `__MSG_*__`), "" when absent. */
	description: string;
	/** Whether the manifest declares an http(s) homepage the page can open. */
	hasHomepage: boolean;
	/** Pages the extension asked to show while the app was not focused, queued
	 * until the user next opens it (review U1). Count only; URLs stay in main. */
	waitingPages: number;
}

/** An install in progress, before the consent dialog (review U5). No name yet:
 * the package has not been verified, so nothing from it is shown. */
export interface ExtensionInstallProgress {
	id: string;
	phase: "downloading" | "verifying";
}

/** Outcome of a manual update check (review U2): "up to date" is claimed only
 * when every check succeeded and nothing is waiting. */
export interface ExtensionUpdateReport {
	applied: number;
	/** Updates parked because they ask for more access. */
	pending: number;
	/** Downloads/verifications that failed (offline, store error). */
	failed: number;
}

export type ExtensionsRequest =
	| { op: "list" }
	| { op: "set-enabled"; id: string; enabled: boolean }
	| { op: "uninstall"; id: string }
	| { op: "open-popup"; id: string }
	| { op: "open-options"; id: string }
	| { op: "open-store" }
	/** The extension's Chrome Web Store listing / http(s) homepage, opened in a
	 * user tab. Main builds both URLs; the renderer names only the id. */
	| { op: "open-listing"; id: string }
	| { op: "open-homepage"; id: string }
	/** Reload an enabled extension whose worker was not ready (review U7). */
	| { op: "retry"; id: string }
	| { op: "check-updates" }
	| { op: "cancel"; id: string };

export interface ExtensionsResponse {
	extensions: ExtensionSummary[];
	/** False when main refused or failed the op; the list is still current. */
	ok: boolean;
	/** Present on a `check-updates` response. */
	updates?: ExtensionUpdateReport;
	/** Installs downloading/verifying right now (any op's response carries it). */
	installing?: ExtensionInstallProgress[];
}

/** Strict decoder: closed op set, exact field set, id regex. Returns null for
 * anything else so the IPC handler can reject without interpreting it. */
export function decodeExtensionsRequest(
	raw: unknown,
): ExtensionsRequest | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const value = raw as Record<string, unknown>;
	const keys = Object.keys(value).sort().join(",");
	switch (value.op) {
		case "list":
		case "open-store":
		case "check-updates":
			return keys === "op" ? { op: value.op } : null;
		case "uninstall":
		case "open-popup":
		case "open-options":
		case "open-listing":
		case "open-homepage":
		case "retry":
		case "cancel":
			return keys === "id,op" && isExtensionId(value.id)
				? { op: value.op, id: value.id }
				: null;
		case "set-enabled":
			return keys === "enabled,id,op" &&
				isExtensionId(value.id) &&
				typeof value.enabled === "boolean"
				? { op: "set-enabled", id: value.id, enabled: value.enabled }
				: null;
		default:
			return null;
	}
}

/** MV3 worker registration/start deadline. Measured on Electron 45.1.0 with the
 * official 1Password 8.12.44.33 package (source-controller native proof,
 * 2026-11-09): restore cycles n=2 at 5426/2057 ms, and an observed maximum of
 * 8407 ms post-extraction across the later proof runs. 30 s is >3.5x that; it
 * bounds engine registration/start only, so a hung worker becomes an honest
 * `error: "worker"` row instead of an endless "loading". */
export const EXTENSION_STARTUP_DEADLINE_MS = 30_000;

/** The Chrome Web Store listing for an id (built from the regex-checked id, so
 * it can only ever name the store's own detail page). */
export function storeListingUrl(id: string): string {
	return `https://chromewebstore.google.com/detail/${id}`;
}

/**
 * Plain-language permission rows (design D3): Chrome's own warning set, keyed
 * to `ui.browser.extensions.permission_<key>` messages. Permissions Chrome shows
 * no warning for (storage, alarms, scripting…) are omitted, as Chrome omits
 * them. `nativeMessaging` and `notifications` are DENIED globally by this
 * browser's adapter policy, so they are listed as blocked, never as granted.
 * Anything unknown is returned raw for a monospace fallback row.
 */
export type PermissionLabelKey =
	| "ui.browser.extensions.permission_block_content"
	| "ui.browser.extensions.permission_bookmarks"
	| "ui.browser.extensions.permission_clipboard_read"
	| "ui.browser.extensions.permission_clipboard_write"
	| "ui.browser.extensions.permission_content_settings"
	| "ui.browser.extensions.permission_cookies"
	| "ui.browser.extensions.permission_debugger"
	| "ui.browser.extensions.permission_downloads"
	| "ui.browser.extensions.permission_email"
	| "ui.browser.extensions.permission_history"
	| "ui.browser.extensions.permission_location"
	| "ui.browser.extensions.permission_management"
	| "ui.browser.extensions.permission_passkeys"
	| "ui.browser.extensions.permission_privacy"
	| "ui.browser.extensions.permission_proxy"
	| "ui.browser.extensions.permission_screen_capture";

const PERMISSION_LABELS: Record<string, PermissionLabelKey> = {
	history: "ui.browser.extensions.permission_history",
	tabs: "ui.browser.extensions.permission_history",
	topSites: "ui.browser.extensions.permission_history",
	webNavigation: "ui.browser.extensions.permission_history",
	bookmarks: "ui.browser.extensions.permission_bookmarks",
	clipboardRead: "ui.browser.extensions.permission_clipboard_read",
	clipboardWrite: "ui.browser.extensions.permission_clipboard_write",
	contentSettings: "ui.browser.extensions.permission_content_settings",
	cookies: "ui.browser.extensions.permission_cookies",
	debugger: "ui.browser.extensions.permission_debugger",
	declarativeNetRequest: "ui.browser.extensions.permission_block_content",
	declarativeNetRequestWithHostAccess:
		"ui.browser.extensions.permission_block_content",
	desktopCapture: "ui.browser.extensions.permission_screen_capture",
	tabCapture: "ui.browser.extensions.permission_screen_capture",
	downloads: "ui.browser.extensions.permission_downloads",
	geolocation: "ui.browser.extensions.permission_location",
	management: "ui.browser.extensions.permission_management",
	privacy: "ui.browser.extensions.permission_privacy",
	proxy: "ui.browser.extensions.permission_proxy",
	webAuthenticationProxy: "ui.browser.extensions.permission_passkeys",
	"identity.email": "ui.browser.extensions.permission_email",
};

const SILENT_PERMISSIONS = new Set([
	"activeTab",
	"alarms",
	"contextMenus",
	"idle",
	"offscreen",
	"scripting",
	"storage",
	"unlimitedStorage",
	"webRequest",
	"webRequestBlocking",
	"webRequestAuthProvider",
	"declarativeNetRequestFeedback",
	"identity",
	"power",
	"sidePanel",
	"system.display",
	"favicon",
	"privacy_policy",
	"loginState",
	"tts",
	"fontSettings",
	"commands",
	"background",
]);

export type BlockedCapability = "desktop_apps" | "notifications";

const BLOCKED: Record<string, BlockedCapability> = {
	nativeMessaging: "desktop_apps",
	notifications: "notifications",
};

export interface PermissionSummary {
	/** Message keys, de-duplicated, in first-seen order. */
	labels: PermissionLabelKey[];
	blocked: BlockedCapability[];
	/** Unknown tokens, shown raw as a fallback. */
	other: string[];
}

export function describePermissions(
	permissions: readonly string[],
): PermissionSummary {
	const labels: PermissionLabelKey[] = [];
	const blocked: BlockedCapability[] = [];
	const other: string[] = [];
	for (const permission of permissions) {
		const label = PERMISSION_LABELS[permission];
		const denied = BLOCKED[permission];
		if (denied) {
			if (!blocked.includes(denied)) blocked.push(denied);
		} else if (label) {
			if (!labels.includes(label)) labels.push(label);
		} else if (!SILENT_PERMISSIONS.has(permission)) other.push(permission);
	}
	return { labels, blocked, other };
}

/**
 * Chrome Web Store ids of password managers whose extension answers passkey
 * requests in page script (no `webAuthenticationProxy` permission to detect
 * them by). Used ONLY to word the passkey notice (review U10): with one
 * installed and on, the useful step is "open it and sign in", not "add one".
 * Misclassifying costs a less specific sentence, never access.
 */
const PASSWORD_MANAGER_IDS: ReadonlySet<string> = new Set([
	"aeblfdkhhhdcdjpifhhbdiojplfjncoa", // 1Password
	"nngceckbapebfimnlniiiahkandclblb", // Bitwarden
	"hdokiejnpimakedhajhdlcegeplioahd", // LastPass
	"fdjamakpfbbddfjaooikfcpapjohcfmg", // Dashlane
]);

/** The first installed, turned-on extension that can hold passkeys, if any. */
export function passwordManagerOf(
	extensions: readonly ExtensionSummary[],
): ExtensionSummary | null {
	return (
		extensions.find(
			(extension) =>
				extension.status === "enabled" &&
				(PASSWORD_MANAGER_IDS.has(extension.id) ||
					extension.permissions.includes("webAuthenticationProxy")),
		) ?? null
	);
}
