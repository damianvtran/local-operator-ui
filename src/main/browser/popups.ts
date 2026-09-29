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

export interface PopupPolicy {
	/** The launch plan's show policy — the mode this host is running under. */
	mode: WindowShow;
	/** The view's live child count, the cap's input (see the constant below). */
	live: number;
}

/**
 * `reason` names WHY a popup was refused, as one token, so the caller's log line
 * is greppable and a test can assert the refusal class rather than the wording:
 * `scheme` — not `about:blank` and not http(s); `cap` — the view already holds
 * `MAX_POPUP_CHILDREN_PER_VIEW` live children.
 */
export type PopupDecision =
	| { allow: false; reason: "scheme" | "cap" }
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
 * The effective presentation for an allowed popup — the §2.4 table, in one
 * place because two callers resolve it: the open handler (for the window
 * options and its log line) and `did-create-window` (which presents the child).
 *
 * `background-tab` is the one disposition that changes anything: under a
 * `normal` launch it presents without foregrounding, which is what the browser
 * contract says a background tab is. Under `inactive` every disposition is
 * `inactive`, and under `headless` nothing is ever shown — the child still
 * exists for the page's own flow, which is deliberate and does not contradict
 * `canCreateWindowFor`: that rule is about windows holding the OPERATOR's
 * conversation with nobody able to reach them; a driven page's popup belongs
 * to the page, and the proof drives it over CDP while it stays hidden.
 */
export function effectivePresentation(
	mode: WindowShow,
	disposition: PopupDisposition,
): WindowShow {
	if (mode === "never") return "never";
	if (mode === "inactive") return "inactive";
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
	if (!isAllowedTarget(request.url)) return { allow: false, reason: "scheme" };
	if (policy.live >= MAX_POPUP_CHILDREN_PER_VIEW) {
		return { allow: false, reason: "cap" };
	}
	return {
		allow: true,
		presentation: effectivePresentation(policy.mode, request.disposition),
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
