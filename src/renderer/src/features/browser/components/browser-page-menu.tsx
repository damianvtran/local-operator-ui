import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { Button, Tooltip } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
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
import { useState } from "react";

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
}) => {
	const [open, setOpen] = useState(false);
	// The menu panel lands in the content rect; the page must yield while it is
	// there, for the reason the file header states.
	useSuppressBrowserView(open, "browser-page-menu");
	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<Tooltip
				content={t("ui.settings.appearance.window_glass.material_menu")}
				side="top"
			>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className={cn("shrink-0", placement === "popout" && "size-7")}
						aria-label={t("ui.settings.appearance.window_glass.material_menu")}
						disabled={disabled}
						data-tour-tag="browser-page-menu"
					>
						<MoreHorizontal aria-hidden className="size-4" />
					</Button>
				</DropdownMenuTrigger>
			</Tooltip>
			<DropdownMenuContent align="end" sideOffset={4}>
				<DropdownMenuItem
					onSelect={onAddress}
					data-tour-tag="browser-page-menu-address"
				>
					{t("ui.browser.browser_url_bar.address")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={!canGoBack}
					onSelect={onBack}
					data-tour-tag="browser-back"
				>
					<ArrowLeft aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.back")}
				</DropdownMenuItem>
				<DropdownMenuItem
					disabled={!canGoForward}
					onSelect={onForward}
					data-tour-tag="browser-forward"
				>
					<ArrowRight aria-hidden className="size-4" />
					{t("ui.browser.browser_url_bar.forward")}
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
