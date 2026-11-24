/**
 * @file settings-tabs.ts
 * @description
 * The Settings page's tab grammar in one pure module: which tab a URL selects,
 * what a tab's URL is, when a page-local search jump survives a navigation, and
 * the per-tab scroll memory.
 *
 * ## Why the tab is a FUNCTION OF THE URL
 *
 * Settings is a route, and everything that reaches a section already speaks in
 * URLs: the command palette, `/mcp`, `/login`, `/provider`, the phone-access
 * offer, the profile menu. Making the rail's selection a second, independent
 * piece of state would mean two answers to "which panel is showing" and a
 * reconciliation effect between them — the class of bug where the URL says
 * `appearance` and the rail highlights General.
 *
 * So the panel is a pure function of `location.search` plus the set of sections
 * this build actually shows. Back and Forward need no code: the history entry
 * carries the answer.
 *
 * ## Precedence, and why
 *
 * `setting=` outranks `section=`: a promoted key's control lives in a section
 * the link does not name, and the existing promotion map (`sectionForSettingKey`)
 * is the one authority on where it went. `section=` outranks an implied tab
 * (`provider`, `mcp`, `filter`) because a link that names both names its
 * destination first. `lastTab` is read ONLY when the URL names nothing at all —
 * a bare `/settings` from the gear — so a memory can never override a link.
 *
 * ## Stale links
 *
 * A link to a tab this build does not show (an older version's section id, or
 * `agent-messages` while the surface is absent) lands on General with
 * `stale: true`. PR2 computes the flag and does not render a notice; the notice
 * belongs to the link grammar's next step, which also owns canonicalising the
 * legacy parameters.
 *
 * ## No imports, on purpose
 *
 * This module is bundled on its own by `scripts/settings-tabs.test.mjs`, the
 * same way the Esc rules are. `sectionForSettingKey` is INJECTED rather than
 * imported so the module never drags the i18n graph (and with it every
 * translation catalogue) into a test process.
 */

/** The route Settings lives at (one spelling, used by the link builder too). */
export const SETTINGS_PATH = "/settings";

/** The tab a link lands on when it names nothing this build can show. */
export const FALLBACK_SETTINGS_TAB = "general";

/**
 * The tab ids, in the order `DEFAULT_SETTINGS_SECTIONS` lists them.
 *
 * A section id IS a tab id: every existing `?section=` link keeps working with
 * no translation table, and `settings-section-routes.test.mjs`'s source scan
 * stays the guard that a link names a destination that exists.
 */
export const SETTINGS_TAB_IDS = [
	"general",
	"radient",
	"agent-messages",
	"integrations",
	"appearance",
	"notifications",
	"speech",
	"keyboard",
	"providers",
	"backend",
	"imports",
	"updates",
] as const;

/**
 * Onboarding tour anchors on the RAIL, keyed by tab id. A tab with no entry
 * gets no tag, which is what the tour expects — `features/onboarding` matches
 * these values by selector, so a renamed value breaks the tour silently.
 *
 * They live here rather than beside the rail because the tour now CLICKS a row
 * to reveal the panel it is about to spotlight (`tour-settings-tab.ts`), so the
 * tag names have two readers and one owner.
 */
export const TOUR_TAGS: Record<string, string> = {
	general: "settings-sidebar-general",
	radient: "settings-sidebar-radient-account",
	integrations: "settings-sidebar-integrations",
	appearance: "settings-sidebar-appearance",
	updates: "settings-sidebar-application-updates",
};

/**
 * The query parameters that name a destination inside Settings.
 *
 * Used by `shouldClearSearchJump` to tell a reader's own navigation (which must
 * cancel a page-local jump) from the page's own tab push (which must not).
 */
export const SETTINGS_DEEP_LINK_PARAMS = [
	"section",
	"setting",
	"provider",
	"filter",
	"mcp",
] as const;

export type ResolvedSettingsTab = {
	/** The tab to show. Always a member of `available`. */
	tab: string;
	/** The URL named something this build cannot show, and fell back. */
	stale: boolean;
};

export type ResolveSettingsTabInput = {
	/** `location.search`, with or without the leading `?`. */
	search: string;
	/** The ids this build shows (the filtered settings sections). */
	available: readonly string[];
	/** The last tab visited this run, or null on a cold start. */
	lastTab: string | null;
	/** Where a promoted registry key's control lives (injected; see the file header). */
	sectionForKey: (key: string) => string;
};

/**
 * The URL's own answer: which tab to show, and whether the URL was overruled.
 */
export function resolveSettingsTab({
	search,
	available,
	lastTab,
	sectionForKey,
}: ResolveSettingsTabInput): ResolvedSettingsTab {
	const params = new URLSearchParams(search);
	const settingKey = params.get("setting");
	let wanted: string | null;
	if (settingKey) {
		wanted = sectionForKey(settingKey);
	} else if (params.get("section")) {
		wanted = params.get("section");
	} else if (params.get("provider")) {
		// `/login <provider>` and `/provider` land in the provider grid.
		wanted = "providers";
	} else if (params.get("mcp")) {
		// `/mcp <server>` lands in the integrations (MCP) section.
		wanted = "integrations";
	} else if (params.get("filter")) {
		// `/backend <filter>` lands in the registry list it filters.
		wanted = "backend";
	} else {
		// A bare `/settings`: the gear, Cmd+comma, the profile menu. This is the
		// ONE reader of the run's last tab; every named destination outranks it.
		wanted = lastTab;
	}
	if (wanted !== null && available.includes(wanted)) {
		return { tab: wanted, stale: false };
	}
	return { tab: FALLBACK_SETTINGS_TAB, stale: wanted !== null };
}

/** The URL a rail row pushes for its tab. */
export function buildSettingsTabHref(tab: string): string {
	return `${SETTINGS_PATH}?section=${encodeURIComponent(tab)}`; // i18n: ignore route path, not user copy
}

/**
 * Whether a `location.search` change must cancel a pending page-local search
 * jump (a registry key the URL does not name).
 *
 * WHY NOT "any change". `jumpToSearchEntry` now NAVIGATES for every result kind
 * — a row or section in another tab is revealed by pushing that tab — so the
 * old clear-on-every-change effect cancelled the very jump that caused the
 * navigation, and the keyed row was never revealed (the trap this function
 * exists to close).
 *
 * A jump survives when the change is the page's own tab push (`ownNavigation`),
 * and when no destination parameter changed at all. It is cleared when the
 * reader navigated with a link of their own: that link's key is the newer
 * intent, and the section must follow it.
 */
export function shouldClearSearchJump(
	previousSearch: string,
	nextSearch: string,
	ownNavigation: boolean,
): boolean {
	if (nextSearch === previousSearch) return false;
	if (ownNavigation) return false;
	const previous = new URLSearchParams(previousSearch);
	const next = new URLSearchParams(nextSearch);
	return SETTINGS_DEEP_LINK_PARAMS.some(
		(param) => previous.get(param) !== next.get(param),
	);
}

/** Per-tab scroll positions, for the length of one Settings visit. */
export type TabScrollMemory = {
	/** Start recording under this tab (called by the arrival effect). */
	track: (tab: string) => void;
	/** Store the scroller's current position under the tracked tab. */
	record: (top: number) => void;
	/** The position last remembered for `tab`, if any. */
	recall: (tab: string | null) => number | undefined;
	/** The tab scroll events are currently attributed to. */
	trackedTab: () => string | null;
};

/**
 * One memory per page mount.
 *
 * WHY TRACKED, NOT PASSED. The scroll listener is passive and must not depend on
 * a value captured when it was bound: a tab switch rebinds nothing, it changes
 * which tab the next event belongs to. Passing the tab at record time would mean
 * re-binding the listener on every switch, and the frame between the commit and
 * the rebind would attribute the outgoing tab's position to the incoming one.
 */
export function createTabScrollMemory(): TabScrollMemory {
	const tops = new Map<string, number>();
	let tracked: string | null = null;
	return {
		track(tab) {
			tracked = tab;
		},
		record(top) {
			if (tracked === null) return;
			tops.set(tracked, top);
		},
		recall(tab) {
			if (tab === null) return undefined;
			return tops.get(tab);
		},
		trackedTab() {
			return tracked;
		},
	};
}

/**
 * Record a scroller's positions under the tab the arrival effect last tracked.
 *
 * WHY THIS IS A FUNCTION, NOT THREE LINES IN AN EFFECT. The scroller does not
 * exist on every render: a cold open, an error and the no-config state all
 * return a different tree, so the page binds this when the element MOUNTS and
 * rebinds when it is replaced (round 1: M2). Taking the element as an argument
 * is what makes that rebind testable without a renderer.
 *
 * Returns the unbind, the shape React's effect cleanup wants.
 */
export function bindTabScrollMemory(
	scroller: Pick<
		HTMLElement,
		"addEventListener" | "removeEventListener" | "scrollTop"
	>,
	memory: TabScrollMemory,
): () => void {
	const onScroll = () => memory.record(scroller.scrollTop);
	scroller.addEventListener("scroll", onScroll, { passive: true });
	return () => scroller.removeEventListener("scroll", onScroll);
}

/**
 * The tab whose panel contains `element`, or null when it is outside every
 * panel (the page header, the search field).
 *
 * This is how a search jump learns that its row is in a panel that is currently
 * hidden — the row is in the DOM either way, because every panel stays mounted
 * so Cmd/Ctrl+F can read it.
 */
export function settingsPanelOf(element: Element | null): string | null {
	if (element === null) return null;
	const panel = element.closest("[data-settings-panel]");
	return panel?.getAttribute("data-settings-panel") ?? null;
}

/**
 * The run's last tab, for a bare `/settings`.
 *
 * Module state, not storage: it is a within-run convenience (the same lifetime
 * as the return target PR1 keeps), and a cold start is General. Deliberately
 * NOT written on every render — the page writes it from its one arrival effect,
 * only when the URL was not overruled, so a stale link cannot become the memory.
 */
let rememberedTab: string | null = null;

export function rememberSettingsTab(tab: string): void {
	rememberedTab = tab;
}

export function lastSettingsTab(): string | null {
	return rememberedTab;
}

/**
 * Whether a rail activation came from the KEYBOARD.
 *
 * A click's `detail` is the click count: a pointer press reports 1 or more, and
 * a keyboard activation (Enter/Space on the focused row, or `element.click()`)
 * reports 0. The rail uses it to decide whether the reader needs their focus
 * MOVED into the panel they just chose: a keyboard reader is standing on a
 * button whose destination is now on screen behind 13 other rows, so they are
 * taken to the panel's named region; a pointer reader's focus is already where
 * their hand is, and moving it would only take the row's own focus ring away.
 */
export function keyboardActivation(detail: number): boolean {
	return detail === 0;
}

/**
 * What a pending PANEL-focus request becomes when a tab arrives.
 *
 * `focus` when the arriving tab is the one the request named; `drop` when it is
 * not — the request is spent on the next arrival either way, so a press whose
 * navigation was superseded cannot be satisfied by a LATER arrival (the
 * casualty would be a search jump's own row focus). `none` when nothing asked.
 */
export function settlePanelFocusRequest(
	pending: string | null,
	arrived: string,
): "focus" | "drop" | "none" {
	if (pending === null) return "none";
	return pending === arrived ? "focus" : "drop";
}

/**
 * The tab a visit opens on: the run's last tab, read ONCE at mount.
 *
 * This is a named function rather than a call to `lastSettingsTab()` inside the
 * hook for one reason: the mount semantics are the fix (round 1: M1), and a
 * named read is what the replay test can call without mounting React. The hook
 * passes it to `useState`'s initializer, so it runs once per mount; resolving
 * the URL is a separate step and never re-reads the memory.
 */
export function mountSeed(): string | null {
	return lastSettingsTab();
}

/** Test seam: forget the run's tab (each case starts cold). */
export function resetSettingsTabMemory(): void {
	rememberedTab = null;
}
