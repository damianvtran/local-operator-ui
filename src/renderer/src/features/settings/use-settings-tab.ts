/**
 * @file use-settings-tab.ts
 * @description
 * The page's one way to change tab, and the flag that keeps a navigation from
 * cancelling the jump that caused it.
 *
 * WHY A HOOK AND NOT CALLS TO `navigate` IN THE JSX. A tab click is a push —
 * always, so Back steps through tabs the way the reader moved through them —
 * and a click on the tab already showing is a no-op, so a double click does not
 * grow a second identical history entry. Both rules belong to the action, not
 * to each of the rail's and the page's call sites.
 */
import { useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
	type ResolveSettingsTabInput,
	SETTINGS_PATH,
	lastSettingsTab,
	resolveSettingsTab,
} from "./settings-tabs";

export type UseSettingsTabResult = {
	/** The tab the URL selects; always a section this build shows. */
	activeTab: string;
	/** The URL named a tab that could not be shown (PR2 computes, does not render). */
	stale: boolean;
	/** Show one tab: a history push, and a no-op when it is already showing. */
	selectTab: (tab: string, options?: { replace?: boolean }) => void;
	/**
	 * Read-and-reset: true while the page's OWN navigation is being applied.
	 *
	 * The page's "a URL link outranks a search jump" effect asks this before
	 * clearing the jump, because `selectTab` itself changes the URL.
	 */
	ownNavigationRef: React.MutableRefObject<boolean>;
};

export function useSettingsTab(
	input: Omit<ResolveSettingsTabInput, "lastTab">,
): UseSettingsTabResult {
	const { search, available, sectionForKey } = input;
	const navigate = useNavigate();
	const ownNavigationRef = useRef(false);
	const resolved = useMemo(
		() =>
			resolveSettingsTab({
				search,
				available,
				// Read at resolve time, never captured: the memory is written by the
				// arrival effect, and a value frozen into the memo would be one visit
				// behind.
				lastTab: lastSettingsTab(),
				sectionForKey,
			}),
		[search, available, sectionForKey],
	);
	const activeTab = resolved.tab;
	const selectTab = useCallback(
		(tab: string, options: { replace?: boolean } = {}) => {
			if (tab === activeTab) return;
			ownNavigationRef.current = true;
			/*
			 * A push, not a replace: a tab is a destination, and Back must walk the
			 * tabs the reader visited rather than leaving the page on the first
			 * press. `row`, `setting`, `filter`, `mcp` and `provider` are dropped
			 * here because they name a destination INSIDE the tab being left.
			 */
			navigate(
				{
					pathname: SETTINGS_PATH,
					search: `?section=${encodeURIComponent(tab)}`,
				},
				{ replace: options.replace ?? false },
			);
		},
		[activeTab, navigate],
	);
	return { activeTab, stale: resolved.stale, selectTab, ownNavigationRef };
}
