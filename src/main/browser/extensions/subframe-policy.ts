/**
 * Where an extension's own documents may appear in the embedded browser
 * (design §4.4, review R1-4). Pure functions so the rule is unit-tested rather
 * than living inline in index.ts's `will-frame-navigate` handler.
 *
 * Extensions are session-wide: their content scripts run in agent tabs too, and
 * Electron cannot scope them per WebContents. What CAN be refused is an
 * extension's own UI frame (a password manager's inline menu is a
 * `chrome-extension://` subframe) inside a tab an agent owns, so CDP can neither
 * drive nor read it. A user tab keeps it: that is the feature.
 */

export type TabOwner = "user" | "agent";

/** Whether a frame navigation must be refused. Main frames are not governed
 * here (their scheme rule lives in index.ts's will-navigate). */
export function refusesExtensionSubframe(navigation: {
	isMainFrame: boolean;
	url: string;
	owner: TabOwner | null | undefined;
}): boolean {
	return (
		!navigation.isMainFrame &&
		isExtensionDocumentUrl(navigation.url) &&
		navigation.owner !== "user"
	);
}

/** A per-navigation rule does not touch a frame that already loaded while the
 * tab was the user's. When ownership moves away from the user, a tab holding
 * any extension subframe is reloaded so the rule above applies to every frame
 * (R1-4: "also apply when a tab changes owner"). */
export function mustReloadOnOwnerChange(
	owner: TabOwner,
	subframeUrls: readonly string[],
): boolean {
	return owner !== "user" && subframeUrls.some(isExtensionDocumentUrl);
}

export function isExtensionDocumentUrl(url: string): boolean {
	return /^chrome-extension:/i.test(url);
}
