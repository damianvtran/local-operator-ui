/**
 * The registrations the BROWSER SURFACE ITSELF makes on the shared
 * view-suppression registry, and the predicate that separates them from a real
 * overlay.
 *
 * WHY THE DISTINCTION EXISTS (S4a). A `WebContentsView` paints above all DOM
 * (design 11.3), so the surface hides the native view while it paints its own
 * START PAGE and LOAD-FAILURE panel. Those registrations are not an overlay
 * covering the browser — they ARE the browser, and the chrome band the user is
 * typing into stays on screen. Main's shortcut ownership and the renderer's
 * `availableRoots` both read the bare "anything is registered" fact, so both
 * refused Cmd+L/T/R on exactly those two states, and on the main side the press
 * was not even consumed — which let the app menu's Reload reload the whole
 * window. ONE list, imported by the registrant and by both consumers, is what
 * keeps two layers from drifting into two opinions about which ids are ours.
 *
 * The trailing colon is deliberate: `useSuppressBrowserView` registers
 * `${kind}:${label}:${useId()}`, so a prefix match is exact against the label and
 * cannot swallow a future id such as "browser-start-page-help".
 */
export const BROWSER_SELF_SUPPRESSION_PREFIXES = [
	// The load-failure panel (`browser-surface.tsx`, label "browser-load-failure").
	"browser-state:browser-load-failure:",
	// The start page (LOH-13 slice B, label "browser-start-page").
	"browser-state:browser-start-page:",
] as const;

export function isBrowserSelfSuppression(id: string): boolean {
	return BROWSER_SELF_SUPPRESSION_PREFIXES.some((prefix) =>
		id.startsWith(prefix),
	);
}

/**
 * Whether an overlay the BROWSER DOES NOT OWN is covering the content area.
 *
 * This is the fact browser commands key on: a genuine dialog, menu or picker
 * (any id outside the list above) takes the keyboard, while the browser's own
 * state pages leave it with the browser. An empty snapshot means nothing is
 * suppressing anything, which is the ordinary loaded-page case.
 */
export function browserOverlaySuppressing(suppressedBy: string): boolean {
	if (!suppressedBy) return false;
	return suppressedBy
		.split(",")
		.some((id) => id !== "" && !isBrowserSelfSuppression(id));
}
