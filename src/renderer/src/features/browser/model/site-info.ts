/**
 * Site-info classification for the address bar (LOH-13 slice A, gap 1;
 * U1 remediation).
 *
 * WHY THIS EXISTS AS A PURE MODEL. The security/origin register belongs inside
 * the address bar's left edge, but the classification rule must be testable
 * without a renderer and must not drift into a second copy inside the
 * component. This module is the one implementation; `browser-url-bar.tsx`
 * only maps the kind to an icon and to catalogue copy.
 *
 * WHAT IT IS NOT. It is a READ-ONLY indicator's data. It never feeds the
 * consent/approval gate: an `https` origin the agent may not reach is a
 * different fact from transport security. Approvals stay on the Approvals
 * surface; nothing in this file is imported by that logic.
 *
 * WHY "SECURE" NEEDS MORE THAN THE SCHEME (U1). Scheme alone would keep
 * reading "Secure connection" on a certificate-failure surface — misleading
 * exactly when the user checks the indicator. The renderer has no
 * certificate-chain API: the host projection (`chromeState().navFailure`)
 * carries no verified-identity fact, only the load outcome. That outcome IS
 * the verification fact available here, and it is sufficient because of how
 * Chromium behaves: a committed https load with no recorded failure means
 * the certificate was accepted, while a certificate/SSL failure is recorded
 * by the host as `navFailure` (`did-fail-load`, `ERR_CERT_*`/`ERR_SSL_*`).
 * So `secure` is asserted only for an https URL with no matching recorded
 * failure; an https URL whose own load failed is `unverified` — this module
 * never claims verified identity it cannot see. A failure recorded for a
 * DIFFERENT origin does not downgrade the page still on screen: the failed
 * attempt and the shown document are different facts.
 *
 * PARSED, NEVER PREFIX-MATCHED. A `startsWith("https")` test admits
 * `httpsfoo:` and misreads userinfo tricks; the host's own navigation rule
 * (`src/main/browser/index.ts`, `refusesNavigation`) parses for the same
 * reason, so this does too. An unparseable or empty value is the tab's start
 * state (`about:blank` is what a new tab shows as an empty bar), so it
 * classifies as internal rather than as an error the user cannot act on.
 *
 * IDN STAYS PUNYCODED (n1, deliberate). `url.origin` is the canonical ASCII
 * form. Rendering the Unicode form in a security register would reopen the
 * homograph-spoof question for the friendlier spelling, so the tooltip names
 * the origin exactly as it was verified, not as it might be displayed.
 */

const SECURITY_FAILURE_DESCRIPTION = /CERT|SSL|TLS/i;
export type SiteInfoKind =
	| "secure"
	| "not-secure"
	| "unverified"
	| "internal"
	| "file";

export interface SiteInfo {
	kind: SiteInfoKind;
	/**
	 * The origin the tooltip names: `scheme://host[:port]` for web origins,
	 * the literal `file://` for a local file, and "" for an internal page,
	 * where there is no origin worth naming beyond "internal".
	 */
	origin: string;
}

/**
 * The active tab's recorded load failure, as the host projects it
 * (`LoadFailureView` in `use-browser-chrome.ts`, structurally). Only the
 * fields this rule reads travel in: the failing URL, whose origin decides
 * whether the failure describes the page on screen at all.
 */
export interface SiteInfoLoadFailure {
	url: string;
	description: string;
}

/**
 * True when a recorded failure is a certificate/TLS failure rather than a
 * reachability one. Exported because the wording differs: a cert failure
 * means identity could not be verified, a refused connection means the load
 * simply did not complete — both bar the word "secure", for different
 * reasons the tooltip should not conflate.
 */
export function isSecurityLoadFailure(failure: SiteInfoLoadFailure): boolean {
	return SECURITY_FAILURE_DESCRIPTION.test(failure.description);
}

/** Whether `failure` was recorded against the origin `url` is on. */
function failureMatchesUrl(
	url: URL,
	failure: SiteInfoLoadFailure | null | undefined,
): boolean {
	if (!failure) return false;
	try {
		return new URL(failure.url).origin === url.origin;
	} catch {
		// A failure with no parseable URL can only be the active tab's own
		// (the projection is active-tab scoped), so it applies here.
		return true;
	}
}

/** Classify a tab's LIVE url (never a requested one) for the indicator. */
export function siteInfoForUrl(
	rawUrl: string,
	loadFailure?: SiteInfoLoadFailure | null,
): SiteInfo {
	const trimmed = rawUrl.trim();
	if (!trimmed) return { kind: "internal", origin: "" };
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { kind: "internal", origin: "" };
	}
	if (url.protocol === "https:") {
		// U1: a failed load of this origin — above all a certificate failure —
		// revokes the assertion. The load-failure panel owns the details; this
		// register's job is only to not contradict it with a closed lock.
		if (failureMatchesUrl(url, loadFailure))
			return { kind: "unverified", origin: url.origin };
		return { kind: "secure", origin: url.origin };
	}
	if (url.protocol === "http:")
		return { kind: "not-secure", origin: url.origin };
	if (url.protocol === "file:") return { kind: "file", origin: "file://" };
	// `about:blank`, `about:*`, `data:`, `chrome:` and every other non-web
	// scheme the host can surface are the app's own pages, not a remote origin.
	return { kind: "internal", origin: "" };
}
