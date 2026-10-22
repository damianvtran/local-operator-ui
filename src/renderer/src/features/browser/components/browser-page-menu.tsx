import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { Button, Tooltip } from "@shared/components/ui";
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
import { cn } from "@shared/lib/utils";
import {
	chordPlatform,
	navigationShortcutLabel,
} from "@shared/navigation-gesture";
import {
	ArrowLeft,
	ArrowRight,
	FolderOpen,
	Home,
	MoreHorizontal,
	Printer,
	RotateCw,
	Search,
	ShieldCheck,
	X,
} from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { PAGE_MENU_SURFACE_TAG } from "../model/floating-chrome";

/**
 * The page menu: everything the 104px dock and the old toolbar row carried that
 * has no chord or strip control of its own.
 *
 * WHY A MENU AND WHY IT HIDES THE PAGE (design §8). The controls used to live in
 * an always-visible toolbar, and the brief removes that bar at rest. A Radix menu
 * anchored in the strip paints DOWNWARD into the content rect, where the native
 * `WebContentsView` wins over all DOM — so this menu registers the same view
 * suppression the tab-actions menu does (`browser-tab-actions`): the page is
 * hidden for as long as the panel is open, and the panel is therefore visible.
 * The address popout is different: its field row is over the STRIP, outside the
 * page rect, so it never needs suppression.
 *
 * THE SUPPRESSION MUST NOT LOWER THE POPOUT. `useSuppressBrowserView(open)`
 * flips the registry's presentation, and the surface used to read that as "the
 * layout moved" and dismiss the field row — so opening this menu from the popout
 * closed both (agent review round 1, MAJOR-1). The controller now keys the
 * dismissal on the tab and rectangle, never on presentation, and the surface's
 * blur rule admits focus that lands in this portal.
 *
 * ONE IMPLEMENTATION for the two surfaces that need it (the strip's trailing
 * cluster and the popout's ⋯). The popout passes `placement="popout"` only for
 * its tighter trigger; the item list cannot drift between them.
 */
export interface BrowserPageMenuProps {
	placement: "strip" | "popout";
	disabled: boolean;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	pageZoom: number;
	waitingCount: number;
	downloadsDir: string | null;
	onAddress: () => void;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onStop: () => void;
	onHome: () => void;
	onFind: () => void;
	onPrint: () => void;
	onResetZoom: () => void;
	onOpenDownloads: () => void;
	onOpenApprovals: () => void;
	/**
	 * The popout's owner needs the open state: while this menu is open it owns
	 * Escape, and the row must not read the menu's focus as leaving (agent review
	 * round 1, MAJOR-1; UX U3).
	 */
	onOpenChange?: (open: boolean) => void;
	/**
	 * Where focus goes when the panel closes. Radix returns it to the trigger,
	 * which for the popout is a control INSIDE the row — so choosing Address
	 * raised the field and the close immediately moved focus back out of it
	 * (UX U2's control case). The popout supplies its input.
	 */
	onCloseAutoFocus?: (event: Event) => void;
}

export const BrowserPageMenu: FC<BrowserPageMenuProps> = ({
	placement,
	disabled,
	loading,
	canGoBack,
	canGoForward,
	pageZoom,
	waitingCount,
	downloadsDir,
	onAddress,
	onBack,
	onForward,
	onReload,
	onStop,
	onHome,
	onFind,
	onPrint,
	onResetZoom,
	onOpenDownloads,
	onOpenApprovals,
	onOpenChange,
	onCloseAutoFocus,
}) => {
	const [open, setOpen] = useState(false);
	/*
	 * A MENU THAT IS TORN DOWN MUST STILL SAY IT CLOSED (agent review round 2,
	 * MINOR-8). Radix unmounts an open panel without emitting
	 * `onOpenChange(false)` when the popout closes under it — Ctrl+Tab, a
	 * main-side dismiss, the start page replacing the row. The surface's Escape
	 * gate is driven by that callback, so a retained `true` swallowed Escape on
	 * the NEXT raise. Resetting at the source means no owner has to remember the
	 * teardown path, and the refs keep the cleanup from firing on a re-render
	 * (the surface passes a fresh callback every render, so depending on it
	 * directly would report `closed` while the menu is open).
	 */
	const openRef = useRef(open);
	openRef.current = open;
	const onOpenChangeRef = useRef(onOpenChange);
	onOpenChangeRef.current = onOpenChange;
	useEffect(
		() => () => {
			if (openRef.current) onOpenChangeRef.current?.(false);
		},
		[],
	);
	// The menu panel lands in the content rect; the page must yield while it is
	// there, for the reason the file header states.
	useSuppressBrowserView(open, "browser-page-menu");
	const platform = chordPlatform();
	// The pointer is the only way a mouse user meets Find, Print, Zoom and
	// Downloads now that the toolbar is gone, so each row that HAS a chord says
	// it (UX U6). `aria-keyshortcuts` was not added per item: the rows are menu
	// items, not buttons, and the shortcut column is the visible half.
	const back = navigationShortcutLabel("back", platform === "mac");
	const forward = navigationShortcutLabel("forward", platform === "mac");
	const address = chordCaption("primary+l", platform).glyph;
	const reload = chordCaption("primary+r", platform).glyph;
	const find = chordCaption("primary+f", platform).glyph;
	const zoomReset = chordCaption("primary+0", platform).glyph;
	return (
		<DropdownMenu
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				onOpenChange?.(next);
			}}
		>
			<Tooltip content={t("ui.browser.browser_url_bar.page_menu")} side="top">
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className={cn("shrink-0", placement === "popout" && "size-7")}
						aria-label={t("ui.browser.browser_url_bar.page_menu")}
						disabled={disabled}
						data-tour-tag="browser-page-menu"
					>
						<MoreHorizontal aria-hidden className="size-4" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent
				align="end"
				sideOffset={4}
				onCloseAutoFocus={onCloseAutoFocus}
				// The popout's blur rule admits focus in ITS menu's portal only; this
				// marker is how that rule tells this panel from any other Radix menu in
				// the document (agent review round 2, MINOR-7).
				data-browser-chrome={PAGE_MENU_SURFACE_TAG}
			>
				<DropdownMenuItem
					onSelect={onAddress}
					data-tour-tag="browser-page-menu-address"
				>
					{t("ui.browser.browser_url_bar.address")}
					<DropdownMenuShortcut>{address}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!canGoBack}
					onSelect={onBack}
					data-tour-tag="browser-back"
				>
					<ArrowLeft aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.back")}
					<DropdownMenuShortcut>{back}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canGoForward}
					onSelect={onForward}
					data-tour-tag="browser-forward"
				>
					<ArrowRight aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.forward")}
					<DropdownMenuShortcut>{forward}</DropdownMenuShortcut>
				</DropdownMenuItem>
				{loading ? (
					<DropdownMenuItem onSelect={onStop} data-tour-tag="browser-stop">
						<X aria-hidden className="size-4" />
						{t("ui.browser.browser_url_bar.stop_loading")}
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem onSelect={onReload} data-tour-tag="browser-reload">
						<RotateCw aria-hidden className="size-4" />
						{t("ui.browser.browser_url_bar.reload")}
						<DropdownMenuShortcut>{reload}</DropdownMenuShortcut>
					</DropdownMenuItem>
				)}
				<DropdownMenuItem onSelect={onHome} data-tour-tag="browser-home">
					<Home aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.home")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem onSelect={onFind} data-tour-tag="browser-find">
					<Search aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.find_in_page")}
					<DropdownMenuShortcut>{find}</DropdownMenuShortcut>
				</DropdownMenuItem>
				<DropdownMenuItem onSelect={onPrint} data-tour-tag="browser-print">
					<Printer aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.print_page")}
				</DropdownMenuItem>
				{pageZoom !== 1 && (
					<DropdownMenuItem onSelect={onResetZoom} data-tour-tag="browser-zoom">
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
					onSelect={onOpenApprovals}
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
