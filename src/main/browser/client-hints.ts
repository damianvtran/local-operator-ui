import type { Session } from "electron";

/**
 * The browser tab's User-Agent Client Hints — the `Sec-CH-UA*` request headers —
 * made to agree with what the same tab's page already reads from
 * `navigator.userAgentData` and `navigator.userAgent`.
 *
 * WHY THIS EXISTS (operator report: Google sign-in answered the tab with
 * "Couldn't sign you in — This browser or app may not be secure"). The UA STRING
 * was already Chrome-shaped (`profile.ts` `browserUserAgent`), but a sign-in
 * risk check reads more than the string. Measured 2026-11-07 on a loopback page
 * that echoes request headers, Electron 45.1.0 / Chromium 156.0.8078.49 against
 * Google Chrome 156.0.8078.81 on the same machine:
 *
 *   surface                         this tab (live 0.52.1 + built main)  Chrome
 *   navigation Sec-CH-UA*           ABSENT (none at all)                  sent
 *   high-entropy after Accept-CH    never sent (Accept-CH ignored)        sent
 *   subresource Sec-CH-UA           "Not:A-Brand";v="8", "Chromium";v="156"  + "Google Chrome"
 *   navigator.userAgentData.brands  Not:A-Brand 8, Chromium 156           + Google Chrome 156
 *
 * So the defect is a browser that claims `Chrome/156` in its UA string and then
 * sends NO client hints on its document requests — a shape no real Chromium-based
 * browser has, and exactly the inconsistency a "is this a real browser" check is
 * built to notice. The cause is structural, not a setting: client hints on a
 * NAVIGATION are added by Chrome's browser-side `ClientHintsControllerDelegate`
 * (which also persists `Accept-CH`), and Electron's browser context has none; the
 * renderer adds the low-entropy trio to its own SUBRESOURCE requests, which is why
 * those carry it and documents do not. `session.setUserAgent` has no metadata
 * parameter, so nothing in Electron's API reaches either gap.
 *
 * WHY "Chromium" AND NOT "Google Chrome" — the measured constraint. The JS surface
 * (`navigator.userAgentData`, and the renderer's own subresource headers that
 * follow it) can only be changed by CDP `Emulation.setUserAgentOverride` with
 * `userAgentMetadata`, and only while a debugger is attached to that view
 * (measured: with the override set, JS brands and subresource headers gained
 * "Google Chrome" but navigation requests STILL carried no `Sec-CH-UA` — the CDP
 * route does not reach the missing delegate either). Claiming "Google Chrome" in
 * headers would therefore need a debugger attached to EVERY view in the
 * partition — human tabs, popups and restored tabs included — from before its
 * first request, and re-applied after DevTools takes the view; a tab where that
 * slipped would present headers and JS that disagree, which is the exact defect
 * being fixed. Presenting the engine's own identity instead — the brand list the
 * runtime already gives the page — is consistent on every view by construction,
 * because the only half that was missing (the browser-side headers) is supplied
 * here at the session's network layer, for every request any view makes. It is
 * also the truthful one: this IS Chromium, and a Chromium browser presents exactly
 * `Chrome/<major>.0.0.0` plus a `[GREASE, "Chromium"]` brand list.
 *
 * WHAT IS DELIBERATELY NOT DONE: no other-engine spoofing, no JS shims in the
 * page's world (a patched `navigator` is itself detectable), and no `Critical-CH`
 * restart — Chrome retries a navigation whose response lists critical hints it did
 * not send; this layer cannot restart a request, so an opted-in origin receives
 * high-entropy hints from its NEXT request onward. The opt-ins live in memory for
 * the process lifetime (Chrome persists them in prefs), so the first document
 * request after a restart behaves like a first visit.
 */

/** The facts the hints are composed from, injected so the composition is pure. */
export interface ClientHintFacts {
	/** `process.versions.chrome`, e.g. `156.0.8078.49`. */
	chromeVersion: string;
	/** `process.platform`. */
	platform: NodeJS.Platform;
	/** `process.arch`. */
	arch: string;
	/**
	 * The OS version as Chromium reports it in `platformVersion`: on macOS the
	 * product version (`process.getSystemVersion()`), on Linux the kernel release.
	 */
	platformVersion: string;
}

export interface BrandVersion {
	brand: string;
	version: string;
}

/**
 * Chromium's GREASEd brand list, reproduced from
 * `components/embedder_support/user_agent_utils.cc` (`GenerateBrandVersionList`
 * / `GetGreasedUserAgentBrandVersion`), seeded by the major version exactly as
 * Chromium seeds it. Reproduced rather than invented because the page reads the
 * runtime's own copy of this list from `navigator.userAgentData`, and the header
 * must say the same thing byte for byte; the drift check in `installClientHints`
 * compares this against the renderer's own subresource header at run time.
 *
 * Pinned against real values in `scripts/browser-client-hints.test.mjs`
 * (Chrome 120 `"Not_A Brand";v="8"`, Chrome 124 `"Not-A.Brand";v="99"` last,
 * Chromium 156 `"Not:A-Brand";v="8"` first, as measured here).
 */
export function greasedBrandList(
	major: number,
	full: string | null,
	extraBrand: string | null = null,
): BrandVersion[] {
	const chars = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
	const versions = ["8", "99", "24"];
	const grease = {
		brand: `Not${chars[major % chars.length]}A${chars[(major + 1) % chars.length]}Brand`,
		version: versions[major % versions.length],
	};
	const fullOf = (v: string) => (full === null ? v : `${v}.0.0.0`);
	const greased = { brand: grease.brand, version: fullOf(grease.version) };
	const chromium = { brand: "Chromium", version: full ?? String(major) };
	if (extraBrand === null) {
		const order = [
			[0, 1],
			[1, 0],
		][major % 2];
		const list: BrandVersion[] = [];
		list[order[0]] = greased;
		list[order[1]] = chromium;
		return list;
	}
	const orders = [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	];
	const order = orders[major % orders.length];
	const list: BrandVersion[] = [];
	list[order[0]] = greased;
	list[order[1]] = chromium;
	list[order[2]] = { brand: extraBrand, version: full ?? String(major) };
	return list;
}

/** Structured-header serialisation of a brand list: `"A";v="1", "B";v="2"`. */
export function brandHeader(list: BrandVersion[]): string {
	return list
		.map(({ brand, version }) => `"${brand}";v="${version}"`)
		.join(", ");
}

const quoted = (value: string) => `"${value}"`;

/** Chromium's `platform` names for the hints. */
function platformName(platform: NodeJS.Platform): string {
	if (platform === "darwin") return "macOS";
	if (platform === "win32") return "Windows";
	if (platform === "linux") return "Linux";
	return "Unknown";
}

/** Chromium's `architecture` hint: `arm`/`x86`, with bitness carried separately. */
function architecture(arch: string): string {
	return arch.startsWith("arm") ? "arm" : "x86";
}

/** `platformVersion` normalised to three dot-separated numbers, as Chromium sends. */
export function normalisePlatformVersion(raw: string): string {
	const parts = (raw.match(/\d+/g) ?? []).slice(0, 3);
	while (parts.length < 3) parts.push("0");
	return parts.join(".");
}

/**
 * Every hint this tab can send, keyed by lowercase header name.
 *
 * `lowEntropy` goes on every request to a potentially trustworthy URL, as Chrome
 * sends it; `highEntropy` only to an origin that asked for that hint by
 * `Accept-CH`. Returns null on Windows: Chromium's Windows `platformVersion` is
 * the UniversalApiContract version, which nothing in Node reports, and a
 * fabricated value would be a new inconsistency rather than a fix — the tab there
 * keeps the runtime's behaviour unchanged.
 */
export function composeClientHints(facts: ClientHintFacts): {
	lowEntropy: Record<string, string>;
	highEntropy: Record<string, string>;
} | null {
	if (facts.platform === "win32") return null;
	const full = facts.chromeVersion;
	const major = Number.parseInt(full.split(".")[0] ?? "", 10);
	if (!Number.isFinite(major) || major <= 0) return null;
	return {
		lowEntropy: {
			"sec-ch-ua": brandHeader(greasedBrandList(major, null)),
			"sec-ch-ua-mobile": "?0",
			"sec-ch-ua-platform": quoted(platformName(facts.platform)),
		},
		highEntropy: {
			"sec-ch-ua-full-version-list": brandHeader(greasedBrandList(major, full)),
			"sec-ch-ua-full-version": quoted(full),
			"sec-ch-ua-platform-version": quoted(
				normalisePlatformVersion(facts.platformVersion),
			),
			"sec-ch-ua-arch": quoted(architecture(facts.arch)),
			"sec-ch-ua-bitness": quoted(facts.arch.endsWith("64") ? "64" : "32"),
			"sec-ch-ua-model": quoted(""),
			"sec-ch-ua-wow64": "?0",
			"sec-ch-ua-form-factors": quoted("Desktop"),
		},
	};
}

/**
 * The hint names an `Accept-CH` value asks for, lowercased; unknown names are
 * kept (they are simply never matched by `highEntropy`).
 */
export function parseAcceptCh(values: string[] | undefined): Set<string> {
	const names = new Set<string>();
	for (const value of values ?? []) {
		for (const part of value.split(",")) {
			const name = part.trim().toLowerCase();
			if (name) names.add(name);
		}
	}
	return names;
}

/** 127.0.0.0/8, which Chromium treats as loopback (potentially trustworthy). */
const LOOPBACK_V4 = /^127\.\d+\.\d+\.\d+$/;

/**
 * Chrome sends client hints only to potentially trustworthy URLs (HTTPS, WSS and
 * loopback), so the same rule here: hints over plain HTTP to a remote host would
 * be a shape Chrome never has.
 */
export function isPotentiallyTrustworthy(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol === "https:" || parsed.protocol === "wss:") return true;
	if (parsed.protocol !== "http:" && parsed.protocol !== "ws:") return false;
	const host = parsed.hostname;
	return (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host === "[::1]" ||
		LOOPBACK_V4.test(host)
	);
}

/** Header lookup in Electron's case-preserving header objects. */
function findHeader(
	headers: Record<string, string | string[]>,
	name: string,
): string | string[] | undefined {
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === name) return headers[key];
	}
	return undefined;
}

/**
 * Add the hints a request is missing, without touching any the request already
 * carries (the renderer's own subresource `Sec-CH-UA` is the runtime's truth and
 * wins). Pure, so the per-request decision is testable without a session.
 */
export function withClientHints(
	url: string,
	headers: Record<string, string>,
	hints: NonNullable<ReturnType<typeof composeClientHints>>,
	optedIn: Set<string> | undefined,
): Record<string, string> {
	if (!isPotentiallyTrustworthy(url)) return headers;
	const next = { ...headers };
	const add = (name: string, value: string) => {
		if (findHeader(next, name) === undefined) next[name] = value;
	};
	for (const [name, value] of Object.entries(hints.lowEntropy))
		add(name, value);
	if (optedIn) {
		for (const [name, value] of Object.entries(hints.highEntropy)) {
			if (optedIn.has(name)) add(name, value);
		}
	}
	return next;
}

const originOf = (url: string): string | null => {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
};

/**
 * Install the hints on the browser session (BROWSER_PARTITION only — the app's
 * own renderer is in the default session and never sees this).
 *
 * Session-level on purpose: every view in the partition — agent tabs, human tabs,
 * popups and restored tabs — makes its requests through this one network layer,
 * so there is no per-view wiring that a new kind of view could miss.
 *
 * ONE LISTENER PER EVENT PER SESSION is Electron's rule for `webRequest`, so this
 * must stay the only `onBeforeSendHeaders`/`onHeadersReceived` caller on the
 * browser session (the default session's `guardPreviewResponses` is a different
 * session). The returned function removes both listeners.
 */
export function installClientHints(
	browserSession: Session,
	facts: ClientHintFacts,
	log?: (line: string) => void,
): () => void {
	const hints = composeClientHints(facts);
	if (!hints) {
		log?.(
			`[browser] client hints left to the runtime on ${facts.platform}: no truthful platformVersion source`,
		);
		return () => {};
	}
	/** origin -> hint names it asked for by `Accept-CH`, for this process lifetime. */
	const acceptCh = new Map<string, Set<string>>();
	let driftReported = false;

	browserSession.webRequest.onHeadersReceived((details, callback) => {
		const origin = originOf(details.url);
		const accept = details.responseHeaders
			? Object.entries(details.responseHeaders).find(
					([key]) => key.toLowerCase() === "accept-ch",
				)?.[1]
			: undefined;
		if (origin && accept && isPotentiallyTrustworthy(details.url)) {
			acceptCh.set(origin, parseAcceptCh(accept));
		}
		callback({});
	});

	browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
		// Drift check: the renderer's own subresource header is the runtime's
		// brand list. If a future runtime changes the GREASE algorithm this module
		// reproduces, documents and subresources would disagree — say so once.
		if (!driftReported) {
			const own = findHeader(details.requestHeaders, "sec-ch-ua");
			if (typeof own === "string" && own !== hints.lowEntropy["sec-ch-ua"]) {
				driftReported = true;
				log?.(
					`[browser] client hints drift: runtime sends ${own}, host composes ${hints.lowEntropy["sec-ch-ua"]}`,
				);
			}
		}
		const origin = originOf(details.url);
		callback({
			requestHeaders: withClientHints(
				details.url,
				details.requestHeaders,
				hints,
				origin ? acceptCh.get(origin) : undefined,
			),
		});
	});

	return () => {
		browserSession.webRequest.onBeforeSendHeaders(null);
		browserSession.webRequest.onHeadersReceived(null);
	};
}
