/**
 * Site-info classification for the address bar (LOH-13 slice A, gap 1).
 *
 * WHY THIS EXISTS AS A PURE MODEL. The security/origin register belongs inside
 * the address bar's left edge, but the classification rule ("https is secure,
 * http is not, internal/file origins are neither") must be testable without a
 * renderer and must not drift into a second copy inside the component. This
 * module is the one implementation; `browser-url-bar.tsx` only maps the kind
 * to an icon and to catalogue copy.
 *
 * WHAT IT IS NOT. It is a READ-ONLY indicator's data. It never feeds the
 * consent/approval gate: an `https` origin the agent may not reach still reads
 * "secure" here, because transport security and agent permission are different
 * facts. Approvals stay on the Approvals surface; nothing in this file is
 * imported by that logic.
 *
 * PARSED, NEVER PREFIX-MATCHED. A `startsWith("https")` test admits
 * `httpsfoo:` and misreads userinfo tricks; the host's own navigation rule
 * (`src/main/browser/index.ts`, `refusesNavigation`) parses for the same
 * reason, so this does too. An unparseable or empty value is the tab's start
 * state (`about:blank` is what a new tab shows as an empty bar), so it
 * classifies as internal rather than as an error the user cannot act on.
 */

export type SiteInfoKind = "secure" | "not-secure" | "internal" | "file";

export interface SiteInfo {
	kind: SiteInfoKind;
	/**
	 * The origin the tooltip names: `scheme://host[:port]` for web origins,
	 * the literal `file://` for a local file, and "" for an internal page,
	 * where there is no origin worth naming beyond "internal".
	 */
	origin: string;
}

/** Classify a tab's LIVE url (never a requested one) for the indicator. */
export function siteInfoForUrl(rawUrl: string): SiteInfo {
	const trimmed = rawUrl.trim();
	if (!trimmed) return { kind: "internal", origin: "" };
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return { kind: "internal", origin: "" };
	}
	if (url.protocol === "https:") return { kind: "secure", origin: url.origin };
	if (url.protocol === "http:")
		return { kind: "not-secure", origin: url.origin };
	if (url.protocol === "file:") return { kind: "file", origin: "file://" };
	// `about:blank`, `about:*`, `data:`, `chrome:` and every other non-web
	// scheme the host can surface are the app's own pages, not a remote origin.
	return { kind: "internal", origin: "" };
}
