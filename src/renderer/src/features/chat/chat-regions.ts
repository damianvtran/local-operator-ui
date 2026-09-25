/**
 * The chat surface's four regions, and the key that walks between them
 * (spec §C4; UX-BASELINE U2 and U6).
 *
 * WHAT WAS WRONG. U6 measured the tab order as transcript → composer → rail →
 * list → header with roughly forty stops *inside the list alone*, and U2's walk
 * on this branch counted ~70 presses to reach the top row from a cold start.
 * Two causes, and this module is the first: nothing in the shell had a readable
 * region ORDER, so `F6` — the platform's own region-walk key — did nothing, and
 * the only way from one end of the surface to the other was to press Tab through
 * everything between. The second cause is the list's tab stop count and it is
 * fixed where it lives (`chat-sidebar.tsx`'s roving tabindex).
 *
 * WHY THE ORDER IS A CONSTANT HERE rather than `document.querySelectorAll` over
 * the region roots at press time. The four roots are not siblings: the sidebar is
 * mounted by the shell (`chat-layout.tsx`), the other three by the route
 * (`chat-page.tsx`), and a walk derived from DOM order would depend on which of
 * those two trees happened to render first — which is exactly the kind of
 * agreement a future layout change breaks silently. The reading order the spec
 * states is a property of the SURFACE, so it is declared once and the roots are
 * looked up by it.
 *
 * WHY `sidebar` IS `nav[aria-label="Chats"]` AND NOT "the chats list": §C4's
 * order is `nav`, `header`, `main` (the transcript), `form` (the composer), and
 * the destinations, the search field and the foot are all inside that first
 * region — they are the sidebar's own stops, not a fifth region.
 */

/** The marker a region root carries. One attribute, so a walk is one query. */
export const CHAT_REGION_ATTR = "data-chat-region";

/**
 * The marker on the element INSIDE a region that takes focus when the region is
 * entered by the key below.
 *
 * Deliberately not "the first focusable descendant": in the sidebar the first
 * focusable element is the search field, and in the list the region's own entry
 * point is the row the reader was last on. Each region names its own door.
 */
export const CHAT_REGION_ENTRY_ATTR = "data-region-entry";

export const CHAT_REGION_SELECTOR = `[${CHAT_REGION_ATTR}]`;
const CHAT_REGION_ENTRY_SELECTOR = `[${CHAT_REGION_ENTRY_ATTR}]`;

/**
 * The four regions, in reading order.
 *
 * The names are the spec's own (`§C4`), and they are what the walk reads back:
 * a reader who presses `F6` moves `sidebar` → `header` → `transcript` →
 * `composer` → `sidebar`.
 */
export const CHAT_REGIONS = [
	"sidebar",
	"header",
	"transcript",
	"composer",
] as const;

export type ChatRegion = (typeof CHAT_REGIONS)[number];

/**
 * The accessible name each region carries, where the region does not already
 * own one. §C4 names three: `Chats` (the sidebar's existing `nav` label),
 * `Conversation` (the transcript's `role="log"`), `Message composer` (the
 * composer's `form`). The top row is a `header` landmark, which takes its name
 * from the section it heads; there is nothing honest to add to it, and a
 * landmark named by nothing is still reachable by `F6`.
 */
export const CHAT_REGION_LABEL: Record<ChatRegion, string> = {
	sidebar: "Chats",
	header: "Conversation",
	transcript: "Conversation",
	composer: "Message composer",
};

/** One step of the walk: forward, or back. */
export type ChatRegionStep = 1 | -1;

/**
 * The region-walk press, as a predicate.
 *
 * `F6` is the platform convention (Windows' region cycle, and the key screen
 * readers bind to the same walk); `⌘⌥↓` is §C4's second spelling, because on
 * macOS `F6` is a media key on most keyboards unless the user has turned that
 * off. `⌘⌥↑` is the reverse of that pair and `Shift+F6` the reverse of the
 * other, so a reader who learns either chord can walk in both directions.
 *
 * A press is refused while a modifier other than those is held: `⌘F6` and
 * `Ctrl+Shift+F6` are somebody else's chords, and answering them here would
 * take them away without the other binding ever being written.
 */
export const chatRegionStep = (event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): ChatRegionStep | null => {
	if (event.key === "F6") {
		// `⌘F6`/`Ctrl+F6` are the OS's own display mode and similar; only a bare
		// `F6` and its shifted reverse belong to this walk.
		if (event.metaKey || event.ctrlKey || event.altKey) return null;
		return event.shiftKey ? -1 : 1;
	}
	if (!event.altKey || !(event.metaKey || event.ctrlKey)) return null;
	if (event.shiftKey) return null;
	if (event.key === "ArrowDown") return 1;
	if (event.key === "ArrowUp") return -1;
	return null;
};

/**
 * The region a node sits in, or null when it sits outside all four.
 *
 * `closest` rather than a parent walk, so the answer is about the node's
 * ancestry and not about how many wrappers a region happens to have today.
 * The attribute is read from the node's own root as well, so the region root
 * itself answers with its own name.
 */
export const chatRegionOf = (node: EventTarget | null): ChatRegion | null => {
	const element = node as {
		closest?: (selector: string) => Element | null;
	} | null;
	if (typeof element?.closest !== "function") return null;
	const root = element.closest(CHAT_REGION_SELECTOR);
	const name = root?.getAttribute(CHAT_REGION_ATTR);
	return name !== null && name !== undefined && isChatRegion(name)
		? name
		: null;
};

/** Narrowing helper, so a hand-edited attribute cannot widen the union. */
export const isChatRegion = (value: string): value is ChatRegion =>
	(CHAT_REGIONS as readonly string[]).includes(value);

/**
 * The next region that is actually mounted, in reading order, wrapping once.
 *
 * `null` means the surface has no regions at all — every route but the chat
 * one, and the moment before the first render commits. The walk is over the
 * regions PRESENT rather than over the constant's order alone, so a route that
 * renders the sidebar and nothing else still answers `F6` with something
 * instead of a no-op.
 */
export const nextChatRegion = (
	root: ParentNode,
	from: ChatRegion | null,
	step: ChatRegionStep,
): ChatRegion | null => {
	const present = CHAT_REGIONS.filter(
		(region) => root.querySelector(regionSelector(region)) !== null,
	);
	if (present.length === 0) return null;
	if (from === null)
		return step === 1 ? present[0] : present[present.length - 1];
	/*
	 * BY THE CONSTANT'S ORDER, not by the order the query returned: the walk is
	 * reading order, and a region mounted before another in the DOM but read
	 * after it in §C4 must still be walked in §C4's order.
	 */
	const at = CHAT_REGIONS.indexOf(from);
	for (let offset = 1; offset <= CHAT_REGIONS.length; offset += 1) {
		const candidate =
			CHAT_REGIONS[
				(at + step * offset + 4 * CHAT_REGIONS.length) % CHAT_REGIONS.length
			];
		if (present.includes(candidate)) return candidate;
	}
	return present[0];
};

/**
 * Put focus in a region: its own door when it named one, the region root
 * otherwise.
 *
 * The root is made focusable by its own `tabIndex={-1}` rather than by this
 * call, because a `focus()` on an element with no tab index and no contenteditable
 * is a silent no-op — and a region walk that silently does nothing on one of its
 * four stops is worse than no walk.
 *
 * NO `preventScroll`. Entering the transcript is a request to read it, and the
 * scroller bringing its entry point into view is the gesture working, not the
 * view jumping: `preventScroll` is what the sidebar's row-hand-back needs (it is
 * already on screen and the correction owns the scroll position), and it is
 * exactly wrong here.
 */
export const enterChatRegion = (
	root: ParentNode,
	region: ChatRegion,
): HTMLElement | null => {
	const regionRoot = root.querySelector<HTMLElement>(regionSelector(region));
	if (regionRoot === null) return null;
	const entry = regionRoot.querySelector<HTMLElement>(
		CHAT_REGION_ENTRY_SELECTOR,
	);
	const target = entry ?? regionRoot;
	target.focus();
	return target;
};

const regionSelector = (region: ChatRegion): string =>
	`[${CHAT_REGION_ATTR}="${region}"]`;

/**
 * The two acts a conversation row offers beside itself, as a chord (§C4, U2).
 *
 * WHY THEY NEED ONE. Both controls used to be revealed by `group-focus-within`
 * and were therefore Tab stops — that reveal was the whole reason they were
 * reachable without a pointer. Capping the list at ONE Tab stop per row takes
 * those stops away, so removing the stops without a chord would trade a
 * stop-count for an accessibility regression: the controls would be drawn for a
 * keyboard reader and unreachable by one. §C4's answer is "hover **or** a
 * chord", and this is the chord.
 *
 * WHY A MODIFIED CHORD AND NOT A BARE LETTER. The list's own `keyDown` treats a
 * printable key pressed on a row as type-to-filter (the field is not drawn at
 * rest, so typing is how a keyboard reader reaches it). A bare `p` or `a` would
 * therefore open the filter with a character in it instead of pinning, and the
 * two gestures cannot share one press. A modified key is somebody's chord, not
 * a character, and passes through that branch untouched.
 */
export type ChatRowAct = "pin" | "archive";

export const chatRowAct = (event: {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}): ChatRowAct | null => {
	if (!(event.metaKey || event.ctrlKey)) return null;
	if (!event.shiftKey || event.altKey) return null;
	// `toLowerCase` for the reason `isSidebarTogglePress` states: a
	// meta-modified press arrives as the character the layout produced, and some
	// layouts do not separate the shifted spelling.
	const key = event.key.toLowerCase();
	if (key === "p") return "pin";
	if (key === "a") return "archive";
	return null;
};

/**
 * `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere — one spelling, so the cap a row
 * prints and the handler that answers it cannot drift.
 */
export const chatRowActCap = (act: ChatRowAct, isMac: boolean): string => {
	const key = act === "pin" ? "P" : "A";
	return isMac ? `⌘⇧${key}` : `Ctrl+Shift+${key}`;
};

/** The attribute each row act's control carries, so the chord can find it. */
export const CHAT_ROW_ACT_ATTR: Record<ChatRowAct, string> = {
	pin: "data-session-pin",
	archive: "data-session-archive",
};

/**
 * The control a row act's chord should press, or null when the row does not
 * offer it.
 *
 * The row's acts are SIBLINGS of the row's own button (a nested button is
 * invalid HTML and unfocusable), so the search starts at the row's box rather
 * than at the button the press landed on. `[data-session-row]` is that box, and
 * it is the same anchor the pin's own move-correction uses.
 */
export const chatRowActControl = (
	target: EventTarget | null,
	act: ChatRowAct,
): HTMLElement | null => {
	const element = target as {
		closest?: (selector: string) => Element | null;
	} | null;
	if (typeof element?.closest !== "function") return null;
	const row = element.closest("[data-session-row]");
	return row?.querySelector<HTMLElement>(`[${CHAT_ROW_ACT_ATTR[act]}]`) ?? null;
};
