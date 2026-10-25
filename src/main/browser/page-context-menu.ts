import { t } from "../../i18n";

/**
 * The in-page context menu's item model (LOH-13 slice A, gap 3;
 * D2/U3 remediation).
 *
 * WHY THE MENU LIVES IN MAIN. A driven page is a native `WebContentsView`
 * painting above all renderer DOM, so a renderer `contextmenu` handler never
 * fires over the page. Electron's `webContents` `context-menu` event in main
 * is the only place the gesture exists. This module is the pure half — which
 * items, in which order, enabled when — so the rule is testable without
 * Electron; `index.ts` only turns the result into a native menu and pops it up.
 *
 * WHY IT IS READ/NAVIGATION/EDIT ONLY. The brief's menu is Back, Forward,
 * Reload, and — over a link — Copy link address and Open link in new tab.
 * Over selected text it offers Copy, so the page's own selection is reachable
 * without a detour through the address bar. No downloads, no devtools, no
 * permission or consent actions: those stay on their own surfaces, and a
 * right-click must not become a second, less reviewed route to them. Labels
 * come from the catalogue (`t`), never from literals, so the menu follows the
 * app's locale like the rest of the chrome.
 *
 * GROUPS, SEPARATED (D2). Navigation, then a separator, then the thing the
 * click was ON (a link's items, or the page's own Copy page address) — every
 * platform browser separates these groups, and a flat list makes the link
 * items read as more navigation. The separator is an item here so the rule,
 * not the Electron adapter, owns the grouping.
 *
 * THE EDITABLE CASE (D2, U8). The same event fires over text fields, where the
 * platform expectation is an edit menu. Offering Back/Forward there — and no
 * Cut/Copy/Paste — would take the native edit menu away and give nothing
 * back, so an editable target gets the standard edit items INSTEAD of the
 * navigation group (the smaller correct option: a right-click inside a text
 * field is an editing gesture, and duplicating both groups makes one long
 * menu serving two gestures). Undo and Redo lead the group, above Cut/Copy,
 * because they are the actions a user reaches for first after an accidental
 * edit, and they are separated from the clipboard actions the way every
 * platform browser separates history from clipboard (U8). The actions are the
 * contents' own (`undo`/`redo`/`cut`/`copy`/`paste`/`selectAll` in
 * `index.ts`), never a reimplementation.
 *
 * LINK ITEMS ONLY OVER A LINK, AND ONLY FOR OPENABLE LINKS. Copy is offered
 * for any link target Chromium reports. Open-in-new-tab additionally requires
 * an http(s) target: the new tab goes through the host's user-tab path, which
 * enforces the same scheme rule as typed navigation, and offering an item
 * that can only fail (`file:`, `javascript:`) would be a control that lies.
 * Open-in-new-tab deliberately opens in the FOREGROUND (U5, deferred by
 * design): it goes through `createUserTab`, whose user tabs are created
 * active, matching every other user-tab action in this chrome.
 */

export type PageContextMenuItemId =
	| "back"
	| "forward"
	| "reload"
	| "separator"
	| "copy-link"
	| "open-link"
	| "copy-page"
	| "undo"
	| "redo"
	| "cut"
	| "copy"
	| "paste"
	| "select-all";

export interface PageContextMenuItem {
	id: PageContextMenuItemId;
	label: string;
	enabled: boolean;
}

export interface PageContextMenuInput {
	/** The link target under the pointer, or "" when not over a link. */
	linkUrl: string;
	/** The page's own URL, for Copy page address. "" when there is none. */
	pageUrl: string;
	canGoBack: boolean;
	canGoForward: boolean;
	/** The click landed in an editable field (Chromium `isEditable`). */
	isEditable?: boolean;
	/**
	 * The page's selected text (Chromium `selectionText`), or "" when the
	 * click was not over a selection. A non-editable page uses this to offer
	 * Copy without taking the navigation group away.
	 */
	selectionText?: string;
	/**
	 * Chromium's per-action edit availability (`editFlags`), when the caller
	 * has it. Absent flags mean "editable, availability unknown", which
	 * enables the item: a disabled Paste that could have pasted is a control
	 * that lies, and the contents' own action is a no-op when it cannot run.
	 */
	editFlags?: {
		canUndo?: boolean;
		canRedo?: boolean;
		canCut?: boolean;
		canCopy?: boolean;
		canPaste?: boolean;
		canSelectAll?: boolean;
	};
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

const SEPARATOR: PageContextMenuItem = {
	id: "separator",
	label: "",
	enabled: false,
};

/** The menu's items in presentation order for one right-click. */
export function buildPageContextMenuItems(
	input: PageContextMenuInput,
): PageContextMenuItem[] {
	// Editable target: the edit group replaces the navigation group (see the
	// header). Link items do not apply — a link inside an editable field is
	// text being edited, not a navigation target.
	if (input.isEditable) {
		const flags = input.editFlags ?? {};
		return [
			{
				id: "undo",
				label: t("ui.browser.page_context_menu.undo"),
				enabled: flags.canUndo ?? true,
			},
			{
				id: "redo",
				label: t("ui.browser.page_context_menu.redo"),
				enabled: flags.canRedo ?? true,
			},
			SEPARATOR,
			{
				id: "cut",
				label: t("ui.browser.page_context_menu.cut"),
				enabled: flags.canCut ?? true,
			},
			{
				id: "copy",
				label: t("ui.browser.page_context_menu.copy"),
				enabled: flags.canCopy ?? true,
			},
			{
				id: "paste",
				label: t("ui.browser.page_context_menu.paste"),
				enabled: flags.canPaste ?? true,
			},
			{
				id: "select-all",
				label: t("ui.browser.page_context_menu.select_all"),
				enabled: flags.canSelectAll ?? true,
			},
		];
	}
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
	if (input.selectionText) {
		// The selection belongs to the page, so Copy is the page's own
		// `contents.copy()`. It leads the non-navigation groups: right-clicking
		// selected text is a text gesture first, and a link inside that
		// selection still keeps its own Copy link address below.
		items.push(SEPARATOR, {
			id: "copy",
			label: t("ui.browser.page_context_menu.copy"),
			enabled: true,
		});
	}
	if (input.linkUrl) {
		items.push(
			SEPARATOR,
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
	} else if (input.pageUrl) {
		// U3: the page's own address, for a right-click that was not on a link.
		// The address bar is otherwise the only copy path, and it costs a
		// focus change, a select-all and a copy to do what this does in one.
		items.push(SEPARATOR, {
			id: "copy-page",
			label: t("ui.browser.page_context_menu.copy_page_address"),
			enabled: true,
		});
	}
	return items;
}
