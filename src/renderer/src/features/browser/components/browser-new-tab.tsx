import { BrandMark } from "@shared/components/common/brand-mark";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";

/**
 * The new-tab start page: what a fresh tab shows instead of a bare
 * `about:blank` (LOH-13 slice B, design brief section 2.4).
 *
 * WHY THIS IS RENDERER DOM AND NOT A PAGE THE VIEW LOADS. The start surface
 * must make no network call and must not become a new origin the sandbox has
 * to reason about: loading a bundled page into the WebContentsView would give
 * the tab a navigable URL, a history entry and a document an agent could be
 * pointed at, all to paint three lines of app chrome. So the native view is
 * hidden while the active tab is still on its start state (the same
 * hide-and-restore lever `browser-load-failure.tsx` uses) and this component
 * paints in the content rect underneath it. The tab's URL never changes, the
 * origin/permission boundary is untouched, and nothing is fetched — the brand
 * mark is the app's own masked asset, already bundled.
 *
 * NO ADDRESS FIELD, NO GO BUTTON (S5, ruling 2). S4a's centred field existed
 * because the omnibox was hidden at rest; with a permanent address row above
 * this page it would be a second field for one value, and the row is focused
 * when this state becomes current. The refused-address restore that used to
 * live here moved to the row (the surface seeds it from `chrome.refusedUrl`).
 *
 * NO SUGGESTIONS, HISTORY OR SHORTCUTS. Anything the page listed would either
 * be fetched (remote suggestions — a network call from a surface that promises
 * none), read out of the browsing profile (history — a privacy surface this
 * slice was not asked to open), or decorative filler, which the brief forbids
 * (section 5, item 8). What it states instead is only what this browser
 * actually does, in the user's words: navigate from the row, and agents reach
 * sites only through an approval.
 */
export const BrowserNewTab: FC = () => {
	useI18nLocale();
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"
			data-tour-tag="browser-start-page"
		>
			{/* The app's own mark, not a Globe glyph: this is the one surface that
			    is the app introducing itself rather than a state of a page (the
			    empty and no-tab states keep the Globe, which is about pages). */}
			<span className="flex items-center gap-2">
				<BrandMark className="size-8" tone="ink-muted" />
				<span className="text-title text-ink">
					{t("ui.browser.browser_new_tab.wordmark")}
				</span>
			</span>
			<p className="max-w-md text-body text-ink-muted">
				{t("ui.browser.browser_new_tab.enter_an_address_to_open_a_page")}
			</p>
			{/* The honest capability line: approvals are the browser's real gate
			    for agent traffic, and saying so here is the only claim this page
			    makes about agents — it grants nothing and lists no sites. */}
			<p className="max-w-md text-body-sm text-ink-dim">
				{t("ui.browser.browser_new_tab.agents_can_only_open_sites_you_approve")}
			</p>
		</div>
	);
};
