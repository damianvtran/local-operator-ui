import { BrandMark } from "@shared/components/common/brand-mark";
import { Button, Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC, FormEvent } from "react";
import { useState } from "react";

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
 * WHY IT CARRIES ITS OWN ADDRESS FIELD when the omnibox is right above it.
 * The brief's error rule ("the address is not duplicated as a control") is
 * about a FAILED navigation, where the bar still holds the attempted address
 * the user must correct. A new tab is the opposite moment: the bar is empty
 * and the one action this page exists to offer is starting a navigation, so
 * the field is the page's primary control, not a second copy of a value held
 * elsewhere. Submitting it goes through the exact path the bar uses
 * (`chrome.navigate` in `browser-surface.tsx`), so the scheme checks and the
 * approval gate in main see no new caller.
 *
 * WHY NO SUGGESTIONS, HISTORY OR SHORTCUTS. Anything the page listed would
 * either be fetched (remote suggestions — a network call from a surface that
 * promises none), read out of the browsing profile (history — a privacy
 * surface this slice was not asked to open), or decorative filler, which the
 * brief forbids (section 5, item 8). What it states instead is only what this
 * browser actually does, in the user's words: navigate from here or the bar,
 * and agents reach sites only through an approval.
 *
 * FOCUS: nothing here takes focus on mount (design 11.4 — nothing focuses a
 * view, and the chrome follows the same rule). The field is reachable by Tab
 * and by the existing focus-address chord, like every other control.
 */

/**
 * Whether a tab URL is the start state a fresh tab opens on.
 *
 * `about:blank` is the exact string main creates a user tab with
 * (`createUserTab` in `host.ts`) and what Home returns to; the empty string
 * covers the projection before a tab's first URL is published. Anything else
 * — including `about:blank#x` or another `about:` page a site navigated to —
 * is a real document the view must keep painting, so the comparison is exact
 * rather than a prefix check.
 */
export function isStartPageUrl(url: string): boolean {
	return url === "" || url === "about:blank";
}

export interface BrowserNewTabProps {
	/** Start a navigation in the active tab; the surface's own navigate path. */
	onNavigate: (url: string) => void;
}

export const BrowserNewTab: FC<BrowserNewTabProps> = ({ onNavigate }) => {
	useI18nLocale();
	const [draft, setDraft] = useState("");

	const submit = (event: FormEvent): void => {
		event.preventDefault();
		// An empty submit is not a navigation: main would refuse the blank
		// address and the surface would paint that refusal over a page whose
		// only fault is an untouched field.
		const value = draft.trim();
		if (value) onNavigate(value);
	};

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
			<form
				onSubmit={submit}
				className="flex w-full max-w-md items-center justify-center gap-2"
			>
				<Input
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					spellCheck={false}
					autoComplete="off"
					aria-label={t("ui.browser.browser_new_tab.address")}
					placeholder={t("ui.browser.browser_new_tab.address_placeholder")}
					data-tour-tag="browser-start-page-address"
					className="min-w-0 grow"
				/>
				<Button
					type="submit"
					variant="outline"
					size="sm"
					data-tour-tag="browser-start-page-go"
				>
					{t("ui.browser.browser_new_tab.go")}
				</Button>
			</form>
			{/* The honest capability line: approvals are the browser's real gate
			    for agent traffic, and saying so here is the only claim this page
			    makes about agents — it grants nothing and lists no sites. */}
			<p className="max-w-md text-body-sm text-ink-dim">
				{t("ui.browser.browser_new_tab.agents_can_only_open_sites_you_approve")}
			</p>
		</div>
	);
};
