/**
 * What the MAIN window's renderer-side documents may do to the host, as pure rules.
 *
 * WHY THIS MODULE EXISTS (turn-supplements memo §4.1 / §8 F6, lane U-a). The
 * main window renders content this app did not write: agent-generated HTML in the
 * canvas preview, markdown from a transcript, and soon a generated "highlight"
 * frame. Until this change nothing stood between that content and three host
 * powers:
 *
 *  1. NAVIGATION. The main window had no `will-navigate` / `will-frame-navigate`
 *     handler, so a script that reached `location = ...` (the main frame's own,
 *     or a child frame's) went wherever it liked and the rest of the app's
 *     trust model (the preload bridge, the desktop plane's `senderFrame` URL
 *     check) rode on the page staying put.
 *  2. POPUPS. `setWindowOpenHandler` handed every non-auth `window.open` URL to
 *     `shell.openExternal` as a raw string. `openExternal` launches whatever the
 *     OS maps the scheme to (`file:`, custom protocol handlers, `smb:`), so a
 *     renderer-side script could start native applications. The "trusted auth
 *     domain" test in front of it was a SUBSTRING match
 *     (`hostname.includes("accounts.google.com")`, `details.url.includes(
 *     "storagerelay")`), so `https://accounts.google.com.attacker.test/` and
 *     `https://attacker.test/?storagerelay` were both classified as auth popups
 *     and handed a real window.
 *  3. PERMISSIONS. The default session installed no permission handlers, and
 *     Electron approves every request when none is set - camera, microphone,
 *     geolocation, notifications, clipboard read, for ANY frame including a
 *     sandboxed preview iframe.
 *
 * The rules are PURE (strings in, a verdict out, nothing from Electron) for the
 * same reason `palette-door.ts` is: the desktop suite bundles the shipped
 * TypeScript in memory and drives the whole table without a window
 * (`scripts/window-guards.test.mjs`), and `window-guards-electron.ts` stays a
 * thin adapter with no policy of its own. The real-runtime proof - a hostile
 * document in a real BrowserWindow - is `scripts/window-guards-electron.test.mjs`.
 */
import type { ExternalOpenOutcome } from "../shared/desktop-contract";
import { trustedDesktopFrame } from "./desktop-transport";

/** A verdict that carries its reason, so a denial is loggable and assertable. */
export type Verdict = { allowed: true } | { allowed: false; reason: string };

const ALLOW: Verdict = { allowed: true };
const deny = (reason: string): Verdict => ({ allowed: false, reason });

// ---------------------------------------------------------------------------
// Handing a URL to the operating system
// ---------------------------------------------------------------------------

/**
 * The schemes the app will hand to the OS.
 *
 * `http(s)` is the memo's rule (round-1 S-R11). `mailto:` is the one deliberate
 * addition: markdown's own safe-scheme list lets `[write](mailto:a@b.c)` through
 * (`LINK_URL_TRANSFORM` falls back to `defaultUrlTransform`), the link renders
 * as a `target="_blank"` anchor, and that has always reached the mail client
 * through this path - dropping it would silently kill a documented behaviour
 * (`link-toolkit.tsx`: "a `mailto:` link keeps exactly the behaviour it had").
 * `ircs:` / `xmpp:` rode the same list and are NOT kept: nothing in the app
 * produces them and each launches a native client with attacker-chosen arguments.
 */
const EXTERNAL_SCHEMES: ReadonlySet<string> = new Set([
	"https:",
	"http:",
	"mailto:",
]);

/** A URL longer than this is not a link a person clicked. */
const MAX_EXTERNAL_URL_LENGTH = 16_384;

/** One dot-separated part of an IPv4 literal. */
const IPV4_PART = /^\d{1,3}$/;

/** The IPv4-mapped IPv6 prefix, with the rest of the literal captured. */
const IPV6_MAPPED_PREFIX = /^::ffff:(.+)$/;

/** A hostname's trailing root dot (as in `localhost.`). */
const TRAILING_DOT = /\.$/;

/**
 * True for a dotted-quad IPv4 literal inside a loopback or private range:
 * 0/8 (this network), 127/8 (loopback), 10/8, 172.16/12 and 192.168/16
 * (RFC1918), 169.254/16 (link-local).
 */
function isPrivateIpv4(host: string): boolean {
	const parts = host.split(".");
	if (parts.length !== 4) return false;
	const octets: number[] = [];
	for (const part of parts) {
		if (!IPV4_PART.test(part)) return false;
		const value = Number(part);
		if (value > 255) return false;
		octets.push(value);
	}
	const [a, b] = octets;
	if (a === 0 || a === 127) return true;
	if (a === 10) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 169 && b === 254) return true;
	return false;
}

/**
 * True for an IPv6 literal in ::/::1, ::ffff:<v4> (unwrapped), fe80::/10
 * (link-local) or fc00::/7 (unique-local). `host` is bracket-stripped and
 * lowercased; an unparseable literal refuses.
 */
function isPrivateIpv6(host: string): boolean {
	if (host === "::" || host === "::1") return true;
	const mapped = IPV6_MAPPED_PREFIX.exec(host);
	if (mapped) {
		const rest = mapped[1];
		if (rest.includes(".")) return isPrivateIpv4(rest);
		const groups = rest.split(":");
		if (groups.length === 2) {
			const hi = Number.parseInt(groups[0], 16);
			const lo = Number.parseInt(groups[1], 16);
			if (Number.isFinite(hi) && Number.isFinite(lo)) {
				return isPrivateIpv4(
					[hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join("."),
				);
			}
		}
		return true;
	}
	const first = Number.parseInt(host.split(":")[0] || "0", 16);
	if (!Number.isFinite(first)) return true;
	if ((first & 0xffc0) === 0xfe80) return true;
	if ((first & 0xfe00) === 0xfc00) return true;
	return false;
}

/**
 * Canonical form of a hostname for the local/private rules below: lowercased,
 * with a trailing root dot stripped (`localhost.` is the FQDN spelling of
 * `localhost`; the URL parser does not fold it, and the daemon answers it).
 * ONE normaliser, so the three callers of `isLocalOrPrivateHost` cannot
 * disagree about a spelling (round-2 R-2).
 */
const canonicalHost = (hostname: string): string =>
	hostname.toLowerCase().replace(TRAILING_DOT, "");

/**
 * Whether a URL host names the user's own machine or their local network.
 *
 * THE ONE HOST TEST FOR ALL THREE LOCAL RULES (round-2 R-2): the external door
 * (security review S-5), the preview CSP predicate (`isStaticServeRequest`) and
 * the child-frame navigation rule (`frameNavigationVerdict`) all call THIS
 * function. Until they did, the predicate and the frame rule held a literal
 * three-name set while the door held the family below, so spellings the daemon
 * answers - `localhost.`, `127.0.0.2`, `[::ffff:127.0.0.1]` - got no CSP and
 * no frame containment, and the containment story was "two functions happen to
 * share a constant" rather than a rule. One spelling family, one test: a false
 * positive can only ADD policy (a CSP on a response nothing loads as a
 * document; a frame allowance for a host that is still the user's own), while
 * the other direction is the bypass the rules exist to close.
 *
 * WHY THE DOOR HALF EXISTS (security review S-5): the vetted external door
 * hands http(s) to the user's own browser, and a renderer-side script picks the
 * URL. Without this, app content could make the USER's browser issue requests
 * at the loopback daemon, a router console or a dev server - with the browser's
 * cookies, outside the app's trust model. Nothing in the renderer legitimately
 * opens the daemon in a browser, so these targets are refused.
 *
 * The WHATWG URL parser has already canonicalized the host when a verdict sees
 * it: `2130706433`, `0x7f.1` and `127.1` all arrive as `127.0.0.1`, so these
 * checks are over names, not spellings. A name that merely RESOLVES to loopback
 * (`lvh.me`, `localtest.me`) is deliberately NOT covered: resolution is neither
 * pure nor stable, and these rules are over names.
 */
export function isLocalOrPrivateHost(hostname: string): boolean {
	const host = canonicalHost(hostname);
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host.startsWith("[") && host.endsWith("]"))
		return isPrivateIpv6(host.slice(1, -1));
	return isPrivateIpv4(host);
}

export type ExternalVerdict =
	| { allowed: true; url: string }
	| { allowed: false; reason: string };

/**
 * Whether `raw` may be passed to `shell.openExternal`, and the string to pass.
 *
 * The URL handed back is the PARSED `href`, never the input: parsing strips the
 * leading control characters and whitespace some schemes' handlers have been
 * fooled by, and it is the one string the verdict was actually made about.
 */
export function externalUrlVerdict(raw: unknown): ExternalVerdict {
	if (typeof raw !== "string" || raw.length === 0)
		return { allowed: false, reason: "not a string" };
	if (raw.length > MAX_EXTERNAL_URL_LENGTH)
		return { allowed: false, reason: "too long" };
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { allowed: false, reason: "not a URL" };
	}
	if (!EXTERNAL_SCHEMES.has(url.protocol))
		return {
			allowed: false,
			reason: `scheme ${url.protocol} is not handed out`,
		};
	if (url.protocol !== "mailto:") {
		// `https://trusted.example@attacker.test/` reads as the first host.
		if (url.username || url.password)
			return { allowed: false, reason: "URL carries credentials" };
		if (!url.hostname) return { allowed: false, reason: "URL has no host" };
		if (isLocalOrPrivateHost(url.hostname))
			return {
				allowed: false,
				reason: "URL names a loopback or private-network host",
			};
	} else if (/(^|[?&])attach(ment)?=/i.test(url.search)) {
		// Some mail clients attach a local file named in the query.
		return { allowed: false, reason: "mailto: names an attachment" };
	}
	return { allowed: true, url: url.href };
}

/**
 * Vet `raw`, then hand it to `open`. Resolves to the outcome, refusal reason
 * included (round-2 R-4): the caller that has a person on the other end - the
 * `open-external` IPC, or `guardWindowOpen`'s refusal push - shows it.
 *
 * ONE function behind both doors to the OS that a renderer can reach - the
 * `open-external` IPC and the popup handler - so there is one answer to "what
 * may leave the app" and a second door cannot drift from the first.
 */
export async function openVettedExternal(
	raw: unknown,
	open: (url: string) => Promise<void> | void,
	log: (message: string) => void,
): Promise<ExternalOpenOutcome> {
	const verdict = externalUrlVerdict(raw);
	if (!verdict.allowed) {
		log(`[window-guard] refused to open externally: ${verdict.reason}`);
		return { ok: false, reason: verdict.reason };
	}
	try {
		await open(verdict.url);
		return { ok: true };
	} catch (error) {
		const reason = `the OS could not open the URL: ${error instanceof Error ? error.message : String(error)}`;
		log(`[window-guard] ${reason}`);
		return { ok: false, reason };
	}
}

// ---------------------------------------------------------------------------
// window.open
// ---------------------------------------------------------------------------

/**
 * Hosts a sign-in popup may load. Matched as the host itself or a subdomain of
 * it - never as a substring: `accounts.google.com.attacker.test` contains the
 * first entry and is not Google.
 *
 * Nothing in the renderer opens one of these today (sign-in goes to the system
 * browser through `desktop.openAuthorization`); the allowance is kept because
 * the CSP still names both providers and a hosted-sign-in popup is the flow this
 * app has historically supported. It is narrowed, not removed, so that a flow
 * which does exist keeps working.
 */
const AUTH_HOSTS: readonly string[] = [
	"accounts.google.com",
	"oauth.googleusercontent.com",
	"content.googleapis.com",
	"ssl.gstatic.com",
	"login.microsoftonline.com",
	"microsoftonline.com",
	"login.live.com",
	"login.windows.net",
	"login.microsoft.com",
];

/** Redirect-relay schemes the same providers' popup flows end on, matched exactly. */
const AUTH_SCHEMES: ReadonlySet<string> = new Set([
	"storagerelay:",
	"msauth:",
	"msftauth:",
]);

/*
 * THE POPUP'S LAST HOP is NOT in this set (round-2 R-6): a flow whose final
 * redirect is the app's own origin, or MSAL's `msal<clientId>://auth` relay,
 * is denied by `popupNavigationVerdict` - the client id is per-app, so an exact
 * set cannot name it and a prefix match would admit every `msal…:` scheme.
 * Acceptable because no flow here opens such a popup (sign-in is the
 * system-browser door, `desktop.openAuthorization`); a revival must add its
 * exact hop with its own review, or rebuild on that door.
 */

/**
 * Whether `url` is one of the sign-in hosts: https, no credentials, the exact
 * host or a subdomain of it, default port only. The port test is deliberately
 * exact (security review S-2): `accounts.google.com:8443` carries the right
 * NAME but is not the provider's origin, and `URL` drops the default port
 * anyway, so requiring `port === ""` costs nothing real.
 */
function isAuthPopupUrl(url: URL): boolean {
	if (url.protocol !== "https:") return false;
	if (url.username || url.password) return false;
	if (url.port !== "") return false;
	const host = url.hostname.toLowerCase();
	return AUTH_HOSTS.some(
		(domain) => host === domain || host.endsWith(`.${domain}`),
	);
}

export type PopupVerdict =
	| { action: "auth" }
	| { action: "external"; url: string }
	| { action: "deny"; reason: string };

/**
 * What `window.open(raw)` from the main window's renderer becomes.
 *
 * - `auth`: a real sandboxed popup window, as before (the caller supplies the
 *   window options, which are unchanged).
 * - `external`: no window; the URL goes to the OS browser, vetted.
 * - `deny`: nothing happens.
 *
 * KNOWN LIMIT, recorded rather than hidden: the memo asks to deny any request
 * whose FRAME is not the main frame. Electron 44.3.0's `HandlerDetails` carries
 * no frame (url, frameName, features, disposition, referrer, postBody only), so
 * the rule cannot be stated here. What covers it instead is the sandbox: a
 * `sandbox` iframe without `allow-popups` (the preview, and the supplement
 * frame to come) cannot call `window.open` at all, which the real-Electron
 * scenario asserts.
 */
export function popupVerdict(raw: string): PopupVerdict {
	/*
	 * `about:blank` is REFUSED (round-2 S-7), and this is the load-bearing
	 * refusal of the door:
	 *
	 * It USED to be an auth start, because MSAL opens its popup there and
	 * navigates it afterwards. But Electron resolves `window.open('javascript:…')`
	 * to exactly this URL before the handler runs - measured on 44.3.0: details
	 * identical to a plain `window.open('about:blank')` (url, frameName,
	 * features, disposition) - so the allowance minted an auth-class WINDOW for
	 * the javascript: case, and the script body then ran inside it (measured: it
	 * fetched a loopback stub; sandboxed, no bridge, no OS door). No spelling
	 * reaches here that could tell the two apart, so the allowance and the
	 * bypass are one thing, and the start is what moves.
	 *
	 * Nothing in the renderer opens an `about:blank` popup (sign-in is
	 * `desktop.openAuthorization` in the system browser), and a revived hosted
	 * sign-in starts at a real provider URL - see AUTH_SCHEMES' note for its
	 * last hop, which this door does not complete either.
	 */
	if (raw === "about:blank")
		return {
			action: "deny",
			reason: "about:blank is refused as a popup start",
		};
	let url: URL | null = null;
	try {
		url = new URL(raw);
	} catch {
		// Falls through to the external check, which refuses it by name.
	}
	if (url && (isAuthPopupUrl(url) || AUTH_SCHEMES.has(url.protocol)))
		return { action: "auth" };
	const external = externalUrlVerdict(raw);
	return external.allowed
		? { action: "external", url: external.url }
		: { action: "deny", reason: external.reason };
}

/**
 * What a CREATED sign-in popup's own webContents may navigate to.
 *
 * WHY (security review S-2): the popup is a real BrowserWindow with its own
 * webContents, and after creation the opener - or any page it loads - can
 * steer it; before this guard an `about:blank` popup accepted
 * `file:///etc/hosts` (accepted and observed). It may travel the hosts and
 * relay schemes the popup door was vetted against, and nothing else.
 *
 * `about:blank` stays allowed HERE: after creation a page may blank its own
 * window mid-flow, and a blank document carries no origin and no privilege. The
 * CREATION door is what changed (round-2 S-7): a popup must start at a real
 * allow-listed URL, because a blank start is indistinguishable from the
 * resolved `window.open('javascript:…')` - see `popupVerdict`.
 */
export function popupNavigationVerdict(rawUrl: string): Verdict {
	if (rawUrl === "about:blank") return ALLOW;
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return deny("not a URL");
	}
	if (isAuthPopupUrl(url) || AUTH_SCHEMES.has(url.protocol)) return ALLOW;
	return deny(`the sign-in window may not navigate to ${url.protocol}`);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * The backend's own static routes, the only http(s) a child frame is ever
 * framed from (`html-preview.tsx` -> `/v1/static/html`). A host of the user's
 * own machine or local network (`isLocalOrPrivateHost` - the ONE host test the
 * external door and the CSP predicate share with this rule, round-2 R-2) AND
 * this prefix, any port: the renderer's CSP `frame-src` pins the port, and the
 * daemon's port is not a thing main should have to know to answer this.
 */
const STATIC_FRAME_PREFIX = "/v1/static/";

/**
 * Whether a navigation of the main window's contents may proceed.
 *
 * MAIN FRAME: only to the window's own renderer document (the same trust test
 * the desktop plane applies to its `senderFrame`, so the two cannot disagree
 * about which page is "the app"). A reload and a route change pass; any other
 * destination is refused - this is what keeps a renderer-side script from
 * turning the window, preload bridge and all, into a browser tab.
 *
 * CHILD FRAMES: only the two framings the app really makes - a `blob:` the
 * renderer minted itself (the PDF viewer) and the backend's static route
 * (the HTML preview). Everything else is refused regardless of who initiated
 * it, with no `about:blank` / `data:` allowance: the supplement frame (U-b)
 * brings its own one-shot rule for its `data:` mount, and a blanket `data:`
 * allowance here would be the loophole that rule exists to close.
 *
 * `isSameDocument` navigations (fragment and history changes - the HashRouter)
 * never reach this function: they replace nothing and are not a destination.
 */
export function frameNavigationVerdict(
	input: { url: string; isMainFrame: boolean },
	trustedRendererUrls: readonly string[],
): Verdict {
	let url: URL;
	try {
		url = new URL(input.url);
	} catch {
		return deny("not a URL");
	}
	if (input.isMainFrame) {
		return trustedRendererUrls.some((trusted) =>
			trustedDesktopFrame(input.url, trusted),
		)
			? ALLOW
			: deny("the main window may only show the app's own document");
	}
	if (url.protocol === "blob:") {
		// `blob:<origin>/<uuid>`: the part after `blob:` names the minting origin.
		// A `file:` document mints `blob:file:///<uuid>` (origin-less), so for a
		// packaged build the test is the scheme; for the dev server it is the origin.
		let minted: URL;
		try {
			minted = new URL(url.pathname);
		} catch {
			return deny("blob: URL names no origin");
		}
		const own = trustedRendererUrls.some((trusted) => {
			try {
				const t = new URL(trusted);
				return t.protocol === "file:"
					? minted.protocol === "file:"
					: minted.origin === t.origin;
			} catch {
				return false;
			}
		});
		return own ? ALLOW : deny("blob: minted by a document that is not the app");
	}
	if (
		(url.protocol === "http:" || url.protocol === "https:") &&
		isLocalOrPrivateHost(url.hostname) &&
		url.pathname.startsWith(STATIC_FRAME_PREFIX)
	)
		return ALLOW;
	return deny(`a child frame may not navigate to ${url.protocol}`);
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** What a permission request or check tells us, from either Electron handler. */
export interface PermissionQuery {
	permission: string;
	/** Request handler: `details.mediaTypes`. */
	mediaTypes?: readonly string[];
	/** Check handler: `details.mediaType`. */
	mediaType?: string;
	isMainFrame: boolean;
	requestingUrl: string;
}

/**
 * Deny by default; grant the two things the app's own renderer uses.
 *
 * - `media`, AUDIO ONLY: push-to-talk and the recorder call
 *   `getUserMedia({ audio: true })` (composer, canvas inline edit, recording
 *   indicator). A request that includes video is refused.
 * - `clipboard-sanitized-write`: every "Copy" button's `clipboard.writeText`.
 * - `fullscreen`: the native `<video controls>` fullscreen button (attachment,
 *   canvas and file-row video players are all main-document elements).
 *
 * Both only for the MAIN frame of one of the app's own documents. A sandboxed
 * preview iframe presents a loopback http URL (or `null`), so it can ask for
 * nothing - which is the point: before this, it could have had the microphone.
 * Reading the clipboard, notifications (the app notifies from main), geolocation,
 * display capture, MIDI, USB and the rest are refused, because nothing in the
 * renderer uses them.
 */
export function permissionVerdict(
	query: PermissionQuery,
	trustedRendererUrls: readonly string[],
): boolean {
	if (!query.isMainFrame) return false;
	if (
		!trustedRendererUrls.some((trusted) =>
			trustedDesktopFrame(query.requestingUrl, trusted),
		)
	)
		return false;
	if (
		query.permission === "clipboard-sanitized-write" ||
		query.permission === "fullscreen"
	)
		return true;
	if (query.permission !== "media") return false;
	if (query.mediaTypes)
		return (
			query.mediaTypes.length > 0 &&
			query.mediaTypes.every((type) => type === "audio")
		);
	// The check handler reports one type, and `unknown` for device enumeration.
	// Only `audio` is granted (round-2 R-7): a check that reports no type at all
	// is a session that omitted the field, and `video`/`unknown` are not things
	// this renderer asks for - nothing in it enumerates devices. If a surface
	// ever does, this is the line its check widens, consciously.
	return query.mediaType === "audio";
}

// ---------------------------------------------------------------------------
// The static serve family's response policy
// ---------------------------------------------------------------------------

/**
 * The backend's static serve family (`html`, `images`, `videos`, `audio` in
 * `server/routes/static.py`): served by the daemon with no policy headers at
 * all, and that module belongs to another repository, so this app imposes the
 * policy on the responses it receives.
 */

/**
 * Decode a URL path until it stops changing - the way the server stack will
 * before it routes. WHY: uvicorn/Starlette match on the DECODED path, so
 * `/v1/static/htm%6c` serves the same handler as `/v1/static/html` while a
 * literal string comparison does not see it; that gap was the live bypass of
 * security review S-1. Bounded because the input can be encoded more than
 * once; try/catch because a malformed escape (`%zz`) must only stop the
 * unwrapping, never break a response hook.
 */
function decodedPathname(pathname: string): string {
	let current = pathname;
	for (let round = 0; round < 3; round += 1) {
		let next: string;
		try {
			next = decodeURIComponent(current);
		} catch {
			break;
		}
		if (next === current) break;
		current = next;
	}
	return current;
}

/**
 * Whether `rawUrl` is a request the preview response policy must cover: a URL
 * of the user's own machine or local network whose decoded path lands anywhere
 * in the static serve family.
 *
 * WHY THE WHOLE FAMILY AND NOT THE ONE ROUTE (security review S-1): comparing
 * the LITERAL pathname against `/v1/static/html` let a sandboxed preview
 * self-navigate to `/v1/static/htm%6c` and land on a document with no CSP at
 * all - restoring the file and loopback reads the sandbox drop was for - and
 * any other document-capable route in the family re-opened the same class
 * without an encoding trick (`/v1/static/images` serves `image/svg+xml`, which
 * a navigated frame executes). A decoded-prefix rule is what makes a sibling
 * route - today's or one added later - inherit the policy instead of silently
 * becoming a second door.
 *
 * The match is deliberately loose in the direction that can only ADD the
 * policy: a false positive puts a CSP on a response nothing loads as a
 * document (a CSP constrains documents, not data consumers), while a false
 * negative is the bypass this function exists to close. The case fold and a
 * literal `+` are both in that adds-only bucket: no consumer loads those
 * spellings as documents, and the headers are inert if something did. The HOST
 * side joined that direction in round 2 (R-2): it is the ONE test the door and
 * the frame rule also call (`isLocalOrPrivateHost`), because the predicate was
 * the strict side of a spelling family and a strict predicate is exactly the
 * bypass this function exists to close. Any port, any resource type: keying on
 * either would make the policy depend on how a request happened to be made.
 */
export function isStaticServeRequest(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") return false;
		if (!isLocalOrPrivateHost(url.hostname)) return false;
		return decodedPathname(url.pathname)
			.toLowerCase()
			.startsWith(STATIC_FRAME_PREFIX);
	} catch {
		return false;
	}
}

/**
 * The CSP a preview document is held to. The sandbox (opaque origin) is the
 * boundary; this is what makes the opaque origin ENOUGH, because the backend
 * answers cross-origin reads: its CORS middleware echoes the requesting origin
 * (an opaque frame sends `Origin: null`) until a desktop allow-list is
 * installed, which the shipped app never does. Without this, an opaque-origin
 * script could still `fetch("http://127.0.0.1:<port>/v1/...")` and read the
 * answer. So:
 *
 * - `connect-src https:` - a previewed page may call https APIs (a weather
 *   widget, a chart's JSON) but cannot reach the loopback daemon, any other
 *   local service, or anything over plain http. `https:` matches https/wss
 *   only (CSP3), so `http://127.0.0.1` does not match.
 * - `script-src` / `style-src` allow inline and https: generated pages are
 *   inline-script documents that pull a library from a CDN; denying either
 *   would break the thing the preview is for. `'unsafe-eval'` rides along for
 *   the template-compiling libraries (Alpine, Vue's full build). None of this
 *   weakens the boundary, because the page IS the script - what it may reach is
 *   what is restricted.
 * - `img-src` / `font-src` / `media-src`: data:, blob: and https: only. A plain
 *   `http:` image would be a free GET to any local service.
 * - `form-action 'none'`, `base-uri 'none'`, and `default-src 'none'` (which also
 *   closes `frame-src`/`child-src`/`object-src`): no nested frames, no form
 *   posts, no `<base>` rewriting.
 */
export const PREVIEW_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' 'unsafe-eval' https:",
	"style-src 'unsafe-inline' https:",
	"img-src data: blob: https:",
	"font-src data: https:",
	"media-src data: blob: https:",
	"connect-src https:",
	"worker-src blob:",
	"form-action 'none'",
	"base-uri 'none'",
].join("; ");

/** Response headers as Electron's `webRequest` hands them: name -> values. */
export type ResponseHeaders = Record<string, string[]>;

/**
 * `headers` with the preview policy added. ADDED, not substituted: a document
 * that already carries its own CSP keeps it, and two policies are both
 * enforced, so the result is never looser than either. `nosniff` is set so the
 * route's `text/html` is not re-guessed.
 */
export function withPreviewPolicy(headers: ResponseHeaders): ResponseHeaders {
	const out: ResponseHeaders = { ...headers };
	const existing = (name: string): string | undefined =>
		Object.keys(out).find((key) => key.toLowerCase() === name);
	const cspKey = existing("content-security-policy");
	if (cspKey) out[cspKey] = [...out[cspKey], PREVIEW_CSP];
	else out["Content-Security-Policy"] = [PREVIEW_CSP];
	if (!existing("x-content-type-options"))
		out["X-Content-Type-Options"] = ["nosniff"];
	return out;
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/**
 * Whether a download attempt on the app's own (default) session may proceed.
 *
 * WHY (security review S-4): Electron runs an unhandled `will-download`
 * through the save routine, so any script that reaches an app document could
 * start a download. The one legitimate class is the app's own exports (the
 * mermaid SVG and the agent zips): a `blob:` the renderer just minted and
 * clicked through an `<a download>`, which keeps the browser's ordinary save
 * dialog. Everything else is refused.
 *
 * The initiator test uses the starting webContents' current URL because
 * Electron's `will-download` carries no frame. The sandboxed preview cannot
 * start a download at all (no `allow-downloads`), so what this has to sort is
 * a script inside an app document - and for that, the only write worth
 * allowing is the export blob.
 */
export function downloadVerdict(
	itemUrl: string,
	initiatorUrl: string,
	trustedRendererUrls: readonly string[],
): Verdict {
	if (!itemUrl.startsWith("blob:"))
		return deny("only the app's own blob: exports may write files");
	if (
		!trustedRendererUrls.some((trusted) =>
			trustedDesktopFrame(initiatorUrl, trusted),
		)
	)
		return deny("the download was not started by one of the app's documents");
	return ALLOW;
}
