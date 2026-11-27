/**
 * The link between an agent tab and the user tab its passkey notice's
 * "Continue in your own tab" opened, and the one automatic thing the link may
 * do: refresh the agent's tab, once, when the user's sign-in in the copy has
 * demonstrably finished.
 *
 * WHY THIS EXISTS (operator incident a-7942, 2026-11-26). An agent opened a
 * HubSpot login in its own tab, the page offered a passkey, and the user took
 * "Continue in your own tab" (`BrowserHost.continueAgentTabInUserTab`). They
 * signed in in that copy. Nothing ever reloaded the agent's tab, so it still
 * showed the login page; the agent tab was later gone and the agent reopened
 * the stale login URL, leaving the user's signed-in tab orphaned. Every tab
 * shares the one persistent profile, so the agent's tab only needed ONE safe
 * reload after the sign-in — this module supplies it, and nothing more.
 *
 * WHAT IT NEVER DOES (the approved constraints, which the tests pin):
 * - It never moves authority. The copy stays the user's (no nonce, mayDrive
 *   false for every agent); nothing here reads the copy's URL into the agent
 *   tab, adopts it, or hands it over.
 * - It never activates, focuses or raises anything: the refresh is a
 *   background `loadURL` on a view that keeps its place in the strip.
 * - It never closes either tab, and never re-submits a form: the refresh is
 *   `loadURL(<the agent tab's own URL>)`, which Electron issues as a plain GET
 *   (no `postData`). `reload()` is deliberately NOT used, because reloading a
 *   document that was the result of a POST replays the POST.
 * - It never refreshes a tab that is busy: a command in the agent's lane, a
 *   load in progress, a provider prompt present, or an agent that has since
 *   navigated the tab elsewhere all mean "leave it alone".
 *
 * THE COMPLETION SIGNAL, and why it is this one. Main cannot see whether a
 * sign-in "succeeded" — no site tells the browser. What it CAN see, from its own
 * webContents and nothing the renderer supplies, is where the copy's top-level
 * document went next. The signal is the copy's FIRST later top-level commit
 * (`did-navigate`, i.e. a full document the server answered, not an in-page
 * `pushState` the page script can fake at will) that:
 *   1. answered HTTP 2xx (a 4xx/5xx landing is a failure page, not a session);
 *   2. is same-site with the sign-in URL — same origin, or the same registrable
 *      domain (eTLD+1) under the PSL rules the approval store already uses
 *      (`registrableDomain`, which fails closed to same-origin without PSL
 *      data). A cross-site landing — a federated IdP, or the user wandering off
 *      — is ignored rather than counted, and the link keeps waiting, because
 *      an SSO sign-in leaves the site and comes back;
 *   3. left the sign-in page: a different origin+path from the URL copied;
 *   4. does not itself look like an authentication step: neither a host whose
 *      first label is an auth host (`login.`, `accounts.`, `sso.`, ...) nor a
 *      path segment naming one (`/login`, `/mfa`, `/oauth/callback`, ...). An
 *      MFA or password step on the same site is the middle of a sign-in, not
 *      its end.
 * The signal is one-shot: the link is dropped the moment it fires (or decides
 * not to act), so later browsing in the copy cannot reload the agent's tab.
 *
 * WHICH URL THE REFRESH LOADS: the agent tab's OWN current top-level URL, read
 * from its webContents at refresh time and required to equal the URL that was
 * copied. Not the copy's landing URL, because that would carry state from a
 * user-owned tab into an agent-driven one (a landing URL can hold a single-use
 * ticket, or wherever the user's sign-in took them), which is exactly the
 * boundary the copy exists to keep. A sign-in URL loaded with a valid session
 * normally forwards to its return target; where a site does not, the agent sees
 * a signed-in page and decides what to do next — the same thing the old copy's
 * "ask the agent to reload this page" asked for, now without the round trip.
 *
 * WHEN THERE IS NO TRUSTWORTHY SIGNAL — the copy is closed before any qualifying
 * commit, only cross-site or auth-step pages ever commit, the copy is handed to
 * an agent, or the agent tab is gone, changed owner or moved on — the link does
 * nothing automatic and is released. The notice copy tells the user to keep the
 * agent's tab and, failing a reload, to ask the agent to reload it.
 */

import type { DriveableWebContents } from "./electron-types";
import { registrableDomain } from "./vendor/driver/origin-policy";

/**
 * Path segments that name an authentication step. Matched against whole
 * segments, case-insensitively, after splitting on `/` and on the common word
 * separators, so `/login`, `/signin`, `/sign-in`, `/user/login.html` and
 * `/oauth2/callback` all count and `/blogin` or `/catalogue` do not.
 * Deliberately broad: a false "still signing in" only means no automatic
 * refresh (the explicit path remains); a false "signed in" means a GET of the
 * agent's own login page, which is harmless but useless.
 */
const AUTH_SEGMENTS: ReadonlySet<string> = new Set([
	"login",
	"logon",
	"signin",
	"signon",
	"sign",
	"log",
	"auth",
	"authenticate",
	"authentication",
	"authorize",
	"authorization",
	"oauth",
	"oauth2",
	"openid",
	"oidc",
	"saml",
	"saml2",
	"sso",
	"cas",
	"mfa",
	"2fa",
	"twofactor",
	"otp",
	"totp",
	"verify",
	"verification",
	"challenge",
	"passkey",
	"passkeys",
	"webauthn",
	"callback",
	"session",
	"sessions",
	"password",
	"reset",
	"recover",
	"recovery",
	"logout",
	"signout",
	"consent",
	"idp",
]);

/** First host labels of dedicated sign-in hosts (`login.microsoftonline.com`,
 * `accounts.google.com`, `idmsa.apple.com`, `auth.example.com`). */
const AUTH_HOST_LABELS: ReadonlySet<string> = new Set([
	"login",
	"logon",
	"signin",
	"auth",
	"sso",
	"accounts",
	"account",
	"id",
	"idp",
	"idmsa",
	"identity",
	"secure",
	"passport",
	"oauth",
]);

function parseHttp(value: string): URL | null {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

function looksLikeAuthStep(url: URL): boolean {
	const firstLabel = url.hostname.split(".")[0] ?? "";
	if (AUTH_HOST_LABELS.has(firstLabel)) return true;
	return url.pathname
		.toLowerCase()
		.split(/[/._-]+/)
		.some((segment) => segment !== "" && AUTH_SEGMENTS.has(segment));
}

/** Same site for this purpose: same origin, or the same scheme and the same
 * non-null registrable domain. An `http:` landing from an `https:` sign-in is
 * NOT the same site (a downgrade is no evidence of a session). */
function sameSite(a: URL, b: URL): boolean {
	if (a.origin === b.origin) return true;
	if (a.protocol !== b.protocol) return false;
	const left = registrableDomain(a);
	return left !== null && left === registrableDomain(b);
}

/**
 * Whether a top-level commit in the user's copy marks the end of the sign-in
 * that started at `signInUrl` (module header, "THE COMPLETION SIGNAL").
 * Exported so the predicate is tested on its own, apart from any tab wiring.
 */
export function isSignInCompletion(
	signInUrl: string,
	landedUrl: string,
	httpResponseCode: number,
): boolean {
	if (!(httpResponseCode >= 200 && httpResponseCode < 300)) return false;
	const start = parseHttp(signInUrl);
	const landed = parseHttp(landedUrl);
	if (!start || !landed) return false;
	if (!sameSite(start, landed)) return false;
	if (start.origin === landed.origin && start.pathname === landed.pathname)
		return false;
	return !looksLikeAuthStep(landed);
}

/** The source tab as the refresh needs to see it, read live from the registry
 * at decision time — never a value captured from the renderer. */
export interface ContinueLinkSource {
	owner: "user" | "agent";
	contents: DriveableWebContents;
}

export interface PasskeyContinueLinkDeps {
	/** The tab now registered under `tabId`, or null when it is gone. */
	source(tabId: number): ContinueLinkSource | null;
	/** The copy as it is now: null when gone; `userOwned` false once the user
	 * handed it to an agent (its navigations are then not the user's sign-in). */
	copy(tabId: number): { userOwned: boolean } | null;
	/** True while an agent command holds this tab's lane (`registry.isBusy`). */
	busy(tabId: number): boolean;
	/** True while a password-manager prompt frame is present in the view. */
	authPromptPresent(webContentsId: number): boolean;
	log(message: string): void;
}

interface Link {
	sourceTabId: number;
	sourceWebContentsId: number;
	signInUrl: string;
	copyTabId: number;
	release: () => void;
}

/** Why the refresh did or did not happen — returned so tests (and the log)
 * name the guard that decided, instead of inferring it from silence. */
export type ContinueLinkOutcome =
	| "refreshed"
	| "source-gone"
	| "source-not-agent"
	| "source-moved"
	| "source-loading"
	| "source-busy"
	| "source-prompt"
	| "copy-not-user"
	| "refresh-failed";

export class PasskeyContinueLinks {
	/** Keyed by the agent (source) tab: one live link per agent tab, so a
	 * second continue from the same tab replaces the first rather than stacking
	 * listeners on two copies. */
	private readonly bySource = new Map<number, Link>();

	constructor(private readonly deps: PasskeyContinueLinkDeps) {}

	/** Live links, for the no-leak tests. */
	get size(): number {
		return this.bySource.size;
	}

	/**
	 * Link `copy` (just created and loaded at `signInUrl`) to the agent tab it
	 * was copied from. Armed AFTER the copy's initial load, so that load's own
	 * commit is never mistaken for the end of the sign-in.
	 */
	link(options: {
		sourceTabId: number;
		sourceWebContentsId: number;
		signInUrl: string;
		copyTabId: number;
		copyContents: DriveableWebContents;
	}): void {
		this.forgetSource(options.sourceTabId);
		const contents = options.copyContents;
		const onNavigate = (_event: unknown, url: string, code: number) => {
			if (!isSignInCompletion(options.signInUrl, url, code)) return;
			const link = this.bySource.get(options.sourceTabId);
			if (link?.copyTabId !== options.copyTabId) return;
			// One-shot, released BEFORE acting: whatever the refresh decides,
			// later browsing in the copy must never reach the agent's tab.
			this.forgetSource(options.sourceTabId);
			const outcome = this.refresh(link);
			this.deps.log(
				`[browser] passkey continue: user tab ${options.copyTabId} finished sign-in; agent tab ${options.sourceTabId}: ${outcome}`,
			);
		};
		const onDestroyed = () => this.forgetSource(options.sourceTabId);
		const navigateListener = onNavigate as (...args: never[]) => void;
		contents.on("did-navigate", navigateListener);
		contents.on("destroyed", onDestroyed);
		this.bySource.set(options.sourceTabId, {
			sourceTabId: options.sourceTabId,
			sourceWebContentsId: options.sourceWebContentsId,
			signInUrl: options.signInUrl,
			copyTabId: options.copyTabId,
			release: () => {
				if (contents.isDestroyed()) return;
				contents.removeListener("did-navigate", navigateListener);
				contents.removeListener("destroyed", onDestroyed);
			},
		});
	}

	/** A tab closed (`releaseTab`): drop any link it is either end of. A closed
	 * copy before a qualifying commit is the "no sign-in" case: no refresh. */
	forgetTab(tabId: number): void {
		this.forgetSource(tabId);
		for (const link of [...this.bySource.values()])
			if (link.copyTabId === tabId) this.forgetSource(link.sourceTabId);
	}

	private forgetSource(sourceTabId: number): void {
		const link = this.bySource.get(sourceTabId);
		if (!link) return;
		this.bySource.delete(sourceTabId);
		link.release();
	}

	private refresh(link: Link): ContinueLinkOutcome {
		const copy = this.deps.copy(link.copyTabId);
		if (copy && !copy.userOwned) return "copy-not-user";
		const source = this.deps.source(link.sourceTabId);
		// The same tab id must still be the same page host: a recycled id would
		// be someone else's tab.
		if (
			!source ||
			source.contents.isDestroyed() ||
			source.contents.id !== link.sourceWebContentsId
		)
			return "source-gone";
		if (source.owner !== "agent") return "source-not-agent";
		let current: string;
		try {
			current = source.contents.getURL();
		} catch {
			return "source-gone";
		}
		// The agent moved its tab on since the copy: its current page is its own
		// work, not the sign-in page, so there is nothing of ours to refresh.
		if (current !== link.signInUrl) return "source-moved";
		if (source.contents.isLoading()) return "source-loading";
		if (this.deps.busy(link.sourceTabId)) return "source-busy";
		if (this.deps.authPromptPresent(link.sourceWebContentsId))
			return "source-prompt";
		// Synchronous from the checks above to the start of the load, so no agent
		// command can enter the lane in between. The lane is NOT held across the
		// load: a sign-in page can take seconds, and an agent's next command
		// should meet the existing document-change rules, not a `busy` refusal
		// it did not cause. `loadURL` without `postData` is a GET.
		try {
			void source.contents.loadURL(current).catch((error: unknown) => {
				this.deps.log(
					`[browser] passkey continue: refreshing agent tab ${link.sourceTabId} failed: ${String(error)}`,
				);
			});
		} catch {
			return "refresh-failed";
		}
		return "refreshed";
	}
}
