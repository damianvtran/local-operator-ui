import { BrandMark } from "@shared/components/common/brand-mark";
import { Button, Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

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
 * WHY IT CARRIES ITS OWN ADDRESS FIELD when the omnibox is right above it
 * (D1/U6, round 1). Two address fields are visible on this one state, and that
 * is what the brief asks for: the brief's "the address is not duplicated as a
 * control" rule is about a FAILED navigation, where the bar holds the attempted
 * address the user must correct. A fresh tab is the opposite moment — the bar
 * is empty, and the page's whole reason to exist is to offer the one action the
 * browser has, so the centred field is the primary control rather than a second
 * copy of a value held elsewhere. The choice is recorded here rather than
 * papered over by a placeholder on the empty bar, because a placeholder on the
 * omnibox would say "the tab is trying to load this" — a claim about a
 * navigation that has not been asked for. Both fields submit through the same
 * `chrome.navigate` path, so main's scheme checks and the approval gate see no
 * new caller.
 *
 * WHY NO SUGGESTIONS, HISTORY OR SHORTCUTS. Anything the page listed would
 * either be fetched (remote suggestions — a network call from a surface that
 * promises none), read out of the browsing profile (history — a privacy
 * surface this slice was not asked to open), or decorative filler, which the
 * brief forbids (section 5, item 8). What it states instead is only what this
 * browser actually does, in the user's words: navigate from here or the bar,
 * and agents reach sites only through an approval.
 *
 * FOCUS (U2, round 1). The field takes focus when this page mounts, and only
 * then: this component IS the start state, so a mount is a new tab or a Home
 * press — the two moments the user's next action is to type somewhere. That is
 * the DOM half of the browser's habit (Chrome and Firefox focus the omnibox on
 * a new tab), and it is not the rule design 11.4 protects: 11.4 forbids
 * focusing the native `WebContentsView`, which would move the OS caret into a
 * page and out of the app's own chrome. This is an ordinary app input.
 */

export interface BrowserNewTabProps {
	/** Start a navigation in the active tab; the surface's own navigate path. */
	onNavigate: (url: string) => void;
	/**
	 * An address to seed the field with, or null.
	 *
	 * THIS IS THE ADDRESS-PRESERVATION HALF OF F1 (round 2). The field's draft is
	 * mount-local state, and the surface unmounts this page the moment a
	 * navigation is submitted — so a REFUSED address (main's `nav_failed`, or an
	 * IPC rejection of a blank one) came back to a freshly mounted page with an
	 * EMPTY field, and the user had to retype what they had just typed. The
	 * surface hands the refused address down here (`chrome.refusedUrl`), and it
	 * seeds the initial draft, so returning to the start page after a refusal
	 * shows the address that was refused, ready to correct. Seeded as the INITIAL
	 * value rather than synced in an effect: a mount is the only moment this page
	 * is created, so there is nothing to sync against, and an effect would fight
	 * a user who has started editing.
	 */
	restoreAddress?: string | null;
}

export const BrowserNewTab: FC<BrowserNewTabProps> = ({
	onNavigate,
	restoreAddress = null,
}) => {
	useI18nLocale();
	const [draft, setDraft] = useState(() => restoreAddress ?? "");
	const fieldRef = useRef<HTMLInputElement>(null);

	// See the focus note in the header comment: mount-only, and only the app's
	// own input. `preventScroll` because focusing a field inside a centred
	// column must not scroll the content rect the native view is bound to.
	useEffect(() => {
		fieldRef.current?.focus({ preventScroll: true });
	}, []);

	const value = draft.trim();
	const submit = (event: FormEvent): void => {
		event.preventDefault();
		// An empty submit is not a navigation, and the control is disabled for it
		// below — so this guard is the belt to that braces, for a submit that
		// arrives from the keyboard on a field the user just cleared.
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
					ref={fieldRef}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					spellCheck={false}
					autoComplete="off"
					aria-label={t("ui.browser.browser_new_tab.address")}
					placeholder={t("ui.browser.browser_new_tab.address_placeholder")}
					data-tour-tag="browser-start-page-address"
					className="min-w-0 grow"
				/>
				{/* U5 (round 1): Go on an empty field was a silent no-op. Disabled is
				    the honest form — the control cannot do anything without an
				    address, and a press that visibly does nothing is the state the
				    finding named. The disabled state is a colour step, never opacity
				    (contract §6). */}
				<Button
					type="submit"
					variant="outline"
					size="sm"
					disabled={value.length === 0}
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
