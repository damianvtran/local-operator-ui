/**
 * The popup policy for driven pages, as a pure decision.
 *
 * Design: docs/design/browser-oauth-popups.md 1-2. This module used to be a
 * deny-all `setWindowOpenHandler` inside `index.ts` whose comment said why the
 * main window's handler was NOT copied: that handler's trusted-auth-domain
 * allowlist exists for the app's own OAuth popup, while a driven page's
 * `window.open` is arbitrary web content. The deny-all was then measured
 * against a real page that legitimately uses popups (the console's MSAL
 * `loginPopup`) and lost: a denied `window.open` returns `null`, and no
 * amount of offering the URL to the user can rebuild the opener/postMessage
 * contract MSAL needs. So the rule here is the same shape with the decision
 * inverted — allow `about:blank` and http(s), deny everything else, deny past
 * a live cap, deny nested popups — and the things that make it safe (hardened
 * prefs, one explicit partition, mode-gated presentation, a per-view cap) are
 * enforced where they can be: in the window options `index.ts` builds and in
 * `window-raise.ts`'s presentation gate.
 *
 * WHY A PURE MODULE rather than logic in the handler: the desktop suite bundles
 * the shipped TypeScript in memory and drives it with fakes (see
 * `scripts/browser-host.test.mjs`), so the whole allow/deny table can be pinned
 * as rules without a browser; and the handler in `index.ts` stays a thin
 * adapter with no policy of its own. It deliberately imports nothing from
 * Electron: every value here is a plain string, so the tests and the source
 * scan can read it without a runtime.
 */
import type { WindowShow } from "../window-mode";

/**
 * The `disposition` Electron hands the open handler, per its docs
 * (`webContents` § `setWindowOpenHandler`): how the window was asked for.
 *
 * It NEVER changes allow/deny — it only selects presentation, and only for the
 * one case where the distinction is observable: a `background-tab` request may
 * never foreground a window (§2.4). All other values present the same way.
 */
export type PopupDisposition =
	| "default"
	| "foreground-tab"
	| "background-tab"
	| "new-window"
	| "other";

/** The part of the request the decision needs — Electron's handler details,
 * narrowed to what this module reads, so a fake can supply exactly these. */
export interface PopupRequest {
	url: string;
	disposition: PopupDisposition;
}

/** Who owns the tab a popup came from. A hand-over makes a user tab `agent`,
 * so this is the tab's CURRENT owner, not who created it. */
export type PopupOpenerOwner = "user" | "agent";

export interface PopupPolicy {
	/** The launch plan's show policy — the mode this host is running under. */
	mode: WindowShow;
	/** The view's live child count, the cap's input (see the constant below). */
	live: number;
	/** Who owns the opening tab: selects the presentation of a `normal` launch.
	 * `null` is an opener whose registry record is already gone (its view is
	 * closing but still emitting events): nothing owns the popup, so it is refused
	 * rather than defaulted to `user`, whose `focus` would raise the app for a tab
	 * that no longer exists. */
	openerOwner: PopupOpenerOwner | null;
}

/**
 * `reason` names WHY a popup was refused, as one token, so the caller's log line
 * is greppable and a test can assert the refusal class rather than the wording:
 * `scheme` — not `about:blank` and not http(s); `cap` — the view already holds
 * `MAX_POPUP_CHILDREN_PER_VIEW` live children; `opener_gone` — the opening tab
 * no longer has a registry record.
 */
export type PopupDecision =
	| { allow: false; reason: "scheme" | "cap" | "opener_gone" }
	| { allow: true; presentation: WindowShow };

/**
 * How many live popup children one view may hold.
 *
 * A GUARD, NOT A CONTRACT (§1.1, §6.5): MSAL uses one window per flow and
 * Chromium reuses a same-named window on retry, so 4 is a judgement about
 * bounding abuse, not a measured requirement — raise it only against a real
 * flow that needs more, naming the flow in the commit.
 */
export const MAX_POPUP_CHILDREN_PER_VIEW = 4;

/**
 * The effective presentation for an allowed popup WINDOW — the §2.4 table, in
 * one place because two callers resolve it: the open handler (for the window
 * options and its log line) and `did-create-window` (which presents the child).
 *
 * Under a `normal` launch two things stop a window from foregrounding:
 * `background-tab` (what the browser contract says a background tab is) and an
 * AGENT-OWNED opener. An agent drives its tab while the operator works in
 * another app, and a sign-in window that raised the app over whatever they were
 * doing was measured at 12 raises in two days, so it is shown `inactive`:
 * visible, never activating the app and never taking focus. A user-owned opener
 * still focuses — the person who clicked is looking at the app. Under
 * `inactive` every disposition is `inactive`, and under `headless` nothing is
 * ever shown — the child still exists for the page's own flow, which is
 * deliberate and does not contradict `canCreateWindowFor`: that rule is about
 * windows holding the OPERATOR's conversation with nobody able to reach them; a
 * driven page's popup belongs to the page, and the proof drives it over CDP
 * while it stays hidden.
 */
export function effectivePresentation(
	mode: WindowShow,
	disposition: PopupDisposition,
	openerOwner: PopupOpenerOwner,
): WindowShow {
	if (mode === "never") return "never";
	if (mode === "inactive") return "inactive";
	if (openerOwner === "agent") return "inactive";
	return disposition === "background-tab" ? "inactive" : "focus";
}

/**
 * The §1.1 decision table, exhaustively:
 *
 * - `about:blank` EXACTLY (compared as the string, as `src/main/index.ts` does
 *   for MSAL's init) — allow. MSAL opens the blank window FIRST and then
 *   navigates it; a denied blank popup is the failure this policy removes, and
 *   it arrives before any http(s) URL is ever proposed.
 * - http(s) on a PARSED url (never `startsWith` — a `startsWith("http")` test
 *   admits `httpfoo:`) — allow, whatever the host and whatever the disposition;
 *   a form POST `target=_blank` is the same URL check, with Electron carrying
 *   the body itself.
 * - everything else — `file:`, `javascript:`, `data:`, `blob:`, `chrome:`,
 *   `devtools:`, `about:` other than blank, custom schemes (`msauth:`,
 *   `mailto:`, …) — deny, log only. This is the branch the deny-all kept, and
 *   nothing here re-opens it.
 * - beyond the cap — deny, log only.
 *
 * NOT here by construction: a popup from a popup. A child gets its own
 * deny-all handler (`wirePopup` in `index.ts`) because no known auth flow
 * nests popups, and chasing unbounded nesting is what a cap would otherwise
 * have to do; and the child's own initial URL was already vetted by THIS
 * decision one event earlier.
 */
export function decidePopup(
	request: PopupRequest,
	policy: PopupPolicy,
): PopupDecision {
	if (policy.openerOwner === null)
		return { allow: false, reason: "opener_gone" };
	if (!isAllowedTarget(request.url)) return { allow: false, reason: "scheme" };
	if (policy.live >= MAX_POPUP_CHILDREN_PER_VIEW) {
		return { allow: false, reason: "cap" };
	}
	return {
		allow: true,
		presentation: effectivePresentation(
			policy.mode,
			request.disposition,
			policy.openerOwner,
		),
	};
}

/** What `did-create-window` knows that the open handler cannot: the child
 * exists by then, so its opener can be read. */
export interface PopupRouteRequest extends PopupRequest {
	/** `child.webContents.opener !== null`. Measured on Electron 44.3.0: a plain
	 * `target=_blank` link (with or without `rel=noopener`), an iframe link and
	 * `window.open(url, n, "noopener")` all arrive with NO opener; a bare
	 * `window.open`, a sized `window.open` and `rel=opener` arrive with one. */
	hasOpener: boolean;
	/** A `<form method=post target=_blank>`. Read from the OPEN HANDLER's details
	 * and carried to `did-create-window`: on Electron 44.3.0 `postBody` is absent
	 * from the latter (measured), so reading it there routed every form POST to the
	 * tab route, which replays it as a GET. */
	hasPostBody: boolean;
	/** The child already began its navigation when `did-create-window` fired
	 * (`webContents.isLoading()`). Measured on 44.3.0: that is the case for
	 * cmd/shift/middle clicks (`background-tab`/`new-window`) and never for a plain
	 * click or a script. Destroying such a child does not cancel its request, so a
	 * tab that reloads the URL would fetch it twice and burn a single-use link. */
	alreadyLoading: boolean;
	/** Whether the opening tab is the active one (only a user tab's link reads it). */
	openerActive: boolean;
	/** Tabs this opener has already spawned that are still open. */
	openedTabs: number;
}

/**
 * Where an allowed popup goes (docs/design/browser-oauth-popups.md 1.1).
 *
 * - `deny` — `decidePopup` refused it (scheme, cap), or an agent's tab already
 *   holds `MAX_POPUP_CHILDREN_PER_VIEW` tabs it spawned.
 * - `tab` — an ordinary link: it has no opener, so nothing can depend on one
 *   (a flow that needs `window.opener` or `postMessage` has an opener or cannot
 *   work; `noopener` makes `window.open` return null, so the page cannot poll
 *   the child either). It becomes a tab owned like its opener and is never
 *   presented as a window. `activate` is the browser behaviour for a USER tab: a
 *   link opened from the tab being looked at comes to the front unless it is a
 *   background-tab request; an agent's tab never activates (design 11.4).
 * - `window` — an opener-bearing popup (MSAL `loginPopup`, Google `storagerelay`)
 *   keeps the real child window the opener/postMessage contract needs. A form POST
 *   stays here too (replaying a body into a new view was measured flaky), and so
 *   does a child that is ALREADY LOADING (modifier clicks): its one fetch is the
 *   child's own, and a window is the only place it can finish. That window is
 *   shown `inactive` at most, as the browser contract says a background open
 *   never takes focus.
 *
 * `about:blank` has an opener by construction (MSAL opens it from script), so
 * the exact-blank case can never be mistaken for a link.
 */
export type PopupRoute =
	| { route: "deny"; reason: "scheme" | "cap" | "opener_gone" | "opener_cap" }
	| { route: "tab"; owner: PopupOpenerOwner; activate: boolean }
	| { route: "window"; presentation: WindowShow };

export function routePopup(
	request: PopupRouteRequest,
	policy: PopupPolicy,
): PopupRoute {
	const decision = decidePopup(request, policy);
	if (!decision.allow) return { route: "deny", reason: decision.reason };
	if (
		request.hasOpener ||
		request.hasPostBody ||
		request.url === "about:blank"
	) {
		return { route: "window", presentation: decision.presentation };
	}
	if (request.alreadyLoading) {
		return {
			route: "window",
			presentation:
				decision.presentation === "focus" ? "inactive" : decision.presentation,
		};
	}
	// The per-opener bound for tabs, for the same reason the window cap exists
	// (no gesture signal reaches the main process, so a script can spam links) —
	// but only for an AGENT's tab: user tabs are uncapped by design (6.5) and a
	// person opening five links from one page is ordinary use.
	if (
		policy.openerOwner === "agent" &&
		request.openedTabs >= MAX_POPUP_CHILDREN_PER_VIEW
	) {
		// Its own token, not `cap`: the window cap counts LIVE windows and frees a
		// slot when one closes, this one counts link tabs the opener has not had
		// closed, and the operator reading a log should be able to tell which wall
		// an agent hit.
		return { route: "deny", reason: "opener_cap" };
	}
	return {
		route: "tab",
		owner: policy.openerOwner as PopupOpenerOwner,
		activate:
			policy.openerOwner === "user" &&
			request.openerActive &&
			request.disposition !== "background-tab",
	};
}

/** Whether a popup URL is one the policy admits: exact `about:blank`, or a
 * parsed http(s) url. A url that does not parse is refused like a bad scheme. */
function isAllowedTarget(rawUrl: string): boolean {
	if (rawUrl === "about:blank") return true;
	try {
		const url = new URL(rawUrl);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
