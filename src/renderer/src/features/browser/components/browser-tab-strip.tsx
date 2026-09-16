import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Bot,
	Check,
	ChevronDown,
	ChevronUp,
	Globe,
	MessagesSquare,
	MoreHorizontal,
	Plus,
	RotateCw,
	X,
} from "lucide-react";
import type { FC } from "react";
import {
	Fragment,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { BrowserTabView } from "../hooks/use-browser-chrome";
import {
	groupTabsBySession,
	sessionDisplayName,
} from "../model/tab-index-model";

/**
 * The tab strip. Design: docs/design/ui-browser-tab.md 6.1 (the controls), 6.2
 * (one strip, two actors), 6.3 (hand-over), 6.5 (caps), 11.2 (branding roles);
 * docs/design/browser-approval-ux.md 6 (the grammar), 5.2 (the `Waiting n` chip),
 * 8.3 (why the actions are in the band and why a background tab shows a spinner).
 *
 * ONE STRIP FOR TWO ACTORS. A user tab and an agent tab sit in the same list, in
 * creation order, because the user's question is "what is open" rather than
 * "what did I open" — and the difference is carried by a MARKER, not by a second
 * strip. The marker is the design's `(yours)` analogue from the tool's own tab
 * listing: an agent tab carries the session's glyph and an accent-tinted label,
 * which is the one piece of information the user needs to tell "the agent opened
 * this" from "I opened this".
 *
 * WHAT THE MARKER IS NOT: it is not a lock and not a permission. Every tab in
 * the strip is the user's — they can click it, navigate it, and close it
 * (design 11.8), and an agent tab's marker says who is ALSO using it.
 *
 * THE GRAMMAR (spec §6), and why the operator read the old strip as buttons:
 * it WAS buttons — one row of `rounded-sm` cells with a `surface` fill and a
 * transparent edge each. A browser tab is not a button; it is a sheet of paper
 * standing in a well, continuous with the page it belongs to. So:
 *
 * | Element | Now |
 * |---|---|
 * | inactive tab | no fill at all: a title in the well, separated from its neighbour by a 1px `hairline` |
 * | hover | the `elevated` colour step and `ink`, and nothing lifts, scales or translates (`branding.md`) |
 * | active tab | the PAGE's own ground (`canvas`), `border-x border-t border-control`, no bottom edge, `rounded-t-sm` |
 * | the notch | a 1px `canvas` span painted across the active tab's bottom edge, so the strip's own rule continues everywhere except under it |
 *
 * Removing the inactive fill loses no information — the titles and the dividers
 * identify them (the `branding.md` "would removing it lose anything" test), so the
 * fill comes off rather than being promoted to a second ground. `border-control`
 * on the active tab's three edges is what makes it survive a glance; the ground
 * step alone measures 1.11:1 in the dark palettes (design round 3, D18) and a
 * depth cue is not a marker.
 *
 * WHY THE ROW ACTIONS EXPAND INSIDE THE BAND (spec §6). They used to be a Radix
 * dropdown anchored at the strip's bottom edge, painting DOWNWARD into the content
 * rect — where the native view occludes it, because menus in the band are
 * deliberately not registered (`browser-view-policy.ts:32-39`) and no z-index
 * beats a native sibling view. The row's actions now expand in the band itself:
 * the strip grows ~28px, the page shrinks by the same 28px, and nothing is hidden.
 *
 * WHY THE SPINNER IS A PER-TAB FACT (spec §8.3). The gate was `loading &&
 * tab.active`, and `loading` was the ACTIVE tab's state, so a background agent tab
 * loading a page showed nothing at all. That is half of what the operator reported
 * as "I approved a bunch of agents but I don't actually see any navigation or work":
 * an agent tab is created non-active and only the active tab occupies the content
 * rectangle (`registry.ts:492-503`), so the strip is the only place an agent's
 * work can be legible at all. The projection now carries `loading` per tab
 * (`host.ts`'s `tabLoading`), which is what this gate reads.
 *
 * AND WHAT IT MUST NOT DO: activate the tab. `registry.ts:215-219` and design
 * 11.4 forbid an agent `open` switching what the user is looking at, and a
 * "follow the agent" mode would be that switch with a different name. Legibility
 * plus a user click — `Watch this tab` below — is the whole fix (§8.3).
 */

export interface BrowserTabStripProps {
	tabs: BrowserTabView[];
	/** The conversation list, for a group chip's name.
	 *
	 * PASSED IN RATHER THAN READ HERE, the same choice the hand-over dialog and the
	 * consent card make: the grid renders a projection and leaves store reads to the
	 * host that owns the layout, and the strip has three hosts to serve. An empty
	 * list is a real state (a route with no conversations loaded) and degrades to
	 * `sessionDisplayName`'s own fallback — the session id — rather than to a blank
	 * label. */
	sessions?: ReadonlyArray<{ session_id: string; title?: string | null }>;
	activeTabId: number | null;
	/** tabId -> the ordinal of the live approval request its origin is parked on.
	 * Built from the same numbered rows as the tray (`approval-queue-model.ts`), so
	 * `Waiting 2` here and chip [2] there are the same request by construction
	 * (§5.2). */
	waiting: Record<number, number>;
	onActivate: (tabId: number) => void;
	onClose: (tabId: number) => void;
	onNewTab: () => void;
	/** What the `+` calls itself. The host's own sentence, because only the host
	 * knows whether a tab opened here is attributed to a conversation (design R1):
	 * a `+` labelled `New tab` in both hosts would leave the difference to be
	 * discovered by switching the scope and finding the tab gone. Defaulted so a
	 * story or a test that does not care passes nothing. */
	newTabLabel?: string;
	onHandOver: (tab: BrowserTabView) => void;
	onRevokeHandOver: (tabId: number) => void;
}

/** The favicon-equivalent: a per-tab state glyph at 16px.
 *
 * The design's "favicon-equivalent state" (6.1) rather than a real favicon. The
 * host publishes no icon — the driven pages are sandboxed and the app does not
 * fetch favicons — so a glyph that means something is the honest substitute: a
 * spinner while THIS tab loads, a session mark on an agent tab, a page glyph
 * otherwise. Inventing a favicon fetcher would be a network path this feature has
 * no other use for.
 *
 * The loading gate is per TAB and that is the §8.3 fix: it used to be
 * `loading && tab.active`, where `loading` was the active tab's state, so a
 * background tab that was loading showed no spinner — including an agent's, which
 * is the only signal a parked tab can give. */
const TabMark: FC<{ tab: BrowserTabView }> = ({ tab }) => {
	if (tab.loading) {
		return (
			<RotateCw
				aria-hidden
				data-tour-tag="browser-tab-spinner"
				className="size-4 shrink-0 animate-spin text-ink-muted"
			/>
		);
	}
	if (tab.owner === "agent") {
		return <Bot aria-hidden className="size-4 shrink-0 text-accent" />;
	}
	return <Globe aria-hidden className="size-4 shrink-0 text-ink-dim" />;
};

/** A tab's name for a button label: short enough to sit in a row of actions
 * without wrapping, long enough to identify the tab when two of them are alike
 * (design round 2, D4 — "Watch 'Reports'", not "Watch this tab"). */
const tabLabel = (title: string): string => {
	const trimmed = title.trim();
	if (!trimmed) return "this tab";
	return trimmed.length <= 24
		? trimmed
		: `${trimmed.slice(0, 23).trimEnd()}\u2026`;
};

/**
 * The state chips a row can carry, IN SURVIVAL ORDER — the order the cap spends.
 *
 * WHY THE ORDER IS THIS ONE, most load-bearing first (design R4, fix 1; open
 * question 9):
 *
 * 1. `Request n` is an ASK, and its number is the tie to the tray's chip and the
 *    dock's row (§5.2) — dropping it hides the one chip that asks the user for
 *    something.
 * 2. `Agent` is the only thing that distinguishes an agent tab from the user's own,
 *    and QA asserts on it.
 * 3. `Failed` is a background tab's only signal: a refused main-frame load leaves
 *    Chromium's blank surface in the view, so without the chip there is nothing on
 *    screen that says the tab failed.
 * 4. `Shared` is implied by `Agent` today (`registry.ts:369-372` sets `owner` and
 *    `handedTo` together), so it is real information at the lowest value of the four.
 * 5. `Restored` is useful once — "why am I signed out" — and recoverable from the
 *    tab's own tooltip, so it yields first.
 */
const CHIP_PRIORITY = [
	"request",
	"agent",
	"failed",
	"shared",
	"restored",
] as const;

type StateChip = (typeof CHIP_PRIORITY)[number];

/** Each chip's own word, for the collapsed chip's tooltip and for the sentence
 * assistive technology reads. The same words the chips render. */
const CHIP_WORD: Record<StateChip, string> = {
	request: "Request",
	agent: "Agent",
	failed: "Failed",
	shared: "Shared",
	restored: "Restored",
};

/**
 * HOW MANY STATE CHIPS A ROW SHOWS BEFORE IT COLLAPSES THE REST.
 *
 * WHY A CAP AT ALL (design R4, fix 1). The width policy pays the strips's floors
 * from a budget: `title = floor − 32 − chips − 6 x (pills + 1)`, and five chips are
 * 244px of a 384px floor, which leaves the title 72px — the committed `worst-case`
 * frame reads `Check...`. The two ways out were rejected: paying the floors at five
 * chips needs a 465px floor (one pathological row taking that much scroll order
 * ahead of every ordinary tab), and dropping a chip hides a state the design round
 * approved. So the row keeps the three that matter most and says how many it hid.
 *
 * THREE, because that is the count at which the floor arithmetic clears the 85px
 * this file promises at every reachable row (the invariant is asserted in
 * `scripts/browser-chrome.test.mjs`, not asserted here).
 */
const MAX_INLINE_CHIPS = 3;

/**
 * Which chips a row shows and which it collapses.
 *
 * A `Set` rather than the surviving array, because the only thing the render needs
 * is "does this chip appear" — and the chips render in the strip's own long-standing
 * order (marker, then state) rather than in survival order, which is a separate
 * decision the design round made and this cap does not touch.
 */
export function stateChips(
	tab: BrowserTabView,
	waitingOrdinal: number | undefined,
): { shown: Set<StateChip>; collapsed: StateChip[] } {
	const present = {
		request: waitingOrdinal !== undefined,
		agent: tab.owner === "agent",
		failed: tab.failed,
		shared: tab.handedOver,
		restored: tab.restored,
	};
	const ordered = CHIP_PRIORITY.filter((chip) => present[chip]);
	return {
		shown: new Set(ordered.slice(0, MAX_INLINE_CHIPS)),
		collapsed: ordered.slice(MAX_INLINE_CHIPS),
	};
}

/**
 * The floor rung for a row: the Tailwind width classes, per tier.
 *
 * EXTRACTED AS A FUNCTION RATHER THAN INLINED IN THE ROW so the invariant behind it
 * can be TESTED rather than read (design R4: "the invariant is a pure function and
 * belongs in `browser-chrome.test.mjs`"). The test takes this function's own answer,
 * maps each tier's token to the pixel width the spacing scale gives it, and asserts
 * the title each rung leaves - so a rung edited without redoing the arithmetic fails
 * the test rather than a frame.
 *
 * THE TIERS ARE RANGES, not two stacked `max-` variants: the narrow one is
 * everything under 672px (42rem), the middle one 672..1152, and the bare `min-w-*`
 * takes the rest. They are read in that order by `@container/strip` on the strip's
 * ROW - not on the scroller, whose width changes when the pinned control appears,
 * which is the feedback loop that once made the strip oscillate (see the scroller's
 * own note).
 */
export function tabFloor(active: boolean, pills: number): string {
	if (active) {
		if (pills >= 4) return "min-w-[26rem] @max-2xl:min-w-62";
		if (pills === 3) return "min-w-96 @max-2xl:min-w-56";
		if (pills === 2) return "min-w-96 @2xl:@max-6xl:min-w-80 @max-2xl:min-w-50";
		if (pills === 1) return "min-w-80 @2xl:@max-6xl:min-w-72 @max-2xl:min-w-33";
		return "min-w-56 @max-2xl:min-w-30";
	}
	if (pills >= 4) return "min-w-96 @max-2xl:min-w-62";
	if (pills === 3) return "min-w-80 @max-2xl:min-w-56";
	if (pills === 2) return "min-w-72 @2xl:@max-6xl:min-w-60 @max-2xl:min-w-50";
	if (pills === 1) return "min-w-56 @2xl:@max-6xl:min-w-48 @max-2xl:min-w-33";
	return "min-w-44 @2xl:@max-6xl:min-w-36 @max-2xl:min-w-30";
}

/**
 * Reveal-on-hover-or-focus, the treatment a row's chrome gets when the strip has
 * no room to keep it in flow. Literal class names rather than a template string,
 * because Tailwind's scanner reads the source text.
 */
const REVEAL_ON_HOVER_OR_FOCUS =
	"opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto";

/**
 * The same treatment, applied only while the strip is narrow, for the chrome that a
 * WIDE strip keeps permanent (the active row's cluster, below `@max-2xl`).
 *
 * It exists as its own constant because the two are not interchangeable: the first
 * is unconditional, and the second has to lose to `opacity-100` above the tier while
 * beating it inside. `@max-2xl:` is a container variant, so it is emitted after the
 * unvariant utility and wins inside the tier - the same rule the floors above rely
 * on, and half the reason a tier is a RANGE rather than two stacked `max-` variants.
 */
const NARROW_REVEAL =
	"@max-2xl:opacity-0 @max-2xl:pointer-events-none @max-2xl:group-hover:opacity-100 @max-2xl:group-hover:pointer-events-auto @max-2xl:group-focus-within:opacity-100 @max-2xl:group-focus-within:pointer-events-auto";

export const BrowserTabStrip: FC<BrowserTabStripProps> = ({
	tabs,
	sessions = [],
	activeTabId,
	waiting,
	newTabLabel = "New tab",
	onActivate,
	onClose,
	onNewTab,
	onHandOver,
	onRevokeHandOver,
}) => {
	/** Which tab's actions are expanded in the band, if any. Local view state: the
	 * expansion is not a fact about a tab, and main has no opinion about it. */
	const [actionsTabId, setActionsTabId] = useState<number | null>(null);
	const scrollerRef = useRef<HTMLDivElement | null>(null);

	/** One ref per tab's actions trigger, so dismissing the row can hand focus back
	 * to the tab it belonged to (UX round 2, U9: both dismissal paths unmount the
	 * element that had focus, which dropped the keyboard user to `<body>` and out of
	 * the strip). A ref map rather than a `querySelector`: this component never hunts
	 * the document for its own controls. */
	const menuRefs = useRef(new Map<number, HTMLButtonElement | null>());

	const closeActions = useCallback((): void => {
		const owner = actionsTabId;
		setActionsTabId(null);
		if (owner !== null) menuRefs.current.get(owner)?.focus();
	}, [actionsTabId]);

	/** The row's own element, so opening it can move focus INTO it (design round 2,
	 * D4 / the UX round's U4): the row lives after the scroller in DOM order, and
	 * without this the first Tab after opening landed on the neighbouring tab's
	 * Close button. */
	const actionsRowRef = useRef<HTMLDivElement | null>(null);

	// A tab that is closed, or that stops existing, must not leave an action row
	// pointing at nothing.
	const actionsTab = tabs.find((tab) => tab.tabId === actionsTabId) ?? null;

	useEffect(() => {
		if (actionsTabId === null) return;
		// Keyed on the ID rather than on the tab object, because `tabs.find` returns a
		// fresh object on every render: an object dependency re-ran this on every
		// keystroke elsewhere in the surface and took focus with it (measured - the
		// focused element after an unrelated click in the dock was this row).
		actionsRowRef.current?.focus();
	}, [actionsTabId]);

	// The activated tab scrolls into view (spec §6's last row). With the width
	// policy kept, a long strip scrolls, and a tab activated from the dock or by an
	// attention click must become visible or the click looks inert. `inline:
	// "nearest"` so a tab already on screen does not move at all.
	useEffect(() => {
		if (activeTabId === null) return;
		const element = scrollerRef.current?.querySelector(
			`[data-tab-id="${activeTabId}"]`,
		);
		element?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeTabId]);

	/*
	 * HOW MANY TABS ARE NOT FULLY VISIBLE, which is what the pinned control is FOR.
	 *
	 * QA round 1 (Q2) drove the control where nothing overflows - the route's 1160px
	 * strip with six tabs, `overflows: false` - and found it drawn anyway, with an
	 * empty own text and its `aria-label` reading `All tabs`: a control whose
	 * PRESENCE said nothing, so a user could not read overflow, or its absence, from
	 * it. It was gated on `tabs.length > 1`.
	 *
	 * The fix is a COUNT rather than a tint or a chevron, and the count is measured
	 * here rather than derived from `scrollWidth - clientWidth` because the two say
	 * different things: overflow says "there is more to scroll to", and what a user
	 * needs to know is "how many tabs am I not seeing". The number also decides the
	 * control's presence, so a strip that fits carries no control at all - the
	 * honest signal, since a control that is always there is a control that says
	 * nothing.
	 *
	 * The measure is the canvas strip's (`canvas-tabs.tsx`): on mount, on scroll and
	 * on resize, keyed on `tabs` because opening or closing a tab changes the
	 * scrollable width without resizing the strip. 1px of slack because a row that
	 * is flush with the scroller's edge is visible, and the boxes are rounded
	 * independently. A tab lying HALF outside counts as not shown, which is the
	 * case the count exists for.
	 */
	const [tabsOffScreen, setTabsOffScreen] = useState(0);
	/*
	 * THE POOL, GROUPED BY CONVERSATION, AND THE ONE PLACE THE RENDERED ORDER IS
	 * DECIDED (design R3).
	 *
	 * Grouping is a PRESENTATION of the pool, so it lives here rather than in the
	 * registry: `registry.snapshot()` sorts by `tabId` and the host-proof harnesses
	 * assert on `state.tabs[0]`, so the registry's order is left exactly where it is.
	 *
	 * WHY BLOCKS RATHER THAN CONTIGUOUS RUNS, and why the unattributed run is LAST:
	 * `groupTabsBySession`'s own doc carries both arguments. The one thing worth
	 * repeating here is the constraint this component imposes on the rule - a
	 * hand-over can move a tab between groups, and the `Shared` chip on the moved tab
	 * is what announces it.
	 *
	 * THE ORDER IS DECIDED ONCE. `ordered` is the grouping flattened rather than a
	 * second pass with its own comparison, so "the order shown" and "the order the
	 * groups are in" cannot drift; and `groupLeads` gives the row loop the four
	 * things a chip needs without turning the loop into nested maps, which keeps the
	 * per-row measurement, the divider rule and the tab-id lookup below untouched.
	 */
	const groups = useMemo(() => groupTabsBySession(tabs), [tabs]);
	const ordered = useMemo(
		() => groups.flatMap((group) => group.tabs),
		[groups],
	);
	const groupLeads = useMemo(() => {
		const leads = new Map<
			number,
			{ sessionId: string | null; count: number }
		>();
		for (const group of groups) {
			const first = group.tabs[0];
			if (first)
				leads.set(first.tabId, {
					sessionId: group.sessionId,
					count: group.tabs.length,
				});
		}
		return leads;
	}, [groups]);
	/**
	 * A chip is rendered only when the pool holds MORE THAN ONE conversation, and
	 * that is what keeps every existing surface visually unchanged: the pane's own
	 * scope is a single group by construction, so its strip carries no labels at all
	 * (design R3). A pool of two conversations gets the labels because there the
	 * labels are the only thing that says which tab is whose.
	 */
	const showGroupLabels = groups.length > 1;
	// biome-ignore lint/correctness/useExhaustiveDependencies: opening or closing a tab changes the strip's scrollable width without resizing the strip itself, so the measurement has to re-run when the ordered pool changes even though the body never reads it.
	useEffect(() => {
		const strip = scrollerRef.current;
		if (!strip) return;

		const measure = () => {
			const view = strip.getBoundingClientRect();
			let offScreen = 0;
			for (const row of strip.querySelectorAll("[data-tab-id]")) {
				const box = row.getBoundingClientRect();
				if (box.left < view.left - 1 || box.right > view.right + 1)
					offScreen += 1;
			}
			setTabsOffScreen(offScreen);
		};

		measure();
		strip.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(strip);

		return () => {
			strip.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [ordered]);

	return (
		<div
			// `border-control`, not `hairline`: this is the strip's only boundary
			// against the page area, so it is structural and carries a 3:1 floor
			// (design 11.2). It is also the rule the active tab's notch interrupts.
			className="flex flex-col border-control border-b bg-sunken"
			role="tablist"
			aria-label="Browser tabs"
			data-tour-tag="browser-tab-strip"
		>
			{/* `pt-1` and no bottom padding: the tabs sit flush on the strip's own
			    rule, which is what lets the active tab interrupt it. */}
			{/* THE STRIP'S HEIGHT IS STABLE ACROSS THE EMPTY AND POPULATED CASES
			    (design round 2, D9). The row's height comes from the tabs in it, so with
			    none the container collapsed to its own `pt-1` — measured in the app as 5px
			    against 37px with one tab — and the page below stepped 32px in position AND
			    in height the moment a tab appeared, which reads as the pane re-laying
			    itself out for no reason.

			    A MINIMUM rather than a fixed height, and the distinction is load-bearing:
			    in the populated case the content is already taller than this floor, so
			    nothing stretches, the rows keep their natural box, and the active tab's
			    notch (1px at `-bottom-px`, which depends on the row's own bottom edge)
			    paints exactly where it did. Pinned with `h-9` instead, the rows would be
			    stretched into a box 1px short of the notch and the notch would be clipped:
			    that is how a fixed height here failed the proof harness on an earlier
			    round, and why the floor is what stayed.

			    The remaining step is at most 1px, stated rather than hidden: the floor is
			    a spacing step and the content's height is font-dependent, so the two agree
			    to within a pixel rather than exactly. */}
			<div
				className={cn(
					"@container/strip flex min-h-9 items-stretch gap-0 px-2 pt-1",
				)}
				data-tour-tag="browser-tab-strip-row"
			>
				<div
					ref={scrollerRef}
					// `-mb-px` extends the scroll container's clip box 1px down, over the
					// strip's bottom rule, so the active tab's notch can paint ON that rule
					// rather than being clipped by the scroll container one pixel above it.
					//
					// `@container/strip` is declared on the ROW THAT HOLDS THE WHOLE STRIP —
					// this scroller, the pinned control and the new-tab button — and the
					// placement is load-bearing rather than tidy (measured, then re-measured):
					// on the scroller, the container's width DROPS by the control's own width
					// the moment the control appears, so the tier the floors read depended on
					// the control the floors decide — four tabs fitted at the narrow tier,
					// overflowed again at the middle one, and the strip oscillated between
					// them, which is how a frame came back with a `+2` control over a strip
					// whose four rows did fit. The container is now the one box whose width
					// the control cannot change, so the tiers are a function of the room the
					// STRIP has and the count below is a function of the room the ROWS have.
					//
					// That is also why the narrow tier starts at 672px rather than 576: the
					// container now includes the control's space, so the pane's own 640 strip
					// is 640 here where it measured 567 before.
					className={cn(
						"flex min-w-0 grow items-stretch overflow-x-auto overflow-y-hidden -mb-px",
					)}
				>
					{ordered.map((tab, index) => {
						const active = tab.tabId === activeTabId;
						const waitingOrdinal = waiting[tab.tabId];
						/*
						 * THE ROW'S PILLS, AND THE CAP THAT BOUNDS THEM (design R4, fix 1).
						 *
						 * `stateChips` (module scope) is the one place the cap is applied: at most
						 * THREE state chips are drawn inline, in survival order, and the rest
						 * collapse into one `+n` chip. So a row carries 0-4 pills, and that bound is
						 * what lets the ladder below be a short one.
						 *
						 * WHY A CAP RATHER THAN A BIGGER FLOOR, and the choice was made from this
						 * file's own committed evidence: five chips are 244px, and at the 384px floor
						 * that leaves the title 72px - the `worst-case` frame reads `Check...`. Paying
						 * the floors at five chips needs a 465px floor, which hands one pathological
						 * row (restored, handed over, failed AND waiting, and NOT the tab being read)
						 * that much scroll order ahead of every ordinary tab. Dropping a chip was the
						 * other option and it hides a state the design round approved. A number is the
						 * honest third: nothing is hidden, the count says how much is collapsed on its
						 * face, and the three that survive are the three that carry information.
						 */
						const { shown: shownChips, collapsed: collapsedChips } = stateChips(
							tab,
							waitingOrdinal,
						);
						const pills = shownChips.size + (collapsedChips.length ? 1 : 0);
						/*
						 * THE FLOOR IS SIZED FOR THE PILLS THE ROW ACTUALLY CARRIES, AND FOR THE
						 * CLUSTER THE ACTIVE ONE CARRIES IN FLOW.
						 *
						 * MEASURED PILL WIDTHS (`px-1` pills): Agent 43, Shared 43, Restored 48,
						 * Failed 48, Request n 62, and the collapsed `+n` 36. The widest set at each
						 * reachable count is therefore 0, 62, 105, 153, 189 - the last being three
						 * chips plus the collapse chip, and it is the same 189 whether one state was
						 * collapsed or two, because the collapse is ONE pill whatever it hides.
						 * `px-2` is 16px TOTAL, the mark is 16px, and each of the gaps is 6px, so a
						 * row's title is `floor - 32 - pills - 6 x (pills + 1)` and the active row
						 * pays a further 68px for the cluster in flow plus the gap before it:
						 *
						 *   inactive   0:176->138  1:224->118  2:288->133  3:320->111  4:384->133
						 *   active     0:224->124  1:320->146  2:384->161  3:384->107  4:416->97
						 *
						 * EVERY ROW AT EVERY RUNG OF THE BASE AND MIDDLE TIERS CLEARS THE 85px THIS
						 * FILE PROMISES, and that is the whole point of the cap: before it, the
						 * five-chip inactive row yielded to 72px. The invariant is `title >= 85` at
						 * every reachable count, asserted where a pure function belongs
						 * (`scripts/browser-chrome.test.mjs`) rather than read off a frame.
						 *
						 * THE NARROW TIER MAKES A SMALLER PROMISE AND ALWAYS DID: at the pane's own
						 * width the floors are a step down, the title yields past two pills, and the
						 * button's clip is the backstop - `min-w-30` is 120px, which cannot hold a
						 * mark, a chip and 85px of title at any arithmetic. What the cap owes that
						 * tier is that it never makes a row WORSE, and that is asserted too: the same
						 * rung is kept for the same count and the collapse chip (36px) is narrower
						 * than the two pills it replaces (43 and 48), so every capped row's title
						 * widens.
						 *
						 * THE ACTIVE ROW STILL TAKES ONE STEP PAST THE SPACING SCALE, and it is named
						 * rather than hidden: `min-w-[26rem]` is the only arbitrary length left, for
						 * the widest active row (three chips plus the collapse chip, 97px of title),
						 * because the tab a user clicks BECAUSE it needs approval is exactly that
						 * row. Before the cap there were two such steps (`min-w-[26rem]` and
						 * `min-w-[30rem]`); the cap is what collapsed them into one.
						 *
						 * THE BUTTON STILL CLIPS AT ITS OWN EDGE (review round 6, MAJOR 1), and it
						 * remains a backstop rather than the evidence for these sizes: at the widths
						 * above the widest reachable content is 189 + 32 + 30 = 251px against a 384px
						 * floor, so the clip cannot fire. It is there for a sixth marker or a wider
						 * chip, not as the reason any number here is what it is (review round 6,
						 * MINOR 2).
						 *
						 * PAST TWO PILLS THE MIDDLE TIER INHERITS THE BASE RUNG rather than stepping
						 * down again, and the invariant decides the rung rather than an aesthetic: at the
						 * middle tier's old `min-w-72` a three-pill row had 79px of title, under the promise
						 * this file makes. Two pills at `min-w-60` is exactly 85px, which is where the
						 * ladder stops stepping down.
						 *
						 * Roles rather than computed pixels: the contract's spacing steps are the
						 * vocabulary here, and the one arbitrary length is called out above.
						 */
						const floor = tabFloor(active, pills);
						const previous = index > 0 ? ordered[index - 1] : null;
						/**
						 * The chip this tab leads, when it starts a group and the pool has more than
						 * one conversation. The name is resolved by the ONE rule for it
						 * (`sessionDisplayName`, extracted from `requesterLabel`), so a conversation
						 * reads the same here, in the hand-over dialog and in the consent card; the
						 * unattributed run is the fixed sentence the design names.
						 */
						const group = showGroupLabels
							? groupLeads.get(tab.tabId)
							: undefined;
						const groupLabel = group
							? {
									...group,
									name:
										group.sessionId === null
											? "No conversation"
											: sessionDisplayName(group.sessionId, sessions),
								}
							: null;
						// The divider belongs to the gap between two inactive tabs: the active
						// one is continuous with the page, so no rule may run into it — and a tab
						// that opens a group already has the chip's own rule in front of it, so
						// two rules in a row would read as a heavier boundary than a group's.
						const showDivider =
							previous !== null &&
							!active &&
							previous.tabId !== activeTabId &&
							groupLabel === null;
						return (
							<Fragment key={tab.tabId}>
								{groupLabel && (
									/*
									 * THE GROUP CHIP, INSIDE THE SCROLLER, IMMEDIATELY BEFORE THE RUN IT NAMES.
									 *
									 * INSIDE, and the placement is load-bearing (design R3): the tiers are
									 * measured against `@container/strip` on the strip's ROW, and putting a
									 * label that comes and goes outside the scroller would change that
									 * container's width - which is the documented cause of the historic
									 * oscillation ("four tabs fitted at the narrow tier, overflowed again at
									 * the middle one"). Inside, a label can never move a tier, and it scrolls
									 * with the run it names, which is what makes it read as a heading rather
									 * than as a fixed column. It also means the active tab's reveal brings
									 * its group's label with it for free: the strip already scrolls the active
									 * tab into view, and the chip is the element before it.
									 *
									 * NO FILL, because the grammar here says an inactive tab is TEXT IN THE
									 * WELL (spec 6) and a label is not a control at all: a filled chip beside
									 * unfilled tabs would read as the most important thing in the strip.
									 * The 1px rule after it is the same `bg-hairline` divider the tabs use,
									 * which is what makes the label look like it belongs to the run rather
									 * than to the row.
									 *
									 * THE COUNT IS WHAT LETS THE BULK CLOSE CARRY NO NUMBER (design R5): the
									 * group's size is on screen here, so `Close all tabs in this conversation`
									 * in the band's menu does not have to repeat it.
									 */
									<div
										data-tour-tag="browser-tab-group"
										data-group-id={groupLabel.sessionId ?? ""}
										className="flex shrink-0 items-center gap-1.5 self-stretch"
									>
										<MessagesSquare
											aria-hidden
											className="size-3.5 shrink-0 text-ink-dim"
										/>
										<span
											className="max-w-24 shrink-0 truncate text-meta text-ink-dim"
											title={groupLabel.name}
										>
											{groupLabel.name}
										</span>
										<span className="shrink-0 tabular-nums text-meta text-ink-dim">
											{groupLabel.count}
										</span>
										<span
											aria-hidden
											className="my-2 w-px shrink-0 self-stretch bg-hairline"
										/>
									</div>
								)}
								{showDivider && (
									<span
										aria-hidden
										className="my-2 w-px shrink-0 self-stretch bg-hairline"
									/>
								)}
								<div
									data-tab-id={tab.tabId}
									className={cn(
										/*
										 * THE WIDTH POLICY IS THE TITLE'S (design round 3, D13; widened by a
										 * second design round, D1). Tabs SHARE the row they have (`basis-32`,
										 * `grow`, half the strip at most), and the floor before the row scrolls
										 * is `min-w-44` rather than `min-w-32`: at 128px the title had ~17px of
										 * measure once the mark, the always-held close reserve and the row menu
										 * were inside it, so nine tabs all read `R…` — a strip that cannot name
										 * its tabs is not doing the job the policy exists to protect. The two
										 * chrome buttons also step in on hover/focus now (below), which is what
										 * pays for the wider floor.
										 */
										"group relative flex max-w-[50%] grow basis-32 items-center gap-1.5 px-2 text-body-sm rounded-t-sm",
										floor,
										active
											? "border-control border-x border-t bg-canvas text-ink"
											: "text-ink-muted hover:bg-elevated hover:text-ink",
										// The tab whose actions row is open keeps a visible selected treatment:
										// the row is a band under the whole strip, and the only other tie to its
										// owner was a `:focus-visible` ring, which a mouse click does not paint
										// (design round 2, D4).
										actionsTabId === tab.tabId &&
											!active &&
											"bg-elevated text-ink",
									)}
								>
									<button
										type="button"
										role="tab"
										aria-selected={active}
										onClick={() => onActivate(tab.tabId)}
										/*
										 * THE CLIP IS ON THE BUTTON, NOT ON THE ROW (review round 6, MAJOR 1). It
										 * was on the row for one round, and the row is the notch's containing
										 * block: `overflow: hidden` clips to the padding box, the row has no
										 * bottom padding or border, and the notch sits at `-bottom-px` - so the
										 * row-level clip removed it entirely, on every active tab, in every
										 * theme, and no check noticed. The button holds the overflow-risk
										 * content (mark, chips, title) and is a SIBLING of the notch, so
										 * clipping here keeps the guarantee and leaves the notch painting.
										 */
										className="flex min-w-0 grow items-center gap-1.5 overflow-hidden py-1.5 text-left"
										data-tour-tag="browser-tab"
									>
										<TabMark tab={tab} />
										{shownChips.has("agent") && (
											// Sentence case, informational, and the element a QA pass
											// asserts on: the marker is the ONLY thing that distinguishes
											// an agent tab from a user tab in the strip.
											<span
												className="shrink-0 rounded-sm border border-accent bg-accent-wash px-1 text-meta text-ink"
												data-tour-tag="browser-tab-agent-marker"
											>
												Agent
											</span>
										)}
										{shownChips.has("shared") && (
											// One pill shape for every state marker, differing by role only
											// (design round 2, D11): `Restored` used to be bare dim text with no
											// frame at all, which read as a caption beside the four framed
											// markers rather than as a state.
											<span className="shrink-0 rounded-sm border border-control px-1 text-meta text-ink-muted">
												Shared
											</span>
										)}
										{shownChips.has("restored") && (
											// Restored tabs are worth marking, because a restored tab is a
											// FRESH navigation to the same URL (design 7.3): a page that
											// logged out since shows logged out, and saying "restored"
											// pre-empts the "why am I signed out" question.
											<span className="shrink-0 rounded-sm border border-control px-1 text-meta text-ink-dim">
												Restored
											</span>
										)}
										{shownChips.has("failed") && (
											// Marked per tab, not only on the active one: a background tab whose
											// load was refused shows a blank page and nothing else, and the
											// failure panel belongs to whichever tab the user is looking at
											// (design round 1, D1).
											<span
												className="shrink-0 rounded-sm border border-control bg-danger-wash px-1 text-meta text-ink"
												data-tour-tag="browser-tab-failed"
											>
												Failed
											</span>
										)}
										{shownChips.has("request") && (
											// The tab is parked on an origin the agent has not been approved
											// for. Marked on the TAB rather than only in the band, because with
											// several tabs open the band's sentence names an origin and the user
											// needs to know which tab it belongs to (design 9.3) — and the number
											// is the ordinal of the waiting request, so it matches the tray's
											// chip and the dock's row (§5.2).
											<span
												className="shrink-0 rounded-sm border border-control bg-warning-wash px-1 text-meta text-ink tabular-nums"
												data-tour-tag="browser-tab-waiting"
											>
												{/*
												 * NOT "Waiting 2": that is an ordinal wearing a count's clothes.
												 * The number is the ordinal of the live request, and the
												 * identically shaped chip on the Approvals control IS a count, so
												 * nothing on the strip distinguished the two readings (design
												 * round 2, D5). `Request 2` is the wording the tray's chip uses,
												 * so the tie between the two numbers is stated rather than
												 * inferred.
												 */}
												Request {waitingOrdinal}
											</span>
										)}
										{collapsedChips.length > 0 && (
											/*
											 * THE COLLAPSE CHIP (design R4, fix 1). It is HONEST ABOUT WHAT IT HIDES, and
											 * in three places rather than one: the visible `+n` is the count, its `title`
											 * names the states, and an `sr-only` span inside the button carries the words
											 * so assistive technology reads `, 2 more: Restored, Shared` rather than a bare
											 * number. The tab's own `title` and the actions band name the full state
											 * too, so nothing is unrecoverable.
											 *
											 * THE RESTORED/SHARED TRIPLE, not a new one (`border-control`, `ink-dim`), so
											 * a pill that says "some states are hidden" is drawn in the same grammar as the
											 * states it hides and needs no new `CONTROLS` row in the contrast contract.
											 */
											<span
												title={collapsedChips
													.map((chip) => CHIP_WORD[chip])
													.join(", ")}
												className="shrink-0 rounded-sm border border-control px-1 text-meta text-ink-dim tabular-nums"
												data-tour-tag="browser-tab-chips-collapsed"
											>
												+{collapsedChips.length}
												<span className="sr-only">
													{`, ${collapsedChips.length} more: ${collapsedChips
														.map((chip) => CHIP_WORD[chip])
														.join(", ")}`}
												</span>
											</span>
										)}
										{/*
										 * THE TITLE COMES AFTER THE MARKERS, and that ordering is the fix
										 * for review round 3's MAJOR. The chrome cluster is overlaid on the
										 * row's right end (below), so anything trailing the title sits under
										 * an opaque panel whenever the panel is revealed - and the marker
										 * chip is "the ONLY thing that distinguishes an agent tab from a
										 * user tab in the strip". At `[W-51, W-8]` it sat ENTIRELY inside the
										 * cluster's 66px band: the panel covered the marker, not the title's
										 * tail, so the state this feature exists to show was invisible on
										 * exactly the tabs it marks. Leading the title is also where real
										 * chrome puts a tab's status: the pip is read before the name.
										 *
										 * `grow` so the title still takes whatever the leading markers leave,
										 * and the native `title` so a truncated name is recoverable with the
										 * pointer - which is what D13 asked for alongside the width fix. The
										 * full text is in the DOM either way, so assistive technology already
										 * reads the whole name; this is the mouse's half of it. The tag is
										 * what the proof harness measures a title box with (QA round 2, Q4).
										 */}
										<span
											className="min-w-0 grow truncate"
											title={tab.title}
											data-tour-tag="browser-tab-title"
										>
											{tab.title}
										</span>
									</button>
									{/* THE CHROME CLUSTER IS PERMANENT IN FLOW ON THE ACTIVE TAB
									AND OVERLAID ON AN INACTIVE ONE, AND ITS GROUND IS EARNED
									(design round 3, D13; QA round 2 Q4 and the UX round's U5 from
									the other side; review round 3, MAJOR). `opacity-0` does not
									reclaim layout, which is what D13 found: the two 28px controls
									held 68px of every tab's 176px, so the rows carrying the
									`Agent` marker had 21px of title - one glyph - on exactly the
									tabs this feature adds. The overlay takes that width back on
									an inactive tab, where the controls are revealed by hover or
									focus and cost the title nothing while the pointer is away.
									THE ACTIVE TAB'S CLOSE CONTROL IS NOT TRANSIENT, so there the
									cluster sits in flow instead: a panel floated over a
									permanently visible control would put the title's tail under
									an opaque band with no ellipsis to show for it. In flow, the
									title truncates before it, which is the honest rendering. THE
									GROUND IS EARNED, which is the half review round 3 caught. An
									opaque band painted in every state covers whatever trails the
									title - and on the active tab (`bg-canvas` over `bg-canvas`)
									it hid the state chips at rest as well, on exactly the tabs
									this feature adds. The markers lead the title now, and the
									band appears only with the controls it belongs to. On an
									inactive tab it takes the tab's hover ground rather than
									`bg-inherit`, which would be transparent on a keyboard-focused
									inactive tab. `pointer-events-none` while hidden is part of
									the overlay: two invisible controls sit over the title's tail,
									and a click meant for the name must not land on Close. */}
									<div
										className={cn(
											active
												? cn(
														"relative flex shrink-0 items-center gap-1.5",
														// THE ACTIVE ROW'S CLUSTER STEPS OUT OF FLOW IN A NARROW STRIP (D1's
														// remainder). 68px of permanent controls is what stopped four rows
														// fitting the pane's 567px scroller - the floors in this file can
														// shrink, controls cannot - so below `@max-2xl` (42rem, measured on the
														// strip's own container) the active row takes exactly
														// the treatment every inactive row has had since D13: overlaid on the
														// row's right end, revealed on hover or focus, with the elevated
														// ground so the title it covers is not read through it. It stays
														// reachable by keyboard through the same `group-focus-within` the other
														// rows use, and the actions expansion is still the always-reachable
														// path for the mouse.
														"@max-2xl:absolute @max-2xl:inset-y-0 @max-2xl:right-1",
														"@max-2xl:group-hover:bg-elevated @max-2xl:group-focus-within:bg-elevated",
													)
												: "absolute inset-y-0 right-1 flex items-center gap-1.5",
											// Its own actions row being open is not a hover, so the ground
											// and the reveal follow that state explicitly.
											!active &&
												"group-hover:bg-elevated group-focus-within:bg-elevated",
											actionsTabId === tab.tabId &&
												(active ? "@max-2xl:bg-elevated" : "bg-elevated"),
										)}
									>
										{/* The actions trigger. The menu it used to open painted into the
										    content rect, where the native view occludes it (§6), so this
										    now expands the row's actions inside the band instead. */}
										<Button
											ref={(node) => {
												menuRefs.current.set(tab.tabId, node);
											}}
											variant="ghost"
											size="icon-sm"
											aria-label={`Tab actions for ${tab.title}`}
											aria-expanded={actionsTabId === tab.tabId}
											onClick={() => {
												if (actionsTabId === tab.tabId) closeActions();
												else setActionsTabId(tab.tabId);
											}}
											// Revealed on hover/focus like the close button, unless its own row
											// is open. On an INACTIVE tab it holds no width at all, so the reveal
											// costs the title nothing (D13); on the ACTIVE one it sits in flow beside
											// the permanent close control and keeps its 28px, which is part of why an
											// active marked row needs the wider floor above - and, below
											// `@max-2xl`, why
											// the whole cluster steps out of flow and takes the reveal with it.
											className={cn(
												"transition-opacity",
												actionsTabId === tab.tabId
													? "text-ink"
													: cn(
															REVEAL_ON_HOVER_OR_FOCUS,
															active && NARROW_REVEAL,
														),
											)}
											data-tour-tag="browser-tab-menu"
										>
											<MoreHorizontal aria-hidden className="size-3.5" />
										</Button>
										<Tooltip content="Close tab">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Close ${tab.title}`}
												onClick={() => onClose(tab.tabId)}
												// Rendered for the active tab always and for an inactive one on
												// hover OR focus-within (§6): a focusable but invisible control
												// is a keyboard trap of its own, and the row's actions expansion
												// is the always-reachable path for the mouse. The reveal is an
												// opacity step, never a layout shift - and on the active tab,
												// where this control is permanent, it is IN FLOW, so the title
												// truncates before it instead of running under it (review
												// round 3, MAJOR). Below `@max-2xl` - below 672px, which
												// is the pane's own 640 and every width up to the
												// route's 1160, and not the 576px `@xl` this used to
												// name before the container moved to the strip's row - the
												// whole cluster is overlaid instead, for the reason the
												// container class above states.
												className={cn(
													"transition-opacity",
													active
														? cn("opacity-100", NARROW_REVEAL)
														: REVEAL_ON_HOVER_OR_FOCUS,
												)}
												data-tour-tag="browser-tab-close"
											>
												<X aria-hidden className="size-3.5" />
											</Button>
										</Tooltip>
									</div>
									{active && (
										// THE NOTCH. The strip's rule runs along the whole band, and the
										// active tab paints the page's own ground across its own bottom
										// edge so the tab and the content area read as one sheet. It is
										// one pixel of `canvas` — the same role the tab's fill and the
										// content area use — and it is why the strip keeps its own
										// `border-b`: the rule continues everywhere except here.
										<span
											aria-hidden
											data-tour-tag="browser-tab-notch"
											className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-canvas"
										/>
									)}
								</div>
							</Fragment>
						);
					})}
				</div>
				{tabsOffScreen > 0 && (
					/*
					 * THE PINNED WAY TO REACH ANY TAB, which is the canvas's own answer to
					 * the same problem (`canvas-tabs.tsx`: "scrolling sideways to find a file
					 * is a fallback, not the only route"): one control in a fixed place
					 * listing every tab, with the active one ticked. It sits OUTSIDE the
					 * scroller, so it cannot itself be scrolled out of reach.
					 *
					 * IT APPEARS ONLY WHEN SOMETHING IS MISSING, AND IT COUNTS (QA round 1,
					 * Q2): the count is the control's own text, its label and its tooltip say
					 * what the count means, and a strip that fits draws no control at all.
					 * That is also why the gate is `tabsOffScreen` rather than
					 * `tabs.length > 1`, which is what it was for one round.
					 *
					 * IT EXISTS BECAUSE OF D1: at the pane's default width a strip of four
					 * tabs still overflows after the floors step down (the narrow tier holds
					 * four 1-chip rows; anything wider, or a 480px pane, runs out), and a
					 * mouse has no horizontal wheel to scroll with. The two halves are one
					 * answer - the floors decide how many fit, and this says how many did not.
					 */
					<DropdownMenu>
						<Tooltip
							content={
								tabsOffScreen === 1
									? "All tabs — 1 not shown"
									: `All tabs — ${tabsOffScreen} not shown`
							}
						>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`All tabs, ${tabsOffScreen} not shown`}
									data-tour-tag="browser-tab-overflow"
									className={cn("shrink-0 gap-0.5 self-center px-1")}
								>
									<ChevronDown aria-hidden="true" />
									{/* The count itself, at the chip's own step and tabular so two
									    digits do not shift the row it sits in. */}
									<span
										aria-hidden="true"
										className={cn("text-meta tabular-nums")}
									>
										+{tabsOffScreen}
									</span>
								</Button>
							</DropdownMenuTrigger>
						</Tooltip>
						<DropdownMenuContent align="end" className={cn("max-w-80")}>
							{tabs.map((tab) => (
								<DropdownMenuItem
									key={tab.tabId}
									onSelect={() => onActivate(tab.tabId)}
								>
									<Check
										aria-hidden="true"
										className={cn(tab.tabId !== activeTabId && "invisible")}
									/>
									<span className={cn("truncate")}>{tabLabel(tab.title)}</span>
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				{tabs.length > 0 && (
					/* Not drawn when the strip is empty (design round 1, N3): the page area
					   already offers `New tab` under the same label, and two controls 270px
					   apart that do the same thing is the duplication the empty state's own
					   comment forbids. */
					<Tooltip content={newTabLabel}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={newTabLabel}
							onClick={onNewTab}
							data-tour-tag="browser-new-tab"
						>
							<Plus aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
			</div>
			{actionsTab && (
				// IN THE BAND, which is the whole point: this row is outside the native
				// view's rectangle, so it is visible. The strip grows by this row's height
				// and the page's rectangle shrinks by exactly the same amount, because the
				// content element is measured by a `ResizeObserver` (`browser-surface.tsx`)
				// and the host re-bounds the view. No suppression, no z-index.
				//
				// IT NAMES ITS TAB, and it takes focus when it opens (design round 2, D4
				// and the UX round's U4). The row is a band under the whole strip, so
				// without a name the only tie to its owner was the trigger's focus ring —
				// which a mouse click does not paint. And because the row sits after the
				// scroller in DOM order, the first Tab after opening used to land on the
				// neighbouring tab's Close button: destructive, and not what the user was
				// reaching for. The container is focusable (`tabIndex={-1}`) purely so
				// opening moves focus into the row's first action.
				<div
					ref={actionsRowRef}
					tabIndex={-1}
					onKeyDown={(event) => {
						// Escape dismisses the row, the way it dismisses the dock (§4.2).
						if (event.key === "Escape") {
							event.stopPropagation();
							closeActions();
						}
					}}
					className="flex flex-wrap items-center gap-2 border-control border-t bg-surface px-2 py-1 focus:outline-none"
					data-tour-tag="browser-tab-actions"
				>
					<span className="shrink-0 text-meta text-ink-dim">
						Actions for "{tabLabel(actionsTab.title)}"
					</span>
					{!actionsTab.active && (
						// §8.3's "one click to watch": activation is the USER's click, which is
						// what design 11.4 permits — the app never activates a tab on the agent's
						// behalf. This replaces the old menu's "Switch to this tab" for a
						// non-active tab, because it is the same action and the one the operator's
						// report needs a name for.
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								closeActions();
								onActivate(actionsTab.tabId);
							}}
							data-tour-tag="browser-tab-watch"
						>
							Watch "{tabLabel(actionsTab.title)}"
						</Button>
					)}
					{/*
					 * The hand-over affordances live here rather than in the band
					 * because a hand-over is a statement about ONE tab, and the strip
					 * is where tabs are named (design 6.3).
					 */}
					{actionsTab.owner === "user" && !actionsTab.handedOver && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								closeActions();
								onHandOver(actionsTab);
							}}
							data-tour-tag="browser-tab-hand-over"
						>
							Let an agent use "{tabLabel(actionsTab.title)}"…
						</Button>
					)}
					{(actionsTab.handedOver || actionsTab.owner === "agent") && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								closeActions();
								onRevokeHandOver(actionsTab.tabId);
							}}
							data-tour-tag="browser-tab-revoke-hand-over"
						>
							Stop letting the agent use "{tabLabel(actionsTab.title)}"
						</Button>
					)}
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							closeActions();
							onClose(actionsTab.tabId);
						}}
						data-tour-tag="browser-tab-actions-close"
					>
						Close "{tabLabel(actionsTab.title)}"
					</Button>
					<div className="grow" />
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Hide tab actions"
						onClick={closeActions}
						data-tour-tag="browser-tab-actions-dismiss"
					>
						{/* A chevron, not an `×`: the row already ends near the tab-close
						    button's own glyph, and two `×`s 200px apart with different
						    meanings is a shape the eye reads as one control (D4). */}
						<ChevronUp aria-hidden className="size-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
};
