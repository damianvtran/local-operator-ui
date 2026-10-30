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
	/** Whether the opening tab is ITSELF a link tab — a page-spawned tab, so
	 * `TabRecord.openedByTab !== null` (`link_depth`).
	 *
	 * REQUIRED, not optional: every tab carries the same window-open handler, so a
	 * call site that left this out would silently re-open the depth hole — a link
	 * tab's children would be measured against the link tab's own empty count.
	 * A caller that has no tab record at all (`openerOwner` null) passes `false`;
	 * the `opener_gone` branch answers first either way. */
	openerIsLinkTab: boolean;
}

/**
 * `reason` names WHY a popup was refused, as one token, so the caller's log line
 * is greppable and a test can assert the refusal class rather than the wording:
 * `scheme` — not `about:blank` and not http(s); `cap` — the view already holds
 * `MAX_POPUP_CHILDREN_PER_VIEW` live children; `opener_gone` — the opening tab
 * no longer has a registry record; `link_depth` — the opening tab is a user-owned
 * LINK tab, and a link tab opens nothing (the fan-out is one level deep).
 */
export type PopupDecision =
	| { allow: false; reason: "scheme" | "cap" | "opener_gone" | "link_depth" }
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
 * How many link tabs ONE user tab may hold OPEN at a time (`routePopup`'s tab
 * route).
 *
 * WHAT IT BOUNDS, exactly: the input is `registry.openedTabCount(openerTabId)`,
 * the children whose `openedByTab` is THIS tab and that are still open — a bound
 * on CONCURRENT tabs, not on lifetime allocation. Closing one frees its slot, so
 * a page that opens and closes links in a loop allocates without limit while
 * never holding more than this many at once. What it cannot do is grow the strip
 * without bound, which is the resource at stake: a real `WebContents`, its raster
 * surface, a `session.json` row and (for an active opener) an activation.
 *
 * DEPTH 1, NOT A TREE: every tab is wired with the same window-open handler, and
 * a link tab is a registered tab like any other — so counting per opener would
 * give a link tab its own fresh, empty budget and a self-replicating page
 * (`window.open(location.href, "_blank", "noopener")` inside the child too)
 * would fan out at every level. `decidePopup` therefore refuses any popup whose
 * opener is a user-owned LINK tab (`link_depth`): the operator's tab fans out, its
 * children open nothing. That is what makes this a cap of this size rather than a
 * depth-exponentiated one.
 *
 * THE NUMBER: 12 is the design's own stated scale for a person's own tabs —
 * `ui-browser-tab.md` 6.5, "a user opening a dozen tabs is their business" — used
 * here as a CEILING on a page rather than copied from that sentence: a page gets
 * no more than a person gets for themselves, and leaves seven slots over the
 * ordinary case it must never meet (a person opening the few links they want from
 * one page — five is the count the tests drive). It is a judgement about bounding
 * abuse, like `MAX_POPUP_CHILDREN_PER_VIEW` above, not a measurement: 6.5 has no
 * measured human fan-out to derive one from, so it rests on two stated facts
 * instead — it grants a page a person's allowance and no more, and it is below
 * `MAX_RESTORED_TABS` (20), so one looping page cannot by itself fill what a
 * restore will read back. Raise it only against a real page that needs more,
 * naming the page in the commit, as with the window cap.
 */
export const MAX_USER_LINK_TABS_PER_VIEW = 12;

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
 * TWO RULES THAT BOUND DEPTH, both because a child can open children of its own:
 * a popup WINDOW gets its own deny-all handler (`wirePopup` in `index.ts`) since
 * no known auth flow nests popups, and a user's LINK TAB opens nothing at all
 * (`link_depth` below) since its children are tabs carrying the same handler as
 * the tab that spawned them. Without the second, a page that reproduces itself in
 * its children would be bounded only per opener, and every generation starts
 * that count afresh (`MAX_USER_LINK_TABS_PER_VIEW` says why).
 */
export function decidePopup(
	request: PopupRequest,
	policy: PopupPolicy,
): PopupDecision {
	if (policy.openerOwner === null)
		return { allow: false, reason: "opener_gone" };
	// DEPTH 1 for a user's page-spawned tabs. An AGENT's link tab keeps the route it
	// had: agent tabs are bounded in AGGREGATE by `MAX_AGENT_TABS`, so its nesting
	// cannot grow the strip past a number nothing checks — not true of the
	// operator's tabs, the one thing design 6.5 deliberately leaves uncapped.
	if (policy.openerOwner === "user" && policy.openerIsLinkTab) {
		return { allow: false, reason: "link_depth" };
	}
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
 * - `deny` — `decidePopup` refused it (scheme, cap, or `link_depth`: the opening
 *   tab is itself a user-owned link tab), an agent's tab already holds
 *   `MAX_POPUP_CHILDREN_PER_VIEW` tabs it spawned, or a user's tab already holds
 *   `MAX_USER_LINK_TABS_PER_VIEW`. The tab bounds carry distinct tokens
 *   (`opener_cap`, `user_opener_cap`) so a log names which wall was hit.
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
	| {
			route: "deny";
			reason:
				| "scheme"
				| "cap"
				| "opener_gone"
				| "opener_cap"
				| "user_opener_cap"
				| "link_depth";
	  }
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
	// The per-opener bound for tabs, for the same reason the window cap exists (no
	// gesture signal reaches the main process, so a script can spam links). Both
	// owners are bounded; the numbers differ because the reasons do — an agent's
	// slots are a shared fleet resource, the operator's are their own attention,
	// which a page can spend anyway.
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
	// The same bound for a USER-owned tab (M1 of #1497). Before the tab route these
	// children were WINDOWS, so the live cap above refused the fifth one; a tab
	// never enters `popupChildren`, so that cap stopped seeing them, and an
	// agent-only `opener_cap` left a page in the operator's own tab free to
	// allocate views without bound. Its own token, for the same log-reading reason.
	if (
		policy.openerOwner === "user" &&
		request.openedTabs >= MAX_USER_LINK_TABS_PER_VIEW
	) {
		return { route: "deny", reason: "user_opener_cap" };
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

/**
 * Whether a failed link-tab load left NOTHING to show, so the tab should close
 * (R1-5): a download (ERR_FAILED -2, measured) or a cancelled navigation commits no
 * page and the view stays blank.
 *
 * `loading` is part of the test because a blank URL alone is not "nothing will
 * come": a second navigation during a slow first load (an agent's `open tab=` with
 * a URL, a redirect the page started) rejects the FIRST load with ERR_ABORTED -3
 * while the view is blank and still loading the replacement, and the user pressing
 * Stop takes the same path. That tab is in use. Only a blank view that is NOT
 * loading anything has no page and none coming.
 */
export function linkLoadLeftNoPage(view: {
	destroyed: boolean;
	url: string;
	loading: boolean;
}): boolean {
	if (view.destroyed) return true;
	if (view.loading) return false;
	return view.url === "" || view.url === "about:blank";
}
