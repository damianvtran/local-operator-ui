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
 * The one fact that is true in every case is where focus actually went: a popper
 * content wrapper, or a menu surface inside one. Nothing else is admitted — a
 * click on the sidebar, the tab strip or the page still dismisses.
 */
export function isPortalledChromeTarget(node: Node | null): boolean {
	if (node === null) return false;
	const element = node instanceof Element ? node : node.parentElement;
	if (element === null) return false;
	return (
		element.closest('[data-radix-popper-content-wrapper], [role="menu"]') !==
		null
	);
}
