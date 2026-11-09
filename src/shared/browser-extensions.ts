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

/** `worker`: the MV3 service worker did not start within the deadline, so the
 * extension is loaded but not honestly usable. Surfaced, never retried silently. */
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
}

export type ExtensionsRequest =
	| { op: "list" }
	| { op: "set-enabled"; id: string; enabled: boolean }
	| { op: "uninstall"; id: string }
	| { op: "open-popup"; id: string }
	| { op: "open-options"; id: string }
	| { op: "open-store" }
	| { op: "check-updates" }
	| { op: "cancel"; id: string };

export interface ExtensionsResponse {
	extensions: ExtensionSummary[];
	/** False when main refused or failed the op; the list is still current. */
	ok: boolean;
	/** Count of verified updates applied by a `check-updates` request. */
	updated?: number;
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
