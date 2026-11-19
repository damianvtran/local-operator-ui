import { t } from "@shared/i18n";
import type { TabActionsMenuItem } from "../../../../../shared/browser-tab-actions-menu";
import type { BrowserTabView } from "../hooks/use-browser-chrome";

/**
 * The tab actions menu's ITEM RULE (LOH-13 operator report, 2026-10-25).
 *
 * The menu is a native Electron menu now, so there is no panel to inspect in the
 * DOM: this module is the testable half - which items, in which order, enabled
 * when, and with which catalogue copy. The strip builds this list once per press
 * and sends it to main, which validates it and turns it into the OS menu.
 *
 * WHY THE LIST IS BUILT FROM THE STRIP'S OWN FACTS. "Close 2 other tabs" is the
 * disclosure for a destructive press, and the move items index into the order
 * the user is looking at; a second derivation in main would be a second answer
 * to both. The facts interface is deliberately flat: the strip computes the
 * counts from the same `tabs`/`ordered` lists the press will act on.
 *
 * LOAD-BEARING DETAILS CARRIED OVER FROM THE PANEL:
 * - the quiet rows come first, the destructive family starts behind a rule
 *   (D12), and `Copy URL` sits behind the second rule because it is the one
 *   item that closes nothing (D7);
 * - the title row names the tab (design round 2, D4) and is a disabled item in
 *   the native menu, which has no section-label primitive;
 * - the conversation item needs two tabs to be worth offering: closing "all" of
 *   a single-tab conversation is `Close "X"` under a longer label;
 * - `Copy URL` requires http(s): `about:blank`, `file:` and `data:` are not
 *   things to paste into a chat.
 */

/** The schemes a `Copy URL` press may copy: what can be pasted somewhere useful. */
const HTTP_URL = /^https?:\/\//;

/**
 * Everything the native tab-actions menu's item list is derived from.
 *
 * THE LIST IS A SNAPSHOT OF THE RENDER the press belongs to. The move items'
 * availability comes from the RENDERED (grouped) order, and every
 * count is taken from the same `tabs` list the press would close - the counts
 * are the disclosure, so they must describe the list the user is looking at
 * (design R5, operator's U7 ruling). main receives the list as-is; it does not
 * re-derive any of it, because a second derivation is a second answer to "how
 * many tabs will this close".
 */
export interface TabActionsMenuFacts {
	tab: BrowserTabView;
	/** The tab's name as an isolated run (`isolatedTabLabel`), for the interpolation. */
	label: string;
	/** Physical move availability: RTL flips which neighbours are "left"/"right". */
	canMoveLeft: boolean;
	canMoveRight: boolean;
	/** `onReorder` was wired: the move items exist only when the host can move. */
	canReorder: boolean;
	/** `onTabAction` was wired: mute/duplicate/reload exist only when it can act. */
	canTabAction: boolean;
	/** Counts for the batch closes; null means "do not offer the item". */
	closeOthers: number | null;
	closeRight: number | null;
	closeFailed: number | null;
	/** The conversation's tab count, for the group item's `>= 2` gate. */
	conversationCount: number;
}

/**
 * The tab menu's items, in the order the native menu presents them.
 *
 * THIS IS THE ITEM RULE (the old Radix panel's JSX, now data). It is exported so
 * a test can pin order, labels and enabled flags without a DOM - the native menu
 * has no DOM to query - and so the strip and its test cannot drift about which
 * item sits where. The grouping is deliberate and carried over: the quiet rows
 * first, the destructive family behind a rule (D12), and `Copy URL` behind the
 * second rule because it is the one item that closes nothing (D7). The second
 * rule is present even when `Copy URL` is absent, exactly as the panel's
 * unconditional separator was; the OS may collapse a trailing rule on its own.
 */
export function buildTabActionsMenuItems(
	facts: TabActionsMenuFacts,
): TabActionsMenuItem[] {
	const { tab, label } = facts;
	const items: TabActionsMenuItem[] = [
		{
			id: "header",
			label: t("ui.browser.browser_tab_strip.actions_for", { title: label }),
			enabled: false,
		},
	];
	if (!tab.active)
		items.push({
			id: "watch",
			label: t("ui.browser.browser_tab_strip.watch", { title: label }),
			enabled: true,
		});
	if (tab.owner === "user" && !tab.handedOver)
		items.push({
			id: "hand-over",
			/*
			 * THE ELLIPSIS IS INTERACTION COPY, and it is appended here rather than
			 * carried by the catalogue string because every translated label would
			 * otherwise need its own copy of it. This row opens the hand-over
			 * picker instead of handing the tab over, so it must read like the
			 * dialog-opening control it is (base `browser-tab-strip.tsx:1557-1563`).
			 */
			label: `${t("ui.browser.browser_tab_strip.let_an_agent_use", {
				title: label,
			})}…`,
			enabled: true,
		});
	if (tab.handedOver || tab.owner === "agent")
		items.push({
			id: "revoke-hand-over",
			label: t("ui.browser.browser_tab_strip.stop_letting_the_agent_use", {
				title: label,
			}),
			enabled: true,
		});
	if (facts.canReorder) {
		items.push(
			{
				id: "move-left",
				label: t("ui.browser.chrome.move_left"),
				enabled: facts.canMoveLeft,
			},
			{
				id: "move-right",
				label: t("ui.browser.chrome.move_right"),
				enabled: facts.canMoveRight,
			},
		);
	}
	if (facts.canTabAction) {
		if (tab.audible || tab.muted)
			items.push({
				id: tab.muted ? "unmute" : "mute",
				label: t(
					tab.muted
						? "ui.browser.browser_tab_strip.unmute_tab"
						: "ui.browser.browser_tab_strip.mute_tab",
				),
				enabled: true,
			});
		items.push(
			{
				id: "duplicate",
				label: t("ui.browser.chrome.duplicate"),
				enabled: true,
			},
			{
				id: "reload",
				label: t("ui.browser.chrome.reload"),
				enabled: true,
			},
		);
	}
	items.push(
		{ id: "separator", label: "", enabled: false },
		{
			id: "close",
			label: t("ui.browser.browser_tab_strip.close", { title: label }),
			enabled: true,
		},
	);
	if (facts.closeOthers !== null)
		items.push({
			id: "close-others",
			label: t("ui.browser.browser_tab_strip.close_other_tabs", {
				count: facts.closeOthers,
			}),
			enabled: true,
		});
	if (facts.closeRight !== null)
		items.push({
			id: "close-right",
			label: t("ui.browser.browser_tab_strip.close_right_tabs", {
				count: facts.closeRight,
			}),
			enabled: true,
		});
	if (facts.closeFailed !== null)
		items.push({
			id: "close-failed",
			label: t("ui.browser.browser_tab_strip.close_failed_tabs", {
				count: facts.closeFailed,
			}),
			enabled: true,
		});
	if (tab.sessionId !== null && facts.conversationCount >= 2)
		items.push({
			id: "close-conversation",
			label: t("ui.browser.browser_tab_strip.close_conversation_tabs", {
				count: facts.conversationCount,
			}),
			enabled: true,
		});
	items.push({ id: "separator", label: "", enabled: false });
	if (HTTP_URL.test(tab.url))
		items.push({
			id: "copy-url",
			label: t("ui.browser.browser_tab_strip.copy_url"),
			enabled: true,
		});
	return items;
}
