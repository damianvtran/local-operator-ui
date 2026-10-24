/**
 * The browser's START STATE, as one predicate (LOH-13 slice B).
 *
 * WHY THIS IS A MODEL MODULE AND NOT A HELPER INSIDE A COMPONENT. Three callers
 * need the same answer and they live in three different layers: the start page
 * decides whether to paint itself (`browser-new-tab.tsx`), the surface decides
 * whether to suppress the native view for it (`browser-surface.tsx`), and the
 * chrome hook decides whether a pending-navigation note has outlived the
 * attempt that set it (`use-browser-chrome.ts`, F1 round 2). A hook importing a
 * predicate from a component would invert the dependency, and a second copy of
 * the rule would be exactly the drift this module's sibling `site-info.ts`
 * refuses for the same reason. So the rule lives here: pure, no renderer, one
 * implementation, testable without a DOM.
 *
 * WHY IT IS AN EXACT MATCH. `about:blank` is the string main creates a fresh
 * user tab with (`createUserTab` in `host.ts`) and what Home returns to; the
 * empty string covers the projection before a tab's first URL is published.
 * Anything else is a real document the native view must keep painting —
 * including `about:blank#x` or another `about:` page a SITE navigated itself
 * to, which are pages with their own content rather than the start state. A
 * prefix check would let a hostile page spoof the suppression and hide itself
 * behind the start surface, so the comparison is exact.
 */
export function isStartPageUrl(url: string): boolean {
	return url === "" || url === "about:blank";
}

/**
 * The surface's own-state fact for page controls: a start projection (`""`
 * included) or a settled `about:blank`, EXCEPT while a submitted navigation is
 * pending. `pendingUrl`, not `loading`, is the discriminator — a fresh empty
 * projection can report `loading: true` before any submission, and that is
 * still a start page; a submitted navigation is the one thing that turns the
 * blank tab into a page the controls may act on.
 */
export function browserOwnStateFor(
	activeTab: { url: string } | null,
	pendingUrl: string | null,
): boolean {
	return activeTab !== null && isStartPageUrl(activeTab.url) && !pendingUrl;
}
