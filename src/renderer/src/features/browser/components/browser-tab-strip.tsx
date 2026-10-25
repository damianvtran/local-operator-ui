import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { chordCaption } from "@shared/keymap/keymap-chord";
import { cn } from "@shared/lib/utils";
import {
	Bot,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronUp,
	CircleAlert,
	CircleHelp,
	Globe,
	Hand,
	History,
	LoaderCircle,
	MessagesSquare,
	Plus,
	Volume2,
	VolumeX,
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
import { textDirectionFor } from "../../../../../i18n/direction";
import type {
	TabActionsMenuRequest,
	TabActionsMenuSelection,
} from "../../../../../shared/browser-tab-actions-menu";
import type { BrowserTabView } from "../hooks/use-browser-chrome";
import { buildTabActionsMenuItems } from "../model/tab-actions-menu-model";
import {
	type CloseTabsIntent,
	closeConversationIntent,
	closeFailedIntent,
	closeOthersIntent,
	closeToTheRightIntent,
	groupTabsBySession,
	pooledTabs,
	sessionDisplayName,
} from "../model/tab-index-model";
import {
	physicalMoveTarget,
	physicalScrollEdges,
	pointerIsAfterTab,
} from "./browser-tab-direction";

/**
 * The tab strip. Design: docs/design/ui-browser-tab.md 6.1 (the controls), 6.2
 * (one strip, two actors), 6.3 (hand-over), 6.5 (caps), 11.2 (branding roles);
 * docs/design/browser-approval-ux.md 6 (the grammar), 5.2 (the `Waiting n` chip),
 * 8.3 (why the actions are in the band and why a background tab shows a spinner).
 *
 * ONE STRIP FOR TWO ACTORS. A user tab and an agent tab sit in the same list, in
 * session-grouped creation order by default; an explicit human reorder wins.
 * Registry/agent order and all ownership remain unchanged. This is because the user's question is "what is open" rather than
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
 * | active tab | the PAGE's own ground (`elevated`), `border-x border-t border-control`, no bottom edge, `rounded-t-sm` |
 * | the notch | a 1px `elevated` span painted across the active tab's bottom edge, so the strip's own rule continues everywhere except under it |
 *
 * Removing the inactive fill loses no information — the titles and the dividers
 * identify them (the `branding.md` "would removing it lose anything" test), so the
 * fill comes off rather than being promoted to a second ground. `border-control`
 * on the active tab's three edges is what makes it survive a glance; at the old
 * `canvas` rung the ground step alone measured 1.11:1 in the dark palettes
 * (design round 3, D18) and a depth cue is not a marker — the edge is what this
 * grammar spends on the tab. THE FILL AND THE NOTCH FOLLOW THE PAGE (remediation
 * pass): the page below the strip moved to the drawer's rung (`elevated`,
 * `browser-surface.tsx` and `browser-url-bar.tsx`), so the tab's fill and its
 * notch moved with it — left on `canvas` they drew a 1px seam where the sheet
 * used to be, in every theme.
 *
 * WHY THE ROW ACTIONS ARE A NATIVE MENU (LOH-13 operator report, 2026-10-25;
 * this SUPERSEDES the popout ruling of 2026-09-28). A native `Menu` is drawn by
 * the OS above the native `WebContentsView`, so the page stays visible for as
 * long as the menu is up and the strip registers NO overlay suppression for it.
 * The popout it replaces could only be painted by hiding the page, which put the
 * "paused" note behind the menu — the operator's report. A native menu also
 * costs the page nothing: the strip does not grow and the page's rectangle does
 * not move. The item list (labels, counts and the optional hands) is still the
 * strip's, because the counts disclose what a destructive press will close; the
 * native template and its popup live in main
 * (`src/main/browser/tab-actions-menu.ts`, `ipc.ts`). `scripts/browser-chrome-proof.mjs`
 * measures the page staying visible while the menu is open.
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
	/** The host's OWN list — the pane's strip is scoped to a conversation, the route's is
	 * everything — and it is the list every count in the band is taken from (design R5 as
	 * the operator ruled it in review round 2, settling U7 against round 1's A3).
	 *
	 * THE ALTERNATIVE WAS A SECOND, WIDER LIST ON THIS COMPONENT (`poolTabs`, which A3
	 * added so `Close N other tabs` could count the whole pool), and it was withdrawn:
	 * a scoped host's band must not close tabs the user cannot see, the label is truthful
	 * either way because it counts what the press closes, and one list means no host can
	 * hand this component two lists that can drift apart. The model's `closeOthersIntent`
	 * takes whatever list it is given, so the contract lives in its docstring. */
	tabs: BrowserTabView[];
	tabPanelId?: string;
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
	/** Close one tab, and report whether the host's invoke was ACCEPTED (`false` is a
	 * refusal). Only the caret restore reads the value — see the pending-close block.
	 * `undefined` is the host saying it reports nothing, which the bounded wait's
	 * expiry then ends; a host that does not care answers `true`. */
	onClose: (tabId: number) => Promise<boolean> | undefined;
	/** Close several tabs as ONE intent (design R5). The counts in the labels are the
	 * disclosure, so the strip builds the intent and the host sends it.
	 *
	 * The promise is the close's own OUTCOME, and it is what bounds the caret restore
	 * (review round 2, A-2): `false` means the invoke was refused, so the projection
	 * this side is waiting for can never arrive and the wait has to end. `undefined` is
	 * the same allowance `onClose` makes, and a host that hands back nothing leaves the
	 * bounded wait's expiry to end it. */
	onCloseTabs: (intent: CloseTabsIntent) => Promise<boolean> | undefined;
	onNewTab: () => void;
	onReorder?: (ids: number[]) => Promise<void>;
	onTabAction?: (
		tabId: number,
		action: "duplicate" | "reload" | "mute" | "unmute",
	) => void;
	/**
	 * Show the tab's actions as a native menu, and answer the item selected.
	 *
	 * REQUIRED FOR THE MENU TO EXIST, optional so a story or a projection-only
	 * test can mount the strip without a bridge (the trigger then answers
	 * nothing). The strip owns the item list because it owns the rendered order
	 * and every count the destructive labels disclose; the host owns the popup and
	 * only ever answers a verb the strip implements (`tabActionsMenuSelectionOrNull`).
	 * Null is a dismissal, including a run with no window to hang a menu from.
	 */
	onShowTabActionsMenu?: (
		request: TabActionsMenuRequest,
	) => Promise<TabActionsMenuSelection>;
	/** What the `+` calls itself. The host's own sentence, because only the host
	 * knows whether a tab opened here is attributed to a conversation (design R1):
	 * a `+` labelled `New tab` in both hosts would leave the difference to be
	 * discovered by switching the scope and finding the tab gone. Defaulted so a
	 * story or a test that does not care passes nothing. */
	newTabLabel?: string;
	onHandOver: (tab: BrowserTabView) => void;
	onRevokeHandOver: (tabId: number) => void;
}

/**
 * How long a close's caret restore may stay armed, in milliseconds.
 *
 * A BACKSTOP, not the mechanism: when the host reports the close's outcome the record
 * settles on that answer within one projection, and this only ends the wait for a host
 * that hands back nothing (a story, a test harness) or a projection that never arrives
 * at all. The number is the app's own worst measured landing — the QA round that filed
 * the caret defect read `<body>` at 300ms, 1.3s and 2.8s after the press, the last of
 * which is a projection still arriving almost three seconds later — so a merely slow
 * close is still honoured, and past that the caret is left wherever the user has put it
 * rather than being taken back into the strip.
 */
const CLOSE_FOCUS_SETTLE_MS = 4000;

/** One close's claim on the caret. See the pending-close block in the component: `ids`
 * is what the close named, `parked` records that the caret has already been moved into
 * the strip for it, and `decided` records that the close's own promise has settled. */
type CloseFocusPending = {
	ids: number[];
	parked: boolean;
	decided: boolean;
};

/** One fixed-size identity slot also anchors the existing actions menu. A text
 * chip plus a separate page mark used to erase the title at the 144px floor.
 * Distinct ownership glyphs are not colour-only; the tab's complete accessible
 * name and menu retain every state when the single compact badge has to choose.
 * No favicon bytes are published by main, so this never fetches a remote icon.
 *
 * FAVICON: DEFERRED (LOH-13 slice C). Electron's `page-favicon-updated`
 * delivers favicon URLs, but rendering one here would be a RENDERER fetch
 * of a page-chosen URL — the frozen design brief rules that out ("never a
 * renderer fetch"; a favicon is "main-owned, consent/origin-gated,
 * degrading to the state glyph"). An honest favicon therefore needs a
 * main-side fetch/cache that publishes bytes or a data URL through this
 * projection, behind the same origin/consent floor as the embedded
 * browser — a broader change than this slice, and the brief's own open
 * question. Until that lands the state glyph below is the tab's icon,
 * which has the virtue of never claiming a site identity the app has not
 * actually verified. */
// The `animate` prop this slot used to take is gone with the pulse it drove:
// loading now spins for every tab (below), so there is no per-call-site
// motion left to switch.
const TabMark: FC<{
	tab: BrowserTabView;
	showOwnership?: boolean;
	waitingOrdinal?: number;
}> = ({ tab, showOwnership = true, waitingOrdinal }) => {
	const { shown, collapsed } = stateChips(tab, waitingOrdinal);
	const states = [...shown, ...collapsed];
	const status = states.find(
		(state) =>
			state === "request" || state === "failed" || state === "restored",
	);
	const owned = showOwnership && (tab.owner === "agent" || tab.handedOver);
	// THE LOADING GLYPH WINS OVER THE OWNERSHIP GLYPH, and that reconciliation is
	// the fix for the non-gating round-1 finding: the `owned` branch used to pick
	// `Bot`/`Hand` FIRST, so a loading AGENT tab painted a spinning robot — motion
	// on a glyph that means "an agent owns this tab", which is neither progress
	// nor anything the motion explains. The spinner and the owner mark are two
	// different facts about one tab and a mark slot holds one glyph, so the
	// question is which fact is lost if the other is drawn. Ownership is NOT lost
	// by drawing the spinner: it is carried by the `Agent`/`Shared` chip in the
	// row and by the tab's own accessible name (`stateChips`, below), both of
	// which survive regardless of the glyph. The loading state has no other
	// per-tab signal at all — that is the whole premise of the per-tab spinner
	// (spec §8.3) — so it is the fact that cannot be dropped, and the spinner is
	// therefore drawn for every loading tab, agent-owned included.
	const Icon =
		tab.loading && !tab.failed
			? LoaderCircle
			: owned
				? tab.handedOver
					? Hand
					: Bot
				: Globe;
	const Status =
		status === "request"
			? CircleHelp
			: status === "failed"
				? CircleAlert
				: History;
	return (
		<span
			className="relative inline-flex size-5 shrink-0 items-center justify-center"
			aria-hidden
			data-tour-tag="browser-tab-mark"
		>
			<Icon
				data-tour-tag={
					tab.loading && !tab.failed
						? "browser-tab-spinner"
						: owned
							? "browser-tab-ownership"
							: undefined
				}
				className={cn(
					"size-4 shrink-0",
					// The colour follows the GLYPH, not the ownership: a spinner is a
					// progress mark and wears the register the strip gives progress
					// (`ink-dim`), while the ownership glyph keeps `accent`. Painting a
					// loading agent tab's spinner `accent` would make the one moving
					// thing on the strip the loudest, which is the opposite of what an
					// indeterminate background load should be.
					tab.loading && !tab.failed
						? "text-ink-dim"
						: owned
							? "text-accent"
							: "text-ink-dim",
					// The per-tab loading spinner (brief 2.2): it must actually
					// turn — a static dashed circle reads as a state glyph, not
					// as progress — and under `prefers-reduced-motion` the global
					// cap in `styles/index.css` freezes the rotation, leaving
					// this same glyph standing as the static mark the brief
					// requires, so the tab's loading state never disappears
					// with the animation. The old `animate-pulse` on the active
					// tab only was neither a spinner nor that fallback.
					tab.loading && !tab.failed && "animate-spin",
				)}
			/>
			{status && (
				<Status
					data-tour-tag={`browser-tab-${status}`}
					className={cn(
						"absolute bottom-0 end-0 size-2.5 rounded-full bg-elevated",
						status === "failed" ? "text-danger" : "text-ink-muted",
					)}
				/>
			)}
		</span>
	);
};
/** A tab's name for a button label: short enough to sit in a row of actions
 * without wrapping, long enough to identify the tab when two of them are alike
 * (design round 2, D4 — "Watch 'Reports'", not "Watch this tab"). */
const tabLabel = (title: string): string => {
	const trimmed = title.trim();
	if (!trimmed) return t("ui.browser.browser_tab_strip.this_tab");
	return trimmed.length <= 24
		? trimmed
		: `${trimmed.slice(0, 23).trimEnd()}\u2026`;
};

/**
 * `tabLabel` as an ISOLATED RUN inside a catalogue sentence (design round 2,
 * D7). The menu quotes the title and is portalled into an RTL paragraph: an
 * LTR title's ellipsis drifted to the start of the Latin run (`"…accessibility"`).
 * FSI/PDI (U+2068/U+2069) is the inline equivalent of `<bdi>` — a catalogue
 * message cannot carry an element - and it wraps the VALUE, never the copy, so
 * a translation keeps its own quotes and punctuation.
 */
const isolatedTabLabel = (title: string): string =>
	`\u2068${tabLabel(title)}\u2069`;

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

/** State priority is shared by the compact badge and detailed state summary.
 * The old inline cap remains the pure classification contract; the compact row
 * reads both parts, so a collapsed state is never mistaken for an absent one. */
const MAX_INLINE_CHIPS = 1;

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
 * A group's name, for the strip's chip and the band list's headings.
 *
 * ONE RULE FOR BOTH, and the unattributed run's own sentence lives here rather than
 * at two call sites: `sessionDisplayName` resolves a conversation, and `null` is not
 * a conversation but the user's own tabs, which the design names `No conversation`
 * (open question 8).
 */
function groupLabelName(
	group: { sessionId: string | null },
	sessions: ReadonlyArray<{ session_id: string; title?: string | null }>,
): string {
	return group.sessionId === null
		? t("ui.browser.browser_tab_strip.no_conversation")
		: sessionDisplayName(group.sessionId, sessions);
}

/**
 * One minimum regardless of actor or chip count. The old per-state ladder
 * reached 416px and defeated the 240px cap before overflow even began. Compact
 * state presentation, a complete accessible name and the actions menu now carry
 * detail instead. Keep this small policy executable in the existing model tests;
 * native rects, not this class string, prove the rendered cap/targets/gaps.
 */
export function tabFloor(_active: boolean, _pills: number): string {
	// 144px keeps a title + 28px targets; detailed states remain accessible/menu-owned.
	return "min-w-36";
}
/**
 * The action slot is always reserved in flow; only its paint/hit testing changes
 * on hover/focus. No title/close-target jump. Literal classes stay discoverable
 * by Tailwind's scanner.
 */
const REVEAL_ON_HOVER_OR_FOCUS =
	"opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto";

export const BrowserTabStrip: FC<BrowserTabStripProps> = ({
	tabs: sourceTabs,
	tabPanelId,
	sessions = [],
	activeTabId,
	waiting,
	newTabLabel = t("ui.browser.browser_tab_strip.new_tab"),
	onActivate,
	onClose,
	onCloseTabs,
	onNewTab,
	onReorder,
	onTabAction,
	onHandOver,
	onRevokeHandOver,
	onShowTabActionsMenu,
}) => {
	const locale = useI18nLocale();
	const direction = textDirectionFor(locale);
	const copy = {
		error: t("ui.browser.chrome.error_title"),
		scrollLeft: t("ui.browser.chrome.scroll_left"),
		scrollRight: t("ui.browser.chrome.scroll_right"),
	};
	const tabs = useMemo(
		() =>
			sourceTabs.map((tab) => {
				if (!tab.failed) return tab;
				// A navigation URL is not an error title. Only the host is shown on
				// failure; Copy URL remains the full-address path.
				let title = copy.error;
				try {
					title = new URL(tab.url).hostname || title;
				} catch {
					/* blank/non-web fallback */
				}
				return { ...tab, title };
			}),
		[sourceTabs, copy.error],
	);
	const accessibleName = (tab: BrowserTabView) =>
		t("ui.browser.chrome.accessible_tab", {
			title: tab.title,
			waiting:
				waiting[tab.tabId] === undefined ? "none" : String(waiting[tab.tabId]),
			restored: tab.restored ? "yes" : "no",
			loading: tab.loading && !tab.failed ? "yes" : "no",
			failed: tab.failed ? "yes" : "no",
			owner: tab.handedOver
				? "shared"
				: tab.owner === "agent"
					? "agent"
					: "user",
		});

	const [dragging, setDragging] = useState<number | null>(null);
	const [dropTarget, setDropTarget] = useState<number | null>(null);
	const [dropAfter, setDropAfter] = useState(false);
	/** Whether the pinned control's list of every tab is open, in the band. Local view
	 * state for the same reason the menu's is: it is not a fact about a tab. */
	const isMac = navigator.platform.toUpperCase().includes("MAC");
	const newChord = chordCaption("primary+t", isMac ? "mac" : "linux");
	const closeChord = chordCaption("primary+w", isMac ? "mac" : "linux");
	const [overflowOpen, setOverflowOpen] = useState(false);
	const stripRootRef = useRef<HTMLDivElement | null>(null);
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	/** The pinned control's own element, so dismissing the list hands focus back to the
	 * control that opened it — the same contract the actions menu has with its trigger
	 * (UX round 2, U9). */
	const overflowTriggerRef = useRef<HTMLButtonElement | null>(null);
	/** The list itself, so opening it can move focus INTO the band (D4's rule, applied
	 * to the second band row rather than re-derived for it). */
	const overflowRowRef = useRef<HTMLDivElement | null>(null);
	/** The list's own scroller, for the reveal below. */
	const overflowScrollerRef = useRef<HTMLDivElement | null>(null);

	/**
	 * Which tab's NATIVE actions menu is up, if any.
	 *
	 * This is view state for the trigger's `aria-expanded` and the row's selected
	 * treatment - NOT a suppression input. The native menu is drawn by the OS
	 * above the `WebContentsView`, so nothing here hides the page (LOH-13
	 * operator report, 2026-10-25). Before this change the menu was a Radix
	 * popout whose panel registered a measured pause, which is what put the
	 * "paused" note behind it.
	 */
	const [expandedTabId, setExpandedTabId] = useState<number | null>(null);

	/**
	 * Dismiss the pinned list and put the caret back where it came from.
	 *
	 * THE RETURN IS THE WHOLE REASON THE TRIGGER HAS A REF: every dismissal path
	 * unmounts the element that had focus, which drops a keyboard user to `<body>` and
	 * out of the strip entirely — the class of defect the closes' own note below
	 * records from UX round 2 (U9). The band's rows are all reachable by keyboard, so
	 * this one has to be right rather than merely survivable.
	 */
	const closeOverflow = useCallback((): void => {
		setOverflowOpen(false);
		overflowTriggerRef.current?.focus();
	}, []);

	useEffect(() => {
		if (!overflowOpen) return;
		overflowRowRef.current?.focus();
		/*
		 * AND THE ROW THAT SAYS "you are here" IS REVEALED (review round 1, U2). The
		 * control exists to reach a tab the strip has pushed off screen, and it opened at
		 * `scrollTop: 0` — so with the newest tab active (the usual case) the current tab
		 * sat below the fold of the list that was opened to show it, and the frame showed
		 * the last row clipped at the box's edge. The strip itself already scrolls its
		 * active tab into view, so this is the list catching up with the row above it
		 * rather than a second rule.
		 *
		 * MANUAL, NOT `scrollIntoView`: that walks every scrollable ancestor, and this
		 * list sits inside the app's own scroller and the sidebar — centring one row would
		 * move the sidebar and the chat behind the band. The arithmetic moves the list's
		 * own `scrollTop` by the overlap it measured, and nothing else.
		 */
		const scroller = overflowScrollerRef.current;
		if (activeTabId === null || !scroller) return;
		const row = scroller.querySelector<HTMLElement>(
			`[data-tab-id="${activeTabId}"]`,
		);
		if (!row) return;
		const rowBox = row.getBoundingClientRect();
		const box = scroller.getBoundingClientRect();
		if (rowBox.bottom > box.bottom)
			scroller.scrollTop += rowBox.bottom - box.bottom;
		else if (rowBox.top < box.top) scroller.scrollTop -= box.top - rowBox.top;
	}, [overflowOpen, activeTabId]);

	/**
	 * Where a close that takes its own trigger with it leaves the caret, and why it needs its
	 * own path, its own record and its own expiry.
	 *
	 * A dismissal that does NOT remove the tab (Watch, hand-over, revoke and Copy URL)
	 * hands focus back to the tab its trigger belonged to — the menu's own
	 * close-autofocus does that now, and the trigger it returns to is still on the row.
	 * A close can't: the trigger is inside the row that is about to be gone, so the caret
	 * has nowhere to return to and would fall to `<body>` — dropping a keyboard user out
	 * of the strip entirely (the UX round 2 U9 class of defect).
	 *
	 * SO THE CLOSE NAMES ITS OWN TARGETS. `ids` is what the batch asked for: the ids it
	 * sent (`mode: "ids"`) or the conversation's own tabs as the strip last saw them
	 * (`mode: "conversation"`, which main resolves against the live registry so a tab an
	 * agent opens meanwhile is closed too — the ids here are only the ones this side can
	 * wait for). While any of them is still in `tabs` THE CLOSE HAS NOT LANDED.
	 *
	 * WHY THE RECORD HAS TO SURVIVE THE FIRST RENDER (review round 1, A2 — one bug, three
	 * reports): the close's promise settles AFTER `onCloseTabs` resolves, and the tab's
	 * row is still in `tabs` while the projection is in flight,
	 * so the first run of this effect after a press still sees every pre-close tab.
	 * Resolving the selection there focuses the tab that is being removed, which unmounts
	 * milliseconds later and drops the caret to `<body>` with the flag already spent —
	 * measured in the app (QA Q4, UX U1: `<body>` at 300ms/1.3s/2.8s) and reproduced in a
	 * jsdom probe against this component (reviewer, A2). Neither `activeTabId` nor the
	 * props carry "the close has landed", so the ids do.
	 *
	 * AND WHY THE WAIT IS BOUNDED (review round 2, A-2 — the flag had no failure exit). The
	 * projection that removes the ids is a thing that may NEVER come: an invoke main refuses
	 * drops nothing, and neither does an id main did not take, because the test above asks
	 * whether ALL of them are gone. An unbounded wait is not a wait but an armed tripwire —
	 * this effect re-runs on every `tabs` change, including the `refresh()` a failed `run()`
	 * performs — so the next tab that arrived took the caret back into the strip, away from
	 * wherever the user had put it (reproduced in jsdom by the reviewer, whose control case
	 * shows the caret left alone). THREE RULES BOUND IT, and each covers a different way the
	 * projection can fail to arrive:
	 *
	 *  1. IT PARKS ONCE (`parked`). The caret is moved out of the row that is about to
	 *     disappear by the first run after the press and by no later one: after that, only
	 *     the landing below or the expiry may move it.
	 *  2. THE CLOSE'S OWN OUTCOME DECIDES IT (`settleCloseFocus`). `run` in
	 *     `use-browser-chrome.ts` awaits its re-read before it resolves, so a settled
	 *     promise means main has published the projection that answers THIS close: `false`
	 *     (the invoke was refused) drops the record at once, and `true` marks it decided —
	 *     the next `tabs` change is then the verdict, and ids still present after it are ids
	 *     this close did not take, so the record is dropped rather than left armed.
	 *  3. IT EXPIRES (`CLOSE_FOCUS_SETTLE_MS`). For a host that reports nothing and a
	 *     projection that never arrives, the record ends on its own either way.
	 *
	 * THE TWO PLACEMENTS, in order: while the close is in flight the caret sits on the
	 * scroller — the one element in the strip that survives every close, which is exactly
	 * why it is focusable — and once the projection lands, on the new active tab's
	 * `[role="tab"]`, or the scroller again when there is no tab left to hold it. A refused
	 * or expired close moves NOTHING: the caret is left where the user has since put it.
	 */
	const closeFocus = useRef<CloseFocusPending | null>(null);
	const closeFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	/** Drop the record and its timer. Nothing here touches focus: every caller has already
	 * decided that this close will not move the caret (a refusal, a landing, an expiry). */
	const clearCloseFocus = useCallback((): void => {
		if (closeFocusTimer.current !== null) {
			clearTimeout(closeFocusTimer.current);
			closeFocusTimer.current = null;
		}
		closeFocus.current = null;
	}, []);
	/** An unmount ends the wait too, so a strip that goes away does not leave a timer behind. */
	useEffect(() => clearCloseFocus, [clearCloseFocus]);

	/** Arm the wait for ONE close, and return its record so that close's own promise settles
	 * THAT record rather than whatever a later press armed. */
	const armCloseFocus = useCallback(
		(ids: number[]): CloseFocusPending => {
			if (closeFocusTimer.current !== null)
				clearTimeout(closeFocusTimer.current);
			const pending: CloseFocusPending = {
				ids,
				parked: true,
				decided: false,
			};
			closeFocus.current = pending;
			/*
			 * PARK NOW, NOT ON THE NEXT RENDER. The old Radix panel made this render
			 * itself (`setActionsTabId(null)`); a native menu leaves no renderer state
			 * to change, and the close's outcome is a ref, so waiting for an effect
			 * would leave the caret on `<body>` on a refused close - measured in
			 * `browser-tab-strip-focus.test.mjs`. Parking at arm time is the same
			 * placement the effect produced one render later, and `parked` keeps it
			 * from ever running twice.
			 */
			scrollerRef.current?.focus({ preventScroll: true });
			closeFocusTimer.current = setTimeout(() => {
				if (closeFocus.current === pending) clearCloseFocus();
			}, CLOSE_FOCUS_SETTLE_MS);
			return pending;
		},
		[clearCloseFocus],
	);

	/** Let the close's own outcome settle the record when the host reports one. */
	const settleCloseFocus = useCallback(
		(
			pending: CloseFocusPending,
			settled: Promise<boolean> | undefined,
		): void => {
			if (!settled) return;
			void settled.then((accepted) => {
				if (closeFocus.current !== pending) return;
				if (!accepted) {
					clearCloseFocus();
					return;
				}
				pending.decided = true;
			});
		},
		[clearCloseFocus],
	);

	useEffect(() => {
		const pending = closeFocus.current;
		if (!pending) return;
		const landed = !pending.ids.some((tabId) =>
			tabs.some((tab) => tab.tabId === tabId),
		);
		if (!landed) {
			// THE CLOSE WAS DECIDED AND THESE IDS SURVIVED IT: nothing is coming, so stop
			// waiting rather than leaving the record armed for the next projection.
			if (pending.decided) {
				clearCloseFocus();
				return;
			}
			// PARK ONCE, and never take the caret back from where the user has since put it:
			// only the landing below may move it again.
			if (pending.parked) return;
			pending.parked = true;
			scrollerRef.current?.focus();
			return;
		}
		clearCloseFocus();
		const next =
			activeTabId === null
				? null
				: scrollerRef.current?.querySelector<HTMLElement>(
						`[data-tab-id="${activeTabId}"] [role="tab"]`,
					);
		(next ?? scrollerRef.current)?.focus();
	}, [activeTabId, tabs, clearCloseFocus]);

	/** One batch close, whatever it closes: drop the row, name what it will take, ask for
	 * the intent, and leave the caret to the effect above — which the close's own outcome
	 * settles when the host reports it. */
	const runBatchClose = useCallback(
		(intent: CloseTabsIntent): void => {
			const pending = armCloseFocus(
				intent.mode === "ids"
					? [...intent.tabIds]
					: tabs
							.filter((tab) => tab.sessionId === intent.sessionId)
							.map((tab) => tab.tabId),
			);
			settleCloseFocus(pending, onCloseTabs(intent));
		},
		[armCloseFocus, onCloseTabs, settleCloseFocus, tabs],
	);

	/** A single close from the menu takes the same path, for the same reason the batch
	 * does: the menu's close-autofocus would return the caret to the closing tab's own
	 * trigger, which is inside the row being removed (review round 1, A2's "while in
	 * here"), so the close names its target and the effect above decides where the caret
	 * lands. */
	const runClose = useCallback(
		(tabId: number): void => {
			const pending = armCloseFocus([tabId]);
			settleCloseFocus(pending, onClose(tabId));
		},
		[armCloseFocus, onClose, settleCloseFocus],
	);

	// The activated tab scrolls into view (spec §6's last row). With the width
	// policy kept, a long strip scrolls, and a tab activated from the dock or by an
	// attention click must become visible or the click looks inert. `inline:
	// "nearest"` so a tab already on screen does not move at all.

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
	const [viewportWidth, setViewportWidth] = useState(0);
	const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });
	const hasOverflow = scrollEdges.left || scrollEdges.right;
	/* Main and overflow headings must describe the SAME contiguous rendered runs.
	 * Human reordering may interleave A/B/A; whole-conversation counts would put
	 * the final A tab under B. Never regroup an explicit display preference. */
	const groups = useMemo(() => groupTabsBySession(tabs), [tabs]);
	// The SAME model answers ordinal chords and close-right. Group summaries
	// remain grouped, but never re-sort an explicit human display preference.
	const ordered = useMemo(() => pooledTabs(tabs), [tabs]);
	/** Reorder one tab relative to another, in the list the user is looking at.
	 * `after` places it after the target rather than before. A `useCallback` because
	 * the native menu's dispatcher depends on it: a new identity every render would
	 * rebuild that callback for no reason. */
	const move = useCallback(
		(id: number, target: number, after = false) => {
			if (!onReorder || id === target) return;
			const ids = ordered
				.map((tab) => tab.tabId)
				.filter((candidate) => candidate !== id);
			ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id);
			void onReorder(ids);
		},
		[onReorder, ordered],
	);
	const orderKey = ordered.map((tab) => tab.tabId).join(",");
	useEffect(() => {
		// The overflow controls settle the viewport once. Their slots stay fixed
		// while scrolling; this reveal cannot fight a manual scroll or title update.
		if (
			!hasOverflow ||
			viewportWidth <= 0 ||
			activeTabId === null ||
			!orderKey.split(",").includes(String(activeTabId))
		)
			return;
		scrollerRef.current
			?.querySelector(`[data-tab-id="${activeTabId}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeTabId, hasOverflow, orderKey, viewportWidth]);
	const overflowGroups = useMemo(() => {
		const runs: Array<{ sessionId: string | null; tabs: BrowserTabView[] }> =
			[];
		for (const tab of ordered) {
			const sessionId = tab.sessionId ?? null;
			const last = runs[runs.length - 1];
			if (last?.sessionId === sessionId) last.tabs.push(tab);
			else runs.push({ sessionId, tabs: [tab] });
		}
		return runs;
	}, [ordered]);
	const groupLeads = useMemo(() => {
		const leads = new Map<
			number,
			{ sessionId: string | null; count: number }
		>();
		for (const group of overflowGroups) {
			const first = group.tabs[0];
			if (first)
				leads.set(first.tabId, {
					sessionId: group.sessionId,
					count: group.tabs.length,
				});
		}
		return leads;
	}, [overflowGroups]);
	/**
	 * A chip is rendered only when the pool holds MORE THAN ONE conversation, and
	 * that is what keeps every existing surface visually unchanged: the pane's own
	 * scope is a single group by construction, so its strip carries no labels at all
	 * (design R3). A pool of two conversations gets the labels because there the
	 * labels are the only thing that says which tab is whose.
	 */
	const showGroupLabels = groups.length > 1;
	/**
	 * Build one tab's menu and open it as a NATIVE popup in main (LOH-13
	 * operator report, 2026-10-25).
	 *
	 * WHY THE LIST IS BUILT HERE, ONCE PER PRESS. The old Radix panel re-derived
	 * its items on every render and its labels were the disclosure for a
	 * destructive press: "Close 2 other tabs" must name the set the press will
	 * close. The native menu is a snapshot, so the intents and the counts are
	 * computed from the SAME `tabs`/`ordered` closures and handed to main in one
	 * request. A projection that lands while the menu is up does not rewrite a
	 * menu the user is already reading; selecting an item acts on the snapshot
	 * the label described.
	 *
	 * THE CARET. A native menu takes key focus while it is open and gives it back
	 * when it closes, but not to a particular element: the strip puts it back on
	 * the trigger explicitly. A close is the exception - it calls the same
	 * `runClose`/`runBatchClose` path the panel did, and that path owns the caret
	 * because the trigger's own row may be leaving (UX round 2, U9).
	 *
	 * NO SUPPRESSION, ANYWHERE. The popup is drawn by the OS above the native
	 * `WebContentsView`, so nothing here registers a pause and the page keeps
	 * painting while the menu is open - which is the whole defect this replaces.
	 */
	const openTabActionsMenu = useCallback(
		async (
			tab: BrowserTabView,
			trigger: HTMLElement | null,
			pointer?: { x: number; y: number },
		): Promise<void> => {
			if (!onShowTabActionsMenu) return;
			const index = ordered.findIndex(
				(candidate) => candidate.tabId === tab.tabId,
			);
			const others = closeOthersIntent(tabs, tab.tabId);
			const toTheRight = closeToTheRightIntent(ordered, tab.tabId, direction);
			const failed = closeFailedIntent(tabs);
			const conversationCount =
				tab.sessionId === null
					? 0
					: tabs.filter((candidate) => candidate.sessionId === tab.sessionId)
							.length;
			const moveLeftIndex = physicalMoveTarget(
				index,
				ordered.length,
				"left",
				direction,
			);
			const moveRightIndex = physicalMoveTarget(
				index,
				ordered.length,
				"right",
				direction,
			);
			const rect = trigger?.getBoundingClientRect();
			const request: TabActionsMenuRequest = {
				tabId: tab.tabId,
				anchor: pointer ?? { x: rect?.left ?? 0, y: rect?.bottom ?? 0 },
				items: buildTabActionsMenuItems({
					tab,
					label: isolatedTabLabel(tab.title),
					canMoveLeft: moveLeftIndex !== null,
					canMoveRight: moveRightIndex !== null,
					canReorder: Boolean(onReorder),
					canTabAction: Boolean(onTabAction),
					closeOthers: others?.tabIds.length ?? null,
					closeRight: toTheRight?.tabIds.length ?? null,
					closeFailed: failed?.tabIds.length ?? null,
					conversationCount,
				}),
			};
			setExpandedTabId(tab.tabId);
			let selection: TabActionsMenuSelection = null;
			try {
				selection = await onShowTabActionsMenu(request);
			} finally {
				setExpandedTabId((current) => (current === tab.tabId ? null : current));
			}
			if (selection === null) {
				trigger?.focus({ preventScroll: true });
				return;
			}
			switch (selection) {
				case "watch":
					onActivate(tab.tabId);
					break;
				case "hand-over":
					onHandOver(tab);
					break;
				case "revoke-hand-over":
					onRevokeHandOver(tab.tabId);
					break;
				case "move-left":
					if (moveLeftIndex !== null)
						move(
							tab.tabId,
							ordered[moveLeftIndex].tabId,
							moveLeftIndex > index,
						);
					break;
				case "move-right":
					if (moveRightIndex !== null)
						move(
							tab.tabId,
							ordered[moveRightIndex].tabId,
							moveRightIndex > index,
						);
					break;
				case "mute":
				case "unmute":
				case "duplicate":
				case "reload":
					onTabAction?.(tab.tabId, selection);
					break;
				case "copy-url":
					void navigator.clipboard?.writeText(tab.url);
					break;
				case "close":
					runClose(tab.tabId);
					return;
				case "close-others":
					if (others) runBatchClose(others);
					return;
				case "close-right":
					if (toTheRight) runBatchClose(toTheRight);
					return;
				case "close-failed":
					if (failed) runBatchClose(failed);
					return;
				case "close-conversation":
					if (tab.sessionId !== null)
						runBatchClose(closeConversationIntent(tab.sessionId));
					return;
			}
			trigger?.focus({ preventScroll: true });
		},
		[
			direction,
			move,
			onActivate,
			onHandOver,
			onReorder,
			onRevokeHandOver,
			onShowTabActionsMenu,
			onTabAction,
			ordered,
			runBatchClose,
			runClose,
			tabs,
		],
	);

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
			setViewportWidth(strip.clientWidth);
			setScrollEdges(
				physicalScrollEdges(
					strip.scrollLeft,
					strip.clientWidth,
					strip.scrollWidth,
					direction,
				),
			);
		};

		measure();
		strip.addEventListener("scroll", measure, { passive: true });
		const observer = new ResizeObserver(measure);
		observer.observe(strip);

		return () => {
			strip.removeEventListener("scroll", measure);
			observer.disconnect();
		};
	}, [ordered, direction]);

	return (
		<div
			ref={stripRootRef}
			// S4b: ONE continuous hairline under every tab. The page now begins at
			// this pixel, so a `border-control` boundary would read as a control
			// edge over content, and the active tab no longer merges into an
			// elevated toolbar (there is none): its fill plus x/top border is the
			// whole affordance.
			/*
			 * A CHROME BAND, not a well and not a pane: on glass it wears the app
			 * sidebar's own paint (`surface` at its floor, raw over the desktop), and
			 * the active tab's `data-glass-active` overlay sits on it. Under Sidebars
			 * only nothing selects it and the flat `sunken` track is unchanged.
			 */
			data-glass-region="chrome"
			className="flex flex-col border-hairline border-b bg-sunken"
			role="tablist"
			aria-label={t("ui.browser.browser_tab_strip.browser_tabs")}
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
				{hasOverflow && (
					<Tooltip
						side="top"
						content={direction === "rtl" ? copy.scrollRight : copy.scrollLeft}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							className="shrink-0 self-center focus-visible:-outline-offset-2!"
							aria-label={
								direction === "rtl" ? copy.scrollRight : copy.scrollLeft
							}
							disabled={
								direction === "rtl" ? !scrollEdges.right : !scrollEdges.left
							}
							onClick={() =>
								scrollerRef.current?.scrollBy({
									left: direction === "rtl" ? 240 : -240,
									behavior: "instant",
								})
							}
						>
							<ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
						</Button>
					</Tooltip>
				)}

				<div
					ref={scrollerRef}
					style={{ width: Math.max(1, tabs.length) * 240 }}
					// Focusable so a batch close has somewhere to leave the caret when the
					// tab it would have returned to is one of the tabs it closed.
					tabIndex={-1}
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
						// A transient caret rest-stop, not an interactive control. Only this
						// container suppresses its ring; tabs/actions retain inset outlines.
						"flex min-w-0 flex-[0_1_auto] items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mb-px focus-visible:outline-none!",
					)}
				>
					{ordered.map((tab, index) => {
						const active = tab.tabId === activeTabId;
						const waitingOrdinal = waiting[tab.tabId];
						// One identity/menu slot + title + close. Status text does not spend
						// the title's budget; the complete name remains accessible at every width.
						const floor = tabFloor(active, 0);
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
							? { ...group, name: groupLabelName(group, sessions) }
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
									 * THE COUNT DOES NOT REPLACE THE BAND'S OWN (review round 1, U3/Q3): it used
									 * to be the reason `Close all tabs in this conversation` carried no number,
									 * and the chip is drawn only when the pool holds TWO conversations — so in
									 * the host this feature adds (the pane opened from a sidebar mark, one
									 * conversation in the pool) the band named no size at all and its most
									 * destructive item was the only uncounted one. The chip still states the
									 * run's size where it is drawn; the band counts its own items.
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
											className={cn(
												"shrink-0 text-meta text-ink-dim",
												/*
												 * THE ONE LABEL THAT IS A CONSTANT IS THE ONE THAT IS NOT CAPPED (review
												 * round 1, D6). `max-w-24` is a budget for USER DATA — a session id or a
												 * title can be any length and truncating one is honest, which is what the
												 * `title` attribute beside it is for. `"No conversation"` is this file's
												 * own string: a fixed label that clips to `No conv…` at every width the
												 * strip has looks like a broken chip rather than a shortened one, and
												 * nothing about it is unpredictable. So the unattributed run's chip is
												 * sized by its text, and every named run keeps the cap.
												 */
												groupLabel.sessionId === null
													? "whitespace-nowrap"
													: "max-w-24 truncate",
											)}
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
									draggable={Boolean(onReorder)}
									onDragStart={(event) => {
										if (
											(event.target as Element).closest(
												"button:not([role=tab])",
											)
										) {
											event.preventDefault();
											return;
										}
										if (!event.dataTransfer) return;
										setDragging(tab.tabId);
										onActivate(tab.tabId);
										event.dataTransfer.effectAllowed = "move";
										event.dataTransfer.setData(
											"application/x-local-operator-browser-tab",
											String(tab.tabId),
										);
									}}
									onDragEnd={() => {
										setDragging(null);
										setDropTarget(null);
									}}
									onDragOver={(event) => {
										if (dragging !== null) {
											event.preventDefault();
											setDropTarget(tab.tabId);
											setDropAfter(
												pointerIsAfterTab(
													event.clientX,
													event.currentTarget.getBoundingClientRect().x +
														event.currentTarget.getBoundingClientRect().width /
															2,
													direction,
												),
											);
										}
									}}
									onDrop={(event) => {
										event.preventDefault();
										if (dragging !== null) {
											event.preventDefault();
											const rect = event.currentTarget.getBoundingClientRect();
											move(
												dragging,
												tab.tabId,
												pointerIsAfterTab(
													event.clientX,
													rect.x + rect.width / 2,
													direction,
												),
											);
										}
										setDragging(null);
										setDropTarget(null);
									}}
									onContextMenu={(event) => {
										event.preventDefault();
										// A right-click on the row is the same gesture the old panel
										// served, so it opens the same native menu AT THE POINTER.
										const trigger =
											event.currentTarget.querySelector<HTMLElement>(
												'[data-tour-tag="browser-tab-menu"]',
											);
										void openTabActionsMenu(tab, trigger, {
											x: event.clientX,
											y: event.clientY,
										});
									}}
									onAuxClick={(event) => {
										if (event.button === 1) {
											event.preventDefault();
											event.stopPropagation();
											runClose(tab.tabId);
										}
									}}
									data-glass-active={active ? "" : undefined}
									className={cn(
										// Two 28px targets, 8px padding, 8px gaps and borders leave
										// 70px for the actual title at the 144px floor. The menu
										// trigger doubles as the leading identity slot, not a third slot.
										"group relative flex border-x border-t border-transparent max-w-60 grow basis-60 items-center gap-1 px-1 text-body-sm rounded-t-sm",

										floor,
										active
											? "border-control border-x border-t bg-elevated text-ink data-[glass-active]:bg-row-selected"
											: "text-ink-muted hover:bg-row-hover hover:text-ink",
										dragging === tab.tabId &&
											"border-control bg-row-selected hover:bg-row-selected text-ink",
										// The tab whose actions menu is open keeps a visible selected treatment:
										// the row is a band under the whole strip, and the only other tie to its
										// owner was a `:focus-visible` ring, which a mouse click does not paint
										// (design round 2, D4).
										expandedTabId === tab.tabId &&
											!active &&
											"bg-elevated text-ink",
									)}
								>
									{(tab.audible || tab.muted) && onTabAction && (
										// The mute control (LOH-13 slice C, brief 2.5): a SIBLING
										// of the label button, never inside it (button-in-button
										// is invalid markup, the rule the close control already
										// follows). Shown only while the tab is producing sound
										// or is muted — a silent tab has nothing to silence.
										// THE SHARED BUTTON, NOT A RAW `<button>` (design round 1,
										// D2/D3): the raw form carried its own hover fill
										// (`row-hover` measured ΔE00 0.00 against the active tab's
										// `elevated` in arcade and under the contract's 5.0 floor
										// in 19 of 59 palettes) where every sibling control steps
										// to `accent-wash`; `Button` ghost, `icon-sm` is that
										// sibling register. THE TOOLTIP (UX round 1, U3): every
										// other icon-only control in the strip names itself on
										// hover; this one did not.
										// It does not activate the tab: silencing a background
										// tab must not steal the page being read — the keyboard
										// path to the same verb is the actions menu's own item
										// (UX round 1, U4; design round 1, D1).
										<Tooltip
											content={
												tab.muted
													? t("ui.browser.browser_tab_strip.unmute_tab")
													: t("ui.browser.browser_tab_strip.mute_tab")
											}
										>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={
													tab.muted
														? t("ui.browser.browser_tab_strip.unmute_tab")
														: t("ui.browser.browser_tab_strip.mute_tab")
												}
												aria-pressed={tab.muted}
												tabIndex={active ? 0 : -1}
												data-tour-tag="browser-tab-mute"
												onClick={() =>
													onTabAction(tab.tabId, tab.muted ? "unmute" : "mute")
												}
											>
												{tab.muted ? (
													<VolumeX aria-hidden className="size-3.5" />
												) : (
													<Volume2 aria-hidden className="size-3.5" />
												)}
											</Button>
										</Tooltip>
									)}
									<button
										type="button"
										role="tab"
										id={
											tabPanelId ? `${tabPanelId}-tab-${tab.tabId}` : undefined
										}
										aria-controls={tabPanelId}
										tabIndex={
											tab.tabId ===
											(tabs.some((t) => t.tabId === activeTabId)
												? activeTabId
												: ordered[0]?.tabId)
												? 0
												: -1
										}
										aria-label={accessibleName(tab)}
										onKeyDown={(event) => {
											if (
												event.metaKey ||
												event.ctrlKey ||
												event.altKey ||
												event.shiftKey ||
												event.nativeEvent.isComposing
											)
												return;
											if (event.key === "Delete") {
												if (event.repeat) {
													event.preventDefault();
													event.stopPropagation();
													return;
												}
												event.preventDefault();
												event.stopPropagation();
												runClose(tab.tabId);
												return;
											}
											const at = ordered.findIndex(
												(t) => t.tabId === tab.tabId,
											);
											let next = at;
											if (event.key === "ArrowRight")
												next =
													direction === "rtl"
														? (at + ordered.length - 1) % ordered.length
														: (at + 1) % ordered.length;
											else if (event.key === "ArrowLeft")
												next =
													direction === "rtl"
														? (at + 1) % ordered.length
														: (at + ordered.length - 1) % ordered.length;
											else if (event.key === "Home") next = 0;
											else if (event.key === "End") next = ordered.length - 1;
											else return;
											event.preventDefault();
											event.stopPropagation();
											onActivate(ordered[next].tabId);
											scrollerRef.current
												?.querySelector<HTMLButtonElement>(
													`[data-tab-id="${ordered[next].tabId}"] [role=tab]`,
												)
												?.focus({ preventScroll: true });
										}}
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
										className="flex min-w-0 grow items-center gap-1.5 overflow-hidden py-1.5 text-start focus-visible:-outline-offset-2!"
										data-tour-tag="browser-tab"
									>
										<span
											className="min-w-0 grow truncate rtl:text-right"
											title={tab.title}
											/*
											 * A TAB TITLE IS THE PAGE'S OWN TEXT, not the tab's chrome: a
											 * Latin title inside the RTL tab row put its ellipsis at the
											 * logical end and ate the first character (`3 …rowser
											 * chrome`). `dir="auto"` gives the run its own base direction
											 * from its first strong character, while the badge and close
											 * keep the tab's RTL order (design round 1, D5).
											 */
											dir="auto"
											data-tour-tag="browser-tab-title"
										>
											{tab.title}
										</span>
									</button>
									{/*
									 * THE TAB'S ACTIONS, AS A NATIVE MENU (LOH-13 operator report,
									 * 2026-10-25). The trigger is still the row's leading identity
									 * slot; pressing it (or right-clicking the row) asks main to pop a
									 * native `Menu`, which the OS draws above the `WebContentsView`.
									 * That is why nothing here registers a pause: the page keeps
									 * painting behind the menu, which is exactly what the popout
									 * this replaces could not do.
									 *
									 * `aria-haspopup` is explicit because no Radix trigger adds it
									 * any more, and `aria-expanded` reports the popup's own open
									 * state while the invoke is pending - the strip's only DOM fact
									 * about a menu it does not contain.
									 */}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={t("ui.browser.browser_tab_strip.tab_actions", {
											title: tab.title,
										})}
										aria-haspopup="menu"
										aria-expanded={
											expandedTabId === tab.tabId ? true : undefined
										}
										className="order-first shrink-0 p-0 focus-visible:-outline-offset-2!"
										tabIndex={active ? 0 : -1}
										data-tour-tag="browser-tab-menu"
										onClick={(event) =>
											void openTabActionsMenu(tab, event.currentTarget)
										}
									>
										<TabMark tab={tab} waitingOrdinal={waitingOrdinal} />
									</Button>
									{/* The chord belongs to the ACTIVE tab's control only (design D-PR3, review
										   R5/U5): Cmd+W closes the active tab, so advertising it on an inactive
										   tab's X, or announcing it N times to a screen reader, would name a
										   shortcut that closes a different tab. */}
									<Tooltip
										content={
											active
												? t("ui.browser.browser_tab_strip.close_tab_shortcut", {
														shortcut: closeChord.glyph,
													})
												: t("ui.browser.browser_tab_strip.close_tab")
										}
									>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={t(
												"ui.browser.browser_tab_strip.close_named_tab",
												{ title: tab.title },
											)}
											aria-keyshortcuts={active ? closeChord.aria : undefined}
											onClick={() => runClose(tab.tabId)}
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
												"transition-opacity focus-visible:-outline-offset-2!",
												active ? "opacity-100" : REVEAL_ON_HOVER_OR_FOCUS,
											)}
											tabIndex={active ? 0 : -1}
											data-tour-tag="browser-tab-close"
										>
											<X aria-hidden className="size-3.5" />
										</Button>
									</Tooltip>
									{dropTarget === tab.tabId && dragging !== tab.tabId && (
										<span
											aria-hidden
											className={cn(
												"pointer-events-none absolute inset-y-1 w-0.5 bg-accent",
												dropAfter ? "end-0" : "start-0",
											)}
											data-tour-tag="browser-tab-drop-marker"
										/>
									)}
								</div>
							</Fragment>
						);
					})}
				</div>
				{hasOverflow && (
					<Tooltip
						side="top"
						content={direction === "rtl" ? copy.scrollLeft : copy.scrollRight}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							className="shrink-0 self-center focus-visible:-outline-offset-2!"
							aria-label={
								direction === "rtl" ? copy.scrollLeft : copy.scrollRight
							}
							disabled={
								direction === "rtl" ? !scrollEdges.left : !scrollEdges.right
							}
							onClick={() =>
								scrollerRef.current?.scrollBy({
									left: direction === "rtl" ? -240 : 240,
									behavior: "instant",
								})
							}
						>
							<ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
						</Button>
					</Tooltip>
				)}

				{tabsOffScreen > 0 && (
					/*
					 * THE COUNT IS A CHIP, AND IT NAMES ITSELF (design review round 2, U5, ruled):
					 * this control and the strip's `+` (new tab) used to be two bare plus signs
					 * distinguished only by whether a digit followed one of them. The count now
					 * carries the chip grammar the tab chips use (`border-control`, `text-ink-dim`,
					 * `tabular-nums`) so it reads as a COUNT, it carries no plus of its own (see
					 * its own note below), and its words are in both channels the ruling names: the
					 * control's accessible name and its tooltip.
					 *
					 * THE WORDS ARE `N not shown`, AND THAT IS D10 (design review round 2). They were
					 * `N more tabs`, and the reviewer's reading of the pane's own four-tab frame is why
					 * they changed: THREE titles are readable there while the chip reads `2`, because
					 * the third row is clipped at its right edge and this count is measured from the
					 * rows' own boxes — so a tab lying half outside is counted as not shown, which is
					 * what the measurement above has always meant and what the count exists to
					 * disclose (the width cost D1's ruling accepted). The SENTENCE therefore gives way
					 * to the measure rather than the measure to the sentence: "not shown" is exactly
					 * true of a clipped row and of a hidden one, it is the same sentence the pinned
					 * list's own heading already carries, and the two channels a reader can compare can
					 * no longer disagree. What the chip must not do is read as a count of tabs with no
					 * visible trace, which is what `more tabs` invited beside three readable titles.
					 */
					<Tooltip
						content={t("ui.browser.browser_tab_strip.all_tabs_unshown", {
							count: tabsOffScreen,
						})}
					>
						<Button
							ref={overflowTriggerRef}
							variant="ghost"
							size="icon-sm"
							aria-label={t(
								"ui.browser.browser_tab_strip.all_tabs_unshown_accessible",
								{ count: tabsOffScreen },
							)}
							aria-expanded={overflowOpen}
							onClick={() => setOverflowOpen((open) => !open)}
							data-tour-tag="browser-tab-overflow"
							className={cn("shrink-0 gap-1 self-center px-1")}
						>
							<ChevronDown aria-hidden="true" />
							{/*
							 * THE COUNT IS THE NUMBER, WITHOUT A PLUS, and that is the ruling's point
							 * rather than a flourish: with `+4` beside the new-tab control's `+`, the
							 * two still differed by whether a digit followed the plus — one glyph
							 * apart, which is the sentence U5 is written from. The chip keeps its
							 * grammar (`border-control`, `ink-dim`, tabular) and keeps its count; what
							 * it loses is the one character that made it a second plus sign, so the
							 * only `+` in this corner is the control that opens one more tab. The
							 * words are still in both read channels, and they are the pinned list's own
							 * sentence (`All tabs, N not shown`, D10): the control says it in its
							 * accessible name and in its tooltip, and the list's heading says it above
							 * the rows it is counting.
							 */}
							<span
								aria-hidden="true"
								className={cn(
									"min-w-6 rounded-sm border border-control px-1 text-center text-meta text-ink-dim tabular-nums",
								)}
							>
								{tabsOffScreen}
							</span>
						</Button>
					</Tooltip>
				)}
				{tabs.length > 0 && (
					<Tooltip
						content={`${newTabLabel} (${newChord.glyph})`}
						collisionPadding={{ right: 8 }}
						side="top"
					>
						<Button
							variant="ghost"
							size="icon-sm"
							className="ms-2 shrink-0 self-center focus-visible:-outline-offset-2!"
							aria-label={newTabLabel}
							aria-keyshortcuts={newChord.aria}
							onClick={onNewTab}
							data-tour-tag="browser-new-tab"
						>
							<Plus aria-hidden className="size-4" />
						</Button>
					</Tooltip>
				)}
			</div>
			{overflowOpen && (
				/*
				 * THE BAND ROW THE PINNED CONTROL OPENS, and the reason it is a row and not
				 * a menu: a Radix menu anchored in the band paints DOWNWARD into the content
				 * rect, where the native view wins. Menus now register a MEASURED pause
				 * (S5), so a crossing panel would hide the page to be readable — an oxymoron
				 * for a list whose job is to be read BESIDE the page. This row is outside
				 * that rectangle, so nothing here can be occluded and nothing needs
				 * suppressing; the strip grows by its height and
				 * the page's own rectangle shrinks by exactly the same amount, because the
				 * content element is measured by a `ResizeObserver` and the host re-bounds the
				 * view. The same trade the dock makes — the page narrows rather than hides —
				 * and what keeps THIS list a band row: a list to read beside the page is in
				 * flow; the actions menu, which floats, registers with the overlay policy
				 * instead (2026-09-28, see the component docstring).
				 *
				 * BOUNDED, and that is not cosmetic: 20 tabs of sections would otherwise push
				 * the page off screen, which is the failure the dock's design exists to avoid
				 * (design risk 7). `max-h-36` plus the row's own scroll keeps the band a band.
				 *
				 * FOCUS MOVES IN ON OPEN AND BACK TO THE TRIGGER ON CLOSE (the effects above),
				 * so a keyboard user is not dropped to `<body>` by either path — the UX round
				 * 2 (U9) class of defect, which both of these surfaces answer for.
				 */
				<div
					ref={overflowRowRef}
					tabIndex={-1}
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.stopPropagation();
							closeOverflow();
						}
					}}
					className="relative flex flex-col border-control border-t bg-surface py-1 focus:outline-none"
					data-tour-tag="browser-tab-overflow-list"
				>
					{/* THE HEADING IS TEXT ONLY, AND THE DISMISS COMES LAST (review round 1, U4):
					    in DOM order the dismiss used to precede every row, so the first Tab a
					    keyboard user pressed after opening the list reached the control that
					    CLOSES it rather than the first tab — and the whole point of the control is
					    to reach the tabs. It keeps the top-right geometry it had (`absolute`) so
					    the band's pixels do not move, and it keeps its own place in the tab order
					    by being the last thing the band renders. */}
					<div className="flex h-7 items-center px-2">
						<span className="text-meta text-ink-dim">
							{t("ui.browser.browser_tab_strip.all_tabs_unshown_accessible", {
								count: tabsOffScreen,
							})}
						</span>
					</div>
					<div ref={overflowScrollerRef} className="max-h-36 overflow-y-auto">
						{overflowGroups.map((group, runIndex) => (
							<div
								key={`${group.sessionId ?? "unattributed"}-${runIndex}`}
								data-tour-tag="browser-tab-overflow-section"
							>
								{/* A section's heading is drawn under the same rule as the strip's
								    chips: two conversations need naming, one does not. */}
								{showGroupLabels && (
									<div className="flex items-center gap-1.5 px-2 pt-1 text-meta text-ink-dim">
										<MessagesSquare aria-hidden className="size-3.5" />
										<span
											className="truncate"
											title={groupLabelName(group, sessions)}
										>
											{groupLabelName(group, sessions)}
										</span>
										<span className="tabular-nums">{group.tabs.length}</span>
									</div>
								)}
								{group.tabs.map((tab) => (
									<button
										type="button"
										key={tab.tabId}
										onClick={() => {
											closeOverflow();
											onActivate(tab.tabId);
										}}
										aria-current={tab.tabId === activeTabId}
										data-tab-id={tab.tabId}
										className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-start text-body-sm text-ink-muted hover:bg-row-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
										data-tour-tag="browser-tab-overflow-row"
									>
										<Check
											aria-hidden
											className={cn(
												"size-3.5 shrink-0",
												tab.tabId !== activeTabId && "invisible",
											)}
										/>
										<TabMark tab={tab} />
										<span
											className="min-w-0 grow truncate rtl:text-right"
											dir="auto"
											title={tab.title}
										>
											{tab.title}
										</span>
									</button>
								))}
							</div>
						))}
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.browser.browser_tab_strip.hide_all_tabs")}
						onClick={closeOverflow}
						className="absolute top-1 end-2"
						data-tour-tag="browser-tab-overflow-dismiss"
					>
						{/* One shape for "this band row goes away": the pinned list is the
						    only band row that still carries the chevron — the actions menu
						    dismisses like every menu (Escape, a click away, or the item
						    itself). */}
						<ChevronUp aria-hidden className="size-3.5" />
					</Button>
				</div>
			)}
			{/*
			 * THE PINNED WAY TO REACH ANY TAB, IN THE BAND (design R4, fix 2).
			 *
			 * IT WAS A RADIX DROPDOWN, AND THE MENU WAS THE BUG. A dropdown anchored
			 * in the band paints DOWNWARD into the content rect, and the native view
			 * wins there: no z-index beats a native sibling view, and an unregistered
			 * menu is invisible over the page. So it is a BAND ROW instead — the same
			 * shape the actions row had before it became a registered popout
			 * (2026-09-28): the pinned control is the token "the user can always reach
			 * any tab" is spent on, so it cannot open something that may not be
			 * visible, at precisely the scale it is for.
			 *
			 * SO IT IS A BAND ROW NOW: the strip grows by its height, the page's rect
			 * shrinks by the same amount (`ResizeObserver` in `browser-surface.tsx`),
			 * and NOTHING IS OCCLUDED AND NOTHING IS SUPPRESSED. That is the trade the
			 * dock's design already makes, and the reason the page narrows rather than
			 * hides — while a menu that floats over the page (the tab actions) hides
			 * the view and shows the paused note instead, because a floating panel
			 * cannot take the in-flow trade.
			 *
			 * IT IS THE CANVAS'S OWN ANSWER to the same problem (`canvas-tabs.tsx`:
			 * "scrolling sideways to find a file is a fallback, not the only route"), and
			 * it sits OUTSIDE the scroller so it cannot itself be scrolled out of reach.
			 * IT APPEARS ONLY WHEN SOMETHING IS MISSING, AND IT COUNTS (QA round 1, Q2):
			 * the count is its own text, and a strip that fits draws no control at all -
			 * which is why the gate is `tabsOffScreen` and not `tabs.length > 1`.
			 *
			 * SECTIONED BY CONVERSATION, because at the scale this control exists for
			 * — 20 tabs over six conversations — a flat list of 20 names is the same
			 * problem as the strip, one level up. The sections come from the SAME
			 * grouping the strip renders (`groups`, above), so a tab cannot be in one
			 * conversation's section here and another's run there.
			 */}
		</div>
	);
};
