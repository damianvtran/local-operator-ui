import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	Bot,
	ChevronUp,
	Globe,
	MoreHorizontal,
	Plus,
	RotateCw,
	X,
} from "lucide-react";
import type { FC } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { BrowserTabView } from "../hooks/use-browser-chrome";

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
	activeTabId: number | null;
	/** tabId -> the ordinal of the live approval request its origin is parked on.
	 * Built from the same numbered rows as the tray (`approval-queue-model.ts`), so
	 * `Waiting 2` here and chip [2] there are the same request by construction
	 * (§5.2). */
	waiting: Record<number, number>;
	onActivate: (tabId: number) => void;
	onClose: (tabId: number) => void;
	onNewTab: () => void;
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

export const BrowserTabStrip: FC<BrowserTabStripProps> = ({
	tabs,
	activeTabId,
	waiting,
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
			<div className="flex items-stretch gap-0 px-2 pt-1">
				<div
					ref={scrollerRef}
					// `-mb-px` extends the scroll container's clip box 1px down, over the
					// strip's bottom rule, so the active tab's notch can paint ON that rule
					// rather than being clipped by the scroll container one pixel above it.
					className="flex min-w-0 grow items-stretch overflow-x-auto overflow-y-hidden -mb-px"
				>
					{tabs.map((tab, index) => {
						const active = tab.tabId === activeTabId;
						const waitingOrdinal = waiting[tab.tabId];
						/*
						 * THE FLOOR IS SIZED FOR THE CHIPS THE ROW ACTUALLY CARRIES, AND FOR THE
						 * CLUSTER THE ACTIVE ONE CARRIES IN FLOW (review rounds 5 and 6).
						 *
						 * THE COMBINATIONS ARE ENUMERATED FROM THE REGISTRY, NOT FROM THE STORY.
						 * Round 4 assumed the five markers were mutually exclusive; `Shared` is not
						 * exclusive with `Agent`, it is IMPLIED by it - `handOver` sets
						 * `owner = "agent"` AND `handedTo = sessionId` (`registry.ts:369-372`),
						 * `host.ts:549` projects `handedOver`, and the two chips render on
						 * independent conditions, so every handed-over tab carries both.
						 * `revokeHandOver` clears both together; `restored` is set only at creation,
						 * for a tab that is always user-owned, and is never cleared - so
						 * `Shared => Agent` and `Agent AND Restored => Shared`, and `failed` and a
						 * waiting `Request n` stack on either. Reachable, by count:
						 *
						 *   1-2 chips  Agent, Shared, Restored, Failed, Request n, and the pairs
						 *              those implications allow
						 *   3 chips    Agent + Shared + (Failed | Request n),
						 *              Agent + Shared + Restored,
						 *              Agent + Failed + Request n,
						 *              Restored + Failed + Request n
						 *   4 chips    Agent + Shared + Failed + Request n,
						 *              Agent + Shared + Restored + Failed,
						 *              Agent + Shared + Restored + Request n
						 *   5 chips    Restored + Agent + Shared + Failed + Request n
						 *
						 * MEASURED CHIP WIDTHS (`px-1` pills): Agent 43, Shared 43, Restored 48,
						 * Failed 48, Request n 62. The widest set at each count is therefore 62,
						 * 105, 158, 196, 244. `px-2` is 16px TOTAL, the mark is 16px, and each of
						 * the chips+1 gaps is 6px, so a row's title is
						 * `floor - 16 - 16 - chips - 6 x (chips + 1)` and the active row pays a
						 * further 68px for the cluster in flow plus the gap before it:
						 *
						 *   inactive   0:176->144  1:224->118  2:288->133  3:320->106
						 *              4:384->126  5:384->72   (the five-chip title yields)
						 *   active     0:224->124  1:320->146  2:384->161  3:384->102
						 *              4:416->90   5:480->100
						 *
						 * EVERY ACTIVE ROW CLEARS THE 85px THIS FILE PROMISES, at every count, and
						 * the active rows are the ones that take steps past the spacing scale:
						 * `{Agent, Shared, Failed, Request n}` is the tab a user clicks precisely
						 * BECAUSE it needs approval, and at the standard `min-w-96` its title was
						 * 58px - under the 60px floor the harness itself asserts - so it is
						 * `min-w-[26rem]`, and the widest row the projection can produce, active, is
						 * `min-w-[30rem]` for 100px of title. Named as steps past the scale rather
						 * than pretending a standard step fits. Round 6, MAJOR 2.
						 *
						 * THE INACTIVE FIVE-CHIP ROW IS WHERE THE TITLE YIELDS, and that is the
						 * deliberate half. Fitting 244px of chips plus the mark and the gaps at 85px
						 * of title needs a 465px floor, and handing one pathological state -
						 * restored, handed over, failed AND waiting at once, and NOT the tab the user
						 * is looking at - that much of the strip's scroll order, ahead of every
						 * ordinary tab, is a worse trade than the title yielding: the
						 * `browser-tab-strip--worst-case` frame is that row at 72px, reading
						 * `Check...`. Dropping a chip was the other option and it hides a state the
						 * design round approved. Its chips stay whole - 312px of content inside
						 * 384px - and the BUTTON clips at its own edge (above) as the backstop that
						 * keeps a chip from ever painting over the neighbouring tab, the
						 * `bg-canvas`-over-`bg-canvas` defect design round 3 filed as MAJOR. At the
						 * widths measured here that clip cannot fire: the widest reachable content
						 * is 380px against a 416px floor, so it is a backstop for a sixth marker or
						 * a wider chip, NOT the evidence for the sizes above - the sizes are the
						 * evidence (review round 6, MINOR 2).
						 *
						 * Roles rather than computed pixels: the contract's spacing steps are the
						 * vocabulary here, and the one arbitrary length is called out above.
						 */
						const chips = [
							tab.owner === "agent",
							tab.handedOver,
							tab.restored,
							tab.failed,
							waitingOrdinal !== undefined,
						].filter(Boolean).length;
						const floor = active
							? chips >= 5
								? "min-w-[30rem]"
								: chips === 4
									? "min-w-[26rem]"
									: chips === 3
										? "min-w-96"
										: chips === 2
											? "min-w-96"
											: chips === 1
												? "min-w-80"
												: "min-w-56"
							: chips >= 4
								? "min-w-96"
								: chips === 3
									? "min-w-80"
									: chips === 2
										? "min-w-72"
										: chips === 1
											? "min-w-56"
											: "min-w-44";
						const previous = index > 0 ? tabs[index - 1] : null;
						// The divider belongs to the gap between two inactive tabs: the active
						// one is continuous with the page, so no rule may run into it.
						const showDivider =
							previous !== null && !active && previous.tabId !== activeTabId;
						return (
							<Fragment key={tab.tabId}>
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
										{tab.owner === "agent" && (
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
										{tab.handedOver && (
											// One pill shape for every state marker, differing by role only
											// (design round 2, D11): `Restored` used to be bare dim text with no
											// frame at all, which read as a caption beside the four framed
											// markers rather than as a state.
											<span className="shrink-0 rounded-sm border border-control px-1 text-meta text-ink-muted">
												Shared
											</span>
										)}
										{tab.restored && (
											// Restored tabs are worth marking, because a restored tab is a
											// FRESH navigation to the same URL (design 7.3): a page that
											// logged out since shows logged out, and saying "restored"
											// pre-empts the "why am I signed out" question.
											<span className="shrink-0 rounded-sm border border-control px-1 text-meta text-ink-dim">
												Restored
											</span>
										)}
										{tab.failed && (
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
										{waitingOrdinal !== undefined && (
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
												? "relative flex shrink-0 items-center gap-1.5"
												: "absolute inset-y-0 right-1 flex items-center gap-1.5",
											// Its own actions row being open is not a hover, so the ground
											// and the reveal follow that state explicitly.
											!active &&
												"group-hover:bg-elevated group-focus-within:bg-elevated",
											actionsTabId === tab.tabId && !active && "bg-elevated",
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
											// active marked row needs the wider floor above.
											className={cn(
												"transition-opacity",
												actionsTabId === tab.tabId
													? "text-ink"
													: "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
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
												// round 3, MAJOR).
												className={cn(
													"transition-opacity",
													active
														? "opacity-100"
														: "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
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
				<Tooltip content="New tab">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="New tab"
						onClick={onNewTab}
						data-tour-tag="browser-new-tab"
					>
						<Plus aria-hidden className="size-4" />
					</Button>
				</Tooltip>
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
