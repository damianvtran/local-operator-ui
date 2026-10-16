import { t } from "../../i18n";

/**
 * The in-page context menu's item model (LOH-13 slice A, gap 3).
 *
 * WHY THE MENU LIVES IN MAIN. A driven page is a native `WebContentsView`
 * painting above all renderer DOM, so a renderer `contextmenu` handler never
 * fires over the page. Electron's `webContents` `context-menu` event in main
 * is the only place the gesture exists. This module is the pure half — which
 * items, in which order, enabled when — so the rule is testable without
 * Electron; `index.ts` only turns the result into a native menu and pops it up.
 *
 * WHY IT IS READ/NAVIGATION ONLY. The brief's menu is Back, Forward, Reload,
 * and — over a link — Copy link address and Open link in new tab. No
 * downloads, no devtools, no permission or consent actions: those stay on
 * their own surfaces, and a right-click must not become a second, less
 * reviewed route to them. Labels come from the catalogue (`t`), never from
 * literals, so the menu follows the app's locale like the rest of the chrome.
 *
 * LINK ITEMS ONLY OVER A LINK, AND ONLY FOR OPENABLE LINKS. Copy is offered
 * for any link target Chromium reports. Open-in-new-tab additionally requires
 * an http(s) target: the new tab goes through the host's user-tab path, which
 * enforces the same scheme rule as typed navigation, and offering an item
 * that can only fail (`file:`, `javascript:`) would be a control that lies.
 */

export type PageContextMenuItemId =
	| "back"
	| "forward"
	| "reload"
	| "copy-link"
	| "open-link";

export interface PageContextMenuItem {
	id: PageContextMenuItemId;
	label: string;
	enabled: boolean;
}

export interface PageContextMenuInput {
	/** The link target under the pointer, or "" when not over a link. */
	linkUrl: string;
	canGoBack: boolean;
	canGoForward: boolean;
}

/** True when a link target may be opened as a user tab (http(s) only). */
export function isOpenableLink(rawUrl: string): boolean {
	try {
		const url = new URL(rawUrl);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

/** The menu's items in presentation order for one right-click. */
export function buildPageContextMenuItems(
	input: PageContextMenuInput,
): PageContextMenuItem[] {
	const items: PageContextMenuItem[] = [
		{
			id: "back",
			label: t("ui.browser.browser_url_bar.back"),
			enabled: input.canGoBack,
		},
		{
			id: "forward",
			label: t("ui.browser.browser_url_bar.forward"),
			enabled: input.canGoForward,
		},
		{
			id: "reload",
			label: t("ui.browser.browser_url_bar.reload"),
			enabled: true,
		},
	];
	if (input.linkUrl) {
		items.push(
			{
				id: "copy-link",
				label: t("ui.browser.page_context_menu.copy_link_address"),
				enabled: true,
			},
			{
				id: "open-link",
				label: t("ui.browser.page_context_menu.open_link_in_new_tab"),
				enabled: isOpenableLink(input.linkUrl),
			},
		);
	}
	return items;
}
