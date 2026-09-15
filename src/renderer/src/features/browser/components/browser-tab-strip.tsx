import { Button, Tooltip } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { cn } from "@shared/lib/utils";
import { Bot, Globe, MoreHorizontal, Plus, RotateCw, X } from "lucide-react";
import type { FC } from "react";
import type { BrowserTabView } from "../hooks/use-browser-chrome";

/**
 * The tab strip. Design: docs/design/ui-browser-tab.md 6.1 (the controls), 6.2
 * (one strip, two actors), 6.3 (hand-over), 6.5 (caps), 11.2 (branding roles).
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
 * BRANDING (design 11.2, `docs/branding.md`): the strip is a CONTROL, so its
 * boundary against the content area is `border-control` rather than `hairline`;
 * the agent marker is the accent, spent once in the band for exactly the state
 * the user must not miss; the tab's own ground is `surface` with the active tab
 * stepped up to `elevated`, which is how this system says "this one is selected"
 * without a border or a shadow.
 */

export interface BrowserTabStripProps {
	tabs: BrowserTabView[];
	activeTabId: number | null;
	loading: boolean;
	/** Tabs sitting on an origin with a pending approval request. The strip marks
	 * them as waiting (design 9.3), so the user can see WHICH tab is blocked rather
	 * than only that something is blocked. */
	waitingTabIds: number[];
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
 * spinner while the tab loads, a session mark on an agent tab, a page glyph
 * otherwise. Inventing a favicon fetcher would be a network path this feature
 * has no other use for. */
const TabMark: FC<{ tab: BrowserTabView; loading: boolean }> = ({
	tab,
	loading,
}) => {
	if (loading && tab.active) {
		return (
			<RotateCw
				aria-hidden
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
	loading,
	waitingTabIds,
	onActivate,
	onClose,
	onNewTab,
	onHandOver,
	onRevokeHandOver,
}) => {
	return (
		<div
			// `border-control`, not `hairline`: this is the strip's only boundary
			// against the page area, so it is structural and carries a 3:1 floor
			// (design 11.2).
			className="flex min-h-10 items-stretch gap-1 border-control border-b bg-sunken px-2 py-1"
			role="tablist"
			aria-label="Browser tabs"
			data-tour-tag="browser-tab-strip"
		>
			<div className="flex min-w-0 grow items-stretch gap-1 overflow-x-auto">
				{tabs.map((tab) => {
					const active = tab.tabId === activeTabId;
					const waiting = waitingTabIds.includes(tab.tabId);
					return (
						<div
							key={tab.tabId}
							className={cn(
								// A tab is a control, so it has a fill and a boundary: the
								// active one steps up a ground rather than gaining a shadow.
								"group flex max-w-56 min-w-32 items-center gap-1.5 rounded-sm px-2",
								"border border-transparent text-body-sm",
								active
									? "bg-elevated text-ink"
									: "bg-surface text-ink-muted hover:bg-elevated hover:text-ink",
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
								<TabMark tab={tab} loading={loading} />
								<span className="min-w-0 truncate">{tab.title}</span>
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
								{waiting && (
									// The tab is parked on an origin the agent has not been approved
									// for. Marked on the TAB rather than only in the band, because with
									// several tabs open the band's sentence names an origin and the user
									// needs to know which tab it belongs to (design 9.3).
									<span
										className="shrink-0 rounded-sm border border-control bg-warning-wash px-1 text-meta text-ink"
										data-tour-tag="browser-tab-waiting"
									>
										Waiting
									</span>
								)}
							</button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Tab actions for ${tab.title}`}
										data-tour-tag="browser-tab-menu"
									>
										<MoreHorizontal aria-hidden className="size-3.5" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start">
									<DropdownMenuItem onSelect={() => onActivate(tab.tabId)}>
										Switch to this tab
									</DropdownMenuItem>
									{/*
									 * The hand-over affordances live here rather than in the band
									 * because a hand-over is a statement about ONE tab, and the strip
									 * is where tabs are named (design 6.3).
									 */}
									{tab.owner === "user" && !tab.handedOver && (
										<DropdownMenuItem onSelect={() => onHandOver(tab)}>
											Let an agent use this tab…
										</DropdownMenuItem>
									)}
									{(tab.handedOver || tab.owner === "agent") && (
										<DropdownMenuItem
											onSelect={() => onRevokeHandOver(tab.tabId)}
										>
											Stop letting the agent use this tab
										</DropdownMenuItem>
									)}
									<DropdownMenuItem onSelect={() => onClose(tab.tabId)}>
										Close tab
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
							<Tooltip content="Close tab">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Close ${tab.title}`}
									onClick={() => onClose(tab.tabId)}
									data-tour-tag="browser-tab-close"
								>
									<X aria-hidden className="size-3.5" />
								</Button>
							</Tooltip>
						</div>
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
	);
};
