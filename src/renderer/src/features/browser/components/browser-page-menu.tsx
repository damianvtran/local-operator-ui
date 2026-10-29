import { Badge, Button, Tooltip, countLabel } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { chordCaption } from "@shared/keymap/keymap-chord";
import {
	chordPlatform,
	navigationShortcutLabel,
} from "@shared/navigation-gesture";
import {
	ArrowRight,
	FolderOpen,
	Home,
	MoreHorizontal,
	Printer,
	Search,
	ShieldCheck,
} from "lucide-react";
import type { FC, Ref } from "react";
import { useEffect, useRef, useState } from "react";

/**
 * The page menu: what is left after the address row became permanent.
 *
 * THE ROW IS THE CONTROL SURFACE (S5). Back, Forward, Reload/Stop, Home, the
 * field, Approvals and the site mark all live in the row, so repeating them here
 * would be two affordances for one action — the thing "conventional browser
 * chrome" exists to avoid. What remains is what has no row control: Find, Print,
 * Reset zoom when it is off 100%, the downloads folder when one is known, and
 * Approvals — which is also the way back to site access when nothing is pending.
 * At wide widths the row's shield opens the native card (or, with nothing
 * pending, the Approvals dialog); below 300px that control is folded and this
 * item is the route to the grants. With the native card it ALWAYS opens the
 * Approvals dialog (S6d), so revoke / forget / clear stay reachable while a
 * request is pending; on the kill-switch fallback it toggles the dock.
 *
 * FOLDED CONTROLS COME BACK HERE. In a narrow pane the row sheds Home (below
 * 360px) and then Forward (below 300px) — see `browser-surface.tsx`'s width
 * tiers — and this menu is where those two actions remain reachable. They are
 * rendered only when the row has actually folded them, so the menu never
 * duplicates something visible beside it.
 *
 * WHY IT HIDES THE PAGE: the panel is a `DropdownMenuContent`, whose primitive
 * registers a MEASURED pause in the policy (`src/renderer/src/shared/
 * browser-view-policy.ts`). The row's bottom edge is the page's top edge, so a
 * panel opening downward from the trigger necessarily intersects the native view
 * — and the view must yield or the menu is partly invisible. Measuring (rather
 * than an unconditional `useSuppressBrowserView` here) is what keeps the rule
 * honest for every other menu in the app, including ones wholly inside the
 * chrome band.
 */
export interface BrowserPageMenuProps {
	disabled: boolean;
	canGoForward: boolean;
	pageZoom: number;
	waitingCount: number;
	downloadsDir: string | null;
	/** True when the row has folded Forward into this menu (narrow pane). */
	showForward: boolean;
	/** True when the row has folded Home into this menu (narrow pane). */
	showHome: boolean;
	onForward: () => void;
	onHome: () => void;
	onFind: () => void;
	onPrint: () => void;
	onResetZoom: () => void;
	onOpenDownloads: () => void;
	/** Returns whether this request OPENS the dock: only an open declines Radix's
	 * focus return; a request that closes an already-open dock must let focus go
	 * back to this trigger (round 3, U16). */
	onOpenApprovals: () => boolean;
	/** The menu has fully closed after an opening request; focus the dock heading
	 * now, not while Radix is still moving focus (round 3, U13). */
	onDockOpened?: () => void;
	/** The trigger node, so a caller can return focus to it when the control that
	 * opened the menu is gone (the folded Approvals row). */
	triggerRef?: Ref<HTMLButtonElement>;
	/** Approvals is folded into this menu at narrow widths; carry its count on the
	 * trigger so the signal is not lost with the row control (round-2 U12). */
	showApprovalsFolded: boolean;
	/** True when a page control here can run. False on the start/failure page,
	 * where main refuses them; the items are disabled rather than painting the
	 * refusal sentence (round-4 Q4-3). */
	canControlPage: boolean;
}

export const BrowserPageMenu: FC<BrowserPageMenuProps> = ({
	disabled,
	canGoForward,
	pageZoom,
	waitingCount,
	downloadsDir,
	showForward,
	showHome,
	onForward,
	onHome,
	onFind,
	onPrint,
	onResetZoom,
	onOpenDownloads,
	onOpenApprovals,
	onDockOpened,
	triggerRef,
	showApprovalsFolded,
	canControlPage,
}) => {
	const [open, setOpen] = useState(false);
	/* A tooltip that opens on the focus the menu returns must not read as a
	   stray label after an item was chosen (round-2 D12): suppress it through the
	   close and for a moment after, so the focus event cannot open a panel. */
	const [returning, setReturning] = useState(false);
	const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	/* The post-close tick that hands focus to the dock must not fire after this
	   menu unmounts (round-4 U24). */
	const dockOpenTimer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (quietTimer.current) clearTimeout(quietTimer.current);
			if (dockOpenTimer.current) clearTimeout(dockOpenTimer.current);
		},
		[],
	);
	/* The dock is opened by an item, but Radix's close auto-focus returns focus to
	   THIS trigger afterwards and beats the dock's own heading focus (round-2
	   Q2-2/U13). The item sets this flag; the close handler then declines the
	   focus move, leaving the heading focus the dock just took. */
	const dockRequested = useRef(false);
	const platform = chordPlatform();
	// The pointer is the only way a mouse user meets Find, Print and Zoom, so
	// each row that HAS a chord says it (UX U6).
	const forward = navigationShortcutLabel("forward", platform === "mac");
	const find = chordCaption("primary+f", platform).glyph;
	const zoomReset = chordCaption("primary+0", platform).glyph;
	const folded = showForward || showHome;
	/* The folded trigger is the only route to the queue, so its NAME carries the
	   count it shows (round 3, U15). */
	/* U22: no hardcoded separator copy. When the folded trigger is also the
	   count's only home (U15) the waiting sentence is its name outright; the
	   "Page options" string remains the tooltip and the wide-path name. */
	const pageMenuLabel =
		showApprovalsFolded && waitingCount > 0
			? t("ui.browser.browser_url_bar.approvals_waiting", {
					count: waitingCount,
				})
			: t("ui.browser.browser_url_bar.page_menu");
	return (
		<DropdownMenu
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next) {
					if (quietTimer.current) clearTimeout(quietTimer.current);
					setReturning(false);
					return;
				}
				setReturning(true);
				quietTimer.current = setTimeout(() => setReturning(false), 500);
			}}
		>
			<Tooltip
				content={t("ui.browser.browser_url_bar.page_menu")}
				side="top"
				suppressed={open || returning}
				discardWhileSuppressed={open || returning}
				disableHoverableContent
			>
				<DropdownMenuTrigger asChild>
					<Button
						ref={triggerRef}
						variant="ghost"
						size="icon-sm"
						className="relative shrink-0"
						aria-label={pageMenuLabel}
						disabled={disabled}
						data-tour-tag="browser-page-menu"
					>
						<MoreHorizontal aria-hidden className="size-4" />
						{showApprovalsFolded && waitingCount > 0 && (
							<span className="pointer-events-none absolute -top-0.5 -right-0.5">
								<Badge
									variant="attention"
									shape="pill"
									size="count"
									className="ring-2 ring-elevated"
									aria-hidden="true"
									data-tour-tag="browser-approvals-folded-badge"
								>
									{countLabel(waitingCount, 99)}
								</Badge>
							</span>
						)}
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				sideOffset={4}
				onCloseAutoFocus={(event) => {
					if (!dockRequested.current) return;
					dockRequested.current = false;
					event.preventDefault();
					/* The item unmounts before this handler, so focus is already on
					   `<body>`; the dock's heading takes it on the next tick, after
					   Radix has finished closing. */
					dockOpenTimer.current = window.setTimeout(() => onDockOpened?.(), 0);
				}}
			>
				{folded && (
					<>
						{showForward && (
							<DropdownMenuItem
								disabled={!canGoForward}
								onSelect={onForward}
								data-tour-tag="browser-page-menu-forward"
							>
								<ArrowRight aria-hidden className="size-4" />
								{t("ui.browser.browser_url_bar.forward")}
								<DropdownMenuShortcut>{forward}</DropdownMenuShortcut>
							</DropdownMenuItem>
						)}
						{showHome && (
							<DropdownMenuItem
								onSelect={onHome}
								data-tour-tag="browser-page-menu-home"
							>
								<Home aria-hidden className="size-4" />
								{t("ui.browser.browser_url_bar.home")}
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
					</>
				)}
				<DropdownMenuItem
					disabled={!canControlPage}
					onSelect={onFind}
					data-tour-tag="browser-find"
				>
					<Search aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.find_in_page")}
					<DropdownMenuShortcut>{find}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canControlPage}
					onSelect={onPrint}
					data-tour-tag="browser-print"
				>
					<Printer aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.print_page")}
				</DropdownMenuItem>
				{pageZoom !== 1 && (
					<DropdownMenuItem
						disabled={!canControlPage}
						onSelect={onResetZoom}
						data-tour-tag="browser-zoom"
					>
						{t("ui.browser.browser_url_bar.page_zoom_reset", {
							zoom: Math.round(pageZoom * 100),
						})}
						<DropdownMenuShortcut>{zoomReset}</DropdownMenuShortcut>
					</DropdownMenuItem>
				)}
				{downloadsDir && (
					<DropdownMenuItem
						onSelect={onOpenDownloads}
						data-tour-tag="browser-downloads-folder"
					>
						<FolderOpen aria-hidden className="size-4" />
						{t("ui.browser.browser_file_transfer_row.open_downloads_folder")}
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onSelect={() => {
						dockRequested.current = onOpenApprovals();
					}}
					data-tour-tag="browser-approvals"
				>
					<ShieldCheck aria-hidden className="size-4" />
					{waitingCount > 0
						? t("ui.browser.browser_url_bar.approvals_waiting", {
								count: waitingCount,
							})
						: t("ui.browser.chrome.approvals")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
