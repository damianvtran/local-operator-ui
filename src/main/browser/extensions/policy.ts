/**
 * Pure policy for extension consent and updates (design §4.1). No I/O, so the
 * rules that decide what a user agreed to are testable without Electron.
 */
import type { ExtensionManifest } from "./install";

/** What an extension can reach, derived ONLY from a verified manifest — never
 * from the store page's `details.manifest`, which is page-supplied and could
 * understate access (design §1 row 2e). */
export interface ExtensionAccess {
	allSites: boolean;
	hosts: string[];
	permissions: string[];
}

const ALL_SITE_PATTERNS = new Set([
	"<all_urls>",
	"*://*/*",
	"http://*/*",
	"https://*/*",
]);

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** Chrome match pattern host part, or null when it is not a URL pattern. A host
 * of `*` on any web scheme is equivalent to all websites. */
function patternHost(pattern: string): string | null {
	const match = /^(\*|https?|wss?|file|ftp):\/\/([^/]*)\//.exec(pattern);
	return match ? match[2] : null;
}

export function accessOf(manifest: ExtensionManifest): ExtensionAccess {
	const patterns = [...strings(manifest.host_permissions)];
	// Content-script matches are host access too: Chrome's install prompt lists
	// them, and a script on a page can read and change it.
	if (Array.isArray(manifest.content_scripts))
		for (const script of manifest.content_scripts)
			if (script && typeof script === "object")
				patterns.push(...strings((script as { matches?: unknown }).matches));
	const permissions: string[] = [];
	for (const permission of strings(manifest.permissions)) {
		// MV3 moved hosts out of `permissions`, but a stray pattern there still
		// grants access in Chrome: count it as a host, never drop it.
		if (permission.includes("://") || permission === "<all_urls>")
			patterns.push(permission);
		else permissions.push(permission);
	}
	let allSites = false;
	const hosts = new Set<string>();
	for (const pattern of patterns) {
		if (ALL_SITE_PATTERNS.has(pattern)) {
			allSites = true;
			continue;
		}
		const host = patternHost(pattern);
		if (host === "*") allSites = true;
		else if (host) hosts.add(host);
	}
	return {
		allSites,
		hosts: [...hosts].sort(),
		permissions: [...new Set(permissions)].sort(),
	};
}

/** True when `next` asks for anything `consented` did not include. Chrome
 * disables such an update pending approval; so do we (keep the old version). */
export function accessGrew(
	consented: ExtensionAccess,
	next: ExtensionAccess,
): boolean {
	if (next.allSites && !consented.allSites) return true;
	const hosts = new Set(consented.hosts);
	const permissions = new Set(consented.permissions);
	return (
		(!consented.allSites && next.hosts.some((host) => !hosts.has(host))) ||
		next.permissions.some((permission) => !permissions.has(permission))
	);
}

/** Chrome extension versions: 1-4 dot-separated integers, each 0..65535, no
 * leading zeros. Null for anything else (an unparsable version never updates). */
export function parseExtensionVersion(value: unknown): number[] | null {
	if (
		typeof value !== "string" ||
		!/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(value)
	)
		return null;
	const parts = value.split(".").map(Number);
	if (parts.some((part) => part > 65535)) return null;
	while (parts.length < 4) parts.push(0);
	return parts;
}

/** Full 4-part comparison. electron-chrome-web-store compares only 3 parts, so
 * `8.12.44.33` → `8.12.44.34` never updated there (design §1 row 3b). Returns
 * null when either side is unparsable. */
export function compareExtensionVersions(
	a: unknown,
	b: unknown,
): number | null {
	const left = parseExtensionVersion(a);
	const right = parseExtensionVersion(b);
	if (!left || !right) return null;
	for (let index = 0; index < 4; index++)
		if (left[index] !== right[index])
			return left[index] < right[index] ? -1 : 1;
	return 0;
}

/** An update is accepted only when STRICTLY newer: equal or lower versions are a
 * replay/rollback and are refused even though they are validly signed. */
export function isStrictUpgrade(installed: unknown, offered: unknown): boolean {
	return compareExtensionVersions(installed, offered) === -1;
}
