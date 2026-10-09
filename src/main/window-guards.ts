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
	} else if (/(^|[?&])attach(ment)?=/i.test(url.search)) {
		// Some mail clients attach a local file named in the query.
		return { allowed: false, reason: "mailto: names an attachment" };
	}
	return { allowed: true, url: url.href };
}

/**
 * Vet `raw`, then hand it to `open`. Resolves to whether it was handed over.
 *
 * ONE function behind both doors to the OS that a renderer can reach - the
 * `open-external` IPC and the popup handler - so there is one answer to "what
 * may leave the app" and a second door cannot drift from the first.
 */
export async function openVettedExternal(
	raw: unknown,
	open: (url: string) => Promise<void> | void,
	log: (message: string) => void,
): Promise<boolean> {
	const verdict = externalUrlVerdict(raw);
	if (!verdict.allowed) {
		log(`[window-guard] refused to open externally: ${verdict.reason}`);
		return false;
	}
	try {
		await open(verdict.url);
		return true;
	} catch (error) {
		log(
			`[window-guard] the OS could not open the URL: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
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
	// MSAL opens its popup at `about:blank` and navigates it afterwards.
	if (raw === "about:blank") return { action: "auth" };
	let url: URL | null = null;
	try {
		url = new URL(raw);
	} catch {
		// Falls through to the external check, which refuses it by name.
	}
	if (url) {
		const host = url.hostname.toLowerCase();
		const authHost =
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			AUTH_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
		if (authHost || AUTH_SCHEMES.has(url.protocol)) return { action: "auth" };
	}
	const external = externalUrlVerdict(raw);
	return external.allowed
		? { action: "external", url: external.url }
		: { action: "deny", reason: external.reason };
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Hostnames `URL` reports for a loopback backend. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
	"127.0.0.1",
	"localhost",
	"[::1]",
]);

/**
 * The backend's own static routes, the only http(s) a child frame is ever
 * framed from (`html-preview.tsx` -> `/v1/static/html`). Loopback AND this
 * prefix, any port: the renderer's CSP `frame-src` pins the port, and the
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
		LOOPBACK_HOSTS.has(url.hostname) &&
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
	return query.mediaType !== "video";
}

// ---------------------------------------------------------------------------
// The HTML preview's response policy
// ---------------------------------------------------------------------------

/**
 * The backend route the canvas HTML preview frames. It is served by the daemon
 * (`server/routes/static.py`) with no policy headers at all, and that route
 * belongs to another repository, so this app imposes the policy on the response
 * it receives.
 */
export const PREVIEW_DOCUMENT_PATH = "/v1/static/html";

/**
 * Whether `rawUrl` is a request for a preview document: loopback host, exact
 * path. Any port, any resource type - an XHR for the same URL getting the
 * policy too is harmless, and keying on the resource type would make the policy
 * depend on how a frame happened to be requested.
 */
export function isPreviewDocumentRequest(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			LOOPBACK_HOSTS.has(url.hostname) &&
			url.pathname === PREVIEW_DOCUMENT_PATH
		);
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
