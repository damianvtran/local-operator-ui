/**
 * Focus that belongs to a PORTALLED piece of chrome the popout itself owns.
 *
 * Radix portals a menu into `document.body`, and its focus scope moves focus
 * into that portal when the menu opens. To the popout's blur handlers that looks
 * exactly like focus leaving for the page — and dismissing on it closed the menu
 * the user had just opened, taking the field row with it (agent review round 1,
 * MAJOR-1 and UX U1: the menu's first item, Address, could not raise the field
 * because the row it would raise was already gone).
 *
 * WHY AN ATTRIBUTE TEST AND NOT A PROP. The popout renders its menu through a
 * child, so the surface cannot see the menu's open state at the moment the blur
 * fires (Radix's DismissableLayer has already closed it on pointer-down outside).
 * The one fact that is true in every case is where focus actually went.
 *
 * NOT "A MENU", THIS MENU (agent review round 2, MINOR-7). The first version
 * admitted every `[role="menu"]` and every popper wrapper, so focus landing in an
 * unrelated Radix menu — the sidebar's, a chat menu — kept the popout raised. The
 * panel therefore carries its own marker (`PAGE_MENU_SURFACE`), and only focus
 * inside it, or in a wrapper proven to hold it, is the chrome. A click on the
 * sidebar, the tab strip, another menu or the page still dismisses.
 */
/**
 * The marker the popout's own page-menu panel carries. The panel is Radix's
 * `DropdownMenuContent`, which a consumer cannot otherwise distinguish from any
 * other menu in the document. The TAG is separate from the selector so the
 * component writes the same value the predicate reads.
 */
export const PAGE_MENU_SURFACE_TAG = "page-menu";
export const PAGE_MENU_SURFACE = `[data-browser-chrome="${PAGE_MENU_SURFACE_TAG}"]`;

export function isPortalledChromeTarget(node: Node | null): boolean {
	if (node === null) return false;
	const element = node instanceof Element ? node : node.parentElement;
	if (element === null) return false;
	// THE MENU'S OWN PANEL, not "a menu". Round 2 (MINOR-7) found the first
	// version admitted every `[role="menu"]` and every popper wrapper, so a click
	// into an unrelated Radix menu (the sidebar's, a chat menu) kept the popout
	// raised — the page menu is one panel, and only focus that lands in IT (or a
	// wrapper proven to hold it) belongs to the chrome.
	if (element.closest(PAGE_MENU_SURFACE) !== null) return true;
	const wrapper = element.closest("[data-radix-popper-content-wrapper]");
	return wrapper !== null && wrapper.querySelector(PAGE_MENU_SURFACE) !== null;
}
