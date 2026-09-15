import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Bot, Globe, MoreHorizontal, Plus, RotateCw, X } from "lucide-react";
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

	const closeActions = useCallback(() => setActionsTabId(null), []);

	// A tab that is closed, or that stops existing, must not leave an action row
	// pointing at nothing.
	const actionsTab = tabs.find((tab) => tab.tabId === actionsTabId) ?? null;

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
					className="flex min-w-0 grow items-stretch overflow-x-auto -mb-px"
				>
					{tabs.map((tab, index) => {
						const active = tab.tabId === activeTabId;
						const waitingOrdinal = waiting[tab.tabId];
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
										 * THE WIDTH POLICY IS THE TITLE'S (design round 3, D13). Tabs SHARE
										 * the row they have (`basis-32`, `grow`, half the strip at most,
										 * `min-w-32` before the row scrolls), which is what a tab strip is for:
										 * telling tabs apart is the job, and the name is how the user tells
										 * them apart. Chrome shrinks tabs below 128px; this strip cannot,
										 * because the mark, the chips and the buttons need the room — a
										 * deliberate difference, stated so it is not "fixed" later.
										 */
										"group relative flex min-w-32 max-w-[50%] grow basis-32 items-center gap-1.5 px-2 text-body-sm rounded-t-sm",
										active
											? "border-control border-x border-t bg-canvas text-ink"
											: "text-ink-muted hover:bg-elevated hover:text-ink",
									)}
								>
									<button
										type="button"
										role="tab"
										aria-selected={active}
										onClick={() => onActivate(tab.tabId)}
										className="flex min-w-0 grow items-center gap-1.5 py-1.5 text-left"
										data-tour-tag="browser-tab"
									>
										<TabMark tab={tab} />
										{/*
										 * `grow` so the title takes whatever the chrome leaves and the
										 * marker/chips/buttons sit at the tab's edge, and the native
										 * `title` so a truncated name is still recoverable with the pointer
										 * - which is what D13 asked for alongside the width fix. The full
										 * text is in the DOM either way, so assistive technology already
										 * reads the whole name; this is the mouse's half of it.
										 */}
										<span className="min-w-0 grow truncate" title={tab.title}>
											{tab.title}
										</span>
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
											<span className="shrink-0 rounded-sm bg-sunken px-1 text-meta text-ink-muted">
												Shared
											</span>
										)}
										{tab.restored && (
											// Restored tabs are worth marking, because a restored tab is a
											// FRESH navigation to the same URL (design 7.3): a page that
											// logged out since shows logged out, and saying "restored"
											// pre-empts the "why am I signed out" question.
											<span className="shrink-0 text-meta text-ink-dim">
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
												Waiting {waitingOrdinal}
											</span>
										)}
									</button>
									{/* The actions trigger. The menu it used to open painted into the
									    content rect, where the native view occludes it (§6), so this
									    now expands the row's actions inside the band instead. */}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Tab actions for ${tab.title}`}
										aria-expanded={actionsTabId === tab.tabId}
										onClick={() =>
											setActionsTabId((current) =>
												current === tab.tabId ? null : tab.tabId,
											)
										}
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
											// opacity step, never a layout shift.
											className={cn(
												"transition-opacity",
												active
													? "opacity-100"
													: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
											)}
											data-tour-tag="browser-tab-close"
										>
											<X aria-hidden className="size-3.5" />
										</Button>
									</Tooltip>
									{active && (
										// THE NOTCH. The strip's rule runs along the whole band, and the
										// active tab paints the page's own ground across its own bottom
										// edge so the tab and the content area read as one sheet. It is
										// one pixel of `canvas` — the same role the tab's fill and the
										// content area use — and it is why the strip keeps its own
										// `border-b`: the rule continues everywhere except here.
										<span
											aria-hidden
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
				<div
					className="flex flex-wrap items-center gap-2 border-control border-t bg-surface px-2 py-1"
					data-tour-tag="browser-tab-actions"
				>
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
							Watch this tab
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
							Let an agent use this tab…
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
							Stop letting the agent use this tab
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
						Close tab
					</Button>
					<div className="grow" />
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close tab actions"
						onClick={closeActions}
						data-tour-tag="browser-tab-actions-dismiss"
					>
						<X aria-hidden className="size-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
};
